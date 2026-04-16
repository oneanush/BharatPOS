// File: /sw.js

// Bump to v1.3 to trigger the update on your devices
const CACHE_NAME = 'bharatpos-v1.3';

const ASSETS_TO_CACHE = [
  './',
  './login.html',
  './dashboard.html',
  './index.html',
  './reports.html',
  './products.html',
  './sales.html',
  './my_dukkan.html',
  './customers.html',
  './settings.html',
  './forecast.html',
  './my_khata.html',
  './manifest.json',
  './css/variables.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './assets/images/logo.png',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js'
];

self.addEventListener('install', (event) => {
    // We intentionally removed self.skipWaiting() here so it doesn't break the app mid-session
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('firestore.googleapis.com') || 
        event.request.url.includes('identitytoolkit') ||
        event.request.url.includes('server-xy7s.onrender.com')) {
        return;
    }

    // Network-First for HTML
    if (event.request.mode === 'navigate' || event.request.headers.get('accept').includes('text/html')) {
        event.respondWith(
            fetch(event.request).then((networkResponse) => {
                return caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            }).catch(() => {
                return caches.match(event.request, { ignoreSearch: true });
            })
        );
        return;
    }

    // Cache-First for Assets
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
                    }
                }).catch(() => {});
                return cachedResponse;
            }
            return fetch(event.request);
        })
    );
});

// THIS IS NEW: Listen for the user clicking the "Update" button in the UI
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});