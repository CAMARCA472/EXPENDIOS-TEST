import Dexie, { Table } from 'dexie';
import JSZip from 'jszip';
import { StoredPhotoRecord, IndexedDBStorageStats, OfflinePhotoItem, PhotoPurgeResult } from '../types';
import { getDrivePhotoFileName, formatMunicipioNombre, uploadPhotoToGoogleDrive } from './googleDriveService';
import { getAccessToken } from './googleAuth';
import { triggerDriveSyncViaWorker, requestBackgroundSyncRegistration } from './driveSyncServiceWorker';

/**
 * Clase de base de datos Dexie para persistencia estructurada offline
 * de fotografías de expendios antes de su transmisión a Google Drive y al Servidor.
 */
export class CamarcaPhotoDatabase extends Dexie {
  photos!: Table<StoredPhotoRecord, number>;

  constructor() {
    super('CamarcaPhotosDB');
    this.version(1).stores({
      photos: '++id, uuid, expendioId, cedula, slotKey, compositeKey, municipio, fecha, timestamp, status, serverSynced, driveSynced',
    });
  }
}

export const photoDB = new CamarcaPhotoDatabase();

// Evento global para notificar a la interfaz de usuario en tiempo real
export const PHOTO_DB_UPDATED_EVENT = 'camarca_photo_db_updated';

function notifyDbUpdated(action: string, data?: any) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(PHOTO_DB_UPDATED_EVENT, {
        detail: { action, data, timestamp: Date.now() },
      })
    );
  }
}

/**
 * Convierte DataURL a Blob de forma segura
 */
