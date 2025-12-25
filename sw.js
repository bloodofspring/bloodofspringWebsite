// Simple Service Worker for caching core assets + images.
// Works on HTTPS (or localhost). Update CACHE_VERSION to bust caches.

const CACHE_VERSION = 'v1';
const CORE_CACHE = `lissikk-core-${CACHE_VERSION}`;
const IMG_CACHE = `lissikk-img-${CACHE_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './styles/css/main.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CORE_CACHE);
      await cache.addAll(CORE_ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('lissikk-') && !k.endsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isImageRequest(request) {
  const url = new URL(request.url);
  return url.pathname.includes('/static/') && (url.pathname.endsWith('.jpg') || url.pathname.endsWith('.png'));
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  if (resp && resp.ok) cache.put(request, resp.clone());
  return resp;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((resp) => {
      if (resp && resp.ok) cache.put(request, resp.clone());
      return resp;
    })
    .catch(() => null);
  return cached || (await networkPromise) || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isImageRequest(request)) {
    event.respondWith(cacheFirst(request, IMG_CACHE));
    return;
  }

  // HTML/CSS/JS: stale-while-revalidate to keep it snappy but update in background
  event.respondWith(staleWhileRevalidate(request, CORE_CACHE));
});


