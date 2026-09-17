/**
 * Service Worker Dedicado para Sincronización de Archivos con Google Drive en Segundo Plano
 * Sistema de Control de Personal y Expendios 4-72 - CAMARCA SAS
 *
 * Características:
 * - Ejecución autónoma en segundo plano sin bloquear el hilo principal de la UI.
 * - Acceso directo a IndexedDB (CamarcaPhotosDB) para leer y actualizar registros.
 * - Reintentos automáticos con retroceso exponencial (Exponential Backoff + Jitter) ante fallos de conexión (offline, timeout, HTTP 429, 5xx).
 * - Soporte para la Background Sync API (tag: 'camarca-drive-sync').
 * - Comunicación bidireccional vía BroadcastChannel y postMessage hacia todas las pestañas/ventanas activas.
 * - Sincronización automática a Google Drive organizada por carpetas municipales.
 */

const SW_VERSION = 'camarca-drive-sw-v1.0';
const SYNC_TAG = 'camarca-drive-sync';
const CHANNEL_NAME = 'camarca_drive_sync_channel';
const PHOTOS_ROOT_FOLDER_NAME = 'Fotos Expendios 4-72 - CAMARCA SAS';

// Canal de difusión para telemetría en tiempo real
let broadcastChannel = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  }
} catch (e) {
  console.warn('[SW] BroadcastChannel no disponible:', e);
}

// Estado en memoria del Service Worker
let currentOAuthToken = null;
let isSyncingActive = false;
let syncStats = {
  isSyncing: false,
  totalInQueue: 0,
  processedCount: 0,
  syncedCount: 0,
  failedCount: 0,
  retryingCount: 0,
  lastSyncTime: null,
  lastError: null,
  currentFile: null,
};

// ============================================================================
// 1. UTILIDADES Y COMUNICACIÓN CON CLIENTES
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function broadcast(type, payload = {}) {
  const message = {
    type,
    payload,
    timestamp: Date.now(),
    version: SW_VERSION,
  };

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(message);
    } catch (err) {
      // canal cerrado
    }
  }

  // Notificar también a todos los clientes conectados a través de postMessage
  self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
    for (const client of clients) {
      try {
        client.postMessage(message);
      } catch (e) {}
    }
  }).catch(() => {});
}

// ============================================================================
// 2. ACCESO A INDEXEDDB (CamarcaPhotosDB & CamarcaSyncWorkerDB)
// ============================================================================

function openPhotoDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('CamarcaPhotosDB');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      console.warn('[SW] Apertura de CamarcaPhotosDB bloqueada');
    };
  });
}

function openWorkerSettingsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('CamarcaSyncWorkerDB', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveWorkerTokenToDB(token) {
  if (!token) return;
  currentOAuthToken = token;
  try {
    const db = await openWorkerSettingsDB();
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    store.put(token, 'google_drive_token');
    store.put(Date.now(), 'token_updated_at');
  } catch (e) {
    console.warn('[SW] No se pudo persistir token en worker DB:', e);
  }
}

async function getWorkerTokenFromDB() {
  if (currentOAuthToken) return currentOAuthToken;
  try {
    const db = await openWorkerSettingsDB();
    const tokenFromLocalDB = await new Promise((resolve) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get('google_drive_token');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (tokenFromLocalDB) {
      currentOAuthToken = tokenFromLocalDB;
      return currentOAuthToken;
    }
  } catch (e) {}

  // Fallback: Consultar token centralizado del servidor para que el expendio no requiera iniciar sesión
  try {
    const res = await fetch('/api/admin/google-drive/token');
    if (res.ok) {
      const data = await res.json();
      if (data && data.accessToken) {
        currentOAuthToken = data.accessToken;
        await saveWorkerTokenToDB(currentOAuthToken);
        return currentOAuthToken;
      }
    }
  } catch (err) {
    console.warn('[SW] No se pudo consultar token centralizado del servidor:', err);
  }

  return null;
}

async function getPendingPhotosFromDB(db) {
  return new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains('photos')) {
        return resolve([]);
      }
      const tx = db.transaction('photos', 'readonly');
      const store = tx.objectStore('photos');
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        const pending = list.filter((p) => {
          return !p.driveSynced || p.status === 'pending' || p.status === 'failed';
        });
        resolve(pending);
      };
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function updatePhotoInDB(db, id, updates) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('photos', 'readwrite');
      const store = tx.objectStore('photos');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return resolve(false);
        const updated = Object.assign({}, record, updates);
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    } catch (err) {
      reject(err);
    }
  });
}

