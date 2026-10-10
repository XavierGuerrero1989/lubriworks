import {
  dueInfo,
  estimatedKm,
  monthlyUsage,
  type Member,
  type State,
  type Vehicle,
  type Reminder,
} from "./model.js";
import { clientHome } from "./clientHome.js";
export type MaintenanceLevel =
  "due" | "estimated" | "soon" | "scheduled" | "missing" | "unknown" | "done";
export type MaintenanceItem = {
  id: string;
  vehicle: Vehicle;
  reminder?: Reminder;
  title: string;
  category: "service" | "extinguisher";
  level: MaintenanceLevel;
  info?: ReturnType<typeof dueInfo>;
  actualRemaining: number | null;
};
export function clientMaintenance(s: State, member: Member, now: string) {
  const home = clientHome(s, member, now),
    owned = new Map(home.vehicles.map((v) => [v.id, v]));
  const items: MaintenanceItem[] = s.reminders
    .filter((r) => r.customerId === member.customerId && owned.has(r.vehicleId))
    .map((r) => {
      const vehicle = owned.get(r.vehicleId)!,
        info = dueInfo(r, vehicle, home.day),
        actualRemaining = r.dueKm === null ? null : r.dueKm - vehicle.odometer;
      const realDue =
        (!!r.dueDate && r.dueDate <= home.day) ||
        (actualRemaining !== null && actualRemaining <= 0);
      const level: MaintenanceLevel =
        r.status === "done"
          ? "done"
          : realDue
            ? "due"
            : info.overdue
              ? "estimated"
              : info.soon
                ? "soon"
                : "scheduled";
      return {
        id: r.id,
        vehicle,
        reminder: r,
        title: r.title,
        category: r.source === "extinguisher" ? "extinguisher" : "service",
        level,
        info,
        actualRemaining,
      };
    });
  for (const vehicle of home.vehicles) {
    if (
      items.some(
        (i) => i.vehicle.id === vehicle.id && i.category === "extinguisher",
      )
    )
      continue;
    if (vehicle.hasExtinguisher === false || !vehicle.extinguisherDue)
      items.push({
        id: `extinguisher:${vehicle.id}`,
        vehicle,
        title:
          vehicle.hasExtinguisher === false
            ? "Matafuegos no registrado en el vehículo"
            : "Confirmar datos del matafuegos",
        category: "extinguisher",
        level: vehicle.hasExtinguisher === false ? "missing" : "unknown",
        actualRemaining: null,
      });
    else {
      // Legacy vehicles may have a due date without a generated reminder.
      const r: Reminder = {
        id: `extinguisher:${vehicle.id}`,
        customerId: vehicle.customerId,
        vehicleId: vehicle.id,
        title: "Renovación de matafuegos",
        dueDate: vehicle.extinguisherDue,
        dueKm: null,
        status: "active",
        source: "extinguisher",
      };
      const info = dueInfo(r, vehicle, home.day);
      items.push({
        id: r.id,
        vehicle,
        reminder: r,
        title: r.title,
        category: "extinguisher",
        level: r.dueDate <= home.day ? "due" : info.soon ? "soon" : "scheduled",
        info,
        actualRemaining: null,
      });
    }
  }
  const priority: Record<MaintenanceLevel, number> = {
    due: 0,
    missing: 1,
    estimated: 2,
    soon: 3,
    scheduled: 4,
    unknown: 5,
    done: 6,
  };
  items.sort(
    (a, b) =>
      priority[a.level] - priority[b.level] ||
      (a.info?.effective || "9999").localeCompare(
        b.info?.effective || "9999",
      ) ||
      a.id.localeCompare(b.id),
  );
  return { ...home, items };
}
export function maintenanceReading(v: Vehicle, day: string) {
  const usage = monthlyUsage(v);
  return {
    real: v.odometer,
    estimated: estimatedKm(v, day),
    usage,
    stale: (Date.parse(day) - Date.parse(v.readingDate)) / 864e5 > 90,
  };
}
export function filterMaintenance(
  items: MaintenanceItem[],
  filter: {
    vehicle: string;
    category: string;
    status: string;
    search: string;
    history: boolean;
  },
) {
  const norm = (x: string) =>
    x
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  return items.filter(
    (i) =>
      (filter.history ? i.level === "done" : i.level !== "done") &&
      (filter.vehicle === "all" || i.vehicle.id === filter.vehicle) &&
      (filter.category === "all" || i.category === filter.category) &&
      (filter.status === "all" ||
        (filter.status === "attention"
          ? ["due", "estimated", "soon", "missing"].includes(i.level)
          : i.level === filter.status)) &&
      norm(
        `${i.title} ${i.vehicle.plate} ${i.vehicle.brand} ${i.vehicle.model}`,
      ).includes(norm(filter.search)),
  );
}
