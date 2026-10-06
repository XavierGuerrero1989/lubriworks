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
