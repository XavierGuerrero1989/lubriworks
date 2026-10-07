import { overview, team, saveMember } from "./platform.js";
import { createHash } from "node:crypto";
import { z, ZodError } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import { admin } from "./firebase.js";
import {
  assertAccess,
  key,
  projectState,
  roles,
  type Member,
  type Tenant,
} from "../shared/model.js";
import { execute, type Command } from "../shared/engine.js";
import { loadState, persistDiff } from "./store.js";
const envelope = z.object({
  action: z.string().max(60),
  tenantId: key.optional(),
  operationId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).default({}),
});
export async function readJson(req: IncomingMessage & { body?: unknown }) {
  if (req.body !== undefined)
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  let data = "";
  for await (const part of req) {
    data += part;
    if (Buffer.byteLength(data) > 262144)
      throw new Error("Solicitud demasiado grande.");
  }
  return JSON.parse(data || "{}");
}
export const respond = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};
export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
) {
  try {
    if (req.method !== "POST")
      return respond(res, 405, { error: "Método no permitido." });
    const origin = req.headers.origin;
    const allowed = process.env.APP_ORIGIN;
    if (
      origin &&
      origin !== allowed &&
      !(
        process.env.NODE_ENV !== "production" &&
        ["http://localhost:5180", "http://127.0.0.1:5180"].includes(origin)
      )
    )
      return respond(res, 403, { error: "Origen no autorizado." });
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token)
      return respond(res, 401, { error: "Iniciá sesión para continuar." });
    const { db, auth } = admin();
    let identity;
    try {
      identity = await auth.verifyIdToken(token, true);
    } catch {
      return respond(res, 401, {
        error: "La sesión venció. Volvé a ingresar.",
      });
    }
    const uid = key.parse(identity.uid);
    const { action, tenantId, operationId, payload } = envelope.parse(
      await readJson(req),
    );
    if (action === "access") {
      const index = await db.collection(`userTenants/${uid}/tenants`).get();
      const access = (
        await Promise.all(
          index.docs.map(async (d) => {
            try {
              key.parse(d.id);
              const [t, m] = await Promise.all([
                db.doc(`tenants/${d.id}`).get(),
                db.doc(`tenants/${d.id}/members/${uid}`).get(),
              ]);
              return assertAccess(
                t.data() as Tenant,
                m.data() as Member,
                uid,
                d.id,
              );
            } catch {
              return null;
            }
          }),
        )
      ).filter(Boolean);
      const platform = await db.doc(`platformAdmins/${uid}`).get();
      return respond(res, 200, {
        access,
        platform: platform.data()?.active === true,
      });
    }
    if (action.startsWith("platform.")) {
      if ((await db.doc(`platformAdmins/${uid}`).get()).data()?.active !== true)
        return respond(res, 403, { error: "Acceso de plataforma requerido." });
      if (action === "platform.overview")
        return respond(res, 200, await overview(db, uid, payload));
      if (action === "platform.team")
        return respond(res, 200, await team(db, uid, payload));
      if (action === "platform.member.save")
        return respond(res, 200, await saveMember(db, auth, uid, payload));
      if (action === "platform.list") {
        const tenants = await db.collection("tenants").limit(200).get();
        return respond(
          res,
          200,
          tenants.docs.map((d) => ({ ...d.data(), id: d.id })),
        );
      }
      if (action === "platform.create") {
        const data = z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
            name: z.string().trim().min(2).max(120),
            ownerEmail: z.string().email(),
          })
          .parse(payload);
        const owner = await auth.getUserByEmail(data.ownerEmail);
        if (owner.disabled)
          throw new Error("La cuenta del administrador debe estar habilitada.");
        await db.runTransaction(async (tx) => {
          const t = db.doc(`tenants/${data.id}`);
          const [old, platform] = await Promise.all([
            tx.get(t),
            tx.get(db.doc(`platformAdmins/${uid}`)),
          ]);
          if (platform.data()?.active !== true)
            throw new Error("Acceso revocado.");
          if (old.exists)
            throw new Error("Ya existe una empresa con ese identificador.");
          const tenant: Tenant = {
            id: data.id,
            name: data.name,
            active: true,
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
          };
          const member: Member = {
            uid: owner.uid,
            tenantId: data.id,
            name: owner.displayName || data.ownerEmail,
            email: data.ownerEmail,
            active: true,
            role: "owner",
            customerId: null,
          };
          tx.create(t, tenant);
          tx.create(db.doc(`tenants/${data.id}/members/${owner.uid}`), member);
          tx.set(db.doc(`userTenants/${owner.uid}/tenants/${data.id}`), {
            tenantId: data.id,
          });
          tx.create(db.doc(`tenants/${data.id}/branches/main`), {
            id: "main",
            name: "Casa central",
            address: "",
          });
          tx.create(db.doc(`tenants/${data.id}/audit/${crypto.randomUUID()}`), {
            actor: uid,
            action,
            date: tenant.createdAt,
          });
        });
        return respond(res, 200, { ok: true });
      }
      if (action === "platform.status") {
        const data = z.object({ id: key, active: z.boolean() }).parse(payload);
        await db.runTransaction(async (tx) => {
          const p = await tx.get(db.doc(`platformAdmins/${uid}`));
          const t = await tx.get(db.doc(`tenants/${data.id}`));
          if (p.data()?.active !== true || !t.exists)
            throw new Error("Acceso denegado.");
          tx.update(t.ref, { active: data.active });
          tx.create(db.doc(`tenants/${data.id}/audit/${crypto.randomUUID()}`), {
            actor: uid,
            action,
            active: data.active,
            date: new Date().toISOString(),
          });
        });
        return respond(res, 200, { ok: true });
      }
      throw new Error("Acción desconocida.");
    }
    if (!tenantId) throw new Error("Seleccioná una empresa.");
    const tref = db.doc(`tenants/${tenantId}`),
      mref = db.doc(`tenants/${tenantId}/members/${uid}`);
    if (action === "snapshot" || action === "members") {
      const result = await db.runTransaction(
        async (tx) => {
          const [t, m] = await Promise.all([tx.get(tref), tx.get(mref)]);
          const access = assertAccess(
            t.data() as Tenant,
            m.data() as Member,
            uid,
            tenantId,
          );
          if (action === "members") {
            if (access.member.role !== "owner")
              throw new Error("Sólo el administrador gestiona accesos.");
            return (
              await tx.get(db.collection(`tenants/${tenantId}/members`))
            ).docs.map((d) => d.data());
          }
          const state = await loadState(db, tenantId, tx);
          return {
            access,
            state: projectState(state, access.member),
            vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "",
          };
        },
        { readOnly: true },
      );
      return respond(res, 200, result);
    }
    if (action === "member.save") {
      const [initialTenant, initialMember] = await Promise.all([
        tref.get(),
        mref.get(),
      ]);
      if (
        assertAccess(
          initialTenant.data() as Tenant,
          initialMember.data() as Member,
          uid,
          tenantId,
        ).member.role !== "owner"
      )
        throw new Error("Sólo el administrador gestiona accesos.");
      const data = z
        .object({
          email: z.string().email(),
          name: z.string().trim().min(2).max(120),
          role: z.enum(roles),
          active: z.boolean(),
          customerId: key.nullable(),
        })
        .parse(payload);
      const user = await auth.getUserByEmail(data.email);
      if (user.disabled)
        throw new Error("La cuenta del usuario debe estar habilitada.");
      await db.runTransaction(async (tx) => {
        const [t, m, team, customer] = await Promise.all([
          tx.get(tref),
          tx.get(mref),
          tx.get(db.collection(`tenants/${tenantId}/members`)),
          data.customerId
            ? tx.get(db.doc(`tenants/${tenantId}/customers/${data.customerId}`))
            : Promise.resolve(null),
        ]);
        const access = assertAccess(
          t.data() as Tenant,
          m.data() as Member,
          uid,
          tenantId,
        );
        if (access.member.role !== "owner")
          throw new Error("Sólo el administrador gestiona accesos.");
        if (data.role === "customer" && (!customer?.exists || !data.customerId))
          throw new Error("Seleccioná un cliente de esta empresa.");
        if (data.role !== "customer" && data.customerId !== null)
          throw new Error(
            "Los empleados no se vinculan a una ficha de cliente.",
          );
        if (
          data.role === "customer" &&
          team.docs.some(
            (d) =>
              d.id !== user.uid &&
              d.data().active &&
              d.data().customerId === data.customerId,
          )
        )
          throw new Error("Este cliente ya tiene un acceso activo.");
        const remaining = team.docs.filter(
          (d) =>
            d.id !== user.uid && d.data().active && d.data().role === "owner",
        );
        if ((!data.active || data.role !== "owner") && !remaining.length)
          throw new Error("La empresa debe conservar un administrador activo.");
        const member: Member = { uid: user.uid, tenantId, ...data };
        tx.set(db.doc(`tenants/${tenantId}/members/${user.uid}`), member);
        tx.set(db.doc(`userTenants/${user.uid}/tenants/${tenantId}`), {
          tenantId,
        });
        tx.create(db.doc(`tenants/${tenantId}/audit/${crypto.randomUUID()}`), {
          actor: uid,
          action,
          target: user.uid,
          role: data.role,
          active: data.active,
          date: new Date().toISOString(),
        });
      });
      return respond(res, 200, { ok: true });
    }
    if (action === "push.subscribe" || action === "push.unsubscribe") {
      const subscription = z
        .object({
          endpoint: z.string().url().max(2000),
          keys: z.object({
            p256dh: z.string().min(40).max(200),
            auth: z.string().min(10).max(100),
          }),
        })
        .parse(payload);
      const url = new URL(subscription.endpoint);
      const permitted = [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
        "wns.windows.com",
      ];
      if (
        url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        !permitted.some(
          (h) => url.hostname === h || url.hostname.endsWith("." + h),
        )
      )
        throw new Error("Proveedor push no admitido.");
      const sid = createHash("sha256")
        .update(uid + subscription.endpoint)
        .digest("hex");
      await db.runTransaction(async (tx) => {
        const [t, m] = await Promise.all([tx.get(tref), tx.get(mref)]);
        const access = assertAccess(
          t.data() as Tenant,
          m.data() as Member,
          uid,
          tenantId,
        );
        if (access.member.role !== "customer")
          throw new Error("Activá los avisos desde el portal cliente.");
        const ref = db.doc(`tenants/${tenantId}/subscriptions/${sid}`);
        if (action === "push.unsubscribe") tx.delete(ref);
        else
          tx.set(ref, {
            uid,
            customerId: access.member.customerId,
            subscription,
            updatedAt: new Date().toISOString(),
          });
      });
      return respond(res, 200, { ok: true });
    }
    if (action === "command") {
      if (!operationId) throw new Error("Falta identificador de operación.");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");
      const result = await db.runTransaction(async (tx) => {
        const [t, m, receipt] = await Promise.all([
          tx.get(tref),
          tx.get(mref),
          tx.get(db.doc(`tenants/${tenantId}/operations/${operationId}`)),
        ]);
        const access = assertAccess(
          t.data() as Tenant,
          m.data() as Member,
          uid,
          tenantId,
        );
        if (receipt.exists) {
          if (
            receipt.data()?.uid !== uid ||
            receipt.data()?.fingerprint !== fingerprint
          )
            throw new Error("Identificador de operación reutilizado.");
          return { ok: true, replayed: true };
        }
        const before = await loadState(db, tenantId, tx);
        const after = execute(
          before,
          access.member,
          payload as Command,
          operationId,
        );
        persistDiff(db, tx, tenantId, before, after);
        tx.create(receipt.ref, {
          uid,
          fingerprint,
          createdAt: new Date().toISOString(),
        });
        tx.create(db.doc(`tenants/${tenantId}/audit/${operationId}`), {
          actor: uid,
          action: payload.action,
          collection: payload.collection || null,
          target: payload.id || operationId,
          date: new Date().toISOString(),
        });
        return { ok: true };
      });
      return respond(res, 200, result);
    }
    throw new Error("Acción desconocida.");
  } catch (error) {
    const e = error as Error;
    const code = (error as any)?.code;
    const message =
      error instanceof ZodError
        ? error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
        : code === "auth/user-not-found"
          ? "No existe una cuenta con ese correo. Pedile que se registre primero."
          : e.message;
    const internal = code && code !== "auth/user-not-found";
    if (internal) console.error("RPC failure", code);
    return respond(res, internal ? 500 : 400, {
      error: internal
        ? "No se pudo completar la operación. Intentá nuevamente."
        : message,
    });
  }
}