// ============================================================================
// 3. LOGICA DE API GOOGLE DRIVE (Subida Multipart y Creación de Carpetas)
// ============================================================================

function formatMunicipioNombre(raw) {
  const clean = (raw || 'General')
    .toString()
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

  if (!clean) return 'General';
  return clean
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Cache en memoria para IDs de carpetas para evitar peticiones repetidas
const folderCache = new Map();

async function getOrCreateDriveFolder(token, folderName, parentId = null) {
  const cacheKey = `${parentId || 'root'}_${folderName}`;
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }

  let query = `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,webViewLink)&spaces=drive`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      const folder = searchData.files[0];
      folderCache.set(cacheKey, folder);
      return folder;
    }
  }

  // Crear carpeta si no existe
  const bodyData = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    bodyData.parents = [parentId];
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyData),
  });

  if (!createRes.ok) {
    const errJson = await createRes.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `Error creando carpeta ${folderName} (HTTP ${createRes.status})`);
  }

  const created = await createRes.json();
  folderCache.set(cacheKey, created);
  return created;
}

/**
 * Realiza la subida multipart de una fotografía a Google Drive
 */
async function uploadPhotoToDriveAPI(token, record, targetFolderId) {
  let blob = record.blob;
  if (!blob && record.dataUrl) {
    // Reconstruir blob desde dataUrl si no vino como Blob
    const parts = record.dataUrl.split(',');
    const binary = atob(parts[1] || parts[0]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: record.mimeType || 'image/jpeg' });
  }

  if (!blob || blob.size === 0) {
    throw new Error('El archivo no contiene bytes válidos para transmitir.');
  }

  const fileName = record.fileName || `foto_${record.slotKey}_${record.cedula}.jpg`;
  const boundary = `-------CamarcaSWBoundary${Date.now()}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    mimeType: blob.type || 'image/jpeg',
    parents: [targetFolderId],
    description: `Fotografía de expendio ${record.cedula} (${record.slotTitle || record.slotKey}) - Municipio: ${record.municipio || 'Giron'}. Sincronizada en segundo plano vía Service Worker.`,
  };

  const arrayBuffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  const encoder = new TextEncoder();
  const part1 = encoder.encode(
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${blob.type || 'image/jpeg'}\r\n\r\n`
  );
  const part2 = encoder.encode(closeDelimiter);

  const fullBody = new Uint8Array(part1.length + uint8.length + part2.length);
  fullBody.set(part1, 0);
  fullBody.set(uint8, part1.length);
  fullBody.set(part2, part1.length + uint8.length);

  const uploadUrl =
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink';

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: fullBody,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    const errorObj = new Error(err?.error?.message || `Fallo en API Drive (HTTP ${uploadRes.status})`);
    errorObj.status = uploadRes.status;
    throw errorObj;
  }

  return await uploadRes.json();
}

/**
 * Notifica al backend local del registro de la foto para mantener trazabilidad
 */
async function registerPhotoWithBackend(record, driveFile) {
  try {
    await fetch('/api/admin/google-drive/register-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cedula: record.cedula,
        slotKey: record.slotKey,
        driveFileId: driveFile.id,
        webViewLink: driveFile.webViewLink,
        webContentLink: driveFile.webContentLink,
        folderName: record.municipio,
        fileName: record.fileName,
        fileSize: record.fileSize,
        syncedVia: 'ServiceWorker_BackgroundSync',
      }),
    });
  } catch (e) {
    console.warn('[SW] No se pudo registrar en backend (se mantiene en Drive):', e);
  }
}

// ============================================================================
// 4. MOTOR DE SINCRONIZACIÓN CON RETINTENTOS EXPONENCIALES
// ============================================================================

function isRetryableNetworkError(err) {
  if (!navigator.onLine) return true;
  if (!err) return false;
  if (err.status === 429 || (err.status >= 500 && err.status <= 599) || err.status === 408) {
    return true;
  }
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('connection') ||
    msg.includes('offline')
  );
}

/**
 * Ejecuta la sincronización de archivos pendientes en IndexedDB con reintentos automáticos
 */
