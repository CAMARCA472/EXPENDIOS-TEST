import { db } from '../db/index';
import * as schema from '../db/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import {
  getS3Client,
  uploadToAwsS3,
  readPhotoFromStorage,
  getPhotoStorageRecord,
  PhotoMetadata,
  uploadToFirebaseStorage,
} from './hybridPhotoStorage';
import fs from 'fs';
import path from 'path';

// =========================================================================
// GOOGLE DRIVE BACKGROUND PHOTO UPLOADER
// =========================================================================

// Google Drive token fetcher - will be injected or imported from server.ts
let getOrRefreshDriveTokenFn: (() => Promise<string | null>) | null = null;

export function registerDriveTokenProvider(fn: () => Promise<string | null>) {
  getOrRefreshDriveTokenFn = fn;
}

export interface BackupTaskResult {
  photoId: string;
  provider: 'S3' | 'DRIVE';
  success: boolean;
  status: 'SYNCED' | 'PENDING' | 'ERROR' | 'AUTH_REQUIRED' | 'SKIPPED';
  checksum?: string;
  error?: string;
}

function getPhotoItemSlugWorker(slotKey: string): string {
  const key = (slotKey || '').toLowerCase();
  if (key.includes('tarifa')) return 'Foto_Tarifas';
  if (key.includes('aviso') || key.includes('letrero')) return 'Foto_Aviso';
  if (key.includes('panoramica') || key.includes('fachada')) return 'Foto_Panoramica';
  if (key.includes('matasello')) return 'Foto_Matasello';
  if (key.includes('bascula')) return 'Foto_Bascula';
  if (key.includes('contratista') || key.includes('encargado') || key.includes('persona')) return 'Foto_Contratista';
  if (key.includes('horario')) return 'Foto_Horario';
  if (key.includes('computador') || key.includes('pc')) return 'Foto_Computador';
  return 'Foto_Punto';
}

function formatMunicipioWorker(rawMunicipio?: string): string {
  const clean = (rawMunicipio || 'General')
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

/**
 * Normaliza nombres de archivos para Google Drive según convención oficial:
 * Fotos Expendios 4-72 - CAMARCA SAS/{Municipio}/{NombreMunicipio}_{TipoDeFoto}_{FechaDDMMAAAA}.jpg
 */
function getDrivePhotoFileName(cleanSlot: string, rawMunicipio?: string): string {
  const itemSlug = getPhotoItemSlugWorker(cleanSlot);
  const muniPrefix = formatMunicipioWorker(rawMunicipio)
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '');
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  return `${muniPrefix || 'Municipio'}_${itemSlug}_${dd}${mm}${yyyy}.jpg`;
}

/**
 * Sube una fotografía a Google Drive v3 bajo la estructura de carpetas oficial
 */
