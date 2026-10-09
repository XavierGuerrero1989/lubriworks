import { z } from "zod";
import {
  canCharge,
  canManage,
  key,
  round,
  type State,
  type Sale,
  type Member,
  type Payment,
} from "./model.js";
import {
  orderTotal,
  billingItems,
  approvedLabor,
  consumedItems,
  orderEvent,
} from "./orders.js";
import type { Command } from "./engine.js";
export const paymentMethods = ["cash", "transfer", "card"] as const;
export const paymentValue = (p: Payment) =>
  p.kind === "refund" ? -p.amount : p.amount;
export function salePaid(s: State, sale: Sale) {
  return sale.billingVersion
    ? round(
        s.payments
          .filter((p) => p.saleId === sale.id)
          .reduce((n, p) => n + paymentValue(p), 0),
      )
    : sale.total;
}
export const saleBalance = (s: State, sale: Sale) =>
  round(sale.total - salePaid(s, sale));
export function orderBalance(s: State, o: State["orders"][number]) {
  const sale = s.sales.find((v) => v.orderId === o.id);
  return sale ? saleBalance(s, sale) : o.status === "paid" ? 0 : orderTotal(o);
}
export const paymentLabel = (o: State["orders"][number]) =>
  o.paymentStatus === "partial"
    ? "partial"
    : o.status === "paid"
      ? "paid"
      : "unpaid";
export function cashExpected(s: State, c: State["cash"][number]) {
  return round(
    c.opening +
      s.payments
        .filter((p) => p.cashSessionId === c.id && p.method === "cash")
        .reduce((n, p) => n + paymentValue(p), 0) +
      s.sales
        .filter(
          (v) =>
            !v.billingVersion &&
            v.branchId === c.branchId &&
            v.date >= c.openedAt &&
            (!c.closedAt || v.date <= c.closedAt) &&
            v.method === "cash",
        )
        .reduce((n, v) => n + v.total, 0),
  );
}
export function collectedByMethod(
  s: State,
  method: Payment["method"],
  from: string,
  to: string,
  branchId = "all",
) {
  const matches = (r: { date: string; branchId: string }) =>
    r.date.slice(0, 10) >= from &&
    r.date.slice(0, 10) <= to &&
    (branchId === "all" || r.branchId === branchId);
  return round(
    s.payments
      .filter((p) => p.method === method && matches(p))
      .reduce((n, p) => n + paymentValue(p), 0) +
      s.sales
        .filter((v) => !v.billingVersion && v.method === method && matches(v))
        .reduce((n, v) => n + v.total, 0),
  );
}
const amountSchema = z
  .number()
  .finite()
  .min(0)
  .max(1e10)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.0001,
    "Usá como máximo dos decimales.",
  );
const reasonSchema = z
  .string()
  .trim()
  .min(5, "Registrá un motivo de al menos 5 caracteres.")
  .max(500);
