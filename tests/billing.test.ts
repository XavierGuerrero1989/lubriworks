import { describe, it, expect } from "vitest";
import { execute } from "../shared/engine";
import { demoAccess, demoState } from "../shared/demo";
import {
  cashExpected,
  salePaid,
  saleBalance,
  collectedByMethod,
} from "../shared/billing";
import { orderTotal } from "../shared/orders";
import { projectState, today, type State } from "../shared/model";
const owner = demoAccess.member;
const run = (
  s: State,
  c: Record<string, unknown>,
  id: string = crypto.randomUUID(),
  role = owner.role,
) => execute(s, { ...owner, role }, c as any, id);
function setup() {
  const s = demoState();
  s.sales = [];
  s.cash = [
    {
      id: "cash1",
      branchId: s.branches[0].id,
      openedAt: new Date(Date.now() - 10000).toISOString(),
      closedAt: null,
      opening: 1000,
      counted: null,
      expected: null,
      uid: owner.uid,
    },
  ];
  s.orders[0].status = "ready";
  s.orders[0].workStatus = "ready";
  return s;
}
const charge = (s: State, payments: unknown[], extra = {}) =>
  run(
    s,
    { action: "chargeOrder", id: s.orders[0].id, payments, ...extra },
    "first",
  );
describe("billing ledger", () => {
  it("combines payments and keeps one sale through partial settlements", () => {
    let s = setup(),
      total = orderTotal(s.orders[0]);
    s = charge(s, [
      { method: "cash", amount: 1000 },
      { method: "transfer", amount: 2000 },
    ]);
    expect(s.sales).toHaveLength(1);
    expect(s.sales[0].total).toBe(total);
    expect(s.sales[0].method).toBe("mixed");
    expect(saleBalance(s, s.sales[0])).toBe(total - 3000);
    expect(s.orders[0].paymentStatus).toBe("partial");
    expect(s.orders[0].status).toBe("ready");
    expect(cashExpected(s, s.cash[0])).toBe(2000);
    expect(() =>
      run(s, { action: "deliverOrder", id: s.orders[0].id }),
    ).toThrow();
    s = run(
      s,
      {
        action: "sale.pay",
        id: s.sales[0].id,
        payments: [{ method: "card", amount: total - 3000 }],
      },
      "last",
    );
    expect(s.sales).toHaveLength(1);
    expect(saleBalance(s, s.sales[0])).toBe(0);
    expect(s.orders[0].status).toBe("paid");
    expect(() =>
      run(s, {
        action: "sale.pay",
        id: s.sales[0].id,
        payments: [{ method: "cash", amount: 1 }],
      }),
    ).toThrow("cobrada");
  });
  it("rejects overpayments, duplicate methods, invalid amounts and unauthorized roles", () => {
    const s = setup(),
      total = orderTotal(s.orders[0]);
    for (const amount of [-1, NaN, Infinity, 0, 0.001, total + 1])
      expect(() => charge(s, [{ method: "cash", amount }])).toThrow();
    expect(() =>
      charge(s, [
        { method: "cash", amount: 1 },
        { method: "cash", amount: 2 },
      ]),
    ).toThrow("sola línea");
    for (const role of ["technician", "customer"] as const)
      expect(() =>
        run(
          s,
          { action: "chargeOrder", id: s.orders[0].id, method: "cash" },
          "role",
          role,
        ),
      ).toThrow("rol");
    s.cash = [];
    expect(() => charge(s, [{ method: "cash", amount: 1 }])).toThrow("caja");
  });
  it("requires authorized discounts and tracks changes without changing quote snapshots", () => {
    const s = setup(),
      before = structuredClone(s.orders[0]),
      total = orderTotal(before);
    expect(() =>
      run(
        s,
        {
          action: "chargeOrder",
          id: before.id,
          discount: 100,
          discountReason: "Promoción",
          method: "cash",
        },
        "no",
        "cashier",
      ),
    ).toThrow("descuentos");
    expect(() =>
      charge(s, [{ method: "cash", amount: 100 }], {
        discount: 100,
        discountReason: " ",
      }),
    ).toThrow();
    let next = charge(s, [{ method: "cash", amount: 100 }], {
      discount: 100,
      discountReason: "Promoción autorizada",
    });
    expect(next.sales[0].total).toBe(total - 100);
    expect(next.sales[0].adjustments).toHaveLength(1);
    expect(next.orders[0].items).toEqual(before.items);
    next = run(next, {
      action: "sale.discount",
      id: next.sales[0].id,
      discount: 200,
      reason: "Ajuste autorizado",
    });
    expect(next.sales[0].adjustments).toHaveLength(2);
    expect(next.sales[0].total).toBe(total - 200);
    expect(() =>
      run(next, {
        action: "sale.discount",
        id: next.sales[0].id,
        discount: total,
        reason: "Cambio total",
      }),
    ).toThrow("revertí");
  });
  it("records refunds in the current cash session without rewriting closed cash or original payment", () => {
    let s = setup(),
      total = orderTotal(s.orders[0]);
    s = charge(s, [{ method: "cash", amount: total }]);
    const original = structuredClone(s.payments[0]);
    s = run(
      s,
      { action: "closeCash", id: "cash1", counted: total + 1000 },
      "close",
    );
    const closed = structuredClone(s.cash[0]);
    s = run(
      s,
      { action: "openCash", branchId: s.branches[0].id, opening: total + 1000 },
      "cash2",
    );
    expect(() =>
      run(
        s,
        {
          action: "payment.reverse",
          id: original.id,
          reason: "Error de medio",
        },
        "no",
        "cashier",
      ),
    ).toThrow("corregir");
    s = run(
      s,
      {
        action: "payment.reverse",
        id: original.id,
        reason: "Error al registrar medio",
      },
      "refund",
    );
    expect(s.payments[0]).toEqual(original);
    expect(s.cash[0]).toEqual(closed);
    expect(cashExpected(s, s.cash[1])).toBe(1000);
    expect(salePaid(s, s.sales[0])).toBe(0);
    expect(s.orders[0].status).toBe("ready");
    expect(() =>
      run(s, {
        action: "payment.reverse",
        id: original.id,
        reason: "Error repetido",
      }),
    ).toThrow("revertido");
    s = run(s, {
      action: "sale.pay",
      id: s.sales[0].id,
      payments: [{ method: "transfer", amount: total }],
    });
    expect(salePaid(s, s.sales[0])).toBe(total);
    expect(s.sales).toHaveLength(1);
  });
  it("links counter sales to the proper customer/vehicle and decrements stock once", () => {
    const s = setup(),
      p = s.products[0],
      price = p.price;
    let next = run(
      s,
      {
        action: "sale",
        branchId: p.branchId,
        customerId: "c1",
        vehicleId: "v1",
        items: [{ productId: p.id, quantity: 1 }],
        payments: [{ method: "cash", amount: Math.min(1, price) }],
      },
      "counter",
    );
    expect(next.sales[0]).toMatchObject({
      customerId: "c1",
      vehicleId: "v1",
      orderId: null,
    });
    expect(next.products[0].stock).toBe(p.stock - 1);
    next = run(next, {
      action: "sale.pay",
      id: "counter",
      payments: [{ method: "card", amount: price - 1 }],
    });
    expect(next.products[0].stock).toBe(p.stock - 1);
    expect(() =>
      run(s, {
        action: "sale",
        branchId: p.branchId,
        customerId: "c2",
        vehicleId: "v1",
        items: [{ productId: p.id, quantity: 1 }],
        payments: [],
      }),
    ).toThrow("pertenecer");
    expect(() =>
      run(s, {
        action: "sale",
        branchId: p.branchId,
        items: [{ productId: p.id, quantity: 1 }],
        payments: [],
      }),
    ).toThrow("cliente");
  });
  it("preserves historical full payments and uses payment dates for method reporting", () => {
    const s = setup();
    s.sales.push({
      id: "old",
      branchId: s.branches[0].id,
      customerId: null,
      orderId: null,
      date: new Date().toISOString(),
      method: "cash",
      total: 500,
      cost: 0,
      items: [],
    });
    expect(salePaid(s, s.sales[0])).toBe(500);
    expect(cashExpected(s, s.cash[0])).toBe(1500);
    const next = charge(s, [{ method: "transfer", amount: 100 }]);
    expect(
      collectedByMethod(next, "cash", today(), today(), s.branches[0].id),
    ).toBe(500);
    expect(
      collectedByMethod(next, "transfer", today(), today(), s.branches[0].id),
    ).toBe(100);
    expect(() =>
      run(next, { action: "sale.pay", id: "old", method: "cash" }),
    ).toThrow("anterior");
  });
  it("projects only own payments and hides correction reasons from customers", () => {
    let s = charge(setup(), [
      { method: "cash", amount: 100, reference: "Interna" },
    ]);
    s = run(s, {
      action: "payment.reverse",
      id: s.payments[0].id,
      reason: "Motivo reservado",
    });
    const out = projectState(s, {
      ...owner,
      role: "customer",
      customerId: "c1",
    });
    expect(out.payments).toHaveLength(2);
    expect(
      out.payments.every((p) => !p.reason && !p.actorName && !p.reference),
    ).toBe(true);
    expect(out.sales[0].adjustments).toEqual([]);
    expect(
      projectState(s, { ...owner, role: "customer", customerId: "c2" })
        .payments,
    ).toEqual([]);
  });
  it("settles zero-total services and cashier cannot forge adjustments", () => {
    const s = setup();
    s.orders[0].items = [];
    s.orders[0].labor = 0;
    const next = charge(s, []);
    expect(next.orders[0].status).toBe("paid");
    expect(next.payments).toEqual([]);
    const paid = charge(setup(), [{ method: "cash", amount: 100 }]);
    expect(() =>
      run(
        paid,
        {
          action: "sale.discount",
          id: paid.sales[0].id,
          discount: 10,
          reason: "Descuento",
        },
        "cashier",
        "cashier",
      ),
    ).toThrow("autorizar");
  });
});