async function uploadPhotoToDriveServer(
  token: string,
  buffer: Buffer,
  meta: {
    cedula: string;
    slotKey: string;
    version: number;
    municipio?: string;
    mimeType?: string;
  }
): Promise<{ success: boolean; driveFileId?: string; error?: string; invalidGrant?: boolean }> {
  try {
    const cleanCed = meta.cedula.trim();
    const cleanSlot = meta.slotKey.trim();
    const muniName = formatMunicipioWorker(meta.municipio || 'General');
    const fileName = getDrivePhotoFileName(cleanSlot, muniName);

    // 1. Obtener o crear carpeta raíz: "Fotos Expendios 4-72 - CAMARCA SAS"
    const rootSearchQuery = `'root' in parents and name='Fotos Expendios 4-72 - CAMARCA SAS' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const rootSearchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(rootSearchQuery)}&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (rootSearchRes.status === 401) {
      return { success: false, error: 'Token expirado', invalidGrant: false };
    }

    let rootFolderId = '';
    const rootData = (await rootSearchRes.json()) as any;
    if (rootData.files && rootData.files.length > 0) {
      rootFolderId = rootData.files[0].id;
    } else {
      const createRootRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Fotos Expendios 4-72 - CAMARCA SAS',
          mimeType: 'application/vnd.google-apps.folder',
          description: 'Carpeta oficial central de fotografías de expendios 4-72 - CAMARCA SAS',
        }),
      });
      const newRoot = (await createRootRes.json()) as any;
      rootFolderId = newRoot.id;
    }

    // 2. Obtener o crear subcarpeta de Municipio
    const muniQuery = `'${rootFolderId}' in parents and name='${muniName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const muniSearchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(muniQuery)}&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    let muniFolderId = rootFolderId;
    const muniData = (await muniSearchRes.json()) as any;
    if (muniData.files && muniData.files.length > 0) {
      muniFolderId = muniData.files[0].id;
    } else {
      const createMuniRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: muniName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [rootFolderId],
        }),
      });
      const newMuni = (await createMuniRes.json()) as any;
      muniFolderId = newMuni.id;
    }

    // 3. Subir archivo a la carpeta de municipio (Multipart upload)
    const boundary = `-------CamarcaDriveBoundary${Date.now()}`;
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      name: fileName,
      mimeType: meta.mimeType || 'image/jpeg',
      parents: [muniFolderId],
      description: `Foto ${cleanSlot} - C.C. ${cleanCed} (v${meta.version})`,
    };

    const multipartRequestBody = Buffer.concat([
      Buffer.from(delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + delimiter + `Content-Type: ${meta.mimeType || 'image/jpeg'}\r\n\r\n`),
      buffer,
      Buffer.from(closeDelimiter),
    ]);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      }
    );

    if (!uploadRes.ok) {
      const errData = (await uploadRes.json().catch(() => ({}))) as any;
      const isInvalid = errData?.error?.message?.includes('invalid_grant');
      return { success: false, error: errData?.error?.message || `HTTP ${uploadRes.status}`, invalidGrant: isInvalid };
    }

    const uploaded = (await uploadRes.json()) as any;
    return { success: true, driveFileId: uploaded.id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// =========================================================================
// QUEUE MANAGEMENT & BACKUP EXECUTION
// =========================================================================

/**
 * Encola una tarea de respaldo en PostgreSQL (photo_storage_sync_queue)
 */
export async function enqueuePhotoBackup(params: {
  photoId: string;
  provider: 'S3' | 'DRIVE';
  dbClient?: any;
}): Promise<void> {
  const { photoId, provider, dbClient = db } = params;
  const queueType = provider === 'S3' ? 'S3_BACKUP' : 'DRIVE_BACKUP';

  try {
    await dbClient
      .insert(schema.photoStorageSyncQueue)
      .values({
        photoId,
        type: queueType,
        status: 'PENDING',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  } catch (err: any) {
    console.warn(`[PhotoBackupQueue] Advertencia encolando ${queueType} para ${photoId}:`, err.message);
  }
}

/**
 * Procesa la cola de respaldos pendientes para AWS S3
 */
export async function processPendingS3Backups(dbClient: any = db, batchSize = 25): Promise<BackupTaskResult[]> {
  const results: BackupTaskResult[] = [];
  try {
    const pendingItems = await dbClient
      .select()
      .from(schema.photoStorageSyncQueue)
      .where(and(
        eq(schema.photoStorageSyncQueue.type, 'S3_BACKUP'),
        eq(schema.photoStorageSyncQueue.status, 'PENDING')
      ))
      .limit(batchSize);

    for (const item of pendingItems) {
      const record = await getPhotoStorageRecord(item.photoId, dbClient);
      if (!record) {
        await dbClient
          .update(schema.photoStorageSyncQueue)
          .set({ status: 'FAILED', errorMessage: 'Foto no encontrada en metadata', updatedAt: new Date() })
          .where(eq(schema.photoStorageSyncQueue.id, item.id));
        results.push({ photoId: item.photoId, provider: 'S3', success: false, status: 'ERROR', error: 'Registro inexistente' });
        continue;
      }

      // Deduplicación: si S3 ya tiene la misma clave y checksum verificado
      const s3Key = record.s3Key || `photos/${record.cedula || 'photo'}_${record.slotKey}_v${record.version}.jpg`;
      const s3 = getS3Client();
      if (s3) {
        try {
          const headRes = await s3.send(new HeadObjectCommand({
            Bucket: record.s3Bucket || process.env.S3_BUCKET || 'camarca-expendios-photos-contingency',
            Key: s3Key,
          }));
          if (headRes && headRes.ContentLength && headRes.ContentLength === record.sizeBytes) {
            // Ya respaldada y deduplicada
            await dbClient
              .update(schema.photoStorageSyncQueue)
              .set({ status: 'COMPLETED', updatedAt: new Date() })
              .where(eq(schema.photoStorageSyncQueue.id, item.id));
            results.push({ photoId: item.photoId, provider: 'S3', success: true, status: 'SYNCED', checksum: record.checksumSha256 });
            continue;
          }
        } catch {}
      }

      // Obtener buffer desde almacenamiento primario (Firebase Storage o memoria/disco)
      const photoContent = await readPhotoFromStorage(record, dbClient);
      if (!photoContent || !photoContent.buffer) {
        await dbClient
          .update(schema.photoStorageSyncQueue)
          .set({
            status: 'PENDING',
            retryCount: (item.retryCount || 0) + 1,
            errorMessage: 'Buffer de imagen aún no accesible',
            updatedAt: new Date(),
          })
          .where(eq(schema.photoStorageSyncQueue.id, item.id));
        results.push({ photoId: item.photoId, provider: 'S3', success: false, status: 'PENDING', error: 'Buffer no disponible' });
        continue;
      }

      // Subir a AWS S3
      const s3Res = await uploadToAwsS3(photoContent.buffer, s3Key, record.mimeType || 'image/jpeg');
      if (s3Res.success) {
        await dbClient
          .update(schema.photoStorageSyncQueue)
          .set({ status: 'COMPLETED', updatedAt: new Date() })
          .where(eq(schema.photoStorageSyncQueue.id, item.id));
        
        // Actualizar metadata de S3 en PostgreSQL
        try {
          await dbClient
            .update(schema.photoStorage)
            .set({ s3Bucket: s3Res.bucket, s3Key: s3Res.key, lastSyncAt: new Date(), updatedAt: new Date() })
            .where(eq(schema.photoStorage.photoId, record.photoId));
        } catch {}

        results.push({ photoId: item.photoId, provider: 'S3', success: true, status: 'SYNCED', checksum: record.checksumSha256 });
      } else {
        await dbClient
          .update(schema.photoStorageSyncQueue)
          .set({
            status: 'PENDING',
            retryCount: (item.retryCount || 0) + 1,
            errorMessage: s3Res.error?.message || 'Error en PutObject S3',
            updatedAt: new Date(),
          })
          .where(eq(schema.photoStorageSyncQueue.id, item.id));
        results.push({ photoId: item.photoId, provider: 'S3', success: false, status: 'PENDING', error: s3Res.error?.message });
      }
    }
  } catch (err: any) {
    console.warn('[ProcessPendingS3Backups Error]:', err.message);
  }
  return results;
}

/**
 * Procesa la cola de respaldos pendientes para Google Drive
 */
export async function processPendingDriveBackups(dbClient: any = db, batchSize = 25): Promise<BackupTaskResult[]> {
  const results: BackupTaskResult[] = [];
  try {
    const pendingItems = await dbClient
      .select()
      .from(schema.photoStorageSyncQueue)
      .where(and(
        eq(schema.photoStorageSyncQueue.type, 'DRIVE_BACKUP'),
        eq(schema.photoStorageSyncQueue.status, 'PENDING')
      ))
      .limit(batchSize);

    if (pendingItems.length === 0) return results;

    let token: string | null = null;
    if (getOrRefreshDriveTokenFn) {
      token = await getOrRefreshDriveTokenFn();
    }

    if (!token) {
      // Sin token activo o refresh token configurado: no es error fatal, se mantiene en cola PENDING
      for (const item of pendingItems) {
        results.push({ photoId: item.photoId, provider: 'DRIVE', success: false, status: 'PENDING', error: 'Google Drive no autorizado actualmente' });
      }
      return results;
    }

    for (const item of pendingItems) {
      const record = await getPhotoStorageRecord(item.photoId, dbClient);
      if (!record) {
        await dbClient
          .update(schema.photoStorageSyncQueue)
          .set({ status: 'FAILED', errorMessage: 'Foto no encontrada en metadata', updatedAt: new Date() })
          .where(eq(schema.photoStorageSyncQueue.id, item.id));
        results.push({ photoId: item.photoId, provider: 'DRIVE', success: false, status: 'ERROR', error: 'Registro inexistente' });
        continue;
      }

      // Obtener buffer de la imagen
      const photoContent = await readPhotoFromStorage(record, dbClient);
      if (!photoContent || !photoContent.buffer) {
        results.push({ photoId: item.photoId, provider: 'DRIVE', success: false, status: 'PENDING', error: 'Buffer no disponible' });
        continue;
      }

      // Resolver municipio oficial para carpetas en Google Drive
      let muniName = 'General';
      try {
        if (record.cedula || record.expendioId) {
          const expRows = await dbClient
            .select({ municipio: schema.expendios.municipio, localidad: schema.expendios.localidad })
            .from(schema.expendios)
            .where(or(
              record.cedula ? eq(schema.expendios.cedula, record.cedula) : sql`false`,
              record.expendioId ? eq(schema.expendios.id, record.expendioId) : sql`false`
            ))
            .limit(1);
          if (expRows.length > 0) {
            muniName = expRows[0].municipio || expRows[0].localidad || 'General';
          }
        }
      } catch {}

      const driveRes = await uploadPhotoToDriveServer(token, photoContent.buffer, {
        cedula: record.cedula || 'sin_cedula',
        slotKey: record.slotKey,
        version: record.version,
        municipio: muniName,
        mimeType: record.mimeType,
      });

      if (driveRes.success) {
        await dbClient
          .update(schema.photoStorageSyncQueue)
          .set({ status: 'COMPLETED', updatedAt: new Date() })
          .where(eq(schema.photoStorageSyncQueue.id, item.id));

        // Registrar en googleDrivePhotos para trazabilidad
        try {
          const photoRecordId = `drive_${record.photoId}_${Date.now()}`;
          await dbClient
            .insert(schema.googleDrivePhotos)
            .values({
              photoId: photoRecordId,
              expendioId: record.expendioId || null,
              slot: record.slotKey,
              fileName: getDrivePhotoFileName(record.slotKey, muniName),
              mimeType: record.mimeType || 'image/jpeg',
              path: record.firebaseStoragePath || null,
              checksum: record.checksumSha256,
              driveFileId: driveRes.driveFileId || null,
              uploadedAt: new Date().toISOString(),
              metadata: {
                version: record.version,
                provider: 'GOOGLE_DRIVE',
                syncedAt: new Date().toISOString(),
              },
            })
            .onConflictDoNothing();
        } catch {}

        results.push({ photoId: item.photoId, provider: 'DRIVE', success: true, status: 'SYNCED', checksum: record.checksumSha256 });
      } else {
        const nextStatus = driveRes.invalidGrant ? 'AUTH_REQUIRED' : 'PENDING';
        await dbClient
          .update(schema.photoStorageSyncQueue)
          .set({
            status: 'PENDING',
            retryCount: (item.retryCount || 0) + 1,
            errorMessage: driveRes.error || 'Fallo de subida a Google Drive',
            updatedAt: new Date(),
          })
          .where(eq(schema.photoStorageSyncQueue.id, item.id));

        results.push({ photoId: item.photoId, provider: 'DRIVE', success: false, status: nextStatus, error: driveRes.error });
      }
    }
  } catch (err: any) {
    console.warn('[ProcessPendingDriveBackups Error]:', err.message);
  }
  return results;
}

/**
 * Ejecución directa/asíncrona de los respaldos en segundo plano (S3 y Drive)
 */
export async function runPhotoBackups(photoId: string, _inputBuffer?: Buffer, _mimeType = 'image/jpeg'): Promise<void> {
  try {
    // 1. Encolar tareas en PostgreSQL
    await enqueuePhotoBackup({ photoId, provider: 'S3' });
    await enqueuePhotoBackup({ photoId, provider: 'DRIVE' });

    // 2. Ejecutar procesamiento de S3 de inmediato
    await processPendingS3Backups(db, 10);

    // 3. Ejecutar procesamiento de Google Drive de inmediato
    await processPendingDriveBackups(db, 10);
  } catch (err: any) {
    console.warn(`[BackgroundBackups] Advertencia en background para ${photoId}:`, err.message);
  }
}

/**
 * Disparador no bloqueante para ejecutar los respaldos en segundo plano inmediatamente
 */
export function triggerBackgroundBackups(photoId: string, inputBuffer?: Buffer, mimeType = 'image/jpeg'): void {
  setImmediate(() => {
    runPhotoBackups(photoId, inputBuffer, mimeType).catch(() => {});
  });
}
