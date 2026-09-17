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
      photos: '++id, uuid, cedula, slotKey, compositeKey, municipio, fecha, timestamp, status, serverSynced, driveSynced',
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
  cedula: string;
  slotKey: string;
  slotTitle: string;
  fileOrBlob?: Blob | File | null;
  dataUrl?: string;
  expendioNombre?: string;
  municipio?: string;
  fecha?: string | Date;
  coords?: { latitude: number; longitude: number; accuracy?: number } | null;
}): Promise<StoredPhotoRecord> {
  const {
    cedula,
    slotKey,
    slotTitle,
    fileOrBlob,
    dataUrl: initialDataUrl,
    expendioNombre = '',
    municipio = 'Giron',
    fecha,
    coords = null,
  } = params;

  const cleanCed = (cedula || '').trim();
  const cleanSlot = (slotKey || '').trim();
  const compositeKey = `${cleanCed}_${cleanSlot}`;
  const muniFormatted = formatMunicipioNombre(municipio);

  let blob: Blob;
  let dataUrl = initialDataUrl || '';

  if (fileOrBlob) {
    blob = fileOrBlob;
    if (!dataUrl) {
      try {
        dataUrl = await blobToDataUrl(fileOrBlob);
      } catch {
        dataUrl = '';
      }
    }
  } else if (initialDataUrl) {
    blob = dataUrlToBlob(initialDataUrl);
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
  const uuid = `photo_${cleanCed}_${cleanSlot}_${now}_${Math.random().toString(36).substring(2, 7)}`;

  // Verificar si ya existe un registro previo para este expendio y tipo de foto
  const existing = await photoDB.photos.where('compositeKey').equals(compositeKey).first();

  const record: StoredPhotoRecord = {
    ...(existing ? { id: existing.id } : {}),
    uuid,
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
    status: 'pending',
    serverSynced: false,
    driveSynced: false,
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

  // Señalizar al Service Worker para gestionar la sincronización en segundo plano sin bloquear el hilo principal
  try {
    triggerDriveSyncViaWorker().catch(() => {});
    requestBackgroundSyncRegistration().catch(() => {});
  } catch {}

  return record;
}

/**
 * Obtiene una fotografía estructurada almacenada por cédula y slotKey
 */
export async function getStoredPhoto(cedula: string, slotKey: string): Promise<StoredPhotoRecord | undefined> {
  const compositeKey = `${(cedula || '').trim()}_${(slotKey || '').trim()}`;
  return await photoDB.photos.where('compositeKey').equals(compositeKey).first();
}

/**
 * Obtiene todas las fotografías almacenadas para una cédula
 */
export async function getStoredPhotosByCedula(cedula: string): Promise<StoredPhotoRecord[]> {
  const cleanCed = (cedula || '').trim();
  return await photoDB.photos.where('cedula').equals(cleanCed).toArray();
}

/**
 * Obtiene todas las fotografías guardadas en IndexedDB
 */
export async function getAllStoredPhotos(): Promise<StoredPhotoRecord[]> {
  return await photoDB.photos.orderBy('timestamp').reverse().toArray();
}

/**
 * Obtiene todas las fotos pendientes de sincronizar hacia Drive o el Servidor
 */
export async function getPendingPhotos(): Promise<StoredPhotoRecord[]> {
  const records = await photoDB.photos.toArray();
  return records
    .filter((r) => !r.driveSynced || !r.serverSynced || r.status === 'pending' || r.status === 'failed')
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

// ============================================================================
// PURGA INTELIGENTE DE REGISTROS SINCRONIZADOS (POLÍTICA DE RETENCIÓN LOCAL)
// ============================================================================

export const PURGE_RETENTION_STORAGE_KEY = 'camarca_photo_purge_retention_hours';
export const DEFAULT_PURGE_RETENTION_HOURS = 24; // 24 horas por defecto

/**
 * Obtiene el periodo de retención configurado en horas (por defecto 24 horas)
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

    for (const item of all) {
      totalBytes += item.fileSize || item.blob?.size || 0;
      if (item.driveSynced && item.serverSynced) {
        synced++;
      } else if (item.status === 'failed') {
        failed++;
      } else {
        pending++;
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
      driveSyncedRecords: synced,
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
      estimatedBytesFormatted: '0 KB',
      retentionHours: getPurgeRetentionHours(),
    };
  }
}

/**
 * Sincroniza un registro individual de IndexedDB hacia el servidor y Google Drive
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

  const now = new Date().toISOString();
  await updatePhotoRecord(record.id, {
    status: 'uploading',
    attempts: (record.attempts || 0) + 1,
    lastAttemptAt: now,
  });

  let serverOk = record.serverSynced && !options?.forceServer;
  let driveOk = record.driveSynced && !options?.forceDrive;
  let errorMsg = '';

  // 1. Sincronizar con el Servidor Local si aún no está sincronizado
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
          // Si el servidor subió directamente la foto a Google Drive usando las credenciales centralizadas
          if (data.driveUploaded) {
            driveOk = true;
            await updatePhotoRecord(record.id, {
              serverSynced: true,
              serverSyncedAt: new Date().toISOString(),
              driveSynced: true,
              driveSyncedAt: new Date().toISOString(),
              driveFileId: data.driveFileId,
              driveWebViewLink: data.driveWebViewLink,
              driveFolderName: data.driveFolderName || record.municipio,
              status: 'synced',
              attempts: (record.attempts || 0) + 1,
              lastError: undefined,
            });
          } else {
            await updatePhotoRecord(record.id, {
              serverSynced: true,
              serverSyncedAt: new Date().toISOString(),
            });
          }
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
              await updatePhotoRecord(record.id, {
                serverSynced: true,
                serverSyncedAt: new Date().toISOString(),
                driveSynced: true,
                driveSyncedAt: new Date().toISOString(),
                driveFileId: fbData.driveFileId,
                driveWebViewLink: fbData.driveWebViewLink,
                driveFolderName: fbData.driveFolderName || record.municipio,
                status: 'synced',
                attempts: (record.attempts || 0) + 1,
                lastError: undefined,
              });
            } else {
              await updatePhotoRecord(record.id, {
                serverSynced: true,
                serverSyncedAt: new Date().toISOString(),
              });
            }
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

  // 2. Sincronizar con Google Drive si no fue subida directamente por el servidor
  let driveToken = options?.driveToken;
  if (!driveOk && !driveToken) {
    try {
      driveToken = await getAccessToken();
    } catch {}
    // Si el usuario no tiene sesión de Google, usar token centralizado del servidor
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

  if (!driveOk && driveToken) {
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
      if (!errorMsg) {
        errorMsg = `Drive: ${dErr.message || 'Error subiendo archivo'}`;
      }
    }
  }

  // 3. Evaluar estado final del registro
  const allDone = serverOk && driveOk;
  const newStatus = allDone ? 'synced' : errorMsg ? 'failed' : 'pending';

  await updatePhotoRecord(record.id, {
    status: newStatus,
    serverSynced: serverOk,
    driveSynced: driveOk,
    lastError: allDone ? undefined : errorMsg || undefined,
  });

  return {
    success: allDone,
    serverSynced: serverOk,
    driveSynced: driveOk,
    error: errorMsg || undefined,
  };
}

/**
 * Sincroniza todas las fotos pendientes en IndexedDB con el servidor y Google Drive
 */
export async function syncAllPendingPhotos(options?: {
  driveToken?: string | null;
  onProgress?: (synced: number, total: number, currentItem: StoredPhotoRecord) => void;
}): Promise<{ syncedCount: number; failedCount: number; errors: string[] }> {
  const pending = await getPendingPhotos();
  if (pending.length === 0) {
    return { syncedCount: 0, failedCount: 0, errors: [] };
  }

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
  const errors: string[] = [];

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    if (options?.onProgress) {
      options.onProgress(i, pending.length, item);
    }

    try {
      const result = await syncSinglePhotoRecord(item, { driveToken });
      if (result.success || (result.serverSynced && (!driveToken || result.driveSynced))) {
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

// Iniciar migración de forma pasiva al cargar el módulo en el navegador
// y programar purga automática periódica de registros subidos
if (typeof window !== 'undefined') {
  setTimeout(() => {
    migrateLegacyLocalStorageQueue().catch(() => {});
  }, 1000);

  // Ejecución pasiva de purga inicial tras 3 segundos de carga
  setTimeout(() => {
    purgeUploadedPhotosFromIndexedDB().catch((e) => {
      console.warn('[AutoPurge] Error en purga pasiva inicial:', e);
    });
  }, 3500);

  // Verificación periódica de purga cada 30 minutos
  setInterval(() => {
    purgeUploadedPhotosFromIndexedDB().catch(() => {});
  }, 30 * 60 * 1000);
}
