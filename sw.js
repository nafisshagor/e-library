// Service Worker Cache for JCC E-Library
const CACHE_NAME = 'jcc-elib-v4';
const LOCAL_ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'jcc-logo.png'];
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) =>
      // allSettled: one missing asset must never abort the whole install
      Promise.allSettled([
        ...LOCAL_ASSETS.map((a) => c.add(a)),
        ...CDN_ASSETS.map((u) => c.add(new Request(u, { mode: 'cors' })))
      ])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== 'GET' || u.hostname.endsWith('supabase.co') || req.headers.has('range')) return;
  e.respondWith(
    fetch(req)
      .then((r) => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return r;
      })
      .catch(async () =>
        (await caches.match(req, { ignoreSearch: true })) ||
        (req.mode === 'navigate' ? await caches.match('index.html') : Response.error())
      )
  );
});