// File: /sw.js

// Bumped to v1.4 to force your phone to download the new missing JS files!
const CACHE_NAME = 'bharatpos-v1.5';

const ASSETS_TO_CACHE = [
  // HTML Pages
  './',
  './login.html',
  './dashboard.html',
  './billing.html',
  './products.html',
  './sales.html',
  './my_dukkan.html',
  './customers.html',
  './settings.html',
  './forecast.html',
  './my_khata.html',
  
  // CSS
  './css/variables.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  
  // CORE & UTILS JS (The missing pieces!)
  './js/core/firebase.js',
  './js/core/storage.js',
  './js/components/navigation.js',
  './js/utils/ui.js',
  './js/utils/security.js',
  './js/utils/formatters.js',
  './js/utils/i18n.js',
  
  // PAGE LOGIC JS
  './js/pages/dashboard.js',
  './js/pages/billing.js',
  './js/pages/products.js',
  './js/pages/sales.js',
  './js/pages/my_dukkan.js',
  './js/pages/customers.js',
  './js/pages/forecast.js',
  './js/pages/settings.js',
  './js/pages/khata_main.js',
  './js/pages/khata_bills.js',
  './js/pages/khata_store.js',
  './js/pages/khata_khoj.js',

  // Assets
  './manifest.json',
  './assets/images/logo.png',

  // External CDNs (Required for Offline Mode)
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-routing-machine@latest/dist/leaflet-routing-machine.css',
  'https://unpkg.com/leaflet-routing-machine@latest/dist/leaflet-routing-machine.js',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', (event) => {
    // No skipWaiting here so we don't break active sessions
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching App Shell & JS Modules');
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
                        console.log('[Service Worker] Deleting old cache:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Ignore Firebase Database sync requests (Firebase handles its own offline cache)
    if (event.request.url.includes('firestore.googleapis.com') || 
        event.request.url.includes('identitytoolkit') ||
        event.request.url.includes('server-xy7s.onrender.com')) {
        return;
    }

    // STRATEGY 1: Network-First for HTML Pages (Ensures latest UI layout)
    if (event.request.mode === 'navigate' || event.request.headers.get('accept').includes('text/html')) {
        event.respondWith(
            fetch(event.request).then((networkResponse) => {
                return caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            }).catch(() => {
                // If offline, serve from cache
                return caches.match(event.request, { ignoreSearch: true });
            })
        );
        return;
    }

    // STRATEGY 2: Cache-First for Assets & JS Modules (For instant offline loads)
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                // Background fetch to update cache dynamically for next time
                fetch(event.request).then((networkResponse) => {
                    // Only cache valid responses (status 200) or opaque CORS responses (status 0)
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
                    }
                }).catch(() => {});
                return cachedResponse;
            }
            return fetch(event.request);
        })
    );
});

// Listen for the user clicking the "Update" toast button
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});