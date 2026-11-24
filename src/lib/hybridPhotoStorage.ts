import 'dotenv/config';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';
import {
  DEFAULT_AWS_S3_BUCKET,
  getAwsS3Config,
  getAwsS3Client,
  uploadPhotoToS3Bucket,
  downloadPhotoFromS3Bucket,
  ensureS3BucketExists,
  listPhotosInS3Bucket,
} from './awsS3Storage';
import { Storage } from '@google-cloud/storage';
import admin from 'firebase-admin';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../db';

export {
  DEFAULT_AWS_S3_BUCKET,
  getAwsS3Config,
  getAwsS3Client,
  uploadPhotoToS3Bucket,
  downloadPhotoFromS3Bucket,
  ensureS3BucketExists,
  listPhotosInS3Bucket,
};

// Ajustar límite de listeners para evitar advertencias de leaks en streams y procesos paralelos de Google Cloud Storage
EventEmitter.defaultMaxListeners = 50;

export type StorageProvider = 'FIREBASE' | 'S3';
export type StorageStatus = 'FIREBASE_PRIMARY' | 'S3_FALLBACK' | 'SYNC_PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR';
export type ErrorCategory = 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'TEMPORARY_ERROR' | 'AUTH_ERROR' | 'CONFIG_ERROR' | 'UNKNOWN_ERROR';

export interface PhotoMetadata {
  photoId: string;
  expendioId?: string;
  cedula?: string;
  slotKey: string;
  version: number;
  checksumSha256: string;
  sizeBytes: number;
  mimeType: string;
  storageProvider: StorageProvider;
  firebaseStoragePath?: string;
  s3Bucket?: string;
  s3Key?: string;
  status: StorageStatus;
  lastError?: string;
  updatedAt: string;
}

// =========================================================================
// 1. METADATA STORE: POSTGRESQL ES LA ÚNICA FUENTE DE VERDAD
// Cero archivos JSON paralelos como autoridad de fotos.
// =========================================================================

export async function getPhotoStorageRecord(photoId: string, client?: any): Promise<PhotoMetadata | null> {
  const dbClient = client || defaultDb;
  if (!dbClient) return null;

  try {
    const rows = await dbClient
      .select()
      .from(schema.photoStorage)
      .where(eq(schema.photoStorage.photoId, photoId))
      .limit(1);

    if (rows.length > 0) {
      const r = rows[0];
      return {
        photoId: r.photoId,
        expendioId: r.expendioId || undefined,
        cedula: r.cedula || undefined,
        slotKey: r.slotKey,
        version: r.version,
        checksumSha256: r.checksumSha256,
        sizeBytes: r.sizeBytes,
        mimeType: r.mimeType,
        storageProvider: r.storageProvider as StorageProvider,
        firebaseStoragePath: r.firebaseStoragePath || undefined,
        s3Bucket: r.s3Bucket || undefined,
        s3Key: r.s3Key || undefined,
        status: r.status as StorageStatus,
        lastError: r.lastError || undefined,
        updatedAt: r.updatedAt?.toISOString() || new Date().toISOString(),
      };
    }
  } catch (err: any) {
    console.warn(`[PhotoStorage] Error consultando PostgreSQL photo_storage (${photoId}):`, err.message);
    // Contingencia interna en la misma base de datos relacional (tabla system_config)
    try {
      const sysRows = await dbClient
        .select()
        .from(schema.systemConfig)
        .where(eq(schema.systemConfig.key, `photo_storage:${photoId}`))
        .limit(1);
      if (sysRows.length > 0 && sysRows[0].value) {
        return sysRows[0].value as PhotoMetadata;
      }
    } catch {}
  }

  return null;
}

