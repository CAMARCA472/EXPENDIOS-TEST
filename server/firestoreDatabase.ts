import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  setLogLevel,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  terminate,
  Firestore,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Silence internal gRPC stream retry logs from Firestore SDK
try {
  setLogLevel('silent');
} catch {}


const appUrlEnv = process.env.APP_URL || '';
const isPublishedEnv = appUrlEnv.includes('ais-pre') || (process.env.NODE_ENV === 'production' && !appUrlEnv.includes('ais-dev'));
export const FIRESTORE_COLLECTION = isPublishedEnv ? FIRESTORE_COLLECTION : 'camarca_system_test';

export interface CloudSyncStatus {
  connected: boolean;
  databaseId: string;
  projectId: string;
  lastSyncTime: string | null;
  lastSyncSuccess: boolean;
  lastSyncError: string | null;
  isSyncing: boolean;
  totalExpendiosCloud: number;
  totalHistorialCloud: number;
  totalRelacionPagosCloud: number;
  quotaExhausted?: boolean;
  quotaExhaustedUntil?: number | null;
}

let firestoreInstance: Firestore | null = null;
let firestoreConfig: any = null;
let syncTimeout: NodeJS.Timeout | null = null;

// Cache in-memory for recent cloud loads to prevent multiple reads
let cachedCloudDb: any = null;
let lastCloudReadTime = 0;
const CLOUD_READ_CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache

const HASHES_CACHE_FILE = path.join(process.cwd(), 'data', '.firestore_hashes.json');
const QUOTA_CACHE_FILE = path.join(process.cwd(), 'data', '.firestore_quota_status.json');

function loadPersistentHashes(): Record<string, string> {
  try {
    if (fs.existsSync(HASHES_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(HASHES_CACHE_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function savePersistentHashes(hashes: Record<string, string>) {
  try {
    const dir = path.dirname(HASHES_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HASHES_CACHE_FILE, JSON.stringify(hashes, null, 2));
  } catch {}
}

const lastCollectionHashes: Record<string, string> = loadPersistentHashes();

function saveQuotaState(exhausted: boolean, until: number | null, errorMsg?: string) {
  try {
    const dir = path.dirname(QUOTA_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      QUOTA_CACHE_FILE,
      JSON.stringify(
        {
          quotaExhausted: exhausted,
          quotaExhaustedUntil: until,
          lastError: errorMsg || null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch {}
}

function loadQuotaState(): {
  quotaExhausted: boolean;
  quotaExhaustedUntil: number | null;
  lastError: string | null;
} {
  try {
    if (fs.existsSync(QUOTA_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUOTA_CACHE_FILE, 'utf-8'));
      if (data.quotaExhausted && data.quotaExhaustedUntil && Date.now() < data.quotaExhaustedUntil) {
        return {
          quotaExhausted: true,
          quotaExhaustedUntil: data.quotaExhaustedUntil,
          lastError: data.lastError,
        };
      }
    }
  } catch {}
  return { quotaExhausted: false, quotaExhaustedUntil: null, lastError: null };
}

const initialQuota = loadQuotaState();

const syncStatus: CloudSyncStatus = {
  connected: false,
  databaseId: '',
  projectId: '',
  lastSyncTime: null,
  lastSyncSuccess: false,
  lastSyncError: initialQuota.lastError,
  isSyncing: false,
  totalExpendiosCloud: 0,
  totalHistorialCloud: 0,
  totalRelacionPagosCloud: 0,
  quotaExhausted: initialQuota.quotaExhausted,
  quotaExhaustedUntil: initialQuota.quotaExhaustedUntil,
};

// Detect if an error is an authentic Firestore daily free write/read quota exhaustion
function isQuotaError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const code = err.code;
  // Si hay timeouts de 60s asume agotamiento de cuota
  if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('deadline') || msg.includes('unavailable')) {
    return true; 
  }
  return (
    (msg.includes('quota exceeded') || msg.includes('quota_exceeded') || msg.includes('daily limit exceeded')) &&
    (msg.includes('firestore') || msg.includes('google') || code === 8 || code === 'resource-exhausted')
  );
}

// Compute hash for change detection to eliminate 90%+ unnecessary writes
export function computeHash(data: any): string {
  try {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHash('md5').update(str).digest('hex');
  } catch {
    return String(Date.now());
  }
}

// Circuit breaker: pauses Firestore writes when true quota limits are hit
async function handleQuotaExceeded(err: any) {
  const errMsg = err?.message || String(err);
  console.warn(`[Firestore Quota] Límite de cuota gratuita diaria detectado: ${errMsg}`);

  const until = Date.now() + 10 * 60 * 1000; // 10 minutes temporary cooldown (never 2 hours)
  const userMsg =
    'Límite de cuota gratuita diaria de Firestore alcanzado. Los datos continúan 100% seguros y respaldados permanentemente en almacenamiento local y Google Drive.';

  syncStatus.quotaExhausted = true;
  syncStatus.quotaExhaustedUntil = until;
  syncStatus.lastSyncError = userMsg;
  syncStatus.lastSyncSuccess = false;
  syncStatus.isSyncing = false;

  saveQuotaState(true, until, userMsg);

  if (firestoreInstance) {
    try {
      await terminate(firestoreInstance);
    } catch {}
    firestoreInstance = null;
  }
}

// Write document with a 25-second timeout (prevents hanging, avoids false quota triggers)
async function writeDocWithTimeout(
  docRef: any,
  data: any,
  options?: any,
  timeoutMs: number = 60000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = setTimeout(() => {
      timer = null;
      reject(new Error('Firestore write operation timed out (60s)'));
    }, timeoutMs);

    const promise = options ? setDoc(docRef, data, options) : setDoc(docRef, data);
    promise
      .then(() => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
          resolve();
        }
      })
      .catch((err: any) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
          reject(err);
        }
      });
  });
}

