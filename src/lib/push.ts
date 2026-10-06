import { rpc } from "./api";
export async function enablePush(tenantId: string, publicKey: string) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    throw new Error(
      "Este navegador no admite push. En iPhone, agregá LubriWorks a Inicio y abrilo desde el ícono.",
    );
  if (!publicKey)
    throw new Error(
      "El administrador todavía no configuró las notificaciones push.",
    );
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "No se habilitaron las notificaciones. Podés cambiar el permiso desde la configuración del navegador.",
    );
  const registration = await navigator.serviceWorker.ready;
  const bytes = Uint8Array.from(
    atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    }));
  await rpc(
    "push.subscribe",
    subscription.toJSON() as Record<string, unknown>,
    tenantId,
  );
}
