/*
  Service worker (vite-plugin-pwa, injectManifest).
  - Precaches the built shell so the app opens offline.
  - Navigations fall back to the cached index.html (never for /api).
  - Handles Web Push (`push`) and notification taps (`notificationclick`).
  Push payload shape: shared PushPayloadSchema { title, body, url, tag }.
*/
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/sw\.js$/] }));

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

interface PushData {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  const data = ((): PushData => {
    try {
      return event.data ? (event.data.json() as PushData) : {};
    } catch {
      return { body: event.data?.text() };
    }
  })();
  const title = data.title || 'After Hours';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body ?? '',
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      data: { url: data.url && data.url.startsWith('/') ? data.url : '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | null)?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const mine = all.find((c) => new URL(c.url).origin === self.location.origin);
      if (mine) {
        await mine.focus();
        if ('navigate' in mine && mine.url !== url) await (mine as WindowClient).navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
