import { round, type State, type Entity } from "./model.js";
import { approvedItems, type Order } from "./orders.js";
export type Product = Entity<"products">;
/** Authorized quantities remain reserved until the work is finished or cancelled. */
export function reservationItems(o: Order) {
  if (
    !["received", "working"].includes(o.status) ||
    o.deliveredAt ||
    ["cancelled", "delivered", "ready"].includes(o.workStatus ?? "")
  )
    return [];
  // Old work already in progress has no authorization record. Protect its inputs,
  // without inventing a customer approval or reserving old, unstarted quotes.
  const legacy = o.approval === undefined;
  if (o.approval === "approved" || (legacy && o.status === "working"))
    return approvedItems(o);
  return legacy
    ? (o.additions ?? [])
        .filter((a) => a.status === "approved")
        .flatMap((a) => a.items)
    : [];
}
export function reservations(s: State, productId: string, excludeOrderId = "") {
  return s.orders
    .filter((o) => o.id !== excludeOrderId)
    .flatMap((o) => {
      const quantity = round(
        reservationItems(o)
          .filter((i) => i.productId === productId)
          .reduce((n, i) => n + i.quantity, 0),
      );
      return quantity > 0
        ? [
            {
              orderId: o.id,
              vehicleId: o.vehicleId,
              customerId: o.customerId,
              branchId: o.branchId,
              quantity,
              legacy: o.approval === undefined,
            },
          ]
        : [];
    });
}
export const reservedStock = (
  s: State,
  productId: string,
  excludeOrderId = "",
) =>
  round(
    reservations(s, productId, excludeOrderId).reduce(
      (n, r) => n + r.quantity,
      0,
    ),
  );
export const availableStock = (s: State, p: Product, excludeOrderId = "") =>
  round(p.stock - reservedStock(s, p.id, excludeOrderId));
export function assertReservation(s: State, o: Order) {
  const amounts = new Map<string, number>();
  for (const i of reservationItems(o))
    amounts.set(
      i.productId,
      round((amounts.get(i.productId) ?? 0) + i.quantity),
    );
  for (const [pid, quantity] of amounts) {
    const p = s.products.find((p) => p.id === pid);
    if (!p || p.branchId !== o.branchId)
      throw new Error("Producto no encontrado en la sucursal de la orden.");
    const available = availableStock(s, p, o.id);
    if (quantity > available)
      throw new Error(
        `Stock disponible insuficiente: ${p.name}. Necesitás ${quantity}; disponible para esta orden ${available}. Reponé stock o revisá el presupuesto.`,
      );
  }
}
export const stockStatus = (s: State, p: Product) =>
  availableStock(s, p) < 0
    ? "shortage"
    : availableStock(s, p) === 0
      ? "empty"
      : availableStock(s, p) <= p.minStock
        ? "low"
        : "ok";
