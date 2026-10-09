import { round, type Entity } from "./model.js";
export type Order = Entity<"orders">;
export type OrderItem = Order["items"][number];
export const hasPendingAddition = (o: Order) =>
  !!o.additions?.some((a) => a.status === "pending");
export function workStage(o: Order): NonNullable<Order["workStatus"]> {
  if (o.deliveredAt) return "delivered";
  if (o.workStatus === "cancelled") return "cancelled";
  if (
    ["pending", "rejected"].includes(o.approval ?? "") ||
    hasPendingAddition(o)
  )
    return "waiting";
  return o.workStatus ?? (o.status === "paid" ? "ready" : o.status);
}
export const paid = (o: Order) => o.status === "paid";
export const approvedItems = (o: Order) => [
  ...o.items,
  ...(o.additions ?? [])
    .filter((a) => a.status === "approved")
    .flatMap((a) => a.items),
];
export const approvedLabor = (o: Order) =>
  round(
    o.labor +
      (o.additions ?? [])
        .filter((a) => a.status === "approved")
        .reduce((n, a) => n + a.labor, 0),
  );
export const quoteTotal = (o: Order) =>
  round(
    approvedLabor(o) +
      approvedItems(o).reduce((n, i) => n + i.quantity * i.price, 0),
  );
/** Allocate real quantities to the authorized price snapshots, in quote order. */
export function billingItems(o: Order): OrderItem[] {
  const quoted = approvedItems(o);
  if (!o.consumptionConfirmed || !o.actualItems) return quoted;
  const remaining = new Map(
    o.actualItems.map((i) => [i.productId, i.quantity]),
  );
  return quoted.flatMap((i) => {
    const quantity = Math.min(i.quantity, remaining.get(i.productId) ?? 0);
    remaining.set(
      i.productId,
      round((remaining.get(i.productId) ?? 0) - quantity),
    );
    return quantity > 0 ? [{ ...i, quantity }] : [];
  });
}
export const consumedItems = (o: Order) =>
  o.consumptionConfirmed && o.actualItems ? o.actualItems : approvedItems(o);
export const orderTotal = (o: Order) =>
  round(
    approvedLabor(o) +
      billingItems(o).reduce((n, i) => n + i.quantity * i.price, 0),
  );
export function orderEvent(
  o: Order,
  id: string,
  title: string,
  by: string,
  at: string,
  note = "",
  actorName = "",
) {
  (o.events ??= []).push({ id, title, by, at, note, actorName });
}