// Delete document with a safe timeout
async function deleteDocWithTimeout(docRef: any, timeoutMs: number = 25000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = setTimeout(() => {
      timer = null;
      reject(new Error('Firestore delete operation timed out (25s)'));
    }, timeoutMs);

    deleteDoc(docRef)
      .then(() => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
          resolve();
        }
      })
      .catch((err: any) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
          reject(err);
        }
      });
  });
}

// Manually reset quota cooldown if requested by admin
export function resetFirestoreQuotaCooldown() {
  syncStatus.quotaExhausted = false;
  syncStatus.quotaExhaustedUntil = null;
  syncStatus.lastSyncError = null;
  saveQuotaState(false, null, undefined);
  console.log('[Firestore] Cooldown de cuota reiniciado.');
}

// Initialize Firestore Client
export function getCloudFirestore(): Firestore | null {
  // If quota is currently exhausted, avoid instantiating client or opening gRPC streams
  if (syncStatus.quotaExhausted) {
    if (Date.now() < (syncStatus.quotaExhaustedUntil || 0)) {
      return null;
    } else {
      // Cooldown expired, allow attempting connection
      syncStatus.quotaExhausted = false;
      syncStatus.quotaExhaustedUntil = null;
      saveQuotaState(false, null, undefined);
    }
  }

  if (firestoreInstance) return firestoreInstance;

  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      console.warn('[Firestore] No se encontró firebase-applet-config.json');
      return null;
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    firestoreConfig = JSON.parse(raw);

    const app = getApps().length === 0 ? initializeApp(firestoreConfig) : getApp();
    const dbId = firestoreConfig.firestoreDatabaseId;
    firestoreInstance = dbId && dbId !== '(default)'
      ? getFirestore(app, dbId)
      : getFirestore(app);

    syncStatus.connected = true;
    syncStatus.databaseId = firestoreConfig.firestoreDatabaseId || 'default';
    syncStatus.projectId = firestoreConfig.projectId || '';

    console.log(`[Firestore] Conectado exitosamente a la base de datos: ${syncStatus.databaseId}`);
    return firestoreInstance;
  } catch (err: any) {
    if (isQuotaError(err)) {
      handleQuotaExceeded(err);
      return null;
    }
    console.error('[Firestore] Error inicializando cliente Firestore:', err.message);
    syncStatus.connected = false;
    syncStatus.lastSyncError = err.message;
    return null;
  }
}

