// Only the public offline page is cached. Transcripts, API responses and the
// application document remain network-only so no personal record enters CacheStorage.
const CACHE = "docent-offline-v2";
const OFFLINE = "/offline.html";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("docent-offline-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate" || new URL(event.request.url).origin !== self.location.origin) return;
  if (new URL(event.request.url).pathname !== "/") return;
  event.respondWith(fetch(event.request).then(async (response) => {
    // Tailscale Serve stays up when the local server stops, returning a gateway
    // error rather than a rejected network request.
    if ([502, 503, 504].includes(response.status)) return (await caches.match(OFFLINE)) ?? response;
    return response;
  }).catch(async () => (await caches.match(OFFLINE)) ?? Response.error()));
});
