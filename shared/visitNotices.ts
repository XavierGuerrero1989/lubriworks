import { today, type Notice, type State } from "./model.js";
import { orderTotal } from "./orders.js";
export const visitLabels = {
  "appointment-confirmed": "Turno confirmado",
  "appointment-rescheduled": "Turno reprogramado",
  "appointment-cancelled": "Turno cancelado",
  "quote-pending": "Presupuesto pendiente",
  "addition-pending": "Adicional pendiente",
  "vehicle-ready": "Vehículo listo",
} as const;
export type VisitEvent = keyof typeof visitLabels;
export const appointmentVersion = (a: State["appointments"][number]) =>
  JSON.stringify([a.date, a.time, a.branchId]);
/** Create event notices in the same transaction as the business change. */
export function visitNotices(
  before: State,
  after: State,
  operationId: string,
  now: string,
) {
  const created: Notice[] = [];
  const add = (
    event: VisitEvent,
    entity: {
      id: string;
      customerId: string;
      vehicleId: string;
      branchId: string;
    },
    body: string,
    extra: Partial<Notice>,
  ) => {
    created.push({
      id: `${operationId}-visit-${created.length}`,
      customerId: entity.customerId,
      vehicleId: entity.vehicleId,
      branchId: entity.branchId,
      title: visitLabels[event],
      body,
      date: now,
      read: false,
      category: "visit",
      origin: "operational",
      pushStatus: "pending",
      event,
      ...extra,
    });
  };
  const plate = (id: string) =>
    after.vehicles.find((v) => v.id === id)?.plate || "Tu vehículo";
  const branch = (id: string) =>
    after.branches.find((b) => b.id === id)?.name || "la sucursal del turno";
  for (const a of after.appointments) {
    const old = before.appointments.find((v) => v.id === a.id);
    const moved = old && appointmentVersion(old) !== appointmentVersion(a);
    let event: VisitEvent | undefined;
    if (a.status === "cancelled" && old?.status !== a.status)
      event = "appointment-cancelled";
    else if (
      !a.receivedAt &&
      !a.orderId &&
      ["requested", "confirmed"].includes(a.status)
    ) {
      if (moved) event = "appointment-rescheduled";
      else if (a.status === "confirmed" && old?.status !== "confirmed")
        event = "appointment-confirmed";
    }
    if (event)
      add(
        event,
        a,
        `${plate(a.vehicleId)} · ${a.date.split("-").reverse().join("/")} a las ${a.time} · ${branch(a.branchId)}. ${event === "appointment-cancelled" ? "El turno fue cancelado. Si necesitás otra fecha, solicitá un nuevo turno." : a.status === "requested" ? "La nueva fecha está pendiente de confirmación del lubricentro." : "Tu turno está confirmado."}`,
        { appointmentId: a.id, entityVersion: appointmentVersion(a) },
      );
  }
  for (const o of after.orders) {
    const old = before.orders.find((v) => v.id === o.id);
    if (
      o.approval === "pending" &&
      (!old ||
        old.quoteRevision !== o.quoteRevision ||
        old.approval !== "pending")
    )
      add(
        "quote-pending",
        o,
        `${plate(o.vehicleId)}: el presupuesto está pendiente de tu decisión. Revisá el detalle y autorizá o rechazá desde Inicio / Mis vehículos en tu portal.`,
        { orderId: o.id, entityVersion: String(o.quoteRevision ?? 1) },
      );
    for (const a of o.additions ?? [])
      if (a.status === "pending" && !old?.additions?.some((v) => v.id === a.id))
        add(
          "addition-pending",
          o,
          `${plate(o.vehicleId)}: hay un trabajo adicional propuesto: ${a.title}. Revisá el detalle y autorizá o rechazá el adicional desde Inicio / Mis vehículos en tu portal.`,
          { orderId: o.id, additionId: a.id },
        );
    if (o.finishedAt && o.finishedAt !== old?.finishedAt)
      add(
        "vehicle-ready",
        o,
        `${plate(o.vehicleId)}: el trabajo está finalizado. Total del trabajo: ${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(orderTotal(o))}. Consultá el detalle y coordiná el retiro con ${branch(o.branchId)}. El estado del pago se consulta por separado.`,
        { orderId: o.id, entityVersion: o.finishedAt },
      );
  }
  return created;
}
/** A historical portal notice stays visible; stale push is suppressed. */
export function visitObsolete(
  n: Notice,
  s: Pick<State, "appointments" | "orders">,
  asOf = today(),
): string {
  if (n.origin !== "operational") return "";
  if (n.appointmentId) {
    const a = s.appointments.find((a) => a.id === n.appointmentId);
    if (!a || a.customerId !== n.customerId || a.vehicleId !== n.vehicleId)
      return "Turno no disponible";
    if (appointmentVersion(a) !== n.entityVersion)
      return "El turno cambió nuevamente";
    if (n.event === "appointment-cancelled")
      return a.status === "cancelled" ? "" : "El turno ya no está cancelado";
    if (
      a.receivedAt ||
      a.orderId ||
      !["requested", "confirmed"].includes(a.status)
    )
      return "El turno ya fue recibido o cerrado";
    if (a.date < asOf) return "La fecha del turno ya pasó";
    if (n.event === "appointment-confirmed" && a.status !== "confirmed")
      return "El turno ya no está confirmado";
  } else if (n.orderId) {
    const o = s.orders.find((o) => o.id === n.orderId);
    if (!o || o.customerId !== n.customerId || o.vehicleId !== n.vehicleId)
      return "Visita no disponible";
    if (o.deliveredAt || o.workStatus === "cancelled")
      return "La visita ya fue entregada o cancelada";
    if (
      n.event === "quote-pending" &&
      (o.approval !== "pending" ||
        String(o.quoteRevision ?? 1) !== n.entityVersion)
    )
      return "El presupuesto ya se resolvió o cambió";
    if (
      n.event === "addition-pending" &&
      !o.additions?.some((a) => a.id === n.additionId && a.status === "pending")
    )
      return "El adicional ya se resolvió";
    if (
      n.event === "vehicle-ready" &&
      (!o.finishedAt || o.finishedAt !== n.entityVersion)
    )
      return "El estado del trabajo cambió";
  } else return "Aviso sin referencia a la visita";
  return "";
}
