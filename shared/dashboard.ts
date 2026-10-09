import { workStage } from "./orders.js";
import { type Entity, type State } from "./model.js";
export const dashboardStages = [
  "received",
  "working",
  "waiting",
  "ready",
  "delivery",
] as const;
export type DashboardStage = (typeof dashboardStages)[number];
export type DashboardOrder = Entity<"orders">;
export function dashboardStage(order: DashboardOrder): DashboardStage | null {
  const stage = workStage(order);
  if (stage === "delivered" || stage === "cancelled") return null;
  if (stage === "ready" && order.status === "paid") return "delivery";
  return stage;
}
export function localDay(now: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}
export function elapsedMinutes(start: string | undefined, now: string) {
  if (!start) return null;
  const duration = Date.parse(now) - Date.parse(start);
  return Number.isFinite(duration)
    ? Math.max(0, Math.floor(duration / 60000))
    : null;
}
export function operationalBoard(state: State, branchId: string, now: string) {
  const day = localDay(now);
  const orders = state.orders
    .filter(
      (o) =>
        (branchId === "all" || o.branchId === branchId) &&
        dashboardStage(o) &&
        // Historic paid records have no reliable delivery information. Do not turn
        // every historic sale into a vehicle presumed to be in the workshop.
        (o.status !== "paid" ||
          !!o.receivedAt ||
          !!o.finishedAt ||
          o.date === day),
    )
    .sort(
      (a, b) =>
        (a.receivedAt || a.date).localeCompare(b.receivedAt || b.date) ||
        a.id.localeCompare(b.id),
    );
  const appointments = state.appointments
    .filter(
      (a) =>
        (branchId === "all" || a.branchId === branchId) &&
        a.date === day &&
        ["requested", "confirmed"].includes(a.status) &&
        !a.orderId &&
        !state.orders.some((o) => o.appointmentId === a.id),
    )
    .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  const groups = Object.fromEntries(
    dashboardStages.map((stage) => [
      stage,
      orders.filter((o) => dashboardStage(o) === stage),
    ]),
  ) as Record<DashboardStage, DashboardOrder[]>;
  return { day, orders, appointments, groups };
}