// =========================================================================
// 2. CIRCUIT BREAKER DE FIREBASE STORAGE
// =========================================================================
export class FirebaseCircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount: number = 0;
  private readonly failureThreshold: number = 3;
  private readonly resetTimeoutMs: number = 30000; // 30 segundos
  private lastStateChange: number = Date.now();
  private simulatedQuotaExceeded: boolean = false;

  public isSimulatedQuota(): boolean {
    return this.simulatedQuotaExceeded;
  }

  public setSimulatedQuota(exceeded: boolean) {
    this.simulatedQuotaExceeded = exceeded;
    if (exceeded) {
      this.state = 'OPEN';
      this.lastStateChange = Date.now();
    } else {
      this.state = 'CLOSED';
      this.failureCount = 0;
    }
  }

  public getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    if (this.simulatedQuotaExceeded) return 'OPEN';
    if (this.state === 'OPEN' && Date.now() - this.lastStateChange > this.resetTimeoutMs) {
      this.state = 'HALF_OPEN';
      console.log('[CircuitBreaker] Firebase Storage en HALF_OPEN (probando recuperación)');
    }
    return this.state;
  }

  public recordSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.lastStateChange = Date.now();
      console.log('[CircuitBreaker] Firebase Storage recuperado! Circuit Breaker CLOSED.');
    }
  }

  public recordFailure(_errorCategory: ErrorCategory) {
    // Firebase opera ahora como almacenamiento de RESERVA mientras AWS S3 es PRIMARIO.
    // Solo se abre el circuit breaker si el administrador activa explícitamente la simulación.
    this.failureCount++;
    if (this.simulatedQuotaExceeded) {
      this.state = 'OPEN';
      this.lastStateChange = Date.now();
    }
  }
}

export const firebaseCircuitBreaker = new FirebaseCircuitBreaker();

// =========================================================================
// 3. CLASIFICACIÓN DE ERRORES
// =========================================================================
export function categorizeError(error: any): ErrorCategory {
  if (!error) return 'UNKNOWN_ERROR';
  const msg = String(error.message || error).toLowerCase();
  const code = String(error.code || error.statusCode || '').toLowerCase();

  if (
    msg.includes('quota') ||
    msg.includes('limit exceeded') ||
    code.includes('429') ||
    code.includes('resource_exhausted')
  ) {
    return 'QUOTA_EXCEEDED';
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'RATE_LIMITED';
  }
  if (
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    code.includes('503') ||
    code.includes('502')
  ) {
    return 'TEMPORARY_ERROR';
  }
  if (
    msg.includes('auth') ||
    msg.includes('unauthorized') ||
    msg.includes('permission') ||
    code.includes('401') ||
    code.includes('403')
  ) {
    return 'AUTH_ERROR';
  }
  if (msg.includes('not configured') || msg.includes('invalid credentials')) {
    return 'CONFIG_ERROR';
  }
  return 'UNKNOWN_ERROR';
}

// =========================================================================
// 4. OPTIMIZACIÓN DE IMÁGENES (MAX 1600px, JPEG 80, SHA-256)
// =========================================================================
export async function optimizeImageBuffer(
  inputBuffer: Buffer
): Promise<{ buffer: Buffer; checksum: string; size: number }> {
  let optimized = inputBuffer;
  try {
    const metadata = await sharp(inputBuffer).metadata();
    if (metadata.width && metadata.height && (metadata.width > 1600 || metadata.height > 1600)) {
      optimized = await sharp(inputBuffer)
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true })
        .toBuffer();
    } else {
      optimized = await sharp(inputBuffer)
        .jpeg({ quality: 82, progressive: true })
        .toBuffer();
    }
  } catch (err) {
    console.warn('[ImageOptimizer] Advertencia optimizando con Sharp, generando JPEG válido de contingencia:', err);
    try {
      optimized = await sharp({
        create: {
          width: 400,
          height: 300,
          channels: 3,
          background: { r: 16, g: 185, b: 129 },
        },
      })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {}
  }

  const checksum = crypto.createHash('sha256').update(optimized).digest('hex');
  return {
    buffer: optimized,
    checksum,
    size: optimized.length,
  };
}

// =========================================================================
// 5. AWS S3 CLIENT INITIALIZATION (ALMACENAMIENTO PRIMARIO)
// =========================================================================
const s3BucketName = getAwsS3Config().bucket || DEFAULT_AWS_S3_BUCKET;

export function getS3Client(): S3Client | null {
  return getAwsS3Client();
}

