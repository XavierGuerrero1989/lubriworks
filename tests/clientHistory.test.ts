import { describe, it, expect } from "vitest";
import { demoState, demoAccess } from "../shared/demo";
import { projectState } from "../shared/model";
import { execute } from "../shared/engine";
import {
  customerHistory,
  historyDetail,
  historyStage,
  serviceDay,
} from "../shared/clientHistory";
const owner = demoAccess.member,
  client = { ...owner, role: "customer" as const, customerId: "c1" },
  now = "2026-10-09T15:00:00.000Z";
function fixture() {
  const s = demoState();
  s.orders[0].status = "ready";
  s.orders[0].workStatus = "ready";
  s.orders[0].finishedAt = now;
  return s;
}
describe("customer service history", () => {
  it("filters strictly by owner, vehicle, state, date and normalized service search", () => {
    const s = fixture();
    expect(
      customerHistory(s, client, { stage: "completed", search: "golf" }).map(
        (o) => o.id,
      ),
    ).toEqual(["ot1001"]);
    expect(customerHistory(s, client, { vehicle: "v2" })).toEqual([]);
    expect(customerHistory(s, client, { from: "2026-10-10" })).toEqual([]);
    expect(customerHistory(s, owner)).toEqual([]);
    expect(customerHistory(s, { ...client, active: false })).toEqual([]);
    s.orders[0].customerId = "c2";
    expect(customerHistory(s, client)).toEqual([]);
  });
  it("uses Argentina completion day, preserves legacy final services and separates cancellations", () => {
    const s = fixture(),
      o = s.orders[0];
    o.finishedAt = "2026-10-10T01:30:00.000Z";
    expect(serviceDay(o)).toBe("2026-10-09");
    delete o.finishedAt;
    delete o.workStatus;
    o.status = "paid";
    expect(historyStage(o)).toBe("completed");
    expect(serviceDay(o)).toBe(o.date);
    o.workStatus = "cancelled";
    expect(historyStage(o)).toBe("cancelled");
  });
  it("shows authorized additions and real billed quantities using original price snapshots", () => {
    const s = fixture(),
      o = s.orders[0];
    o.items = [
      {
        productId: "p1",
        name: "Aceite registrado",
        quantity: 4,
        price: 100,
        cost: 50,
      },
    ];
    o.labor = 200;
    o.additions = [
      {
        id: "add",
        title: "Filtro",
        createdAt: now,
        status: "approved",
        labor: 30,
        items: [
          { productId: "p2", name: "Filtro", quantity: 1, price: 50, cost: 20 },
        ],
      },
      {
        id: "rejected",
        title: "Extra rechazado",
        createdAt: now,
        status: "rejected",
        labor: 900,
        items: [],
      },
    ];
    o.actualItems = [
      { ...o.items[0], quantity: 3 },
      { ...o.additions[0].items[0] },
    ];
    o.consumptionConfirmed = true;
    const d = historyDetail(s, o);
    expect(d.items.map((i) => i.quantity)).toEqual([3, 1]);
    expect(d.labor).toBe(230);
    expect(d.technicalTotal).toBe(580);
    expect(d.realConsumptions).toBe(true);
  });
  it("uses the sale after discounts and the payment ledger for current balance", () => {
    const s = fixture(),
      o = s.orders[0];
    s.sales = [
      {
        id: "sale",
        customerId: "c1",
        orderId: o.id,
        branchId: "main",
        date: o.date,
        total: 500,
        cost: 0,
        discount: 80,
        subtotal: 580,
        billingVersion: 1,
        method: "mixed",
        items: [],
      },
    ];
    s.payments = [
      {
        id: "pay",
        saleId: "sale",
        customerId: "c1",
        branchId: "main",
        date: now,
        amount: 300,
        method: "cash",
        kind: "receipt",
        by: "staff",
        cashSessionId: "cash-test",
        actorName: "Staff",
        reason: "",
        reference: "",
      },
      {
        id: "refund",
        saleId: "sale",
        customerId: "c1",
        branchId: "main",
        date: now,
        amount: 100,
        method: "cash",
        kind: "refund",
        by: "staff",
        cashSessionId: "cash-test",
        actorName: "Staff",
        reason: "",
        reference: "",
      },
    ];
    const d = historyDetail(s, o);
    expect(d.total).toBe(500);
    expect(d.paid).toBe(200);
    expect(d.balance).toBe(300);
    s.sales[0].customerId = "c2";
    expect(historyDetail(s, o).sale).toBeUndefined();
  });
  it("does not claim consumption confirmed on legacy records, and clamps next care month-end dates", () => {
    const s = fixture(),
      o = s.orders[0];
    o.date = "2026-01-31";
    o.serviceSnapshots = [
      {
        serviceId: "s1",
        name: "Aceite",
        labor: 0,
        intervalKm: 10000,
        intervalMonths: 1,
      },
    ];
    const d = historyDetail(s, o);
    expect(d.realConsumptions).toBe(false);
    expect(d.nextCare).toEqual([
      { name: "Aceite", km: o.odometer + 10000, date: "2026-02-28" },
    ]);
  });
  it("publishes explicitly authored reports without exposing private notes or recommendations", () => {
    const s = fixture(),
      o = s.orders[0];
    o.notes = "Nota interna";
    o.recommendations = "Recomendación interna";
    o.customerSummary = "Aceite y filtro reemplazados";
    o.customerRecommendations = "Revisar neumáticos";
    const p = projectState(s, client).orders[0];
    expect(p.customerSummary).toBe(o.customerSummary);
    expect(p.customerRecommendations).toBe(o.customerRecommendations);
    expect(p.notes).toBe("");
    expect(p.recommendations).toBe("");
    expect(p.events).toEqual([]);
    expect(p.photos).toEqual([]);
    expect(p.items.every((i) => i.cost === 0)).toBe(true);
  });
  it("allows technical staff to publish an audited report even after delivery without changing financial or lifecycle fields", () => {
    const s = fixture();
    s.orders[0].deliveredAt = now;
    s.orders[0].workStatus = "delivered";
    const result = execute(
        s,
        owner,
        {
          action: "order.customerReport",
          id: s.orders[0].id,
          data: {
            customerSummary: " Trabajo realizado ",
            customerRecommendations: "Controlar niveles",
            labor: 0,
            status: "received",
            notes: "forged",
          },
        },
        "report",
        now,
      ),
      o = result.orders[0];
    expect(o.customerSummary).toBe("Trabajo realizado");
    expect(o.workStatus).toBe("delivered");
    expect(o.labor).toBe(s.orders[0].labor);
    expect(o.notes).toBe(s.orders[0].notes);
    expect(o.events?.at(-1)).toMatchObject({
      title: "Informe para cliente actualizado",
      by: owner.uid,
    });
  });
  it("denies customers, cashiers, cancelled orders and overlong reports; generic save cannot forge a report", () => {
    const s = fixture(),
      cmd = {
        action: "order.customerReport",
        id: s.orders[0].id,
        data: { customerSummary: "Resumen", customerRecommendations: "" },
      };
    expect(() => execute(s, client, cmd, "id", now)).toThrow("exclusiva");
    expect(() =>
      execute(s, { ...owner, role: "cashier" }, cmd, "id", now),
    ).toThrow("informe");
    s.orders[0].workStatus = "cancelled";
    expect(() => execute(s, owner, cmd, "id", now)).toThrow("cancelada");
    s.orders[0].workStatus = "ready";
    expect(() =>
      execute(
        s,
        owner,
        {
          ...cmd,
          data: {
            customerSummary: "a".repeat(1001),
            customerRecommendations: "",
          },
        },
        "id",
        now,
      ),
    ).toThrow();
    const initial = demoState(),
      o = initial.orders[0];
    o.customerSummary = "Publicado";
    const edited = execute(
      initial,
      owner,
      {
        action: "save",
        collection: "orders",
        id: o.id,
        data: { ...o, customerSummary: "forged" },
      },
      "save",
      now,
    );
    expect(edited.orders[0].customerSummary).toBe("Publicado");
  });
  it("keeps all historical records without a volume cap", () => {
    const s = fixture();
    s.orders = Array.from({ length: 2105 }, (_, i) => ({
      ...s.orders[0],
      id: `history-${i}`,
    }));
    expect(customerHistory(s, client, { stage: "completed" })).toHaveLength(
      2105,
    );
  });
});
