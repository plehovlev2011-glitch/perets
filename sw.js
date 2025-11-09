const CACHE_NAME = 'perets-cache-v7';
const urlsToCache = [
  '/',
  '/fonts/seenonim-v1.ttf',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Установка Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('All resources cached');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('Cache installation failed:', error);
      })
  );
});

// Активация Service Worker
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker activated');
      return self.clients.claim();
    })
  );
});

// Обработка запросов
self.addEventListener('fetch', event => {
  // Для Figma iframe - пропускаем без кеширования
  if (event.request.url.includes('figma.site')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // Для остальных запросов - стратегия "сеть сначала, потом кеш"
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Если запрос успешен, кешируем ответ
        if (response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
        }
        return response;
      })
      .catch(() => {
        // Если сеть недоступна, пробуем кеш
        return caches.match(event.request)
          .then(response => {
            return response || new Response('Offline', { status: 503 });
          });
      })
  );
});

// Фоновая синхронизация (если поддерживается)
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    console.log('Background sync triggered');
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Здесь можно добавить фоновую синхронизацию данных
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'BACKGROUND_SYNC',
      timestamp: Date.now()
    });
  });
}

// Обработка сообщений от главной страницы
self.addEventListener('message', event => {
  const { type } = event.data;
  
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (type === 'GET_CACHE_INFO') {
    caches.keys().then(cacheNames => {
      event.ports[0].postMessage({
        type: 'CACHE_INFO',
        cacheNames: cacheNames,
        currentCache: CACHE_NAME
      });
    });
  }
});