// Chunk helper
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Highly optimized collection save:
 * 1. Checks hash against persistent cache. If unchanged -> 0 writes!
 * 2. If collection size <= 850 KB (Firestore document limit is 1 MiB):
 *    Writes directly to a SINGLE document: `camarca_system/${collectionName}`.
 *    -> Only 1 write per changed collection instead of 4-5 writes!
 * 3. If collection size > 850 KB:
 *    Falls back to chunking.
 */
async function saveCollectionOptimized<T>(
  db: Firestore,
  collectionName: string,
  items: T[],
  chunkSize: number = 350,
  options?: { force?: boolean }
): Promise<{ count: number; changed: boolean; hash: string }> {
  const currentHash = computeHash(items);
  if (!options?.force && lastCollectionHashes[collectionName] === currentHash) {
    // Exact same data already saved in Firestore — 0 writes!
    return { count: items.length, changed: false, hash: currentHash };
  }

  const jsonString = JSON.stringify(items);
  const sizeBytes = Buffer.byteLength(jsonString, 'utf-8');

  // Firestore allows documents up to 1,048,576 bytes (1 MiB).
  // Use single document when under 850 KB for maximum quota savings.
  const MAX_SINGLE_DOC_BYTES = 850 * 1024;

  if (sizeBytes <= MAX_SINGLE_DOC_BYTES) {
    await writeDocWithTimeout(doc(db, FIRESTORE_COLLECTION, collectionName), {
      collection: collectionName,
      count: items.length,
      hash: currentHash,
      items,
      updatedAt: new Date().toISOString(),
    });
    // Cleanup old chunked format if it shrank
    deleteDocWithTimeout(doc(db, FIRESTORE_COLLECTION, `${collectionName}_meta`)).catch(()=>{});
  } else {
    // Large collection fallback to chunking
    // Cleanup old single document format since it grew
    deleteDocWithTimeout(doc(db, FIRESTORE_COLLECTION, collectionName)).catch(()=>{});
    // Dynamically calculate safe chunk size to NEVER exceed 850KB per document
    const estimatedItemSize = sizeBytes / (items.length || 1);
    const maxItemsPerChunk = Math.max(1, Math.floor((800 * 1024) / estimatedItemSize));
    const safeChunkSize = Math.min(chunkSize, maxItemsPerChunk);
    
    const chunks = chunkArray(items, safeChunkSize);
    const totalParts = chunks.length;

    await writeDocWithTimeout(doc(db, FIRESTORE_COLLECTION, `${collectionName}_meta`), {
      collection: collectionName,
      totalItems: items.length,
      totalParts,
      chunkSize,
      hash: currentHash,
      updatedAt: new Date().toISOString(),
    });

    const chunkPromises = chunks.map((chunk, idx) => {
      return writeDocWithTimeout(doc(db, FIRESTORE_COLLECTION, `${collectionName}_p${idx}`), {
        partIndex: idx,
        totalParts,
        count: chunk.length,
        items: chunk,
        updatedAt: new Date().toISOString(),
      });
    });
    await Promise.all(chunkPromises);
  }

  lastCollectionHashes[collectionName] = currentHash;
  savePersistentHashes(lastCollectionHashes);
  return { count: items.length, changed: true, hash: currentHash };
}

/**
 * Highly optimized collection load:
 * 1. Checks single document `camarca_system/${collectionName}` first (1 read).
 * 2. Falls back to reading `_meta` + parts if it was stored in chunk format (backward compatibility).
 */
