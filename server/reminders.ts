import {
  notificationSettingsSchema,
  reminderStage,
  renderNotice,
} from "../shared/notifications.js";
import { sendQueuedNotices } from "./notificationDelivery.js";
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import webpush from "web-push";
import { iteratePages } from "./store.js";
import { admin } from "./firebase.js";
import { respond } from "./rpc.js";
import { dueInfo, type Reminder, type Vehicle } from "../shared/model.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function validCron(
  secret: string | undefined,
  authorization: string | undefined,
) {
  if (!secret || secret.length < 32 || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`),
    actual = Buffer.from(authorization);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  if (req.method !== "GET")
    return respond(res, 405, { error: "Método no permitido." });
  if (!validCron(process.env.CRON_SECRET, req.headers.authorization))
    return respond(res, 401, { error: "No autorizado." });
  const start = Date.now();
  let notices = 0,
    sent = 0,
    failed = 0;
  try {
    const { db } = admin(),
      enabled = Boolean(
        process.env.VAPID_PUBLIC_KEY &&
        process.env.VAPID_PRIVATE_KEY &&
        process.env.VAPID_SUBJECT,
      );
    if (enabled)
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT!,
        process.env.VAPID_PUBLIC_KEY!,
        process.env.VAPID_PRIVATE_KEY!,
      );
    // Lease the scheduler globally; delivery leases below also protect retries.
    const lock = db.doc("systemJobs/reminders");
    const locked = await db.runTransaction(async (tx) => {
      const job = await tx.get(lock);
      if ((job.data()?.leaseUntil || 0) > Date.now()) return false;
      tx.set(lock, { leaseUntil: Date.now() + 90000 }, { merge: true });
      return true;
    });
    if (!locked) return respond(res, 200, { skipped: "already-running" });
    let completed = false;
    try {
      const previous = await lock.get();
      const cursor = previous.data()?.cursor || "";
      let query = db.collection("tenants").orderBy("__name__").limit(100);
      if (cursor) query = query.startAfter(cursor);
      const tenants = await query.get();
      let last = cursor;
      let reminderTenant = String(previous.data()?.reminderTenant || ""),
        reminderCursor = String(previous.data()?.reminderCursor || "");
      for (const tenant of tenants.docs) {
        if (Date.now() - start > 45000) break;
        if (tenant.data().active) {
          if (reminderTenant !== tenant.id) {
            reminderTenant = tenant.id;
            reminderCursor = "";
          }
          const settings = notificationSettingsSchema.parse(
            (
              await tenant.ref.collection("settings").doc("notifications").get()
            ).data() || {},
          );
          const queued = await sendQueuedNotices(tenant.ref, enabled, start);
          sent += queued.sent;
          failed += queued.failed;
          const remindersQuery = tenant.ref
            .collection("reminders")
            .where("status", "==", "active");
          reminderLoop: for await (const doc of iteratePages(
            remindersQuery,
            undefined,
            reminderCursor || undefined,
          )) {
            if (Date.now() - start > 45000) break;
            const r = doc.data() as Reminder;
            const vehicle = await tenant.ref
              .collection("vehicles")
              .doc(r.vehicleId)
              .get();
            if (!vehicle.exists) {
              reminderCursor = doc.id;
              continue;
            }
            const info = reminderStage(r, vehicle.data() as Vehicle, settings);
            if (!info.soon) {
              reminderCursor = doc.id;
              continue;
            }
            if (settings.pauseWithAppointment) {
              const appointments = await tenant.ref
                .collection("appointments")
                .where("vehicleId", "==", r.vehicleId)
                .get();
              if (
                appointments.docs.some(
                  (a) =>
                    ["requested", "confirmed"].includes(a.data().status) &&
                    a.data().date >=
                      new Date().toLocaleDateString("en-CA", {
                        timeZone: "America/Argentina/Buenos_Aires",
                      }),
                )
              ) {
                reminderCursor = doc.id;
                continue;
              }
            }
            const baseId = hash(
              `${r.id}|${r.dueDate}|${r.dueKm}|${info.overdue ? "overdue" : "soon"}`,
            );
            let repeat = 0;
            if (info.overdue) {
              const base = await tenant.ref
                .collection("notifications")
                .doc(baseId)
                .get();
              if (base.exists)
                repeat = Math.min(
                  settings.repeats,
                  Math.max(
                    0,
                    Math.floor(
                      (Date.now() - Date.parse(base.data()!.date)) /
                        864e5 /
                        settings.repeatDays,
                    ),
                  ),
                );
            }
            const noticeId = repeat
              ? hash(baseId + "|repeat|" + repeat)
              : baseId;
            const noticeRef = tenant.ref
              .collection("notifications")
              .doc(noticeId);
            const title = settings.title;
            const body = renderNotice(settings, r.title, info.overdue);
            const created = await db.runTransaction(async (tx) => {
              const [n, t, rr, vv] = await Promise.all([
                tx.get(noticeRef),
                tx.get(tenant.ref),
                tx.get(doc.ref),
                tx.get(vehicle.ref),
              ]);
              const fresh = rr.data() as Reminder | undefined;
              if (
                !t.data()?.active ||
                fresh?.status !== "active" ||
                !vv.exists ||
                fresh.dueDate !== r.dueDate ||
                fresh.dueKm !== r.dueKm
              )
                return null;
              const live = reminderStage(fresh, vv.data() as Vehicle, settings);
              if (!live.soon || live.overdue !== info.overdue) return null;
              if (n.exists) return false;
              tx.create(noticeRef, {
                id: noticeId,
                customerId: r.customerId,
                vehicleId: r.vehicleId,
                title,
                body,
                date: new Date().toISOString(),
                read: false,
                dueDate: r.dueDate,
                dueKm: r.dueKm,
                reminderId: r.id,
                category: info.category,
                origin: "automatic",
                pushStatus: "pending",
              });
              return true;
            });
            if (created === null) {
              reminderCursor = doc.id;
              continue;
            }
            if (created) notices++;
            if (!enabled) {
              reminderCursor = doc.id;
              continue;
            }
            reminderCursor = doc.id;
          }
          const queuedAfter = await sendQueuedNotices(
            tenant.ref,
            enabled,
            start,
          );
          sent += queuedAfter.sent;
          failed += queuedAfter.failed;
          // Repeat this tenant next time if the time budget was exhausted partway through.
          if (Date.now() - start > 45000) break;
        }
        last = tenant.id;
        reminderTenant = "";
        reminderCursor = "";
      }
      completed =
        tenants.size < 100 &&
        (tenants.empty || last === tenants.docs.at(-1)?.id);
      await lock.set(
        {
          cursor: completed ? "" : last,
          reminderTenant: completed ? "" : reminderTenant,
          reminderCursor: completed ? "" : reminderCursor,
          leaseUntil: 0,
          lastRunAt: new Date().toISOString(),
          completed,
          notices,
          sent,
          failed,
          pushConfigured: enabled,
        },
        { merge: true },
      );
    } finally {
      await lock.set({ leaseUntil: 0 }, { merge: true });
    }
    respond(res, 200, {
      notices,
      sent,
      failed,
      completed,
      pushConfigured: enabled,
    });
  } catch (error) {
    console.error(
      "Reminder job failed",
      error instanceof Error ? error.message : "unknown",
    );
    respond(res, 500, {
      error: "No se completó la revisión de recordatorios.",
      notices,
      sent,
      failed,
    });
  }
}
