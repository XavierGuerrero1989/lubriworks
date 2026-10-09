import { describe, it, expect } from "vitest";
import { demoAccess, demoState } from "../shared/demo";
import { execute, type Command } from "../shared/engine";
import { today, projectState, type State } from "../shared/model";
import {
  receivedQuantity,
  pendingQuantity,
  replenishment,
} from "../shared/purchases";
const owner = demoAccess.member;
const run = (s: State, c: Command, id: string = crypto.randomUUID()) =>
  execute(s, owner, c, id);
function setup() {
  const s = demoState();
  s.purchases = [
    {
      id: "buy",
      branchId: "main",
      supplierId: "sup1",
      date: today(),
      expectedDate: today(),
      status: "draft",
      items: [
        { productId: "p1", quantity: 10, cost: 100 },
        { productId: "p2", quantity: 3, cost: 200 },
      ],
    },
  ];
  return s;
}
const receive = (s: State, quantity = 2.25) =>
  run(
    s,
    {
      action: "receivePurchase",
      id: "buy",
      items: [{ productId: "p1", quantity, cost: 120 }],
      reference: "Remito 123",
      note: "Primera entrega",
    },
    "receipt1",
  );
const day = (n: number) => {
  const d = new Date(today() + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
describe("partial purchase receipts and replenishment", () => {
  it("receives only delivered quantities, snapshots actual costs and keeps the quoted purchase immutable", () => {
    const before = setup(),
      s = receive(before),
      p = s.purchases[0];
    expect(p.status).toBe("partial");
    expect(s.products[0].stock).toBe(before.products[0].stock + 2.25);
    expect(s.products[1].stock).toBe(before.products[1].stock);
    expect(s.products[0].cost).toBe(120);
    expect(p.items[0].cost).toBe(100);
    expect(receivedQuantity(p, "p1")).toBe(2.25);
    expect(pendingQuantity(p, "p1")).toBe(7.75);
    expect(p.receipts?.[0]).toMatchObject({
      by: owner.uid,
      reference: "Remito 123",
      note: "Primera entrega",
    });
    expect(s.movements.at(-1)).toMatchObject({
      purchaseId: "buy",
      receiptId: "receipt1",
      quantity: 2.25,
    });
    expect(() =>
      run(s, {
        action: "save",
        collection: "purchases",
        id: "buy",
        data: { ...p, status: "draft" },
      }),
    ).toThrow("editar");
  });
  it("receives the remaining balance with old callers, reaches received and refuses a second complete receipt", () => {
    const partial = receive(setup()),
      s = run(partial, { action: "receivePurchase", id: "buy" });
    expect(s.purchases[0].status).toBe("received");
    expect(receivedQuantity(s.purchases[0], "p1")).toBe(10);
    expect(pendingQuantity(s.purchases[0], "p2")).toBe(0);
    expect(s.purchases[0].receipts).toHaveLength(2);
    expect(() => run(s, { action: "receivePurchase", id: "buy" })).toThrow(
      "recibida",
    );
  });
  it("rejects overdelivery, products outside purchase, duplicate lines, invalid units and precision without partial mutations", () => {
    const s = setup();
    for (const items of [
      [],
      [{ productId: "p1", quantity: 11, cost: 100 }],
      [{ productId: "p3", quantity: 1, cost: 100 }],
      [{ productId: "p2", quantity: 0.5, cost: 100 }],
      [{ productId: "p1", quantity: 0.001, cost: 100 }],
      [{ productId: "p1", quantity: 1, cost: 1.001 }],
      [
        { productId: "p1", quantity: 1, cost: 100 },
        { productId: "p1", quantity: 1, cost: 100 },
      ],
    ])
      expect(() =>
        run(s, { action: "receivePurchase", id: "buy", items }),
      ).toThrow();
    expect(s.purchases[0].status).toBe("draft");
    expect(s.purchases[0].receipts).toBeUndefined();
    expect(s.products[0].stock).toBe(84.5);
  });
  it("cancels only unreceived balance, preserves quantities and prevents further receipt or editing", () => {
    const partial = receive(setup()),
      s = run(partial, {
        action: "purchase.cancel",
        id: "buy",
        reason: "Proveedor sin disponibilidad",
      });
    expect(s.products[0].stock).toBe(partial.products[0].stock);
    expect(receivedQuantity(s.purchases[0], "p1")).toBe(2.25);
    expect(pendingQuantity(s.purchases[0], "p1")).toBe(0);
    expect(s.purchases[0].cancelledBy).toBe(owner.uid);
    expect(() => run(s, { action: "receivePurchase", id: "buy" })).toThrow();
    expect(() =>
      run(s, {
        action: "purchase.cancel",
        id: "buy",
        reason: "Otra cancelación",
      }),
    ).toThrow();
  });
  it("keeps legacy received purchases without manufacturing detailed history and protects receipt fields on draft save", () => {
    const s = setup();
    s.purchases[0].status = "received";
    expect(receivedQuantity(s.purchases[0], "p1")).toBe(10);
    expect(pendingQuantity(s.purchases[0], "p1")).toBe(0);
    expect(s.purchases[0].receipts).toBeUndefined();
    s.purchases[0].status = "draft";
    const next = run(s, {
      action: "save",
      collection: "purchases",
      id: "buy",
      data: {
        ...s.purchases[0],
        receipts: [
          {
            id: "fake",
            at: new Date().toISOString(),
            by: owner.uid,
            actorName: "Fake",
            reference: "",
            note: "",
            items: [{ productId: "p1", quantity: 10, cost: 0 }],
          },
        ],
        cancelReason: "Fabricado",
      },
    });
    expect(next.purchases[0].receipts).toBeUndefined();
    expect(next.purchases[0].cancelReason).toBeUndefined();
  });
  it("records explicit upcoming inputs without reserving stock, excludes them from client data and preserves them through appointment edits", () => {
    const s = setup();
    const a = s.appointments[0];
    a.date = today();
    a.status = "confirmed";
    delete a.orderId;
    const next = run(s, {
      action: "purchase.plan",
      id: a.id,
      items: [{ productId: "p2", quantity: 2 }],
    });
    expect(next.products[1].stock).toBe(s.products[1].stock);
    expect(next.appointments[0].planUpdatedBy).toBe(owner.uid);
    const visible = projectState(next, {
      ...owner,
      role: "customer",
      customerId: a.customerId,
    });
    expect(visible.appointments[0].plannedItems).toBeUndefined();
    const edited = run(next, {
      action: "save",
      collection: "appointments",
      id: a.id,
      data: {
        ...next.appointments[0],
        plannedItems: [{ productId: "p2", quantity: 900 }],
      },
    });
    expect(edited.appointments[0].plannedItems?.[0].quantity).toBe(2);
    expect(() =>
      run(next, {
        action: "purchase.plan",
        id: a.id,
        items: [{ productId: "p2", quantity: 0.5 }],
      }),
    ).toThrow();
  });
  it("projects minimum plus future demand minus reservations and dated purchases, excluding unplanned and already received turns", () => {
    const s = setup();
    s.products[1].stock = 4;
    s.products[1].minStock = 5;
    s.orders = [];
    const template = s.appointments[0];
    s.appointments = [
      {
        ...template,
        id: "future",
        date: day(2),
        status: "confirmed",
        plannedItems: [{ productId: "p2", quantity: 3 }],
      },
      { ...template, id: "unknown", date: day(3), status: "requested" },
      {
        ...template,
        id: "arrived",
        date: day(3),
        status: "confirmed",
        orderId: "an-order",
        plannedItems: [{ productId: "p2", quantity: 9 }],
      },
    ];
    s.purchases[0].expectedDate = today();
    const plan = replenishment(s, "main", day(6));
    const row = plan.rows.find((r) => r.product.id === "p2")!;
    expect(row.demand).toBe(3);
    expect(row.datedIncoming).toBe(3);
    expect(row.suggested).toBe(1);
    expect(plan.unplanned.map((a) => a.id)).toEqual(["unknown"]);
    s.purchases[0].expectedDate = "";
    expect(
      replenishment(s, "main", day(6)).rows.find((r) => r.product.id === "p2")!
        .suggested,
    ).toBe(4);
    s.purchases[0].expectedDate = day(-1);
    expect(
      replenishment(s, "main", day(6)).rows.find((r) => r.product.id === "p2")!
        .datedIncoming,
    ).toBe(0);
  });
  it("does not hide shortages before a later delivery and never combines branches or cancelled purchase balances", () => {
    const s = setup();
    s.orders = [];
    s.products[1].stock = 0;
    s.products[1].minStock = 0;
    s.appointments = [
      {
        ...s.appointments[0],
        id: "next",
        date: day(1),
        status: "confirmed",
        plannedItems: [{ productId: "p2", quantity: 2 }],
      },
    ];
    s.purchases[0].expectedDate = day(3);
    let row = replenishment(s, "main", day(6)).rows.find(
      (r) => r.product.id === "p2",
    )!;
    expect(row.suggested).toBe(2);
    expect(row.firstNeed).toBe(day(1));
    expect(
      replenishment(s, "north", day(6)).rows.every(
        (r) => r.product.branchId === "north",
      ),
    ).toBe(true);
    s.purchases[0].status = "cancelled";
    row = replenishment(s, "main", day(6)).rows.find(
      (r) => r.product.id === "p2",
    )!;
    expect(row.incoming).toBe(0);
  });
  it("denies procurement changes to cashiers, technicians and customers", () => {
    const s = setup();
    for (const role of ["cashier", "technician", "customer"] as const)
      for (const cmd of [
        { action: "receivePurchase", id: "buy" },
        { action: "purchase.cancel", id: "buy", reason: "Cancelar pendiente" },
        { action: "purchase.plan", id: s.appointments[0].id, items: [] },
      ])
        expect(() =>
          execute(s, { ...owner, role }, cmd, crypto.randomUUID()),
        ).toThrow("administración");
  });
});
