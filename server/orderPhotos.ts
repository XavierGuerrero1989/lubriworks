import { createHash } from "node:crypto";
import { z } from "zod";
import type { Firestore } from "firebase-admin/firestore";
import {
  assertAccess,
  key,
  orderPhotoSchema,
  type Member,
  type Tenant,
} from "../shared/model.js";
import { orderEvent, workStage, type Order } from "../shared/orders.js";
export async function orderPhotoRpc(
  db: Firestore,
  tenantId: string,
  uid: string,
  action: string,
  payload: Record<string, unknown>,
  operationId?: string,
) {
  const orderId = key.parse(payload.orderId),
    orderRef = db.doc(`tenants/${tenantId}/orders/${orderId}`);
  return db.runTransaction(async (tx) => {
    const [t, m, odoc] = await Promise.all([
      tx.get(db.doc(`tenants/${tenantId}`)),
      tx.get(db.doc(`tenants/${tenantId}/members/${uid}`)),
      tx.get(orderRef),
    ]);
    const access = assertAccess(
      t.data() as Tenant,
      m.data() as Member,
      uid,
      tenantId,
    );
    if (access.member.role === "customer")
      throw new Error("Las fotos internas son exclusivas del lubricentro.");
    if (!odoc.exists) throw new Error("Orden no encontrada en esta empresa.");
    const o = { ...odoc.data(), id: odoc.id } as Order;
    if (action === "order.photo.read") {
      const photoId = key.parse(payload.photoId);
      if (!o.photos?.some((p) => p.id === photoId))
        throw new Error("Foto no vinculada a esta orden.");
      const photo = await tx.get(
        db.doc(`tenants/${tenantId}/orderPhotos/${photoId}`),
      );
      if (!photo.exists || photo.data()?.orderId !== orderId)
        throw new Error("Foto no encontrada.");
      return { dataUrl: `data:image/jpeg;base64,${photo.data()!.base64}` };
    }
    if (action !== "order.photo.upload" || !operationId)
      throw new Error("Operación de foto inválida.");
    const parsed = z
      .object({
        base64: z
          .string()
          .min(4)
          .max(240000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        caption: z.string().trim().max(300),
        phase: z.enum(["arrival", "work", "delivery"]),
      })
      .parse(payload);
    const bytes = Buffer.from(parsed.base64, "base64");
    if (
      bytes.length > 180000 ||
      bytes.length < 4 ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[2] !== 255 ||
      bytes.at(-2) !== 255 ||
      bytes.at(-1) !== 217 ||
      bytes.toString("base64") !== parsed.base64
    )
      throw new Error("La foto debe ser un JPEG optimizado de hasta 180 KB.");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    const receipt = await tx.get(
      db.doc(`tenants/${tenantId}/operations/${operationId}`),
    );
    if (receipt.exists) {
      if (
        receipt.data()?.uid !== uid ||
        receipt.data()?.fingerprint !== fingerprint
      )
        throw new Error("Identificador de operación reutilizado.");
      return { ok: true, replayed: true };
    }
    if (["cancelled", "delivered"].includes(workStage(o)))
      throw new Error("La orden está cerrada; no se pueden agregar fotos.");
    const at = new Date().toISOString();
    const meta = orderPhotoSchema.parse({
      id: operationId,
      caption: parsed.caption,
      phase: parsed.phase,
      at,
      by: uid,
    });
    (o.photos ??= []).push(meta);
    orderEvent(
      o,
      operationId,
      "Foto registrada",
      uid,
      at,
      parsed.caption,
      access.member.name,
    );
    tx.create(db.doc(`tenants/${tenantId}/orderPhotos/${operationId}`), {
      orderId,
      base64: parsed.base64,
      ...meta,
    });
    tx.set(orderRef, o);
    tx.create(receipt.ref, { uid, fingerprint, createdAt: at });
    tx.create(db.doc(`tenants/${tenantId}/audit/${operationId}`), {
      actor: uid,
      action,
      target: orderId,
      date: at,
    });
    return { ok: true };
  });
}