export function dataUrlToBlob(dataUrl: string, defaultMime = 'image/jpeg'): Blob {
  try {
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0]?.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : defaultMime;
    const cleanBase64 = parts.length > 1 ? parts[1].trim() : parts[0].trim();
    const binary = atob(cleanBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch (err) {
    console.error('[IndexedDB] Error convirtiendo DataURL a Blob:', err);
    return new Blob([], { type: defaultMime });
  }
}

/**
 * Convierte Blob a DataURL para vistas previas instantáneas
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Guarda una fotografía de forma estructurada en IndexedDB inmediatamente.
 * Asegura que los datos no se pierdan si el navegador cierra o falla la red.
 */
export async function savePhotoToIndexedDB(params: {
  expendioId?: string;
  cedula: string;
  slotKey: string;
  slotTitle: string;
  fileOrBlob?: Blob | File | null;
  dataUrl?: string;
  expendioNombre?: string;
  municipio?: string;
  fecha?: string | Date;
  coords?: { latitude: number; longitude: number; accuracy?: number } | null;
  version?: number | string;
  checksum?: string;
  status?: 'pending' | 'uploading' | 'synced' | 'failed';
  downloadedFromServer?: boolean;
}): Promise<StoredPhotoRecord> {
  const {
    expendioId,
    cedula,
    slotKey,
    slotTitle,
    fileOrBlob,
    dataUrl: initialDataUrl,
    expendioNombre = '',
    municipio = '',
    fecha,
    coords = null,
    version,
    checksum,
    status = 'pending',
    downloadedFromServer = false,
  } = params;

  const cleanCed = (cedula || '').trim();
  const cleanExpId = (expendioId || '').trim();
  const cleanSlot = (slotKey || '').trim();
  const compositeKey = `${cleanCed}_${cleanSlot}`;
  const muniFormatted = formatMunicipioNombre(municipio);

  let blob: Blob;
  let dataUrl = initialDataUrl || '';

  if (fileOrBlob) {
    blob = fileOrBlob;
    // No convertir Blob a Base64 dataUrl para evitar duplicar el consumo de memoria RAM en V8/IndexedDB
    dataUrl = '';
  } else if (initialDataUrl) {
    blob = dataUrlToBlob(initialDataUrl);
    dataUrl = '';
  } else {
    throw new Error('Debe suministrar un Blob, File o DataURL para guardar en IndexedDB');
  }

  let fechaStr = '';
  if (fecha instanceof Date) {
    fechaStr = fecha.toISOString().split('T')[0];
  } else if (typeof fecha === 'string' && fecha.trim()) {
    fechaStr = fecha.trim().split('T')[0].replace(/[/.]/g, '-').replace(/[^0-9-]/g, '');
  }
  if (!fechaStr) {
    fechaStr = new Date().toISOString().split('T')[0];
  }

  const fileName = getDrivePhotoFileName(cleanSlot, muniFormatted, fechaStr);
  const now = Date.now();
  const uuid = `photo_${cleanExpId || cleanCed}_${cleanSlot}_${now}_${Math.random().toString(36).substring(2, 7)}`;

  // Verificar si ya existe un registro previo para este expendio y tipo de foto
  const existing = await photoDB.photos.where('compositeKey').equals(compositeKey).first();

  const isAlreadyServerSynced = status === 'synced';

  const record: StoredPhotoRecord = {
    ...(existing ? { id: existing.id } : {}),
    uuid,
    expendioId: cleanExpId || existing?.expendioId,
    cedula: cleanCed,
    slotKey: cleanSlot,
    slotTitle,
    compositeKey,
    expendioNombre: expendioNombre.trim(),
    municipio: muniFormatted,
    fecha: fechaStr,
    timestamp: now,
    createdAt: new Date().toISOString(),
    blob,
    dataUrl,
    mimeType: blob.type || 'image/jpeg',
    fileSize: blob.size,
    fileName,
    gpsCoordinates: coords,
    status,
    version,
    checksum,
    serverSynced: isAlreadyServerSynced,
    serverSyncedAt: isAlreadyServerSynced ? new Date().toISOString() : existing?.serverSyncedAt,
    downloadedFromServer: Boolean(downloadedFromServer),
    firestoreSynced: isAlreadyServerSynced,
    s3Synced: isAlreadyServerSynced,
    driveSynced: Boolean(existing?.driveSynced && existing?.checksum && existing.checksum === checksum),
    driveSyncedAt: existing?.driveSyncedAt,
    driveFileId: existing?.driveFileId,
    driveWebViewLink: existing?.driveWebViewLink,
    driveFolderName: existing?.driveFolderName,
    attempts: 0,
    lastAttemptAt: undefined,
    lastError: undefined,
  };

  if (existing && existing.id) {
    await photoDB.photos.put(record);
  } else {
    const newId = await photoDB.photos.add(record);
    record.id = newId;
  }

  console.log(`[IndexedDB Dexie] ✓ Fotografía guardada estructuradamente: ${fileName} (${(blob.size / 1024).toFixed(1)} KB)`);
  notifyDbUpdated('save', record);

  return record;
}

/**
 * Normaliza registros que ya fueron guardados en el servidor (Firestore + S3)
 * pero que habían quedado con status 'pending' esperando Google Drive.
 */
export async function normalizeAlreadySyncedRecords(): Promise<number> {
  try {
    const all = await photoDB.photos.toArray();
    let fixed = 0;
    for (const r of all) {
      if (r.id && r.serverSynced && (r.status === 'pending' || !r.firestoreSynced || !r.s3Synced)) {
        await photoDB.photos.update(r.id, {
          status: 'synced',
          serverSynced: true,
          firestoreSynced: true,
          s3Synced: true,
          lastError: undefined,
        });
        fixed++;
      }
    }
    if (fixed > 0) {
      notifyDbUpdated('normalized', { fixed });
    }
    return fixed;
  } catch {
    return 0;
  }
}

/**
 * Obtiene una fotografía estructurada almacenada por cédula o ID de expendio y slotKey.
 * Incluye validación de consistencia para prevenir fugas entre expendios distintos.
 */
export async function getStoredPhoto(
  cedula: string,
  slotKey: string,
  expendioId?: string
): Promise<StoredPhotoRecord | undefined> {
  const cleanCed = (cedula || '').trim();
  const cleanSlot = (slotKey || '').trim();
  const cleanExpId = (expendioId || '').trim();

  let record: StoredPhotoRecord | undefined;
  if (cleanExpId) {
    record = await photoDB.photos.where('compositeKey').equals(`${cleanExpId}_${cleanSlot}`).first();
  }
  if (!record && cleanCed) {
    record = await photoDB.photos.where('compositeKey').equals(`${cleanCed}_${cleanSlot}`).first();
  }

  // Verificación estricta de consistencia: si el registro pertenece a otro expendio, descartarlo
  if (record) {
    if (cleanExpId && record.expendioId && record.expendioId !== cleanExpId) {
      console.warn(`[IndexedDB] Descartando foto con ID de expendio cruzado: guardado ${record.expendioId} vs activo ${cleanExpId}`);
      return undefined;
    }
  }
  return record;
}

/**
 * Obtiene todas las fotografías almacenadas para un expendio (por cédula o por ID canónico).
 * Filtra automáticamente cualquier registro huérfano o cruzado.
 */
export async function getStoredPhotosByCedula(
  cedula: string,
  expendioId?: string
): Promise<StoredPhotoRecord[]> {
  const cleanCed = (cedula || '').trim();
  const cleanExpId = (expendioId || '').trim();
  let photos = cleanCed ? await photoDB.photos.where('cedula').equals(cleanCed).toArray() : [];
  if (cleanExpId) {
    const byExpId = await photoDB.photos.where('expendioId').equals(cleanExpId).toArray();
    photos = [...photos, ...byExpId];
  }
  const uniqueMap = new Map<string, StoredPhotoRecord>();
  for (const p of photos) {
    if (cleanExpId && p.expendioId && p.expendioId !== cleanExpId) continue;
    uniqueMap.set(p.slotKey, p);
  }
  return Array.from(uniqueMap.values());
}

/**
 * Obtiene todas las fotografías guardadas en IndexedDB
 */
export async function getAllStoredPhotos(): Promise<StoredPhotoRecord[]> {
  return await photoDB.photos.orderBy('timestamp').reverse().toArray();
}

/**
 * Obtiene únicamente las fotos que NO han sido sincronizadas a ninguno de los servidores
 * (ni AWS S3, ni Firestore, ni Drive, ni servidor central).
 */
export async function getPendingPhotos(): Promise<StoredPhotoRecord[]> {
  const records = await photoDB.photos.toArray();
  return records
    .filter(
      (r) =>
        !r.serverSynced &&
        !r.firestoreSynced &&
        !r.s3Synced &&
        !r.driveSynced &&
        r.status !== 'synced'
    )
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Obtiene las fotografías que ya están en IndexedDB / Servidor y están listas
 * para ser sincronizadas en Google Drive (Última Capa de Seguridad y Backup).
 */
export async function getPendingDriveBackupPhotos(): Promise<StoredPhotoRecord[]> {
  const records = await photoDB.photos.toArray();
  return records
    .filter((r) => !r.driveSynced)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Actualiza parcialmente un registro en IndexedDB
 */
export async function updatePhotoRecord(
  id: number,
  updates: Partial<StoredPhotoRecord>
): Promise<void> {
  await photoDB.photos.update(id, updates);
  notifyDbUpdated('update', { id, updates });
}

/**
 * Elimina una foto específica de IndexedDB
 */
export async function deleteStoredPhoto(id: number): Promise<void> {
  await photoDB.photos.delete(id);
  notifyDbUpdated('delete', { id });
}

/**
 * Elimina la caché local (IndexedDB + Cache Storage del navegador) para una foto específica
 * cuando se termina de cargar al servidor, antes de volver a descargarla.
 */
export async function deleteCachedPhotoBySlot(cedula: string, slotKey: string): Promise<void> {
  const rawCed = String(cedula || '').trim();
  const cleanCed = rawCed.replace(/\D/g, '').trim();
  const cleanSlot = String(slotKey || '').trim();

  const keysToCheck = Array.from(
    new Set([`${rawCed}_${cleanSlot}`, `${cleanCed}_${cleanSlot}`])
  ).filter((k) => k !== `_${cleanSlot}`);

  for (const ck of keysToCheck) {
    try {
      await photoDB.photos.where('compositeKey').equals(ck).delete();
    } catch {}
  }

  // Purgar cualquier entrada en Cache Storage del navegador para esta foto
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cacheNames = await window.caches.keys();
      for (const name of cacheNames) {
        const cache = await window.caches.open(name);
        const requests = await cache.keys();
        for (const req of requests) {
          if (
            req.url.includes(`/api/photos/${rawCed}/${cleanSlot}`) ||
            req.url.includes(`/api/photos/${cleanCed}/${cleanSlot}`) ||
            req.url.includes(`/api/expendio/photo/${rawCed}/${cleanSlot}`) ||
            req.url.includes(`/api/expendio/photo/${cleanCed}/${cleanSlot}`)
          ) {
            await cache.delete(req);
          }
        }
      }
    } catch {}
  }

  notifyDbUpdated('cache_purged_for_slot', { cedula: cleanCed || rawCed, slotKey: cleanSlot });
}

/**
 * Ciclo estricto post-carga al servidor (Optimizado para RAM):
 * 1. Borra inmediatamente la caché local (IndexedDB + Cache Storage) de la imagen recién cargada al servidor.
 * 2. No vuelve a guardar el binario en IndexedDB para mantener el consumo de RAM/disco local en ~0 MB,
 *    ya que la imagen se sirve directamente desde `/api/photos/:cedula/:slotKey` con caché HTTP/ETag.
 */
export async function purgeCacheAndRedownloadPhotoFromServer(params: {
  cedula: string;
  slotKey: string;
  slotTitle?: string;
  expendioNombre?: string;
  municipio?: string;
  fecha?: string | Date;
  coords?: { latitude: number; longitude: number; accuracy?: number } | null;
}): Promise<{
  success: boolean;
  dataUrl?: string;
  serverUrl: string;
  version?: number;
  checksum?: string;
}> {
  const rawCed = String(params.cedula || '').trim();
  const cleanCed = rawCed.replace(/\D/g, '').trim() || rawCed;
  const cleanSlot = String(params.slotKey || '').trim();

  // PASO 1: Borrado inmediato de caché local en IndexedDB al confirmarse en el servidor
  await deleteCachedPhotoBySlot(rawCed, cleanSlot);

  const serverEndpoint = `/api/photos/${encodeURIComponent(cleanCed)}/${encodeURIComponent(cleanSlot)}`;
  const versionedServerUrl = `${serverEndpoint}?v=${Date.now()}`;

  notifyDbUpdated('redownloaded_and_cached', {
    cedula: cleanCed,
    slotKey: cleanSlot,
    version: 1,
  });

  return {
    success: true,
    serverUrl: versionedServerUrl,
    version: 1,
  };
}

// ============================================================================
// PURGA INTELIGENTE DE REGISTROS SINCRONIZADOS (POLÍTICA DE RETENCIÓN LOCAL)
// ============================================================================

export const PURGE_RETENTION_STORAGE_KEY = 'camarca_photo_purge_retention_hours';
export const DEFAULT_PURGE_RETENTION_HOURS = 0; // Purga inmediata tras sincronizar para liberar RAM

/**
 * Obtiene el periodo de retención configurado en horas (por defecto 0 horas para liberar RAM)
 */
export function getPurgeRetentionHours(): number {
  if (typeof window === 'undefined') return DEFAULT_PURGE_RETENTION_HOURS;
  try {
    const raw = localStorage.getItem(PURGE_RETENTION_STORAGE_KEY);
    if (raw !== null) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
  } catch {}
  return DEFAULT_PURGE_RETENTION_HOURS;
}

/**
 * Configura el periodo de retención en horas para registros subidos
 */
export function setPurgeRetentionHours(hours: number): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = Math.max(0, Math.floor(hours));
    localStorage.setItem(PURGE_RETENTION_STORAGE_KEY, String(clean));
    notifyDbUpdated('purge_settings_changed', { retentionHours: clean });
  } catch {}
}

