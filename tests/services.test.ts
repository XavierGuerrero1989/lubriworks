import { describe, it, expect } from "vitest";
import { demoState, demoAccess } from "../shared/demo";
import { execute, type Command } from "../shared/engine";
import { serviceAvailable, serviceLabel } from "../shared/services";
import type { State } from "../shared/model";
const owner = demoAccess.member;
const run = (s: State, c: Command, id: string = crypto.randomUUID()) =>
  execute(s, owner, c, id);
const create = (s: State) =>
  run(
    s,
    {
      action: "order.create",
      vehicleId: "v1",
      branchId: "main",
      serviceIds: ["s1"],
      odometer: s.vehicles[0].odometer,
    },
    "new-order",
  );
function setup() {
  const s = demoState();
  s.orders = [];
  return s;
}
describe("service variants and catalog lifecycle", () => {
  it("preserves independent variant metadata, branch, durations and maintenance snapshots", () => {
    let s = setup();
    s = run(s, {
      action: "save",
      collection: "services",
      id: "s1",
      data: {
        ...s.services[0],
        variant: "Sintético",
        category: "Lubricación",
        description: "Aceite y filtro",
        durationMinutes: 45,
        branchId: "main",
        active: true,
      },
    });
    s = create(s);
    expect(s.orders[0].serviceSnapshots?.[0]).toMatchObject({
      name: "Cambio de aceite + filtro · Sintético",
      durationMinutes: 45,
      intervalKm: 10000,
      intervalMonths: 12,
    });
    const quote = s.orders[0];
    s = run(s, {
      action: "save",
      collection: "services",
      id: "s1",
      data: {
        ...s.services[0],
        labor: 50000,
        intervalKm: 5000,
        variant: "Nuevo",
        active: false,
      },
    });
    expect(s.orders[0]).toEqual(quote);
    expect(() =>
      run(s, { action: "order.quote", id: "new-order", serviceIds: ["s1"] }),
    ).toThrow("inactivo");
  });
  it("deactivated catalog entries do not prevent authorizing or finishing an already quoted service", () => {
    let s = create(setup());
    s = run(s, {
      action: "save",
      collection: "services",
      id: "s1",
      data: { ...s.services[0], active: false, intervalKm: 5000 },
    });
    s = run(s, {
      action: "order.decision",
      id: "new-order",
      decision: "approved",
      method: "presencial",
      note: "Autorización presencial",
    });
    s = run(s, { action: "startOrder", id: "new-order" });
    s = run(s, {
      action: "order.consumption",
      id: "new-order",
      items: s.orders[0].items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
    });
    s = run(s, { action: "finishOrder", id: "new-order" });
    expect(
      s.reminders.find((r) => r.source === "s1" && r.status === "active")
        ?.dueKm,
    ).toBe(s.orders[0].odometer + 10000);
  });
  it("allows labor-only global services, restricts branch services and rejects mixed branch combos or fractional units", () => {
    const s = setup();
    expect(serviceAvailable(s, s.services[0], "north")).toBe(false);
    const base = {
      name: "Control",
      labor: 1000,
      intervalKm: 0,
      intervalMonths: 0,
      items: [],
      branchId: "",
    };
    let next = run(
      s,
      { action: "save", collection: "services", data: base },
      "global",
    );
    expect(
      serviceAvailable(
        next,
        next.services.find((v) => v.id === "global")!,
        "north",
      ),
    ).toBe(true);
    next = run(next, {
      action: "save",
      collection: "services",
      id: "global",
      data: { ...base, branchId: "main" },
    });
    expect(
      serviceAvailable(
        next,
        next.services.find((v) => v.id === "global")!,
        "north",
      ),
    ).toBe(false);
    for (const data of [
      { ...base, branchId: "north", items: [{ productId: "p1", quantity: 1 }] },
      { ...base, items: [{ productId: "p2", quantity: 0.5 }] },
      { ...base, items: [{ productId: "p1", quantity: 0.001 }] },
      {
        ...base,
        items: [
          { productId: "p1", quantity: 1 },
          { productId: "p1", quantity: 2 },
        ],
      },
      { ...base, labor: 1.001 },
    ])
      expect(() =>
        run(s, { action: "save", collection: "services", data }),
      ).toThrow();
  });
  it("preserves metadata for older callers and labels a variant without changing the base name", () => {
    const s = setup();
    const original = s.services[0];
    let next = run(s, {
      action: "save",
      collection: "services",
      id: "s1",
      data: {
        ...original,
        variant: "Diésel",
        active: false,
        durationMinutes: 30,
      },
    });
    next = run(next, {
      action: "save",
      collection: "services",
      id: "s1",
      data: original,
    });
    expect(next.services[0].active).toBe(false);
    expect(next.services[0].durationMinutes).toBe(30);
    expect(serviceLabel(next.services[0])).toContain("Diésel");
    expect(next.services[0].name).toBe(original.name);
  });
  it("denies catalog modification to technicians, cashiers and customers", () => {
    const s = setup();
    for (const role of ["technician", "cashier", "customer"] as const)
      expect(() =>
        execute(
          s,
          { ...owner, role },
          {
            action: "save",
            collection: "services",
            id: "s1",
            data: { ...s.services[0], active: false },
          },
          crypto.randomUUID(),
        ),
      ).toThrow();
  });
});
