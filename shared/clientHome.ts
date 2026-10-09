import { dueInfo, round, type Member, type State } from "./model.js";
import { localDay } from "./dashboard.js";
import { workStage, type Order } from "./orders.js";
export const additionTotal = (a: NonNullable<Order["additions"]>[number]) =>
  round(a.labor + a.items.reduce((n, i) => n + i.price * i.quantity, 0));
export const portalDateTime = (value: string) =>
  new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
export function readyInput(value: string | null | undefined) {
  if (!value) return "";
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
  return p.replace(" ", "T");
}
export function readyTimestamp(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error("Indicá fecha y hora de retiro válidas.");
  const timestamp = new Date(value + ":00-03:00").toISOString();
  if (readyInput(timestamp) !== value)
    throw new Error("Indicá fecha y hora de retiro válidas.");
  return timestamp;
}
export function lastVisitChange(o: Order) {
  return [
    o.publicUpdatedAt,
    o.receivedAt,
    o.startedAt,
    o.finishedAt,
    o.deliveredAt,
    ...(o.additions ?? []).flatMap((a) => [a.createdAt, a.decidedAt]),
  ]
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
}
export function clientHome(s: State, member: Member, now: string) {
  const customerId =
    member.role === "customer" && member.active ? member.customerId : null;
  const day = localDay(now),
    time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(now));
  const vehicles = s.vehicles.filter(
    (v) => !!customerId && v.customerId === customerId,
  );
  const owned = new Set(vehicles.map((v) => v.id));
  const visits = s.orders
    .filter(
      (o) =>
        o.customerId === customerId &&
        owned.has(o.vehicleId) &&
        !["delivered", "cancelled"].includes(workStage(o)) &&
        (!!o.workStatus || o.status !== "paid"),
    )
    .sort((a, b) =>
      (b.receivedAt ?? b.date).localeCompare(a.receivedAt ?? a.date),
    );
  const appointments = s.appointments
    .filter(
      (a) =>
        a.customerId === customerId &&
        owned.has(a.vehicleId) &&
        !a.orderId &&
        !a.receivedAt &&
        ["requested", "confirmed"].includes(a.status) &&
        (a.date > day || (a.date === day && a.time >= time)),
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const reminders = s.reminders
    .filter(
      (r) =>
        r.customerId === customerId &&
        owned.has(r.vehicleId) &&
        r.status === "active",
    )
    .map((r) => ({
      r,
      info: dueInfo(
        r,
        vehicles.find((v) => v.id === r.vehicleId)!,
        day,
      ),
    }))
    .sort(
      (a, b) =>
        Number(b.info.overdue) - Number(a.info.overdue) ||
        (a.info.effective || "9999").localeCompare(b.info.effective || "9999"),
    );
  return { vehicles, visits, appointments, reminders, day };
}
export function visitSummary(o: Order) {
  if (o.status === "paid")
    return {
      label: "Listo para retirar",
      description:
        "El pago está registrado. Coordiná la entrega con el lubricentro.",
      tone: "ready",
    };
  if (o.status === "ready")
    return {
      label: "Trabajo finalizado",
      description:
        "Tu vehículo está listo. Revisá el saldo y coordiná el retiro.",
      tone: "ready",
    };
  if (o.approval === "rejected")
    return {
      label: "Presupuesto rechazado",
      description:
        "El lubricentro revisará con vos cómo continuar. El trabajo aún no fue autorizado.",
      tone: "waiting",
    };
  if (o.approval === "pending")
    return {
      label: "Tu aprobación está pendiente",
      description: "Revisá el presupuesto antes de que comience el trabajo.",
      tone: "waiting",
    };
  if (o.additions?.some((a) => a.status === "pending"))
    return {
      label: "Hay un adicional para revisar",
      description:
        "El lubricentro propuso un trabajo extra. Requiere tu decisión.",
      tone: "waiting",
    };
  if (o.startedAt || o.status === "working")
    return {
      label: "Estamos trabajando en tu vehículo",
      description: "Podés consultar aquí el avance y la estimación de retiro.",
      tone: "working",
    };
  return {
    label: "Tu vehículo ya está en el local",
    description:
      "La recepción está registrada. El lubricentro prepara la atención.",
    tone: "received",
  };
}
