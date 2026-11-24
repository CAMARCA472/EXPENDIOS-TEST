import fs from 'fs';
import path from 'path';
import {
  DatabaseSchema,
  RegistroAcceso,
  ExpendioData,
  HistorialItem,
  PagoRelacionItem,
  TrazabilidadExpendio,
} from '../src/types.ts';
import {
  uploadPhotoToS3Bucket,
  downloadPhotoFromS3Bucket,
  getFirebaseBucket,
} from '../src/lib/hybridPhotoStorage.ts';
import {
  validateDatabaseInvariants,
  validateLocalDatabaseStateBeforeSave,
  LocalStateValidationReport,
} from './domainIntegrity.js';
import {
  enqueueOutboxEvent,
  markOutboxEventConfirmed,
} from './durableOutbox.js';
import {
  ConcurrencyConflictError,
  PostgresMutationOptions,
} from './postgresTransactionalStore.ts';

export type {
  DatabaseSchema,
  RegistroAcceso,
  ExpendioData,
  HistorialItem,
  PagoRelacionItem,
  TrazabilidadExpendio,
  LocalStateValidationReport,
};
export { ConcurrencyConflictError };

// ==============================================================================
// 1. GESTOR DE ALMACENAMIENTO SERIALIZADO Y BÓVEDA TRIPLE SIN COSTO (dbStore.ts)
// ==============================================================================
// Arquitectura Triple Escudo ($0 COP / Cero Pérdida de Datos / Cero Saturación):
// - Lecturas: 100% desde Memoria RAM (inMemoryDatabase) -> 0 consultas a BD por lectura.
// - Escrituras (mutateDatabase):
//   1. Cola serializada (Mutex) y validación de estado e invariantes (verifyLocalDatabaseStateBeforeSave).
//   2. Escritura atómica verificada en disco local (database/camarca_master_db.json, data/database.json y data/database.published.json).
//   3. Sincronización atómica de archivo único (sin límite de 1MB) hacia:
//      - Bóveda Primaria: AWS S3 (s3://camarca-expendios-photos-contingency/database/camarca_master_db.json)
//      - Bóveda Espejo: Google Cloud / Firebase Storage Bucket (database/camarca_master_db.json)
// - Arranque (resolveStartupDatabase):
//   Descarga y reconcilia automáticamente el estado más reciente entre AWS S3,
//   Firebase Storage y Disco Local para garantizar 0% pérdida tras reinicios de Cloud Run.
// ==============================================================================

const rootDir = process.cwd();
const dataDir = path.join(rootDir, 'data');
const localMasterDbDir = path.join(rootDir, 'database');
const backupsDir = path.join(dataDir, 'backups');
const permanentArchiveDir = path.join(dataDir, 'archivos_permanentes');

const localMasterDbPath = path.join(localMasterDbDir, 'camarca_master_db.json');
const legacyDbPath = path.join(dataDir, 'database.json');
const masterPublishedDbPath = path.join(dataDir, 'database.published.json');
const accessLogPath = path.join(dataDir, 'registros_acceso.json');

const MASTER_DB_CLOUD_KEY = 'database/camarca_master_db.json';
const ACCESS_LOGS_CLOUD_KEY = 'database/registros_acceso.json';

