// Offline shell only. Never intercepts non-GET or cross-origin requests: AI providers,
// GitHub, Google and Microsoft calls (with Authorization headers) must reach the network untouched.
const CACHE = "bookwriter-shell-v1";

self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Network first so a deploy is picked up at once; cached shell only when offline.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) (await caches.open(CACHE)).put("/", fresh.clone());
        return fresh;
      } catch {
        return (await caches.match("/")) ?? Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    // Hashed build files never change: cache first.
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) (await caches.open(CACHE)).put(request, fresh.clone());
      return fresh;
    })());
  }
});
