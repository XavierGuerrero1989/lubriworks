import { describe, it, expect } from "vitest";
import { demoState, demoAccess } from "../shared/demo";
import {
  assertAccess,
  projectState,
  monthlyUsage,
  estimatedKm,
  dueInfo,
  addMonths,
  today,
  vehicleYear,
  type Member,
} from "../shared/model";
import { execute } from "../shared/engine";
import { validCron } from "../server/reminders";
const owner = demoAccess.member;
const customer: Member = { ...owner, role: "customer", customerId: "c1" };
const cmd = (action: string, data = {}) => ({ action, ...data });
describe("tenant authorization", () => {
  it("accepts only current authoritative membership", () =>
    expect(
      assertAccess(demoAccess.tenant, owner, owner.uid, "demo-centro").member,
    ).toEqual(owner));
  it.each([
    ["other tenant", { ...owner, tenantId: "other" }],
    ["other uid", { ...owner, uid: "other" }],
    ["inactive membership", { ...owner, active: false }],
    ["invalid role", { ...owner, role: "root" }],
    ["unlinked customer", { ...owner, role: "customer", customerId: null }],
  ])("denies %s", (_, member) =>
    expect(() =>
      assertAccess(
        demoAccess.tenant,
        member as Member,
        owner.uid,
        "demo-centro",
      ),
    ).toThrow(),
  );
  it("denies suspended tenant", () =>
    expect(() =>
      assertAccess(
        { ...demoAccess.tenant, active: false },
        owner,
        owner.uid,
        "demo-centro",
      ),
    ).toThrow());
  it("denies path injection", () =>
    expect(() =>
      assertAccess(
        demoAccess.tenant,
        owner,
        owner.uid,
        "demo-centro/../../other",
      ),
    ).toThrow());
  it("customer sees only owned records and no internal costs or notes", () => {
    const s = projectState(demoState(), customer);
    expect(s.vehicles.map((v) => v.id)).toEqual(["v1"]);
    expect(s.customers.map((v) => v.id)).toEqual(["c1"]);
    expect(s.orders.map((v) => v.id)).toEqual(["ot1001"]);
    expect(s.orders[0].notes).toBe("");
    expect(s.orders[0].items[0].cost).toBe(0);
    expect(s.products).toEqual([]);
    expect(s.cash).toEqual([]);
    expect(s.sales).toEqual([]);
  });
  it("technician cannot read financial collections or product costs", () => {
    const s = projectState(demoState(), { ...owner, role: "technician" });
    expect(s.sales).toEqual([]);
    expect(s.cash).toEqual([]);
    expect(s.products[0].cost).toBe(0);
    expect(s.orders[0].items[0].cost).toBe(0);
  });
  it("rejects customer editing someone else vehicle", () =>
    expect(() =>
      execute(
        demoState(),
        customer,
        cmd("reading", { id: "v2", odometer: 99999, date: today() }),
        "op",
      ),
    ).toThrow("ajeno"));
  it("rejects customer changing product prices", () =>
    expect(() =>
      execute(
        demoState(),
        customer,
        cmd("save", { collection: "products", data: {} }),
        "op",
      ),
    ).toThrow("rol"));
  it("rejects technician charging", () =>
    expect(() =>
      execute(demoState(), { ...owner, role: "technician" }, cmd("sale"), "op"),
    ).toThrow("rol"));
  it("rejects cashier receiving merchandise", () =>
    expect(() =>
      execute(
        demoState(),
        { ...owner, role: "cashier" },
        cmd("receivePurchase", { id: "p" }),
        "op",
      ),
    ).toThrow());
});
describe("atomic operations and stock", () => {
  it("finishes a service once, updates stock and schedules next maintenance", () => {
    const before = demoState();
    const s = execute(
      before,
      owner,
      cmd("finishOrder", { id: "ot1001" }),
      "finish",
    );
    expect(s.products[0].stock).toBe(80);
    expect(s.products[1].stock).toBe(3);
    expect(s.orders[0].status).toBe("ready");
    expect(monthlyUsage(s.vehicles[0]).source).toBe("visits");
    expect(s.reminders.find((r) => r.id === "finish")?.dueKm).toBe(88500);
    expect(s.reminders.find((r) => r.id === "r1")?.status).toBe("done");
    expect(before.orders[0].status).toBe("working");
    expect(() =>
      execute(s, owner, cmd("finishOrder", { id: "ot1001" }), "second"),
    ).toThrow("finalizada");
  });
  it("insufficient stock changes nothing", () => {
    const before = demoState();
    before.products[1].stock = 0;
    const copy = structuredClone(before);
    expect(() =>
      execute(before, owner, cmd("finishOrder", { id: "ot1001" }), "finish"),
    ).toThrow("Stock insuficiente");
    expect(before).toEqual(copy);
  });
  it("rejects cross-branch stock", () =>
    expect(() =>
      execute(
        demoState(),
        owner,
        cmd("sale", {
          branchId: "north",
          method: "cash",
          items: [{ productId: "p1", quantity: 1 }],
        }),
        "op",
      ),
    ).toThrow("otra sucursal"));
  it("requires open cash and keeps stock intact on rejection", () => {
    const s = demoState();
    s.cash = [];
    expect(() =>
      execute(
        s,
        owner,
        cmd("sale", {
          branchId: "main",
          method: "cash",
          items: [{ productId: "p1", quantity: 1 }],
        }),
        "op",
      ),
    ).toThrow("Abrí la caja");
    expect(s.products[0].stock).toBe(84.5);
  });
  it("charges a ready order once without discounting stock twice", () => {
    const finished = execute(
      demoState(),
      owner,
      cmd("finishOrder", { id: "ot1001" }),
      "finish",
    );
    const s = execute(
      finished,
      owner,
      cmd("chargeOrder", { id: "ot1001", method: "cash" }),
      "charge",
    );
    expect(s.products[0].stock).toBe(80);
    expect(s.sales.at(-1)?.total).toBe(101750);
    expect(() =>
      execute(
        s,
        owner,
        cmd("chargeOrder", { id: "ot1001", method: "cash" }),
        "charge2",
      ),
    ).toThrow();
  });
  it("aggregates repeated product lines when checking stock", () => {
    const s = demoState();
    expect(() =>
      execute(
        s,
        owner,
        cmd("sale", {
          branchId: "main",
          method: "cash",
          items: [
            { productId: "p2", quantity: 3 },
            { productId: "p2", quantity: 3 },
          ],
        }),
        "op",
      ),
    ).toThrow("Stock insuficiente");
  });
  it("rejects fractional unit counts", () =>
    expect(() =>
      execute(
        demoState(),
        owner,
        cmd("sale", {
          branchId: "main",
          method: "cash",
          items: [{ productId: "p2", quantity: 0.5 }],
        }),
        "op",
      ),
    ).toThrow("enteras"));
  it("receives purchases once", () => {
    const before = demoState();
    before.purchases = [
      {
        id: "buy",
        branchId: "main",
        supplierId: "sup1",
        date: today(),
        status: "draft",
        items: [{ productId: "p1", quantity: 20, cost: 9500 }],
      },
    ];
    const s = execute(
      before,
      owner,
      cmd("receivePurchase", { id: "buy" }),
      "op",
    );
    expect(s.products[0].stock).toBe(104.5);
    expect(s.products[0].cost).toBe(9500);
    expect(() =>
      execute(s, owner, cmd("receivePurchase", { id: "buy" }), "op2"),
    ).toThrow("recibida");
  });
  it("cash close excludes card and transfer payments", () => {
    const s = execute(
      demoState(),
      owner,
      cmd("closeCash", { id: "cash1", counted: 108000 }),
      "op",
    );
    expect(s.cash[0].expected).toBe(108000);
  });
  it("forbids negative stock and unaudited adjustment reasons", () => {
    expect(() =>
      execute(
        demoState(),
        owner,
        cmd("adjustStock", {
          id: "p2",
          quantity: -5,
          reason: "Recuento físico",
        }),
        "op",
      ),
    ).toThrow("negativo");
    expect(() =>
      execute(
        demoState(),
        owner,
        cmd("adjustStock", { id: "p2", quantity: 1, reason: "" }),
        "op",
      ),
    ).toThrow();
  });
});
describe("vehicle extinguisher", () => {
  it("clears the date and reminder when there is no extinguisher, preserving purchase intent", () => {
    const s = demoState();
    const v = s.vehicles[0];
    const result = execute(s, owner, cmd("save", { collection: "vehicles", id: v.id, data: { ...v, hasExtinguisher: false, wantsExtinguisher: true } }), "no-fire");
    expect(result.vehicles[0].extinguisherDue).toBe("");
    expect(result.vehicles[0].wantsExtinguisher).toBe(true);
    expect(result.reminders.some((r) => r.id === `fire-${v.id}`)).toBe(false);
  });
  it("accepts expired extinguishers with replacement intent and requires a date when present", () => {
    const s = demoState();
    const v = s.vehicles[0];
    const result = execute(s, owner, cmd("save", { collection: "vehicles", id: v.id, data: { ...v, hasExtinguisher: true, wantsExtinguisher: true, extinguisherDue: "2020-01-01" } }), "expired-fire");
    expect(result.reminders.find((r) => r.id === `fire-${v.id}`)?.dueDate).toBe("2020-01-01");
    expect(result.vehicles[0].wantsExtinguisher).toBe(true);
    expect(() => execute(demoState(), owner, cmd("save", { collection: "vehicles", id: v.id, data: { ...v, hasExtinguisher: true, extinguisherDue: "" } }), "missing-fire-date")).toThrow();
  });
});
describe("maintenance estimation", () => {
  it("saves a year-only vehicle and rejects invalid or inconsistent years", () => {
    const s = demoState();
    const data = { ...s.vehicles[0], year: 2020 };
    const saved = execute(s, owner, cmd("save", { collection: "vehicles", id: data.id, data }), "year-save");
    expect(saved.vehicles[0].year).toBe(2020);
    expect(saved.vehicles[0].firstRegistration).toBeUndefined();
    for (const year of [1899, 2020.5, Number(today().slice(0, 4)) + 1]) {
      expect(() => execute(demoState(), owner, cmd("save", { collection: "vehicles", id: data.id, data: { ...data, year } }), "invalid-year")).toThrow();
    }
    expect(() => execute(demoState(), owner, cmd("save", { collection: "vehicles", id: data.id, data: { ...data, year: 2020, readingDate: "2019-12-31" } }), "before-year")).toThrow();
  });
  it("keeps legacy registration records readable and estimates from a year", () => {
    const base = { ...demoState().vehicles[0], previousReadingDate: "", previousOdometer: null, odometer: 12000, readingDate: "2021-01-01" };
    const { year: _year, ...legacyBase } = base;
    const legacy = { ...legacyBase, firstRegistration: "2020-01-01" };
    expect(vehicleYear(legacy)).toBe(2020);
    expect(monthlyUsage({ ...base, year: 2020 })).toEqual(monthlyUsage(legacy));
    expect(monthlyUsage({ ...base, year: 2021 })).toEqual({ km: 12000, source: "age" });
    expect(() => execute(demoState(), owner, cmd("save", { collection: "vehicles", data: { ...legacy, plate: "LEG2020" } }), "legacy-year")).not.toThrow();
  });
  it("starts with age / odometer then prefers actual readings", () => {
    const v = demoState().vehicles[0];
    expect(monthlyUsage(v).source).toBe("visits");
    expect(
      monthlyUsage({ ...v, previousReadingDate: "", previousOdometer: null })
        .source,
    ).toBe("age");
  });
  it("never projects backwards below last real reading", () => {
    const v = demoState().vehicles[0];
    expect(estimatedKm(v, "2000-01-01")).toBe(v.odometer);
  });
  it("uses earlier date or estimated kilometers", () => {
    const s = demoState();
    const info = dueInfo(
      {
        ...s.reminders[0],
        dueDate: "2099-01-01",
        dueKm: s.vehicles[0].odometer + 100,
      },
      s.vehicles[0],
    );
    expect(info.soon).toBe(true);
    expect(info.effective < "2099-01-01").toBe(true);
  });
  it("handles zero usage and calendar month boundaries", () => {
    const v = {
      ...demoState().vehicles[0],
      odometer: 0,
      previousOdometer: null,
      previousReadingDate: "",
    };
    expect(monthlyUsage(v).km).toBe(0);
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });
  it("rejects decreasing or future odometer readings", () => {
    expect(() =>
      execute(
        demoState(),
        customer,
        cmd("reading", { id: "v1", odometer: 1, date: today() }),
        "op",
      ),
    ).toThrow("disminuir");
    expect(() =>
      execute(
        demoState(),
        customer,
        cmd("reading", { id: "v1", odometer: 99999, date: "2099-01-01" }),
        "op",
      ),
    ).toThrow("futura");
  });
  it("customer may update only own profile fields", () => {
    const s = execute(
      demoState(),
      customer,
      cmd("profile", {
        data: {
          name: "Martín G.",
          phone: "123",
          pushEnabled: false,
          notes: "overwrite",
          email: "other@example.com",
        },
      }),
      "op",
    );
    expect(s.customers[0].name).toBe("Martín G.");
    expect(s.customers[0].email).toBe("martin@example.com");
    expect(s.customers[0].notes).not.toBe("overwrite");
  });
  it("prevents double-booking a slot", () => {
    const s = demoState();
    expect(() =>
      execute(
        s,
        customer,
        cmd("requestAppointment", {
          vehicleId: "v1",
          branchId: "main",
          date: today(),
          time: "09:00",
          reason: "Service",
        }),
        "op",
      ),
    ).toThrow("superpone");
  });
});
describe("cron authentication", () => {
  it("fails closed without a strong secret", () => {
    expect(validCron(undefined, undefined)).toBe(false);
    expect(validCron("weak", "Bearer weak")).toBe(false);
  });
  it("accepts only the exact bearer secret", () => {
    const secret = "x".repeat(32);
    expect(validCron(secret, `Bearer ${secret}`)).toBe(true);
    expect(validCron(secret, `Bearer ${"y".repeat(32)}`)).toBe(false);
    expect(validCron(secret, "")).toBe(false);
  });
});
