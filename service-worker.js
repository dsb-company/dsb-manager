const CACHE_NAME = 'dsb-manager-v20261001-badge2';

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./css/tickets.css",
  "./css/portal-access.css",
  "./js/app.js",
  "./js/profile.js",
  "./js/tickets.js",
  "./js/portal-access.js",
  "./js/core.js",
  "./js/theme.js",
  "./assets/images/logo.png",
  "./assets/images/icons/icon-192.png",
  "./assets/images/icons/icon-512.png",
  "./assets/notification/universfield.mp3",
  "./assets/notification/notification-038.mp3",
  "./assets/notification/notification-024.mp3"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Não cacheia Supabase ou APIs
  if (
    url.hostname.includes("supabase.co") ||
    request.method !== "GET"
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();

        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, copy);
        });

        return response;
      })
      .catch(() => caches.match(request))
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification?.data?.url || "./#tickets";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
