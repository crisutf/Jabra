const CACHE_NAME = 'jabra-cache-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './index.mobile.html',
    './index.desktop.html',
    './css/theme.css',
    './js/app.js',
    './json/songs.json',
    './img/icon-192.png',
    './img/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
});