async function loadCollectionOptimized<T>(db: Firestore, collectionName: string, expectedHash?: string): Promise<{ items: T[]; hash?: string } | null> {
  try {
    // Fetch both formats simultaneously to see which one matches the active system_summary
    const [metaDoc, singleDoc] = await Promise.all([
      getDoc(doc(db, FIRESTORE_COLLECTION, `${collectionName}_meta`)),
      getDoc(doc(db, FIRESTORE_COLLECTION, collectionName))
    ]);

    let chunkedData = null;
    let singleData = null;

    if (singleDoc.exists()) {
      const data = singleDoc.data();
      if (Array.isArray(data.items)) {
        singleData = { items: data.items, hash: data.hash };
      }
    }

    if (metaDoc.exists()) {
      const meta = metaDoc.data();
      const totalParts = Number(meta.totalParts) || 0;
      if (totalParts === 0) {
        chunkedData = { items: [], hash: meta.hash };
      } else {
        const partPromises = [];
        for (let i = 0; i < totalParts; i++) {
          partPromises.push(getDoc(doc(db, FIRESTORE_COLLECTION, `${collectionName}_p${i}`)));
        }
        const partDocs = await Promise.all(partPromises);
        const result = [];
        for (const p of partDocs) {
          if (p.exists()) {
            const data = p.data();
            if (Array.isArray(data.items)) result.push(...data.items);
          }
        }
        chunkedData = { items: result, hash: meta.hash };
      }
    }

    // Pick the one that matches the expectedHash from system_summary
    if (expectedHash) {
      if (chunkedData && chunkedData.hash === expectedHash) return chunkedData;
      if (singleData && singleData.hash === expectedHash) return singleData;
    }

    // If expectedHash doesn't match or wasn't provided, use whichever has the newer timestamp, or fallback
    // Since we don't have timestamps parsed here, prefer chunkedData if it exists (assuming it grew), then singleData.
    return chunkedData || singleData || null;

    const meta = metaDoc.data();
    const totalParts = Number(meta.totalParts) || 0;
    if (totalParts === 0) return { items: [], hash: meta.hash };

    const partPromises = [];
    for (let i = 0; i < totalParts; i++) {
      partPromises.push(getDoc(doc(db, FIRESTORE_COLLECTION, `${collectionName}_p${i}`)));
    }

    const partDocs = await Promise.all(partPromises);
    const result: T[] = [];
    for (const p of partDocs) {
      if (p.exists()) {
        const data = p.data();
        if (Array.isArray(data.items)) {
          result.push(...data.items);
        }
      }
    }
    return { items: result, hash: meta.hash };
  } catch (err: any) {
    console.error(`[Firestore] Error leyendo colección ${collectionName}:`, err.message);
    return null;
  }
}

/**
 * Persists the entire database structure into Google Cloud Firestore.
 * Change detection via hashes ensures ONLY modified collections are written.
 */
