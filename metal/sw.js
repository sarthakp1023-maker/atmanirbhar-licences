// Offline cache: the whole app works without internet once opened.
const CACHE = 'india-pos-v27';
const FILES = ['./', 'index.html', 'app.js', 'india-core.mjs', 'qr.mjs', 'db.mjs', 'licence.mjs', 'licence-public.mjs', 'upi-gateway.mjs', 'phonepe-edc.mjs', 'pay-alerts.mjs', 'metal-core.mjs', 'metal-ui.mjs', 'update-core.mjs', 'data-import.mjs', 'sync-core.mjs', 'sync-ui.mjs', 'sync-config.mjs', 'numpad.mjs', 'build-config.mjs', 'style.css', 'icon.svg', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('india-pos') && k !== CACHE).map(k => caches.delete(k)))),
  self.clients.claim()])));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Never touch or cache sync traffic or anything carrying a sign-in header.
  if (new URL(req.url).pathname.startsWith('/sync/') || req.headers.has('authorization')) return;
  // Network first (revalidated, so updates show up at once), cache when offline.
  e.respondWith(fetch(req.url, { cache: 'no-cache' }).then(res => { if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy))); } return res; })
    .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
