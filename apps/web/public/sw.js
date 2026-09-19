// Minimal app-shell Service Worker.
//
// Scope note (see /OFFLINE_SYNC.md): this worker keeps the APP ITSELF (HTML/JS/CSS/manifest/icon)
// loadable with no network. It is deliberately not responsible for inspection DATA offline-first
// behavior — that's IndexedDB (apps/web/lib/db) + the sync engine (packages/sync-engine). Don't grow
// this file into a data cache; keep the concerns separate per ARCHITECTURE.md's layer separation.

// Bumped alongside the navigation-caching fix below (real bug, 2026-09-19) -- forces `activate`'s own
// cache purge to drop every old entry cached under the previous, buggy strategy (including any stale "/"
// app-shell response), not just rely on the fixed fetch logic to slowly overwrite them one at a time.
const CACHE_NAME = "av-inspection-shell-v2";
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

  // Real bug found here (user report, 2026-09-19): a genuine fix had shipped and was verified live on
  // the server, but a real device kept hitting the exact old, already-fixed error. Root cause: the HTML
  // document itself was being served cache-first (below), and that HTML is what decides which hashed
  // JS/CSS chunk URLs the page loads next -- a stale cached document keeps pointing at a stale, already-
  // fixed-on-the-server JS chunk indefinitely, even though the fetch handler was "revalidating" it in the
  // background the whole time (that revalidation only ever benefits the NEXT load, which repeats the
  // exact same problem forever). Navigations now go network-first: always the current server response
  // when online, falling back to the cached shell only when genuinely offline -- this is what makes the
  // offline-first promise (this file's own header comment) correct without also trapping an online user
  // on a stale version.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // Everything else (hashed JS/CSS chunks, manifest, icon): stale-while-revalidate stays safe here --
  // Next.js's build assets are content-hashed (a changed file gets a brand new URL), so a cached response
  // under an old hash is never WRONG, just possibly unused once a fresh navigation stops referencing it.
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
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
