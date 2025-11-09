const CACHE_NAME = 'perets-cache-v8';
const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY', 
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

// Критические ресурсы для кеширования
const CRITICAL_URLS = [
    '/',
    '/manifest.json',
    '/fonts/seenonim-v1.ttf',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

self.addEventListener('install', event => {
    console.log('[SW] Installing new version...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching critical resources');
                return cache.addAll(CRITICAL_URLS);
            })
            .then(() => {
                console.log('[SW] Installation complete');
                return self.skipWaiting();
            })
            .catch(error => {
                console.error('[SW] Installation failed:', error);
            })
    );
});

self.addEventListener('activate', event => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[SW] Activation complete');
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', event => {
    // Для Figma iframe - пропускаем без кеширования
    if (event.request.url.includes('figma.site')) {
        event.respondWith(fetch(event.request));
        return;
    }
    
    // Для наших ресурсов - стратегия "Network First"
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Если запрос успешен, обновляем кеш
                if (response.status === 200) {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                }
                
                // Добавляем security headers
                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: this.addSecurityHeaders(response.headers)
                });
            })
            .catch(() => {
                // Если сеть недоступна, пробуем кеш
                return caches.match(event.request)
                    .then(response => {
                        if (response) {
                            return new Response(response.body, {
                                status: response.status,
                                headers: this.addSecurityHeaders(response.headers)
                            });
                        }
                        
                        // Fallback для offline
                        return new Response('Оффлайн режим', {
                            status: 503,
                            headers: new Headers({
                                'Content-Type': 'text/plain; charset=utf-8',
                                ...SECURITY_HEADERS
                            })
                        });
                    });
            })
    );
});

// Добавление security headers к ответам
function addSecurityHeaders(originalHeaders) {
    const headers = new Headers(originalHeaders);
    
    Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
        if (!headers.has(key)) {
            headers.set(key, value);
        }
    });
    
    return headers;
}

// Фоновая синхронизация
self.addEventListener('sync', event => {
    if (event.tag === 'background-sync') {
        console.log('[SW] Background sync triggered');
        event.waitUntil(this.doBackgroundSync());
    }
});

async function doBackgroundSync() {
    // Можно добавить фоновую синхронизацию данных
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
        client.postMessage({
            type: 'BACKGROUND_SYNC',
            timestamp: Date.now()
        });
    });
}

// Обработка сообщений
self.addEventListener('message', event => {
    const { type } = event.data;
    
    if (type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (type === 'GET_CACHE_STATUS') {
        caches.keys().then(cacheNames => {
            event.ports[0].postMessage({
                type: 'CACHE_STATUS',
                caches: cacheNames,
                current: CACHE_NAME,
                version: '8'
            });
        });
    }
});

// Обработка ошибок
self.addEventListener('error', event => {
    console.error('[SW] Error:', event.error);
});

self.addEventListener('unhandledrejection', event => {
    console.error('[SW] Unhandled rejection:', event.reason);
});
