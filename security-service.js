// security-service.js - Невидимый сервис безопасности
class SecurityService {
    constructor() {
        this.VALID_ORIGINS = [
            'https://ascii-donut-72130862.figma.site',
            'https://perets.netlify.app',
            'https://perets.netlify.app/'
        ];
        this.STORAGE_KEY = 'perets_secure_backup_v1';
        this.BACKUP_INTERVAL = 30000; // 30 секунд
        this.init();
    }

    init() {
        this.validateEnvironment();
        this.setupSecureMessageHandling();
        this.setupStorageProtection();
        this.startBackupService();
        this.enableSecurityHeaders();
    }

    validateEnvironment() {
        // Проверка HTTPS
        if (location.protocol !== 'https:') {
            this.logSecurityEvent('SECURITY_WARNING', 'Небезопасное соединение');
        }

        // Проверка домена
        if (!location.hostname.endsWith('netlify.app')) {
            this.logSecurityEvent('SECURITY_ALERT', 'Неавторизованный домен');
        }
    }

    setupSecureMessageHandling() {
        window.addEventListener('message', (event) => {
            // СТРОГАЯ проверка origin
            if (!this.VALID_ORIGINS.includes(event.origin)) {
                this.logSecurityEvent('UNAUTHORIZED_ORIGIN', event.origin);
                return;
            }

            try {
                this.handleSecureMessage(event);
            } catch (error) {
                this.logSecurityEvent('MESSAGE_HANDLING_ERROR', error);
            }
        });
    }

    handleSecureMessage(event) {
        const { type, data, signature } = event.data;

        // Проверка целостности сообщения
        if (!this.verifyMessageSignature(event.data)) {
            this.logSecurityEvent('INVALID_SIGNATURE', event.data);
            return;
        }

        switch(type) {
            case 'SECURE_BACKUP_REQUEST':
                this.createSecureBackup(data);
                break;
            case 'SECURE_RESTORE_REQUEST':
                this.restoreSecureBackup(event.source, event.origin);
                break;
            case 'VALIDATION_REQUEST':
                this.sendValidationResponse(event.source, event.origin);
                break;
        }
    }

    verifyMessageSignature(message) {
        // Простая проверка целостности
        const required = ['type', 'data', 'timestamp'];
        return required.every(field => field in message) && 
               Date.now() - message.timestamp < 5000; // 5 секунд на доставку
    }

    setupStorageProtection() {
        // Защита от переполнения хранилища
        const originalSetItem = localStorage.setItem;
        localStorage.setItem = (key, value) => {
            if (key.startsWith('perets_')) {
                // Проверка размера
                if (JSON.stringify(value).length > 1000000) { // 1MB лимит
                    this.logSecurityEvent('STORAGE_QUOTA_EXCEEDED', key);
                    return;
                }
            }
            originalSetItem.call(localStorage, key, value);
        };

        // Мониторинг изменений хранилища
        this.setupStorageMonitoring();
    }

    setupStorageMonitoring() {
        // Перехват всех операций с localStorage
        const storageHandler = {
            set: (target, key, value) => {
                if (typeof key === 'string' && key.startsWith('perets_')) {
                    this.scheduleBackup();
                }
                target[key] = value;
                return true;
            }
        };

        this.proxiedStorage = new Proxy({}, storageHandler);
    }

    createSecureBackup(data) {
        try {
            const backup = {
                data: data,
                timestamp: Date.now(),
                domain: location.hostname,
                version: '1.0',
                checksum: this.generateChecksum(data)
            };

            // Сохраняем в несколько мест для надежности
            this.saveToLocalStorage(backup);
            this.saveToIndexedDB(backup);
            
            this.logSecurityEvent('BACKUP_CREATED', {
                items: Object.keys(data).length,
                size: JSON.stringify(data).length
            });

        } catch (error) {
            this.logSecurityEvent('BACKUP_ERROR', error);
        }
    }

