/**
 * Bisnisku — sw.js
 * Cache-First service worker for the static app shell.
 * Firestore / gstatic requests are deliberately NOT handled here so the
 * Firebase SDK manages its own caching (IndexedDB persistent cache).
 *
 * Bump CACHE_VERSION whenever any shell file changes so clients refresh.
 */
const CACHE_VERSION = "bisnisku-v17";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/firebase-config.js",
  "./js/calculator.js",
  "./js/db.js",
  "./js/wizard.js",
  "./js/export.js",
  "./js/app.js",
  "./icons/icon.svg",
  "./icons/icon-maskable.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const BYPASS_HOSTS = ["firestore.googleapis.com", "gstatic.com", "googleapis.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never touch Firebase traffic or any cross-origin request.
  if (BYPASS_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith("." + h))) return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline navigation fallback → app shell.
          if (req.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        });
    })
  );
});