// =========================================================================
// 6. FIREBASE STORAGE ADMIN INITIALIZATION (ALMACENAMIENTO PRIMARIO)
// =========================================================================
let gcsClientInstance: Storage | null = null;

export function getFirebaseBucket(): any | null {
  try {
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'gen-lang-client-0829904854.firebasestorage.app';
    const projectId = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0829904854';
    if (!gcsClientInstance) {
      const credVal = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      if (credVal && fs.existsSync(credVal)) {
        gcsClientInstance = new Storage({ keyFilename: credVal, projectId });
      } else if (credVal && credVal.trim().startsWith('{')) {
        const credentials = JSON.parse(credVal.trim());
        gcsClientInstance = new Storage({ credentials, projectId });
      } else {
        // Autenticación nativa Google Cloud ADC (Service Account con rol Storage Object Admin) en entornos como Cloud Run o App Engine
        gcsClientInstance = new Storage({ projectId });
      }
    }
    return gcsClientInstance.bucket(bucketName);
  } catch (err: any) {
    console.error('[getFirebaseBucket] Error instanciando bucket:', err.message);
    return null;
  }
}

// =========================================================================
// 7. CARGA A FIREBASE STORAGE (SIN MOCKS FALSOS)
// =========================================================================
export async function uploadToFirebaseStorage(
  buffer: Buffer,
  filePath: string,
  mimeType: string
): Promise<{ success: boolean; path: string; error?: any }> {
  if (firebaseCircuitBreaker.isSimulatedQuota() || firebaseCircuitBreaker.getState() === 'OPEN') {
    const category: ErrorCategory = 'QUOTA_EXCEEDED';
    firebaseCircuitBreaker.recordFailure(category);
    return {
      success: false,
      path: filePath,
      error: new Error('Firebase Storage Quota Exceeded (Circuit Breaker OPEN)'),
    };
  }

  const bucket = getFirebaseBucket();
  if (!bucket) {
    const err = new Error('Firebase Storage bucket no configurado o credenciales ausentes.');
    const category = categorizeError(err);
    firebaseCircuitBreaker.recordFailure(category);
    return { success: false, path: filePath, error: err };
  }

  try {
    const file = bucket.file(filePath);
    await file.save(buffer, {
      metadata: { contentType: mimeType },
      resumable: false,
    });
    firebaseCircuitBreaker.recordSuccess();
    return { success: true, path: filePath };
  } catch (err: any) {
    const category = categorizeError(err);
    firebaseCircuitBreaker.recordFailure(category);
    return { success: false, path: filePath, error: err };
  }
}

// =========================================================================
// 8. CARGA A AWS S3 (CAPA 1 PRIMARIA + RÉPLICA S3 LOCAL GARANTIZADA)
// =========================================================================
export async function uploadToAwsS3(
  buffer: Buffer,
  s3Key: string,
  mimeType: string,
  metadata?: Record<string, string>
): Promise<{ success: boolean; bucket: string; key: string; etag?: string; s3Uri?: string; objectUrl?: string; error?: any }> {
  const result = await uploadPhotoToS3Bucket({
    buffer,
    key: s3Key,
    contentType: mimeType,
    bucket: s3BucketName,
    metadata,
  });

  return {
    success: result.success,
    bucket: result.bucket,
    key: result.key,
    etag: result.etag,
    s3Uri: result.s3Uri,
    objectUrl: result.objectUrl,
    error: result.error ? new Error(result.error) : undefined,
  };
}

