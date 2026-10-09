import { serviceAvailable, serviceLabel } from "./services.js";
import { z } from "zod";
import { assertReservation } from "./inventory.js";
import {
  canCharge,
  canManage,
  key,
  schemas,
  round,
  today,
  type Member,
  type State,
} from "./model.js";
import type { Command } from "./engine.js";
import {
  approvedItems,
  orderEvent,
  quoteTotal,
  workStage,
  type Order,
  type OrderItem,
} from "./orders.js";
function need(v: unknown, message: string): asserts v {
  if (!v) throw new Error(message);
}
const money = z.number().finite().min(0).max(1e10);
const short = z.string().trim().min(1).max(1000);
const get = <T extends { id: string }>(
  rows: T[],
  id: unknown,
  label: string,
) => {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`${label} no encontrado en esta empresa.`);
  return row;
};
export function orderOperations(
  s: State,
  member: Member,
  cmd: Command,
  id: string,
  now: string,
): boolean {
  if (!cmd.action.startsWith("order.")) return false;
  const portal = member.role === "customer";
  need(
    !portal ||
      ["order.decision", "order.additionDecision"].includes(cmd.action),
    "Acción exclusiva del lubricentro.",
  );
  const lines = (input: unknown, branchId: string): OrderItem[] => {
    const rows = z
      .array(
        z.object({ productId: key, quantity: z.number().positive().max(1000) }),
      )
      .parse(input);
    need(
      new Set(rows.map((r) => r.productId)).size === rows.length,
      "No repitas el mismo producto.",
    );
    return rows.map((r) => {
      const p = get(s.products, r.productId, "Producto");
      need(p.branchId === branchId, "Producto de otra sucursal.");
      need(
        p.unit !== "unidad" || Number.isInteger(r.quantity),
        "Las unidades requieren cantidades enteras.",
      );
      need(
        Math.abs(r.quantity * 100 - Math.round(r.quantity * 100)) < 0.00001,
        "Usá hasta dos decimales para litros.",
      );
      return { ...r, name: p.name, price: p.price, cost: p.cost };
    });
  };
  const quote = (branchId: string) => {
    const ids = z.array(key).min(1).parse(cmd.serviceIds);
    need(new Set(ids).size === ids.length, "No repitas servicios.");
    const services = ids.map((sid) => get(s.services, sid, "Servicio"));
    need(
      services.every((v) => serviceAvailable(s, v, branchId)),
      "Servicio inactivo o de otra sucursal.",
    );
    const quantities = new Map<string, number>();
    [
      ...services.flatMap((v) => v.items),
      ...z
        .array(
          z.object({
            productId: key,
            quantity: z.number().positive().max(1000),
          }),
        )
        .parse(cmd.extraItems ?? []),
    ].forEach((i) =>
      quantities.set(
        i.productId,
        round((quantities.get(i.productId) ?? 0) + i.quantity),
      ),
    );
    const labor =
      cmd.labor === undefined
        ? round(services.reduce((n, v) => n + v.labor, 0))
        : money.parse(cmd.labor);
    if (cmd.labor !== undefined)
      need(
        canManage(member.role),
        "Sólo administración modifica la mano de obra del presupuesto.",
      );
    return {
      extraItems: z
        .array(
          z.object({
            productId: key,
            quantity: z.number().positive().max(1000),
          }),
        )
        .parse(cmd.extraItems ?? []),
      serviceId: ids[0],
      serviceName: services
        .map((v) => serviceLabel(v))
        .join(" + ")
        .slice(0, 120),
      labor,
      items: lines(
        [...quantities].map(([productId, quantity]) => ({
          productId,
          quantity,
        })),
        branchId,
      ),
      intervalKm: services[0].intervalKm,
      intervalMonths: services[0].intervalMonths,
      serviceSnapshots: services.map((v) => ({
        serviceId: v.id,
        name: serviceLabel(v),
        ...(v.durationMinutes ? { durationMinutes: v.durationMinutes } : {}),
        labor: v.labor,
        intervalKm: v.intervalKm,
        intervalMonths: v.intervalMonths,
      })),
    };
  };
  if (cmd.action === "order.create") {
    const v = get(s.vehicles, cmd.vehicleId, "Vehículo"),
      b = get(s.branches, cmd.branchId, "Sucursal");
    need(
      !s.orders.some(
        (o) =>
          o.vehicleId === v.id &&
          (o.workStatus || o.status !== "paid") &&
          !["cancelled", "delivered"].includes(workStage(o)),
      ),
      "El vehículo ya tiene una orden abierta.",
    );
    const o: Order = {
      ...schemas.orders.parse({
        ...quote(b.id),
        customerId: v.customerId,
        vehicleId: v.id,
        branchId: b.id,
        odometer: cmd.odometer,
        date: today(),
        technician: cmd.technician ?? "",
        notes: cmd.notes ?? "",
        checklist: z
          .array(z.string().max(80))
          .max(20)
          .parse(cmd.checklist ?? []),
        status: "received",
        workStatus: "received",
        paymentStatus: "unpaid",
        quoteRevision: 1,
        approval: "pending",
        receivedAt: now,
        consumptionConfirmed: false,
        photos: [],
        events: [],
        additions: [],
        approvalHistory: [],
      }),
      id,
    };
    need(o.odometer >= v.odometer, "El kilometraje no puede disminuir.");
    if (cmd.appointmentId) {
      const a = get(s.appointments, cmd.appointmentId, "Turno");
      need(
        a.vehicleId === v.id &&
          a.branchId === b.id &&
          a.customerId === v.customerId,
        "El turno no coincide con el vehículo, cliente o sucursal.",
      );
      need(
        !a.orderId && ["confirmed", "requested"].includes(a.status),
        "Este turno ya fue recibido o no está disponible.",
      );
      o.appointmentId = a.id;
      a.orderId = id;
      a.receivedAt = now;
      a.status = "confirmed";
    }
    orderEvent(
      o,
      id,
      "Recepción y presupuesto",
      member.uid,
      now,
      "",
      member.name,
    );
    s.orders.push(o);
    return true;
  }
  const o = get(s.orders, cmd.id, "Orden");
  if (portal) {
    need(
      !!member.customerId && o.customerId === member.customerId,
      "Esta visita no pertenece a tu cuenta.",
    );
    need(
      z.number().int().positive().parse(cmd.expectedRevision) ===
        (o.quoteRevision ?? 1),
      "El presupuesto cambió. Actualizá la pantalla y revisá el nuevo detalle.",
    );
  }
  const reserve = () => {
    try {
      assertReservation(s, o);
    } catch (error) {
      if (portal)
        throw new Error(
          "No se pudieron reservar los insumos. Contactá al lubricentro para revisar la disponibilidad antes de autorizar.",
        );
      throw error;
    }
  };
  if (cmd.action === "order.customerReport") {
    need(
      member.role !== "cashier",
      "Tu rol no permite editar el informe técnico para el cliente.",
    );
    need(o.workStatus !== "cancelled", "La orden está cancelada.");
    const data = z
      .object({
        customerSummary: z.string().trim().max(1000),
        customerRecommendations: z.string().trim().max(1000),
      })
      .parse(cmd.data);
    Object.assign(o, data);
    orderEvent(
      o,
      id,
      "Informe para cliente actualizado",
      member.uid,
      now,
      "",
      member.name,
    );
    return true;
  }
  need(
    !["delivered", "cancelled"].includes(workStage(o)),
    "La orden está cerrada.",
  );
  const editable = () =>
    need(
      ["received", "working", "waiting"].includes(workStage(o)),
      "La orden ya fue finalizada.",
    );
  if (cmd.action === "order.quote") {
    need(
      !o.startedAt && o.status === "received",
      "El trabajo ya comenzó; registrá un adicional.",
    );
    need(
      o.approval !== "approved",
      "El presupuesto aprobado se conserva. Registrá un adicional.",
    );
    Object.assign(o, quote(o.branchId));
    o.quoteRevision = (o.quoteRevision ?? 1) + 1;
    o.approval = "pending";
    o.consumptionConfirmed = false;
    delete o.actualItems;
    orderEvent(
      o,
      id,
      "Presupuesto actualizado",
      member.uid,
      now,
      "",
      member.name,
    );
  } else if (cmd.action === "order.decision") {
    need(
      portal || canCharge(member.role),
      "Tu rol no permite registrar autorizaciones del cliente.",
    );
    need(
      o.approval !== "approved" && !o.startedAt && o.status === "received",
      "El presupuesto no está pendiente de decisión.",
    );
    if (portal) {
      need(o.approval === "pending", "El presupuesto ya tiene una decisión.");
      need(
        money.parse(cmd.expectedTotal) === quoteTotal(o),
        "El importe cambió. Actualizá la pantalla antes de decidir.",
      );
    }
    const decision = z.enum(["approved", "rejected"]).parse(cmd.decision),
      method = portal
        ? ("portal" as const)
        : z.enum(["presencial", "telefono", "mensaje"]).parse(cmd.method),
      note = portal
        ? z
            .string()
            .max(1000)
            .parse(cmd.note ?? "") ||
          "Decisión registrada desde el portal del cliente."
        : short.parse(cmd.note);
    o.approval = decision;
    if (decision === "approved") reserve();
    (o.approvalHistory ??= []).push({
      revision: o.quoteRevision ?? 1,
      decision,
      total: quoteTotal(o),
      method,
      note,
      at: now,
      by: member.uid,
    });
    orderEvent(
      o,
      id,
      decision === "approved"
        ? "Presupuesto autorizado"
        : "Presupuesto rechazado",
      member.uid,
      now,
      note,
      member.name,
    );
  } else if (cmd.action === "order.addition") {
    editable();
    need(
      o.approval === "approved" || o.approval === undefined,
      "Resolvé el presupuesto antes de proponer adicionales.",
    );
    const labor = money.parse(cmd.labor ?? 0);
    need(
      canManage(member.role) || labor === 0,
      "Sólo administración fija mano de obra adicional.",
    );
    (o.additions ??= []).push({
      id,
      title: z.string().trim().min(1).max(120).parse(cmd.title),
      items: lines(cmd.items ?? [], o.branchId),
      labor,
      status: "pending",
      createdAt: now,
    });
    o.workStatus =
      o.startedAt || o.status === "working" ? "working" : "received";
    orderEvent(
      o,
      id,
      "Adicional propuesto",
      member.uid,
      now,
      String(cmd.title),
      member.name,
    );
  } else if (cmd.action === "order.additionDecision") {
    editable();
    need(
      portal || canCharge(member.role),
      "Tu rol no permite registrar autorizaciones del cliente.",
    );
    const a = get(o.additions ?? [], cmd.additionId, "Adicional");
    need(a.status === "pending", "El adicional ya tiene una decisión.");
    if (portal) {
      need(
        z.string().datetime().parse(cmd.expectedCreatedAt) === a.createdAt,
        "El adicional cambió. Actualizá la pantalla.",
      );
      need(
        money.parse(cmd.expectedTotal) ===
          round(
            a.labor + a.items.reduce((sum, i) => sum + i.quantity * i.price, 0),
          ),
        "El importe cambió. Actualizá la pantalla antes de decidir.",
      );
    }
    a.status = z.enum(["approved", "rejected"]).parse(cmd.decision);
    a.method = portal
      ? "portal"
      : z.enum(["presencial", "telefono", "mensaje"]).parse(cmd.method);
    a.note = portal
      ? z
          .string()
          .max(1000)
          .parse(cmd.note ?? "") ||
        "Decisión registrada desde el portal del cliente."
      : short.parse(cmd.note);
    a.decidedAt = now;
    a.decidedBy = member.uid;
    if (a.status === "approved") {
      reserve();
      o.consumptionConfirmed = false;
    }
    orderEvent(
      o,
      id,
      a.status === "approved" ? "Adicional autorizado" : "Adicional rechazado",
      member.uid,
      now,
      `${a.title}: ${a.note}`,
      member.name,
    );
  } else if (cmd.action === "order.consumption") {
    editable();
    need(
      member.role !== "cashier",
      "Tu rol no permite confirmar consumos reales.",
    );
    need(
      o.approval === undefined || o.approval === "approved",
      "Autorizá el presupuesto antes de confirmar consumos.",
    );
    need(
      !o.additions?.some((a) => a.status === "pending"),
      "Resolvé los adicionales pendientes.",
    );
    const actual = lines(cmd.items, o.branchId),
      quoted = approvedItems(o);
    for (const i of actual) {
      const authorized = quoted.filter((q) => q.productId === i.productId);
      need(
        authorized.length > 0,
        "El producto requiere un adicional autorizado.",
      );
      need(
        i.quantity <= round(authorized.reduce((n, q) => n + q.quantity, 0)),
        "La cantidad excede lo autorizado. Registrá un adicional.",
      );
      i.price = authorized[0].price;
    }
    o.actualItems = actual;
    o.consumptionConfirmed = true;
    o.consumptionNote = z
      .string()
      .max(1000)
      .parse(cmd.note ?? "");
    orderEvent(
      o,
      id,
      "Consumos reales confirmados",
      member.uid,
      now,
      o.consumptionNote,
      member.name,
    );
  } else if (cmd.action === "order.update") {
    editable();
    const data = z
      .object({
        technician: z.string().trim().max(120),
        notes: z.string().max(1000),
        checklist: z.array(z.string().max(80)).max(20),
        recommendations: z.string().max(1000),
        expectedReadyAt: z.string().datetime().nullable().optional(),
      })
      .parse(cmd.data);
    if (data.expectedReadyAt && data.expectedReadyAt !== o.expectedReadyAt)
      need(
        Date.parse(data.expectedReadyAt) >= Date.parse(now),
        "Indicá una estimación de retiro futura.",
      );
    Object.assign(o, data);
    orderEvent(
      o,
      id,
      "Ficha de trabajo actualizada",
      member.uid,
      now,
      "",
      member.name,
    );
  } else if (cmd.action === "order.cancel") {
    need(canCharge(member.role), "Tu rol no permite cancelar órdenes.");
    need(
      !o.startedAt && o.status === "received",
      "No se puede cancelar un trabajo iniciado o finalizado.",
    );
    o.cancelReason = short.parse(cmd.reason);
    o.cancelledAt = now;
    o.workStatus = "cancelled";
    if (o.appointmentId) {
      const a = get(s.appointments, o.appointmentId, "Turno");
      a.status = "cancelled";
      a.statusReason = o.cancelReason;
    }
    orderEvent(
      o,
      id,
      "Orden cancelada",
      member.uid,
      now,
      o.cancelReason,
      member.name,
    );
  } else throw new Error("Acción de orden desconocida.");
  return true;
}