// Ensure necessary directories exist
[dataDir, localMasterDbDir, backupsDir, permanentArchiveDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const isPublishedEnv =
  (process.env.APP_ENV === 'published' ||
    process.env.APP_ENV === 'production' ||
    process.env.NODE_ENV === 'production' ||
    (process.env.APP_URL &&
      !process.env.APP_URL.includes('-dev-') &&
      !process.env.APP_URL.includes('localhost'))) &&
  String(process.env.APP_ENV || '').toLowerCase() !== 'test';

export function getActiveDbPath(): string {
  return fs.existsSync(localMasterDbPath) ? localMasterDbPath : legacyDbPath;
}

export function getMasterDbFilePath(): string {
  return localMasterDbPath;
}

// In-memory single source of truth
let inMemoryDatabase: DatabaseSchema | null = null;
let lastAutoBackupTime = 0;

// Mutex / Serialized Promise Queue for mutations
let mutationQueue: Promise<any> = Promise.resolve();

const permanentPhotosDir = path.join(dataDir, 'photos_permanent');
const uploadsPhotosDir = path.join(rootDir, 'uploads', 'photos');
[permanentPhotosDir, uploadsPhotosDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const PHOTO_URL_FIELDS = [
  'fotoAvisoUrl',
  'fotoPanoramicaUrl',
  'fotoMataselloUrl',
  'fotoBasculaUrl',
  'fotoContratistaUrl',
  'fotoHorarioUrl',
  'fotoTarifasUrl',
  'letreroUrl',
  'basculaUrl',
  'mataselloUrl',
  'computadorUrl',
] as const;

/**
 * Normaliza y valida la estructura de la base de datos, garantizando IDs inmutables
 * y liberando cualquier cadena Base64 pesada en línea hacia archivos físicos en disco.
 */
export function normalizeDatabase(db: any): DatabaseSchema {
  if (!db || typeof db !== 'object') {
    db = {};
  }

  const rawExpendios = Array.isArray(db.expendios) ? db.expendios : [];
  const normalizedExpendios = rawExpendios.map((exp: any, idx: number) => {
    if (!exp || typeof exp !== 'object') return exp;
    const cleanId = typeof exp.id === 'string' && exp.id.trim() ? exp.id.trim() : '';
    const rawCed = String(exp.cedula || '').trim();
    const digitsOnly = rawCed.replace(/\D/g, '');
    const cleanCedula =
      digitsOnly.length >= 4 ? rawCed : rawCed === '1' || rawCed === '0' ? '' : rawCed;
    const fallbackId =
      digitsOnly.length >= 4
        ? `exp_ced_${digitsOnly}`
        : `exp_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`;
    const resolvedId = cleanId || fallbackId;
    const safeCedForPhoto = digitsOnly || resolvedId;

    // Offload any inline Base64 images to physical disk files to keep JSON size small and fast
    const cleanedPhotoFields: Record<string, string> = {};
    for (const field of PHOTO_URL_FIELDS) {
      const val = exp[field];
      if (typeof val === 'string' && val.startsWith('data:image/')) {
        try {
          const base64Part = val.split(',')[1];
          if (base64Part && base64Part.length > 100) {
            const buf = Buffer.from(base64Part, 'base64');
            if (buf.length >= 200) {
              const fileName = `${safeCedForPhoto}_${field}.jpg`;
              try {
                fs.writeFileSync(path.join(permanentPhotosDir, fileName), buf);
                fs.writeFileSync(path.join(uploadsPhotosDir, fileName), buf);
              } catch {}
              cleanedPhotoFields[field] = `/api/photos/${encodeURIComponent(safeCedForPhoto)}/${encodeURIComponent(field)}?v=1`;
            }
          }
        } catch {}
      }
    }

    const mergedExp = { ...exp, ...cleanedPhotoFields };

    const hasPhotos = Boolean(
      mergedExp.fotoAvisoUrl ||
        mergedExp.fotoPanoramicaUrl ||
        mergedExp.fotoMataselloUrl ||
        mergedExp.fotoBasculaUrl ||
        mergedExp.fotoContratistaUrl ||
        mergedExp.fotoHorarioUrl ||
        mergedExp.fotoTarifasUrl ||
        mergedExp.letreroUrl ||
        mergedExp.basculaUrl ||
        mergedExp.mataselloUrl ||
        mergedExp.computadorUrl
    );
    const rawUpdatedDate = mergedExp.updatedAt
      ? (mergedExp.updatedAt instanceof Date
          ? mergedExp.updatedAt.toISOString()
          : String(mergedExp.updatedAt)
        ).split('T')[0]
      : '';
    const rawFechaAct =
      typeof mergedExp.fechaUltimaActualizacion === 'string'
        ? mergedExp.fechaUltimaActualizacion.trim()
        : '';
    const isSeedDate = rawFechaAct === '2026-07-31';
    const hasPostSeedUpdate = Boolean(rawUpdatedDate && rawUpdatedDate > '2026-10-02');
    const hasUpdatedData = Boolean(
      hasPhotos ||
        mergedExp.primeraVezActualizado ||
        (Number(mergedExp.revision) || 1) > 1 ||
        (rawFechaAct && !isSeedDate) ||
        hasPostSeedUpdate
    );

    let resolvedFechaActualizacion = '';
    if (hasUpdatedData) {
      if (rawFechaAct && !isSeedDate) {
        resolvedFechaActualizacion =
          hasPostSeedUpdate && rawUpdatedDate > rawFechaAct ? rawUpdatedDate : rawFechaAct;
      } else if (hasPostSeedUpdate) {
        resolvedFechaActualizacion = rawUpdatedDate;
      } else {
        resolvedFechaActualizacion = rawFechaAct || rawUpdatedDate;
      }
    }

    return {
      ...mergedExp,
      id: resolvedId,
      cedula: cleanCedula,
      fechaUltimaActualizacion: resolvedFechaActualizacion,
    };
  });

  // Deduplicar expendios por ID canónico inmutable (conservando siempre la revisión más alta y preservando cédulas anteriores)
  const dedupedExpendiosMap = new Map<string, any>();
  for (const exp of normalizedExpendios) {
    if (!exp || !exp.id) continue;
    const existing = dedupedExpendiosMap.get(exp.id);
    if (!existing) {
      dedupedExpendiosMap.set(exp.id, exp);
    } else {
      const revExp = Number(exp.revision) || 0;
      const revEx = Number(existing.revision) || 0;
      const timeExp = new Date(exp.updatedAt || exp.fechaUltimaActualizacion || 0).getTime() || 0;
      const timeEx = new Date(existing.updatedAt || existing.fechaUltimaActualizacion || 0).getTime() || 0;

      const expWins = revExp > revEx || (revExp === revEx && timeExp >= timeEx);
      const winner = expWins ? exp : existing;
      const loser = expWins ? existing : exp;

      const merged: any = { ...loser, ...winner };
      for (const field of PHOTO_URL_FIELDS) {
        if (!merged[field] && loser[field]) {
          merged[field] = loser[field];
        }
      }
      const prevCeds = new Set<string>([
        ...(Array.isArray(winner.cedulasAnteriores) ? winner.cedulasAnteriores : []),
        ...(Array.isArray(loser.cedulasAnteriores) ? loser.cedulasAnteriores : []),
      ]);
      const loserCed = String(loser.cedula || '').trim();
      const winnerCed = String(winner.cedula || '').trim();
      if (loserCed && loserCed !== winnerCed) {
        prevCeds.add(loserCed);
      }
      if (prevCeds.size > 0) {
        merged.cedulasAnteriores = Array.from(prevCeds);
      }
      dedupedExpendiosMap.set(exp.id, merged);
    }
  }
  const finalExpendios = Array.from(dedupedExpendiosMap.values());

  // Blindaje canónico de auto-curación para el Super-Admin / GIRON (1094269932) y TOGUI (52032761)
  const normName = (s?: string) =>
    String(s || '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const gironExp = finalExpendios.find(
    (e) => e && (e.id === 'exp-excel-1790706569563-37' || String(e.cedula || '').replace(/\D/g, '') === '1094269932')
  );
  if (gironExp) {
    const currentEncNorm = normName(gironExp.encargado);
    if (currentEncNorm && currentEncNorm !== 'DIEGO ALEJANDRO BECERRA') {
      // Si otro expendio escribió accidentalmente sus datos sobre 1094269932, transferirlos a su expendio real
      const realOwner = finalExpendios.find(
        (e) =>
          e &&
          e.id !== gironExp.id &&
          String(e.cedula || '').replace(/\D/g, '') !== '1094269932' &&
          normName(e.encargado) === currentEncNorm
      );
      if (realOwner) {
        if (gironExp.cuentaBancaria && gironExp.cuentaBancaria !== '3162442415') {
          realOwner.cuentaBancaria = gironExp.cuentaBancaria;
        }
        if (gironExp.banco) {
          realOwner.banco = gironExp.banco;
        }
        if (gironExp.correoElectronico && gironExp.correoElectronico.toUpperCase() !== 'PQR@CAMARCASAS.COM') {
          realOwner.correoElectronico = gironExp.correoElectronico;
        }
        realOwner.primeraVezActualizado = true;
        if (!realOwner.fechaUltimaActualizacion) {
          realOwner.fechaUltimaActualizacion = new Date().toISOString().split('T')[0];
        }
      }
    }

    // Fijar siempre los datos maestros del Administrador / GIRON (1094269932)
    gironExp.municipio = 'GIRON';
    gironExp.localidad = 'GIRON';
    gironExp.nombre = 'GIRON';
    gironExp.encargado = 'DIEGO ALEJANDRO BECERRA';
    gironExp.cedula = '1094269932';
    gironExp.direccion = 'CRA 26 16 74 BODEGA 7  BR SANTA CRUZ';
    gironExp.direccionPunto = 'CRA 26 16 74 BODEGA 7  BR SANTA CRUZ';
    gironExp.telefono = '3182822512';
    gironExp.telefonoPunto = '3182822512';
    gironExp.cuentaBancaria = '3162442415';
    gironExp.banco = 'NEQUI';
    gironExp.correoElectronico = 'PQR@CAMARCASAS.COM';
    gironExp.primeraVezActualizado = true;
    gironExp.tieneAviso = 'SI';
    gironExp.tieneBascula = 'SI';
    gironExp.tieneMatasello = 'SI';
    if (!gironExp.fotoAvisoUrl) gironExp.fotoAvisoUrl = '/api/photos/1094269932/fotoAvisoUrl';
    if (!gironExp.letreroUrl) gironExp.letreroUrl = '/api/photos/1094269932/fotoAvisoUrl';
    if (!gironExp.fotoPanoramicaUrl) gironExp.fotoPanoramicaUrl = '/api/photos/1094269932/fotoPanoramicaUrl';
    if (!gironExp.fotoMataselloUrl) gironExp.fotoMataselloUrl = '/api/photos/1094269932/fotoMataselloUrl';
    if (!gironExp.mataselloUrl) gironExp.mataselloUrl = '/api/photos/1094269932/fotoMataselloUrl';
    if (!gironExp.fotoBasculaUrl) gironExp.fotoBasculaUrl = '/api/photos/1094269932/fotoBasculaUrl';
    if (!gironExp.basculaUrl) gironExp.basculaUrl = '/api/photos/1094269932/fotoBasculaUrl';
    if (!gironExp.fotoContratistaUrl) gironExp.fotoContratistaUrl = '/api/photos/1094269932/fotoContratistaUrl';
    if (!gironExp.fotoHorarioUrl) gironExp.fotoHorarioUrl = '/api/photos/1094269932/fotoHorarioUrl';
    if (!gironExp.fotoTarifasUrl) gironExp.fotoTarifasUrl = '/api/photos/1094269932/fotoTarifasUrl';
  }

  const toguiExp = finalExpendios.find(
    (e) => e && (e.id === 'exp-excel-1790706569570-157' || String(e.cedula || '').replace(/\D/g, '') === '52032761')
  );
  if (toguiExp) {
    toguiExp.municipio = 'TOGUI';
    toguiExp.localidad = 'TOGUI';
    toguiExp.nombre = 'TOGUI';
    toguiExp.encargado = 'LILIA ESPERANZA RÍOS';
    toguiExp.cedula = '52032761';
    if (!toguiExp.cuentaBancaria) toguiExp.cuentaBancaria = '3133477535';
    if (!toguiExp.banco) toguiExp.banco = 'NEQUI';
    if (!toguiExp.correoElectronico) toguiExp.correoElectronico = 'PAPELERIA.TOGUI@GMAIL.COM';
    toguiExp.primeraVezActualizado = true;
    toguiExp.tieneAviso = 'SI';
    toguiExp.tieneBascula = 'SI';
    toguiExp.tieneMatasello = 'SI';
    if (!toguiExp.fotoAvisoUrl) toguiExp.fotoAvisoUrl = '/api/photos/52032761/fotoAvisoUrl';
    if (!toguiExp.letreroUrl) toguiExp.letreroUrl = '/api/photos/52032761/fotoAvisoUrl';
    if (!toguiExp.fotoPanoramicaUrl) toguiExp.fotoPanoramicaUrl = '/api/photos/52032761/fotoPanoramicaUrl';
    if (!toguiExp.fotoMataselloUrl) toguiExp.fotoMataselloUrl = '/api/photos/52032761/fotoMataselloUrl';
    if (!toguiExp.mataselloUrl) toguiExp.mataselloUrl = '/api/photos/52032761/fotoMataselloUrl';
    if (!toguiExp.fotoBasculaUrl) toguiExp.fotoBasculaUrl = '/api/photos/52032761/fotoBasculaUrl';
    if (!toguiExp.basculaUrl) toguiExp.basculaUrl = '/api/photos/52032761/fotoBasculaUrl';
    if (!toguiExp.fotoContratistaUrl) toguiExp.fotoContratistaUrl = '/api/photos/52032761/fotoContratistaUrl';
    if (!toguiExp.fotoHorarioUrl) toguiExp.fotoHorarioUrl = '/api/photos/52032761/fotoHorarioUrl';
    if (!toguiExp.fotoTarifasUrl) toguiExp.fotoTarifasUrl = '/api/photos/52032761/fotoTarifasUrl';
  }

  const rawHistorial = Array.isArray(db.historial) ? db.historial : [];
  const normalizedHistorial = rawHistorial.map((h: any, idx: number) => {
    if (!h || typeof h !== 'object') return h;
    const cleanId = typeof h.id === 'string' && h.id.trim() ? h.id.trim() : '';
    return {
      ...h,
      id: cleanId || `hist_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
    };
  });

  const rawPagos = Array.isArray(db.relacionPagos) ? db.relacionPagos : [];
  const normalizedPagos = rawPagos.map((p: any, idx: number) => {
    if (!p || typeof p !== 'object') return p;
    const cleanId = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : '';
    return {
      ...p,
      id: cleanId || `pago_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
    };
  });

  const rawTraz = Array.isArray(db.trazabilidad) ? db.trazabilidad : [];
  const normalizedTraz = rawTraz.map((t: any, idx: number) => {
    if (!t || typeof t !== 'object') return t;
    const cleanId = typeof t.id === 'string' && t.id.trim() ? t.id.trim() : '';
    return {
      ...t,
      id: cleanId || `traz_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
    };
  });

  return {
    expendios: finalExpendios,
    historial: normalizedHistorial,
    trazabilidad: normalizedTraz,
    config: db.config && typeof db.config === 'object' ? db.config : {},
    cuentasCargadas: Array.isArray(db.cuentasCargadas) ? db.cuentasCargadas : [],
    relacionPagos: normalizedPagos,
    visitasGenerales: typeof db.visitasGenerales === 'number' ? db.visitasGenerales : 0,
    updatedAt: db.updatedAt || new Date().toISOString(),
    revision: Number(db.revision) || 0,
  };
}

/**
 * Carga directa desde disco (reconciliando entre database/camarca_master_db.json, data/database.json y data/database.published.json)
 */
function readDbFromDisk(): DatabaseSchema {
  const candidates = [localMasterDbPath, legacyDbPath, masterPublishedDbPath];
  let bestSnapshot: DatabaseSchema | null = null;

  for (const candidatePath of candidates) {
    if (fs.existsSync(candidatePath)) {
      try {
        const raw = fs.readFileSync(candidatePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.expendios) && parsed.expendios.length > 0) {
          const normalized = normalizeDatabase(parsed);
          if (!bestSnapshot) {
            bestSnapshot = normalized;
          } else {
            bestSnapshot = mergeDatabasesPreservingLatest(bestSnapshot, normalized);
          }
        }
      } catch (err) {
        console.error(`[dbStore] Error leyendo ${candidatePath}:`, err);
      }
    }
  }

  if (bestSnapshot) {
    return bestSnapshot;
  }

  return normalizeDatabase({
    expendios: [],
    historial: [],
    trazabilidad: [],
    config: {},
    cuentasCargadas: [],
    relacionPagos: [],
    visitasGenerales: 0,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Escritura atómica a disco para prevenir corrupción de archivos por fallos en caliente.
 */
export function atomicWriteJsonSync(targetPath: string, data: any) {
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const tempPath = `${targetPath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
  const content = JSON.stringify(data);
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, targetPath);
}

/**
 * Valida el estado e integridad de la base de datos local ANTES de ejecutar el proceso de guardado.
 * Asegura que no existan IDs duplicados, pérdida accidental de registros o referencias huérfanas,
 * y que el archivo local `database/camarca_master_db.json` esté en estado consistente.
 */
export function verifyLocalDatabaseStateBeforeSave(
  candidateDb?: DatabaseSchema,
  allowEmpty = false
): LocalStateValidationReport & {
  localDiskReadable: boolean;
  masterFilePath: string;
  currentInMemoryRevision: number;
} {
  const targetDb = candidateDb || inMemoryDatabase || readDbFromDisk();
  const currentCount = inMemoryDatabase?.expendios?.length || 0;
  const minExpected = allowEmpty ? 0 : currentCount >= 50 ? 50 : 0;

  const report = validateLocalDatabaseStateBeforeSave(targetDb, minExpected);

  let localDiskReadable = true;
  if (fs.existsSync(localMasterDbPath)) {
    try {
      const raw = fs.readFileSync(localMasterDbPath, 'utf8');
      const parsed = JSON.parse(raw);
      localDiskReadable = Boolean(parsed && Array.isArray(parsed.expendios));
    } catch {
      localDiskReadable = false;
    }
  }

  return {
    ...report,
    localDiskReadable,
    masterFilePath: MASTER_DB_CLOUD_KEY,
    currentInMemoryRevision: Number(targetDb.revision) || 0,
  };
}

/**
 * Verifica después del guardado que `database/camarca_master_db.json` se haya escrito
 * físicamente de forma íntegra y coincida con la revisión y conteo de expendios esperados.
 */
export function verifyWrittenMasterDatabaseOnDisk(
  expectedRevision: number,
  expectedExpendiosCount: number
): { verified: boolean; revisionOnDisk: number; expendiosOnDisk: number; filePath: string } {
  try {
    if (!fs.existsSync(localMasterDbPath)) {
      return {
        verified: false,
        revisionOnDisk: -1,
        expendiosOnDisk: 0,
        filePath: MASTER_DB_CLOUD_KEY,
      };
    }
    const raw = fs.readFileSync(localMasterDbPath, 'utf8');
    const parsed = JSON.parse(raw);
    const revOnDisk = Number(parsed?.revision) || 0;
    const expOnDisk = Array.isArray(parsed?.expendios) ? parsed.expendios.length : 0;
    const verified = revOnDisk >= expectedRevision && expOnDisk === expectedExpendiosCount;
    return {
      verified,
      revisionOnDisk: revOnDisk,
      expendiosOnDisk: expOnDisk,
      filePath: MASTER_DB_CLOUD_KEY,
    };
  } catch {
    return {
      verified: false,
      revisionOnDisk: -1,
      expendiosOnDisk: 0,
      filePath: MASTER_DB_CLOUD_KEY,
    };
  }
}

// ==============================================================================
// SINCRONIZACIÓN ATÓMICA CON BÓVEDAS EN LA NUBE (AWS S3 + FIREBASE STORAGE)
// ==============================================================================

export async function syncJsonToCloudVaults(
  cloudKey: string,
  payloadObj: any,
  metadata?: Record<string, string>
): Promise<{ s3Saved: boolean; firebaseStorageSaved: boolean }> {
  let s3Saved = false;
  let firebaseStorageSaved = false;

  try {
    const buffer = Buffer.from(JSON.stringify(payloadObj), 'utf8');

    const [s3Res, fbRes] = await Promise.all([
      uploadPhotoToS3Bucket({
        buffer,
        key: cloudKey,
        contentType: 'application/json',
        metadata,
      }).catch(() => ({ success: false })),
      (async () => {
        try {
          const bucket = getFirebaseBucket();
          if (!bucket) return false;
          const file = bucket.file(cloudKey);
          await file.save(buffer, {
            metadata: { contentType: 'application/json', metadata },
            resumable: false,
          });
          return true;
        } catch {
          return false;
        }
      })(),
    ]);

    s3Saved = Boolean(s3Res && s3Res.success);
    firebaseStorageSaved = Boolean(fbRes);
  } catch (err: any) {
    console.warn(`[CloudVault] Advertencia sincronizando ${cloudKey}:`, err.message);
  }

  return { s3Saved, firebaseStorageSaved };
}

export async function loadJsonFromCloudVaults<T = any>(cloudKey: string): Promise<{
  s3Data: T | null;
  firebaseStorageData: T | null;
}> {
  const [s3Data, firebaseStorageData] = await Promise.all([
    (async (): Promise<T | null> => {
      try {
        const res = await downloadPhotoFromS3Bucket(cloudKey);
        if (res && res.buffer && res.buffer.length > 2) {
          return JSON.parse(res.buffer.toString('utf8')) as T;
        }
      } catch {}
      return null;
    })(),
    (async (): Promise<T | null> => {
      try {
        const bucket = getFirebaseBucket();
        if (!bucket) return null;
        const file = bucket.file(cloudKey);
        const [exists] = await file.exists();
        if (!exists) return null;
        const [buf] = await file.download();
        if (buf && buf.length > 2) {
          return JSON.parse(buf.toString('utf8')) as T;
        }
      } catch {}
      return null;
    })(),
  ]);

  return { s3Data, firebaseStorageData };
}

let cloudDbSyncTimer: any = null;
let cloudDbSyncInFlight: Promise<any> | null = null;

/**
 * Sube el estado maestro de la base de datos a AWS S3 y Firebase Storage Bucket.
 * Nunca satura cuotas porque sube 1 único objeto JSON en lugar de cientos de documentos.
 */
export async function syncMasterDatabaseToCloudVaults(
  db: DatabaseSchema,
  immediate = false
): Promise<{ s3Saved: boolean; firebaseStorageSaved: boolean }> {
  if (!db || !Array.isArray(db.expendios) || db.expendios.length < 50) {
    // Protección estricta: jamás sobrescribir la bóveda en la nube con una base vacía o truncada
    return { s3Saved: false, firebaseStorageSaved: false };
  }

  const executeUpload = async () => {
    const res = await syncJsonToCloudVaults(MASTER_DB_CLOUD_KEY, db, {
      revision: String(db.revision || 0),
      updatedAt: String(db.updatedAt || new Date().toISOString()),
      expendiosCount: String(db.expendios.length),
      historialCount: String((db.historial || []).length),
    });
    return res;
  };

  if (immediate) {
    if (cloudDbSyncTimer) {
      clearTimeout(cloudDbSyncTimer);
      cloudDbSyncTimer = null;
    }
    cloudDbSyncInFlight = executeUpload();
    return cloudDbSyncInFlight;
  }

  // Debounce corto (800ms) para agrupar ráfagas sin perder inmediatez
  if (cloudDbSyncTimer) clearTimeout(cloudDbSyncTimer);
  return new Promise((resolve) => {
    cloudDbSyncTimer = setTimeout(async () => {
      cloudDbSyncTimer = null;
      const result = await executeUpload();
      resolve(result);
    }, 800);
  });
}

/**
 * Guarda en disco de forma atómica en `database/camarca_master_db.json` y actualiza réplicas permanentes
 */
function persistDbToDisk(db: DatabaseSchema) {
  atomicWriteJsonSync(localMasterDbPath, db);
  atomicWriteJsonSync(legacyDbPath, db);
  try {
    atomicWriteJsonSync(masterPublishedDbPath, db);
  } catch (err) {
    console.warn('[dbStore] Error guardando réplica publicada en disco:', err);
  }

  // Verificar inmediatamente que database/camarca_master_db.json haya quedado escrito e íntegro
  const diskCheck = verifyWrittenMasterDatabaseOnDisk(
    Number(db.revision) || 0,
    Array.isArray(db.expendios) ? db.expendios.length : 0
  );
  if (!diskCheck.verified) {
    // Reintento inmediato de escritura atómica si hubiera habido contención de I/O
    atomicWriteJsonSync(localMasterDbPath, db);
  }

  // Auto-snapshot cada 5 minutos si hay cambios
  const now = Date.now();
  if (now - lastAutoBackupTime > 5 * 60 * 1000) {
    lastAutoBackupTime = now;
    createAutoSnapshot(db);
  }

  // Google Drive Webhook asynchronous sync if configured
  if (db.config?.googleDriveWebhookUrl && typeof fetch !== 'undefined') {
    triggerGoogleDriveWebhookAsync(db.config.googleDriveWebhookUrl, db).catch(() => {});
  }
}

async function triggerGoogleDriveWebhookAsync(webhookUrl: string, db: DatabaseSchema) {
  try {
    const payload = {
      filename: `CAMARCA_DB_${isPublishedEnv ? 'PUBLICADA' : 'TEST'}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      timestamp: new Date().toISOString(),
      ambiente: isPublishedEnv ? 'PUBLICADA' : 'TEST',
      totalExpendios: (db.expendios || []).length,
      totalHistorial: (db.historial || []).length,
      database: db,
    };
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Non-blocking background sync
  }
}

export function createAutoSnapshot(db: DatabaseSchema) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const snapPath = path.join(backupsDir, `snapshot-${timestamp}.json`);
    atomicWriteJsonSync(snapPath, db);

    const files = fs
      .readdirSync(backupsDir)
      .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length > 1) {
      files.slice(1).forEach((f) => {
        try {
          fs.unlinkSync(path.join(backupsDir, f));
        } catch {}
      });
    }
  } catch (err) {
    console.warn('[dbStore] Advertencia creando auto-snapshot local:', err);
  }
}

/**
 * Obtiene la base de datos actual en memoria con copia superficial rápida
 * (Cero consultas externas por lectura = 0 saturación de base de datos).
 */
export function getDatabase(): DatabaseSchema {
  if (!inMemoryDatabase) {
    inMemoryDatabase = readDbFromDisk();
  }
  return {
    ...inMemoryDatabase,
    expendios: [...(inMemoryDatabase.expendios || [])],
    historial: [...(inMemoryDatabase.historial || [])],
    trazabilidad: [...(inMemoryDatabase.trazabilidad || [])],
    cuentasCargadas: [...(inMemoryDatabase.cuentasCargadas || [])],
    relacionPagos: [...(inMemoryDatabase.relacionPagos || [])],
    config: { ...(inMemoryDatabase.config || {}) },
  };
}

/**
 * Obtiene referencia de solo lectura a la base de datos en memoria SIN clonar.
 */
export function getDatabaseReadOnly(): Readonly<DatabaseSchema> {
  if (!inMemoryDatabase) {
    inMemoryDatabase = readDbFromDisk();
  }
  return inMemoryDatabase;
}

/**
 * Alias de compatibilidad para código existente
 */
export function loadDatabase(): DatabaseSchema {
  return getDatabase();
}

export interface MutateDatabaseOptions extends PostgresMutationOptions {
  forceCloudSync?: boolean;
  immediateCloudSync?: boolean;
  skipCloudSync?: boolean;
  throwOnCloudError?: boolean;
  checkCloudFirst?: boolean;
  allowEmptyExpendios?: boolean;
}

/**
 * Mutación serializada y atómica:
 * 1. Valida el estado previo de la base de datos en memoria.
 * 2. Ejecuta mutación en memoria sobre borrador limpio.
 * 3. Ejecuta `verifyLocalDatabaseStateBeforeSave` para garantizar integridad de IDs, alias y referencias.
 * 4. Incrementa revisión global monótona.
 * 5. Persiste de forma atómica en `database/camarca_master_db.json` (disco local) y verifica la escritura.
 * 6. Sincroniza `database/camarca_master_db.json` en AWS S3 + Firebase Storage Bucket.
 */
export async function mutateDatabase<T>(
  mutator: (db: DatabaseSchema) => T | Promise<T>,
  options: MutateDatabaseOptions = {}
): Promise<T> {
  const executeMutationInTransaction = async (): Promise<T> => {
    if (!inMemoryDatabase) {
      inMemoryDatabase = readDbFromDisk();
    }

    // 1. Validar integridad del estado local ANTES de iniciar la mutación
    verifyLocalDatabaseStateBeforeSave(inMemoryDatabase, Boolean(options.allowEmptyExpendios));

    const draftDb: DatabaseSchema =
      typeof structuredClone === 'function'
        ? structuredClone(inMemoryDatabase)
        : JSON.parse(JSON.stringify(inMemoryDatabase));

    const expectedBaseRev = Number(draftDb.revision) || 0;

    // 2. Ejecutar la mutación sobre el borrador
    const result = await mutator(draftDb);

    // 3. Normalizar y deduplicar IDs antes de validar estado final pre-guardado
    const normalizedDraft = normalizeDatabase(draftDb);
    draftDb.expendios = normalizedDraft.expendios;
    draftDb.historial = normalizedDraft.historial;
    draftDb.relacionPagos = normalizedDraft.relacionPagos;
    draftDb.trazabilidad = normalizedDraft.trazabilidad;

    // 4. Validar estado e invariantes de dominio ANTES de confirmar y escribir en database/camarca_master_db.json
    const preSaveValidation = verifyLocalDatabaseStateBeforeSave(
      draftDb,
      Boolean(options.allowEmptyExpendios || draftDb.expendios.length === 0)
    );
    validateDatabaseInvariants(draftDb);

    // 5. Incrementar revisión global monótona y generar commitId
    const targetRevision = expectedBaseRev + 1;
    const commitId = `c_${targetRevision}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    draftDb.revision = targetRevision;
    (draftDb as any).commitId = commitId;
    draftDb.updatedAt = new Date().toISOString();
    if (draftDb.config) {
      draftDb.config.lastModified = draftDb.updatedAt;
    }

    // 6. Actualizar memoria y escribir atómicamente en database/camarca_master_db.json (disco local)
    inMemoryDatabase = normalizeDatabase(draftDb);
    persistDbToDisk(inMemoryDatabase);

    const diskVerification = verifyWrittenMasterDatabaseOnDisk(
      targetRevision,
      inMemoryDatabase.expendios.length
    );
    if (!diskVerification.verified) {
      throw new Error(
        `Error verificando escritura local en ${MASTER_DB_CLOUD_KEY}: revisión esperada ${targetRevision}, encontrada ${diskVerification.revisionOnDisk}.`
      );
    }

    // 7. Sincronizar a las bóvedas permanentes en la nube (AWS S3 + Firebase Storage -> database/camarca_master_db.json)
    if (!options.skipCloudSync) {
      const shouldWait = Boolean(options.immediateCloudSync || options.forceCloudSync);
      if (shouldWait) {
        await syncMasterDatabaseToCloudVaults(inMemoryDatabase, true);
      } else {
        syncMasterDatabaseToCloudVaults(inMemoryDatabase, false).catch(() => {});
      }
    }

    // 8. Registrar evento en outbox local
    const outboxEvent = enqueueOutboxEvent({
      commitId,
      revision: targetRevision,
      entityType: options.entityType || 'database_mutation',
      entityId: options.entityId || 'db_root',
      payload: {
        revision: targetRevision,
        commitId,
        updatedAt: inMemoryDatabase.updatedAt,
        masterFile: preSaveValidation.masterFilePath,
        expendiosCount: inMemoryDatabase.expendios.length,
      },
    });
    markOutboxEventConfirmed(outboxEvent.eventId, targetRevision, commitId);

    return result;
  };

  const currentPromise = mutationQueue.then(
    executeMutationInTransaction,
    executeMutationInTransaction
  );
  mutationQueue = currentPromise.catch(() => {});
  return currentPromise;
}

export async function saveDatabase(
  db: DatabaseSchema,
  options: MutateDatabaseOptions = {}
): Promise<DatabaseSchema> {
  return mutateDatabase(
    () => {
      inMemoryDatabase = normalizeDatabase(db);
      return inMemoryDatabase;
    },
    {
      immediateCloudSync: true,
      throwOnCloudError: false,
      ...options,
    }
  );
}

/**
 * Reemplazo directo en caliente (usado en arranque tras resolver timestamps)
 */
export function setAuthoritativeDatabase(db: DatabaseSchema, syncToCloud = false) {
  inMemoryDatabase = normalizeDatabase(db);
  persistDbToDisk(inMemoryDatabase);
  if (syncToCloud) {
    syncMasterDatabaseToCloudVaults(inMemoryDatabase, true).catch(() => {});
  }
}

// ==============================================================================
// 2. RECONCILIACIÓN Y FUSIÓN INTELIGENTE EN ARRANQUE (CERO PÉRDIDA DE DATOS)
// ==============================================================================

function countPhotosInExpendio(exp: any): number {
  if (!exp) return 0;
  let count = 0;
  for (const field of [
    'fotoAvisoUrl',
    'fotoPanoramicaUrl',
    'fotoMataselloUrl',
    'fotoBasculaUrl',
    'fotoContratistaUrl',
    'fotoHorarioUrl',
    'fotoTarifasUrl',
  ]) {
    if (exp[field] && String(exp[field]).trim().length > 5) count++;
  }
  return count;
}

/**
 * Fusiona dos snapshots de base de datos conservando SIEMPRE el registro más reciente
 * de cada expendio individual, además de unir historial, trazabilidad, cuentas y pagos.
 */
export function mergeDatabasesPreservingLatest(
  primaryDb: DatabaseSchema,
  secondaryDb: DatabaseSchema
): DatabaseSchema {
  const normPrimary = normalizeDatabase(primaryDb);
  const normSecondary = normalizeDatabase(secondaryDb);

  const primaryRev = Number(normPrimary.revision) || 0;
  const secondaryRev = Number(normSecondary.revision) || 0;
  const primaryTime = new Date(normPrimary.updatedAt || 0).getTime() || 0;
  const secondaryTime = new Date(normSecondary.updatedAt || 0).getTime() || 0;

  const isSecondaryNewerGlobal =
    secondaryRev > primaryRev || (secondaryRev === primaryRev && secondaryTime > primaryTime);

  const base = isSecondaryNewerGlobal ? normSecondary : normPrimary;
  const other = isSecondaryNewerGlobal ? normPrimary : normSecondary;

  // 1. Fusionar expendios por ID canónico inmutable (para soportar cambios de cédula sin duplicar el expendio)
  const expMap = new Map<string, ExpendioData>();
  const getKey = (e: ExpendioData) => {
    const cleanId = String(e.id || '').trim();
    if (cleanId) return `id_${cleanId}`;
    const cedDigits = String(e.cedula || '').replace(/\D/g, '');
    return cedDigits.length >= 4 ? `ced_${cedDigits}` : `loc_${String(e.localidad || e.municipio || '').trim().toUpperCase()}`;
  };

  for (const exp of other.expendios || []) {
    if (!exp) continue;
    expMap.set(getKey(exp), exp);
  }

  for (const exp of base.expendios || []) {
    if (!exp) continue;
    const key = getKey(exp);
    const existing = expMap.get(key);
    if (!existing) {
      expMap.set(key, exp);
    } else {
      const revBase = Number(exp.revision) || 0;
      const revOther = Number(existing.revision) || 0;
      const timeBase = new Date(exp.updatedAt || exp.fechaUltimaActualizacion || 0).getTime() || 0;
      const timeOther =
        new Date(existing.updatedAt || existing.fechaUltimaActualizacion || 0).getTime() || 0;
      const photosBase = countPhotosInExpendio(exp);
      const photosOther = countPhotosInExpendio(existing);

      let winner = exp;
      let loser = existing;
      if (
        revOther > revBase ||
        (revOther === revBase && timeOther > timeBase) ||
        (revOther === revBase && timeOther === timeBase && photosOther > photosBase)
      ) {
        winner = existing;
        loser = exp;
      }

      // Preservar URLs de fotos que existan en loser pero estén vacías en winner
      const mergedExp: any = { ...loser, ...winner };
      for (const field of PHOTO_URL_FIELDS) {
        if (!mergedExp[field] && (loser as any)[field]) {
          mergedExp[field] = (loser as any)[field];
        }
      }
      // Preservar historial de cédulas anteriores si la cédula fue modificada por el administrador
      const prevCeds = new Set<string>([
        ...(Array.isArray((winner as any).cedulasAnteriores) ? (winner as any).cedulasAnteriores : []),
        ...(Array.isArray((loser as any).cedulasAnteriores) ? (loser as any).cedulasAnteriores : []),
      ]);
      const loserCed = String(loser.cedula || '').trim();
      const winnerCed = String(winner.cedula || '').trim();
      if (loserCed && loserCed !== winnerCed) {
        prevCeds.add(loserCed);
      }
      if (prevCeds.size > 0) {
        mergedExp.cedulasAnteriores = Array.from(prevCeds);
      }
      expMap.set(key, mergedExp);
    }
  }

  // 2. Unir Historial sin duplicados
  const histMap = new Map<string, HistorialItem>();
  for (const h of [...(other.historial || []), ...(base.historial || [])]) {
    if (!h || !h.id) continue;
    histMap.set(h.id, h);
  }

  // 3. Unir Trazabilidad sin duplicados
  const trazMap = new Map<string, TrazabilidadExpendio>();
  for (const t of [...(other.trazabilidad || []), ...(base.trazabilidad || [])]) {
    if (!t || !t.id) continue;
    trazMap.set(t.id, t);
  }

  // 4. Unir Cuentas Cargadas
  const cuentasMap = new Map<string, any>();
  for (const c of [...(other.cuentasCargadas || []), ...(base.cuentasCargadas || [])]) {
    if (!c) continue;
    const key = c.id || `${c.cedula}_${c.periodo || ''}`;
    cuentasMap.set(key, c);
  }

  // 5. Unir Relación de Pagos
  const pagosMap = new Map<string, PagoRelacionItem>();
  for (const p of [...(other.relacionPagos || []), ...(base.relacionPagos || [])]) {
    if (!p) continue;
    const key = p.id || `${p.municipio}_${p.mes}_${p.anio}`;
    pagosMap.set(key, p);
  }

  return normalizeDatabase({
    expendios: Array.from(expMap.values()),
    historial: Array.from(histMap.values()),
    trazabilidad: Array.from(trazMap.values()),
    config: { ...(other.config || {}), ...(base.config || {}) },
    cuentasCargadas: Array.from(cuentasMap.values()),
    relacionPagos: Array.from(pagosMap.values()),
    visitasGenerales: Math.max(base.visitasGenerales || 0, other.visitasGenerales || 0),
    updatedAt:
      primaryTime >= secondaryTime
        ? normPrimary.updatedAt
        : normSecondary.updatedAt,
    revision: Math.max(primaryRev, secondaryRev),
  });
}

let isDbAvailableState: boolean = true;

export function isDatabaseAvailable(): boolean {
  return isDbAvailableState;
}

export function setDatabaseUnavailable(status: boolean): void {
  isDbAvailableState = !status;
}

export async function resolveStartupDatabase(
  cloudDbLoader?: (localDb: DatabaseSchema) => Promise<DatabaseSchema | null>,
  _cloudDbSaver?: (db: DatabaseSchema, opts?: { force?: boolean }) => Promise<any>
): Promise<DatabaseSchema> {
  console.log(
    '[Startup] Inicializando Bóveda Triple de Persistencia (AWS S3 + Firebase Storage + Disco Local)...'
  );
  let authoritativeDb = readDbFromDisk();
  isDbAvailableState = true;

  try {
    const { s3Data, firebaseStorageData } = await loadJsonFromCloudVaults<DatabaseSchema>(
      MASTER_DB_CLOUD_KEY
    );

    if (s3Data && Array.isArray(s3Data.expendios) && s3Data.expendios.length > 0) {
      console.log(
        `[Startup] ✓ Snapshot encontrado en AWS S3: rev=${s3Data.revision || 0}, expendios=${s3Data.expendios.length}, historial=${(s3Data.historial || []).length}`
      );
      authoritativeDb = mergeDatabasesPreservingLatest(authoritativeDb, s3Data);
    }

    if (
      firebaseStorageData &&
      Array.isArray(firebaseStorageData.expendios) &&
      firebaseStorageData.expendios.length > 0
    ) {
      console.log(
        `[Startup] ✓ Snapshot encontrado en Firebase Storage: rev=${firebaseStorageData.revision || 0}, expendios=${firebaseStorageData.expendios.length}, historial=${(firebaseStorageData.historial || []).length}`
      );
      authoritativeDb = mergeDatabasesPreservingLatest(authoritativeDb, firebaseStorageData);
    }

    if (cloudDbLoader) {
      const extraCloudDb = await cloudDbLoader(authoritativeDb).catch(() => null);
      if (
        extraCloudDb &&
        Array.isArray(extraCloudDb.expendios) &&
        extraCloudDb.expendios.length > 0
      ) {
        authoritativeDb = mergeDatabasesPreservingLatest(authoritativeDb, extraCloudDb);
      }
    }
  } catch (e: any) {
    console.warn('[Startup] Advertencia reconciliando bóvedas cloud:', e.message);
  }

  // Asegurar que la versión fusionada más completa quede tanto en disco como en AWS S3 y Firebase Storage
  setAuthoritativeDatabase(authoritativeDb, false);
  await syncMasterDatabaseToCloudVaults(authoritativeDb, true).catch(() => {});
  console.log(
    `[Startup] ✅ Base de datos lista y asegurada: ${authoritativeDb.expendios.length} expendios, ${authoritativeDb.historial.length} registros contables (Revisión #${authoritativeDb.revision || 0}).`
  );

  // Hidratar registros de acceso desde las bóvedas cloud
  hydrateAccessLogsFromCloudVaults().catch(() => {});

  return authoritativeDb;
}

// ==============================================================================
// 3. COLECCIÓN AISLADA DE REGISTROS DE ACCESO CON RESPALDO EN S3/STORAGE
// ==============================================================================

let accessLogsCache: RegistroAcceso[] | null = null;
let accessLogSaveTimeout: any = null;

function loadAccessLogsFromDisk(): RegistroAcceso[] {
  if (fs.existsSync(accessLogPath)) {
    try {
      const raw = fs.readFileSync(accessLogPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const seenIds = new Set<string>();
        const deduped: RegistroAcceso[] = [];
        for (const r of parsed) {
          if (!r || !r.id || r.id.startsWith('acc-init-')) continue;
          if (!seenIds.has(r.id)) {
            seenIds.add(r.id);
            deduped.push(r);
          }
        }
        return deduped;
      }
    } catch (e) {
      console.warn('[accessStore] Error leyendo registros_acceso.json:', e);
    }
  }
  return [];
}

export async function hydrateAccessLogsFromCloudVaults(): Promise<void> {
  try {
    const localLogs = loadAccessLogsFromDisk();
    const { s3Data, firebaseStorageData } = await loadJsonFromCloudVaults<RegistroAcceso[]>(
      ACCESS_LOGS_CLOUD_KEY
    );
    const combined = [
      ...localLogs,
      ...(Array.isArray(s3Data) ? s3Data : []),
      ...(Array.isArray(firebaseStorageData) ? firebaseStorageData : []),
    ];
    const seen = new Set<string>();
    const deduped: RegistroAcceso[] = [];
    for (const r of combined) {
      if (!r || !r.id || r.id.startsWith('acc-init-')) continue;
      if (!seen.has(r.id)) {
        seen.add(r.id);
        deduped.push(r);
      }
    }
    deduped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    accessLogsCache = deduped.slice(0, 2000);
    atomicWriteJsonSync(accessLogPath, accessLogsCache);
  } catch {}
}

export function getRegistrosAcceso(): RegistroAcceso[] {
  if (!accessLogsCache) {
    accessLogsCache = loadAccessLogsFromDisk();
  }
  return [...accessLogsCache];
}

export function addRegistroAcceso(nuevoRegistro: RegistroAcceso) {
  if (!accessLogsCache) {
    accessLogsCache = loadAccessLogsFromDisk();
  }

  const existingIdx = accessLogsCache.findIndex((r) => r.id === nuevoRegistro.id);
  if (existingIdx !== -1) {
    accessLogsCache[existingIdx] = {
      ...accessLogsCache[existingIdx],
      ...nuevoRegistro,
    };
  } else {
    accessLogsCache.unshift(nuevoRegistro);
  }

  if (accessLogsCache.length > 2000) {
    accessLogsCache = accessLogsCache.slice(0, 2000);
  }

  // Guardado diferido (debounced) en su propio archivo y en S3/Firebase Storage para no saturar I/O
  if (accessLogSaveTimeout) clearTimeout(accessLogSaveTimeout);
  accessLogSaveTimeout = setTimeout(() => {
    try {
      atomicWriteJsonSync(accessLogPath, accessLogsCache);
      syncJsonToCloudVaults(ACCESS_LOGS_CLOUD_KEY, accessLogsCache).catch(() => {});
    } catch (err) {
      console.warn('[accessStore] Error guardando registros de acceso:', err);
    }
  }, 2000);
}

export function clearRegistrosAcceso(): void {
  accessLogsCache = [];
  try {
    atomicWriteJsonSync(accessLogPath, []);
    syncJsonToCloudVaults(ACCESS_LOGS_CLOUD_KEY, []).catch(() => {});
  } catch (err) {
    console.warn('[accessStore] Error limpiando registros de acceso:', err);
  }
}
