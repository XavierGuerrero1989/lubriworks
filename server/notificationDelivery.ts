import { createHash } from "node:crypto";
import webpush from "web-push";
import {
  notificationSettingsSchema,
  reminderStage,
} from "../shared/notifications.js";
import { today, type Reminder, type Vehicle } from "../shared/model.js";
import { iteratePages } from "./store.js";
export async function sendQueuedNotices(
  root: FirebaseFirestore.DocumentReference,
  enabled: boolean,
  start: number,
) {
  const result = { sent: 0, failed: 0 };
  if (!enabled) return result;
  for await (const notice of iteratePages(
    root.collection("notifications").where("pushStatus", "==", "pending"),
  )) {
    if (Date.now() - start > 40000) return result;
    const n = notice.data();
    let attempted = false,
      retryNeeded = false;
    // Per-device receipts prevent duplicates when a notice is retried.
    for await (const sub of iteratePages(
      root.collection("subscriptions").where("customerId", "==", n.customerId),
    )) {
      if (Date.now() - start > 40000) return result;
      const ref = root.collection("deliveries").doc(
        createHash("sha256")
          .update(notice.id + sub.id)
          .digest("hex"),
      );
      const eligible = await root.firestore.runTransaction(async (tx) => {
        const [t, c, m, d, s, fresh] = await Promise.all([
          tx.get(root),
          tx.get(root.collection("customers").doc(n.customerId)),
          tx.get(root.collection("members").doc(sub.data().uid)),
          tx.get(ref),
          tx.get(sub.ref),
          tx.get(notice.ref),
        ]);
        if (
          !t.data()?.active ||
          !s.exists ||
          !fresh.exists ||
          m.data()?.active !== true ||
          m.data()?.role !== "customer" ||
          m.data()?.customerId !== n.customerId ||
          c.data()?.pushEnabled !== true ||
          c.data()?.notificationPreferences?.[n.category || "messages"] ===
            false
        )
          return false;
        if (n.reminderId) {
          const [r, v, config, appointments] = await Promise.all([
            tx.get(root.collection("reminders").doc(n.reminderId)),
            tx.get(root.collection("vehicles").doc(n.vehicleId)),
            tx.get(root.collection("settings").doc("notifications")),
            tx.get(
              root
                .collection("appointments")
                .where("vehicleId", "==", n.vehicleId),
            ),
          ]);
          const settings = notificationSettingsSchema.parse(
            config.data() || {},
          );
          if (
            r.data()?.status !== "active" ||
            !v.exists ||
            r.data()?.dueDate !== n.dueDate ||
            r.data()?.dueKm !== n.dueKm ||
            !reminderStage(r.data() as Reminder, v.data() as Vehicle, settings)
              .soon ||
            (settings.pauseWithAppointment &&
              appointments.docs.some(
                (a) =>
                  ["requested", "confirmed"].includes(a.data().status) &&
                  a.data().date >= today(),
              ))
          )
            return false;
        }
        const data = d.data();
        if (
          data?.status === "sent" ||
          data?.status === "permanent-failure" ||
          data?.leaseUntil > Date.now() ||
          (data?.attempts || 0) >= 5
        )
          return false;
        tx.set(
          ref,
          {
            noticeId: notice.id,
            customerId: n.customerId,
            subscriptionId: sub.id,
            status: "sending",
            attempts: (data?.attempts || 0) + 1,
            leaseUntil: Date.now() + 90000,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
        return true;
      });
      if (!eligible) continue;
      attempted = true;
      try {
        // Manual content stays in the portal so personal data is not exposed on a lock screen.
        await webpush.sendNotification(
          sub.data().subscription,
          JSON.stringify({
            title:
              n.origin === "manual"
                ? "LubriWorks · Nuevo mensaje"
                : "LubriWorks · Recordatorio",
            body:
              n.origin === "manual"
                ? "Tu lubricentro te envió un mensaje. Consultalo en tu portal."
                : "Revisá tu próximo mantenimiento en el portal y solicitá un turno.",
            tag: notice.id,
          }),
          { TTL: 86400, timeout: 5000 },
        );
        result.sent++;
        await ref.set(
          { status: "sent", leaseUntil: 0, sentAt: new Date().toISOString() },
          { merge: true },
        );
      } catch (error) {
        result.failed++;
        retryNeeded = true;
        const code = (error as { statusCode?: number }).statusCode || 0;
        if (code === 404 || code === 410) await sub.ref.delete();
        await ref.set(
          {
            status:
              code === 404 || code === 410 ? "permanent-failure" : "pending",
            statusCode: code,
            leaseUntil: 0,
          },
          { merge: true },
        );
      }
    }
    if (attempted && !retryNeeded)
      await notice.ref.set({ pushStatus: "sent" }, { merge: true });
  }
  return result;
}
