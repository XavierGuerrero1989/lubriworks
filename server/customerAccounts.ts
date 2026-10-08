import { createHash } from "node:crypto";
import { z } from "zod";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import {
  assertAccess,
  canManage,
  key,
  schemas,
  type Tenant,
  type Member,
} from "../shared/model.js";
export async function createCustomerAccount(
  db: Firestore,
  auth: Auth,
  tenantId: string,
  uid: string,
  payload: Record<string, unknown>,
  operationId: string,
) {
  key.parse(operationId);
  const password = z
    .string()
    .min(8, "Usá al menos 8 caracteres para la contraseña.")
    .max(128)
    .parse(payload.password);
  const data = schemas.customers.parse(payload.data);
  data.email = data.email.trim().toLowerCase();
  const root = db.doc(`tenants/${tenantId}`),
    job = root.collection("customerProvisioning").doc(operationId);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
  const authUid =
    "customer-" +
    createHash("sha256")
      .update(tenantId + "|" + operationId)
      .digest("hex")
      .slice(0, 48);
  const assertManager = async (tx: FirebaseFirestore.Transaction) => {
    const [t, m] = await Promise.all([
      tx.get(root),
      tx.get(root.collection("members").doc(uid)),
    ]);
    const a = assertAccess(
      t.data() as Tenant,
      m.data() as Member,
      uid,
      tenantId,
    );
    if (!canManage(a.member.role))
      throw new Error(
        "Sólo el administrador o encargado puede crear cuentas de clientes.",
      );
  };
  const done = await db.runTransaction(async (tx) => {
    await assertManager(tx);
    const j = await tx.get(job);
    if (
      j.exists &&
      (j.data()?.actor !== uid || j.data()?.fingerprint !== fingerprint)
    )
      throw new Error("Identificador de alta reutilizado.");
    if (j.data()?.status === "done") return true;
    const duplicate = await tx.get(
      root.collection("customers").where("email", "==", data.email),
    );
    if (!duplicate.empty)
      throw new Error(
        "Ya existe una ficha con ese correo. Usá Configuración → Accesos para vincular su cuenta.",
      );
    tx.set(job, {
      actor: uid,
      fingerprint,
      authUid,
      status: "pending",
      createdAt: j.data()?.createdAt || new Date().toISOString(),
    });
    return false;
  });
  if (done) return { ok: true, customerId: operationId };
  let user;
  try {
    user = await auth.getUserByEmail(data.email);
  } catch (e) {
    if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
  }
  if (user && user.uid !== authUid)
    throw new Error(
      "Ese correo ya tiene una cuenta. Vinculala desde Configuración → Accesos; su contraseña actual se conserva.",
    );
  if (!user) {
    try {
      user = await auth.createUser({
        uid: authUid,
        email: data.email,
        password,
        displayName: data.name,
        emailVerified: false,
      });
    } catch (e) {
      if (
        ["auth/email-already-exists", "auth/uid-already-exists"].includes(
          (e as { code?: string }).code || "",
        )
      ) {
        user = await auth.getUserByEmail(data.email);
        if (user.uid !== authUid)
          throw new Error(
            "Ese correo ya tiene una cuenta. Vinculala desde Configuración → Accesos.",
          );
      } else throw e;
    }
  }
  if (user.disabled) throw new Error("La cuenta está deshabilitada.");
  await db.runTransaction(async (tx) => {
    await assertManager(tx);
    const [j, existing, m, duplicates] = await Promise.all([
      tx.get(job),
      tx.get(root.collection("customers").doc(operationId)),
      tx.get(root.collection("members").doc(authUid)),
      tx.get(root.collection("customers").where("email", "==", data.email)),
    ]);
    if (j.data()?.actor !== uid || j.data()?.fingerprint !== fingerprint)
      throw new Error("Alta inválida.");
    if (j.data()?.status === "done") return;
    if (existing.exists || m.exists || !duplicates.empty)
      throw new Error("El cliente ya fue registrado. Revisá sus accesos.");
    tx.create(root.collection("customers").doc(operationId), {
      id: operationId,
      ...data,
    });
    tx.create(root.collection("members").doc(authUid), {
      uid: authUid,
      tenantId,
      role: "customer",
      active: true,
      name: data.name,
      email: data.email,
      customerId: operationId,
    });
    tx.set(db.doc(`userTenants/${authUid}/tenants/${tenantId}`), { tenantId });
    tx.update(job, { status: "done", completedAt: new Date().toISOString() });
    tx.create(root.collection("audit").doc(operationId), {
      actor: uid,
      action: "customer.create",
      target: operationId,
      authUid,
      date: new Date().toISOString(),
    });
  });
  return { ok: true, customerId: operationId };
}
