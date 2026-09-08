// Minimal app-shell Service Worker.
//
// Scope note (see /OFFLINE_SYNC.md): this worker keeps the APP ITSELF (HTML/JS/CSS/manifest/icon)
// loadable with no network. It is deliberately not responsible for inspection DATA offline-first
// behavior — that's IndexedDB (apps/web/lib/db) + the sync engine (packages/sync-engine). Don't grow
// this file into a data cache; keep the concerns separate per ARCHITECTURE.md's layer separation.

const CACHE_NAME = "av-inspection-shell-v1";
const APP_SHELL = ["/", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Never intercept mutating requests (POST/PUT/etc.) — those belong to the sync engine, not the SW.
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached || caches.match("/"));
      // Stale-while-revalidate for the app shell: serve the cached copy instantly if we have one, refresh
      // it in the background; fall back to network (then to the cached "/" for navigations) if we don't.
      return cached || networkFetch;
    })
  );
});
