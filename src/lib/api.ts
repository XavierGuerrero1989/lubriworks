import { auth } from "./firebase";
export async function rpc<T>(
  action: string,
  payload: Record<string, unknown> = {},
  tenantId?: string,
  signal?: AbortSignal,
  operationId?: string,
): Promise<T> {
  if (!auth?.currentUser) throw new Error("Iniciá sesión para continuar.");
  const token = await auth.currentUser.getIdToken();
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, payload, tenantId, operationId }),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "No se pudo completar la operación.");
  return result;
}

// Keep reports and totals complete while transporting large histories in bounded pages.
export async function snapshot(tenantId: string, signal?: AbortSignal) {
  type Page = {
    access: import("../../shared/model").Access;
    state: import("../../shared/model").State;
    vapidPublicKey: string;
    next?: Partial<
      Record<import("../../shared/model").StateCollection, string>
    >;
  };
  const result = await rpc<Page>("snapshot", {}, tenantId, signal);
  const pending = Object.entries(result.next || {});
  for (let i = 0; i < pending.length; i += 3)
    await Promise.all(
      pending.slice(i, i + 3).map(async ([collection, start]) => {
        let cursor: string | undefined = start;
        while (cursor) {
          const page: Page = await rpc<Page>(
            "state.page",
            { collection, cursor },
            tenantId,
            signal,
          );
          if (
            page.access.member.role !== result.access.member.role ||
            page.access.member.customerId !== result.access.member.customerId
          )
            throw new Error(
              "Tus permisos cambiaron. Volvé a abrir el lubricentro.",
            );
          const c = collection as import("../../shared/model").StateCollection;
          (result.state as any)[c].push(...page.state[c]);
          cursor = page.next?.[c];
        }
      }),
    );
  return result;
}