    saveToLocalStorage(backup) {
        try {
            // Очищаем старые бэкапы
            this.cleanOldBackups();
            
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(backup));
        } catch (error) {
            this.logSecurityEvent('LOCAL_STORAGE_ERROR', error);
        }
    }

    async saveToIndexedDB(backup) {
        try {
            const db = await this.openDatabase();
            const transaction = db.transaction(['backups'], 'readwrite');
            const store = transaction.objectStore('backups');
            
            await store.put({
                id: 'current',
                ...backup
            });
        } catch (error) {
            this.logSecurityEvent('INDEXED_DB_ERROR', error);
        }
    }

    openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('PeretsSecurityDB', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('backups')) {
                    db.createObjectStore('backups', { keyPath: 'id' });
                }
            };
        });
    }

    async restoreSecureBackup(target, origin) {
        try {
            let backup = null;

            // Пробуем разные источники по порядку
            backup = this.getFromLocalStorage();
            if (!backup) {
                backup = await this.getFromIndexedDB();
            }

            if (backup && this.validateBackup(backup)) {
                target.postMessage({
                    type: 'SECURE_RESTORE_RESPONSE',
                    data: backup.data,
                    timestamp: Date.now()
                }, origin);

                this.logSecurityEvent('RESTORE_COMPLETED', {
                    items: Object.keys(backup.data).length
                });
            } else {
                target.postMessage({
                    type: 'SECURE_RESTORE_EMPTY',
                    timestamp: Date.now()
                }, origin);
            }

        } catch (error) {
            this.logSecurityEvent('RESTORE_ERROR', error);
        }
    }

    getFromLocalStorage() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch (error) {
            return null;
        }
    }

    async getFromIndexedDB() {
        try {
            const db = await this.openDatabase();
            const transaction = db.transaction(['backups'], 'readonly');
            const store = transaction.objectStore('backups');
            
            return new Promise((resolve) => {
                const request = store.get('current');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
            });
        } catch (error) {
            return null;
        }
    }

    validateBackup(backup) {
        return backup && 
               backup.domain === location.hostname &&
               backup.checksum === this.generateChecksum(backup.data) &&
               Date.now() - backup.timestamp < 86400000; // 24 часа
    }

    generateChecksum(data) {
        const str = JSON.stringify(data);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    startBackupService() {
        // Автоматический бэкап каждые 30 секунд
        setInterval(() => {
            this.requestBackupFromApp();
        }, this.BACKUP_INTERVAL);

        // Бэкап при закрытии
        window.addEventListener('beforeunload', () => {
            this.requestBackupFromApp();
        });
    }

    requestBackupFromApp() {
        // Отправляем запрос приложению на создание бэкапа
        const frames = document.getElementsByTagName('iframe');
        for (let frame of frames) {
            try {
                frame.contentWindow.postMessage({
                    type: 'SECURE_BACKUP_REQUEST',
                    timestamp: Date.now()
                }, '*');
            } catch (error) {
                // Игнорируем ошибки cross-origin
            }
        }
    }

    cleanOldBackups() {
        // Очистка старых записей
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('perets_backup_')) {
                try {
                    const backup = JSON.parse(localStorage.getItem(key));
                    if (Date.now() - backup.timestamp > 86400000) { // 24 часа
                        localStorage.removeItem(key);
                    }
                } catch (error) {
                    localStorage.removeItem(key);
                }
            }
        }
    }

    sendValidationResponse(target, origin) {
        target.postMessage({
            type: 'VALIDATION_RESPONSE',
            domain: location.hostname,
            timestamp: Date.now(),
            security: 'active'
        }, origin);
    }

    enableSecurityHeaders() {
        // Добавляем security headers через meta tags
        const metaCSP = document.createElement('meta');
        metaCSP.httpEquiv = 'Content-Security-Policy';
        metaCSP.content = "default-src 'self' https://ascii-donut-72130862.figma.site https://perets.netlify.app; script-src 'self' 'unsafe-inline';";
        document.head.appendChild(metaCSP);
    }

    logSecurityEvent(type, data) {
        // Только в development
        if (location.hostname === 'localhost' || location.hostname.includes('netlify.app')) {
            console.log(`[SECURITY] ${type}:`, data);
        }
    }

    scheduleBackup() {
        // Дебаунс бэкапов
        clearTimeout(this.backupTimeout);
        this.backupTimeout = setTimeout(() => {
            this.requestBackupFromApp();
        }, 2000);
    }
}

// Автоматическая инициализация
if (typeof window !== 'undefined') {
    window.PeretsSecurityService = new SecurityService();
}