function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function get<T extends { id: string }>(rows: T[], id: unknown, label: string) {
  const r = rows.find((r) => r.id === id);
  ensure(r, `${label} no encontrado en esta empresa.`);
  return r;
}
function syncOrder(
  s: State,
  sale: Sale,
  id: string,
  m: Member,
  now: string,
  title: string,
  note: string,
) {
  if (!sale.orderId) return;
  const o = get(s.orders, sale.orderId, "Orden"),
    balance = saleBalance(s, sale),
    received = salePaid(s, sale);
  o.status = balance === 0 ? "paid" : "ready";
  o.paymentStatus =
    balance === 0 ? "paid" : received > 0 ? "partial" : "unpaid";
  orderEvent(o, id, title, m.uid, now, note, m.name);
}
export function billingOperations(
  s: State,
  m: Member,
  c: Command,
  id: string,
  now: string,
  useStock: (
    items: { productId: string; quantity: number }[],
    branchId: string,
    sign: number,
    reason: string,
  ) => void,
): boolean {
  if (
    ![
      "chargeOrder",
      "sale",
      "sale.pay",
      "sale.discount",
      "payment.reverse",
    ].includes(c.action)
  )
    return false;
  ensure(canCharge(m.role), "Tu rol no permite cobrar.");
  if (c.action === "payment.reverse") {
    ensure(
      canManage(m.role),
      "Sólo administración o encargado puede corregir cobros.",
    );
    const p = get(s.payments, c.id, "Pago");
    ensure(
      p.kind === "receipt" && !s.payments.some((r) => r.reversesId === p.id),
      "El pago ya fue revertido o no admite corrección.",
    );
    const sale = get(s.sales, p.saleId, "Venta"),
      reason = reasonSchema.parse(c.reason);
    const cash = s.cash.find((r) => r.branchId === p.branchId && !r.closedAt);
    ensure(cash, "Abrí la caja de esta sucursal antes de corregir el cobro.");
    s.payments.push({
      ...p,
      id,
      saleId: sale.id,
      kind: "refund",
      cashSessionId: cash.id,
      date: now,
      by: m.uid,
      actorName: m.name,
      reason,
      reference: "",
      reversesId: p.id,
    });
    syncOrder(s, sale, id, m, now, "Cobro revertido", `${p.amount}: ${reason}`);
    return true;
  }
  if (c.action === "sale.discount") {
    ensure(
      canManage(m.role),
      "Sólo administración o encargado puede autorizar descuentos.",
    );
    const sale = get(s.sales, c.id, "Venta");
    ensure(
      sale.billingVersion,
      "Los comprobantes anteriores conservan sus importes históricos.",
    );
    const discount = amountSchema.parse(c.discount),
      reason = reasonSchema.parse(c.reason),
      subtotal = sale.subtotal ?? sale.total;
    ensure(discount <= subtotal, "El descuento supera el subtotal.");
    ensure(discount !== (sale.discount ?? 0), "El descuento debe cambiar.");
    const total = round(subtotal - discount);
    ensure(
      salePaid(s, sale) <= total,
      "Primero revertí los pagos que excedan el nuevo total.",
    );
    (sale.adjustments ??= []).push({
      id,
      date: now,
      by: m.uid,
      actorName: m.name,
      reason,
      beforeDiscount: sale.discount ?? 0,
      discount,
    });
    sale.discount = discount;
    sale.total = total;
    syncOrder(s, sale, id, m, now, "Descuento ajustado", reason);
    return true;
  }
  let sale: Sale | undefined,
    branchId: string,
    customerId: string | null = null,
    vehicleId: string | null = null,
    orderId: string | null = null;
  let items: Sale["items"] = [],
    subtotal = 0,
    cost = 0;
  if (c.action === "sale.pay") {
    sale = get(s.sales, c.id, "Venta");
    ensure(sale.billingVersion, "La venta anterior ya está cobrada.");
    branchId = sale.branchId;
  } else if (c.action === "chargeOrder") {
    const o = get(s.orders, c.id, "Orden");
    ensure(
      o.status === "ready" && o.workStatus !== "cancelled",
      "La orden debe estar finalizada y con saldo pendiente.",
    );
    branchId = o.branchId;
    customerId = o.customerId;
    vehicleId = o.vehicleId;
    orderId = o.id;
    sale = s.sales.find((v) => v.orderId === o.id);
    if (sale)
      ensure(sale.billingVersion, "La orden ya tiene un comprobante anterior.");
    else {
      items = billingItems(o).map((i) => ({
        name: i.name || get(s.products, i.productId, "Producto").name,
        quantity: i.quantity,
        price: i.price,
      }));
      items.push({
        name: "Mano de obra",
        quantity: 1,
        price: approvedLabor(o),
      });
      subtotal = orderTotal(o);
      cost = round(
        consumedItems(o).reduce((n, i) => n + i.quantity * i.cost, 0),
      );
    }
  } else {
    branchId = key.parse(c.branchId);
    get(s.branches, branchId, "Sucursal");
    customerId = c.customerId ? key.parse(c.customerId) : null;
    vehicleId = c.vehicleId ? key.parse(c.vehicleId) : null;
    if (customerId) get(s.customers, customerId, "Cliente");
    if (vehicleId) {
      const v = get(s.vehicles, vehicleId, "Vehículo");
      ensure(
        v.customerId === customerId,
        "El vehículo debe pertenecer al cliente seleccionado.",
      );
    }
    const lines = z
      .array(
        z.object({
          productId: key,
          quantity: z.number().finite().positive().max(1000),
        }),
      )
      .min(1)
      .max(30)
      .parse(c.items);
    for (const i of lines) {
      const p = get(s.products, i.productId, "Producto");
      ensure(p.branchId === branchId, "El producto pertenece a otra sucursal.");
      items.push({ name: p.name, quantity: i.quantity, price: p.price });
      subtotal += i.quantity * p.price;
      cost += i.quantity * p.cost;
    }
    subtotal = round(subtotal);
    cost = round(cost);
    useStock(lines, branchId, -1, "Venta directa");
  }
  const cash = s.cash.find((r) => r.branchId === branchId && !r.closedAt);
  ensure(cash, "Abrí la caja de esta sucursal antes de cobrar.");
  if (!sale) {
    const discount = amountSchema.parse(c.discount ?? 0);
    ensure(discount <= subtotal, "El descuento supera el subtotal.");
    let adjustments: Sale["adjustments"] = [];
    if (discount > 0) {
      ensure(
        canManage(m.role),
        "Sólo administración o encargado puede autorizar descuentos.",
      );
      const reason = reasonSchema.parse(c.discountReason);
      adjustments = [
        {
          id: `${id}-discount`,
          date: now,
          by: m.uid,
          actorName: m.name,
          reason,
          beforeDiscount: 0,
          discount,
        },
      ];
    }
    sale = {
      id,
      branchId,
      customerId,
      vehicleId,
      orderId,
      date: now,
      total: round(subtotal - discount),
      subtotal,
      cost,
      discount,
      adjustments,
      method: "cash",
      items,
      billingVersion: 1,
    };
    s.sales.push(sale);
  } else
    ensure(
      !c.discount || c.discount === sale.discount,
      "Ajustá el descuento desde la ficha de venta.",
    );
  const balance = saleBalance(s, sale);
  ensure(
    balance > 0 ||
      (sale.total === 0 && !s.payments.some((p) => p.saleId === sale!.id)),
    "La venta ya está cobrada.",
  );
  const entries =
    c.payments !== undefined
      ? z
          .array(
            z.object({
              method: z.enum(paymentMethods),
              amount: amountSchema.refine(
                (n) => n > 0,
                "El importe debe ser mayor a cero.",
              ),
              reference: z.string().trim().max(200).optional(),
            }),
          )
          .max(3)
          .parse(c.payments)
      : balance > 0
        ? [
            {
              method: z.enum(paymentMethods).parse(c.method),
              amount: balance,
              reference: "",
            },
          ]
        : [];
  ensure(
    new Set(entries.map((p) => p.method)).size === entries.length,
    "Usá una sola línea por medio de pago.",
  );
  const paid = round(entries.reduce((n, p) => n + p.amount, 0));
  ensure(paid <= balance, "El cobro supera el saldo pendiente.");
  if (!paid && c.action !== "sale" && sale.total > 0)
    throw new Error("Ingresá un importe para cobrar.");
  ensure(
    paid === balance || sale.customerId,
    "Seleccioná un cliente para dejar saldo pendiente.",
  );
  entries.forEach((p, i) =>
    s.payments.push({
      id: `${id}-pay-${i}`,
      saleId: sale!.id,
      customerId: sale!.customerId,
      branchId,
      cashSessionId: cash.id,
      kind: "receipt",
      date: now,
      by: m.uid,
      actorName: m.name,
      reason: "",
      method: p.method,
      amount: p.amount,
      reference: p.reference ?? "",
    }),
  );
  const methods = new Set(
    s.payments
      .filter((p) => p.saleId === sale!.id && p.kind === "receipt")
      .map((p) => p.method),
  );
  sale.method = methods.size > 1 ? "mixed" : ([...methods][0] ?? "cash");
  syncOrder(
    s,
    sale,
    id,
    m,
    now,
    "Cobro registrado",
    `Cobrado ${paid} · Saldo ${saleBalance(s, sale)}`,
  );
  return true;
}
