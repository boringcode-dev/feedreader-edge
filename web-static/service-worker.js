const SHELL_CACHE = "reader-shell-v39";
const ITEMS_CACHE = "reader-items-v22";
const CORE_ASSETS = [
  "/",
  "/static/style.css?v=40",
  "/static/app.js?v=31",
  "/static/source-icons/hackernews.svg",
  "/static/source-icons/github.svg",
  "/static/source-icons/huggingface.svg",
  "/static/source-icons/alphaxiv.png",
  "/favicon.svg?v=8",
  "/site.webmanifest?v=10",
  "/apple-touch-icon.png?v=8",
  "/icon-192.png?v=8",
  "/icon-512.png?v=8",
];
const STATIC_ASSET_PATHS = new Set([
  "/favicon.svg",
  "/site.webmanifest",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await Promise.all(
      (await caches.keys())
        .filter((key) => key.startsWith("reader-") && ![SHELL_CACHE, ITEMS_CACHE].includes(key))
        .map((key) => caches.delete(key)),
    );
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(event));
    return;
  }

  if (url.pathname === "/api/items") {
    event.respondWith(handleItemsRequest(request));
    return;
  }

  if (url.pathname.startsWith("/static/") || STATIC_ASSET_PATHS.has(url.pathname)) {
    event.respondWith(handleStaticAssetRequest(request));
  }
});

async function handleNavigationRequest(event) {
  const { request, preloadResponse } = event;
  const cache = await caches.open(SHELL_CACHE);
  try {
    const preloaded = await preloadResponse;
    if (preloaded) {
      if (preloaded.ok) {
        cache.put(request, preloaded.clone());
      }
      return preloaded;
    }
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match("/")) || Response.error();
  }
}

async function handleItemsRequest(request) {
  const cache = await caches.open(ITEMS_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return new Response(
      JSON.stringify({
        items: [],
        has_next: false,
        offline: true,
        cache_miss: true,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}

async function handleStaticAssetRequest(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}