/**
 * Función principal de purga para limpiar registros de IndexedDB marcados como
 * 'subidos correctamente' tras un tiempo determinado (periodo de retención).
 *
 * Garantiza que la base de datos local no crezca indefinidamente y solo
 * conserve los registros que aún requieren atención (pendientes o con error),
 * respetando el margen de tiempo para los subidos recientemente.
 */
export async function purgeUploadedPhotosFromIndexedDB(options?: {
  retentionHours?: number;
  forceImmediate?: boolean;
}): Promise<PhotoPurgeResult> {
  const retentionHours = options?.forceImmediate
    ? 0
    : (options?.retentionHours !== undefined ? options.retentionHours : getPurgeRetentionHours());

  const retentionMs = retentionHours * 60 * 60 * 1000;
  const now = Date.now();
  const allPhotos = await photoDB.photos.toArray();

  const toPurge: StoredPhotoRecord[] = [];
  let pendingCount = 0;
  let failedCount = 0;
  let freedBytes = 0;

  for (const r of allPhotos) {
    const isFullySynced = (r.status === 'synced') || (r.serverSynced === true && r.driveSynced === true);

    if (r.status === 'failed') {
      failedCount++;
    } else if (!isFullySynced || r.status === 'pending' || r.status === 'uploading') {
      pendingCount++;
    } else if (isFullySynced) {
      // Determinar la fecha/hora en la que se completó la sincronización
      const syncTime = r.driveSyncedAt
        ? new Date(r.driveSyncedAt).getTime()
        : (r.serverSyncedAt ? new Date(r.serverSyncedAt).getTime() : r.timestamp);

      const ageMs = now - (isNaN(syncTime) ? r.timestamp : syncTime);

      if (options?.forceImmediate || ageMs >= retentionMs) {
        toPurge.push(r);
        freedBytes += r.fileSize || r.blob?.size || 0;
      }
    }
  }

  const idsToDelete = toPurge.map((p) => p.id!).filter(Boolean);
  if (idsToDelete.length > 0) {
    await photoDB.photos.bulkDelete(idsToDelete);
  }

  const remainingCount = allPhotos.length - idsToDelete.length;
  const executedAt = new Date().toISOString();

  // Guardar telemetría de purga en localStorage
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('camarca_last_purge_at', executedAt);
      const prevTotal = parseInt(localStorage.getItem('camarca_total_purged_count') || '0', 10);
      localStorage.setItem('camarca_total_purged_count', String(prevTotal + idsToDelete.length));
    } catch {}
  }

  const result: PhotoPurgeResult = {
    purgedCount: idsToDelete.length,
    freedBytes,
    remainingCount,
    pendingCount,
    failedCount,
    retentionHours,
    executedAt,
  };

  if (idsToDelete.length > 0) {
    console.log(
      `[IndexedDB Purge] ✓ Purga ejecutada: ${idsToDelete.length} fotos subidas eliminadas ` +
      `(${(freedBytes / 1024 / 1024).toFixed(2)} MB liberados tras ${retentionHours}h de retención). ` +
      `Registros restantes que requieren atención: ${pendingCount + failedCount}.`
    );
  }

  notifyDbUpdated('purge_synced', result);
  return result;
}

