import type { Firestore, Transaction, Query } from "firebase-admin/firestore";
import {
  collections,
  emptyState,
  key,
  type State,
  type StateCollection,
  schemas,
  visibleCollections,
  type Member,
} from "../shared/model.js";
// Page sizes bound each query, never the number of records stored by a tenant.
export const PAGE_SIZE = 200;
export async function* iteratePages(
  query: Query,
  tx?: Transaction,
  start?: string,
) {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | string | undefined =
    start;
  for (;;) {
    let q = query.orderBy("__name__").limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const page = await (tx ? tx.get(q) : q.get());
    for (const d of page.docs) yield d;
    if (page.size < PAGE_SIZE) return;
    cursor = page.docs.at(-1)!;
  }
}
export async function readPages(query: Query, tx?: Transaction) {
  const rows: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for await (const d of iteratePages(query, tx)) rows.push(d);
  return rows;
}
export async function loadState(
  db: Firestore,
  tenantId: string,
  tx?: Transaction,
  selected: readonly StateCollection[] = collections,
): Promise<State> {
  key.parse(tenantId);
  const state = emptyState();
  await Promise.all(
    selected.map(async (c) => {
      (state as any)[c] = (
        await readPages(db.collection(`tenants/${tenantId}/${c}`), tx)
      ).map((d) => ({ ...d.data(), id: d.id }));
    }),
  );
  return state;
}
export async function statePage(
  db: Firestore,
  tx: Transaction,
  tenantId: string,
  member: Member,
  selected: readonly StateCollection[],
  cursors: Partial<Record<StateCollection, string>> = {},
) {
  const state = emptyState(),
    next: Partial<Record<StateCollection, string>> = {};
  await Promise.all(
    selected.map(async (c) => {
      if (!visibleCollections(member.role).includes(c))
        throw new Error("Módulo no permitido.");
      if (member.role === "customer" && c === "customers") {
        const d = await tx.get(
          db.doc(
            `tenants/${tenantId}/customers/${key.parse(member.customerId)}`,
          ),
        );
        if (d.exists) (state as any)[c] = [{ ...d.data(), id: d.id }];
        return;
      }
      let q: Query = db.collection(`tenants/${tenantId}/${c}`);
      if (member.role === "customer" && c !== "branches")
        q = q.where("customerId", "==", member.customerId);
      q = q.orderBy("__name__").limit(PAGE_SIZE + 1);
      if (cursors[c]) q = q.startAfter(key.parse(cursors[c]));
      const page = await tx.get(q),
        rows = page.docs.slice(0, PAGE_SIZE);
      (state as any)[c] = rows.map((d) => ({ ...d.data(), id: d.id }));
      if (page.size > PAGE_SIZE) next[c] = rows.at(-1)!.id;
    }),
  );
  return { state, next };
}
// The pure business engine receives only its target and validation dependencies.
export async function loadCommandState(
  db: Firestore,
  tx: Transaction,
  tenantId: string,
  member: Member,
  cmd: import("../shared/engine.js").Command,
  operationId: string,
): Promise<State> {
  const s = emptyState(),
    maps = new Map<string, Map<string, any>>();
  const col = (c: StateCollection) => db.collection(`tenants/${tenantId}/${c}`);
  const add = (c: StateCollection, d: FirebaseFirestore.DocumentSnapshot) => {
    if (!d.exists) return;
    if (!maps.has(c)) maps.set(c, new Map());
    maps.get(c)!.set(d.id, { ...d.data(), id: d.id });
    (s as any)[c] = [...maps.get(c)!.values()];
  };
  const doc = async (c: StateCollection, id: unknown) => {
    const k = key.parse(id);
    if (maps.get(c)?.has(k)) return maps.get(c)!.get(k);
    const d = await tx.get(col(c).doc(k));
    add(c, d);
    return d.exists ? maps.get(c)!.get(k) : undefined;
  };
  const query = async (c: StateCollection, q: Query) => {
    for (const d of await readPages(q, tx)) add(c, d);
  };
  const products = async (items: any[]) => {
    for (const i of items || []) await doc("products", i.productId);
  };
  const openCash = async (branchId: string) => {
    await query(
      "cash",
      col("cash")
        .where("branchId", "==", branchId)
        .where("closedAt", "==", null),
    );
  };
  if (cmd.action === "save") {
    if (!Object.hasOwn(schemas, String(cmd.collection)))
      throw new Error("Módulo no permitido.");
    const c = cmd.collection as keyof typeof schemas,
      data: any = schemas[c].parse(cmd.data);
    await doc(c, cmd.id || operationId);
    if (data.customerId) await doc("customers", data.customerId);
    if (data.vehicleId) await doc("vehicles", data.vehicleId);
    if (data.branchId) await doc("branches", data.branchId);
    if (c === "branches")
      await query(
        "appointments",
        col("appointments").where("branchId", "==", cmd.id || operationId),
      );
    if (c === "vehicles") {
      await query(c, col(c).where("plate", "==", data.plate));
      await doc("reminders", `fire-${cmd.id || operationId}`);
    }
    if (c === "products") await query(c, col(c).where("sku", "==", data.sku));
    if (c === "services" || c === "purchases") await products(data.items);
    if (c === "appointments")
      await query(c, col(c).where("date", "==", data.date));
    if (c === "orders") {
      const service = await doc("services", data.serviceId);
      await products(service?.items);
      if (data.appointmentId) await doc("appointments", data.appointmentId);
    }
    if (c === "purchases") await doc("suppliers", data.supplierId);
  } else if (cmd.action === "finishOrder" || cmd.action === "chargeOrder") {
    const o = await doc("orders", cmd.id);
    if (o) {
      await products(o.items);
      if (cmd.action === "finishOrder") {
        await doc("vehicles", o.vehicleId);
        await doc("services", o.serviceId);
        await query(
          "reminders",
          col("reminders")
            .where("vehicleId", "==", o.vehicleId)
            .where("status", "==", "active"),
        );
      } else await openCash(o.branchId);
    }
  } else if (cmd.action === "startOrder" || cmd.action === "deliverOrder") {
    const order = await doc("orders", cmd.id);
    if (cmd.action === "deliverOrder" && order?.appointmentId)
      await doc("appointments", order.appointmentId);
  } else if (cmd.action === "sale") {
    await doc("branches", cmd.branchId);
    await products(cmd.items as any[]);
    await openCash(key.parse(cmd.branchId));
  } else if (cmd.action === "receivePurchase") {
    const p = await doc("purchases", cmd.id);
    if (p) await products(p.items);
  } else if (cmd.action === "adjustStock") await doc("products", cmd.id);
  else if (cmd.action === "openCash") {
    await doc("branches", cmd.branchId);
    await openCash(key.parse(cmd.branchId));
  } else if (cmd.action === "closeCash") {
    const c = await doc("cash", cmd.id);
    if (c)
      await query(
        "sales",
        col("sales").where("date", ">=", c.openedAt).orderBy("date"),
      );
  } else if (cmd.action === "reading") await doc("vehicles", cmd.id);
  else if (cmd.action === "profile") await doc("customers", member.customerId);
  else if (cmd.action === "requestAppointment") {
    await doc("vehicles", cmd.vehicleId);
    await doc("branches", cmd.branchId);
    await query(
      "appointments",
      col("appointments").where("date", "==", cmd.date),
    );
  } else if (cmd.action === "readNotice") await doc("notifications", cmd.id);
  else throw new Error("Acción desconocida.");
  return s;
}
export function persistDiff(
  db: Firestore,
  tx: Transaction,
  tenantId: string,
  before: State,
  after: State,
) {
  let writes = 0;
  for (const c of collections) {
    const old = new Map(before[c].map((r) => [r.id, r]));
    const next = new Map(after[c].map((r) => [r.id, r]));
    for (const row of after[c])
      if (JSON.stringify(row) !== JSON.stringify(old.get(row.id))) {
        if (++writes > 400)
          throw new Error("La operación supera el límite de escritura.");
        tx.set(db.doc(`tenants/${tenantId}/${c}/${key.parse(row.id)}`), row);
      }
    for (const row of before[c])
      if (!next.has(row.id))
        tx.delete(db.doc(`tenants/${tenantId}/${c}/${key.parse(row.id)}`));
  }
}

export async function memberGuards(
  ref: FirebaseFirestore.DocumentReference,
  tx: Transaction,
  customerId: string | null,
) {
  const owners = await readPages(
    ref.collection("members").where("role", "==", "owner"),
    tx,
  );
  const linked = customerId
    ? await readPages(
        ref.collection("members").where("customerId", "==", customerId),
        tx,
      )
    : [];
  return {
    docs: [...new Map([...owners, ...linked].map((d) => [d.id, d])).values()],
  };
}
