import { z } from "zod";
import {
  canManage,
  key,
  round,
  schemas,
  today,
  type Entity,
  type State,
  type Member,
} from "./model.js";
import { availableStock } from "./inventory.js";
import { agendaActive } from "./agenda.js";
import type { Command } from "./engine.js";
export type Purchase = Entity<"purchases">;
const need = (v: unknown, msg: string) => {
  if (!v) throw new Error(msg);
};
export function receivedQuantity(p: Purchase, pid: string) {
  // Legacy completed purchases have no receipt history: preserve their full receipt.
  return p.status === "received" && !p.receipts?.length
    ? p.items
        .filter((i) => i.productId === pid)
        .reduce((n, i) => n + i.quantity, 0)
    : round(
        (p.receipts ?? [])
          .flatMap((r) => r.items)
          .filter((i) => i.productId === pid)
          .reduce((n, i) => n + i.quantity, 0),
      );
}
export const pendingQuantity = (p: Purchase, pid: string) =>
  p.status === "cancelled"
    ? 0
    : round(
        Math.max(
          0,
          p.items
            .filter((i) => i.productId === pid)
            .reduce((n, i) => n + i.quantity, 0) - receivedQuantity(p, pid),
        ),
      );
export function quantityValid(quantity: number, unit: string) {
  need(
    Number.isFinite(quantity) && quantity > 0,
    "La cantidad debe ser positiva.",
  );
  need(
    unit !== "unidad" || Number.isInteger(quantity),
    "Los productos por unidad requieren cantidades enteras.",
  );
  need(
    Math.abs(quantity * 100 - Math.round(quantity * 100)) < 0.00001,
    "Usá hasta dos decimales para litros.",
  );
}
export function validatePurchase(
  s: State,
  p: Pick<Purchase, "items" | "branchId">,
) {
  need(
    new Set(p.items.map((i) => i.productId)).size === p.items.length,
    "Cada producto debe aparecer una sola vez en la compra.",
  );
  for (const i of p.items) {
    const product = s.products.find((v) => v.id === i.productId);
    need(
      product && product.branchId === p.branchId,
      "Producto no encontrado en la sucursal de la compra.",
    );
    quantityValid(i.quantity, product!.unit);
    need(
      Math.abs(i.cost * 100 - Math.round(i.cost * 100)) < 0.00001,
      "El costo admite hasta dos decimales.",
    );
  }
}
export function purchaseOperations(
  s: State,
  member: Member,
  cmd: Command,
  id: string,
  now: string,
  useStock: (
    items: { productId: string; quantity: number }[],
    branchId: string,
    sign: number,
    reason: string,
  ) => void,
) {
  if (
    !["receivePurchase", "purchase.cancel", "purchase.plan"].includes(
      cmd.action,
    )
  )
    return false;
  need(
    canManage(member.role),
    "Sólo administración puede gestionar compras y previsiones.",
  );
  if (cmd.action === "purchase.plan") {
    const a = s.appointments.find((a) => a.id === cmd.id);
    need(
      a && agendaActive(a) && !a.orderId && a.date >= today(),
      "Planificá un turno futuro pendiente de recepción.",
    );
    const items = z
      .array(
        z.object({
          productId: key,
          quantity: z.number().positive().max(1e6),
        }),
      )
      .parse(cmd.items);
    need(
      new Set(items.map((i) => i.productId)).size === items.length,
      "No repitas productos en la previsión.",
    );
    for (const i of items) {
      const p = s.products.find((p) => p.id === i.productId);
      need(
        p && p.branchId === a!.branchId,
        "El insumo previsto debe pertenecer a la sucursal del turno.",
      );
      quantityValid(i.quantity, p!.unit);
    }
    a!.plannedItems = items;
    a!.planUpdatedAt = now;
    a!.planUpdatedBy = member.uid;
    return true;
  }
  const p = s.purchases.find((p) => p.id === cmd.id);
  need(p, "Compra no encontrada en esta empresa.");
  need(
    ["draft", "partial"].includes(p!.status),
    "La compra ya está recibida o cancelada.",
  );
  if (cmd.action === "purchase.cancel") {
    p!.cancelReason = z.string().trim().min(5).max(1000).parse(cmd.reason);
    p!.cancelledAt = now;
    p!.cancelledBy = member.uid;
    p!.status = "cancelled";
    return true;
  }
  // Old callers without explicit quantities receive only the remaining balance.
  const remaining = p!.items
    .map((i) => ({ ...i, quantity: pendingQuantity(p!, i.productId) }))
    .filter((i) => i.quantity > 0);
  const items = schemas.purchases.shape.items.parse(cmd.items ?? remaining);
  validatePurchase(s, { items, branchId: p!.branchId });
  for (const i of items) {
    need(
      p!.items.some((line) => line.productId === i.productId),
      "El producto no pertenece a esta compra.",
    );
    need(
      i.quantity <= pendingQuantity(p!, i.productId),
      "La recepción supera la cantidad pendiente de la compra.",
    );
  }
  const reference = z
    .string()
    .trim()
    .max(200)
    .parse(cmd.reference ?? "");
  const note = z
    .string()
    .trim()
    .max(1000)
    .parse(cmd.note ?? "");
  useStock(
    items,
    p!.branchId,
    1,
    `Recepción de compra ${p!.id}${reference ? " · " + reference : ""}`,
  );
  for (const i of items)
    s.products.find((product) => product.id === i.productId)!.cost = i.cost;
  (p!.receipts ??= []).push({
    id,
    at: now,
    by: member.uid,
    actorName: member.name,
    reference,
    note,
    items,
  });
  p!.status = p!.items.every((i) => pendingQuantity(p!, i.productId) === 0)
    ? "received"
    : "partial";
  return true;
}
export function replenishment(
  s: State,
  branch: string,
  end: string,
  start = today(),
) {
  const appointments = s.appointments.filter(
    (a) =>
      (branch === "all" || a.branchId === branch) &&
      agendaActive(a) &&
      !a.orderId &&
      a.date >= start &&
      a.date <= end,
  );
  const rows = s.products
    .filter((p) => branch === "all" || p.branchId === branch)
    .map((p) => {
      const turns = appointments.filter(
        (a) =>
          a.branchId === p.branchId &&
          a.plannedItems?.some((i) => i.productId === p.id),
      );
      const incoming = s.purchases.filter(
        (b) => b.branchId === p.branchId && pendingQuantity(b, p.id) > 0,
      );
      const demand = round(
        turns.reduce(
          (n, a) =>
            n +
            (a.plannedItems ?? [])
              .filter((i) => i.productId === p.id)
              .reduce((n, i) => n + i.quantity, 0),
          0,
        ),
      );
      const available = availableStock(s, p);
      const dated = incoming.filter(
        (b) =>
          b.expectedDate && b.expectedDate >= start && b.expectedDate <= end,
      );
      const days = [
        ...new Set([
          start,
          ...turns.map((a) => a.date),
          ...dated.map((b) => b.expectedDate!),
        ]),
      ].sort();
      let suggested = 0,
        firstNeed = "";
      for (const day of days) {
        const used = turns
          .filter((a) => a.date <= day)
          .reduce(
            (n, a) =>
              n +
              (a.plannedItems ?? [])
                .filter((i) => i.productId === p.id)
                .reduce((n, i) => n + i.quantity, 0),
            0,
          );
        const arriving = dated
          .filter((b) => b.expectedDate! <= day)
          .reduce((n, b) => n + pendingQuantity(b, p.id), 0);
        const short = round(p.minStock + used - available - arriving);
        if (short > suggested) suggested = short;
        if (short > 0 && !firstNeed) firstNeed = day;
      }
      if (p.unit === "unidad") suggested = Math.ceil(suggested);
      return {
        product: p,
        available,
        demand,
        incoming: round(
          incoming.reduce((n, b) => n + pendingQuantity(b, p.id), 0),
        ),
        datedIncoming: round(
          dated.reduce((n, b) => n + pendingQuantity(b, p.id), 0),
        ),
        suggested: Math.max(0, suggested),
        firstNeed,
        turns,
      };
    });
  return {
    rows,
    appointments,
    unplanned: appointments.filter((a) => !a.plannedItems?.length),
  };
}
