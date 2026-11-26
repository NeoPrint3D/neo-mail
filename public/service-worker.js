/* NeoMail PWA: cache the app shell assets, never private mail or API responses. */
const CACHE = "neomail-static-v1";
const APP_SHELL = [
  "/manifest.webmanifest",
  "/offline.html",
  "/apple-touch-icon.png",
  "/icons/inbox-192.png",
  "/icons/inbox-512.png",
  "/icons/inbox-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => (key.startsWith("agentic-inbox-static-") || key.startsWith("neomail-static-")) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);

  // Hash-named build assets are immutable. Cache these for a fast next launch.
  if (url.pathname.startsWith("/assets/") && !url.search && /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|svg|png)$/.test(url.pathname) && request.mode !== "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE).catch(() => undefined);
      const cached = await cache?.match(request).catch(() => undefined);
      if (cached) return cached;
      const response = await fetch(request);
      const type = response.headers.get("content-type") ?? "";
      if (response.ok && !response.redirected && response.type === "basic" && /javascript|text\/css|^font\/|^image\//i.test(type) &&
          !/\b(?:private|no-store)\b/i.test(response.headers.get("cache-control") ?? "")) {
        // Storage failures must never prevent the app from loading.
        await cache?.put(request, response.clone()).catch(() => {});
      }
      return response;
    })());
    return;
  }

  // Never persist authenticated HTML or API/email responses. Offer a small
  // offline landing page if a navigation cannot reach the live service.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/offline.html")) || Response.error()));
  }
});

self.addEventListener("push", (event) => {
  let kind;
  try { kind = event.data?.json()?.kind; } catch { /* ignore malformed payloads */ }
  if (kind !== "mail" && kind !== "test") return;
  event.waitUntil(self.registration.showNotification("NeoMail", {
    body: kind === "test" ? "This is a test notification." : "You have new mail.",
    icon: "/icons/inbox-192.png",
    tag: kind === "test" ? "neomail-test" : "neomail-mail",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    // Never take a URL from a push payload or open a different origin.
    const inbox = new URL("/", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((window) => window.url === inbox);
    if (existing) return existing.focus();
    return self.clients.openWindow(inbox);
  })());
});
