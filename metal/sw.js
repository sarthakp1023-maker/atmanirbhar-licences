// The demo that used to live here has closed. This replaces its offline worker: it deletes the saved copy of the
// demo from the browser, removes itself, and reloads any open demo window so it shows the "closed" page.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
})()));
