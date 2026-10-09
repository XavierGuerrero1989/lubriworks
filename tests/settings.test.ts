import { describe, it, expect } from "vitest";
import { demoAccess, demoState } from "../shared/demo";
import { availability, availableTimes } from "../shared/agenda";
import { execute } from "../shared/engine";
import { permitted, schemas, type Entity } from "../shared/model";
const owner = demoAccess.member;
const turn: Entity<"appointments"> = {
  id: "a",
  customerId: "c1",
  vehicleId: "v1",
  branchId: "main",
  date: "2026-10-09",
  time: "09:00",
  status: "confirmed",
  reason: "Service",
  technician: "Juan",
  durationMinutes: 60,
};
const branch = {
  id: "main",
  name: "Centro",
  address: "",
  appointmentCapacity: 2,
  technicians: ["Juan"],
  hours: [
    { day: 5, open: "08:00", close: "12:00" },
    { day: 5, open: "14:00", close: "18:00" },
  ],
};
describe("operational configuration", () => {
  it("honors split hours, working days, closure dates and technician roster", () => {
    expect(availability(turn, [], branch)).toBeNull();
    expect(availability({ ...turn, time: "11:30" }, [], branch)).toContain(
      "horarios",
    );
    expect(availability({ ...turn, date: "2026-10-10" }, [], branch)).toContain(
      "horarios",
    );
    expect(
      availability(turn, [], { ...branch, closedDates: [turn.date] }),
    ).toContain("cerrada");
    expect(availability({ ...turn, technician: "Otro" }, [], branch)).toContain(
      "técnico",
    );
    expect(availableTimes({ ...turn, time: "12:00" }, [], branch)[0]).toBe(
      "14:00",
    );
    expect(
      availability({ ...turn, time: "12:00" }, [], {
        ...branch,
        scheduleEnabled: false,
      }),
    ).toBeNull();
  });
  it("validates intervals and dates", () => {
    expect(() =>
      schemas.branches.parse({
        ...branch,
        hours: [{ day: 5, open: "18:00", close: "08:00" }],
      }),
    ).toThrow();
    expect(() =>
      schemas.branches.parse({ ...branch, closedDates: ["2026-02-30"] }),
    ).toThrow();
  });
  it("preserves configuration when legacy callers edit branch name", () => {
    const s = demoState();
    s.branches[0] = { ...branch, receptionChecklist: ["Recepción"] };
    s.appointments = [];
    const next = execute(
      s,
      owner,
      {
        action: "save",
        collection: "branches",
        id: "main",
        data: { name: "Nuevo", address: "" },
      },
      "edit",
    );
    expect(next.branches[0].hours).toEqual(branch.hours);
    expect(next.branches[0].receptionChecklist).toEqual(["Recepción"]);
  });
  it("prevents schedule or resource changes conflicting with existing future turns", () => {
    const s = demoState();
    s.appointments = [turn];
    expect(() =>
      execute(
        s,
        owner,
        {
          action: "save",
          collection: "branches",
          id: "main",
          data: {
            ...branch,
            hours: [{ day: 5, open: "10:00", close: "18:00" }],
          },
        },
        "edit",
        "2026-10-09T11:00:00.000Z",
      ),
    ).toThrow("turnos existentes");
    expect(() =>
      execute(
        s,
        owner,
        {
          action: "save",
          collection: "branches",
          id: "main",
          data: { ...branch, technicians: ["Otro"] },
        },
        "edit",
        "2026-10-09T11:00:00.000Z",
      ),
    ).toThrow("técnico");
  });
  it("requires configured reception and delivery controls without mutating on failure", () => {
    const s = demoState(),
      o = s.orders[0];
    o.status = "received";
    o.workStatus = "received";
    o.approval = "approved";
    o.checklist = [];
    s.branches.find((b) => b.id === o.branchId)!.receptionChecklist = [
      "Estado exterior",
    ];
    expect(() =>
      execute(s, owner, { action: "startOrder", id: o.id }, "start"),
    ).toThrow("Estado exterior");
    expect(o.status).toBe("received");
    o.status = "paid";
    s.branches.find((b) => b.id === o.branchId)!.deliveryChecklist = [
      "Nivel verificado",
    ];
    expect(() =>
      execute(s, owner, { action: "deliverOrder", id: o.id }, "delivery"),
    ).toThrow("Nivel verificado");
    o.checklist = ["Nivel verificado"];
    expect(
      execute(
        s,
        owner,
        { action: "deliverOrder", id: o.id },
        "delivery",
      ).orders.find((v) => v.id === o.id)?.deliveredAt,
    ).toBeTruthy();
  });
  it("restricts individual permissions while retaining role boundaries and owner access", () => {
    const s = demoState(),
      manager = {
        ...owner,
        role: "manager" as const,
        permissions: {
          charge: false,
          prices: false,
          odometer: false,
          discounts: false,
          delivery: false,
        },
      };
    for (const action of [
      "chargeOrder",
      "sale.pay",
      "sale.discount",
      "vehicle.correctReading",
      "deliverOrder",
    ])
      expect(() => execute(s, manager, { action }, "op")).toThrow("permiso");
    expect(() =>
      execute(s, manager, { action: "order.create", labor: 0 }, "op"),
    ).toThrow("precios");
    expect(permitted({ ...manager, role: "owner" }, "prices")).toBe(true);
    expect(
      permitted(
        { ...owner, role: "customer", permissions: { charge: true } },
        "charge",
      ),
    ).toBe(false);
  });
});
