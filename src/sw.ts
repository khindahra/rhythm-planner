/// <reference lib="webworker" />
import {
  precacheAndRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
} from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: import("workbox-precaching").PrecacheEntry[];
};
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("push", (event) => {
  let payload: { title?: string; body?: string; tag?: string } = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    /* Show a generic notification for malformed messages. */
  }
  event.waitUntil(
    self.registration.showNotification(
      payload.title || "Ритм — требуется действие",
      {
        body: payload.body || "Откройте центр действий.",
        tag: payload.tag || "rhythm-action",
        icon: "icon.svg",
        data: { url: self.registration.scope },
      },
    ),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window" });
      if (clients[0]) await (clients[0] as WindowClient).focus();
      else await self.clients.openWindow(self.registration.scope);
    })(),
  );
});
