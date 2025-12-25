// Simple Service Worker for caching core assets + images.
// Works on HTTPS (or localhost). Update CACHE_VERSION to bust caches.

const CACHE_VERSION = 'v1';
const CORE_CACHE = `lissikk-core-${CACHE_VERSION}`;
const IMG_CACHE = `lissikk-img-${CACHE_VERSION}`;
const TILE_CACHE = `lissikk-tile-${CACHE_VERSION}`;

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

function isTileRequest(request) {
  const url = new URL(request.url);
  return url.pathname.endsWith('/__tile');
}

async function buildTileResponse(requestUrl) {
  const axis = requestUrl.searchParams.get('axis');
  const src = requestUrl.searchParams.get('src');
  if (axis !== 'x' && axis !== 'y') return new Response('Bad axis', { status: 400 });
  if (!src) return new Response('Missing src', { status: 400 });

  // Resolve src to same-origin and restrict to /static/ for safety.
  const srcUrl = new URL(src, requestUrl.origin);
  if (srcUrl.origin !== requestUrl.origin) return new Response('Bad src origin', { status: 400 });
  if (!srcUrl.pathname.startsWith('/static/')) return new Response('Bad src path', { status: 400 });

  // If we can't generate (older browsers), degrade to the original image (no 404).
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    return fetch(srcUrl.toString());
  }

  const srcResp = await fetch(srcUrl.toString());
  if (!srcResp.ok) return srcResp;

  const blob = await srcResp.blob();
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;

  const canvas = new OffscreenCanvas(axis === 'x' ? w * 2 : w, axis === 'y' ? h * 2 : h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Response('No 2D context', { status: 500 });

  // (0,0) original
  ctx.drawImage(bitmap, 0, 0, w, h);

  if (axis === 'x') {
    ctx.translate(w * 2, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(bitmap, 0, 0, w, h);
  } else {
    ctx.translate(0, h * 2);
    ctx.scale(1, -1);
    ctx.drawImage(bitmap, 0, 0, w, h);
  }

  const outBlob = await canvas.convertToBlob({ type: 'image/png' });
  return new Response(outBlob, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
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

  if (isTileRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(TILE_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const resp = await buildTileResponse(url);
        if (resp && resp.ok) cache.put(request, resp.clone());
        return resp;
      })()
    );
    return;
  }

  if (isImageRequest(request)) {
    event.respondWith(cacheFirst(request, IMG_CACHE));
    return;
  }

  // HTML/CSS/JS: stale-while-revalidate to keep it snappy but update in background
  event.respondWith(staleWhileRevalidate(request, CORE_CACHE));
});


