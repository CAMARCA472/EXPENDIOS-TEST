import {
  firebaseCircuitBreaker,
  getFirebaseBucket,
  getS3Client,
  uploadToFirebaseStorage,
  categorizeError,
} from './hybridPhotoStorage';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import * as schema from '../db/schema';
import { eq, and } from 'drizzle-orm';

export interface RecoveryWorkerStats {
  running: boolean;
  lastRunAt: string | null;
  processedCount: number;
  successCount: number;
  failedCount: number;
  lastError: string | null;
}

const workerStats: RecoveryWorkerStats = {
  running: false,
  lastRunAt: null,
  processedCount: 0,
  successCount: 0,
  failedCount: 0,
  lastError: null,
};

export function getRecoveryWorkerStats(): RecoveryWorkerStats {
  return { ...workerStats };
}

/**
 * Recovers pending photos stored in AWS S3 fallback back to Firebase Storage
 */
export async function runFirebaseRecoveryWorker(
  dbClient: any,
  batchSize: number = 20
): Promise<{ processed: number; recovered: number; failed: number; message: string }> {
  if (workerStats.running) {
    return { processed: 0, recovered: 0, failed: 0, message: 'Recovery worker is already running.' };
  }

  // Check if Firebase circuit breaker allows recovery trial
  if (firebaseCircuitBreaker.getState() === 'OPEN' || firebaseCircuitBreaker.isSimulatedQuota()) {
    return {
      processed: 0,
      recovered: 0,
      failed: 0,
      message: 'Firebase Storage circuit breaker is OPEN or simulated quota reached. Skipping recovery batch.',
    };
  }

  workerStats.running = true;
  workerStats.lastRunAt = new Date().toISOString();

  let processed = 0;
  let recovered = 0;
  let failed = 0;

  try {
    // 1. Fetch pending fallback photos from PostgreSQL/DB
    let pendingQueue: any[] = [];

    if (dbClient) {
      if (typeof dbClient.select === 'function') {
        try {
          const rows = await dbClient
            .select()
            .from(schema.photoStorage)
            .where(and(eq(schema.photoStorage.storageProvider, 'S3'), eq(schema.photoStorage.status, 'S3_FALLBACK')))
            .limit(batchSize);
          pendingQueue = rows.map((r: any) => ({
            photo_id: r.photoId,
            cedula: r.cedula,
            slot_key: r.slotKey,
            checksum_sha256: r.checksumSha256,
            mime_type: r.mimeType,
            s3_bucket: r.s3Bucket,
            s3_key: r.s3Key,
            firebase_storage_path: r.firebaseStoragePath,
            version: r.version,
          }));
        } catch (e: any) {
          console.warn('[RecoveryWorker Drizzle Query Warn]:', e.message);
          try {
            const sysRows = await dbClient
              .select()
              .from(schema.systemConfig);
            const pendingFromSys = sysRows
              .filter((r: any) => r.key.startsWith('photo_storage:') && r.value)
              .map((r: any) => r.value)
              .filter((r: any) => r.storageProvider === 'S3' && r.status === 'S3_FALLBACK')
              .slice(0, batchSize);

            pendingQueue = pendingFromSys.map((r: any) => ({
              photo_id: r.photoId,
              cedula: r.cedula,
              slot_key: r.slotKey,
              checksum_sha256: r.checksumSha256,
              mime_type: r.mimeType,
              s3_bucket: r.s3Bucket,
              s3_key: r.s3Key,
              firebase_storage_path: r.firebaseStoragePath,
              version: r.version,
            }));
          } catch {}
        }
      } else if (typeof dbClient.query === 'function') {
        try {
          const queueRes = await dbClient.query(
            `SELECT q.id as queue_id, q.photo_id, p.* 
             FROM photo_storage_sync_queue q
             JOIN photo_storage p ON q.photo_id = p.photo_id
             WHERE q.type = 'S3_TO_FIREBASE' AND q.status IN ('PENDING', 'PROCESSING')
             ORDER BY q.created_at ASC
             LIMIT $1
             FOR UPDATE SKIP LOCKED`,
            [batchSize]
          );
          pendingQueue = queueRes.rows || [];
        } catch (e) {
          const queueRes = await dbClient.query(
            `SELECT photo_id, cedula, slot_key, checksum_sha256, mime_type, s3_bucket, s3_key, firebase_storage_path, version 
             FROM photo_storage 
             WHERE storage_provider = 'S3' AND status = 'S3_FALLBACK'
             LIMIT $1`,
            [batchSize]
          );
          pendingQueue = queueRes.rows || [];
        }
      }
    }

    if (pendingQueue.length === 0) {
      workerStats.running = false;
      return { processed: 0, recovered: 0, failed: 0, message: 'No pending S3 fallback photos to recover.' };
    }

    console.log(`[RecoveryWorker] Processing ${pendingQueue.length} pending S3 fallback photos...`);

    const s3BucketName = process.env.S3_BUCKET || 'camarca-expendios-photos-contingency';

    for (const item of pendingQueue) {
      processed++;
      workerStats.processedCount++;
      const photoId = item.photo_id || item.photoId || `ph-${item.cedula}-${item.slot_key}`;
      const s3Key = item.s3_key || item.s3Key || `photos/${item.cedula}_${item.slot_key}.jpg`;
      const firebasePath = item.firebase_storage_path || item.firebaseStoragePath || `photos/${item.cedula}/${item.slot_key}.jpg`;
      const expectedChecksum = item.checksum_sha256 || item.checksumSha256;

      try {
        // Step A: Read Object from AWS S3
        let buffer: Buffer | null = null;
        const s3 = getS3Client();

        if (s3) {
          const getCmd = new GetObjectCommand({
            Bucket: item.s3_bucket || s3BucketName,
            Key: s3Key,
          });
          const s3Res = await s3.send(getCmd);
          if (s3Res.Body) {
            const bytes = await s3Res.Body.transformToByteArray();
            buffer = Buffer.from(bytes);
          }
        }

        if (!buffer) {
          throw new Error(`Object not found in S3 bucket for photoId ${photoId}`);
        }

        // Step B: Verify SHA-256 Checksum on S3 buffer before migration
        const actualChecksum = crypto.createHash('sha256').update(buffer).digest('hex');
        if (expectedChecksum && actualChecksum !== expectedChecksum) {
          throw new Error(`Checksum mismatch for S3 object ${photoId}. Expected ${expectedChecksum}, got ${actualChecksum}`);
        }

        // Step C: Upload to Firebase Storage
        const uploadRes = await uploadToFirebaseStorage(buffer, firebasePath, item.mime_type || 'image/jpeg');
        if (!uploadRes.success) {
          throw uploadRes.error || new Error('Firebase upload failed during recovery');
        }

        // Step D: Confirm Firebase Storage Upload & Checksum
        const bucket = getFirebaseBucket();
        let confirmed = false;
        if (bucket) {
          try {
            const fbFile = bucket.file(firebasePath);
            const [exists] = await fbFile.exists();
            if (exists) confirmed = true;
          } catch {}
        }
        if (!confirmed) {
          throw new Error('Firebase storage file existence verification failed');
        }

        // Step E: Update PostgreSQL Metadata (Mark Firebase as primary, keep S3 retention)
        if (dbClient) {
          if (typeof dbClient.update === 'function') {
            try {
              await dbClient
                .update(schema.photoStorage)
                .set({
                  storageProvider: 'FIREBASE',
                  status: 'SYNCED',
                  firebaseStoragePath: firebasePath,
                  lastSyncAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(schema.photoStorage.photoId, photoId));
            } catch {
              try {
                const recoveredRecord = {
                  photoId,
                  cedula: item.cedula,
                  slotKey: item.slot_key || item.slotKey,
                  version: item.version || 1,
                  checksumSha256: expectedChecksum || '',
                  sizeBytes: buffer.length,
                  mimeType: item.mime_type || 'image/jpeg',
                  storageProvider: 'FIREBASE',
                  firebaseStoragePath: firebasePath,
                  s3Bucket: item.s3_bucket || s3BucketName,
                  s3Key,
                  status: 'SYNCED',
                  updatedAt: new Date().toISOString(),
                };
                await dbClient
                  .insert(schema.systemConfig)
                  .values({
                    key: `photo_storage:${photoId}`,
                    value: recoveredRecord,
                    updatedAt: new Date(),
                  })
                  .onConflictDoUpdate({
                    target: schema.systemConfig.key,
                    set: {
                      value: recoveredRecord,
                      updatedAt: new Date(),
                    },
                  });
              } catch {}
            }

            await dbClient
              .update(schema.photoStorageSyncQueue)
              .set({
                status: 'COMPLETED',
                updatedAt: new Date(),
              })
              .where(eq(schema.photoStorageSyncQueue.photoId, photoId))
              .catch(() => {});
          } else if (typeof dbClient.query === 'function') {
            await dbClient.query(
              `UPDATE photo_storage 
               SET storage_provider = 'FIREBASE', 
                   status = 'SYNCED', 
                   firebase_storage_path = $1, 
                   last_sync_at = NOW(), 
                   updated_at = NOW() 
               WHERE photo_id = $2 OR (cedula = $3 AND slot_key = $4)`,
              [firebasePath, photoId, item.cedula, item.slot_key || item.slotKey]
            );

            if (item.queue_id || item.queueId) {
              await dbClient.query(
                `UPDATE photo_storage_sync_queue 
                 SET status = 'COMPLETED', updated_at = NOW() 
                 WHERE id = $1`,
                [item.queue_id || item.queueId]
              );
            }
          }
        }

        recovered++;
        workerStats.successCount++;
        console.log(`[RecoveryWorker] ✅ Recovered ${photoId} from S3 to Firebase Storage successfully.`);
      } catch (err: any) {
        failed++;
        workerStats.failedCount++;
        workerStats.lastError = err.message;
        console.error(`[RecoveryWorker] ❌ Failed recovering ${photoId} from S3:`, err.message);

        // Record error and schedule retry
        if (dbClient && typeof dbClient.query === 'function') {
          try {
            await dbClient.query(
              `UPDATE photo_storage 
               SET last_error = $1, retry_count = retry_count + 1, updated_at = NOW() 
               WHERE photo_id = $2`,
              [err.message, photoId]
            );
          } catch {}
        }
      }
    }

    workerStats.running = false;
    return {
      processed,
      recovered,
      failed,
      message: `[RecoveryWorker] Completed recovery batch: ${recovered} recovered to Firebase, ${failed} failed out of ${processed} processed.`,
    };
  } catch (globalErr: any) {
    workerStats.running = false;
    workerStats.lastError = globalErr.message;
    return { processed, recovered, failed, message: `Recovery worker error: ${globalErr.message}` };
  }
}