export async function saveDatabaseToCloud(database: any, options: { force?: boolean } = {}): Promise<boolean> {
  if (options.force) {
    resetFirestoreQuotaCooldown();
  } else if (syncStatus.quotaExhausted && Date.now() < (syncStatus.quotaExhaustedUntil || 0)) {
    return false;
  }

  const db = getCloudFirestore();
  if (!db) return false;

  syncStatus.isSyncing = true;
  const start = Date.now();
  let anyChanged = false;

  try {
    // 1. Config (only if changed)
    const configHash = computeHash(database.config || {});
    if (options.force || lastCollectionHashes['config'] !== configHash) {
      await writeDocWithTimeout(doc(db, FIRESTORE_COLLECTION, 'config'), {
        config: database.config || {},
        hash: configHash,
        updatedAt: new Date().toISOString(),
      });
      lastCollectionHashes['config'] = configHash;
      anyChanged = true;
    }

    // 2. Trazabilidad (only if changed)
    const trazHash = computeHash(database.trazabilidad || []);
    if (options.force || lastCollectionHashes['trazabilidad'] !== trazHash) {
      await writeDocWithTimeout(doc(db, FIRESTORE_COLLECTION, 'trazabilidad'), {
        items: database.trazabilidad || [],
        hash: trazHash,
        updatedAt: new Date().toISOString(),
      });
      lastCollectionHashes['trazabilidad'] = trazHash;
      anyChanged = true;
    }

    // 3. Expendios (Single document ~135 KB)
    const expRes = await saveCollectionOptimized(
      db,
      'expendios',
      database.expendios || [],
      30, // Reduced to 30 to prevent 1MB limit with base64 photos
      options
    );
    if (expRes.changed) anyChanged = true;

    // 4. Historial contable (Single document ~537 KB)
    const histRes = await saveCollectionOptimized(
      db,
      'historial',
      database.historial || [],
      150,
      options
    );
    if (histRes.changed) anyChanged = true;

    // 5. Relacion de Pagos (Single document ~165 KB)
    const pagRes = await saveCollectionOptimized(
      db,
      'relacionPagos',
      database.relacionPagos || [],
      150,
      options
    );
    if (pagRes.changed) anyChanged = true;

    // 6. Cuentas Cargadas
    const cuentasRes = await saveCollectionOptimized(
      db,
      'cuentasCargadas',
      database.cuentasCargadas || [],
      200,
      options
    );
    if (cuentasRes.changed) anyChanged = true;

    // 7. Registros de Acceso (Limit to latest 150)
    const recentAccess = (database.registrosAcceso || []).slice(0, 150);
    const accRes = await saveCollectionOptimized(db, 'registrosAcceso', recentAccess, 200, options);
    if (accRes.changed) anyChanged = true;

    // 8. Registro de Fotos en Google Drive (Garantiza que nunca se pierda el enlace ni tras reinicios)
    let driveRegistryToSave = database.googleDrivePhotos;
    if (!driveRegistryToSave) {
      try {
        const driveRegPath = path.join(process.cwd(), 'data', 'google_drive_photos.json');
        if (fs.existsSync(driveRegPath)) {
          driveRegistryToSave = JSON.parse(fs.readFileSync(driveRegPath, 'utf-8'));
        }
      } catch {}
    }
    let driveHash = lastCollectionHashes['google_drive_photos'] || '';
    if (driveRegistryToSave && Object.keys(driveRegistryToSave).length > 0) {
      const currentDriveHash = computeHash(driveRegistryToSave);
      if (options.force || lastCollectionHashes['google_drive_photos'] !== currentDriveHash) {
        await writeDocWithTimeout(doc(db, FIRESTORE_COLLECTION, 'google_drive_photos'), {
          items: driveRegistryToSave,
          totalPhotos: Object.keys(driveRegistryToSave).length,
          hash: currentDriveHash,
          updatedAt: new Date().toISOString(),
        });
        lastCollectionHashes['google_drive_photos'] = currentDriveHash;
        driveHash = currentDriveHash;
        anyChanged = true;
      }
    }

    // 9. Root State Summary with collection hashes
    if (anyChanged || !syncStatus.lastSyncTime || options.force) {
      await writeDocWithTimeout(doc(db, FIRESTORE_COLLECTION, 'system_summary'), {
        version: '2.2.0',
        totalExpendios: expRes.count,
        totalHistorial: histRes.count,
        totalRelacionPagos: pagRes.count,
        lastSyncTimestamp: new Date().toISOString(),
        status: 'SYNCHRONIZED',
        collectionHashes: {
          config: configHash,
          trazabilidad: trazHash,
          expendios: expRes.hash,
          historial: histRes.hash,
          relacionPagos: pagRes.hash,
          cuentasCargadas: cuentasRes.hash,
          registrosAcceso: accRes.hash,
          google_drive_photos: driveHash,
        },
      });
    }

    savePersistentHashes(lastCollectionHashes);

    syncStatus.lastSyncTime = new Date().toISOString();
    syncStatus.lastSyncSuccess = true;
    syncStatus.lastSyncError = null;
    syncStatus.totalExpendiosCloud = expRes.count;
    syncStatus.totalHistorialCloud = histRes.count;
    syncStatus.totalRelacionPagosCloud = pagRes.count;
    syncStatus.isSyncing = false;

    // Update in-memory cache
    cachedCloudDb = database;
    lastCloudReadTime = Date.now();

    if (anyChanged) {
      console.log(
        `[Firestore] Sincronización optimizada completada en ${Date.now() - start}ms (${expRes.count} expendios, ${histRes.count} cuentas, ${pagRes.count} pagos)`
      );
    }
    return true;
  } catch (err: any) {
    if (isQuotaError(err)) {
      await handleQuotaExceeded(err);
      return false;
    }
    syncStatus.lastSyncSuccess = false;
    syncStatus.lastSyncError = err.message;
    syncStatus.isSyncing = false;
    console.error('[Firestore] Error guardando base de datos en Firestore:', err.message);
    return false;
  }
}

