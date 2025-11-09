const CACHE_NAME = 'perets-cache-v3';
const DB_NAME = 'PeretsDB';
const DB_VERSION = 1;

// Расширенный Service Worker с IndexedDB
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([
        '/',
        '/fonts/seenonim-v1.ttf',
        '/manifest.json'
      ]))
  );
});

self.addEventListener('fetch', event => {
  // Для Figma iframe - пропускаем без кеширования
  if (event.request.url.includes('figma.site')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

// Фоновая синхронизация данных
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    event.waitUntil(syncData());
  }
});

// Инициализация IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('appData')) {
        db.createObjectStore('appData', { keyPath: 'key' });
      }
    };
  });
}

// Сохранение данных в IndexedDB
async function saveToDB(key, data) {
  try {
    const db = await initDB();
    const transaction = db.transaction(['appData'], 'readwrite');
    const store = transaction.objectStore('appData');
    
    // Сохраняем с временной меткой
    const item = {
      key: key,
      value: JSON.stringify(data),
      timestamp: Date.now()
    };
    
    store.put(item);
    
    // Дублируем в кеш для надежности
    const cache = await caches.open(CACHE_NAME);
    const response = new Response(JSON.stringify(item));
    await cache.put(`/data/${key}`, response);
    
  } catch (error) {
    console.log('Save error:', error);
  }
}

// Получение данных из IndexedDB
async function getFromDB(key) {
  try {
    const db = await initDB();
    const transaction = db.transaction(['appData'], 'readonly');
    const store = transaction.objectStore('appData');
    
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (request.result) {
          resolve(JSON.parse(request.result.value));
        } else {
          resolve(null);
        }
      };
    });
  } catch (error) {
    // Пробуем получить из кеша
    try {
      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match(`/data/${key}`);
      if (response) {
        const data = await response.json();
        return JSON.parse(data.value);
      }
    } catch (e) {
      console.log('Get from cache error:', e);
    }
    return null;
  }
}

// Фоновая синхронизация
async function syncData() {
  // Здесь можно добавить синхронизацию с сервером если нужно
  console.log('Background sync completed');
}

// Обработчик сообщений от главного окна
self.addEventListener('message', async (event) => {
  const { type, key, data } = event.data;
  
  if (type === 'SAVE_DATA') {
    await saveToDB(key, data);
    event.ports[0].postMessage({ status: 'saved' });
  }
  
  if (type === 'GET_DATA') {
    const result = await getFromDB(key);
    event.ports[0].postMessage({ status: 'success', data: result });
  }
});
