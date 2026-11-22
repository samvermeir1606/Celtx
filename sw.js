/* Scriptdesk — offline support. Keeps a copy of the app so it opens without an internet connection.
   When you change any file, raise VERSION here and the ?v= numbers in index.html. */
const VERSION = '14';
const CACHE = 'scriptdesk-v' + VERSION;
const RUNTIME = 'scriptdesk-runtime';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'css/app.css?v=' + VERSION,
  'css/script.css?v=' + VERSION,
  'css/script.css',
  ...['formats', 'paginate', 'pdf', 'catalog', 'storyline', 'storyboard', 'beatboard', 'sketch', 'schedule', 'budget', 'timeline', 'relations', 'moodboard', 'locmap', 'review', 'markdown', 'formats-io', 'editor', 'touch', 'discover', 'app'].map((n) => `js/${n}.js?v=${VERSION}`),
  'examples/index.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    // the example projects are nice to have offline, but not required
    try {
      const list = await (await fetch('examples/index.json')).json();
      await Promise.all(list.map((x) => c.add(x.file).catch(() => {})));
    } catch (err) { /* no examples */ }
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== RUNTIME) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // the page itself: try the network first so updates arrive, fall back to the saved copy
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); return res; }).catch(() => caches.match('index.html')));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // fonts and the zip library (for .celtx files): use the saved copy, refresh it in the background
  // (map tiles are not kept: there are too many of them)
  if (/fonts\.(googleapis|gstatic)\.com$|cdnjs\.cloudflare\.com$|cdn\.jsdelivr\.net$/.test(url.hostname)) {
    e.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
