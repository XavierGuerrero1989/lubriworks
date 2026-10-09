import { describe, expect, it } from "vitest";
import { demoAccess, demoState } from "../shared/demo";
import { execute } from "../shared/engine";
import { projectState, type State } from "../shared/model";
import {
  billingItems,
  orderTotal,
  quoteTotal,
  workStage,
} from "../shared/orders";
const owner = demoAccess.member;
const cmd = (
  s: State,
  c: Record<string, unknown>,
  id: string = crypto.randomUUID(),
) => execute(s, owner, c as any, id);
function create() {
  return cmd(
    demoState(),
    {
      action: "order.create",
      vehicleId: "v2",
      branchId: "main",
      serviceIds: ["s1", "s2"],
      odometer: 46200,
      technician: "Nicolás",
      notes: "Rayón en guardabarros",
    },
    "new-order",
  );
}
const decide = (s: State, id = "new-order") =>
  cmd(s, {
    action: "order.decision",
    id,
    decision: "approved",
    method: "presencial",
    note: "Lucía autorizó el presupuesto completo",
  });
describe("order quotes, authorization and real consumption", () => {
  it("creates a multi-service quote from server price snapshots and requires approval", () => {
    const s = create(),
      o = s.orders.at(-1)!;
    expect(o.approval).toBe("pending");
    expect(o.serviceSnapshots).toHaveLength(2);
    expect(workStage(o)).toBe("waiting");
    expect(() => cmd(s, { action: "startOrder", id: o.id })).toThrow(
      "aprobación",
    );
    expect(() => cmd(s, { action: "finishOrder", id: o.id })).toThrow(
      "autorizaciones",
    );
    expect(() =>
      cmd(s, {
        action: "order.create",
        vehicleId: "v2",
        branchId: "main",
        serviceIds: ["s1"],
        odometer: 46200,
      }),
    ).toThrow("orden abierta");
    const a = decide(s).orders.at(-1)!;
    expect(a.approvalHistory?.[0].total).toBe(quoteTotal(o));
  });
  it("retains authorized prices across catalog and generic editing, and prevents forged authorization", () => {
    const s = decide(create()),
      o = s.orders.at(-1)!,
      total = quoteTotal(o);
    s.products.forEach((p) => {
      p.price *= 5;
    });
    s.services[0].labor *= 3;
    const edited = cmd(s, {
      action: "save",
      collection: "orders",
      id: o.id,
      data: {
        ...o,
        items: [],
        labor: 0,
        approval: "rejected",
        photos: [],
        events: [],
        notes: "Nueva observación",
      },
    });
    expect(quoteTotal(edited.orders.at(-1)!)).toBe(total);
    expect(edited.orders.at(-1)!.approval).toBe("approved");
    expect(() =>
      cmd(s, { action: "order.quote", id: o.id, serviceIds: ["s2"] }),
    ).toThrow("se conserva");
    const base = demoState(),
      data = {
        ...base.orders[0],
        vehicleId: "v2",
        customerId: "c2",
        status: "received",
        approval: "approved",
        workStatus: "working",
        actualItems: base.orders[0].items,
        consumptionConfirmed: true,
      };
    const forged = cmd(
      base,
      { action: "save", collection: "orders", data },
      "forged",
    ).orders.at(-1)!;
    expect(forged.approval).toBe("pending");
    expect(forged.workStatus).toBe("received");
    expect(forged.actualItems).toBeUndefined();
    expect(forged.consumptionConfirmed).toBe(false);
  });
  it("allows rejection and revision with history and enforces role permissions", () => {
    let s = create();
    s = cmd(s, {
      action: "order.decision",
      id: "new-order",
      decision: "rejected",
      method: "telefono",
      note: "Prefiere otro aceite",
    });
    expect(workStage(s.orders.at(-1)!)).toBe("waiting");
    s = cmd(s, {
      action: "order.quote",
      id: "new-order",
      serviceIds: ["s2"],
      extraItems: [],
    });
    expect(s.orders.at(-1)!.quoteRevision).toBe(2);
    expect(s.orders.at(-1)!.approvalHistory).toHaveLength(1);
    expect(s.orders.at(-1)!.approval).toBe("pending");
    for (const role of ["customer", "technician"] as const)
      expect(() =>
        execute(
          s,
          { ...owner, role, customerId: role === "customer" ? "c2" : null },
          {
            action: "order.decision",
            id: "new-order",
            decision: "approved",
            method: "mensaje",
            note: "Ok",
          },
          "deny",
        ),
      ).toThrow();
    expect(() =>
      cmd(s, {
        action: "order.create",
        vehicleId: "v2",
        branchId: "north",
        serviceIds: ["s1"],
        odometer: 46200,
      }),
    ).toThrow("orden abierta");
    expect(() =>
      cmd(demoState(), {
        action: "order.create",
        vehicleId: "v2",
        branchId: "north",
        serviceIds: ["s1"],
        odometer: 46200,
      }),
    ).toThrow("otra sucursal");
  });
  it("blocks unfinished additions, preserves individual decisions and rejects unauthorized consumption", () => {
    let s = decide(create());
    s = cmd(s, { action: "startOrder", id: "new-order" });
    s = cmd(
      s,
      {
        action: "order.addition",
        id: "new-order",
        title: "Aceite adicional",
        items: [{ productId: "p1", quantity: 1 }],
        labor: 2500,
      },
      "extra",
    );
    expect(workStage(s.orders.at(-1)!)).toBe("waiting");
    expect(() => cmd(s, { action: "finishOrder", id: "new-order" })).toThrow(
      "autorizaciones",
    );
    expect(() =>
      cmd(s, { action: "order.consumption", id: "new-order", items: [] }),
    ).toThrow("pendientes");
    s = cmd(s, {
      action: "order.additionDecision",
      id: "new-order",
      additionId: "extra",
      decision: "approved",
      method: "mensaje",
      note: "Lucía confirmó el adicional",
    });
    expect(workStage(s.orders.at(-1)!)).toBe("working");
    expect(() =>
      cmd(s, {
        action: "order.consumption",
        id: "new-order",
        items: [{ productId: "p1", quantity: 100 }],
      }),
    ).toThrow("excede");
    expect(() =>
      cmd(s, {
        action: "order.consumption",
        id: "new-order",
        items: [{ productId: "p3", quantity: 1 }],
      }),
    ).toThrow("adicional");
    expect(() =>
      execute(
        s,
        { ...owner, role: "cashier" },
        { action: "order.consumption", id: "new-order", items: [] },
        "cash-deny",
      ),
    ).toThrow("no permite");
    s = cmd(
      s,
      {
        action: "order.addition",
        id: "new-order",
        title: "Otra propuesta",
        items: [],
        labor: 500,
      },
      "reject",
    );
    s = cmd(s, {
      action: "order.additionDecision",
      id: "new-order",
      additionId: "reject",
      decision: "rejected",
      method: "presencial",
      note: "No lo quiere",
    });
    expect(s.orders.at(-1)!.additions?.[1].status).toBe("rejected");
  });
  it("deducts only actual quantities, bills authorized snapshots, creates each reminder and separates work from payment", () => {
    let s = decide(create());
    const quoted = quoteTotal(s.orders.at(-1)!);
    s = cmd(s, { action: "startOrder", id: "new-order" });
    expect(() => cmd(s, { action: "finishOrder", id: "new-order" })).toThrow(
      "consumos",
    );
    const stock = s.products.find((p) => p.id === "p1")!.stock;
    s = cmd(s, {
      action: "order.consumption",
      id: "new-order",
      items: [
        { productId: "p1", quantity: 3.5 },
        { productId: "p2", quantity: 1 },
        { productId: "p4", quantity: 1 },
      ],
      note: "Se utilizaron 3,5 litros",
    });
    expect(s.products.find((p) => p.id === "p1")!.stock).toBe(stock);
    s = cmd(s, { action: "finishOrder", id: "new-order" }, "finished");
    expect(s.products.find((p) => p.id === "p1")!.stock).toBe(stock - 3.5);
    const finished = s.orders.at(-1)!;
    expect(orderTotal(finished)).toBeLessThan(quoted);
    expect(finished.workStatus).toBe("ready");
    expect(finished.paymentStatus).toBe("unpaid");
    expect(
      s.reminders.filter(
        (r) => r.vehicleId === "v2" && ["s1", "s2"].includes(r.source),
      ),
    ).toHaveLength(2);
    s = cmd(s, { action: "chargeOrder", id: "new-order", method: "cash" });
    expect(s.orders.at(-1)!.workStatus).toBe("ready");
    expect(s.orders.at(-1)!.paymentStatus).toBe("paid");
    expect(s.sales.at(-1)!.total).toBe(orderTotal(finished));
    expect(
      s.sales.at(-1)!.items.find((i) => i.name.includes("Shell"))?.quantity,
    ).toBe(3.5);
    s = cmd(s, { action: "deliverOrder", id: "new-order" });
    expect(workStage(s.orders.at(-1)!)).toBe("delivered");
    expect(() =>
      cmd(s, {
        action: "order.update",
        id: "new-order",
        data: { technician: "", notes: "", checklist: [], recommendations: "" },
      }),
    ).toThrow("cerrada");
  });
  it("allocates duplicate products across distinct authorized prices without rounding away a quote", () => {
    const o = create().orders.at(-1)!;
    o.additions = [
      {
        id: "x",
        title: "Más aceite",
        status: "approved",
        createdAt: new Date().toISOString(),
        labor: 0,
        items: [{ ...o.items[0], quantity: 1, price: o.items[0].price + 500 }],
      },
    ];
    const sum = o.items[0].quantity + 1;
    o.actualItems = [{ ...o.items[0], quantity: sum }];
    o.consumptionConfirmed = true;
    expect(
      billingItems(o).filter((i) => i.productId === o.items[0].productId),
    ).toHaveLength(2);
    const others = o.items
      .slice(1)
      .reduce((n, i) => n + i.price * i.quantity, 0);
    expect(orderTotal(o)).toBe(quoteTotal(o) - others);
  });
  it("cancels an unstarted visit with a reason, protects started visits and masks internal data", () => {
    let s = create();
    const o = s.orders.at(-1)!;
    o.photos = [
      {
        id: "photo",
        caption: "Rayón",
        phase: "arrival",
        at: new Date().toISOString(),
        by: owner.uid,
      },
    ];
    o.actualItems = [{ ...o.items[0], cost: 9999 }];
    o.recommendations = "Observación interna";
    const customer = projectState(s, {
      ...owner,
      role: "customer",
      customerId: "c2",
    }).orders.at(-1)!;
    expect(customer.photos).toEqual([]);
    expect(customer.events).toEqual([]);
    expect(customer.actualItems?.[0].cost).toBe(0);
    expect(customer.notes).toBe("");
    s = cmd(s, {
      action: "order.cancel",
      id: o.id,
      reason: "El cliente rechazó el presupuesto",
    });
    expect(workStage(s.orders.at(-1)!)).toBe("cancelled");
    expect(() => cmd(s, { action: "startOrder", id: o.id })).toThrow();
    let active = decide(create());
    active = cmd(active, { action: "startOrder", id: "new-order" });
    expect(() =>
      cmd(active, {
        action: "order.cancel",
        id: "new-order",
        reason: "Cancelar",
      }),
    ).toThrow("iniciado");
  });
});
