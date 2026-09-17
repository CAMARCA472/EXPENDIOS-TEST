import { OfflinePhotoItem } from '../types';
import {
  photoDB,
  savePhotoToIndexedDB,
  getPendingPhotos,
  syncAllPendingPhotos,
  clearSyncedPhotosFromIndexedDB,
  PHOTO_DB_UPDATED_EVENT,
} from '../lib/photoStorageDB';

// Memoria caché para respuestas síncronas de getOfflinePhotoQueue()
let cachedQueue: OfflinePhotoItem[] = [];

// Cargar estado inicial desde IndexedDB
async function refreshMemoryCacheFromDB() {
  try {
    const pending = await getPendingPhotos();
    cachedQueue = pending.map((p) => ({
      id: p.uuid || `photo-queue-${p.id || Date.now()}`,
      cedula: p.cedula,
      expendioNombre: p.expendioNombre || '',
      municipio: p.municipio || 'Giron',
      slotKey: p.slotKey,
      slotTitle: p.slotTitle || p.slotKey,
      dataUrl: p.dataUrl,
      timestamp: p.createdAt || new Date(p.timestamp).toISOString(),
      coords: p.gpsCoordinates || null,
      status: p.status === 'uploading' ? 'syncing' : p.status === 'synced' ? 'synced' : p.status === 'failed' ? 'failed' : 'queued',
      errorMessage: p.lastError,
      retries: p.attempts || 0,
    }));

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('camarca_offline_queue_updated', { detail: cachedQueue }));
    }
  } catch (err) {
    console.warn('[OfflineQueue] Error actualizando caché desde IndexedDB:', err);
  }
}

if (typeof window !== 'undefined') {
  refreshMemoryCacheFromDB();
  window.addEventListener(PHOTO_DB_UPDATED_EVENT, () => {
    refreshMemoryCacheFromDB();
  });
}

export function getOfflinePhotoQueue(): OfflinePhotoItem[] {
  return cachedQueue;
}

export function saveOfflinePhotoQueue(queue: OfflinePhotoItem[]): void {
  cachedQueue = queue;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('camarca_offline_queue_updated', { detail: queue }));
  }
}

export function addPhotoToOfflineQueue(
  item: Omit<OfflinePhotoItem, 'id' | 'timestamp' | 'status' | 'retries'>
): OfflinePhotoItem {
  const newItem: OfflinePhotoItem = {
    ...item,
    id: `photo-queue-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
    timestamp: new Date().toISOString(),
    status: 'queued',
    retries: 0,
  };

  // Guardar de forma asíncrona pero inmediata en IndexedDB (no se pierde si el navegador cierra)
  savePhotoToIndexedDB({
    cedula: item.cedula,
    slotKey: item.slotKey,
    slotTitle: item.slotTitle,
    dataUrl: item.dataUrl,
    expendioNombre: item.expendioNombre,
    municipio: item.municipio,
    coords: item.coords,
  }).catch((err) => {
    console.error('[OfflineQueue] Error persistiendo en IndexedDB:', err);
  });

  const existingIndex = cachedQueue.findIndex(
    (q) => q.cedula.trim() === item.cedula.trim() && q.slotKey === item.slotKey
  );

  if (existingIndex >= 0) {
    cachedQueue[existingIndex] = newItem;
  } else {
    cachedQueue.push(newItem);
  }

  saveOfflinePhotoQueue(cachedQueue);
  return newItem;
}

export function removePhotoFromOfflineQueue(id: string): void {
  cachedQueue = cachedQueue.filter((item) => item.id !== id);
  saveOfflinePhotoQueue(cachedQueue);
  // También eliminar en IndexedDB si coincide uuid
  photoDB.photos.where('uuid').equals(id).delete().catch(() => {});
}

export function clearSyncedPhotosFromQueue(): void {
  cachedQueue = cachedQueue.filter((item) => item.status !== 'synced');
  saveOfflinePhotoQueue(cachedQueue);
  clearSyncedPhotosFromIndexedDB().catch(() => {});
}

/**
 * Attempts to sync all queued photos with the server and Google Drive using IndexedDB.
 */
export async function syncOfflinePhotos(
  onProgress?: (synced: number, total: number, currentItem: OfflinePhotoItem) => void
): Promise<{ syncedCount: number; failedCount: number; errors: string[] }> {
  const res = await syncAllPendingPhotos({
    onProgress: (current, total, photo) => {
      if (onProgress) {
        onProgress(current, total, {
          id: photo.uuid,
          cedula: photo.cedula,
          expendioNombre: photo.expendioNombre,
          municipio: photo.municipio,
          slotKey: photo.slotKey,
          slotTitle: photo.slotTitle,
          dataUrl: photo.dataUrl,
          timestamp: photo.createdAt,
          coords: photo.gpsCoordinates,
          status: 'syncing',
          retries: photo.attempts,
        });
      }
    },
  });

  await refreshMemoryCacheFromDB();
  return res;
}

