// DIRA service worker.
//
// Its only jobs are to make the app installable (a registered worker is required for
// that) and to clean up after the earlier cache-first worker ("dira-cache-v1"), which
// served stale pages and answered navigations with cached redirects, so Chrome showed
// "ERR_FAILED" on /this-week after sign-in.
//
// It deliberately does NOT intercept page navigations or API calls: every page in DIRA
// depends on the session cookie and the database, so the network is always right and
// a cache is always wrong. Hashed static assets under /_next/static are cached
// cache-first, because their URLs change whenever their content does.

const STATIC_CACHE = "dira-static-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== STATIC_CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) return;

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
