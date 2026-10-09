import { z } from "zod";
import { availability, agendaActive, type Appointment } from "./agenda.js";
import { schemas, type State, type Member } from "./model.js";
export const clientAppointmentVersion = (a: Appointment) =>
  JSON.stringify([
    a.date,
    a.time,
    a.branchId,
    a.status,
    a.orderId ?? null,
    a.receivedAt ?? null,
    a.reschedules?.length ?? 0,
  ]);
export function futureAppointment(date: string, time: string, now: string) {
  return Date.parse(`${date}T${time}:00-03:00`) > Date.parse(now);
}
export function clientAppointmentEditable(a: Appointment, now: string) {
  return (
    agendaActive(a) &&
    !a.orderId &&
    !a.receivedAt &&
    futureAppointment(a.date, a.time, now)
  );
}
export function clientAppointments(s: State, m: Member, now: string) {
  const owned = s.appointments.filter(
    (a) =>
      m.active &&
      m.role === "customer" &&
      a.customerId === m.customerId &&
      s.vehicles.some(
        (v) => v.id === a.vehicleId && v.customerId === m.customerId,
      ),
  );
  const upcoming = owned
    .filter(
      (a) =>
        agendaActive(a) &&
        !a.orderId &&
        !a.receivedAt &&
        futureAppointment(a.date, a.time, now),
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return {
    upcoming,
    history: owned
      .filter((a) => !upcoming.includes(a))
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)),
  };
}
export function clientAppointmentChange(
  s: State,
  m: Member,
  cmd: Record<string, unknown>,
  now: string,
) {
  if (
    !["clientAppointment.reschedule", "clientAppointment.cancel"].includes(
      String(cmd.action),
    )
  )
    return false;
  if (m.role !== "customer") throw new Error("Acción exclusiva del portal.");
  const a = s.appointments.find((a) => a.id === cmd.id);
  if (
    !a ||
    !m.customerId ||
    a.customerId !== m.customerId ||
    !s.vehicles.some(
      (v) => v.id === a.vehicleId && v.customerId === m.customerId,
    )
  )
    throw new Error("Este turno no pertenece a tu cuenta.");
  if (cmd.expectedVersion !== clientAppointmentVersion(a))
    throw new Error(
      "El turno cambió. Actualizá la pantalla antes de continuar.",
    );
  if (!clientAppointmentEditable(a, now))
    throw new Error(
      "El turno ya fue recibido, cerrado o su horario pasó. Contactá al lubricentro.",
    );
  const reason = z.string().trim().min(1).max(1000).parse(cmd.reason);
  if (cmd.action === "clientAppointment.cancel") {
    a.status = "cancelled";
    a.statusReason = reason;
    return true;
  }
  const data = schemas.appointments
    .pick({ date: true, time: true, branchId: true })
    .parse(cmd);
  if (!futureAppointment(data.date, data.time, now))
    throw new Error("Elegí una fecha y hora futuras.");
  const b = s.branches.find((b) => b.id === data.branchId);
  if (!b) throw new Error("Sucursal no encontrada en esta empresa.");
  const candidate = {
    ...a,
    ...data,
    status: "requested" as const,
    technician: "",
    station: 0,
  };
  const problem = availability(candidate, s.appointments, b);
  if (problem) throw new Error(problem);
  if (
    a.date === data.date &&
    a.time === data.time &&
    a.branchId === data.branchId
  )
    throw new Error("Elegí una fecha, hora o sucursal diferente.");
  (a.reschedules ??= []).push({
    at: now,
    by: m.uid,
    reason,
    fromDate: a.date,
    fromTime: a.time,
    fromBranchId: a.branchId,
    toDate: data.date,
    toTime: data.time,
    toBranchId: data.branchId,
  });
  Object.assign(a, candidate, { rescheduleReason: reason });
  delete a.plannedItems;
  delete a.planUpdatedAt;
  delete a.planUpdatedBy;
  delete a.statusReason;
  return true;
}
const esc = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
function foldCalendarLine(line: string) {
  let out = "",
    current = "",
    bytes = 0;
  const encoder = new TextEncoder();
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > 75) {
      out += current + "\r\n";
      current = " ";
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  return out + current;
}
export function appointmentCalendar(
  a: Appointment,
  plate: string,
  branch: string,
  address: string,
  now: string,
) {
  const utc = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const start = new Date(`${a.date}T${a.time}:00-03:00`),
    end = new Date(start.getTime() + (a.durationMinutes ?? 60) * 60000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Brainworks//LubriWorks//ES",
    "BEGIN:VEVENT",
    `UID:${esc(a.id)}@lubriworks`,
    `DTSTAMP:${utc(new Date(now))}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${esc(`LubriWorks · ${plate} · ${a.reason}`)}`,
    `LOCATION:${esc(`${branch} · ${address}`)}`,
    "DESCRIPTION:Turno confirmado. Consultá Mis turnos para verificar cambios.",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(foldCalendarLine)
    .join("\r\n");
}
