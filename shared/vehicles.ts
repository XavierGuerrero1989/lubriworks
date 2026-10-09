import { z } from "zod";
import {
  canManage,
  date,
  today,
  vehicleYear,
  type Member,
  type State,
  type Vehicle,
  type VehicleReading,
} from "./model.js";
import { workStage } from "./orders.js";
import type { Command } from "./engine.js";
export function protectOpenReadings(
  s: State,
  v: Vehicle,
  odometer: number,
  readingDate: string,
) {
  const conflict = s.orders.find(
    (o) =>
      o.vehicleId === v.id &&
      (o.workStatus || o.status !== "paid") &&
      !["cancelled", "delivered"].includes(workStage(o)) &&
      (odometer > o.odometer || readingDate > o.date),
  );
  if (conflict)
    throw new Error(
      "La lectura contradice una visita abierta. Completá la visita o revisá la lectura antes de actualizarla.",
    );
}
export function logReading(
  s: State,
  v: Vehicle,
  before: Vehicle | undefined,
  member: Member,
  id: string,
  at: string,
  source: VehicleReading["source"],
  reason = "",
  orderId?: string,
) {
  s.vehicleReadings.push({
    id,
    vehicleId: v.id,
    customerId: v.customerId,
    odometer: v.odometer,
    readingDate: v.readingDate,
    beforeOdometer: before?.odometer ?? null,
    beforeDate: before?.readingDate ?? "",
    source,
    reason,
    at,
    by: member.uid,
    actorName: member.name,
    ...(orderId ? { orderId } : {}),
  });
}
export function vehicleOperations(
  s: State,
  m: Member,
  c: Command,
  id: string,
  now: string,
): boolean {
  if (!c.action.startsWith("vehicle.")) return false;
  if (m.role === "customer")
    throw new Error("Acción exclusiva del lubricentro.");
  const v = s.vehicles.find((r) => r.id === c.id);
  if (!v) throw new Error("Vehículo no encontrado en esta empresa.");
  if (c.action === "vehicle.correctReading") {
    if (!canManage(m.role))
      throw new Error(
        "Sólo administrador o encargado puede corregir el kilometraje.",
      );
    const odometer = z.number().int().min(0).max(5e6).parse(c.odometer),
      readingDate = date.parse(c.date),
      reason = z
        .string()
        .trim()
        .min(1, "Indicá el motivo de la corrección.")
        .max(1000)
        .parse(c.reason);
    if (
      readingDate > today() ||
      Number(readingDate.slice(0, 4)) < vehicleYear(v)
    )
      throw new Error(
        "La fecha de lectura es futura o anterior al año del vehículo.",
      );
    if (odometer === v.odometer && readingDate === v.readingDate)
      throw new Error("La corrección debe cambiar la lectura o su fecha.");
    protectOpenReadings(s, v, odometer, readingDate);
    const before = structuredClone(v);
    v.odometer = odometer;
    v.readingDate = readingDate;
    v.previousOdometer = null;
    v.previousReadingDate = "";
    logReading(s, v, before, m, id, now, "correction", reason);
  } else if (c.action === "vehicle.recommendation.add") {
    if (m.role === "cashier")
      throw new Error("Tu rol no permite registrar recomendaciones técnicas.");
    const text = z.string().trim().min(1).max(1000).parse(c.text);
    s.vehicleRecommendations.push({
      id,
      vehicleId: v.id,
      customerId: v.customerId,
      text,
      status: "pending",
      createdAt: now,
      by: m.uid,
      actorName: m.name,
    });
  } else if (c.action === "vehicle.recommendation.resolve") {
    if (m.role === "cashier")
      throw new Error("Tu rol no permite resolver recomendaciones técnicas.");
    const r = s.vehicleRecommendations.find(
      (r) => r.id === c.recommendationId && r.vehicleId === v.id,
    );
    if (!r || r.status !== "pending")
      throw new Error("Recomendación no encontrada o ya resuelta.");
    r.resolution = z
      .string()
      .trim()
      .min(1, "Indicá cómo se resolvió.")
      .max(1000)
      .parse(c.resolution);
    r.status = "resolved";
    r.resolvedAt = now;
    r.resolvedBy = m.uid;
  } else throw new Error("Acción de vehículo desconocida.");
  return true;
}
