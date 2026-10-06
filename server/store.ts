import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  collections,
  emptyState,
  key,
  type State,
  type StateCollection,
} from "../shared/model";
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
      const q = db.collection(`tenants/${tenantId}/${c}`).limit(2001);
      const snap = await (tx ? tx.get(q) : q.get());
      if (snap.size > 2000)
        throw new Error(
          "Este módulo requiere paginación antes de seguir operando. Contactá a Brainworks.",
        );
      (state as any)[c] = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    }),
  );
  return state;
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