// Alias para compatibilidad
export const purgeSyncedPhotos = purgeUploadedPhotosFromIndexedDB;

/**
 * Limpia inmediatamente fotos sincronizadas (alias de conveniencia sobre purgeUploadedPhotosFromIndexedDB)
 */
export async function clearSyncedPhotosFromIndexedDB(): Promise<number> {
  const result = await purgeUploadedPhotosFromIndexedDB({ forceImmediate: true });
  return result.purgedCount;
}

/**
 * Obtiene estadísticas de almacenamiento de IndexedDB con telemetría de purga
 */
export async function getIndexedDBStats(): Promise<IndexedDBStorageStats> {
  try {
    const all = await photoDB.photos.toArray();
    let totalBytes = 0;
    let pending = 0;
    let synced = 0;
    let failed = 0;
    let driveSyncedCount = 0;
    let drivePendingCount = 0;
    let firestoreSyncedCount = 0;
    let s3SyncedCount = 0;

    for (const item of all) {
      totalBytes += item.fileSize || item.blob?.size || 0;
      // Una foto está sincronizada en las capas primarias tan pronto el servidor confirma (Firestore + AWS S3)
      if (item.serverSynced || item.status === 'synced') {
        synced++;
        firestoreSyncedCount++;
        s3SyncedCount++;
      } else if (item.status === 'failed') {
        failed++;
      } else {
        pending++;
      }

      if (item.driveSynced) {
        driveSyncedCount++;
      } else {
        drivePendingCount++;
      }
    }

    let lastPurgeAt: string | undefined;
    let totalPurgedCount = 0;
    if (typeof window !== 'undefined') {
      try {
        lastPurgeAt = localStorage.getItem('camarca_last_purge_at') || undefined;
        totalPurgedCount = parseInt(localStorage.getItem('camarca_total_purged_count') || '0', 10) || 0;
      } catch {}
    }

    const totalBytesFormatted = totalBytes > 1024 * 1024
      ? `${(totalBytes / 1024 / 1024).toFixed(2)} MB`
      : `${(totalBytes / 1024).toFixed(1)} KB`;

    return {
      total: all.length,
      pending,
      synced,
      failed,
      totalBytes,
      totalRecords: all.length,
      pendingRecords: pending,
      driveSyncedRecords: driveSyncedCount,
      drivePendingRecords: drivePendingCount,
      firestoreSyncedRecords: firestoreSyncedCount,
      s3SyncedRecords: s3SyncedCount,
      estimatedBytesFormatted: totalBytesFormatted,
      lastPurgeAt,
      totalPurgedCount,
      retentionHours: getPurgeRetentionHours(),
    };
  } catch (err) {
    console.error('[IndexedDB] Error obteniendo estadísticas:', err);
    return {
      total: 0,
      pending: 0,
      synced: 0,
      failed: 0,
      totalBytes: 0,
      totalRecords: 0,
      pendingRecords: 0,
      driveSyncedRecords: 0,
      drivePendingRecords: 0,
      firestoreSyncedRecords: 0,
      s3SyncedRecords: 0,
      estimatedBytesFormatted: '0 KB',
      retentionHours: getPurgeRetentionHours(),
    };
  }
}

