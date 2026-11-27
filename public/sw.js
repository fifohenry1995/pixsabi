/* PixSabi service worker.
   - Makes the game installable and keeps the app files (not your puzzles) ready for a fast start.
   - Puzzle pictures (/pic and /sl) are saved on the phone after first view, so they load instantly next time and
     work on a weak connection. A picture never contains the answer. Profile photos, the admin page and every /api
     answer are NEVER stored: they always come fresh from the server, so nothing about the answers is kept.
   - Files are fetched from the network first, so players always get your latest update.
     The saved copy is only used when the phone has no connection. */
const CACHE = 'pixsabi-shell-v91';
const PICS = 'pixsabi-pics-v1';
const MAX_PICS = 80;
const SHELL = ['/', '/offline.html', '/css/style.css', '/css/pwa.css', '/css/ads.css', '/css/popup.css', '/js/ads.js', '/js/track.js', '/js/popup.js', '/js/sound.js', '/js/music.js', '/js/game.js', '/js/avatars.js', '/js/commentary.js', '/js/app.js', '/js/pwa.js', '/js/offline.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PICS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const PIC_PATH = /^\/(pic|sl)\/[0-9a-z]+$/;
const NEVER_CACHE = /^\/(api|ad|popup|radio|audioad|wbg|bg|avatars|admin|health|pay)(\/|\.|$)/;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || NEVER_CACHE.test(url.pathname)) return; // the browser handles these normally

  if (PIC_PATH.test(url.pathname)) {
    // Puzzle pictures: saved copy first (the ?v= number in the link changes when the admin replaces a picture).
    event.respondWith((async () => {
      const c = await caches.open(PICS);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) {
        c.put(req, res.clone()).then(async () => { const ks = await c.keys(); for (let i = 0; i < ks.length - MAX_PICS; i++) await c.delete(ks[i]); }).catch(() => {});
      }
      return res;
    })());
    return;
  }
  if (req.mode === 'navigate') {
    // Pages: network first. With no connection, show the offline page.
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  // App files: network first, saved copy only when offline.
  event.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req))
  );
});

// ---------- alerts (push) ----------
// The server sends a short message: { title, body, url, tag }. If the game is open and in front, the page shows its own banner
// instead, so the player is not alerted twice.
// When the player logs out, forget the saved pictures on this phone.
self.addEventListener('message', (event) => { if (event.data && event.data.type === 'clear-pics') event.waitUntil(caches.delete(PICS)); });

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* plain text or empty */ }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible')) { wins.forEach((w) => w.postMessage({ type: 'alerts' })); return; }
    await self.registration.showNotification(d.title || 'PixSabi', {
      body: d.body || '', tag: d.tag || 'pixsabi', renotify: true,
      icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
      data: { url: typeof d.url === 'string' && d.url.startsWith('#/') ? d.url : '#/alerts' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '#/alerts';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins[0];
    if (open) { await open.focus().catch(() => {}); open.postMessage({ type: 'go', url }); return; }
    await self.clients.openWindow('/' + url);
  })());
});
