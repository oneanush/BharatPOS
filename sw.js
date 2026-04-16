// File: /sw.js

// IMPORTANT: Bumped version to 1.1 to force the phone to download the new fix
const CACHE_NAME = 'bharatpos-v1.1';

// Removed the leading slashes to make paths perfectly relative
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './login.html',
  './dashboard.html',
  './products.html',
  './sales.html',
  './my_dukkan.html',
  './customers.html',
  './settings.html',
  './forecast.html',
    './reports.html',
    
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
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching App Shell');
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
    // Ignore Firebase API calls & external dynamic requests
    if (event.request.url.includes('firestore.googleapis.com') || 
        event.request.url.includes('identitytoolkit') ||
        event.request.url.includes('server-xy7s.onrender.com')) {
        return;
    }

    event.respondWith(
        // THE FIX: ignoreSearch: true prevents mobile OS URL parameters from breaking the cache
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Offline fallback - do nothing, let cachedResponse handle it
            });

            return cachedResponse || fetchPromise;
        })
    );
});