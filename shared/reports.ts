import { date, round, type State, type Sale, type Payment } from "./model.js";
import { paymentValue } from "./billing.js";
import type { Order } from "./orders.js";

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function reportDay(value: string | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return date.safeParse(value).success ? value : "";
  return Number.isFinite(Date.parse(value))
    ? businessDateFormatter.format(new Date(value))
    : "";
}
export const finishedDay = (o: Order) =>
  reportDay(o.finishedAt) ||
  (["ready", "paid"].includes(o.status) && o.workStatus !== "cancelled"
    ? o.date
    : "");
export function durationMinutes(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms / 60000 : null;
}
export function timeSummary(values: (number | null)[]) {
  const valid = values
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  return {
    samples: valid.length,
    average: valid.length
      ? round(valid.reduce((n, v) => n + v, 0) / valid.length)
      : null,
    median: valid.length
      ? round(
          valid.length % 2
            ? valid[Math.floor(valid.length / 2)]
            : (valid[valid.length / 2 - 1] + valid[valid.length / 2]) / 2,
        )
      : null,
  };
}
export function saleTotalAt(sale: Sale, end: string) {
  const later = (sale.adjustments ?? [])
    .filter((a) => reportDay(a.date) > end)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  return later.length
    ? round(
        (sale.subtotal ?? sale.total + (sale.discount ?? 0)) -
          later[0].beforeDiscount,
      )
    : sale.total;
}
export function periodBefore(from: string, to: string) {
  const start = Date.parse(from + "T12:00:00Z"),
    end = Date.parse(to + "T12:00:00Z"),
    span = Math.round((end - start) / 864e5) + 1;
  return {
    from: new Date(start - span * 864e5).toISOString().slice(0, 10),
    to: new Date(start - 864e5).toISOString().slice(0, 10),
  };
}
export function reports(s: State, branch: string, from: string, to: string) {
  date.parse(from);
  date.parse(to);
  if (from > to)
    throw new Error("La fecha Desde debe ser anterior o igual a Hasta.");
  const scoped = (r: { branchId: string }) =>
    branch === "all" || r.branchId === branch;
  const inside = (day: string) => !!day && day >= from && day <= to;
  const sales = s.sales.filter(scoped),
    orders = s.orders.filter(scoped),
    appointments = s.appointments.filter((a) => scoped(a) && inside(a.date));
  const amounts = new Map<string, number>();
  for (const p of s.payments)
    if (scoped(p) && reportDay(p.date) && reportDay(p.date) <= to)
      amounts.set(
        p.saleId,
        round((amounts.get(p.saleId) ?? 0) + paymentValue(p)),
      );
  const periodSales = sales.filter((v) => inside(reportDay(v.date)));
  const ledger = s.payments.filter(
    (p) => scoped(p) && inside(reportDay(p.date)),
  );
  const legacySales = sales.filter(
    (v) => !v.billingVersion && inside(reportDay(v.date)),
  );
  const methods: Record<Payment["method"], number> = {
    cash: 0,
    transfer: 0,
    card: 0,
  };
  for (const p of ledger)
    methods[p.method] = round(methods[p.method] + paymentValue(p));
  for (const v of legacySales)
    if (v.method !== "mixed")
      methods[v.method] = round(methods[v.method] + v.total);
  const unclassifiedLegacy = round(
    legacySales
      .filter((v) => v.method === "mixed")
      .reduce((n, v) => n + v.total, 0),
  );
  const total = round(periodSales.reduce((n, v) => n + saleTotalAt(v, to), 0)),
    cost = round(periodSales.reduce((n, v) => n + v.cost, 0));
  const collected = round(
    ledger.reduce((n, p) => n + paymentValue(p), 0) +
      legacySales.reduce((n, v) => n + v.total, 0),
  );
  const debt = sales
    .filter((v) => reportDay(v.date) && reportDay(v.date) <= to)
    .map((v) => ({
      sale: v,
      total: saleTotalAt(v, to),
      paid: v.billingVersion ? (amounts.get(v.id) ?? 0) : v.total,
    }))
    .map((v) => ({ ...v, balance: round(Math.max(0, v.total - v.paid)) }))
    .filter((v) => v.balance > 0)
    .sort((a, b) => b.balance - a.balance);
  const received = orders.filter((o) =>
    inside(reportDay(o.receivedAt) || o.date),
  );
  const finished = orders.filter(
    (o) => o.workStatus !== "cancelled" && inside(finishedDay(o)),
  );
  const delivered = orders.filter(
    (o) => o.workStatus !== "cancelled" && inside(reportDay(o.deliveredAt)),
  );
  const waiting = timeSummary(
      finished.map((o) => durationMinutes(o.receivedAt, o.startedAt)),
    ),
    work = timeSummary(
      finished.map((o) => durationMinutes(o.startedAt, o.finishedAt)),
    ),
    delivery = timeSummary(
      delivered.map((o) => durationMinutes(o.finishedAt, o.deliveredAt)),
    ),
    stay = timeSummary(
      delivered.map((o) => durationMinutes(o.receivedAt, o.deliveredAt)),
    );
  const services = new Map<
    string,
    { id: string; name: string; count: number }
  >();
  for (const o of finished) {
    const entries = o.serviceSnapshots?.length
      ? o.serviceSnapshots
      : [
          {
            serviceId: o.serviceId,
            name:
              o.serviceName ||
              s.services.find((v) => v.id === o.serviceId)?.name ||
              o.serviceId,
          },
        ];
    for (const v of entries) {
      const entry = services.get(v.serviceId) ?? {
        id: v.serviceId,
        name: v.name,
        count: 0,
      };
      entry.count++;
      services.set(v.serviceId, entry);
    }
  }
  const technicians = [
    ...new Set(finished.map((o) => o.technician?.trim() || "Sin asignar")),
  ]
    .map((name) => {
      const jobs = finished.filter(
        (o) => (o.technician?.trim() || "Sin asignar") === name,
      );
      return {
        name,
        count: jobs.length,
        work: timeSummary(
          jobs.map((o) => durationMinutes(o.startedAt, o.finishedAt)),
        ),
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const customers = new Set(finished.map((o) => o.customerId)),
    priorCustomers = new Set(
      s.orders
        .filter(
          (o) =>
            o.workStatus !== "cancelled" &&
            finishedDay(o) &&
            finishedDay(o) < from,
        )
        .map((o) => o.customerId),
    );
  const returning = [...customers].filter((id) =>
    priorCustomers.has(id),
  ).length;
  const approved = received.filter((o) => o.approval === "approved").length,
    rejected = received.filter((o) => o.approval === "rejected").length;
  const linkedAppointments = new Set(
    orders.map((o) => o.appointmentId).filter(Boolean),
  );
  const attended = appointments.filter(
    (a) => a.receivedAt || a.orderId || linkedAppointments.has(a.id),
  ).length;
  const absence = appointments.filter((a) => a.status === "no_show").length,
    cancelled = appointments.filter((a) => a.status === "cancelled").length;
  const pendingAppointments = appointments.filter(
    (a) =>
      ["requested", "confirmed"].includes(a.status) &&
      !a.orderId &&
      !a.receivedAt &&
      !linkedAppointments.has(a.id),
  ).length;
  const branchIds = branch === "all" ? s.branches.map((b) => b.id) : [branch];
  const branches = branchIds.map((id) => ({
    id,
    name: s.branches.find((b) => b.id === id)?.name ?? id,
    sales: periodSales.filter((v) => v.branchId === id).length,
    total: round(
      periodSales
        .filter((v) => v.branchId === id)
        .reduce((n, v) => n + saleTotalAt(v, to), 0),
    ),
    collected: round(
      ledger
        .filter((p) => p.branchId === id)
        .reduce((n, p) => n + paymentValue(p), 0) +
        legacySales
          .filter((v) => v.branchId === id)
          .reduce((n, v) => n + v.total, 0),
    ),
    finished: finished.filter((o) => o.branchId === id).length,
    delivered: delivered.filter((o) => o.branchId === id).length,
  }));
  const long = (Date.parse(to) - Date.parse(from)) / 864e5 > 62;
  const buckets = new Map<
    string,
    {
      date: string;
      sales: number;
      total: number;
      collected: number;
      finished: number;
    }
  >();
  const bucket = (day: string) => {
    const key = long ? day.slice(0, 7) : day;
    if (!buckets.has(key))
      buckets.set(key, {
        date: key,
        sales: 0,
        total: 0,
        collected: 0,
        finished: 0,
      });
    return buckets.get(key)!;
  };
  for (const v of periodSales) {
    const b = bucket(reportDay(v.date));
    b.sales++;
    b.total = round(b.total + saleTotalAt(v, to));
  }
  for (const p of ledger) {
    const b = bucket(reportDay(p.date));
    b.collected = round(b.collected + paymentValue(p));
  }
  for (const v of legacySales) {
    const b = bucket(reportDay(v.date));
    b.collected = round(b.collected + v.total);
  }
  for (const o of finished) bucket(finishedDay(o)).finished++;
  return {
    from,
    to,
    total,
    cost,
    margin: round(total - cost),
    ticket: periodSales.length ? round(total / periodSales.length) : 0,
    collected,
    methods,
    unclassifiedLegacy,
    debt,
    debtTotal: round(debt.reduce((n, v) => n + v.balance, 0)),
    periodSales,
    ledger,
    received,
    finished,
    delivered,
    waiting,
    work,
    delivery,
    stay,
    services: [...services.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    ),
    technicians,
    customers: customers.size,
    returning,
    approved,
    rejected,
    attended,
    absence,
    cancelled,
    pendingAppointments,
    appointments: appointments.length,
    branches,
    trend: [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date)),
    trendMonthly: long,
    legacyFinished: finished.filter((o) => !o.finishedAt).length,
    legacyCollections: legacySales.length,
  };
}
