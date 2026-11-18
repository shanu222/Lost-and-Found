/// <reference lib="webworker" />
// Service worker: offline app shell (precached build), runtime caching for map
// tiles, and web push notifications.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigations → cached index.html (but never the API).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// The API (and signed image URLs) must always hit the network: they are
// private, short-lived and country-scoped.
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly());

// Self-hosted fonts (only the scripts a user actually renders are fetched).
registerRoute(({ request, url }) => request.destination === 'font' && url.origin === self.location.origin, new CacheFirst({ cacheName: 'fonts' }));

// OpenStreetMap tiles: cache-first, bounded by the browser's cache eviction.
registerRoute(({ url }) => url.hostname.endsWith('tile.openstreetmap.org'), new CacheFirst({ cacheName: 'osm-tiles' }));

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'FoundBack', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        void existing.focus();
        return existing.navigate(url);
      }
      return self.clients.openWindow(url);
    }),
  );
});