async function runBackgroundDriveSync(triggerSource = 'manual') {
  if (isSyncingActive) {
    console.log('[SW] Sincronización en segundo plano ya se encuentra en ejecución.');
    return { status: 'already_running' };
  }

  isSyncingActive = true;
  syncStats.isSyncing = true;
  syncStats.lastError = null;

  try {
    const token = await getWorkerTokenFromDB();
    if (!token) {
      const err = 'No hay token OAuth de Google Drive configurado en el Service Worker.';
      syncStats.lastError = err;
      broadcast('SYNC_TOKEN_REQUIRED', { message: err });
      isSyncingActive = false;
      syncStats.isSyncing = false;
      return { status: 'no_token', error: err };
    }

    const db = await openPhotoDB();
    const pendingPhotos = await getPendingPhotosFromDB(db);

    syncStats.totalInQueue = pendingPhotos.length;
    syncStats.processedCount = 0;
    syncStats.syncedCount = 0;
    syncStats.failedCount = 0;
    syncStats.retryingCount = 0;

    broadcast('SYNC_STARTED', {
      total: pendingPhotos.length,
      trigger: triggerSource,
    });

    if (pendingPhotos.length === 0) {
      isSyncingActive = false;
      syncStats.isSyncing = false;
      broadcast('SYNC_COMPLETED', {
        syncedCount: 0,
        failedCount: 0,
        total: 0,
        message: 'No hay fotografías pendientes en IndexedDB.',
      });
      return { status: 'empty' };
    }

    // Asegurar carpeta principal en Google Drive
    let rootFolder;
    try {
      rootFolder = await getOrCreateDriveFolder(token, PHOTOS_ROOT_FOLDER_NAME);
    } catch (rootErr) {
      if (rootErr.status === 401) {
        broadcast('SYNC_TOKEN_EXPIRED', { message: 'El token de Google Drive ha expirado.' });
      }
      throw rootErr;
    }

    // Procesar cada elemento de la cola de forma no bloqueante
    for (let i = 0; i < pendingPhotos.length; i++) {
      const item = pendingPhotos[i];
      syncStats.currentFile = item.fileName;
      syncStats.processedCount = i + 1;

      broadcast('SYNC_PROGRESS', {
        current: i + 1,
        total: pendingPhotos.length,
        fileName: item.fileName,
        cedula: item.cedula,
        municipio: item.municipio,
      });

      // Máximo de reintentos por archivo con retroceso exponencial
      const MAX_RETRIES = 3;
      let attempt = 0;
      let uploadSuccess = false;
      let lastItemError = '';

      while (attempt <= MAX_RETRIES && !uploadSuccess) {
        try {
          // Verificar conectividad antes de iniciar
          if (!navigator.onLine) {
            throw new Error('Dispositivo fuera de línea (offline). Esperando reconexión.');
          }

          // Obtener o crear carpeta del municipio correspondiente
          const muniName = formatMunicipioNombre(item.municipio);
          const muniFolder = await getOrCreateDriveFolder(token, muniName, rootFolder.id);

          // Subir a Drive
          const driveResult = await uploadPhotoToDriveAPI(token, item, muniFolder.id);

          // Éxito: actualizar en IndexedDB
          await updatePhotoInDB(db, item.id, {
            driveSynced: true,
            driveSyncedAt: new Date().toISOString(),
            driveFileId: driveResult.id,
            driveWebViewLink: driveResult.webViewLink,
            driveFolderName: muniFolder.name,
            status: 'synced',
            lastError: undefined,
          });

          // Notificar al backend local
          await registerPhotoWithBackend(item, driveResult);

          uploadSuccess = true;
          syncStats.syncedCount++;

          broadcast('SYNC_ITEM_SUCCESS', {
            photoId: item.id,
            fileName: item.fileName,
            driveFileId: driveResult.id,
            webViewLink: driveResult.webViewLink,
            current: i + 1,
            total: pendingPhotos.length,
          });

          // Pausa corta entre archivos para respetar cuotas de la API de Google
          await sleep(250);
        } catch (itemErr) {
          attempt++;
          lastItemError = itemErr.message || String(itemErr);

          if (itemErr.status === 401) {
            // Token expirado: detener cola y solicitar refresco a la UI
            broadcast('SYNC_TOKEN_EXPIRED', {
              message: 'Token de Google Drive expirado. Se requiere re-autenticación.',
            });
            await updatePhotoInDB(db, item.id, {
              status: 'failed',
              lastError: 'Token expirado (401)',
            });
            syncStats.failedCount++;
            break;
          }

          if (attempt <= MAX_RETRIES && isRetryableNetworkError(itemErr)) {
            syncStats.retryingCount++;
            // Retroceso exponencial: 1s, 2s, 4s + jitter aleatorio
            const backoffDelay = Math.min(20000, Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 500));

            broadcast('SYNC_ITEM_RETRY', {
              photoId: item.id,
              fileName: item.fileName,
              attempt,
              maxRetries: MAX_RETRIES,
              delayMs: backoffDelay,
              error: lastItemError,
            });

            await sleep(backoffDelay);
          } else {
            // Se agotaron los reintentos
            syncStats.failedCount++;
            await updatePhotoInDB(db, item.id, {
              status: 'failed',
              attempts: (item.attempts || 0) + attempt,
              lastAttemptAt: new Date().toISOString(),
              lastError: `Reintentos agotados: ${lastItemError}`,
            });

            broadcast('SYNC_ITEM_FAILED', {
              photoId: item.id,
              fileName: item.fileName,
              error: lastItemError,
              attempts: attempt,
            });
          }
        }
      }
    }

    syncStats.lastSyncTime = new Date().toISOString();
    broadcast('SYNC_COMPLETED', {
      syncedCount: syncStats.syncedCount,
      failedCount: syncStats.failedCount,
      total: pendingPhotos.length,
      timestamp: syncStats.lastSyncTime,
    });

    return {
      status: 'completed',
      syncedCount: syncStats.syncedCount,
      failedCount: syncStats.failedCount,
    };
  } catch (globalErr) {
    syncStats.lastError = globalErr.message;
    console.error('[SW] Error en sincronización en segundo plano:', globalErr);
    broadcast('SYNC_ERROR', {
      error: globalErr.message,
    });
    return { status: 'error', error: globalErr.message };
  } finally {
    isSyncingActive = false;
    syncStats.isSyncing = false;
    syncStats.currentFile = null;
  }
}

