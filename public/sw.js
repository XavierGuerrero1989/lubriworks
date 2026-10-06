// Do not cache authenticated business data. Offline access shows an explicit fallback.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate")
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            '<html lang="es"><meta name="viewport" content="width=device-width"><title>LubriWorks</title><body style="font:18px system-ui;padding:48px;color:#12343B"><h1>LubriWorks</h1><p>Estás sin conexión. Volvé a conectarte para consultar tus datos actualizados.</p><button onclick="location.reload()">Reintentar</button></body></html>',
            { headers: { "Content-Type": "text/html;charset=utf-8" } },
          ),
      ),
    );
});
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data.json();
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title || "LubriWorks", {
      body: data.body || "Tenés un nuevo recordatorio en tu portal.",
      icon: "/brand/icon.png",
      badge: "/brand/icon.png",
      tag: data.tag || "lubriworks",
      data: { url: "/?portal=notifications" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (windows.length) {
        await windows[0].navigate("/?portal=notifications");
        return windows[0].focus();
      }
      return self.clients.openWindow("/?portal=notifications");
    })(),
  );
});