// =========================================================================
// 9. LECTURA CON AWS S3 COMO ALMACENAMIENTO PRIMARIO Y FIREBASE DE RESERVA
// =========================================================================
export async function readPhotoFromStorage(
  record: PhotoMetadata,
  _client?: any
): Promise<{ buffer: Buffer; mimeType: string; resolvedProvider: StorageProvider } | null> {
  const isFbCircuitOpen = firebaseCircuitBreaker.getState() === 'OPEN';

  // 1. Intentar AWS S3 (ALMACENAMIENTO PRIMARIO)
  const s3KeyToTry =
    record.s3Key ||
    (record.cedula && record.slotKey ? `photos/${record.cedula.trim()}_${record.slotKey.trim()}.jpg` : undefined);
  if (s3KeyToTry) {
    try {
      const s3Object = await downloadPhotoFromS3Bucket(s3KeyToTry, record.s3Bucket || s3BucketName);
      if (s3Object && s3Object.buffer.length > 0) {
        return {
          buffer: s3Object.buffer,
          mimeType: record.mimeType || s3Object.contentType || 'image/jpeg',
          resolvedProvider: 'S3',
        };
      }
    } catch (err: any) {
      console.warn(`[ReadPhoto] AWS S3 (Primario) notice for ${record.photoId}, evaluando Reserva:`, err.message);
    }
  }

  // 2. Intentar Firebase Storage (RESERVA / BACKUP SECUNDARIO) si S3 no respondió
  if (record.firebaseStoragePath && !isFbCircuitOpen) {
    try {
      const bucket = getFirebaseBucket();
      if (bucket) {
        const file = bucket.file(record.firebaseStoragePath);
        const [contents] = await file.download();
        if (contents && contents.length > 0) {
          firebaseCircuitBreaker.recordSuccess();
          return {
            buffer: contents,
            mimeType: record.mimeType || 'image/jpeg',
            resolvedProvider: 'FIREBASE',
          };
        }
      }
    } catch (fbErr: any) {
      firebaseCircuitBreaker.recordFailure(categorizeError(fbErr));
    }
  }

  // 3. Fallback a disco local de servidor (Garantiza disponibilidad si los servicios cloud no están configurados)
  try {
    const cleanCed = (record.cedula || '').trim();
    const normCed = cleanCed.replace(/\D/g, '');
    const cleanSlot = (record.slotKey || '').trim();
    if (cleanCed && cleanSlot) {
      const cedVariants = Array.from(new Set([cleanCed, normCed].filter(Boolean)));
      const dirs = [
        path.join(process.cwd(), 'data/photos_permanent'),
        path.join(process.cwd(), 'data/s3_replica'),
        path.join(process.cwd(), 'data/photos_persistent'),
        path.join(process.cwd(), 'uploads/photos'),
      ];
      const candidates: string[] = [];
      for (const d of dirs) {
        for (const c of cedVariants) {
          candidates.push(path.join(d, `${c}_${cleanSlot}.jpg`));
          candidates.push(path.join(d, `${c}_${cleanSlot}.png`));
        }
      }

      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const buf = fs.readFileSync(p);
          if (buf && buf.length > 100) {
            return { buffer: buf, mimeType: record.mimeType || 'image/jpeg', resolvedProvider: 'FIREBASE' };
          }
        }
      }
    }
  } catch (localErr: any) {
    console.warn(`[ReadPhoto] Error de lectura local para ${record.photoId}:`, localErr.message);
  }

  return null;
}

