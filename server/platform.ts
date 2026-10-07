import { z } from "zod";
import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { key, roles, type Member, type Tenant } from "../shared/model.js";
import type {
  PlatformOverview,
  PlatformTeam,
  PlatformActivity,
  PlatformTenant,
} from "../shared/platform.js";
async function verify(db: Firestore, uid: string) {
  if ((await db.doc(`platformAdmins/${uid}`).get()).data()?.active !== true)
    throw new Error("Acceso de plataforma revocado.");
}
export async function overview(
  db: Firestore,
  uid: string,
  payload: unknown,
): Promise<PlatformOverview> {
  const { cursor } = z.object({ cursor: key.optional() }).parse(payload);
  let query = db.collection("tenants").orderBy("__name__").limit(51);
  if (cursor) query = query.startAfter(cursor);
  const [page, total, active] = await Promise.all([
    query.get(),
    db.collection("tenants").count().get(),
    db.collection("tenants").where("active", "==", true).count().get(),
  ]);
  const rows = page.docs.slice(0, 50),
    tenants: PlatformTenant[] = [],
    activity: PlatformActivity[] = [];
  for (let i = 0; i < rows.length; i += 10)
    await Promise.all(
      rows.slice(i, i + 10).map(async (d) => {
        const [members, enabled, owners, customers, vehicles, orders, audit] =
          await Promise.all([
            d.ref.collection("members").count().get(),
            d.ref
              .collection("members")
              .where("active", "==", true)
              .count()
              .get(),
            d.ref.collection("members").where("role", "==", "owner").get(),
            d.ref.collection("customers").count().get(),
            d.ref.collection("vehicles").count().get(),
            d.ref.collection("orders").count().get(),
            d.ref.collection("audit").orderBy("date", "desc").limit(8).get(),
          ]);
        const tenant = { ...d.data(), id: d.id } as Tenant;
        tenants.push({
          ...tenant,
          members: members.data().count,
          activeMembers: enabled.data().count,
          administrators: owners.docs.filter((x) => x.data().active).length,
          customers: customers.data().count,
          vehicles: vehicles.data().count,
          orders: orders.data().count,
        });
        activity.push(
          ...audit.docs.map((a) => ({
            id: `${d.id}-${a.id}`,
            tenantId: d.id,
            tenantName: tenant.name,
            actor: String(a.data().actor || "Sistema"),
            action: String(a.data().action || "Actividad"),
            date: String(a.data().date || ""),
            ...(a.data().target ? { target: String(a.data().target) } : {}),
          })),
        );
      }),
    );
  await verify(db, uid);
  tenants.sort((a, b) => a.id.localeCompare(b.id));
  activity.sort((a, b) => b.date.localeCompare(a.date));
  return {
    tenants,
    totalTenants: total.data().count,
    activeTenants: active.data().count,
    nextCursor: page.size > 50 ? rows.at(-1)!.id : null,
    activity: activity.slice(0, 40),
    refreshedAt: new Date().toISOString(),
  };
}
export async function team(
  db: Firestore,
  uid: string,
  payload: unknown,
): Promise<PlatformTeam> {
  const { id } = z.object({ id: key }).parse(payload);
  const tenant = db.doc(`tenants/${id}`);
  const [t, m, c] = await Promise.all([
    tenant.get(),
    tenant.collection("members").limit(2001).get(),
    tenant.collection("customers").limit(2001).get(),
  ]);
  if (!t.exists) throw new Error("La empresa no existe.");
  if (m.size > 2000 || c.size > 2000)
    throw new Error("Este directorio requiere paginación.");
  await verify(db, uid);
  return {
    members: m.docs.map((d) => ({ ...d.data(), uid: d.id }) as Member),
    customers: c.docs.map((d) => ({
      id: d.id,
      name: String(d.data().name || d.id),
    })),
  };
}
export async function saveMember(
  db: Firestore,
  auth: Auth,
  uid: string,
  payload: unknown,
) {
  const data = z
    .object({
      id: key,
      email: z.string().email(),
      name: z.string().trim().min(2).max(120),
      role: z.enum(roles),
      active: z.boolean(),
      customerId: key.nullable(),
      expectedUid: key.optional(),
    })
    .parse(payload);
  const user = await auth.getUserByEmail(data.email);
  if (data.expectedUid && user.uid !== data.expectedUid)
    throw new Error("Para editar un acceso conservá el correo de esa cuenta.");
  if (!user.emailVerified || user.disabled)
    throw new Error(
      "La cuenta debe estar habilitada y tener el correo verificado.",
    );
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`tenants/${data.id}`);
    const [admin, t, members, customer] = await Promise.all([
      tx.get(db.doc(`platformAdmins/${uid}`)),
      tx.get(ref),
      tx.get(ref.collection("members")),
      data.customerId
        ? tx.get(ref.collection("customers").doc(data.customerId))
        : Promise.resolve(null),
    ]);
    if (admin.data()?.active !== true || !t.exists)
      throw new Error("Acceso denegado.");
    if (data.role === "customer" && (!data.customerId || !customer?.exists))
      throw new Error("Seleccioná un cliente de esta empresa.");
    if (data.role !== "customer" && data.customerId !== null)
      throw new Error("Los empleados no se vinculan a un cliente.");
    if (
      data.role === "customer" &&
      data.active &&
      members.docs.some(
        (m) =>
          m.id !== user.uid &&
          m.data().active &&
          m.data().customerId === data.customerId,
      )
    )
      throw new Error("El cliente ya tiene un acceso activo.");
    if (
      (!data.active || data.role !== "owner") &&
      !members.docs.some(
        (m) =>
          m.id !== user.uid && m.data().active && m.data().role === "owner",
      )
    )
      throw new Error("La empresa debe conservar un administrador activo.");
    const { id, expectedUid, ...values } = data;
    tx.set(ref.collection("members").doc(user.uid), {
      ...values,
      uid: user.uid,
      tenantId: id,
    });
    tx.set(db.doc(`userTenants/${user.uid}/tenants/${id}`), { tenantId: id });
    tx.create(ref.collection("audit").doc(), {
      actor: uid,
      action: "platform.member.save",
      target: user.uid,
      role: data.role,
      active: data.active,
      date: new Date().toISOString(),
    });
  });
  return { ok: true };
}
