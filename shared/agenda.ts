import type { Entity } from "./model.js";
export type Appointment = Entity<"appointments">;
export type AppointmentBranch = Entity<"branches">;
export const agendaActive = (a: Pick<Appointment, "status">) =>
  ["requested", "confirmed"].includes(a.status);
export const duration = (a: Pick<Appointment, "durationMinutes">) =>
  a.durationMinutes ?? 60;
export const minutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const clock = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const appointmentEnd = (
  a: Pick<Appointment, "time" | "durationMinutes">,
) => clock(minutes(a.time) + duration(a));
const identity = (s: string) =>
  s
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ");
/** Half-open intervals: a turn finishing at 10:00 permits the next at 10:00. */
export function availability(
  candidate: Appointment,
  appointments: Appointment[],
  branch: AppointmentBranch,
): string | null {
  if (!agendaActive(candidate)) return null;
  if (minutes(candidate.time) + duration(candidate) > 1440)
    return "El turno debe terminar dentro del mismo día.";
  const capacity = branch.appointmentCapacity ?? 1;
  if ((candidate.station ?? 0) > capacity)
    return `La sucursal tiene ${capacity} puestos. Revisá el puesto asignado.`;
  const start = minutes(candidate.time),
    end = start + duration(candidate);
  const overlaps = appointments.filter(
    (a) =>
      a.id !== candidate.id &&
      a.date === candidate.date &&
      agendaActive(a) &&
      minutes(a.time) < end &&
      minutes(a.time) + duration(a) > start,
  );
  if (overlaps.some((a) => a.vehicleId === candidate.vehicleId))
    return "El vehículo ya tiene un turno que se superpone.";
  if (
    candidate.technician.trim() &&
    overlaps.some(
      (a) => identity(a.technician) === identity(candidate.technician),
    )
  )
    return "El técnico tiene otro turno que se superpone, incluso en otra sucursal.";
  const sameBranch = overlaps.filter((a) => a.branchId === candidate.branchId);
  if (
    candidate.station &&
    sameBranch.some((a) => a.station === candidate.station)
  )
    return "El puesto está ocupado durante ese horario.";
  // Checking only overlap count falsely rejects successive turns inside a long turn.
  const events = [
    [start, 1],
    [end, -1],
    ...sameBranch.flatMap((a) => [
      [Math.max(start, minutes(a.time)), 1],
      [Math.min(end, minutes(a.time) + duration(a)), -1],
    ]),
  ];
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let count = 0;
  for (const [, delta] of events) {
    count += delta;
    if (count > capacity)
      return `No hay capacidad: los ${capacity} puestos están reservados en ese intervalo.`;
  }
  return null;
}
export function availableTimes(
  candidate: Appointment,
  appointments: Appointment[],
  branch: AppointmentBranch,
) {
  const start = minutes(candidate.time);
  const slots: string[] = [];
  for (
    let m = start;
    m + duration(candidate) <= 1440 && slots.length < 6;
    m += 15
  ) {
    const a = { ...candidate, time: clock(m) };
    if (!availability(a, appointments, branch)) slots.push(a.time);
  }
  return slots;
}