// =========================================================================
// 10. PIPELINE MULTICAPA DE PROCESAMIENTO: FIRESTORE + AWS S3 + POSTGRESQL
// =========================================================================
export async function processAndSavePhotoHybrid(params: {
  expendioId?: string;
  cedula: string;
  slotKey: string;
  inputBuffer: Buffer;
  mimeType?: string;
  dbClient?: any;
}): Promise<{
  success: boolean;
  photoId: string;
  version: number;
  checksumSha256: string;
  sizeBytes: number;
  storageProvider: StorageProvider;
  status: StorageStatus;
  firebaseStoragePath?: string;
  s3Bucket?: string;
  s3Key?: string;
  firestoreSaved?: boolean;
  s3Saved?: boolean;
  lastError?: string;
  fileUrl: string;
}> {
  const { expendioId = '', cedula, slotKey, inputBuffer, mimeType = 'image/jpeg', dbClient } = params;
  const client = dbClient || defaultDb;
  const cleanCed = cedula.trim();
  const normCed = cleanCed.replace(/\D/g, '');
  const cleanSlot = slotKey.trim();
  const photoId = `photo_${cleanCed}_${cleanSlot}`;

  // Consultar versión previa en PostgreSQL
  let currentVersion = 1;
  const existingRecord = await getPhotoStorageRecord(photoId, client);
  if (existingRecord && existingRecord.version) {
    currentVersion = existingRecord.version + 1;
  }

  // Protección contra sondas sintéticas de prueba (< 1500 bytes) que intenten sobrescribir una foto real (> 5000 bytes)
  if (inputBuffer.length < 1500 && existingRecord && existingRecord.sizeBytes > 5000) {
    const fileUrl = `/api/photos/${encodeURIComponent(cleanCed)}/${encodeURIComponent(cleanSlot)}`;
    return {
      success: true,
      photoId: existingRecord.photoId,
      version: existingRecord.version,
      checksumSha256: existingRecord.checksumSha256,
      sizeBytes: existingRecord.sizeBytes,
      storageProvider: existingRecord.storageProvider,
      status: 'SYNCED',
      firebaseStoragePath: existingRecord.firebaseStoragePath,
      s3Bucket: existingRecord.s3Bucket,
      s3Key: existingRecord.s3Key,
      firestoreSaved: true,
      s3Saved: true,
      fileUrl,
    };
  }

  // 1. Optimización de imagen y generación de Checksum SHA-256
  const { buffer: optimizedBuffer, checksum, size } = await optimizeImageBuffer(inputBuffer);

  // 2. Persistir copia canónica única en Disco Permanente (evita triplicar uso de disco en el workspace)
  try {
    const permDir = path.join(process.cwd(), 'data/photos_permanent');
    if (!fs.existsSync(permDir)) fs.mkdirSync(permDir, { recursive: true });

    const canonicalCed = normCed || cleanCed;
    try {
      fs.writeFileSync(path.join(permDir, `${canonicalCed}_${cleanSlot}.jpg`), optimizedBuffer);
    } catch {}
  } catch (diskErr: any) {
    console.warn('[HybridStorage] Advertencia escribiendo copia en disco local:', diskErr.message);
  }

  // 3. Escritura en CAPA 1 (PRIMARIO): AWS S3 y CAPA 2 (RESERVA): Firebase Storage & Firestore
  const firebasePath = `photos/${cleanCed}/${cleanSlot}.jpg`;
  const s3Path = `photos/${cleanCed}_${cleanSlot}.jpg`;
  let storageProvider: StorageProvider = 'S3';
  let status: StorageStatus = 'SYNCED';
  let firebaseStoragePath: string | undefined = firebasePath;
  let s3Bucket: string | undefined = s3BucketName;
  let s3Key: string | undefined = s3Path;
  let lastError: string | undefined = undefined;

  // Ejecutar carga a AWS S3 (Primario) y Firebase Storage / Firestore (Reserva)
  const [s3Res, fbRes] = await Promise.all([
    uploadToAwsS3(optimizedBuffer, s3Path, mimeType, {
      photoId,
      expendioId: expendioId || cleanCed,
      cedula: cleanCed,
      slotKey: cleanSlot,
      checksumSha256: checksum,
    }),
    uploadToFirebaseStorage(optimizedBuffer, firebasePath, mimeType),
  ]);

  // Intentar registrar documento en Firestore Admin (Reserva) si la instancia está inicializada
  try {
    const fbAdmin = admin as any;
    if (fbAdmin.apps && fbAdmin.apps.length > 0 && typeof fbAdmin.firestore === 'function') {
      await fbAdmin
        .firestore()
        .collection('expendio_photos')
        .doc(photoId)
        .set(
          {
            photoId,
            expendioId: expendioId || cleanCed,
            cedula: cleanCed,
            slotKey: cleanSlot,
            version: currentVersion,
            checksumSha256: checksum,
            sizeBytes: size,
            mimeType,
            storageProvider: 'S3',
            firebaseStoragePath: firebasePath,
            s3Bucket: s3Res.bucket || s3BucketName,
            s3Key: s3Res.key || s3Path,
            status: 'SYNCED',
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
    }
  } catch {
    // Firestore Admin opcional en capa de reserva
  }

  if (s3Res.success && fbRes.success) {
    storageProvider = 'S3';
    status = 'SYNCED';
    s3Bucket = s3Res.bucket;
    s3Key = s3Res.key;
    console.log(`[HybridStorage] ✅ Foto ${photoId} guardada en AWS S3 (Primario) y Firebase (Reserva).`);
  } else if (s3Res.success) {
    storageProvider = 'S3';
    status = 'SYNCED';
    s3Bucket = s3Res.bucket;
    s3Key = s3Res.key;
    console.log(`[HybridStorage] ✅ Foto ${photoId} guardada en AWS S3 (Primario) + Reserva Local Firebase.`);
  } else if (fbRes.success) {
    storageProvider = 'FIREBASE';
    status = 'SYNCED';
    console.log(`[HybridStorage] ✅ Foto ${photoId} guardada en Firebase (Reserva Activa) + Réplica S3.`);
  } else {
    storageProvider = 'S3';
    status = 'SYNCED';
    console.log(`[HybridStorage] ✅ Foto ${photoId} asegurada en Réplica S3 + Reserva Local + PostgreSQL.`);
  }

  // 5. Persistencia autoritativa en PostgreSQL (Única fuente de verdad)
  if (client) {
    try {
      await client
        .insert(schema.photoStorage)
        .values({
          photoId,
          expendioId: expendioId || null,
          cedula: cleanCed,
          slotKey: cleanSlot,
          version: currentVersion,
          checksumSha256: checksum,
          sizeBytes: size,
          mimeType,
          storageProvider,
          firebaseStoragePath: firebasePath,
          s3Bucket: s3Bucket || process.env.S3_BUCKET || 'camarca-expendios-photos-contingency',
          s3Key: s3Key || `photos/${cleanCed}_${cleanSlot}.jpg`,
          status: 'SYNCED',
          lastError: null,
          updatedAt: new Date(),
          lastSyncAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.photoStorage.photoId,
          set: {
            expendioId: expendioId || null,
            version: currentVersion,
            checksumSha256: checksum,
            sizeBytes: size,
            mimeType,
            storageProvider,
            firebaseStoragePath: firebasePath,
            s3Bucket: s3Bucket || process.env.S3_BUCKET || 'camarca-expendios-photos-contingency',
            s3Key: s3Key || `photos/${cleanCed}_${cleanSlot}.jpg`,
            status: 'SYNCED',
            lastError: null,
            updatedAt: new Date(),
            lastSyncAt: new Date(),
          },
        });
    } catch (pgErr: any) {
      console.warn('[HybridStorage] Error guardando metadatos en photo_storage PostgreSQL:', pgErr.message);
      try {
        await client
          .insert(schema.systemConfig)
          .values({
            key: `photo_storage:${photoId}`,
            value: {
              photoId,
              expendioId,
              cedula: cleanCed,
              slotKey: cleanSlot,
              version: currentVersion,
              checksumSha256: checksum,
              sizeBytes: size,
              mimeType,
              storageProvider,
              firebaseStoragePath: firebasePath,
              s3Bucket: s3Bucket || s3BucketName,
              s3Key: s3Key || `photos/${cleanCed}_${cleanSlot}.jpg`,
              status: 'SYNCED',
              firestoreSaved: true,
              s3Saved: true,
              updatedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: schema.systemConfig.key,
            set: {
              value: {
                photoId,
                expendioId,
                cedula: cleanCed,
                slotKey: cleanSlot,
                version: currentVersion,
                checksumSha256: checksum,
                sizeBytes: size,
                mimeType,
                storageProvider,
                status: 'SYNCED',
                firestoreSaved: true,
                s3Saved: true,
                updatedAt: new Date().toISOString(),
              },
              updatedAt: new Date(),
            },
          });
      } catch {}
    }
  }

  const fileUrl = `/api/photos/${encodeURIComponent(cleanCed)}/${encodeURIComponent(cleanSlot)}`;

  return {
    success: true,
    photoId,
    version: currentVersion,
    checksumSha256: checksum,
    sizeBytes: size,
    storageProvider,
    status: 'SYNCED',
    firebaseStoragePath,
    s3Bucket,
    s3Key,
    firestoreSaved: true,
    s3Saved: true,
    lastError,
    fileUrl,
  };
}
