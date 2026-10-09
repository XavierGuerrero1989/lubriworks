import { describe, it, expect } from "vitest";
import {
  reports,
  reportDay,
  periodBefore,
  saleTotalAt,
  durationMinutes,
} from "../shared/reports";
import { demoState } from "../shared/demo";
import { emptyState, type Sale, type Payment } from "../shared/model";
const sale = (
  id: string,
  date: string,
  total = 100,
  branchId = "main",
): Sale => ({
  id,
  date,
  total,
  cost: 30,
  branchId,
  customerId: "c1",
  orderId: null,
  method: "mixed",
  billingVersion: 1,
  subtotal: total,
  discount: 0,
  items: [],
});
const payment = (
  id: string,
  saleId: string,
  date: string,
  amount: number,
  kind: Payment["kind"] = "receipt",
  branchId = "main",
): Payment => ({
  id,
  saleId,
  date,
  amount,
  kind,
  branchId,
  customerId: "c1",
  cashSessionId: "cash",
  by: "owner",
  actorName: "Admin",
  reason: "",
  reference: "",
  method: "cash",
});
describe("reports by business date and recorded lifecycle", () => {
  it("separates sale date from payment date, counts reversions and computes balances as of the selected end", () => {
    const s = emptyState();
    s.branches = demoState().branches;
    s.sales = [
      sale("prior", "2026-09-30T15:00:00Z"),
      sale("new", "2026-10-01T15:00:00Z"),
    ];
    s.payments = [
      payment("prior-pay", "prior", "2026-10-02T15:00:00Z", 100),
      payment("part", "new", "2026-10-01T15:00:00Z", 40),
      payment("reverse", "new", "2026-10-02T15:00:00Z", 40, "refund"),
      payment("future", "new", "2026-10-05T15:00:00Z", 100),
    ];
    const r = reports(s, "main", "2026-10-01", "2026-10-02");
    expect(r.total).toBe(100);
    expect(r.periodSales).toHaveLength(1);
    expect(r.collected).toBe(100);
    expect(r.methods.cash).toBe(100);
    expect(r.debtTotal).toBe(100);
    expect(r.debt[0].sale.id).toBe("new");
    expect(reports(s, "main", "2026-10-05", "2026-10-05").total).toBe(0);
    expect(reports(s, "main", "2026-10-05", "2026-10-05").collected).toBe(100);
  });
  it("uses Argentina days at UTC midnight and keeps date-only historical records stable", () => {
    expect(reportDay("2026-10-02T01:00:00Z")).toBe("2026-10-01");
    expect(reportDay("2026-10-02")).toBe("2026-10-02");
    expect(reportDay("bad")).toBe("");
    const s = emptyState();
    s.sales = [
      {
        ...sale("legacy", "2026-10-02T01:00:00Z"),
        billingVersion: undefined,
        method: "cash",
      },
    ];
    expect(reports(s, "all", "2026-10-01", "2026-10-01").total).toBe(100);
    expect(reports(s, "all", "2026-10-02", "2026-10-02").total).toBe(0);
  });
  it("reconstructs totals before later discounts without moving payment reversions backwards", () => {
    const v = {
      ...sale("s", "2026-10-01"),
      total: 70,
      discount: 30,
      adjustments: [
        {
          id: "a",
          date: "2026-10-05T15:00:00Z",
          by: "owner",
          actorName: "Admin",
          reason: "Corrección",
          beforeDiscount: 10,
          discount: 30,
        },
      ],
    };
    expect(saleTotalAt(v, "2026-10-02")).toBe(90);
    expect(saleTotalAt(v, "2026-10-05")).toBe(70);
  });
  it("counts every service snapshot and uses only recorded completed durations, with a separate delivery cohort", () => {
    const s = demoState(),
      base = s.orders[0];
    s.orders = [
      {
        ...base,
        id: "done",
        status: "ready",
        workStatus: "ready",
        date: "2026-09-30",
        receivedAt: "2026-10-01T12:00:00Z",
        startedAt: "2026-10-01T12:10:00Z",
        finishedAt: "2026-10-01T13:00:00Z",
        deliveredAt: "2026-10-02T13:30:00Z",
        serviceSnapshots: [
          {
            serviceId: "s1",
            name: "Aceite variante histórica",
            labor: 10,
            intervalKm: 1000,
            intervalMonths: 6,
          },
          {
            serviceId: "s2",
            name: "Filtro",
            labor: 10,
            intervalKm: 1000,
            intervalMonths: 6,
          },
        ],
      },
      { ...base, id: "old", status: "paid", date: "2026-10-01" },
      {
        ...base,
        id: "cancelled",
        workStatus: "cancelled",
        status: "ready",
        date: "2026-10-01",
      },
    ];
    const r = reports(s, "main", "2026-10-01", "2026-10-01");
    expect(r.finished).toHaveLength(2);
    expect(r.services.find((v) => v.id === "s2")?.count).toBe(1);
    expect(r.waiting).toMatchObject({ average: 10, samples: 1 });
    expect(r.work).toMatchObject({ average: 50, samples: 1 });
    expect(r.delivery.samples).toBe(0);
    expect(r.legacyFinished).toBe(1);
    const delivery = reports(s, "main", "2026-10-02", "2026-10-02");
    expect(delivery.finished).toHaveLength(0);
    expect(delivery.delivered).toHaveLength(1);
    expect(delivery.delivery.average).toBe(1470);
    expect(
      durationMinutes("2026-10-02T12:00:00Z", "2026-10-01T12:00:00Z"),
    ).toBeNull();
  });
  it("isolates branch results and includes legacy collections once without fabricating split payments", () => {
    const s = emptyState();
    s.branches = demoState().branches;
    s.sales = [
      {
        ...sale("main", "2026-10-01", 100, "main"),
        billingVersion: undefined,
        method: "mixed",
      },
      sale("north", "2026-10-01", 200, "north"),
    ];
    s.payments = [
      payment("n", "north", "2026-10-01T15:00:00Z", 50, "receipt", "north"),
    ];
    const all = reports(s, "all", "2026-10-01", "2026-10-01");
    expect(all.total).toBe(300);
    expect(all.collected).toBe(150);
    expect(all.unclassifiedLegacy).toBe(100);
    expect(all.debtTotal).toBe(150);
    const main = reports(s, "main", "2026-10-01", "2026-10-01");
    expect(main.total).toBe(100);
    expect(main.collected).toBe(100);
    expect(main.debtTotal).toBe(0);
    expect(main.branches).toHaveLength(1);
  });
  it("counts prior customer visits across the same company and does not infer absent or approved states", () => {
    const s = demoState(),
      base = s.orders[0];
    s.orders = [
      { ...base, id: "prior", date: "2026-09-30", status: "paid" },
      { ...base, id: "current", date: "2026-10-01", status: "paid" },
    ];
    s.appointments = s.appointments.map((a, i) => ({
      ...a,
      date: "2026-10-01",
      status: i === 0 ? "no_show" : "confirmed",
      orderId: undefined,
      receivedAt: undefined,
    }));
    const r = reports(s, "main", "2026-10-01", "2026-10-01");
    expect(r.customers).toBe(1);
    expect(r.returning).toBe(1);
    expect(r.approved).toBe(0);
    expect(r.absence).toBe(1);
    expect(r.pendingAppointments).toBe(2);
  });
  it("compares equal-length previous periods, rejects invalid ranges and handles empty history honestly", () => {
    expect(periodBefore("2026-03-01", "2026-03-03")).toEqual({
      from: "2026-02-26",
      to: "2026-02-28",
    });
    expect(() =>
      reports(emptyState(), "all", "2026-10-03", "2026-10-01"),
    ).toThrow();
    const r = reports(emptyState(), "all", "2026-10-01", "2026-10-01");
    expect(r.work.average).toBeNull();
    expect(r.ticket).toBe(0);
    expect(r.trend).toEqual([]);
  });
  it("includes more than 2000 sales without truncation and aggregates long periods by month", () => {
    const s = emptyState();
    s.sales = Array.from({ length: 2105 }, (_, i) =>
      sale(`s${i}`, "2026-10-01"),
    );
    const r = reports(s, "all", "2026-01-01", "2026-12-31");
    expect(r.periodSales).toHaveLength(2105);
    expect(r.total).toBe(210500);
    expect(r.debt).toHaveLength(2105);
    expect(r.trendMonthly).toBe(true);
    expect(r.trend[0].date).toBe("2026-10");
  });
});