// ============================================================================
// 5. EVENTOS DEL CICLO DE VIDA DEL SERVICE WORKER
// ============================================================================

self.addEventListener('install', (event) => {
  console.log(`[SW] Instalando Service Worker de Sincronización (${SW_VERSION})...`);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log(`[SW] Service Worker Activado (${SW_VERSION}). Tomando control de clientes.`);
  event.waitUntil(self.clients.claim());
});

// Evento de Background Sync API (cuando el navegador detecta reconexión)
self.addEventListener('sync', (event) => {
  console.log(`[SW] Evento 'sync' recibido: tag = "${event.tag}"`);
  if (event.tag === SYNC_TAG || event.tag === 'drive-photo-sync') {
    event.waitUntil(runBackgroundDriveSync('background_sync_event'));
  }
});

// Evento de Periodic Sync API (si el navegador lo soporta)
self.addEventListener('periodicsync', (event) => {
  console.log(`[SW] Evento 'periodicsync' recibido: tag = "${event.tag}"`);
  if (event.tag === 'camarca-drive-periodic-sync') {
    event.waitUntil(runBackgroundDriveSync('periodic_sync_event'));
  }
});

// Mensajería con las ventanas de la aplicación (postMessage)
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  switch (data.type) {
    case 'SET_TOKEN':
      if (data.token) {
        saveWorkerTokenToDB(data.token).then(() => {
          if (data.reply) {
            event.ports?.[0]?.postMessage({ ok: true, version: SW_VERSION });
          }
        });
      }
      break;

    case 'START_SYNC':
      if (data.token) {
        saveWorkerTokenToDB(data.token);
      }
      event.waitUntil(runBackgroundDriveSync(data.trigger || 'message_trigger'));
      if (event.ports?.[0]) {
        event.ports[0].postMessage({ ok: true, message: 'Sincronización en proceso' });
      }
      break;

    case 'GET_STATUS':
      if (event.ports?.[0]) {
        event.ports[0].postMessage({
          version: SW_VERSION,
          stats: syncStats,
          hasToken: !!currentOAuthToken,
        });
      }
      break;

    case 'PING':
      if (event.ports?.[0]) {
        event.ports[0].postMessage({
          pong: true,
          version: SW_VERSION,
          isSyncing: isSyncingActive,
        });
      }
      break;

    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    default:
      break;
  }
});
