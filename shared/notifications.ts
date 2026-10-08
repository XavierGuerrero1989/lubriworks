import { z } from "zod";
import { dueInfo, today, type Reminder, type Vehicle } from "./model.js";
export const notificationSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  daysBefore: z.number().int().min(0).max(365).default(15),
  kmBefore: z.number().int().min(0).max(20000).default(500),
  repeatDays: z.number().int().min(1).max(90).default(7),
  repeats: z.number().int().min(0).max(4).default(1),
  pauseWithAppointment: z.boolean().default(true),
  maintenance: z.boolean().default(true),
  extinguisher: z.boolean().default(true),
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .default("Recordatorio de mantenimiento"),
  template: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .default(
      "{mantenimiento}: {estado}. Consultá el detalle y solicitá un turno en tu portal.",
    ),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export const defaultNotificationSettings = () =>
  notificationSettingsSchema.parse({});
export const preferencesSchema = z.object({
  pushEnabled: z.boolean(),
  maintenance: z.boolean().default(true),
  extinguisher: z.boolean().default(true),
  messages: z.boolean().default(true),
});
export function reminderStage(
  r: Reminder,
  v: Vehicle,
  settings: NotificationSettings,
  asOf = today(),
) {
  const info = dueInfo(r, v, asOf);
  const category =
    r.source === "extinguisher" || r.id.startsWith("fire-")
      ? "extinguisher"
      : "maintenance";
  const soon =
    info.overdue ||
    (info.days !== null && info.days <= settings.daysBefore) ||
    (info.remaining !== null && info.remaining <= settings.kmBefore);
  return {
    ...info,
    soon: settings.enabled && settings[category] && soon,
    category,
  };
}
export function renderNotice(
  settings: NotificationSettings,
  title: string,
  overdue: boolean,
) {
  return settings.template
    .replaceAll("{mantenimiento}", title)
    .replaceAll(
      "{estado}",
      overdue
        ? "vencido; confirmá la fecha y el kilometraje"
        : "se aproxima según la fecha o el uso estimado",
    );
}