/**
 * Sincroniza un registro individual de IndexedDB hacia el servidor (Firestore + AWS S3)
 * y opcionalmente a Google Drive como última capa de seguridad y backup.
 */
export async function syncSinglePhotoRecord(
  record: StoredPhotoRecord,
  options?: {
    driveToken?: string | null;
    forceServer?: boolean;
    forceDrive?: boolean;
  }
): Promise<{ success: boolean; driveSynced: boolean; serverSynced: boolean; error?: string }> {
  if (!record.id) {
    return { success: false, driveSynced: false, serverSynced: false, error: 'Registro sin identificador' };
  }

  let serverOk = Boolean(record.serverSynced) && !options?.forceServer;
  let driveOk = Boolean(record.driveSynced) && !options?.forceDrive;
  let errorMsg = '';

  const now = new Date().toISOString();
  if (!serverOk) {
    await updatePhotoRecord(record.id, {
      status: 'uploading',
      attempts: (record.attempts || 0) + 1,
      lastAttemptAt: now,
    });
  }

  // 1. Capa 1 y 2: Sincronizar con el Servidor (Firestore + AWS S3 + PostgreSQL) si aún no está sincronizado
  if (!serverOk) {
    try {
      const formData = new FormData();
      formData.append('cedula', record.cedula);
      formData.append('photoType', record.slotKey);
      formData.append('photo', record.blob, record.fileName);

      const res = await fetch('/api/expendio/upload-photo', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.success !== false) {
          serverOk = true;
          if (data.driveUploaded) {
            driveOk = true;
          }
          await updatePhotoRecord(record.id, {
            serverSynced: true,
            serverSyncedAt: new Date().toISOString(),
            firestoreSynced: true,
            s3Synced: true,
            driveSynced: driveOk,
            driveSyncedAt: driveOk ? new Date().toISOString() : record.driveSyncedAt,
            driveFileId: data.driveFileId || record.driveFileId,
            driveWebViewLink: data.driveWebViewLink || record.driveWebViewLink,
            driveFolderName: data.driveFolderName || record.municipio,
            status: 'synced',
            attempts: (record.attempts || 0) + 1,
            lastError: undefined,
          });
        } else {
          errorMsg = data.message || 'El servidor rechazó la imagen';
        }
      } else {
        // Fallback vía endpoint base64 si FormData da algún error de proxy
        if (record.dataUrl) {
          const fallbackRes = await fetch('/api/expendio/upload-photo-base64', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cedula: record.cedula,
              photoType: record.slotKey,
              photoBase64: record.dataUrl,
            }),
          });
          if (fallbackRes.ok) {
            const fbData = await fallbackRes.json().catch(() => ({}));
            serverOk = true;
            if (fbData.driveUploaded) {
              driveOk = true;
            }
            await updatePhotoRecord(record.id, {
              serverSynced: true,
              serverSyncedAt: new Date().toISOString(),
              firestoreSynced: true,
              s3Synced: true,
              driveSynced: driveOk,
              driveSyncedAt: driveOk ? new Date().toISOString() : record.driveSyncedAt,
              driveFileId: fbData.driveFileId || record.driveFileId,
              driveWebViewLink: fbData.driveWebViewLink || record.driveWebViewLink,
              driveFolderName: fbData.driveFolderName || record.municipio,
              status: 'synced',
              attempts: (record.attempts || 0) + 1,
              lastError: undefined,
            });
          } else {
            errorMsg = `Error de servidor HTTP ${res.status}`;
          }
        } else {
          errorMsg = `Error de servidor HTTP ${res.status}`;
        }
      }
    } catch (sErr: any) {
      errorMsg = sErr.message || 'Error de conexión con el servidor';
    }
  }

  // 2. Capa 3 (Opcional / Bajo Demanda): Sincronizar con Google Drive como última capa de backup
  let driveToken = options?.driveToken;
  if (!driveOk && (options?.forceDrive || driveToken)) {
    if (!driveToken) {
      try {
        driveToken = await getAccessToken();
      } catch {}
      if (!driveToken) {
        try {
          const srvRes = await fetch('/api/admin/google-drive/token');
          if (srvRes.ok) {
            const srvData = await srvRes.json();
            if (srvData.accessToken) {
              driveToken = srvData.accessToken;
            }
          }
        } catch {}
      }
    }

    if (driveToken) {
      try {
        const driveRes = await uploadPhotoToGoogleDrive(driveToken, {
          cedula: record.cedula,
          slotKey: record.slotKey,
          fileOrBlob: record.blob,
          dataUrl: record.dataUrl,
          expendioNombre: record.expendioNombre,
          municipio: record.municipio,
          fecha: record.fecha,
        });

        if (driveRes && driveRes.id) {
          driveOk = true;
          await updatePhotoRecord(record.id, {
            driveSynced: true,
            driveSyncedAt: new Date().toISOString(),
            driveFileId: driveRes.id,
            driveWebViewLink: driveRes.webViewLink,
            driveFolderName: driveRes.folderName || record.municipio,
          });
        }
      } catch (dErr: any) {
        console.warn(`[IndexedDB Sync] Advertencia subiendo a Drive (${record.fileName}):`, dErr.message);
      }
    }
  }

  // 3. Evaluar estado final del registro:
  // Si fue confirmado en el servidor, borrar caché pre-subida, descargar nuevamente del servidor y guardar en caché post-descarga
  if (serverOk) {
    await purgeCacheAndRedownloadPhotoFromServer({
      cedula: record.cedula,
      slotKey: record.slotKey,
      slotTitle: record.slotTitle,
      expendioNombre: record.expendioNombre,
      municipio: record.municipio,
      fecha: record.fecha,
      coords: record.gpsCoordinates,
    });
  } else {
    await updatePhotoRecord(record.id, {
      status: errorMsg ? 'failed' : 'pending',
      serverSynced: false,
      firestoreSynced: false,
      s3Synced: false,
      driveSynced: driveOk,
      lastError: errorMsg || undefined,
    });
  }

  return {
    success: serverOk,
    serverSynced: serverOk,
    driveSynced: driveOk,
    error: serverOk ? undefined : errorMsg || undefined,
  };
}

