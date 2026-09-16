const CACHE_NAME = 'aublst-shell-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/backend/')) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Nur vollständige Antworten. Audio- und Videodateien kommen als
        // 206-Teilantwort auf einen Range-Request zurück, die der Cache nicht
        // annimmt. Ein fehlgeschlagener Cache-Schreibvorgang ist egal, aber er
        // soll nicht als unbehandelte Rejection in der Konsole landen.
        if (response.status === 200) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) || (await caches.match('./')) || Response.error()),
  );
});
