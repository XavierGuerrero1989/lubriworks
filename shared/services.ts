import type { Entity, State } from "./model.js";
export type Service = Entity<"services">;
export const serviceLabel = (v: Pick<Service, "name" | "variant">) =>
  `${v.name}${v.variant ? " · " + v.variant : ""}`.slice(0, 120);
export function serviceBranch(s: State, v: Service) {
  return (
    v.branchId ||
    s.products.find((p) => p.id === v.items[0]?.productId)?.branchId ||
    ""
  );
}
export const serviceAvailable = (s: State, v: Service, branchId: string) =>
  v.active !== false &&
  (!serviceBranch(s, v) || serviceBranch(s, v) === branchId) &&
  v.items.every((i) =>
    s.products.some((p) => p.id === i.productId && p.branchId === branchId),
  );
export function validateService(s: State, v: Service) {
  const branches = new Set(
    v.items.map((i) => s.products.find((p) => p.id === i.productId)?.branchId),
  );
  if (
    branches.has(undefined) ||
    branches.size > 1 ||
    (v.branchId &&
      v.items.some(
        (i) =>
          s.products.find((p) => p.id === i.productId)?.branchId !== v.branchId,
      ))
  )
    throw new Error(
      "Todos los insumos del servicio deben pertenecer a su sucursal.",
    );
  if (new Set(v.items.map((i) => i.productId)).size !== v.items.length)
    throw new Error("No repitas productos en el servicio.");
  for (const i of v.items) {
    const p = s.products.find((p) => p.id === i.productId)!;
    if (p.unit === "unidad" && !Number.isInteger(i.quantity))
      throw new Error("Los productos por unidad requieren cantidades enteras.");
    if (Math.abs(i.quantity * 100 - Math.round(i.quantity * 100)) > 0.00001)
      throw new Error("Usá hasta dos decimales para litros.");
  }
  if (Math.abs(v.labor * 100 - Math.round(v.labor * 100)) > 0.00001)
    throw new Error("La mano de obra admite hasta dos decimales.");
}