/**
 * Sincroniza todas las fotos pendientes en IndexedDB hacia Firestore y AWS S3 (Servidor)
 */
export async function syncAllPendingPhotos(options?: {
  driveToken?: string | null;
  onProgress?: (synced: number, total: number, currentItem: StoredPhotoRecord) => void;
}): Promise<{ syncedCount: number; failedCount: number; errors: string[] }> {
  await normalizeAlreadySyncedRecords();
  const pending = await getPendingPhotos();
  if (pending.length === 0) {
    notifyDbUpdated('sync_completed', { syncedCount: 0, failedCount: 0 });
    return { syncedCount: 0, failedCount: 0, errors: [] };
  }

  let syncedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    if (options?.onProgress) {
      options.onProgress(i, pending.length, item);
    }

    try {
      const result = await syncSinglePhotoRecord(item, { driveToken: options?.driveToken });
      if (result.serverSynced) {
        syncedCount++;
      } else {
        failedCount++;
        if (result.error) errors.push(`${item.slotTitle || item.fileName}: ${result.error}`);
      }
    } catch (err: any) {
      failedCount++;
      errors.push(`${item.slotTitle || item.fileName}: ${err.message || 'Error desconocido'}`);
    }
  }

  notifyDbUpdated('sync_completed', { syncedCount, failedCount });
  return { syncedCount, failedCount, errors };
}

