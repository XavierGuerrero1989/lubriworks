import type { Firestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assertAccess,
  canManage,
  key,
  type Tenant,
  type Member,
} from "../shared/model.js";
import {
  notificationSettingsSchema,
  defaultNotificationSettings,
  preferencesSchema,
} from "../shared/notifications.js";
import { readPages } from "./store.js";
export async function notificationRpc(
  db: Firestore,
  tenantId: string,
  uid: string,
  action: string,
  payload: Record<string, unknown>,
  operationId?: string,
) {
  return db.runTransaction(async (tx) => {
    const root = db.doc(`tenants/${tenantId}`);
    const [t, m] = await Promise.all([
      tx.get(root),
      tx.get(root.collection("members").doc(uid)),
    ]);
    const access = assertAccess(
      t.data() as Tenant,
      m.data() as Member,
      uid,
      tenantId,
    );
    const customer = access.member.role === "customer";
    if (!customer && !canManage(access.member.role))
      throw new Error("No tenés permisos para administrar notificaciones.");
    const configRef = root.collection("settings").doc("notifications");
    if (action === "notifications.overview") {
      const config = await tx.get(configRef);
      let sq: FirebaseFirestore.Query = root.collection("subscriptions");
      if (customer) sq = sq.where("uid", "==", uid);
      const subscriptions = await readPages(sq, tx);
      const devices = subscriptions.map((d) => ({
        id: d.id,
        customerId: d.data().customerId,
        label: d.data().label || "Dispositivo registrado",
        updatedAt: d.data().updatedAt,
      }));
      if (customer) {
        const c = await tx.get(
          root.collection("customers").doc(key.parse(access.member.customerId)),
        );
        return {
          devices,
          preferences: preferencesSchema.parse({
            ...c.data()?.notificationPreferences,
            pushEnabled: c.data()?.pushEnabled === true,
          }),
        };
      }
      const deliveries = await readPages(root.collection("deliveries"), tx);
      return {
        settings: notificationSettingsSchema.parse(config.data() || {}),
        devices,
        deliveries: deliveries.map((d) => ({ id: d.id, ...d.data() })),
      };
    }
    if (!operationId) throw new Error("Falta identificador de operación.");
    const receiptRef = root
      .collection("operations")
      .doc(key.parse(operationId));
    const receipt = await tx.get(receiptRef);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ action, payload }))
      .digest("hex");
    if (receipt.exists) {
      if (
        receipt.data()?.uid !== uid ||
        receipt.data()?.fingerprint !== fingerprint
      )
        throw new Error("Identificador reutilizado.");
      return { ok: true };
    }
    if (action === "notifications.settings") {
      if (customer) throw new Error("Acción exclusiva del administrador.");
      tx.set(configRef, notificationSettingsSchema.parse(payload));
    } else if (action === "notifications.preferences") {
      if (!customer) throw new Error("Acción exclusiva del cliente.");
      const data = preferencesSchema.parse(payload);
      const cRef = root
        .collection("customers")
        .doc(key.parse(access.member.customerId));
      const c = await tx.get(cRef);
      if (!c.exists) throw new Error("Cliente no encontrado.");
      const { pushEnabled, ...notificationPreferences } = data;
      tx.update(cRef, { pushEnabled, notificationPreferences });
    } else if (action === "notifications.deviceRemove") {
      const ref = root.collection("subscriptions").doc(key.parse(payload.id));
      const d = await tx.get(ref);
      if (!customer || d.data()?.uid !== uid)
        throw new Error("Dispositivo ajeno.");
      tx.delete(ref);
    } else if (action === "notifications.send") {
      if (customer) throw new Error("Acción exclusiva del administrador.");
      const data = z
        .object({
          customerId: key,
          vehicleId: z.union([key, z.literal("")]).default(""),
          title: z.string().trim().min(1).max(120),
          body: z.string().trim().min(1).max(1000),
        })
        .parse(payload);
      const c = await tx.get(root.collection("customers").doc(data.customerId));
      if (!c.exists) throw new Error("Cliente ajeno o inexistente.");
      if (data.vehicleId) {
        const v = await tx.get(root.collection("vehicles").doc(data.vehicleId));
        if (v.data()?.customerId !== data.customerId)
          throw new Error("Vehículo ajeno.");
      }
      tx.create(root.collection("notifications").doc(operationId), {
        id: operationId,
        ...data,
        category: "messages",
        origin: "manual",
        date: new Date().toISOString(),
        read: false,
        pushStatus: "pending",
      });
    } else if (action === "notifications.retry") {
      if (customer) throw new Error("Acción exclusiva del administrador.");
      const ref = root.collection("deliveries").doc(key.parse(payload.id));
      const d = await tx.get(ref);
      if (!d.exists || d.data()?.status !== "pending")
        throw new Error("Solo se pueden reintentar fallos temporales.");
      const noticeRef = root
        .collection("notifications")
        .doc(key.parse(d.data()?.noticeId));
      const notice = await tx.get(noticeRef);
      if (!notice.exists)
        throw new Error("Aviso no disponible para reintento.");
      tx.update(ref, { attempts: 0, leaseUntil: 0 });
      tx.update(noticeRef, { pushStatus: "pending" });
    } else throw new Error("Acción desconocida.");
    tx.create(receiptRef, {
      uid,
      fingerprint,
      createdAt: new Date().toISOString(),
    });
    tx.create(root.collection("audit").doc(operationId), {
      actor: uid,
      action,
      date: new Date().toISOString(),
    });
    return { ok: true };
  });
}
