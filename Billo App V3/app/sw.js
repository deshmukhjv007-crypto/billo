/* Billo service worker — app-shell caching for offline use */
const V = 'billo-v1.6.2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sync/config.js',
  './sync/firebase.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './ocr/tesseract.min.js',
  './ocr/worker.min.js',
  './ocr/tesseract-core-simd-lstm.js',
  './ocr/tesseract-core-simd-lstm.wasm',
  './ocr/eng.traineddata',
  './fonts/bricolage-700-ext.woff2',
  './fonts/bricolage-700.woff2',
  './fonts/bricolage-800-ext.woff2',
  './fonts/bricolage-800.woff2',
  './fonts/manrope-400-ext.woff2',
  './fonts/manrope-400.woff2',
  './fonts/manrope-600-ext.woff2',
  './fonts/manrope-600.woff2',
  './fonts/manrope-700-ext.woff2',
  './fonts/manrope-700.woff2',
  './fonts/manrope-800-ext.woff2',
  './fonts/manrope-800.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => { const cl = r.clone(); caches.open(V).then(c => c.put(e.request, cl)); return r; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const cl = res.clone();
      caches.open(V).then(c => c.put(e.request, cl));
      return res;
    }))
  );
});