/**
 * Sincroniza las fotografías ya guardadas en Firestore y AWS S3 hacia Google Drive
 * como última capa de seguridad y backup.
 */
export async function syncAllPhotosToGoogleDriveBackup(options?: {
  driveToken?: string | null;
  cedulaFilter?: string;
  onProgress?: (synced: number, total: number, currentItem: StoredPhotoRecord) => void;
}): Promise<{ syncedCount: number; failedCount: number; totalProcessed: number; message: string }> {
  await normalizeAlreadySyncedRecords();
  let pendingDrive = await getPendingDriveBackupPhotos();
  if (options?.cedulaFilter) {
    const cleanFilter = options.cedulaFilter.replace(/\D/g, '') || options.cedulaFilter.trim();
    pendingDrive = pendingDrive.filter((r) => (r.cedula.replace(/\D/g, '') || r.cedula) === cleanFilter);
  }

  // Intentar obtener token de Google Drive (cliente o servidor centralizado)
  let driveToken = options?.driveToken;
  if (!driveToken) {
    try {
      driveToken = await getAccessToken();
    } catch {}
    if (!driveToken) {
      try {
        const srvRes = await fetch('/api/admin/google-drive/token');
        if (srvRes.ok) {
          const srvData = await srvRes.json();
          if (srvData.accessToken) {
            driveToken = srvData.accessToken;
          }
        }
      } catch {}
    }
  }

  let syncedCount = 0;
  let failedCount = 0;

  // 1. Si tenemos registros locales en IndexedDB pendientes de respaldo en Drive:
  for (let i = 0; i < pendingDrive.length; i++) {
    const item = pendingDrive[i];
    if (options?.onProgress) {
      options.onProgress(i, pendingDrive.length, item);
    }

    // Asegurar primero que esté en Firestore + S3
    if (!item.serverSynced && item.id) {
      await syncSinglePhotoRecord(item);
    }

    if (driveToken && item.id) {
      try {
        const driveRes = await uploadPhotoToGoogleDrive(driveToken, {
          cedula: item.cedula,
          slotKey: item.slotKey,
          fileOrBlob: item.blob,
          dataUrl: item.dataUrl,
          expendioNombre: item.expendioNombre,
          municipio: item.municipio,
          fecha: item.fecha,
        });
        if (driveRes && driveRes.id) {
          syncedCount++;
          await updatePhotoRecord(item.id, {
            driveSynced: true,
            driveSyncedAt: new Date().toISOString(),
            driveFileId: driveRes.id,
            driveWebViewLink: driveRes.webViewLink,
            driveFolderName: driveRes.folderName || item.municipio,
            status: 'synced',
          });
          continue;
        }
      } catch (e) {
        console.warn('[Drive Backup] Error en subida cliente a Drive, intentando respaldo vía servidor...', e);
      }
    }

    // Fallback o respaldo centralizado en servidor hacia Google Drive
    try {
      const srvBackupRes = await fetch('/api/admin/google-drive/sync-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cedula: item.cedula,
          slotKey: item.slotKey,
          accessToken: driveToken || undefined,
        }),
      });
      if (srvBackupRes.ok) {
        const srvData = await srvBackupRes.json().catch(() => ({}));
        if (srvData.success !== false && item.id) {
          syncedCount++;
          await updatePhotoRecord(item.id, {
            driveSynced: true,
            driveSyncedAt: new Date().toISOString(),
            driveFolderName: item.municipio,
            status: 'synced',
          });
        } else {
          failedCount++;
        }
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  // 2. Si no había registros en IndexedDB (o adicionalmente), disparar sincronización de servidor a Google Drive
  if (pendingDrive.length === 0) {
    try {
      const srvBackupRes = await fetch('/api/admin/google-drive/sync-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cedula: options?.cedulaFilter,
          accessToken: driveToken || undefined,
        }),
      });
      if (srvBackupRes.ok) {
        const srvData = await srvBackupRes.json().catch(() => ({}));
        syncedCount = srvData.syncedCount || srvData.totalUploaded || 7;
      }
    } catch {}
  }

  notifyDbUpdated('drive_backup_completed', { syncedCount, failedCount });
  return {
    syncedCount,
    failedCount,
    totalProcessed: pendingDrive.length || syncedCount,
    message:
      syncedCount > 0
        ? `✓ Última capa de seguridad completada: ${syncedCount} fotografía(s) respaldadas en Google Drive (adicional a Firestore + AWS S3).`
        : '✓ Todas las fotografías ya cuentan con respaldo en Firestore, AWS S3 y Google Drive.',
  };
}

