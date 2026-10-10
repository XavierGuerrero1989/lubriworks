import { createHash } from "node:crypto";
import webpush from "web-push";
import {
  notificationSettingsSchema,
  reminderStage,
} from "../shared/notifications.js";
import { visitObsolete } from "../shared/visitNotices.js";
import {
  today,
  type Notice,
  type Reminder,
  type Vehicle,
  type State,
} from "../shared/model.js";
import { iteratePages } from "./store.js";
export const pushConfigured = () =>
  Boolean(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT,
  );
export async function dispatchNotices(
  root: FirebaseFirestore.DocumentReference,
  ids: string[],
) {
  if (!ids.length || !pushConfigured()) return;
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    await sendQueuedNotices(root, true, Date.now(), { ids, budgetMs: 10000 });
  } catch {
    console.error(
      "Immediate push deferred; notices remain in the durable queue.",
    );
  }
}
export async function sendQueuedNotices(
  root: FirebaseFirestore.DocumentReference,
  enabled: boolean,
  start: number,
  options: { ids?: string[]; budgetMs?: number } = {},
) {
  const result = { sent: 0, failed: 0 };
  if (!enabled) return result;
  const expired = () => Date.now() - start > (options.budgetMs ?? 40000);
  async function* notices() {
    if (options.ids) {
      for (const id of options.ids) {
        if (expired()) return;
        const d = await root.collection("notifications").doc(id).get();
        if (d.exists && d.data()?.pushStatus === "pending") yield d;
      }
    } else
      yield* iteratePages(
        root.collection("notifications").where("pushStatus", "==", "pending"),
      );
  }
  for await (const notice of notices()) {
    if (expired()) return result;
    const n = notice.data() as Notice;
    const condition = async (
      tx: FirebaseFirestore.Transaction,
    ): Promise<string> => {
      const [tenant, customer, config] = await Promise.all([
        tx.get(root),
        tx.get(root.collection("customers").doc(n.customerId)),
        tx.get(root.collection("settings").doc("notifications")),
      ]);
      const freshNotice = await tx.get(notice.ref);
      if (freshNotice.data()?.newsHiddenAt)
        return "Retirado de Novedades por el lubricentro";
      if (!tenant.data()?.active) return "Empresa inactiva";
      if (!customer.exists) return "Cliente no disponible";
      const settings = notificationSettingsSchema.parse(config.data() || {});
      if (n.origin === "operational") {
        const state: Pick<State, "appointments" | "orders"> = {
          appointments: [],
          orders: [],
        };
        if (n.appointmentId) {
          const a = await tx.get(
            root.collection("appointments").doc(n.appointmentId),
          );
          if (a.exists)
            state.appointments = [
              { ...a.data(), id: a.id } as State["appointments"][number],
            ];
        }
        if (n.orderId) {
          const o = await tx.get(root.collection("orders").doc(n.orderId));
          if (o.exists)
            state.orders = [
              { ...o.data(), id: o.id } as State["orders"][number],
            ];
        }
        const obsolete = visitObsolete(n, state);
        if (obsolete) return `Resuelto: ${obsolete}`;
        if (!settings.visitEnabled)
          return "Avisos de visita desactivados en la empresa";
      }
      if (n.reminderId) {
        const [r, v, appointments] = await Promise.all([
          tx.get(root.collection("reminders").doc(n.reminderId)),
          tx.get(root.collection("vehicles").doc(n.vehicleId)),
          tx.get(
            root
              .collection("appointments")
              .where("vehicleId", "==", n.vehicleId),
          ),
        ]);
        if (
          r.data()?.status !== "active" ||
          !v.exists ||
          r.data()?.dueDate !== n.dueDate ||
          r.data()?.dueKm !== n.dueKm ||
          !reminderStage(r.data() as Reminder, v.data() as Vehicle, settings)
            .soon
        )
          return "Resuelto: el mantenimiento cambió o ya no requiere aviso";
        if (
          settings.pauseWithAppointment &&
          appointments.docs.some(
            (a) =>
              ["requested", "confirmed"].includes(a.data().status) &&
              a.data().date >= today(),
          )
        )
          return "Pausado: tiene turno";
      }
      if (customer.data()?.pushEnabled !== true)
        return "Push desactivado por el cliente";
      if (
        customer.data()?.notificationPreferences?.[n.category || "messages"] ===
        false
      )
        return "Categoría desactivada por el cliente";
      return "";
    };
    const blocked = await root.firestore.runTransaction(async (tx) => {
      const fresh = await tx.get(notice.ref);
      if (fresh.data()?.pushStatus !== "pending")
        return "Procesado por otra ejecución";
      const reason = await condition(tx);
      if (reason && !reason.startsWith("Pausado:"))
        tx.update(notice.ref, {
          pushStatus: reason.startsWith("Resuelto:") ? "superseded" : "skipped",
          pushReason: reason,
        });
      return reason;
    });
    if (blocked) continue;
    let subscriptions = 0,
      accepted = 0,
      permanent = 0,
      pending = false;
    for await (const sub of iteratePages(
      root.collection("subscriptions").where("customerId", "==", n.customerId),
    )) {
      if (expired()) return result;
      subscriptions++;
      const ref = root.collection("deliveries").doc(
        createHash("sha256")
          .update(notice.id + sub.id)
          .digest("hex"),
      );
      const eligible = await root.firestore.runTransaction(async (tx) => {
        const [d, s, fresh, m] = await Promise.all([
          tx.get(ref),
          tx.get(sub.ref),
          tx.get(notice.ref),
          tx.get(root.collection("members").doc(sub.data().uid)),
        ]);
        if (
          !s.exists ||
          fresh.data()?.pushStatus !== "pending" ||
          m.data()?.active !== true ||
          m.data()?.role !== "customer" ||
          m.data()?.customerId !== n.customerId
        )
          return "blocked";
        if (await condition(tx)) return "blocked";
        const data = d.data();
        if (data?.status === "sent") return "sent";
        if (
          data?.status === "permanent-failure" ||
          data?.status === "exhausted"
        )
          return "failed";
        if (data?.leaseUntil > Date.now() || data?.nextAttemptAt > Date.now())
          return "pending";
        if ((data?.attempts || 0) >= 5) {
          tx.set(ref, { status: "exhausted", leaseUntil: 0 }, { merge: true });
          return "failed";
        }
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
        return "send";
      });
      if (eligible === "sent") {
        accepted++;
        continue;
      }
      if (eligible === "failed") {
        permanent++;
        continue;
      }
      if (eligible === "pending") {
        pending = true;
        continue;
      }
      if (eligible !== "send") continue;
      try {
        await webpush.sendNotification(
          sub.data().subscription,
          JSON.stringify({
            title:
              n.origin === "operational"
                ? "LubriWorks · Aviso de tu visita"
                : n.origin === "manual"
                  ? "LubriWorks · Nuevo mensaje"
                  : "LubriWorks · Recordatorio",
            body:
              n.origin === "operational"
                ? "Tu lubricentro actualizó tu turno o visita. Consultá el detalle en tu portal."
                : n.origin === "manual"
                  ? "Tu lubricentro te envió un mensaje. Consultalo en tu portal."
                  : "Revisá tu próximo mantenimiento en el portal y solicitá un turno.",
            tag: notice.id,
            tenantId: root.id,
          }),
          { TTL: n.origin === "operational" ? 3600 : 86400, timeout: 5000 },
        );
        result.sent++;
        accepted++;
        await ref.set(
          {
            status: "sent",
            leaseUntil: 0,
            nextAttemptAt: 0,
            sentAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      } catch (error) {
        result.failed++;
        const code = (error as { statusCode?: number }).statusCode || 0;
        const attempts = (await ref.get()).data()?.attempts || 1;
        const terminal = code === 404 || code === 410;
        const exhausted = attempts >= 5;
        if (terminal) await sub.ref.delete();
        await ref.set(
          {
            status: terminal
              ? "permanent-failure"
              : exhausted
                ? "exhausted"
                : "pending",
            statusCode: code,
            leaseUntil: 0,
            nextAttemptAt:
              terminal || exhausted
                ? 0
                : Date.now() + Math.min(3600000, 60000 * 2 ** (attempts - 1)),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
        if (terminal || exhausted) permanent++;
        else pending = true;
      }
    }
    // Terminal per-device failures remain visible even after their subscription expires.
    for await (const d of iteratePages(
      root.collection("deliveries").where("noticeId", "==", notice.id),
    ))
      if (["permanent-failure", "exhausted"].includes(d.data().status))
        permanent = Math.max(1, permanent);
    await root.firestore.runTransaction(async (tx) => {
      const fresh = await tx.get(notice.ref);
      if (fresh.data()?.pushStatus !== "pending") return;
      const reason = await condition(tx);
      if (reason) {
        if (!reason.startsWith("Pausado:"))
          tx.update(notice.ref, {
            pushStatus: reason.startsWith("Resuelto:")
              ? "superseded"
              : "skipped",
            pushReason: reason,
          });
        return;
      }
      if (pending) return;
      tx.update(notice.ref, {
        pushStatus: permanent ? "failed" : accepted ? "sent" : "skipped",
        pushReason: permanent
          ? "Uno o más dispositivos no aceptaron el aviso"
          : !subscriptions
            ? "Sin dispositivos registrados"
            : !accepted
              ? "Sin dispositivos con acceso activo"
              : "",
      });
    });
  }
  return result;
}
