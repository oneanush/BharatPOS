// File: /sw.js

// Change this version number whenever you update your HTML/CSS/JS files!
const CACHE_NAME = 'bharatpos-v1.0';

// List all the static files that make up your app's UI shell.
// Do NOT cache Firebase data here; Firebase handles its own offline data.
const ASSETS_TO_CACHE = [
  '/',
  '/login.html',
  '/dashboard.html',
  '/products.html',
  '/sales.html',
  '/my_dukkan.html',
  '/customers.html',
  '/settings.html',
  '/forecast.html',
  '/manifest.json',
  '/css/variables.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/assets/images/logo.png',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js'
];

// 1. INSTALLATION: Cache the App Shell
self.addEventListener('install', (event) => {
    // Skip the "waiting" lifecycle to force the new service worker to take over immediately
    self.skipWaiting();
    
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching App Shell');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 2. ACTIVATION: Clean up old caches
self.addEventListener('activate', (event) => {
    // Take control of all pages immediately
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

// 3. FETCHING: Stale-While-Revalidate Strategy
// This serves from cache immediately for speed, but checks the network for updates in the background.
self.addEventListener('fetch', (event) => {
    // Ignore Firebase API calls & Google Auth requests
    if (event.request.url.includes('firestore.googleapis.com') || 
        event.request.url.includes('identitytoolkit') ||
        event.request.url.includes('server-xy7s.onrender.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // Fetch fresh data from the network in the background
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                // If it's a valid response, update the cache
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Ignore network errors (we are offline)
            });

            // Return cached response instantly if we have it, otherwise wait for the network
            return cachedResponse || fetchPromise;
        })
    );
});