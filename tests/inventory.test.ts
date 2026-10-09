import { describe, it, expect } from "vitest";
import { demoAccess, demoState } from "../shared/demo";
import { execute } from "../shared/engine";
import {
  availableStock,
  reservedStock,
  reservations,
  stockStatus,
} from "../shared/inventory";
import type { State } from "../shared/model";
const owner = demoAccess.member;
const run = (
  s: State,
  c: Record<string, unknown>,
  id: string = crypto.randomUUID(),
) => execute(s, owner, c as any, id);
function setup() {
  const s = demoState();
  s.orders = [];
  s.products[0].stock = 5;
  s.products[1].stock = 1;
  return s;
}
const create = (s: State, vehicleId = "v1", id = "order1") =>
  run(
    s,
    {
      action: "order.create",
      vehicleId,
      branchId: "main",
      serviceIds: ["s1"],
      odometer: s.vehicles.find((v) => v.id === vehicleId)!.odometer,
    },
    id,
  );
const approve = (s: State, id = "order1") =>
  run(s, {
    action: "order.decision",
    id,
    decision: "approved",
    method: "presencial",
    note: "Cliente autoriza el trabajo",
  });
describe("physical, reserved and available inventory", () => {
  it("reserves authorized budgets without changing physical stock and denies overbooking", () => {
    let s = create(setup());
    s = create(s, "v2", "order2");
    expect(reservedStock(s, "p1")).toBe(0);
    s = approve(s);
    expect(s.products[0].stock).toBe(5);
    expect(reservedStock(s, "p1")).toBe(4.5);
    expect(availableStock(s, s.products[0])).toBe(0.5);
    expect(reservations(s, "p1")[0].orderId).toBe("order1");
    expect(() => approve(s, "order2")).toThrow("disponible insuficiente");
    expect(s.orders[1].approval).toBe("pending");
  });
  it("reserves only approved additions and releases all reservations on cancellation", () => {
    let s = approve(create(setup()));
    s = run(
      s,
      {
        action: "order.addition",
        id: "order1",
        title: "Más aceite",
        items: [{ productId: "p1", quantity: 0.5 }],
        labor: 0,
      },
      "extra",
    );
    expect(reservedStock(s, "p1")).toBe(4.5);
    s = run(s, {
      action: "order.additionDecision",
      id: "order1",
      additionId: "extra",
      decision: "approved",
      method: "presencial",
      note: "Cliente acepta adicional",
    });
    expect(reservedStock(s, "p1")).toBe(5);
    expect(s.products[0].stock).toBe(5);
    s = run(s, {
      action: "order.cancel",
      id: "order1",
      reason: "Cliente cancela el trabajo",
    });
    expect(reservedStock(s, "p1")).toBe(0);
    expect(s.products[0].stock).toBe(5);
  });
  it("keeps authorized reservations through consumption confirmation and deducts only actual use at finish", () => {
    let s = approve(create(setup()));
    s = run(s, { action: "startOrder", id: "order1" });
    s = run(s, {
      action: "order.consumption",
      id: "order1",
      items: [{ productId: "p1", quantity: 3.25 }],
    });
    expect(reservedStock(s, "p1")).toBe(4.5);
    expect(reservedStock(s, "p2")).toBe(1);
    s = run(s, { action: "finishOrder", id: "order1" });
    expect(s.products[0].stock).toBe(1.75);
    expect(s.products[1].stock).toBe(1);
    expect(reservedStock(s, "p1")).toBe(0);
    expect(s.movements.at(-1)).toMatchObject({
      quantity: -3.25,
      orderId: "order1",
      by: owner.uid,
      actorName: owner.name,
    });
  });
  it("protects reservations from counter sales and other service completions", () => {
    let s = approve(create(setup()));
    const sale = {
      action: "sale",
      branchId: "main",
      items: [{ productId: "p1", quantity: 1 }],
      method: "cash",
    };
    expect(() => run(s, sale)).toThrow("reservados");
    s = run(s, { ...sale, items: [{ productId: "p1", quantity: 0.5 }] });
    expect(s.products[0].stock).toBe(4.5);
    expect(reservedStock(s, "p1")).toBe(4.5);
    expect(availableStock(s, s.products[0])).toBe(0);
    s = create(s, "v2", "order2");
    expect(() => approve(s, "order2")).toThrow();
  });
  it("records physical corrections that reveal reservation shortages and prevents starting until replenished", () => {
    let s = approve(create(setup()));
    s = run(s, {
      action: "adjustStock",
      id: "p1",
      quantity: -1,
      reason: "Conteo físico confirmado",
    });
    expect(s.products[0].stock).toBe(4);
    expect(availableStock(s, s.products[0])).toBe(-0.5);
    expect(stockStatus(s, s.products[0])).toBe("shortage");
    expect(() => run(s, { action: "startOrder", id: "order1" })).toThrow(
      "disponible",
    );
    s = run(s, {
      action: "adjustStock",
      id: "p1",
      quantity: 1,
      reason: "Reposición en depósito",
    });
    expect(() => run(s, { action: "startOrder", id: "order1" })).not.toThrow();
  });
  it("preserves old work in progress without fabricating approval or reserving historical work", () => {
    const s = demoState();
    expect(s.orders[0].approval).toBeUndefined();
    expect(reservedStock(s, "p1")).toBe(4.5);
    expect(reservations(s, "p1")[0].legacy).toBe(true);
    s.orders[0].status = "ready";
    expect(reservedStock(s, "p1")).toBe(0);
    s.orders[0].status = "paid";
    expect(reservedStock(s, "p1")).toBe(0);
  });
  it("validates inventory metadata and preserves it for older callers", () => {
    const s = setup(),
      p = s.products[0];
    let next = run(s, {
      action: "save",
      collection: "products",
      id: p.id,
      data: {
        ...p,
        location: "Tanque 1",
        compatibility: "Norma confirmada",
        reserved: 9000,
      },
    });
    expect(next.products[0].location).toBe("Tanque 1");
    expect((next.products[0] as any).reserved).toBeUndefined();
    next = run(next, {
      action: "save",
      collection: "products",
      id: p.id,
      data: p,
    });
    expect(next.products[0].compatibility).toBe("Norma confirmada");
    expect(() =>
      run(next, {
        action: "save",
        collection: "products",
        id: p.id,
        data: { ...p, unit: "unidad" },
      }),
    ).toThrow("unidad");
    expect(() =>
      run(s, {
        action: "save",
        collection: "products",
        data: { ...s.products[1], sku: "new", stock: 0.5 },
      }),
    ).toThrow("entero");
    for (const role of ["technician", "cashier", "customer"] as const)
      expect(() =>
        execute(
          s,
          { ...owner, role },
          { action: "save", collection: "products", id: p.id, data: p },
          "role",
        ),
      ).toThrow("rol");
  });
  it("does not let an unfunded additional consume stock promised to another order", () => {
    let s = approve(create(setup()));
    s = run(
      s,
      {
        action: "order.addition",
        id: "order1",
        title: "Aceite adicional",
        items: [{ productId: "p1", quantity: 1 }],
      },
      "more",
    );
    expect(() =>
      run(s, {
        action: "order.additionDecision",
        id: "order1",
        additionId: "more",
        decision: "approved",
        method: "presencial",
        note: "Aceptar adicional",
      }),
    ).toThrow("disponible");
    expect(reservedStock(s, "p1")).toBe(4.5);
    expect(s.orders[0].additions?.[0].status).toBe("pending");
  });
});