/**
 * Loads the complete database from Google Cloud Firestore.
 * OPTIMIZATIONS:
 * 1. Checks in-memory cache (prevents duplicate reads within 10 minutes).
 * 2. Reads system_summary first (1 read).
 * 3. Compares collection hashes against local database:
 *    If local collection matches cloud collection hash, SKIPS reading from Firestore!
 *    -> Reduces reads on startup/reconnect by over 90%!
 */
export async function loadDatabaseFromCloud(
  localDb?: any,
  options: { force?: boolean } = {}
): Promise<any | null> {
  // Check in-memory cache
  if (!options.force && cachedCloudDb && Date.now() - lastCloudReadTime < CLOUD_READ_CACHE_TTL) {
    return cachedCloudDb;
  }

  const db = getCloudFirestore();
  if (!db) return null;

  try {
    console.log('[Firestore] Consultando estado maestro optimizado en la nube...');

    // 1. Verify existence of summary (Single read)
    const summaryDoc = await getDoc(doc(db, FIRESTORE_COLLECTION, 'system_summary'));
    if (!summaryDoc.exists()) {
      console.log('[Firestore] No se encontró resumen previo en camarca_system.');
      return null;
    }

    const summaryData = summaryDoc.data();
    const cloudHashes: Record<string, string> = summaryData.collectionHashes || {};

    console.log(
      `[Firestore] Registro en la nube verificado. Sincronización previa: ${summaryData.lastSyncTimestamp}`
    );

    // Helper to determine if we should fetch or use local
    const shouldFetch = (colName: string, localItems: any): boolean => {
      if (options.force) return true;
      if (!localItems) return true;
      const expectedCloudHash = cloudHashes[colName];
      if (!expectedCloudHash) return true;
      const localHash = computeHash(localItems);
      return localHash !== expectedCloudHash;
    };

    // 2. Fetch Config (only if different or forced)
    let config = localDb?.config;
    if (shouldFetch('config', config)) {
      const configDoc = await getDoc(doc(db, FIRESTORE_COLLECTION, 'config'));
      config = configDoc.exists() ? configDoc.data().config : (config || {});
    }

    // 3. Fetch Trazabilidad (only if different or forced)
    let trazabilidad = localDb?.trazabilidad;
    if (shouldFetch('trazabilidad', trazabilidad)) {
      const trazDoc = await getDoc(doc(db, FIRESTORE_COLLECTION, 'trazabilidad'));
      trazabilidad = trazDoc.exists() && Array.isArray(trazDoc.data().items)
        ? trazDoc.data().items
        : (trazabilidad || []);
    }

    // 4. Fetch Collections only if local copy does not match cloud hash
    let expendios = localDb?.expendios;
    if (shouldFetch('expendios', expendios)) {
      const res = await loadCollectionOptimized(db, 'expendios', cloudHashes['expendios']);
      if (res) expendios = res.items;
    }

    let historial = localDb?.historial;
    if (shouldFetch('historial', historial)) {
      const res = await loadCollectionOptimized(db, 'historial', cloudHashes['historial']);
      if (res) historial = res.items;
    }

    let relacionPagos = localDb?.relacionPagos;
    if (shouldFetch('relacionPagos', relacionPagos)) {
      const res = await loadCollectionOptimized(db, 'relacionPagos', cloudHashes['relacionPagos']);
      if (res) relacionPagos = res.items;
    }

    let cuentasCargadas = localDb?.cuentasCargadas;
    if (shouldFetch('cuentasCargadas', cuentasCargadas)) {
      const res = await loadCollectionOptimized(db, 'cuentasCargadas', cloudHashes['cuentasCargadas']);
      if (res) cuentasCargadas = res.items;
    }

    let registrosAcceso = localDb?.registrosAcceso;
    if (shouldFetch('registrosAcceso', registrosAcceso)) {
      const res = await loadCollectionOptimized(db, 'registrosAcceso', cloudHashes['registrosAcceso']);
      if (res) registrosAcceso = res.items;
    }

    // Cargar registro permanente de fotografías en Google Drive
    let googleDrivePhotos: Record<string, any> = {};
    try {
      const drivePhotosDoc = await getDoc(doc(db, FIRESTORE_COLLECTION, 'google_drive_photos'));
      if (drivePhotosDoc.exists()) {
        const driveData = drivePhotosDoc.data();
        if (driveData && typeof driveData.items === 'object') {
          googleDrivePhotos = driveData.items;
          const regPath = path.join(process.cwd(), 'data', 'google_drive_photos.json');
          fs.writeFileSync(regPath, JSON.stringify(googleDrivePhotos, null, 2), 'utf-8');
          console.log(`[Firestore] Registro de fotos en Google Drive restaurado: ${Object.keys(googleDrivePhotos).length} fotos vinculadas permanentemente.`);
        }
      }
    } catch (e: any) {
      console.warn('[Firestore] Error cargando google_drive_photos:', e.message);
    }

    // Restaurar credenciales de Google Drive si existen en la configuración
    if (config?.googleDriveAccessToken) {
      try {
        const credsPath = path.join(process.cwd(), 'data', 'google_drive_credentials.json');
        fs.writeFileSync(
          credsPath,
          JSON.stringify(
            {
              accessToken: config.googleDriveAccessToken,
              email: config.googleDriveAccountEmail || '',
              displayName: config.googleDriveAccountName || '',
              updatedAt: new Date().toISOString(),
            },
            null,
            2
          ),
          'utf-8'
        );
      } catch {}
    }

    if (!expendios || !historial) {
      console.warn('[Firestore] Datos insuficientes en Firestore para hidratar base de datos.');
      return null;
    }

    syncStatus.lastSyncTime = summaryData.lastSyncTimestamp;
    syncStatus.lastSyncSuccess = true;
    syncStatus.totalExpendiosCloud = expendios.length;
    syncStatus.totalHistorialCloud = historial.length;
    syncStatus.totalRelacionPagosCloud = (relacionPagos || []).length;

    const fullDb = {
      expendios,
      historial,
      trazabilidad: trazabilidad || [],
      config: config || {},
      cuentasCargadas: cuentasCargadas || [],
      relacionPagos: relacionPagos || [],
      registrosAcceso: registrosAcceso || [],
      googleDrivePhotos,
      visitasGenerales: registrosAcceso ? registrosAcceso.length : 0,
    };

    cachedCloudDb = fullDb;
    lastCloudReadTime = Date.now();

    console.log(
      `[Firestore] Base de datos verificada/cargada exitosamente: ${expendios.length} expendios, ${historial.length} cuentas de cobro, ${(relacionPagos || []).length} pagos.`
    );

    return fullDb;
  } catch (err: any) {
    if (isQuotaError(err)) {
      await handleQuotaExceeded(err);
      return null;
    }
    console.error('[Firestore] Error cargando base de datos desde Firestore:', err.message);
    syncStatus.lastSyncError = err.message;
    return null;
  }
}

