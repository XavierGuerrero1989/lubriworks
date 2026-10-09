import { localDay } from "./dashboard.js";
import type { Member, State } from "./model.js";
import {
  billingItems,
  approvedLabor,
  orderTotal,
  type Order,
} from "./orders.js";
import { saleBalance, salePaid } from "./billing.js";
export const historyStage = (o: Order) =>
  o.workStatus === "cancelled"
    ? "cancelled"
    : o.deliveredAt || o.finishedAt || ["ready", "paid"].includes(o.status)
      ? "completed"
      : "active";
export const serviceDay = (o: Order) =>
  o.finishedAt || o.deliveredAt
    ? localDay(o.finishedAt ?? o.deliveredAt!)
    : o.date;
export function customerHistory(
  s: State,
  m: Member,
  filter: {
    vehicle?: string;
    stage?: string;
    from?: string;
    to?: string;
    search?: string;
  } = {},
) {
  const normalize = (v: string) =>
    v
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  return s.orders
    .filter(
      (o) =>
        m.active &&
        m.role === "customer" &&
        o.customerId === m.customerId &&
        s.vehicles.some(
          (v) => v.id === o.vehicleId && v.customerId === m.customerId,
        ),
    )
    .filter(
      (o) =>
        (!filter.vehicle ||
          filter.vehicle === "all" ||
          o.vehicleId === filter.vehicle) &&
        (!filter.stage ||
          filter.stage === "all" ||
          historyStage(o) === filter.stage) &&
        (!filter.from || serviceDay(o) >= filter.from) &&
        (!filter.to || serviceDay(o) <= filter.to),
    )
    .filter((o) => {
      const v = s.vehicles.find((v) => v.id === o.vehicleId);
      return normalize(
        `${v?.plate} ${v?.brand} ${v?.model} ${o.serviceName ?? ""} ${o.serviceSnapshots?.map((s) => s.name).join(" ") ?? ""}`,
      ).includes(normalize(filter.search ?? ""));
    })
    .sort(
      (a, b) =>
        serviceDay(b).localeCompare(serviceDay(a)) || b.id.localeCompare(a.id),
    );
}
export function historyDetail(s: State, o: Order) {
  const sale = s.sales.find(
      (v) => v.orderId === o.id && v.customerId === o.customerId,
    ),
    complete = historyStage(o) === "completed";
  return {
    items: billingItems(o),
    labor: approvedLabor(o),
    technicalTotal: orderTotal(o),
    sale,
    total: sale?.total ?? orderTotal(o),
    paid: sale ? salePaid(s, sale) : o.status === "paid" ? orderTotal(o) : 0,
    balance: sale
      ? saleBalance(s, sale)
      : o.status === "paid"
        ? 0
        : orderTotal(o),
    complete,
    realConsumptions: complete && o.consumptionConfirmed === true,
    nextCare: (
      o.serviceSnapshots ?? [
        {
          serviceId: o.serviceId,
          name: o.serviceName ?? "Servicio",
          intervalKm: o.intervalKm,
          intervalMonths: o.intervalMonths,
        },
      ]
    )
      .filter((v) => v.intervalKm || v.intervalMonths)
      .map((v) => ({
        name: v.name,
        km: v.intervalKm ? o.odometer + v.intervalKm : null,
        date: v.intervalMonths ? nextServiceDate(o.date, v.intervalMonths) : "",
      })),
  };
}

function nextServiceDate(date: string, months: number) {
  const d = new Date(date + "T12:00:00Z"),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(
    Math.min(
      day,
      new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  return d.toISOString().slice(0, 10);
}
