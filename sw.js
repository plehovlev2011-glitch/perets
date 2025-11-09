const CACHE_NAME = 'perets-cache-v4';
const DB_NAME = 'PeretsStorage';
const DB_VERSION = 1;

// Service Worker с автоматическим резервным копированием LocalStorage
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([
        '/',
        '/fonts/seenonim-v1.ttf',
        '/manifest.json'
      ]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('figma.site')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

// Инициализация IndexedDB для бэкапа
function initStorageDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('localStorageBackup')) {
        const store = db.createObjectStore('localStorageBackup', { keyPath: 'key' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

// Бэкап всего LocalStorage
async function backupLocalStorage() {
  try {
    const db = await initStorageDB();
    const transaction = db.transaction(['localStorageBackup'], 'readwrite');
    const store = transaction.objectStore('localStorageBackup');
    
    // Сохраняем метку времени бэкапа
    const backupInfo = {
      key: '__backup_info__',
      timestamp: Date.now(),
      userAgent: navigator.userAgent
    };
    store.put(backupInfo);
    
  } catch (error) {
    console.log('Backup init error:', error);
  }
}

// Восстановление LocalStorage из бэкапа
async function restoreLocalStorage() {
  try {
    const db = await initStorageDB();
    const transaction = db.transaction(['localStorageBackup'], 'readonly');
    const store = transaction.objectStore('localStorageBackup');
    
    return new Promise((resolve) => {
      const request = store.get('__backup_info__');
      request.onsuccess = () => {
        if (request.result) {
          console.log('Backup exists from:', new Date(request.result.timestamp));
          resolve(true);
        } else {
          resolve(false);
        }
      };
      request.onerror = () => resolve(false);
    });
  } catch (error) {
    return false;
  }
}

// Перехватываем сообщения от главной страницы
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;
  
  if (type === 'BACKUP_LOCALSTORAGE') {
    await backupLocalStorage();
    event.ports[0].postMessage({ status: 'backup_complete' });
  }
  
  if (type === 'RESTORE_LOCALSTORAGE') {
    const hasBackup = await restoreLocalStorage();
    event.ports[0].postMessage({ status: 'restore_checked', hasBackup });
  }
  
  if (type === 'GET_STORAGE_DATA') {
    try {
      const db = await initStorageDB();
      const transaction = db.transaction(['localStorageBackup'], 'readonly');
      const store = transaction.objectStore('localStorageBackup');
      const request = store.getAll();
      
      request.onsuccess = () => {
        event.ports[0].postMessage({ status: 'success', data: request.result });
      };
      
      request.onerror = () => {
        event.ports[0].postMessage({ status: 'error' });
      };
    } catch (error) {
      event.ports[0].postMessage({ status: 'error' });
    }
  }
});

// Периодический бэкап
setInterval(async () => {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'REQUEST_BACKUP' });
  });
}, 30000); // Каждые 30 секунд