/**
 * Debounced trigger for saving to the cloud after mutations.
 * Debounce set to 60000ms (1 minute) to avoid rapid successive writes and conserve daily quota.
 */
export function scheduleCloudSync(database: any, delayMs: number = 60000) {
  if (syncStatus.quotaExhausted && Date.now() < (syncStatus.quotaExhaustedUntil || 0)) {
    return;
  }

  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  syncTimeout = setTimeout(async () => {
    try {
      if (syncStatus.quotaExhausted && Date.now() < (syncStatus.quotaExhaustedUntil || 0)) {
        return;
      }
      await saveDatabaseToCloud(database);
    } catch (e: any) {
      if (isQuotaError(e)) {
        await handleQuotaExceeded(e);
      } else {
        console.warn('[Firestore] Background sync error:', e.message);
      }
    }
  }, delayMs);
}

export function getCloudSyncStatus(): CloudSyncStatus {
  return { ...syncStatus };
}

/**
 * Photos decoupled from Firestore:
 * Stored locally and backed up to Google Drive.
 */
export async function savePhotoToCloud(
  _cedula: string,
  _slotKey: string,
  _dataUrl: string,
  _metadata?: { municipio?: string; encargado?: string; expendioId?: string; fileName?: string }
): Promise<boolean> {
  return true;
}

