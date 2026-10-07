import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import webpush from "web-push";
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
      for (const tenant of tenants.docs) {
        if (Date.now() - start > 45000) break;
        if (tenant.data().active) {
          const reminders = await tenant.ref
            .collection("reminders")
            .where("status", "==", "active")
            .limit(2001)
            .get();
          if (reminders.size > 2000)
            throw new Error("Reminder scan requires pagination");
          for (const doc of reminders.docs) {
            if (Date.now() - start > 45000) break;
            const r = doc.data() as Reminder;
            const vehicle = await tenant.ref
              .collection("vehicles")
              .doc(r.vehicleId)
              .get();
            if (!vehicle.exists) continue;
            const info = dueInfo(r, vehicle.data() as Vehicle);
            if (!info.soon) continue;
            const noticeId = hash(
              `${r.id}|${r.dueDate}|${r.dueKm}|${info.overdue ? "overdue" : "soon"}`,
            );
            const noticeRef = tenant.ref
              .collection("notifications")
              .doc(noticeId);
            const title = info.overdue
              ? `Revisá tu próximo mantenimiento`
              : `Se acerca un mantenimiento`;
            // Push content deliberately omits plate, name, and account details on lock screens.
            const body = `${r.title}: ${r.dueKm === null ? "revisá el vencimiento registrado" : "según el uso estimado, revisá tu kilometraje"}. Consultá el detalle o solicitá un turno.`;
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
              const live = dueInfo(fresh, vv.data() as Vehicle);
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
              });
              return true;
            });
            if (created === null) continue;
            if (created) notices++;
            if (!enabled) continue;
            const subscriptions = await tenant.ref
              .collection("subscriptions")
              .where("customerId", "==", r.customerId)
              .limit(100)
              .get();
            for (const sub of subscriptions.docs) {
              const receipt = tenant.ref
                .collection("deliveries")
                .doc(hash(noticeId + sub.id));
              const subData = sub.data();
              const maySend = await db.runTransaction(async (tx) => {
                const [delivery, t, m, c, currentReminder, currentVehicle] =
                  await Promise.all([
                    tx.get(receipt),
                    tx.get(tenant.ref),
                    tx.get(tenant.ref.collection("members").doc(subData.uid)),
                    tx.get(
                      tenant.ref.collection("customers").doc(r.customerId),
                    ),
                    tx.get(doc.ref),
                    tx.get(vehicle.ref),
                  ]);
                const member = m.data(),
                  existing = delivery.data();
                if (
                  !currentVehicle.exists ||
                  currentReminder.data()?.dueDate !== r.dueDate ||
                  currentReminder.data()?.dueKm !== r.dueKm ||
                  !dueInfo(
                    currentReminder.data() as Reminder,
                    currentVehicle.data() as Vehicle,
                  ).soon
                )
                  return false;
                if (
                  !t.data()?.active ||
                  currentReminder.data()?.status !== "active" ||
                  member?.active !== true ||
                  member.role !== "customer" ||
                  member.customerId !== r.customerId ||
                  c.data()?.pushEnabled !== true
                )
                  return false;
                if (
                  existing?.status === "sent" ||
                  existing?.status === "permanent-failure" ||
                  existing?.leaseUntil > Date.now() ||
                  (existing?.attempts || 0) >= 5
                )
                  return false;
                tx.set(
                  receipt,
                  {
                    status: "sending",
                    leaseUntil: Date.now() + 90000,
                    attempts: (existing?.attempts || 0) + 1,
                    updatedAt: new Date().toISOString(),
                  },
                  { merge: true },
                );
                return true;
              });
              if (!maySend) continue;
              try {
                await webpush.sendNotification(
                  subData.subscription,
                  JSON.stringify({
                    title: `${tenant.data().name} · ${title}`,
                    body,
                    tag: noticeId,
                  }),
                  { TTL: 86400, timeout: 5000 },
                );
                await receipt.set(
                  {
                    status: "sent",
                    leaseUntil: 0,
                    sentAt: new Date().toISOString(),
                  },
                  { merge: true },
                );
                sent++;
              } catch (error) {
                failed++;
                const status = (error as { statusCode?: number }).statusCode;
                const permanent = status === 404 || status === 410;
                if (permanent) await sub.ref.delete();
                await receipt.set(
                  {
                    status: permanent ? "permanent-failure" : "pending",
                    leaseUntil: 0,
                    statusCode: status || 0,
                  },
                  { merge: true },
                );
              }
            }
          }
          // Repeat this tenant next time if the time budget was exhausted partway through.
          if (Date.now() - start > 45000) break;
        }
        last = tenant.id;
      }
      completed =
        tenants.size < 100 &&
        (tenants.empty || last === tenants.docs.at(-1)?.id);
      await lock.set(
        {
          cursor: completed ? "" : last,
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