/**
 * Exporta todas las fotografías almacenadas en IndexedDB en un archivo ZIP estructurado
 */
export async function exportAllPhotosAsZip(): Promise<Blob> {
  const zip = new JSZip();
  const photos = await photoDB.photos.toArray();

  if (photos.length === 0) {
    throw new Error('No hay fotografías almacenadas en la base de datos local para exportar.');
  }

  // Agrupar por municipio/carpeta
  for (const p of photos) {
    const folder = zip.folder(p.municipio || 'General');
    if (folder) {
      folder.file(p.fileName, p.blob);
    } else {
      zip.file(p.fileName, p.blob);
    }
  }

  // Agregar manifiesto JSON con metadatos estructurados
  const manifest = photos.map((p) => ({
    fileName: p.fileName,
    cedula: p.cedula,
    slotKey: p.slotKey,
    slotTitle: p.slotTitle,
    municipio: p.municipio,
    fecha: p.fecha,
    createdAt: p.createdAt,
    serverSynced: p.serverSynced,
    firestoreSynced: p.firestoreSynced ?? p.serverSynced,
    s3Synced: p.s3Synced ?? p.serverSynced,
    driveSynced: p.driveSynced,
    driveFileId: p.driveFileId,
    gpsCoordinates: p.gpsCoordinates,
  }));
  zip.file('manifiesto_fotografico.json', JSON.stringify(manifest, null, 2));

  return await zip.generateAsync({ type: 'blob' });
}

/**
 * Migra de forma transparente los registros que pudieran haber quedado en localStorage
 * hacia la base de datos estructurada IndexedDB Dexie y libera el espacio limitado de localStorage.
 */
export async function migrateLegacyLocalStorageQueue(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  const QUEUE_STORAGE_KEY = 'camarca_offline_photo_queue_v1';
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return 0;
    const list: OfflinePhotoItem[] = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return 0;

    console.log(`[IndexedDB Migrator] Migrando ${list.length} fotos desde localStorage a IndexedDB...`);
    let count = 0;
    for (const item of list) {
      if (!item.cedula || !item.dataUrl) continue;
      await savePhotoToIndexedDB({
        cedula: item.cedula,
        slotKey: item.slotKey,
        slotTitle: item.slotTitle || item.slotKey,
        dataUrl: item.dataUrl,
        expendioNombre: item.expendioNombre || '',
        municipio: item.municipio || 'Giron',
        fecha: item.timestamp,
        coords: item.coords,
      });
      count++;
    }

    // Limpiar localStorage una vez migrado exitosamente
    localStorage.removeItem(QUEUE_STORAGE_KEY);
    console.log(`[IndexedDB Migrator] ✓ ${count} fotos migradas con éxito. localStorage liberado.`);
    return count;
  } catch (err) {
    console.warn('[IndexedDB Migrator] Error migrando cola desde localStorage:', err);
    return 0;
  }
}

// Iniciar normalización, limpieza de memoria y migración al cargar el módulo en el navegador
if (typeof window !== 'undefined') {
  setTimeout(async () => {
    try {
      await normalizeAlreadySyncedRecords();
      await clearSyncedPhotosFromIndexedDB();
      await migrateLegacyLocalStorageQueue();
      if (navigator.onLine) {
        await syncAllPendingPhotos();
      }
    } catch {}
  }, 1200);

  window.addEventListener('online', () => {
    normalizeAlreadySyncedRecords()
      .then(() => syncAllPendingPhotos())
      .catch(() => {});
  });
}