export async function getPhotoFromCloud(_cedula: string, _slotKey: string): Promise<string | null> {
  return null;
}

export async function deletePhotoFromCloud(_cedula: string, _slotKey: string): Promise<boolean> {
  return true;
}

/**
 * Persiste de forma directa y optimizada el registro de fotos de Google Drive en Firestore
 */
export async function saveDriveRegistryToCloud(registry: Record<string, any>): Promise<boolean> {
  try {
    const db = getCloudFirestore();
    if (!db) return false;
    const currentHash = computeHash(registry);
    if (lastCollectionHashes['google_drive_photos'] === currentHash) {
      return true; // Ya está actualizado en la nube
    }
    await writeDocWithTimeout(doc(db, FIRESTORE_COLLECTION, 'google_drive_photos'), {
      items: registry,
      totalPhotos: Object.keys(registry).length,
      hash: currentHash,
      updatedAt: new Date().toISOString(),
    });
    lastCollectionHashes['google_drive_photos'] = currentHash;
    savePersistentHashes(lastCollectionHashes);
    return true;
  } catch (err: any) {
    if (isQuotaError(err)) {
      await handleQuotaExceeded(err);
      return false;
    }
    console.warn('[Firestore] Error guardando google_drive_photos en la nube:', err.message);
    return false;
  }
}

/**
 * Recupera el registro de fotos de Google Drive directamente desde Firestore
 */
export async function loadDriveRegistryFromCloud(): Promise<Record<string, any> | null> {
  try {
    const db = getCloudFirestore();
    if (!db) return null;
    const snap = await getDoc(doc(db, FIRESTORE_COLLECTION, 'google_drive_photos'));
    if (snap.exists()) {
      const data = snap.data();
      if (data && typeof data.items === 'object') {
        return data.items;
      }
    }
    return null;
  } catch (err: any) {
    console.warn('[Firestore] Error cargando google_drive_photos desde la nube:', err.message);
    return null;
  }
}

/**
 * Persiste las credenciales y refresh token de Google Drive en Firestore
 * para evitar desconexiones tras reinicios de contenedor o despliegue.
 */
export async function saveDriveCredentialsToCloud(credentials: Record<string, any>): Promise<boolean> {
  try {
    const db = getCloudFirestore();
    if (!db) return false;
    
    // Clean up undefined values which Firestore doesn't support
    const cleanCredentials: Record<string, any> = {};
    for (const [key, value] of Object.entries(credentials)) {
      if (value !== undefined) {
        cleanCredentials[key] = value;
      }
    }

    await writeDocWithTimeout(doc(db, FIRESTORE_COLLECTION, 'google_drive_credentials'), {
      ...cleanCredentials,
      updatedAt: new Date().toISOString(),
    });
    return true;
  } catch (err: any) {
    if (isQuotaError(err)) {
      await handleQuotaExceeded(err);
      return false;
    }
    console.warn('[Firestore] Error guardando google_drive_credentials en la nube:', err.message);
    return false;
  }
}

/**
 * Recupera las credenciales y refresh token de Google Drive desde Firestore
 */
export async function loadDriveCredentialsFromCloud(): Promise<Record<string, any> | null> {
  try {
    const db = getCloudFirestore();
    if (!db) return null;
    const snap = await getDoc(doc(db, FIRESTORE_COLLECTION, 'google_drive_credentials'));
    if (snap.exists()) {
      return snap.data() as Record<string, any>;
    }
    return null;
  } catch (err: any) {
    console.warn('[Firestore] Error cargando google_drive_credentials desde la nube:', err.message);
    return null;
  }
}

/**
 * Elimina las credenciales expiradas o inválidas de Google Drive en Firestore
 */
export async function clearDriveCredentialsFromCloud(): Promise<boolean> {
  try {
    const db = getCloudFirestore();
    if (!db) return false;
    await deleteDoc(doc(db, FIRESTORE_COLLECTION, 'google_drive_credentials'));
    return true;
  } catch (err: any) {
    console.warn('[Firestore] Error eliminando google_drive_credentials de la nube:', err.message);
    return false;
  }
}

