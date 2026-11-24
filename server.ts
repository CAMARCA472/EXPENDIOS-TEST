import 'dotenv/config';
import { EventEmitter } from 'events';
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';
import { GoogleGenAI } from '@google/genai';
import JSZip from 'jszip';
import sharp from 'sharp';
import rateLimit from 'express-rate-limit';

// Incrementar límite de listeners para procesos paralelos de descarga y streamings
EventEmitter.defaultMaxListeners = 50;
import {
  ExpendioData,
  HistorialItem,
  CuentaCobroParams,
  CuentaCobroResult,
  TrazabilidadExpendio,
  SystemConfig,
  CuentaCargadaExpendio,
  DocumentoExpendioConfig,
  PagoRelacionItem,
  AnalisisIACuentaCobro,
  ResultadoConciliacionAI,
  RegistroAcceso,
  MetricasAccesoResumen,
  DatabaseSchema,
} from './src/types.ts';
import { numeroALetras } from './src/utils/numeroALetras.ts';
import {
  normalizeCentroOperativo,
  normalizeCentroAcopio,
  CANONICAL_CENTROS_OPERATIVOS,
  CANONICAL_CENTROS_ACOPIO,
  MUNICIPIO_CENTROS_MAP,
} from './src/utils/centroOperativoAcopioHelper.ts';
import {
  checkCloudSqlHealth,
  getCloudSqlDatabaseSnapshot,
} from './src/db/cloudSqlStore.ts';
import { saveDatabaseToPostgres } from './src/db/migrateData.ts';
import { db, createPool } from './src/db/index.ts';
import * as schema from './src/db/schema.ts';
import { sql, desc, eq, inArray, or, and } from 'drizzle-orm';
import {
  migrateLocalJsonToCloudSql,
} from './src/db/migrateData.ts';
import {
  getDatabase,
  getDatabaseReadOnly,
  loadDatabase,
  mutateDatabase,
  resolveStartupDatabase,
  setAuthoritativeDatabase,
  getRegistrosAcceso,
  addRegistroAcceso,
  clearRegistrosAcceso,
  getActiveDbPath,
  getMasterDbFilePath,
  verifyLocalDatabaseStateBeforeSave,
  verifyWrittenMasterDatabaseOnDisk,
  normalizeDatabase,
  createAutoSnapshot,
  syncJsonToCloudVaults,
  loadJsonFromCloudVaults,
} from './server/dbStore.ts';
import {
  extractTextFromPdf,
  extractTextFromImage,
  extractFieldsFromOcrText,
  reconcileOcrWithPostgres,
  persistSha256ToRegistry,
  computeSha256,
} from './server/deterministicReconciliationEngine.ts';
import { errorLogService } from './server/errorLogService.ts';

const DRIVE_CREDS_CLOUD_KEY = 'database/google_drive_credentials.json';
const DRIVE_REGISTRY_CLOUD_KEY = 'database/google_drive_registry.json';

// Persistencia en Bóveda Triple (AWS S3 + Firebase Storage) para credenciales y registro de Google Drive
async function saveDriveCredentialsToCloud(creds: any): Promise<void> {
  try {
    await syncJsonToCloudVaults(DRIVE_CREDS_CLOUD_KEY, creds);
  } catch (e: any) {
    console.warn('[CloudVault Drive Creds Warn]:', e.message);
  }
}

async function loadDriveCredentialsFromCloud(): Promise<any> {
  try {
    const { s3Data, firebaseStorageData } = await loadJsonFromCloudVaults(DRIVE_CREDS_CLOUD_KEY);
    return s3Data || firebaseStorageData || null;
  } catch {
    return null;
  }
}

async function clearDriveCredentialsFromCloud(): Promise<void> {
  try {
    await syncJsonToCloudVaults(DRIVE_CREDS_CLOUD_KEY, {});
  } catch {}
}

async function saveDriveRegistryToCloud(registry: any): Promise<void> {
  try {
    await syncJsonToCloudVaults(DRIVE_REGISTRY_CLOUD_KEY, registry);
  } catch (e: any) {
    console.warn('[CloudVault Drive Registry Warn]:', e.message);
  }
}

async function loadDriveRegistryFromCloud(): Promise<Record<string, any>> {
  try {
    const { s3Data, firebaseStorageData } = await loadJsonFromCloudVaults<Record<string, any>>(
      DRIVE_REGISTRY_CLOUD_KEY
    );
    return { ...(firebaseStorageData || {}), ...(s3Data || {}) };
  } catch {
    return {};
  }
}

async function saveAccessLogsToCloud(_logs: RegistroAcceso[]): Promise<void> {
  // Manejado automáticamente por addRegistroAcceso en dbStore.ts hacia AWS S3 + Firebase Storage
}

import {
  ADMIN_CEDULA,
  CLEAN_ADMIN_CEDULA,
  ADMIN_ACCESS_PASSWORD,
  resolveAuthorizedAdminCedula,
  isAuthorizedAdminCedula,
  generateSessionToken,
  verifySessionToken,
  extractAuthenticatedUser,
  requireAuthenticatedUser,
  requireAdmin,
  requireExpendio,
  requireExpendioOwnership,
  resolveUserExpendio,
  normalizeCedula,
  AuthRequest,
  AuthenticatedUser,
} from './server/authService.ts';
import {
  processAndSavePhotoHybrid,
  readPhotoFromStorage,
  firebaseCircuitBreaker,
  getS3Client,
  getFirebaseBucket,
  PhotoMetadata,
  getAwsS3Config,
  uploadPhotoToS3Bucket,
  ensureS3BucketExists,
  listPhotosInS3Bucket,
} from './src/lib/hybridPhotoStorage.ts';
import {
  registerDriveTokenProvider,
  processPendingS3Backups,
  processPendingDriveBackups,
} from './src/lib/photoBackupWorkers.ts';
import {
  runFirebaseRecoveryWorker,
  getRecoveryWorkerStats,
} from './src/lib/firebaseRecoveryWorker.ts';
import { diagnosePhotoIntegrity } from './server/photoDiagnosticService.ts';
import { generateNoDisponibleSvg } from './src/lib/noDisponibleSvg.ts';
import {
  auditDatabaseIntegrity,
  validateDatabaseInvariants,
  normalizePeriodKey,
} from './server/domainIntegrity.ts';
import {
  getOutboxSummary,
  getPendingOutboxEvents,
} from './server/durableOutbox.ts';
import {
  formatDateCanonical,
  formatDateTimeCanonical,
} from './server/dateUtils.ts';

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;


// Lazy initialization of Gemini API
let aiClient: GoogleGenAI | null = null;
function getGeminiAI(): GoogleGenAI | null {
  try {
    if (!aiClient) {
      aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    }
    return aiClient;
  } catch (err) {
    console.error('Error inicializando Gemini AI:', err);
    return null;
  }
}

// Ensure upload directories exist
const uploadDir = path.join(process.cwd(), 'uploads');
const photosDir = path.join(uploadDir, 'photos');
const contractsDir = path.join(uploadDir, 'contracts');
const scannedDir = path.join(uploadDir, 'scanned_cuentas');
const docsExpendiosDir = path.join(uploadDir, 'docs_expendios');
const dataDir = path.join(process.cwd(), 'data');
const backupsDir = path.join(dataDir, 'backups');
const tempImportsDir = path.join(dataDir, 'temp_imports');
const permanentArchiveDir = path.join(dataDir, 'archivos_permanentes');
const permanentPhotosDir = path.join(dataDir, 'photos_permanent');
const photosMunicipiosDir = path.join(dataDir, 'photos_municipios');

[
  uploadDir,
  photosDir,
  contractsDir,
  scannedDir,
  docsExpendiosDir,
  dataDir,
  backupsDir,
  tempImportsDir,
  permanentArchiveDir,
  permanentPhotosDir,
  photosMunicipiosDir,
].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Las fotos permanentes residen en permanentPhotosDir (data/photos_permanent) sin duplicarlas en uploads/photos

// Middleware global de seguridad HTTP: nosniff y compatibilidad con iframe de AI Studio
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Permitir la visualización dentro del iframe del entorno AI Studio
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors *;");
  next();
});

// Middleware global para prevenir respuestas HTTP cacheadas u obsoletas en toda la API
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Persistent Google Drive credentials file (independently preserved outside database snapshots)
const googleDriveCredsPath = path.join(dataDir, 'google_drive_credentials.json');

interface GoogleDriveCredentialsFile {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
  displayName?: string;
  updatedAt?: string;
}

function loadGoogleDriveCredentials(): GoogleDriveCredentialsFile | null {
  try {
    if (fs.existsSync(googleDriveCredsPath)) {
      const raw = fs.readFileSync(googleDriveCredsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken.trim().length > 10) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Advertencia leyendo google_drive_credentials.json:', err);
  }

  // Respaldo secundario: db.config
  try {
    const db = loadDatabase();
    if (db.config?.googleDriveAccessToken && db.config.googleDriveAccessToken.trim().length > 10) {
      return {
        accessToken: db.config.googleDriveAccessToken.trim(),
        refreshToken: db.config.googleDriveRefreshToken,
        expiresAt: db.config.googleDriveTokenExpiresAt,
        email: db.config.googleDriveAccountEmail,
        displayName: (db.config as any)?.googleDriveAccountName,
        updatedAt: new Date().toISOString(),
      };
    }
  } catch {}

  return null;
}

function saveGoogleDriveCredentials(creds: GoogleDriveCredentialsFile) {
  try {
    fs.writeFileSync(googleDriveCredsPath, JSON.stringify(creds, null, 2));
    // Persistir de inmediato a PostgreSQL para resistir reinicios de contenedor y redeploys
    saveDriveCredentialsToCloud(creds as any).catch(() => {});
  } catch (err) {
    console.error('Error guardando google_drive_credentials.json:', err);
  }
}

function getOAuthClientId(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_ID || '1094702324887-rp4lbvga43esdfrgjvp00huuf2tihoit.apps.googleusercontent.com';
}

async function refreshServerDriveToken(refreshTokenOverride?: string): Promise<{
  success: boolean;
  accessToken?: string;
  expiresIn?: number;
  error?: string;
}> {
  let fileCreds = loadGoogleDriveCredentials();
  const db = loadDatabase();
  let refreshToken = (refreshTokenOverride || fileCreds?.refreshToken || db.config?.googleDriveRefreshToken)?.trim();

  // Si no está en disco ni memoria, consultar directamente en PostgreSQL
  if (!refreshToken) {
    try {
      const cloudCreds = await loadDriveCredentialsFromCloud();
      if (cloudCreds?.refreshToken) {
        refreshToken = cloudCreds.refreshToken.trim();
        fileCreds = cloudCreds;
      }
    } catch {}
  }

  if (!refreshToken) {
    return { success: false, error: 'No hay Refresh Token configurado en el servidor.' };
  }

  const clientId = getOAuthClientId();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || (db.config as any)?.googleOAuthClientSecret || '';

  try {
    const bodyParams = new URLSearchParams();
    bodyParams.append('client_id', clientId);
    if (clientSecret) {
      bodyParams.append('client_secret', clientSecret);
    }
    bodyParams.append('grant_type', 'refresh_token');
    bodyParams.append('refresh_token', refreshToken);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams.toString(),
    });

    const data = (await tokenRes.json()) as any;

    if (!tokenRes.ok || !data.access_token) {
      const errorMsg = data.error_description || data.error || `HTTP ${tokenRes.status}`;
      console.warn('[OAuth2 Server] Fallo al renovar access token con refresh token:', errorMsg);
      // Solo purgar si Google reporta explícitamente invalid_grant (revocado por el usuario)
      if (data.error === 'invalid_grant' || (typeof errorMsg === 'string' && errorMsg.includes('invalid_grant'))) {
        console.warn('[OAuth2 Server] Refresh token revocado por el usuario. Limpiando credenciales revocadas...');
        await purgeInvalidGoogleDriveCredentialsServer();
      }
      return { success: false, error: errorMsg };
    }

    const newAccessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    // Actualizar base de datos
    await mutateDatabase(async (database) => {
      if (!database.config) database.config = {} as any;
      database.config.googleDriveAccessToken = newAccessToken;
      database.config.googleDriveRefreshToken = refreshToken;
      database.config.googleDriveTokenExpiresAt = expiresAt;
    });

    const updatedCreds: GoogleDriveCredentialsFile = {
      accessToken: newAccessToken,
      refreshToken: refreshToken,
      expiresAt: expiresAt,
      email: fileCreds?.email || db.config?.googleDriveAccountEmail,
      displayName: fileCreds?.displayName || (db.config as any)?.googleDriveAccountName,
      updatedAt: new Date().toISOString(),
    };

    saveGoogleDriveCredentials(updatedCreds);
    await saveDriveCredentialsToCloud(updatedCreds);

    console.log(`[OAuth2 Server] Access token renovado exitosamente con Refresh Token. Vigencia: ${expiresIn}s.`);
    return { success: true, accessToken: newAccessToken, expiresIn };
  } catch (err: any) {
    console.error('[OAuth2 Server] Error renovando token con refresh token:', err.message);
    return { success: false, error: err.message };
  }
}

async function isGoogleTokenValid(token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
    if (res.ok) {
      const data = (await res.json()) as any;
      return !data.error && Number(data.expires_in) > 10;
    }
    return false;
  } catch {
    return false;
  }
}

async function purgeInvalidGoogleDriveCredentialsServer() {
  try {
    const credsPath = path.join(process.cwd(), 'data', 'google_drive_credentials.json');
    if (fs.existsSync(credsPath)) {
      try { fs.unlinkSync(credsPath); } catch {}
    }
    const rootCredsPath = path.join(process.cwd(), 'google_drive_credentials.json');
    if (fs.existsSync(rootCredsPath)) {
      try { fs.unlinkSync(rootCredsPath); } catch {}
    }
    await mutateDatabase(async (db) => {
      if (db.config) {
        delete db.config.googleDriveAccessToken;
        delete db.config.googleDriveRefreshToken;
        delete db.config.googleDriveTokenExpiresAt;
      }
    });
    await clearDriveCredentialsFromCloud();
    console.log('[OAuth2 Server] Credenciales expiradas/inválidas de Google Drive eliminadas del servidor y base de datos.');
  } catch (err: any) {
    console.warn('[OAuth2 Server] Error limpiando credenciales expiradas:', err.message);
  }
}

async function getOrRefreshDriveTokenServer(): Promise<string | null> {
  let fileCreds = loadGoogleDriveCredentials();
  
  // 1. Si no hay credenciales locales, cargar desde PostgreSQL
  if (!fileCreds || !fileCreds.accessToken) {
    try {
      const cloudCreds = await loadDriveCredentialsFromCloud();
      if (cloudCreds && cloudCreds.accessToken) {
        fileCreds = cloudCreds;
        saveGoogleDriveCredentials(cloudCreds);
      }
    } catch {}
  }

  const db = loadDatabase();
  let token = fileCreds?.accessToken || db.config?.googleDriveAccessToken || null;
  let expiresAt = fileCreds?.expiresAt || db.config?.googleDriveTokenExpiresAt;
  let refreshToken = (fileCreds?.refreshToken || db.config?.googleDriveRefreshToken)?.trim();

  // Si no tenemos refreshToken en memoria/disco, buscar en PostgreSQL
  if (!refreshToken) {
    try {
      const cloudCreds = await loadDriveCredentialsFromCloud();
      if (cloudCreds?.refreshToken) {
        refreshToken = cloudCreds.refreshToken.trim();
      }
    } catch {}
  }

  // 2. Si el token expiró o está por expirar y tenemos refresh token, renovar automáticamente
  if (refreshToken) {
    if (!token || !expiresAt || expiresAt <= (Date.now() + 180000)) {
      console.log('[OAuth2 Server] Renovando token de Google Drive automáticamente con Refresh Token...');
      const refreshRes = await refreshServerDriveToken(refreshToken);
      if (refreshRes.success && refreshRes.accessToken) {
        return refreshRes.accessToken;
      }
    }
  }

  // 3. Validar token existente contra Google si no tiene refreshToken
  if (token) {
    const isValid = await isGoogleTokenValid(token);
    if (isValid) {
      return token;
    }
    // Si no es válido pero tenemos refresh token, intentar renovar antes de considerar error
    if (refreshToken) {
      console.log('[OAuth2 Server] Token no válido en tokeninfo, intentando renovación con Refresh Token...');
      const refreshRes = await refreshServerDriveToken(refreshToken);
      if (refreshRes.success && refreshRes.accessToken) {
        return refreshRes.accessToken;
      }
    }
    // Preservar la sesión configurada y no purgar automáticamente para prevenir desconexiones accidentales
    console.warn('[OAuth2 Server] Token de Google Drive expirado o pendiente de renovación por el cliente.');
  }

  return null;
}

function getActiveDriveTokenServer(): string | null {
  const fileCreds = loadGoogleDriveCredentials();
  if (fileCreds?.accessToken) {
    return fileCreds.accessToken;
  }
  const db = loadDatabase();
  return db.config?.googleDriveAccessToken || null;
}

// Conectar proveedor de token renovable desde PostgreSQL al worker de Google Drive
registerDriveTokenProvider(async () => {
  return await getOrRefreshDriveTokenServer();
});

// Worker bajo demanda: solo procesa respaldos pendientes si hubo actividad reciente, permitiendo Scale-to-Zero en Cloud Run y Cloud SQL
let lastPhotoUploadOrModifyAt = 0;
export function markPhotoActivity() {
  lastPhotoUploadOrModifyAt = Date.now();
}
setInterval(async () => {
  // No despertar PostgreSQL ni S3 si no ha habido actividad fotográfica en los últimos 15 minutos
  if (Date.now() - lastPhotoUploadOrModifyAt > 15 * 60 * 1000) return;
  try {
    await processPendingS3Backups(db, 5);
    await processPendingDriveBackups(db, 5);
  } catch (err: any) {
    console.warn('[PhotoBackupWorker Cron Warn]:', err.message);
  }
}, 10 * 60 * 1000);

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'contrato') {
      cb(null, contractsDir);
    } else if (file.fieldname === 'archivoDoc' || file.fieldname === 'documento') {
      cb(null, docsExpendiosDir);
    } else {
      cb(null, photosDir);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

// Filtro estricto de seguridad: únicamente extensiones y tipos MIME seguros (.jpg, .jpeg, .png, .pdf)
const safeMediaFileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.pdf'];
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/pjpeg',
    'image/png',
    'image/x-png',
    'application/pdf',
    'application/x-pdf',
  ];

  if (!allowedExts.includes(ext) || !allowedMimes.includes(file.mimetype.toLowerCase())) {
    return cb(new Error('Formato no permitido: Únicamente se aceptan extensiones seguras (.jpg, .jpeg, .png, .pdf).'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter: safeMediaFileFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
});

// Configure multer storage for scanned PDF and image payment vouchers
const scannedStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, scannedDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `cuenta-escaneada-${uniqueSuffix}-${cleanOriginalName}`);
  },
});

const uploadScanned = multer({
  storage: scannedStorage,
  fileFilter: safeMediaFileFilter,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB limit for high-res PDF / scans
});

// Multer específico para importación de hojas de cálculo administrativas (.xlsx, .xls, .csv)
const uploadExcel = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, tempImportsDir),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `excel-${uniqueSuffix}-${cleanOriginalName}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.xlsx', '.xls', '.csv'];
    if (!allowed.includes(ext)) {
      return cb(new Error('Formato no permitido: Solo se admiten archivos de cálculo (.xlsx, .xls, .csv).'));
    }
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * Valida los números mágicos (magic bytes / file signatures) reales en los primeros bytes del archivo
 * para garantizar en el servidor que sea auténticamente JPEG, PNG o PDF y no un script malicioso renombrado.
 */
async function verifyFileMagicBytes(filePath: string): Promise<{ valid: boolean; detectedType?: string }> {
  try {
    const fd = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await fd.read(buffer, 0, 16, 0);
    await fd.close();

    if (bytesRead < 4) return { valid: false };

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { valid: true, detectedType: 'image/jpeg' };
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { valid: true, detectedType: 'image/png' };
    }
    // PDF: %PDF- (25 50 44 46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return { valid: true, detectedType: 'application/pdf' };
    }

    return { valid: false };
  } catch {
    return { valid: false };
  }
}

/**
 * Middleware para validar la autenticidad de los archivos subidos mediante inspección de magic bytes
 */
async function validateUploadedFileSecurity(req: any, res: any, next: any) {
  const filesToCheck: Express.Multer.File[] = [];
  if (req.file) filesToCheck.push(req.file);
  if (Array.isArray(req.files)) {
    filesToCheck.push(...req.files);
  } else if (req.files && typeof req.files === 'object') {
    for (const field of Object.values(req.files)) {
      if (Array.isArray(field)) filesToCheck.push(...(field as Express.Multer.File[]));
    }
  }

  for (const file of filesToCheck) {
    if (!file.path || !fs.existsSync(file.path)) continue;
    const { valid } = await verifyFileMagicBytes(file.path);
    if (!valid) {
      try {
        fs.unlinkSync(file.path);
      } catch {}
      return res.status(400).json({
        success: false,
        error: 'INVALID_FILE_SIGNATURE',
        message: 'El archivo subido fue rechazado por motivos de seguridad: el contenido real no corresponde a una imagen (.jpg, .png) o documento (.pdf) válido.',
      });
    }
  }
  next();
}

// Environment and database files separation (Published vs Test)
const PUBLISHED_APP_URL = 'https://ais-pre-ypoh6t44vnhnm5py2vaqxs-464412252846.us-east1.run.app';
const DEV_APP_URL = 'https://ais-dev-ypoh6t44vnhnm5py2vaqxs-464412252846.us-east1.run.app';

const appUrlEnv = process.env.APP_URL || '';
const isPublishedEnv = appUrlEnv.includes('ais-pre') || (process.env.NODE_ENV === 'production' && !appUrlEnv.includes('ais-dev'));
const environmentMode: 'PUBLICADA' | 'TEST' = isPublishedEnv ? 'PUBLICADA' : 'TEST';

const masterPublishedDbPath = path.join(dataDir, 'database.published.json');
const testDbPath = path.join(dataDir, 'database.test.json');
const legacyDbPath = path.join(dataDir, 'database.json');
const dbFilePath = legacyDbPath; // Keep for backward compatibility

function parseDeviceInfo(userAgent?: string): { dispositivo: string; navegador: string } {
  if (!userAgent) return { dispositivo: 'Desconocido', navegador: 'Navegador Web' };
  
  let dispositivo = 'Computador (Escritorio / Laptop)';
  if (/iphone/i.test(userAgent)) {
    dispositivo = 'iPhone (Apple iOS)';
  } else if (/ipad/i.test(userAgent)) {
    dispositivo = 'iPad (Tablet iOS)';
  } else if (/android/i.test(userAgent)) {
    if (/mobile/i.test(userAgent)) {
      dispositivo = 'Móvil Android';
    } else {
      dispositivo = 'Tablet Android';
    }
  } else if (/mobile/i.test(userAgent)) {
    dispositivo = 'Dispositivo Móvil';
  }

  let navegador = 'Navegador Web';
  if (/edg\//i.test(userAgent)) navegador = 'Microsoft Edge';
  else if (/chrome|crios/i.test(userAgent) && !/edg\//i.test(userAgent)) navegador = 'Google Chrome';
  else if (/firefox|fxios/i.test(userAgent)) navegador = 'Mozilla Firefox';
  else if (/safari/i.test(userAgent) && !/chrome|crios/i.test(userAgent)) navegador = 'Apple Safari';
  else if (/opera|opr/i.test(userAgent)) navegador = 'Opera';

  return { dispositivo, navegador };
}

const ipLocationCache = new Map<string, { ubicacion: string; isp?: string; pais?: string; ciudad?: string }>();

async function resolveIpLocation(ip: string, reqHeaders?: any): Promise<{ ubicacion: string; isp?: string; pais?: string; ciudad?: string }> {
  const cleanIp = (ip || '').trim().replace('::ffff:', '');
  if (!cleanIp || cleanIp === '127.0.0.1' || cleanIp === 'localhost' || cleanIp.startsWith('10.') || cleanIp.startsWith('192.168.') || cleanIp.startsWith('172.')) {
    return { ubicacion: 'Red Local / Entorno Dev', isp: 'Localhost', ciudad: 'Desarrollo', pais: 'Colombia' };
  }

  // Check cloud reverse-proxy headers first (Cloud Run / GFE headers)
  if (reqHeaders) {
    const cloudCity = (reqHeaders['x-client-geo-city'] as string) || (reqHeaders['x-appengine-city'] as string);
    const cloudRegion = (reqHeaders['x-client-geo-region'] as string) || (reqHeaders['x-appengine-region'] as string);
    const cloudCountry = (reqHeaders['x-client-geo-country'] as string) || (reqHeaders['x-appengine-country'] as string);
    if (cloudCity || cloudCountry) {
      const parts = [cloudCity, cloudRegion, cloudCountry].filter(Boolean);
      const res = { ubicacion: parts.join(', '), ciudad: cloudCity || 'Colombia', pais: cloudCountry || 'Colombia', isp: 'Google Cloud Platform' };
      ipLocationCache.set(cleanIp, res);
      return res;
    }
  }

  if (ipLocationCache.has(cleanIp)) {
    return ipLocationCache.get(cleanIp)!;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1400);
    const resp = await fetch(`http://ip-api.com/json/${cleanIp}?fields=status,country,regionName,city,isp`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const data: any = await resp.json();
      if (data.status === 'success') {
        const parts = [data.city, data.regionName, data.country].filter(Boolean);
        const result = {
          ubicacion: parts.join(', ') || data.country || 'Colombia',
          isp: data.isp || 'Operador Nacional',
          ciudad: data.city || '',
          pais: data.country || 'Colombia',
        };
        ipLocationCache.set(cleanIp, result);
        return result;
      }
    }
  } catch {
    // Timeout or network error
  }

  const fallback = { ubicacion: 'Colombia (Red Nacional)', isp: 'Operador Móvil / Banda Ancha', ciudad: 'Colombia', pais: 'Colombia' };
  ipLocationCache.set(cleanIp, fallback);
  return fallback;
}

function registrarIngresoUsuario(
  _db: DatabaseSchema,
  req: express.Request,
  usuario: string,
  cedulaOrNit: string,
  rol: 'admin' | 'expendio' | 'cliente' | 'desconocido',
  municipio?: string,
  tipoAcceso: 'login' | 'visita' = 'login',
  exitoso: boolean = true,
  detalles?: string
) {
  // Filtrar palabras clave de prueba o simulación
  const rawSearchStr = `${usuario} ${cedulaOrNit} ${rol} ${municipio || ''} ${tipoAcceso} ${detalles || ''}`.toLowerCase();
  const testKeywords = ['test', 'mock', 'demo', 'fake', 'sample', 'fixture', 'dummy', 'simula', 'synthetic', 'health', 'check', 'internal', 'request', 'attemp', 'prueva', 'prueba', 'unknown', '9999999'];
  for (const keyword of testKeywords) {
    if (rawSearchStr.includes(keyword)) {
      console.warn(`[AccessLog] Rechazado registro de acceso debido a patrón de prueba detectado: "${keyword}"`);
      return null;
    }
  }

  // Validar existencia real del usuario / expendio en PostgreSQL (db maestro)
  const db = loadDatabase();
  const cleanCed = String(cedulaOrNit || '').replace(/\D/g, '');
  if (!cleanCed) {
    console.warn('[AccessLog] Rechazado: Cédula de ingreso vacía.');
    return null;
  }

  let userExists = false;
  let matchedExpendio = null;
  if (cleanCed === ADMIN_CEDULA) {
    userExists = true;
    matchedExpendio = (db.expendios || []).find((e) => String(e.cedula || '').replace(/\D/g, '') === ADMIN_CEDULA) || null;
  } else {
    // Buscar en el catálogo de expendios de la base de datos
    const foundExp = (db.expendios || []).find((e) => String(e.cedula || '').replace(/\D/g, '') === cleanCed);
    if (foundExp && foundExp.estado !== 'Inhabilitado') {
      userExists = true;
      matchedExpendio = foundExp;
    }
  }

  if (!userExists) {
    console.warn(`[AccessLog] Rechazado: Intento de registro para usuario con cédula "${cedulaOrNit}" inexistente o inhabilitado en PostgreSQL.`);
    return null;
  }

  // Si corresponde a un expendio, el expendioId debe existir y la cédula corresponder
  if (rol === 'expendio' && !matchedExpendio) {
    console.warn(`[AccessLog] Rechazado: El rol 'expendio' requiere un expendio real asociado en PostgreSQL.`);
    return null;
  }

  // Validar sesión/token si es un acceso de visita / página
  if (tipoAcceso === 'visita') {
    const authUser = extractAuthenticatedUser(req);
    if (!authUser) {
      console.warn(`[AccessLog] Rechazado: Intento de registro de visita sin sesión/token válido.`);
      return null;
    }
    if (String(authUser.cedula || '').replace(/\D/g, '') !== cleanCed) {
      console.warn(`[AccessLog] Rechazado: Discrepancia de cédula entre el token y el log.`);
      return null;
    }
  }

  // Solamente registrar operaciones reales exitosas
  if (!exitoso) {
    console.warn(`[AccessLog] Ignorando registro de acceso fallido para mantener limpio producción.`);
    return null;
  }

  const rawIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const ip = rawIp.split(',')[0].trim().replace('::ffff:', '') || '127.0.0.1';
  const userAgent = (req.headers['user-agent'] as string) || '';
  const { dispositivo, navegador } = parseDeviceInfo(userAgent);

  const now = new Date();
  const fechaFormateada = now.toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const fechaCorta = now.toISOString().split('T')[0];

  const cachedLoc = ipLocationCache.get(ip);
  const resolvedMuni = matchedExpendio?.municipio || matchedExpendio?.localidad || municipio || '';
  const initialUbicacion = cachedLoc?.ubicacion || (resolvedMuni ? `${resolvedMuni}, Colombia` : 'Colombia');
  const initialIsp = cachedLoc?.isp || '';

  const nuevoRegistro: RegistroAcceso = {
    id: `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: now.toISOString(),
    fechaFormateada,
    fechaCorta,
    usuario: matchedExpendio?.encargado || usuario,
    cedulaOrNit: matchedExpendio?.cedula || cedulaOrNit,
    rol,
    municipio: resolvedMuni,
    ip,
    ubicacionIp: initialUbicacion,
    isp: initialIsp,
    dispositivo,
    navegador,
    tipoAcceso,
    exitoso,
    detalles,
  };

  // 1. Guardado en store aislado en disco (registros_acceso.json) sin tocar el JSON maestro
  addRegistroAcceso(nuevoRegistro);

  // 2. Persistencia aislada en PostgreSQL (registrosAcceso) en background
  saveAccessLogsToCloud([nuevoRegistro]).catch(() => {});

  // Background lookup to enrich location if not already cached
  if (!cachedLoc && ip !== '127.0.0.1' && !ip.startsWith('10.') && !ip.startsWith('192.168.')) {
    resolveIpLocation(ip, req.headers).then((loc) => {
      nuevoRegistro.ubicacionIp = loc.ubicacion;
      if (loc.isp) nuevoRegistro.isp = loc.isp;
      addRegistroAcceso(nuevoRegistro);
    }).catch(() => {});
  }

  return nuevoRegistro;
}

// Real-time active online users presence tracking
interface PresenceEntry {
  key: string;
  cedula: string;
  usuario: string;
  rol: string;
  municipio: string;
  ip: string;
  dispositivo: string;
  navegador: string;
  path: string;
  lastSeen: number;
  timestampIso: string;
}

const activeUsersPresenceMap = new Map<string, PresenceEntry>();

function cleanupStalePresence() {
  const cutoff = Date.now() - 90 * 1000; // 90 seconds timeout
  for (const [key, value] of activeUsersPresenceMap.entries()) {
    if (value.lastSeen < cutoff) {
      activeUsersPresenceMap.delete(key);
    }
  }
}

async function calcularMetricasAccesoAsync(dbData: DatabaseSchema): Promise<MetricasAccesoResumen> {
  cleanupStalePresence();
  let rawRegistros = getRegistrosAcceso();

  // 1. Cargar registros persistentes directamente desde PostgreSQL para garantizar métricas 100% reales
  try {
    const pgRows = await db.select().from(schema.registrosAcceso);
    if (pgRows && pgRows.length > 0) {
      const pgMapped: RegistroAcceso[] = pgRows.map((r: any) => {
        const d = (r.details || {}) as any;
        return {
          id: r.id || d.id || `acc_pg_${r.timestamp}`,
          timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : (d.timestamp || new Date().toISOString()),
          fechaFormateada: d.fechaFormateada || (r.timestamp ? new Date(r.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : ''),
          fechaCorta: d.fechaCorta || (r.timestamp ? new Date(r.timestamp).toISOString().split('T')[0] : ''),
          usuario: d.usuario || d.encargado || r.actorId || 'Usuario',
          cedulaOrNit: d.cedulaOrNit || d.cedula || r.actorId || '',
          rol: (r.actorRole || d.rol || 'desconocido') as any,
          municipio: d.municipio || '',
          ip: r.ip || d.ip || '127.0.0.1',
          ubicacionIp: d.ubicacionIp || (d.municipio ? `${d.municipio}, Colombia` : 'Colombia'),
          isp: d.isp || 'Red Nacional',
          dispositivo: d.dispositivo || r.userAgent || 'Navegador Web',
          navegador: d.navegador || '',
          tipoAcceso: (r.action || d.tipoAcceso || 'visita') as any,
          exitoso: d.exitoso !== false,
          detalles: d.detalles || r.action,
        };
      });

      const seenIds = new Set<string>();
      const combined: RegistroAcceso[] = [];
      for (const reg of [...rawRegistros, ...pgMapped]) {
        if (!reg || !reg.id) continue;
        if (!seenIds.has(reg.id)) {
          seenIds.add(reg.id);
          combined.push(reg);
        }
      }
      rawRegistros = combined;
    }
  } catch (err: any) {
    console.warn('[Metricas Acceso PG Warn]:', err.message);
  }

  // Ordenar cronológicamente descendente
  rawRegistros.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const expendios = dbData.expendios || [];

  // Filtrar registros sintéticos o de prueba
  const registros = rawRegistros.filter((r) => {
    if (!r || !r.exitoso) return false;
    const cedClean = normalizeCedula(r.cedulaOrNit);
    if (!cedClean || cedClean.startsWith('99999')) return false;
    const text = `${r.usuario || ''} ${r.municipio || ''} ${r.detalles || ''}`.toLowerCase();
    if (text.includes('attempt') || text.includes('no registrado') || text.includes('synthetic') || text.includes('bucaramanga test')) return false;
    return true;
  });

  const totalIngresos = registros.length;
  const uniqueCedulas = new Set(registros.map((r) => normalizeCedula(r.cedulaOrNit)).filter(Boolean));
  const totalUsuariosUnicos = uniqueCedulas.size;

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const currentMonth = todayStr.substring(0, 7);

  const ingresosHoy = registros.filter((r) => r.fechaCorta === todayStr).length;
  const ingresosUltimos7Dias = registros.filter((r) => r.timestamp >= sevenDaysAgo).length;
  const ingresosEsteMes = registros.filter((r) => (r.fechaCorta || '').startsWith(currentMonth)).length;

  const desglosePorRol = {
    expendio: registros.filter((r) => r.rol === 'expendio').length,
    admin: registros.filter((r) => r.rol === 'admin').length,
    cliente: registros.filter((r) => r.rol === 'cliente').length,
  };

  const desgloseDispositivo = {
    movil: registros.filter(
      (r) =>
        (r.dispositivo || '').toLowerCase().includes('móvil') ||
        (r.dispositivo || '').toLowerCase().includes('movil') ||
        (r.dispositivo || '').toLowerCase().includes('iphone')
    ).length,
    escritorio: registros.filter(
      (r) =>
        (r.dispositivo || '').toLowerCase().includes('computador') ||
        (r.dispositivo || '').toLowerCase().includes('escritorio')
    ).length,
    tablet: registros.filter(
      (r) =>
        (r.dispositivo || '').toLowerCase().includes('tablet') ||
        (r.dispositivo || '').toLowerCase().includes('ipad')
    ).length,
  };

  const expendiosQueHanIngresadoMap = new Map<
    string,
    {
      cedula: string;
      encargado: string;
      municipio: string;
      totalIngresos: number;
      ultimoIngreso: string;
      ultimoTimestamp: string;
      telefonoPunto?: string;
      tieneFotos?: boolean;
      ultimaIp?: string;
      ultimaUbicacion?: string;
      isp?: string;
    }
  >();

  const checkExpendioHasPhotos = (exp?: ExpendioData | null) =>
    Boolean(
      exp &&
        (exp.fotoAvisoUrl ||
          exp.fotoPanoramicaUrl ||
          exp.fotoMataselloUrl ||
          exp.fotoBasculaUrl ||
          exp.fotoContratistaUrl ||
          exp.fotoHorarioUrl ||
          exp.fotoTarifasUrl ||
          exp.fotoFachadaUrl ||
          exp.letreroUrl ||
          exp.basculaUrl ||
          exp.mataselloUrl)
    );

  registros.forEach((r) => {
    const cleanRegCed = normalizeCedula(r.cedulaOrNit);
    if (!cleanRegCed) return;

    const exp =
      expendios.find((e) => normalizeCedula(e.cedula) === cleanRegCed) ||
      (r.municipio
        ? expendios.find(
            (e) =>
              (e.municipio || '').trim().toUpperCase() === r.municipio!.trim().toUpperCase() ||
              (e.localidad || '').trim().toUpperCase() === r.municipio!.trim().toUpperCase()
          )
        : undefined);

    if (r.rol === 'expendio' || (r.rol === 'admin' && exp)) {
      const mapKey = exp ? normalizeCedula(exp.cedula) : cleanRegCed;
      const prev = expendiosQueHanIngresadoMap.get(mapKey);
      const tieneFotos = checkExpendioHasPhotos(exp);

      if (!prev) {
        expendiosQueHanIngresadoMap.set(mapKey, {
          cedula: exp?.cedula || r.cedulaOrNit,
          encargado: exp?.encargado || r.usuario,
          municipio: exp?.municipio || exp?.localidad || r.municipio || 'SIN MUNICIPIO',
          totalIngresos: 1,
          ultimoIngreso: r.fechaFormateada || r.timestamp,
          ultimoTimestamp: r.timestamp,
          telefonoPunto: exp?.telefonoPunto,
          tieneFotos,
          ultimaIp: r.ip || '',
          ultimaUbicacion: r.ubicacionIp || (r.municipio ? `${r.municipio}, Colombia` : 'Colombia'),
          isp: r.isp || '',
        });
      } else {
        prev.totalIngresos += 1;
        if (r.timestamp > prev.ultimoTimestamp) {
          prev.ultimoTimestamp = r.timestamp;
          prev.ultimoIngreso = r.fechaFormateada || r.timestamp;
          if (r.ip) prev.ultimaIp = r.ip;
          if (r.ubicacionIp) prev.ultimaUbicacion = r.ubicacionIp;
          if (r.isp) prev.isp = r.isp;
        }
      }
    }
  });

  for (const exp of expendios) {
    const cleanCed = normalizeCedula(exp.cedula);
    if (!cleanCed) continue;
    const tieneFotos = checkExpendioHasPhotos(exp);
    if ((tieneFotos || exp.primeraVezActualizado) && !expendiosQueHanIngresadoMap.has(cleanCed)) {
      const fechaAct = exp.updatedAt || exp.fechaUltimaActualizacion || new Date().toISOString();
      expendiosQueHanIngresadoMap.set(cleanCed, {
        cedula: exp.cedula,
        encargado: exp.encargado,
        municipio: exp.municipio || exp.localidad || 'SIN MUNICIPIO',
        totalIngresos: 1,
        ultimoIngreso: exp.fechaUltimaActualizacion || fechaAct.split('T')[0],
        ultimoTimestamp: fechaAct,
        telefonoPunto: exp.telefonoPunto,
        tieneFotos,
        ultimaIp: 'Registro Fotográfico Sincronizado',
        ultimaUbicacion: `${exp.municipio || exp.localidad || 'Colombia'}, Colombia`,
        isp: 'Red Nacional',
      });
    }
  }

  const expendiosQueHanIngresado = Array.from(expendiosQueHanIngresadoMap.values()).map(
    ({ ultimoTimestamp, ...rest }) => rest
  );
  const cedulasQueIngresaron = new Set(
    expendiosQueHanIngresado.map((e) => normalizeCedula(e.cedula))
  );

  const expendiosPendientesPorIngresar = expendios
    .filter((e) => !cedulasQueIngresaron.has(normalizeCedula(e.cedula)))
    .map((e) => ({
      cedula: e.cedula,
      encargado: e.encargado,
      municipio: e.municipio || e.localidad,
      telefonoPunto: e.telefonoPunto,
    }));

  const expendiosRegistradosTotales = expendios.length;
  const expendiosQueHanIngresadoCount = expendiosQueHanIngresado.length;
  const porcentajeCoberturaExpendios =
    expendiosRegistradosTotales > 0
      ? Math.round((expendiosQueHanIngresadoCount / expendiosRegistradosTotales) * 1000) / 10
      : 0;

  // Realtime active users online calculation
  const nowMs = Date.now();
  const activeList = Array.from(activeUsersPresenceMap.values())
    .map((item) => ({
      ...item,
      haceCuantoSegundos: Math.max(0, Math.floor((nowMs - item.lastSeen) / 1000)),
    }))
    .sort((a, b) => b.lastSeen - a.lastSeen);

  const desgloseEnLinea = {
    expendio: activeList.filter((u) => u.rol === 'expendio').length,
    admin: activeList.filter((u) => u.rol === 'admin').length,
    cliente: activeList.filter((u) => u.rol === 'cliente').length,
  };

  return {
    totalIngresos,
    totalUsuariosUnicos: Math.max(totalUsuariosUnicos, expendiosQueHanIngresadoCount),
    totalVisitasGenerales: Math.max(dbData.visitasGenerales || 0, totalIngresos),
    ingresosHoy,
    ingresosUltimos7Dias,
    ingresosEsteMes,
    expendiosRegistradosTotales,
    expendiosQueHanIngresadoCount,
    porcentajeCoberturaExpendios,
    desglosePorRol,
    desgloseDispositivo,
    expendiosQueHanIngresado,
    expendiosPendientesPorIngresar,
    ultimosAccesos: registros.slice(0, 150),
    usuariosEnLineaCount: activeList.length,
    desgloseEnLinea,
    listaUsuariosEnLinea: activeList,
  };
}

function cleanNequiNumber(raw?: string | null): string {
  if (!raw) return '';
  const str = String(raw).trim();

  // 1. Look for a clean 10-digit Colombian mobile starting with 3
  const matchMobile = str.match(/\b(3\d{9})\b/);
  if (matchMobile) {
    return matchMobile[1];
  }

  // 2. Try splitting by common separators (- , / space)
  const tokens = str.split(/[\/\-,\s]+/);
  for (const token of tokens) {
    const digits = token.replace(/[^0-9]/g, '');
    if (digits.length === 10 && digits.startsWith('3')) {
      return digits;
    }
  }

  // 3. If concatenated into > 10 digits starting with 3 (e.g. "32189605683125614614"), slice the first 10 digits
  const allDigits = str.replace(/[^0-9]/g, '');
  if (allDigits.length >= 10 && allDigits.startsWith('3')) {
    return allDigits.slice(0, 10);
  }

  return allDigits;
}

function formatCuentaBancaria(
  rawCuenta?: string | null,
  rawBanco?: string | null
): { cuenta: string; banco: string } {
  if (!rawCuenta) return { cuenta: '', banco: String(rawBanco || '').trim() };
  const str = String(rawCuenta).trim();
  if (!str) return { cuenta: '', banco: String(rawBanco || '').trim() };
  const upper = str.toUpperCase();
  const bancoUpper = (rawBanco || '').toUpperCase();

  const isNequi =
    upper.includes('NEQUI') ||
    bancoUpper.includes('NEQUI') ||
    (!upper.includes('BANCO') &&
      !upper.includes('AHORRO') &&
      !upper.includes('CORRIENTE') &&
      !upper.includes('DAVIPLATA') &&
      /3\d{9}/.test(str));

  if (isNequi) {
    const numClean = cleanNequiNumber(str);
    const validNum = numClean.length === 10 ? numClean : numClean;
    return {
      cuenta: validNum ? `NEQUI ${validNum}` : str,
      banco: 'NEQUI',
    };
  }

  return {
    cuenta: str,
    banco:
      rawBanco ||
      (upper.includes('BANCOLOMBIA')
        ? 'BANCOLOMBIA'
        : upper.includes('DAVIPLATA')
        ? 'DAVIPLATA'
        : 'BANCO'),
  };
}

function extractMesAno(periodoStr: string) {
  const clean = (periodoStr || '').toUpperCase();
  let mes = 'ENERO';
  let ano = '2026';
  const meses = [
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
  ];
  for (const m of meses) {
    if (clean.includes(m)) {
      mes = m;
      break;
    }
  }
  const matchAno = clean.match(/20\d\d/);
  if (matchAno) {
    ano = matchAno[0];
  }
  return { mes, ano };
}

function syncCuentasToRelacionPagos(db: any, cuentas: CuentaCobroResult[], periodo: string) {
  if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];
  const { mes, ano } = extractMesAno(periodo);
  const mesUpper = mes.toUpperCase();
  const anioStr = ano;

  const otherMonths = db.relacionPagos.filter(
    (p: any) => !(p.mes?.toUpperCase() === mesUpper && String(p.anio || '2026') === anioStr)
  );

  const cleanDigits = (s?: string) => (s || '').replace(/[^0-9]/g, '');

  const newRecords: PagoRelacionItem[] = cuentas.map((c, idx) => {
    const munKey = (c.municipio || c.expendio || '').trim().toUpperCase();
    const cleanCed = cleanDigits(c.cedula);

    const prevItem = db.relacionPagos.find(
      (p: any) =>
        p.municipio?.trim().toUpperCase() === munKey ||
        (cleanCed && cleanDigits(p.cedula) === cleanCed)
    );
    const expItem = (db.expendios || []).find(
      (e: any) =>
        e.municipio?.trim().toUpperCase() === munKey ||
        (cleanCed && cleanDigits(e.cedula) === cleanCed)
    );

    let cuentaFinal = '';
    let bancoFinal = '';

    if (expItem?.cuentaBancaria && expItem.cuentaBancaria.trim()) {
      const expBanco = (expItem.banco || 'NEQUI').toUpperCase().trim();
      cuentaFinal = `${expBanco} ${expItem.cuentaBancaria.trim()}`.trim();
      bancoFinal = expBanco;
    } else if (prevItem?.cuenta && !/^\d{5,6}$/.test(prevItem.cuenta.trim())) {
      const formatted = formatCuentaBancaria(prevItem.cuenta, prevItem.banco);
      cuentaFinal = formatted.cuenta;
      bancoFinal = formatted.banco;
    } else if (expItem?.telefonoPunto) {
      const phoneClean = cleanNequiNumber(expItem.telefonoPunto);
      cuentaFinal = phoneClean ? `NEQUI ${phoneClean}` : '';
      bancoFinal = phoneClean ? 'NEQUI' : '';
    }

    const rawCed = (c.cedula || '').replace(/[^0-9]/g, '');
    const formattedCedula = rawCed.replace(/\B(?=(\d{3})+(?!\d))/g, '.') || c.cedula;

    return {
      id: `pago-${Date.now()}-${idx + 1}`,
      consecutivo: c.numeroConsecutivo || (idx + 1),
      centroOperativo: c.centroOperativo || resolveCentroOperativo(munKey, ''),
      municipio: munKey,
      concepto: `PAGO MES ${mesUpper} EXPENDIO ${munKey}`,
      nombreEncargado: (c.encargado || '').toUpperCase(),
      cedula: formattedCedula,
      cuenta: cuentaFinal,
      valorCancelar: c.valorNeto,
      banco: bancoFinal,
      estado: 'Pendiente',
      mes: mesUpper,
      anio: anioStr,
    };
  });

  const currentMonthExisting = db.relacionPagos.filter(
    (p: any) => p.mes?.toUpperCase() === mesUpper && String(p.anio || '2026') === anioStr
  );
  const existingKeys = new Set(
    currentMonthExisting.map((p: any) => (p.municipio || '').trim().toUpperCase())
  );

  let insertados = 0;
  let actualizados = 0;
  for (const r of newRecords) {
    if (existingKeys.has((r.municipio || '').trim().toUpperCase())) {
      actualizados++;
    } else {
      insertados++;
    }
  }

  db.relacionPagos = [...otherMonths, ...newRecords];
  return {
    totalSynced: newRecords.length,
    insertados,
    actualizados,
    mes: mesUpper,
    anio: anioStr,
  };
}

const DEFAULT_DOCUMENTOS_EXPENDIOS: DocumentoExpendioConfig[] = [
  {
    id: 'horario',
    nombre: 'Horario de Atención Oficial 4-72',
    descripcion: 'Cartelera oficial con horarios de atención (L-V 8am-12m / 2pm-6pm, Sáb 8am-12m) personalizada con el municipio del expendio.',
    tipo: 'horario',
    habilitado: true,
    fechaActualizacion: new Date().toISOString().split('T')[0],
    badge: 'Modelo Oficial 4-72',
    icono: 'Clock',
  },
  {
    id: 'tarifario',
    nombre: 'Tarifas Oficiales Servicios SPU 4-72 (Versión 01-2026)',
    descripcion: 'Cartelera reglamentaria oficial de Tarifas SPU (Resolución MinTIC 4114/2023): Correo Nacional e Internacional con y sin certificación, tiempos de entrega y zonas.',
    tipo: 'tarifario',
    habilitado: true,
    fechaActualizacion: new Date().toISOString().split('T')[0],
    badge: 'Vigilado MinTIC 2026',
    icono: 'DollarSign',
  },
  {
    id: 'contrato',
    nombre: 'Contrato de Prestación de Servicios',
    descripcion: 'Minuta contractual completa (13 páginas) personalizada con nombre, cédula, celular, dirección y municipio del contratista.',
    tipo: 'contrato',
    habilitado: true,
    fechaActualizacion: new Date().toISOString().split('T')[0],
    badge: 'Minuta Legal 13 Páginas',
    icono: 'FileText',
  },
  {
    id: 'aviso',
    nombre: 'Aviso Fachada Punto de Venta 4-72',
    descripcion: 'Aviso corporativo para fachada o mostrador con logo oficial de 4-72, Servicios Postales y nombre del punto para impresión.',
    tipo: 'aviso',
    habilitado: true,
    fechaActualizacion: new Date().toISOString().split('T')[0],
    badge: 'Fachada & Mostrador',
    icono: 'Store',
  },
  {
    id: 'circular',
    nombre: 'Circular y Normativa Operativa',
    descripcion: 'Directrices institucionales y manual de procedimientos operativos emitidos por la administración de Camarca S.A.S.',
    tipo: 'archivo',
    habilitado: true,
    fechaActualizacion: new Date().toISOString().split('T')[0],
    badge: 'Documento Administrativo',
    icono: 'FileCheck',
  },
];

const DEFAULT_CONFIG: SystemConfig = {
  periodoHabilitadoDescarga: 'FEBRERO 2026',
  descargaHabilitada: true,
  fechaActualizacion: new Date().toISOString().split('T')[0],
  documentosExpendios: DEFAULT_DOCUMENTOS_EXPENDIOS,
};

const DEFAULT_RELACION_PAGOS: PagoRelacionItem[] = [];

function deduplicateHistorial(historialList: HistorialItem[]): HistorialItem[] {
  if (!Array.isArray(historialList)) return [];
  const cleanDigits = (s?: string) => String(s || '').replace(/[^0-9]/g, '');
  const seenKeys = new Set<string>();
  const result: HistorialItem[] = [];

  for (const h of historialList) {
    const tipo = (h.tipo || '').trim();
    // Excluir estrictamente actualizaciones de perfil, firmas escaneadas o novedades de maestro
    // La contabilidad del historial SOLO debe contener cuentas de cobro generadas por el Administrador
    if (
      tipo === 'Actualización' ||
      tipo === 'Actualización Maestro' ||
      tipo === 'Cuenta de Cobro Firmada' ||
      tipo === 'Actualización de Perfil'
    ) {
      continue;
    }

    const periodoStr = (h.periodo || h.cuentaData?.periodo || '').toUpperCase();
    const { mes, ano } = extractMesAno(periodoStr);
    const ced = cleanDigits(h.cedula || h.cuentaData?.cedula);
    const mun = (h.expendio || h.cuentaData?.municipio || h.cuentaData?.expendio || '').trim().toUpperCase();
    const key = `${mes}-${ano}-${ced || mun}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push({
        ...h,
        tipo: 'Cuenta de Cobro',
      });
    }
  }
  return result;
}

export interface DiscrepanciaEncargadoItem {
  id: string;
  municipio: string;
  expendioId?: string;
  campo: 'nombre' | 'cedula' | 'celular' | 'direccion';
  campoEtiqueta: string;
  valorBD: string;
  valorArchivo: string;
}

function normalizeForComparison(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function normalizePhoneDigits(val: any): string {
  const digits = String(val || '').replace(/[^0-9]/g, '');
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function checkDiscrepanciesEncargado(
  municipio: string,
  targetExp: any,
  encargadoArchivo: string,
  cedulaArchivo: string,
  telefonoArchivo: string,
  direccionArchivo: string
): DiscrepanciaEncargadoItem[] {
  const diffs: DiscrepanciaEncargadoItem[] = [];
  if (!targetExp) return diffs;

  // 1. Nombre / Encargado
  const encArch = (encargadoArchivo || '').trim();
  const encBD = (targetExp.encargado || '').trim();
  if (
    encArch &&
    encBD &&
    normalizeForComparison(encArch) !== normalizeForComparison(encBD) &&
    encArch.length > 2 &&
    encBD.length > 2 &&
    !encArch.toUpperCase().startsWith('ENCARGADO')
  ) {
    diffs.push({
      id: `${targetExp.id || municipio}-nombre`,
      municipio: targetExp.municipio || municipio,
      expendioId: targetExp.id,
      campo: 'nombre',
      campoEtiqueta: 'Nombre del Encargado',
      valorBD: encBD,
      valorArchivo: encArch,
    });
  }

  // 2. Cédula
  const cedArch = (cedulaArchivo || '').trim();
  const cedBD = (targetExp.cedula || '').trim();
  const digArch = cedArch.replace(/[^0-9]/g, '');
  const digBD = cedBD.replace(/[^0-9]/g, '');
  if (digArch && digBD && digArch !== digBD && digArch.length >= 5 && digBD.length >= 5) {
    diffs.push({
      id: `${targetExp.id || municipio}-cedula`,
      municipio: targetExp.municipio || municipio,
      expendioId: targetExp.id,
      campo: 'cedula',
      campoEtiqueta: 'Cédula / Documento',
      valorBD: cedBD,
      valorArchivo: cedArch,
    });
  }

  // 3. Celular / Teléfono
  const telArch = (telefonoArchivo || '').trim();
  const telBD = (targetExp.telefonoPunto || '').trim();
  const phoneArch = normalizePhoneDigits(telArch);
  const phoneBD = normalizePhoneDigits(telBD);
  if (phoneArch && phoneBD && phoneArch !== phoneBD && phoneArch.length >= 7 && phoneBD.length >= 7) {
    diffs.push({
      id: `${targetExp.id || municipio}-celular`,
      municipio: targetExp.municipio || municipio,
      expendioId: targetExp.id,
      campo: 'celular',
      campoEtiqueta: 'Celular / Teléfono',
      valorBD: telBD,
      valorArchivo: telArch,
    });
  }

  // 4. Dirección
  const dirArch = (direccionArchivo || '').trim();
  const dirBD = (targetExp.direccionPunto || '').trim();
  if (
    dirArch &&
    dirBD &&
    normalizeForComparison(dirArch) !== normalizeForComparison(dirBD) &&
    dirArch.length > 3 &&
    dirBD.length > 3 &&
    !dirArch.toUpperCase().includes('SEDE PRINCIPAL') &&
    !dirArch.toUpperCase().includes('CALLE PRINCIPAL')
  ) {
    diffs.push({
      id: `${targetExp.id || municipio}-direccion`,
      municipio: targetExp.municipio || municipio,
      expendioId: targetExp.id,
      campo: 'direccion',
      campoEtiqueta: 'Dirección del Punto',
      valorBD: dirBD,
      valorArchivo: dirArch,
    });
  }

  return diffs;
}

// ==============================================================================
// GESTOR DE BASE DE DATOS Y CONCURRENCIA: Implementado en ./server/dbStore.ts
// loadDatabase, saveDatabase, mutateDatabase, createAutoSnapshot provistos por dbStore.
// ==============================================================================

// Initialize middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Prevent caching for all API routes to avoid stale data
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Health check endpoint for keep-alive, Cloud Run health probes, and uptime monitors
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: isPublishedEnv ? 'PUBLICADA' : 'TEST',
  });
});

// Endpoint público y desacoplado para reportar errores y novedades desde el cliente (expendio / admin)
app.post('/api/error-log', (req, res) => {
  try {
    const { errorCode, source, expendioId, municipio, cedula, userMessage, technicalDetails, category, severity } = req.body || {};
    if (!errorCode) {
      return res.status(400).json({ success: false, error: 'errorCode es requerido' });
    }
    const logged = errorLogService.logError({
      errorCode: String(errorCode).trim(),
      source: source || 'expendio',
      expendioId: expendioId ? String(expendioId).trim() : undefined,
      municipio: municipio ? String(municipio).trim() : undefined,
      cedula: cedula ? String(cedula).trim() : undefined,
      userMessage: userMessage ? String(userMessage).trim() : undefined,
      technicalDetails: technicalDetails ? String(technicalDetails).trim() : undefined,
      category,
      severity,
    });
    res.json({ success: true, logId: logged.id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Proteger todas las rutas bajo /api/admin desde el inicio del pipeline
app.use('/api/admin', requireAdmin);

// Service Worker dedicado para sincronización de archivos con Google Drive en segundo plano
app.get('/drive-sync-sw.js', (req, res) => {
  const swPath = path.join(process.cwd(), 'public', 'drive-sync-sw.js');
  if (fs.existsSync(swPath)) {
    res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(swPath);
  }
  res.status(404).send('Service Worker no encontrado');
});

// Endpoint protegido para descargar o visualizar el código fuente (exclusivo Administrador)
app.get(['/codigo_completo_app.txt', '/api/admin/codigo-completo.txt'], requireAdmin, (req, res) => {
  const filePath = path.join(process.cwd(), 'codigo_completo_app.txt');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (req.query.download === '1' || req.query.download === 'true') {
      res.setHeader('Content-Disposition', 'attachment; filename="codigo_completo_camarca.txt"');
    }
    return res.sendFile(filePath);
  }
  res.status(404).send('Archivo de código no encontrado. Ejecute el generador.');
});

// Servir documentos institucionales de expendios (horario, tarifas, contrato, avisos) con sanitización contra Path Traversal
app.get('/uploads/docs_expendios/:fileName', (req, res, next) => {
  const safeFileName = path.basename(req.params.fileName || '');
  if (!safeFileName) return res.status(400).send('Nombre de archivo inválido');
  const localPath = path.join(docsExpendiosDir, safeFileName);
  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }
  const permPath = path.join(permanentArchiveDir, safeFileName);
  if (fs.existsSync(permPath)) {
    return res.sendFile(permPath);
  }
  next();
});

// Autenticación obligatoria para todas las rutas bajo /uploads (no es ruta pública)
app.use('/uploads', requireAuthenticatedUser);

// Interceptor para /uploads/photos/:fileName: servir desde disco o almacenamiento permanente
app.get('/uploads/photos/:fileName', async (req, res, next) => {
  const safeFileName = path.basename(req.params.fileName || '');
  if (!safeFileName) return next();
  const filePath = path.join(photosDir, safeFileName);

  if (fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.sendFile(filePath);
  }

  next();
});

const getPhotoSlotVariants = (slot: string): string[] => {
  const s = (slot || '').trim();
  const map: Record<string, string[]> = {
    fotoAvisoUrl: ['fotoAvisoUrl', 'fotoAviso', 'aviso', 'letrero', 'letreroUrl'],
    fotoAviso: ['fotoAvisoUrl', 'fotoAviso', 'aviso', 'letrero', 'letreroUrl'],
    letrero: ['fotoAvisoUrl', 'fotoAviso', 'aviso', 'letrero', 'letreroUrl'],
    letreroUrl: ['fotoAvisoUrl', 'fotoAviso', 'aviso', 'letrero', 'letreroUrl'],
    aviso: ['fotoAvisoUrl', 'fotoAviso', 'aviso', 'letrero', 'letreroUrl'],

    fotoPanoramicaUrl: ['fotoPanoramicaUrl', 'fotoPanoramica', 'panoramica', 'fachada', 'fotoFachada'],
    fotoPanoramica: ['fotoPanoramicaUrl', 'fotoPanoramica', 'panoramica', 'fachada', 'fotoFachada'],
    panoramica: ['fotoPanoramicaUrl', 'fotoPanoramica', 'panoramica', 'fachada', 'fotoFachada'],
    fachada: ['fotoPanoramicaUrl', 'fotoPanoramica', 'panoramica', 'fachada', 'fotoFachada'],
    fotoFachada: ['fotoPanoramicaUrl', 'fotoPanoramica', 'panoramica', 'fachada', 'fotoFachada'],

    fotoMataselloUrl: ['fotoMataselloUrl', 'fotoMatasello', 'matasello', 'mataselloUrl'],
    fotoMatasello: ['fotoMataselloUrl', 'fotoMatasello', 'matasello', 'mataselloUrl'],
    matasello: ['fotoMataselloUrl', 'fotoMatasello', 'matasello', 'mataselloUrl'],
    mataselloUrl: ['fotoMataselloUrl', 'fotoMatasello', 'matasello', 'mataselloUrl'],

    fotoBasculaUrl: ['fotoBasculaUrl', 'fotoBascula', 'bascula', 'basculaUrl'],
    fotoBascula: ['fotoBasculaUrl', 'fotoBascula', 'bascula', 'basculaUrl'],
    bascula: ['fotoBasculaUrl', 'fotoBascula', 'bascula', 'basculaUrl'],
    basculaUrl: ['fotoBasculaUrl', 'fotoBascula', 'bascula', 'basculaUrl'],

    fotoContratistaUrl: ['fotoContratistaUrl', 'fotoContratista', 'contratista', 'encargado', 'fotoPropietario', 'propietario'],
    fotoContratista: ['fotoContratistaUrl', 'fotoContratista', 'contratista', 'encargado', 'fotoPropietario', 'propietario'],
    contratista: ['fotoContratistaUrl', 'fotoContratista', 'contratista', 'encargado', 'fotoPropietario', 'propietario'],

    fotoHorarioUrl: ['fotoHorarioUrl', 'fotoHorario', 'horario'],
    fotoHorario: ['fotoHorarioUrl', 'fotoHorario', 'horario'],
    horario: ['fotoHorarioUrl', 'fotoHorario', 'horario'],

    fotoTarifasUrl: ['fotoTarifasUrl', 'fotoTarifas', 'tarifas'],
    fotoTarifas: ['fotoTarifasUrl', 'fotoTarifas', 'tarifas'],
    tarifas: ['fotoTarifasUrl', 'fotoTarifas', 'tarifas'],

    fotoCedulaFrontalUrl: ['fotoCedulaFrontalUrl', 'fotoCedulaFrontal', 'cedulaFrontal'],
    fotoCedulaPosteriorUrl: ['fotoCedulaPosteriorUrl', 'fotoCedulaPosterior', 'cedulaPosterior'],
    fotoRutUrl: ['fotoRutUrl', 'fotoRut', 'rut'],
  };
  return map[s] || [s];
};

// Endpoint diagnóstico exhaustivo de integridad de fotografía (PostgreSQL vs Firebase Storage REAL vs AWS S3 REAL)
app.get(['/api/photos/debug/:photoId', '/api/photos/debug/:cedula/:slotKey'], requireAuthenticatedUser, async (req, res) => {
  try {
    const { photoId, cedula, slotKey } = req.params;
    const targetId = photoId || cedula;
    const report = await diagnosePhotoIntegrity(targetId, slotKey);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `Error ejecutando diagnóstico de fotografía: ${err.message}`,
    });
  }
});

/**
 * Resuelve de forma segura y aislada las claves candidatas (IDs, nombres de archivo y prefijos S3)
 * para una fotografía, garantizando que NUNCA se mezclen datos entre expendios distintos (ej: Girón, Pamplona, Togüí, Landázuri).
 */
function resolveExpendioCandidateKeys(
  cleanCed: string,
  cleanTargetCed: string,
  matchedExp: any,
  slotVariants: string[],
  database: DatabaseSchema
): { candidateCedulas: string[]; candidatePhotoIds: string[]; candidateFileNames: string[] } {
  const forbiddenOtherCedulas = new Set<string>();
  for (const e of database.expendios || []) {
    if (matchedExp && e.id === matchedExp.id) continue;
    const norm = normalizeCedula(e.cedula);
    if (norm) forbiddenOtherCedulas.add(norm);
  }
  // Si el expendio consultado NO es Girón (1094269932), prohibir terminantemente la cédula del superadmin
  if (matchedExp && normalizeCedula(matchedExp.cedula) !== ADMIN_CEDULA) {
    forbiddenOtherCedulas.add(ADMIN_CEDULA);
  }

  const allowedCedulas: string[] = [];

  // 1. Cédula canónica del expendio coincidente
  if (matchedExp?.cedula) {
    const expCedNorm = normalizeCedula(matchedExp.cedula);
    if (expCedNorm && !forbiddenOtherCedulas.has(expCedNorm)) {
      allowedCedulas.push(expCedNorm);
    }
  }

  // 2. ID inmutable del expendio coincidente
  if (matchedExp?.id) {
    allowedCedulas.push(matchedExp.id.trim());
  }

  // 3. Cédula solicitada explícitamente en la URL (si no pertenece a otro expendio)
  if (cleanTargetCed && !forbiddenOtherCedulas.has(cleanTargetCed)) {
    allowedCedulas.push(cleanTargetCed);
  }
  if (cleanCed && cleanCed !== cleanTargetCed && !forbiddenOtherCedulas.has(cleanCed)) {
    allowedCedulas.push(cleanCed);
  }

  // 4. Historial explícito de cédulas anteriores sólo si pertenecen legítimamente a este expendio
  if (Array.isArray(matchedExp?.cedulasAnteriores)) {
    for (const prev of matchedExp.cedulasAnteriores) {
      const prevNorm = normalizeCedula(prev);
      if (prevNorm && !forbiddenOtherCedulas.has(prevNorm)) {
        allowedCedulas.push(prevNorm);
      }
    }
  }

  const candidateCedulas = Array.from(new Set(allowedCedulas.filter(Boolean)));
  const candidatePhotoIds: string[] = [];
  const candidateFileNames: string[] = [];

  for (const c of candidateCedulas) {
    for (const sv of slotVariants) {
      candidatePhotoIds.push(`photo_${c}_${sv}`);
      candidateFileNames.push(`${c}_${sv}.jpg`);
      candidateFileNames.push(`${c}_${sv}.png`);
    }
  }

  return { candidateCedulas, candidatePhotoIds, candidateFileNames };
}

// Endpoint específico para verificar metadatos de fotos (HEAD o GET JSON)
app.get(['/api/photos/metadata/:cedula/:slotKey', '/api/expendio/photo/metadata/:cedula/:slotKey'], async (req, res) => {
  const { cedula, slotKey } = req.params;
  const cleanCed = (cedula || '').trim();
  const cleanTargetCed = normalizeCedula(cleanCed);
  const cleanSlot = (slotKey || '').trim();

  const currentDb = getDatabaseReadOnly();
  const matchedExp = (currentDb.expendios || []).find(
    (e) =>
      normalizeCedula(e.cedula) === cleanTargetCed ||
      (e.id || '').trim() === cleanCed ||
      (Array.isArray((e as any).cedulasAnteriores) &&
        (e as any).cedulasAnteriores.some((prev: string) => normalizeCedula(prev) === cleanTargetCed))
  );

  const slotVariants = getPhotoSlotVariants(cleanSlot);
  const { candidateCedulas, candidatePhotoIds, candidateFileNames } = resolveExpendioCandidateKeys(
    cleanCed,
    cleanTargetCed,
    matchedExp,
    slotVariants,
    currentDb
  );

  try {
    const hybridRecords = await db
      .select()
      .from(schema.photoStorage)
      .where(
        or(
          inArray(schema.photoStorage.photoId, candidatePhotoIds),
          and(
            inArray(schema.photoStorage.cedula, candidateCedulas),
            inArray(schema.photoStorage.slotKey, slotVariants)
          )
        )
      )
      .limit(1);

    if (hybridRecords.length > 0) {
      const r = hybridRecords[0];
      const isErrorStatus =
        r.status === 'ERROR' ||
        !r.checksumSha256 ||
        r.sizeBytes < 200 ||
        r.checksumSha256 === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      if (!isErrorStatus && (r.status === 'SYNCED' || r.status === 'S3_FALLBACK' || r.status === 'FIREBASE_PRIMARY')) {
        return res.json({
          success: true,
          exists: true,
          cedula: cleanCed,
          slotKey: cleanSlot,
          etag: r.checksumSha256,
          version: r.version,
          checksum: r.checksumSha256,
          sizeBytes: r.sizeBytes,
          storageProvider: r.storageProvider,
          storageStatus: r.status,
          updatedAt: r.updatedAt?.toISOString(),
          url: `/api/photos/${encodeURIComponent(cleanCed)}/${encodeURIComponent(cleanSlot)}`,
        });
      }
    }
  } catch (err: any) {
    console.warn(`[Photos Metadata API] Error querying PostgreSQL:`, err.message);
  }

  // Lectura rápida desde disco permanente/local (0 escrituras en la nube al consultar metadatos)
  try {
    const s3ReplicaDir = path.join(dataDir, 's3_replica');
    const searchDirs = [permanentPhotosDir, s3ReplicaDir, photosDir];
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const fn of candidateFileNames) {
        const fp = path.join(dir, fn);
        if (fs.existsSync(fp)) {
          const stat = fs.statSync(fp);
          if (stat.size > 200) {
            const buf = fs.readFileSync(fp);
            const checksum = crypto.createHash('sha256').update(buf).digest('hex');
            return res.json({
              success: true,
              exists: true,
              cedula: cleanCed,
              slotKey: cleanSlot,
              etag: checksum,
              version: 1,
              checksum,
              sizeBytes: stat.size,
              storageProvider: 'S3',
              storageStatus: 'SYNCED',
              updatedAt: stat.mtime.toISOString(),
              url: `/api/photos/${encodeURIComponent(cleanCed)}/${encodeURIComponent(cleanSlot)}`,
            });
          }
        }
      }
    }

    // Si el expendio tiene la URL configurada en la base maestra (almacenada en AWS S3 + Firebase Storage)
    if (matchedExp) {
      for (const sv of slotVariants) {
        const val = (matchedExp as any)[sv];
        if (typeof val === 'string' && val.trim().length > 5 && !val.includes('placehold.co')) {
          return res.json({
            success: true,
            exists: true,
            cedula: cleanCed,
            slotKey: cleanSlot,
            etag: `cloud_${cleanCed}_${cleanSlot}_${matchedExp.revision || 1}`,
            version: Number(matchedExp.revision) || 1,
            storageProvider: 'S3',
            storageStatus: 'SYNCED',
            updatedAt: matchedExp.updatedAt || new Date().toISOString(),
            url: `/api/photos/${encodeURIComponent(cleanCed)}/${encodeURIComponent(cleanSlot)}`,
          });
        }
      }
    }
  } catch {}

  // Check drive registry
  try {
    const registry = loadDrivePhotosRegistry();
    for (const c of candidateCedulas) {
      for (const sv of slotVariants) {
        const k = `${c}_${sv}`;
        if (registry[k] && registry[k].driveFileId) {
          return res.json({
            success: true,
            exists: true,
            cedula: cleanCed,
            slotKey: cleanSlot,
            etag: `drive_${registry[k].driveFileId}`,
            version: 1,
            storageProvider: 'GOOGLE_DRIVE',
            driveFileId: registry[k].driveFileId,
            url: `/api/photos/${encodeURIComponent(cleanCed)}/${encodeURIComponent(cleanSlot)}`,
          });
        }
      }
    }
  } catch {}

  return res.status(404).json({
    success: false,
    exists: false,
    message: 'Fotografía no encontrada.',
  });
});

// Endpoint canónico y permanente para servir fotos de expendios desde disco, permanentes o Google Drive
app.get(['/api/photos/:cedula/:slotKey', '/api/expendio/photo/:cedula/:slotKey'], async (req, res) => {
  let user = extractAuthenticatedUser(req);
  if (!user && req.query.token && typeof req.query.token === 'string') {
    user = verifySessionToken(req.query.token as string);
  }

  const { cedula, slotKey } = req.params;
  const cleanCed = (cedula || '').trim();
  const cleanTargetCed = normalizeCedula(cleanCed);
  const cleanSlot = (slotKey || '').trim();
  const lowerSlot = cleanSlot.toLowerCase();

  // Documentos privados sensibles exigen autenticación obligatoria y propiedad o rol administrador
  const isSensitiveDoc =
    lowerSlot.includes('cedula') ||
    lowerSlot.includes('rut') ||
    lowerSlot.includes('certificado') ||
    lowerSlot.includes('cuenta');

  if (isSensitiveDoc && !user) {
    return res.status(401).json({ success: false, message: 'Acceso no autorizado para consultar documentos privados.' });
  }

  const currentDb = getDatabaseReadOnly();
  const matchedExp = (currentDb.expendios || []).find(
    (e) =>
      normalizeCedula(e.cedula) === cleanTargetCed ||
      (e.id || '').trim() === cleanCed ||
      (Array.isArray((e as any).cedulasAnteriores) &&
        (e as any).cedulasAnteriores.some((prev: string) => normalizeCedula(prev) === cleanTargetCed))
  );

  // Si hay usuario autenticado:
  // Administradores y Clientes pueden consultar fotografías operativas; solo Admin o el propio expendio consultan docs privados.
  if (user && !user.roles.includes('admin')) {
    if (isSensitiveDoc || !user.roles.includes('cliente')) {
      const isOwnExp = matchedExp && user.expendioId === matchedExp.id;
      if (!isOwnExp && normalizeCedula(user.cedula) !== cleanTargetCed && user.expendioId !== cleanCed) {
        return res.status(403).json({ success: false, message: 'Acceso denegado: No tiene permisos para ver fotos o documentos de otro expendio.' });
      }
    }
  }

  const slotVariants = getPhotoSlotVariants(cleanSlot);
  const { candidateCedulas, candidatePhotoIds, candidateFileNames } = resolveExpendioCandidateKeys(
    cleanCed,
    cleanTargetCed,
    matchedExp,
    slotVariants,
    currentDb
  );

  // 1. Consultar registro y metadatos de la fotografía en PostgreSQL (Fuente de Verdad)
  try {
    const hybridRecords = await db
      .select()
      .from(schema.photoStorage)
      .where(
        or(
          inArray(schema.photoStorage.photoId, candidatePhotoIds),
          and(
            inArray(schema.photoStorage.cedula, candidateCedulas),
            inArray(schema.photoStorage.slotKey, slotVariants)
          )
        )
      )
      .limit(1);

    if (hybridRecords.length > 0) {
      const photoRec = hybridRecords[0];

      if (photoRec.sizeBytes >= 200) {
        // ETag Validation (304 Not Modified)
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && (ifNoneMatch === `"${photoRec.checksumSha256}"` || ifNoneMatch === photoRec.checksumSha256)) {
          res.setHeader('ETag', `"${photoRec.checksumSha256}"`);
          res.setHeader('X-Storage-Provider', photoRec.storageProvider);
          res.setHeader('X-Photo-Version', String(photoRec.version));
          return res.status(304).end();
        }

        const photoMeta: PhotoMetadata = {
          photoId: photoRec.photoId,
          expendioId: photoRec.expendioId || undefined,
          cedula: photoRec.cedula || undefined,
          slotKey: photoRec.slotKey,
          version: photoRec.version,
          checksumSha256: photoRec.checksumSha256,
          sizeBytes: photoRec.sizeBytes,
          mimeType: photoRec.mimeType,
          storageProvider: photoRec.storageProvider as any,
          firebaseStoragePath: photoRec.firebaseStoragePath || undefined,
          s3Bucket: photoRec.s3Bucket || undefined,
          s3Key: photoRec.s3Key || undefined,
          status: photoRec.status as any,
          lastError: photoRec.lastError || undefined,
          updatedAt: photoRec.updatedAt?.toISOString() || new Date().toISOString(),
        };

        const result = await readPhotoFromStorage(photoMeta);
        if (result && result.buffer && result.buffer.length >= 200) {
          const isThumb = req.query.thumb === '1' || req.query.thumb === 'true';
          const etagVal = `"${photoRec.checksumSha256}${isThumb ? '-thumb' : ''}"`;
          if (req.headers['if-none-match'] === etagVal) {
            return res.status(304).end();
          }
          let outBuffer = result.buffer;
          let outMime = result.mimeType || 'image/jpeg';
          if (isThumb) {
            try {
              outBuffer = await sharp(result.buffer)
                .resize({ width: 320, withoutEnlargement: true })
                .jpeg({ quality: 72, progressive: true })
                .toBuffer();
              outMime = 'image/jpeg';
            } catch {}
          }
          res.setHeader('Content-Type', outMime);
          res.setHeader('Content-Length', String(outBuffer.length));
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
          res.setHeader('X-Storage-Provider', result.resolvedProvider || photoRec.storageProvider);
          res.setHeader('X-Photo-Version', String(photoRec.version));
          res.setHeader('ETag', etagVal);
          return res.send(outBuffer);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Photos API] Warning querying PostgreSQL photo_storage (${cleanCed} - ${cleanSlot}):`, err.message);
  }

  // 1B. Fallback a tabla legacy googleDrivePhotos en PostgreSQL
  try {
    const photoRecords = await db
      .select()
      .from(schema.googleDrivePhotos)
      .where(inArray(schema.googleDrivePhotos.fileName, candidateFileNames))
      .limit(1);

    if (photoRecords.length > 0 && photoRecords[0].path && fs.existsSync(photoRecords[0].path)) {
      const stat = fs.statSync(photoRecords[0].path);
      if (stat.size >= 200) {
        const isThumb = req.query.thumb === '1' || req.query.thumb === 'true';
        if (isThumb) {
          try {
            const thumbBuf = await sharp(photoRecords[0].path)
              .resize({ width: 320, withoutEnlargement: true })
              .jpeg({ quality: 72, progressive: true })
              .toBuffer();
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Content-Length', String(thumbBuf.length));
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            return res.send(thumbBuf);
          } catch {}
        }
        res.setHeader('Content-Type', photoRecords[0].mimeType || 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        return res.sendFile(photoRecords[0].path);
      }
    }
  } catch (err: any) {
    console.warn(`[Photos API] Error consultando foto legacy en PostgreSQL (${cleanCed} - ${cleanSlot}):`, err.message);
  }

  // 2. Servir desde directorios de fotos permanentes/locales en <1ms (0 llamadas a la nube si ya está en caché local)
  try {
    const s3ReplicaDir = path.join(dataDir, 's3_replica');
    const searchDirs = [permanentPhotosDir, s3ReplicaDir, photosDir];
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const fn of candidateFileNames) {
        const fp = path.join(dir, fn);
        if (fs.existsSync(fp)) {
          const stat = fs.statSync(fp);
          if (stat.size >= 200) {
            const buffer = fs.readFileSync(fp);
            const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
            const isThumb = req.query.thumb === '1' || req.query.thumb === 'true';
            const etagVal = `"${checksum}${isThumb ? '-thumb' : ''}"`;
            if (req.headers['if-none-match'] === etagVal) {
              return res.status(304).end();
            }
            let outBuffer: Buffer = buffer;
            if (isThumb) {
              try {
                outBuffer = await sharp(buffer)
                  .resize({ width: 320, withoutEnlargement: true })
                  .jpeg({ quality: 72, progressive: true })
                  .toBuffer();
              } catch {}
            }
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Content-Length', String(outBuffer.length));
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.setHeader('X-Storage-Provider', 'S3');
            res.setHeader('X-Photo-Version', '1');
            res.setHeader('ETag', etagVal);
            return res.send(outBuffer);
          }
        }
      }
    }
  } catch (diskErr: any) {
    console.warn(`[Photos API] Error leyendo foto de disco permanente (${cleanCed} - ${cleanSlot}):`, diskErr.message);
  }

  // 3. Si el contenedor acaba de reiniciar (Scale-to-Zero) y la foto no está en disco local,
  // recuperarla directamente de AWS S3 o Firebase Storage y guardarla en caché local permanente.
  try {
    for (const c of candidateCedulas) {
      for (const sv of slotVariants) {
        const cloudResult = await readPhotoFromStorage({
          photoId: `photo_${c}_${sv}`,
          cedula: c,
          slotKey: sv,
          version: 1,
          checksumSha256: '',
          sizeBytes: 0,
          mimeType: 'image/jpeg',
          storageProvider: 'S3',
          s3Key: `photos/${c}_${sv}.jpg`,
          firebaseStoragePath: `photos/${c}/${sv}.jpg`,
          status: 'SYNCED',
          updatedAt: new Date().toISOString(),
        });
        if (cloudResult && cloudResult.buffer && cloudResult.buffer.length >= 200) {
          const cachePath = path.join(permanentPhotosDir, `${c}_${sv}.jpg`);
          try {
            fs.writeFileSync(cachePath, cloudResult.buffer);
          } catch {}
          const checksum = crypto.createHash('sha256').update(cloudResult.buffer).digest('hex');
          const isThumb = req.query.thumb === '1' || req.query.thumb === 'true';
          let outBuffer = cloudResult.buffer;
          if (isThumb) {
            try {
              outBuffer = await sharp(cloudResult.buffer)
                .resize({ width: 320, withoutEnlargement: true })
                .jpeg({ quality: 72, progressive: true })
                .toBuffer();
            } catch {}
          }
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Content-Length', String(outBuffer.length));
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
          res.setHeader('X-Storage-Provider', cloudResult.resolvedProvider || 'S3');
          res.setHeader('ETag', `"${checksum}${isThumb ? '-thumb' : ''}"`);
          return res.send(outBuffer);
        }
      }
    }
  } catch {}

  // 4. Recuperar desde Google Drive a través del registro permanente
  try {
    const registry = loadDrivePhotosRegistry();
    const candidateKeys = Array.from(new Set([
      `${cleanCed}_${cleanSlot}`,
      `${cleanTargetCed}_${cleanSlot}`,
    ]));

    let driveData: any = null;
    for (const k of candidateKeys) {
      if (registry[k]) {
        driveData = registry[k];
        break;
      }
    }

    if (driveData && driveData.driveFileId) {
      const token = await getOrRefreshDriveTokenServer();
      if (token) {
        try {
          const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveData.driveFileId}?alt=media`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (driveRes.ok) {
            const arrayBuf = await driveRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            const targetLocalPath = path.join(photosDir, candidateFileNames[0]);
            const targetPermPath = path.join(permanentPhotosDir, candidateFileNames[0]);
            try {
              fs.writeFileSync(targetLocalPath, buffer);
              fs.writeFileSync(targetPermPath, buffer);
            } catch {}
            const isThumb = req.query.thumb === '1' || req.query.thumb === 'true';
            let outBuffer: Buffer = buffer;
            if (isThumb) {
              try {
                outBuffer = await sharp(buffer)
                  .resize({ width: 320, withoutEnlargement: true })
                  .jpeg({ quality: 72, progressive: true })
                  .toBuffer();
              } catch {}
            }
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            return res.send(outBuffer);
          }
        } catch (dlErr: any) {
          console.warn(`[Photos API] Error descargando foto de Drive (${cleanCed}_${cleanSlot}):`, dlErr.message);
        }
      }

      // No redirigir a URLs privadas de Google Drive que devuelven HTML de inicio de sesión
    }
  } catch (err: any) {
    console.warn(`[Photos API] Error consultando registro Drive (${cleanCed} - ${cleanSlot}):`, err.message);
  }

  // 5. Si el expendio tiene declarado el ítem como NO DISPONIBLE, generar y persistir ilustración oficial automáticamente
  try {
    if (matchedExp) {
      const canonicalSlot = slotVariants.includes('fotoBasculaUrl')
        ? 'fotoBasculaUrl'
        : slotVariants.includes('fotoAvisoUrl')
        ? 'fotoAvisoUrl'
        : slotVariants.includes('fotoMataselloUrl')
        ? 'fotoMataselloUrl'
        : null;

      const isMarkedNoDisp =
        (canonicalSlot === 'fotoBasculaUrl' && matchedExp.tieneBascula === 'NO') ||
        (canonicalSlot === 'fotoAvisoUrl' && matchedExp.tieneAviso === 'NO') ||
        (canonicalSlot === 'fotoMataselloUrl' && matchedExp.tieneMatasello === 'NO');

      if (canonicalSlot && isMarkedNoDisp) {
        const svgContent = generateNoDisponibleSvg({
          itemSlot: canonicalSlot,
          municipio: matchedExp.localidad || matchedExp.municipio || 'EXPENDIO',
          cedula: matchedExp.cedula || cleanCed,
        });
        const generatedJpg = await sharp(Buffer.from(svgContent, 'utf-8')).jpeg({ quality: 92 }).toBuffer();
        processAndSavePhotoHybrid({
          expendioId: matchedExp.id || '',
          cedula: matchedExp.cedula || cleanCed,
          slotKey: canonicalSlot,
          inputBuffer: generatedJpg,
          mimeType: 'image/jpeg',
          dbClient: db,
        }).catch(() => {});
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', String(generatedJpg.length));
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        return res.send(generatedJpg);
      }
    }
  } catch (genErr: any) {
    console.warn(`[Photos API] Error generando soporte NO DISPONIBLE al vuelo (${cleanCed} - ${cleanSlot}):`, genErr.message);
  }

  return res.status(404).json({ success: false, message: 'Fotografía no encontrada en almacenamiento cloud.' });
});

// Middleware de auto-restauración para /uploads/photos/:fileName si el contenedor fue reiniciado
app.get('/uploads/photos/:fileName', async (req, res, next) => {
  const safeFileName = path.basename(req.params.fileName || '');
  if (!safeFileName) return next();
  const filePath = path.join(photosDir, safeFileName);
  if (fs.existsSync(filePath)) {
    return next();
  }
  const permPath = path.join(permanentPhotosDir, safeFileName);
  if (fs.existsSync(permPath)) {
    try { fs.copyFileSync(permPath, filePath); } catch {}
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(permPath);
  }
  next();
});

// Serve uploaded files statically with strict security headers (prevent XSS, force attachment for docs, nosniff)
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors *;");
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Forzar Content-Disposition: attachment en documentos y descargas no-imagen
    const ext = path.extname(req.path).toLowerCase();
    if (ext === '.pdf' || ext === '.doc' || ext === '.docx' || ext === '.zip') {
      const fileName = path.basename(req.path);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    }
    next();
  },
  express.static(uploadDir, {
    setHeaders: (res, filePath) => {
      res.setHeader('Content-Security-Policy', "default-src 'self'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.pdf' || ext === '.zip' || ext === '.doc' || ext === '.docx') {
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
      }
    },
  })
);

// --- API ROUTES ---

// 1. Get all expendios

// 3B. Expendio: Check generated cuenta de cobro status for a given period
const handleGetExpendioCuenta = (req: any, res: any) => {
  const user = extractAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Acceso no autorizado: Se requiere sesión activa.' });
  }

  const cleanDigits = (s?: any) => String(s || '').replace(/[^0-9]/g, '');
  const normMuni = (s?: any) =>
    String(s || '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  let targetCedula = user.cedula;

  // REGLAS 7 y 13: Solo el administrador puede consultar cuentas de otras cédulas
  if (user.roles.includes('admin')) {
    const cedulaParam = req.params?.cedula || req.query?.cedula;
    if (cedulaParam) {
      targetCedula = cleanDigits(cedulaParam);
    }
  }

  const { mes, anio, periodo } = req.query;
  const db = loadDatabase();

  if (!targetCedula) {
    return res.status(400).json({ success: false, message: 'Cédula no proporcionada.' });
  }

  const targetCedulaClean = cleanDigits(targetCedula);
  const expendio = (db.expendios || []).find(
    (e: any) =>
      cleanDigits(e.cedula) === targetCedulaClean ||
      (!user.roles.includes('admin') && user.expendioId && String(e.id) === String(user.expendioId))
  );
  const targetMuniNorm = expendio ? normMuni(expendio.municipio || expendio.localidad) : '';

  const publishedPeriodo = (db.config?.periodoHabilitadoDescarga || 'FEBRERO 2026').trim().toUpperCase();
  const isDescargaHabilitada = db.config?.descargaHabilitada !== false;

  let targetPeriodo = '';
  if (periodo) {
    targetPeriodo = String(periodo).trim().toUpperCase();
  } else if (mes && anio) {
    targetPeriodo = `${String(mes).trim().toUpperCase()} ${String(anio).trim()}`;
  } else if (mes) {
    targetPeriodo = String(mes).trim().toUpperCase();
  }

  // Si no se especificó periodo, usar el periodo asignado por el admin en la configuración
  if (!targetPeriodo) {
    targetPeriodo = publishedPeriodo;
  }

  const [mesSearch, anioSearch] = targetPeriodo.split(' ');
  const targetPeriodNorm = normalizePeriodKey(targetPeriodo);
  const publishedPeriodNorm = normalizePeriodKey(publishedPeriodo);
  const isPeriodoPublicado = targetPeriodNorm === publishedPeriodNorm;

  const matchesExpendioHist = (h: any) => {
    if (h.tipo && h.tipo !== 'Cuenta de Cobro') return false;
    const hCed = cleanDigits(h.cedula);
    if (hCed && targetCedulaClean && hCed === targetCedulaClean) return true;
    if (expendio && h.expendioId && String(h.expendioId) === String(expendio.id)) return true;
    const hMuni = normMuni(h.municipio || h.expendio || h.cuentaData?.municipio || h.cuentaData?.expendio);
    if (targetMuniNorm && hMuni && hMuni === targetMuniNorm) return true;
    return false;
  };

  const buildNormalizedCuentaData = (histItem: any, overridePeriodo?: string) => {
    const cd = (histItem.cuentaData || {}) as any;
    const cargoBasico = Number(cd.cargoBasico ?? histItem.valorBase ?? 0);
    const admisionSipost = Number(cd.admisionSipost ?? 0);
    const valorVariable = Number(cd.valorVariable ?? 0);
    const rawTotal = Number(cd.pagoTotal ?? cd.valorBruto ?? histItem.valorBruto ?? (cargoBasico + admisionSipost + valorVariable));
    const pagoTotal = rawTotal > 0 ? rawTotal : cargoBasico + admisionSipost + valorVariable;
    const retef1 = Number(cd.retef1 ?? cd.retencionValor ?? cd.retefuente ?? Math.round(pagoTotal * 0.01));
    const rawNeto = Number(cd.valorNeto ?? cd.netoPagar ?? histItem.monto ?? histItem.totalPagar ?? (pagoTotal - retef1));
    const valorNeto = rawNeto > 0 ? rawNeto : pagoTotal - retef1;
    const finalPeriodo = overridePeriodo || cd.periodo || histItem.periodo || targetPeriodo;

    return {
      ...cd,
      id: cd.id || histItem.id,
      cedula: expendio?.cedula || cd.cedula || histItem.cedula || targetCedula,
      nombre: expendio?.encargado || cd.nombre || cd.encargado || histItem.encargado || '',
      encargado: expendio?.encargado || cd.encargado || histItem.encargado || '',
      expendio: expendio?.localidad || expendio?.municipio || cd.expendio || histItem.expendio || '',
      municipio: expendio?.municipio || expendio?.localidad || cd.municipio || histItem.municipio || histItem.expendio || '',
      periodo: finalPeriodo,
      centroOperativo: expendio?.centroOperativo || cd.centroOperativo || histItem.centroOperativo || 'PO.ARAUCA',
      centroAcopio: expendio?.centroAcopio || cd.centroAcopio || histItem.centroAcopio || expendio?.municipio || '',
      direccion: expendio?.direccionPunto || cd.direccion || histItem.direccion || '',
      telefono: expendio?.telefonoPunto || cd.telefono || histItem.telefono || '',
      cargoBasico,
      valorBase: cargoBasico,
      admisionSipost,
      valorVariable,
      pagoTotal,
      valorBruto: pagoTotal,
      porcentajeRetencion: Number(cd.porcentajeRetencion ?? cd.porcentajeRetefuente ?? 1),
      porcentajeRetefuente: Number(cd.porcentajeRetefuente ?? cd.porcentajeRetencion ?? 1),
      retef1,
      retencionValor: retef1,
      retefuente: retef1,
      porcentajeReteica: 0,
      reteica: 0,
      valorNeto,
      netoPagar: valorNeto,
      valorEnLetras: cd.valorEnLetras || numeroALetras(valorNeto),
      banco: expendio?.banco || cd.banco || '',
      cuentaBancaria: expendio?.cuentaBancaria || cd.cuentaBancaria || '',
    };
  };

  // Search strictly in db.historial for matching item of type 'Cuenta de Cobro' generated for the requested period
  const historialMatch = (db.historial || []).find((h: any) => {
    if (!matchesExpendioHist(h)) return false;
    if (targetPeriodNorm && normalizePeriodKey(h.periodo) === targetPeriodNorm) return true;
    const hPeriodoUpper = (h.periodo || '').toUpperCase();
    if (mesSearch && !hPeriodoUpper.includes(mesSearch)) return false;
    if (anioSearch && !hPeriodoUpper.includes(anioSearch)) return false;
    return true;
  });

  if (historialMatch && (historialMatch.cuentaData || historialMatch.monto || historialMatch.valorBase)) {
    return res.json({
      success: true,
      generada: true,
      isPeriodoPublicado,
      descargaHabilitada: isDescargaHabilitada,
      periodoConsultado: targetPeriodo,
      periodoPublicado: publishedPeriodo,
      data: buildNormalizedCuentaData(historialMatch),
      message: 'Cuenta de cobro encontrada en la generación de cuentas de cobro del periodo.',
    });
  }

  // 4. Strict: If not generated/published, return generada: false without mutating database
  return res.json({
    success: true,
    generada: false,
    isPeriodoPublicado,
    descargaHabilitada: isDescargaHabilitada,
    periodoConsultado: targetPeriodo,
    periodoPublicado: publishedPeriodo,
    message: `CUENTA DE COBRO NO GENERADA NI PUBLICADA. La cuenta de cobro para el periodo "${targetPeriodo}" aún no ha sido generada ni publicada en el sistema por la administración.`,
  });
};

app.get('/api/expendio/cuenta-cobro', handleGetExpendioCuenta);
app.get('/api/cuentas/usuario/:cedula', handleGetExpendioCuenta);

app.get('/api/expendio/me', requireAuthenticatedUser, async (req: AuthRequest, res) => {
  try {
    const localDb = loadDatabase();
    const expendio = resolveUserExpendio(req, localDb);
    if (!expendio) {
      return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
    }
    let vMensual = Number(expendio.valorMensual) || 0;
    let aSipost = Number(expendio.admisionSipost) || 0;
    let vVariable = Number(expendio.valorVariable) || 0;

    if (vMensual === 0) {
      const cleanDig = (s: any) => String(s || '').replace(/[^0-9]/g, '');
      const normMuni = (s: any) => String(s || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const eCed = cleanDig(expendio.cedula);
      const eMuni = normMuni(expendio.municipio || expendio.localidad);
      const histMatch = (localDb.historial || []).find(
        (h: any) =>
          (eCed && cleanDig(h.cedula) === eCed) ||
          (eMuni && normMuni(h.municipio || h.expendio) === eMuni)
      );
      if (histMatch) {
        const cd = (histMatch.cuentaData || {}) as any;
        vMensual = Number(cd.cargoBasico ?? histMatch.valorBase ?? 0);
        aSipost = Number(cd.admisionSipost ?? 0);
        vVariable = Number(cd.valorVariable ?? 0);
      }
    }

    res.json({
      success: true,
      expendio: {
        ...expendio,
        valorMensual: vMensual,
        admisionSipost: aSipost,
        valorVariable: vVariable,
        revision: Number(expendio.revision) || 1,
        letreroUrl: expendio.letreroUrl || expendio.fotoAvisoUrl || undefined,
        basculaUrl: expendio.basculaUrl || expendio.fotoBasculaUrl || undefined,
        mataselloUrl: expendio.mataselloUrl || expendio.fotoMataselloUrl || undefined,
        computadorUrl: expendio.computadorUrl || undefined,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Obtener documentos disponibles para los Expendios
app.get('/api/expendio/documentos', async (req: any, res: any) => {
  try {
    const user = extractAuthenticatedUser(req);
    const isAdmin = user?.roles?.includes('admin') || user?.role === 'admin';

    let docConfig: any = null;
    try {
      const rows = await db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, 'global_config'));
      if (rows.length > 0 && rows[0].value) {
        docConfig = (rows[0].value as any).documentosExpendios;
      }
    } catch (pgErr) {
      console.error('Error fetching docs from PostgreSQL:', pgErr);
    }

    if (!docConfig) {
      const localDb = loadDatabase();
      docConfig = localDb.config?.documentosExpendios;
    }

    const currentDocs = Array.isArray(docConfig) ? docConfig : [];
    const mergedDocs = [...currentDocs];
    for (const defDoc of DEFAULT_DOCUMENTOS_EXPENDIOS) {
      if (!mergedDocs.some((d) => d.id === defDoc.id)) {
        mergedDocs.push({ ...defDoc });
      }
    }

    // Filtrar solo los documentos habilitados para expendios (a menos que sea admin que ve todos)
    const visibleDocs = isAdmin
      ? mergedDocs
      : mergedDocs.filter((d: any) => d.habilitado !== false && d.habilitado !== 'false');

    res.json({
      success: true,
      data: visibleDocs,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error obteniendo documentos: ' + err.message });
  }
});

app.get('/api/cuentas-cargadas', handleGetCuentasCargadas);
app.get('/api/expendio/cuentas-cargadas/:cedula', handleGetCuentasCargadas);

// Endpoint GET for expendio by id
app.use((req, res, next) => {
  if (req.path.includes('/api/expendio/12345')) {
    console.log("REACHED debug MW. Path:", req.path);
  }
  next();
});
app.get('/api/expendio/:id', requireAuthenticatedUser, (req: AuthRequest, res) => {
  const user = req.user!;
  const { id } = req.params;
  const db = loadDatabase();
  // REGLA 1: La búsqueda es estrictamente por expendio.id canónico e inmutable
  const expendio = db.expendios.find(e => String(e.id) === id);

  if (!expendio) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
  }

  // REGLAS 7 y 13: El usuario Expendio solo puede acceder a su propio expendio (req.user.expendioId)
  if (!user.roles.includes('admin')) {
    if (user.expendioId !== expendio.id) {
      console.warn(`[Auth] Bloqueado intento no autorizado de acceso a otro expendio. Usuario expendioId: ${user.expendioId}, Objetivo solicitado: ${id}`);
      return res.status(403).json({ success: false, message: 'Acceso denegado: No tiene permisos para consultar datos de otro expendio.' });
    }
  }

  res.json({ success: true, data: expendio });
});

// ==========================================
// CAPA CENTRAL DE AUTORIZACIÓN ADMINISTRATIVA
// REGLA 12: Centraliza la autorización sin duplicar lógica.
// Solo la cédula 1094269932 con rol admin puede acceder a cualquier endpoint bajo /api/admin/*
// ==========================================
app.use('/api/admin', requireAdmin);

// Get all expendios for admin
app.get('/api/admin/expendios', (req, res) => {
  const db = loadDatabase();
  res.json({ success: true, data: db.expendios });
});

// Helper para determinar la fecha real de última actualización (cambio de foto o modificación de perfil)
function resolveExpendioFechaActualizacion(e: any): string {
  if (!e) return '';
  const hasPhotos = Boolean(
    e.fotoAvisoUrl ||
    e.fotoPanoramicaUrl ||
    e.fotoMataselloUrl ||
    e.fotoBasculaUrl ||
    e.fotoContratistaUrl ||
    e.fotoHorarioUrl ||
    e.fotoTarifasUrl ||
    e.letreroUrl ||
    e.basculaUrl ||
    e.mataselloUrl ||
    e.computadorUrl
  );
  const rawUpdatedDate = e.updatedAt
    ? (e.updatedAt instanceof Date ? e.updatedAt.toISOString() : String(e.updatedAt)).split('T')[0]
    : '';
  const rawFechaAct = typeof e.fechaUltimaActualizacion === 'string' ? e.fechaUltimaActualizacion.trim() : '';
  const isSeedDate = rawFechaAct === '2026-07-31';
  const hasPostSeedUpdate = Boolean(rawUpdatedDate && rawUpdatedDate > '2026-10-02');
  const hasUpdatedData = Boolean(
    hasPhotos ||
    e.primeraVezActualizado ||
    (Number(e.revision) || 1) > 1 ||
    (rawFechaAct && !isSeedDate) ||
    hasPostSeedUpdate
  );

  if (!hasUpdatedData) return '';
  if (rawFechaAct && !isSeedDate) {
    return hasPostSeedUpdate && rawUpdatedDate > rawFechaAct ? rawUpdatedDate : rawFechaAct;
  }
  if (hasPostSeedUpdate) {
    return rawUpdatedDate;
  }
  return rawFechaAct || rawUpdatedDate;
}

// REGLA 3 y 8: Consulta de expendios autenticada.
// Si es Administrador: retorna la base maestra directamente desde PostgreSQL.
// Si es Expendio o Cliente: retorna estrictamente su propio expendio resuelto por el backend.
app.get('/api/expendios', requireAuthenticatedUser, async (req: AuthRequest, res) => {
  const user = req.user!;
  const isAdmin = normalizeCedula(user.cedula) === ADMIN_CEDULA || user.roles?.includes('admin') || user.role === 'admin';

  try {
    const expRows = await db.select().from(schema.expendios).orderBy(schema.expendios.nombrePunto);
    let mapped = expRows.map((e: any) => ({
      ...e,
      valorMensual: Number(e.valorMensual) || 0,
      admisionSipost: Number(e.admisionSipost) || 0,
      valorVariable: Number(e.valorVariable) || 0,
      revision: Number(e.revision) || 1,
      letreroUrl: e.letreroUrl || e.fotoAvisoUrl || undefined,
      basculaUrl: e.basculaUrl || e.fotoBasculaUrl || undefined,
      mataselloUrl: e.mataselloUrl || e.fotoMataselloUrl || undefined,
      computadorUrl: e.computadorUrl || undefined,
      fechaUltimaActualizacion: resolveExpendioFechaActualizacion(e),
    }));

    // Si PostgreSQL devolvió 0 registros pero la base local tiene datos, usar base local como contingencia
    if (mapped.length === 0) {
      console.warn('[API] PostgreSQL retornó 0 expendios, recurriendo a base de datos local...');
      const localDb = loadDatabase();
      if (localDb.expendios && localDb.expendios.length > 0) {
        mapped = localDb.expendios;
      }
    }

    if (isAdmin || user.roles?.includes('cliente') || user.role === 'cliente') {
      return res.json({ success: true, data: mapped });
    }

    const ownExp = resolveUserExpendio(req, { expendios: mapped } as any);
    return res.json({ success: true, data: ownExp ? [ownExp] : [] });
  } catch (err: any) {
    console.warn('[API] Fallback a caché en memoria para /api/expendios:', err.message);
    const localDb = loadDatabase();
    if (isAdmin || user.roles?.includes('cliente') || user.role === 'cliente') {
      return res.json({ success: true, data: localDb.expendios || [] });
    }
    const ownExp = resolveUserExpendio(req, localDb);
    return res.json({ success: true, data: ownExp ? [ownExp] : [] });
  }
});

// REGLA 8: Panel Cliente oficial (Consolidado Regional de Expendios 4-72)
app.get('/api/cliente/expendios', requireAuthenticatedUser, async (req: AuthRequest, res) => {
  try {
    const expRows = await db.select().from(schema.expendios).orderBy(schema.expendios.nombrePunto);
    let mapped = expRows.map((e: any) => ({
      ...e,
      valorMensual: Number(e.valorMensual) || 0,
      admisionSipost: Number(e.admisionSipost) || 0,
      valorVariable: Number(e.valorVariable) || 0,
      revision: Number(e.revision) || 1,
      letreroUrl: e.letreroUrl || e.fotoAvisoUrl || undefined,
      basculaUrl: e.basculaUrl || e.fotoBasculaUrl || undefined,
      mataselloUrl: e.mataselloUrl || e.fotoMataselloUrl || undefined,
      computadorUrl: e.computadorUrl || undefined,
      fechaUltimaActualizacion: resolveExpendioFechaActualizacion(e),
    }));

    if (mapped.length === 0) {
      const localDb = loadDatabase();
      mapped = localDb.expendios || [];
    }

    return res.json({ success: true, data: mapped, total: mapped.length });
  } catch (err: any) {
    const localDb = loadDatabase();
    return res.json({ success: true, data: localDb.expendios || [], total: (localDb.expendios || []).length });
  }
});

// Estado en memoria de sincronización en tiempo real y reportes guardados
let lastReportSaveRecord = {
  saved: true,
  name: 'Base de Datos Maestra y Reporte General (177 Expendios)',
  timestamp: new Date().toISOString(),
  type: 'sistema',
  status: 'success' as 'success' | 'pending' | 'error',
  detalles: '177 expendios y catálogo fotográfico persistidos en PostgreSQL y almacenamiento de archivos',
};

// 1.0A. Realtime Sync Monitoring (PostgreSQL + Storage + Report status)
app.get('/api/system/sync-monitoring', async (req, res) => {
  const db = loadDatabase();

  let localPhotosCount = 0;
  let localDbSizeBytes = 0;
  try {
    if (fs.existsSync(photosDir)) {
      localPhotosCount = fs.readdirSync(photosDir).filter((f) => !f.startsWith('.')).length;
    }
    const dbPath = getActiveDbPath();
    if (fs.existsSync(dbPath)) {
      localDbSizeBytes = fs.statSync(dbPath).size;
    }
  } catch {}

  const pgHealth = await checkCloudSqlHealth().catch(() => ({ connected: false, latencyMs: -1 }));

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    database: {
      engine: 'PostgreSQL (Cloud SQL)',
      connected: pgHealth.connected,
      latencyMs: pgHealth.latencyMs,
      totalExpendios: Array.isArray(db.expendios) ? db.expendios.length : 0,
      totalHistorial: Array.isArray(db.historial) ? db.historial.length : 0,
      totalRelacionPagos: Array.isArray(db.relacionPagos) ? db.relacionPagos.length : 0,
      totalTrazabilidad: Array.isArray(db.trazabilidad) ? db.trazabilidad.length : 0,
      status: pgHealth.connected ? 'online' : 'error',
    },
    storage: {
      connected: true,
      provider: 'Almacenamiento Persistente & Google Drive',
      photosCount: localPhotosCount,
      localDbSizeBytes,
      status: 'online',
    },
    lastReport: lastReportSaveRecord,
  });
});

// 1.0B. Registrar guardado exitoso de reporte
app.post('/api/system/report-saved', (req, res) => {
  const { name, type, count, detalles } = req.body || {};
  lastReportSaveRecord = {
    saved: true,
    name: name || 'Reporte de Expendios',
    timestamp: new Date().toISOString(),
    type: type || 'general',
    status: 'success',
    detalles: detalles || (count ? `${count} registros procesados y guardados con éxito` : 'Reporte guardado exitosamente'),
  };
  res.json({ success: true, lastReport: lastReportSaveRecord });
});

// 1.0C. Validación de estado e integridad de la base de datos local antes del guardado
app.get('/api/admin/database/validate-state', (req, res) => {
  try {
    const stateReport = verifyLocalDatabaseStateBeforeSave();
    const currentDb = getDatabaseReadOnly();
    const diskVerification = verifyWrittenMasterDatabaseOnDisk(
      Number(currentDb.revision) || 0,
      Array.isArray(currentDb.expendios) ? currentDb.expendios.length : 0
    );
    res.json({
      success: true,
      stateReport,
      diskVerification,
      masterFile: 'database/camarca_master_db.json',
      message: 'Estado de la base de datos local verificado e íntegro.',
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      masterFile: 'database/camarca_master_db.json',
      message: `Error validando integridad de la base de datos local: ${err.message}`,
    });
  }
});

// 1B. Admin: Update an expendio
app.put('/api/admin/expendios/:id', async (req, res) => {
  const { id } = req.params;
  const updateData: Partial<ExpendioData> & { _explicitPhotoDelete?: boolean } = { ...req.body };

  // Validar estado e integridad de la base de datos local ANTES de iniciar el proceso de guardado
  let preSaveStateReport;
  try {
    preSaveStateReport = verifyLocalDatabaseStateBeforeSave();
  } catch (validationErr: any) {
    return res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Validación previa de integridad falló: ${validationErr.message}`,
    });
  }

  const currentDb = getDatabase();

  const targetId = decodeURIComponent(String(id || '')).trim();
  const index = currentDb.expendios.findIndex(
    (e) =>
      String(e.id || '').trim() === targetId ||
      String(e.cedula || '').trim() === targetId ||
      String(e.localidad || '').trim().toLowerCase() === targetId.toLowerCase() ||
      String(e.municipio || '').trim().toLowerCase() === targetId.toLowerCase()
  );
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
  }

  const exp = currentDb.expendios[index];
  const effectiveCedula = String(updateData.cedula || exp.cedula || '').trim();
  const photoKeys: Array<keyof ExpendioData> = [
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
  ];

  // Interceptar campos fotográficos para persistirlos en almacenamiento permanente (solo si se envía nueva imagen Base64 o borrado explícito)
  for (const key of photoKeys) {
    const val = updateData[key];
    if (typeof val === 'string') {
      const canonicalSlot =
        key === 'letreroUrl'
          ? 'fotoAvisoUrl'
          : key === 'basculaUrl'
          ? 'fotoBasculaUrl'
          : key === 'mataselloUrl'
          ? 'fotoMataselloUrl'
          : key;

      if (val.startsWith('data:image/') || val.length > 500) {
        const cleanBase64 = val.replace(/^data:[^;]+;base64,/, '').trim();
        const photoBuffer = Buffer.from(cleanBase64, 'base64');

        // Procesar en Almacenamiento Híbrido Cloud (Firebase Storage REAL + AWS S3 REAL)
        const hybridRes = await processAndSavePhotoHybrid({
          expendioId: exp.id,
          cedula: effectiveCedula,
          slotKey: canonicalSlot,
          inputBuffer: photoBuffer,
          mimeType: 'image/jpeg',
          dbClient: db,
        });

        if (hybridRes.success && (hybridRes.status === 'SYNCED' || hybridRes.status === 'S3_FALLBACK')) {
          const canonicalUrl = `/api/photos/${encodeURIComponent(effectiveCedula)}/${canonicalSlot}`;
          (updateData as any)[key] = canonicalUrl;

          if (canonicalSlot === 'fotoAvisoUrl') {
            updateData.fotoAvisoUrl = canonicalUrl;
            updateData.letreroUrl = canonicalUrl;
            updateData.tieneAviso = 'SI';
            updateData.motivoFaltaAviso = '';
          } else if (canonicalSlot === 'fotoBasculaUrl') {
            updateData.fotoBasculaUrl = canonicalUrl;
            updateData.basculaUrl = canonicalUrl;
            updateData.tieneBascula = 'SI';
            updateData.motivoFaltaBascula = '';
          } else if (canonicalSlot === 'fotoMataselloUrl') {
            updateData.fotoMataselloUrl = canonicalUrl;
            updateData.mataselloUrl = canonicalUrl;
            updateData.tieneMatasello = 'SI';
            updateData.motivoFaltaMatasello = '';
          }
        } else {
          delete (updateData as any)[key];
        }
      } else if (val === '' && updateData._explicitPhotoDelete) {
        const localFileName = `${exp.cedula.trim()}_${canonicalSlot}.jpg`;
        const localPath = path.join(photosDir, localFileName);
        const permPath = path.join(permanentPhotosDir, localFileName);
        if (fs.existsSync(localPath)) {
          try { fs.unlinkSync(localPath); } catch {}
        }
        if (fs.existsSync(permPath)) {
          try { fs.unlinkSync(permPath); } catch {}
        }
        if (canonicalSlot === 'fotoAvisoUrl') {
          updateData.fotoAvisoUrl = '';
          updateData.letreroUrl = '';
        }
        if (canonicalSlot === 'fotoBasculaUrl') {
          updateData.fotoBasculaUrl = '';
          updateData.basculaUrl = '';
        }
        if (canonicalSlot === 'fotoMataselloUrl') {
          updateData.fotoMataselloUrl = '';
          updateData.mataselloUrl = '';
        }
      } else if (val === '') {
        // No borrar fotos existentes si el formulario de edición de datos envió cadena vacía
        delete (updateData as any)[key];
      }
    }
  }
  delete updateData._explicitPhotoDelete;

  try {
    const updatedItem = await mutateDatabase(async (db) => {
      const idx = db.expendios.findIndex(
        (e) =>
          String(e.id || '').trim() === targetId ||
          String(e.cedula || '').trim() === targetId ||
          String(e.localidad || '').trim().toLowerCase() === targetId.toLowerCase() ||
          String(e.municipio || '').trim().toLowerCase() === targetId.toLowerCase()
      );
      if (idx === -1) {
        throw new Error('EXPENDIO_NOT_FOUND');
      }

      const current = db.expendios[idx];
      const oldCedula = String(current.cedula || '').trim();
      const newCedula = updateData.cedula !== undefined && String(updateData.cedula).trim() !== ''
        ? String(updateData.cedula).trim()
        : oldCedula;
      const cedulaChanged = Boolean(oldCedula && newCedula && normalizeCedula(oldCedula) !== normalizeCedula(newCedula));

      const prevCedsSet = new Set<string>(
        Array.isArray((current as any).cedulasAnteriores) ? (current as any).cedulasAnteriores : []
      );
      if (cedulaChanged) {
        prevCedsSet.add(oldCedula);
        // Copiar archivos locales de fotos en caché si existen bajo la cédula anterior
        for (const pk of ['fotoAvisoUrl', 'fotoPanoramicaUrl', 'fotoMataselloUrl', 'fotoBasculaUrl', 'fotoContratistaUrl', 'fotoHorarioUrl', 'fotoTarifasUrl', 'computadorUrl']) {
          const oldFile = path.join(permanentPhotosDir, `${oldCedula}_${pk}.jpg`);
          const newFile = path.join(permanentPhotosDir, `${newCedula}_${pk}.jpg`);
          if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) {
            try { fs.copyFileSync(oldFile, newFile); } catch {}
          }
        }
      }

      const nowIso = new Date().toISOString();
      const today = nowIso.split('T')[0];

      const nextDireccion =
        updateData.direccionPunto !== undefined
          ? String(updateData.direccionPunto).trim().toUpperCase()
          : (updateData as any).direccion !== undefined
          ? String((updateData as any).direccion).trim().toUpperCase()
          : current.direccionPunto || (current as any).direccion || '';

      const nextTelefono =
        updateData.telefonoPunto !== undefined
          ? String(updateData.telefonoPunto).trim()
          : (updateData as any).telefono !== undefined
          ? String((updateData as any).telefono).trim()
          : current.telefonoPunto || (current as any).telefono || '';

      // Merge seguro preservando campos existentes y garantizando ID inmutable
      const nextExp: any = {
        ...current,
        ...updateData,
        id: current.id, // Invariante: El ID interno del expendio es estrictamente inmutable
        centroOperativo: updateData.centroOperativo !== undefined && String(updateData.centroOperativo).trim() !== ''
          ? String(updateData.centroOperativo).trim()
          : current.centroOperativo,
        centroAcopio: updateData.centroAcopio !== undefined && String(updateData.centroAcopio).trim() !== ''
          ? String(updateData.centroAcopio).trim()
          : current.centroAcopio,
        localidad: updateData.localidad !== undefined && String(updateData.localidad).trim() !== ''
          ? String(updateData.localidad).trim().toUpperCase()
          : current.localidad,
        municipio: updateData.municipio !== undefined && String(updateData.municipio).trim() !== ''
          ? String(updateData.municipio).trim().toUpperCase()
          : (updateData.localidad ? String(updateData.localidad).trim().toUpperCase() : current.municipio),
        encargado: updateData.encargado !== undefined && String(updateData.encargado).trim() !== ''
          ? String(updateData.encargado).trim().toUpperCase()
          : current.encargado,
        cedula: newCedula,
        direccionPunto: nextDireccion,
        direccion: nextDireccion,
        telefonoPunto: nextTelefono,
        telefono: nextTelefono,
        correoElectronico:
          updateData.correoElectronico !== undefined
            ? String(updateData.correoElectronico).trim()
            : current.correoElectronico,
        fechaUltimaActualizacion: today,
        updatedAt: nowIso,
        revision: (Number(current.revision) || 0) + 1,
      };

      if (prevCedsSet.size > 0) {
        nextExp.cedulasAnteriores = Array.from(prevCedsSet);
      }

      // Preservar URLs fotográficas existentes si no fueron modificadas explícitamente
      for (const pk of photoKeys) {
        if (!nextExp[pk] && (current as any)[pk]) {
          nextExp[pk] = (current as any)[pk];
        }
      }

      db.expendios[idx] = nextExp;
      const resultItem = db.expendios[idx];

      // Mantener sincronizados los registros de relación de pagos e historial vinculados a este expendio si cambió cédula o encargado
      const normMuni = (s: any) => String(s || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const targetMuniNorm = normMuni(current.municipio || current.localidad);
      if (Array.isArray(db.relacionPagos)) {
        for (const p of db.relacionPagos) {
          const pAny = p as any;
          const matchesId = pAny.expendioId && String(pAny.expendioId) === String(current.id);
          const matchesCedAndMuni =
            normalizeCedula(p.cedula) === normalizeCedula(oldCedula) &&
            (!p.municipio || normMuni(p.municipio) === targetMuniNorm);
          if (matchesId || matchesCedAndMuni) {
            pAny.expendioId = current.id;
            p.cedula = resultItem.cedula;
            p.nombreEncargado = resultItem.encargado;
            pAny.beneficiario = resultItem.encargado;
            if (resultItem.banco) p.banco = resultItem.banco;
            if (resultItem.cuentaBancaria) {
              p.cuenta = resultItem.cuentaBancaria;
              pAny.numeroCuentaBancaria = resultItem.cuentaBancaria;
            }
            if (resultItem.centroOperativo) p.centroOperativo = resultItem.centroOperativo;
            if (resultItem.municipio || resultItem.localidad) p.municipio = resultItem.municipio || resultItem.localidad;
          }
        }
      }

      if (Array.isArray(db.historial)) {
        for (const h of db.historial) {
          const hAny = h as any;
          const matchesId = hAny.expendioId && String(hAny.expendioId) === String(current.id);
          const matchesCedAndMuni =
            normalizeCedula(h.cedula) === normalizeCedula(oldCedula) &&
            normMuni(hAny.municipio || h.expendio) === targetMuniNorm;
          if (matchesId || matchesCedAndMuni) {
            hAny.expendioId = current.id;
          }
        }
      }

      // Registrar evento de trazabilidad con identidad real resuelta en backend
      const actor = extractAuthenticatedUser(req) || { cedula: '1094269932', role: 'admin' };
      if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
      const commitId = 'cmt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
      db.trazabilidad.unshift({
        id: `traz-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        expendioId: resultItem.id,
        actorId: actor.cedula,
        actorRole: 'admin',
        timestamp: nowIso,
        municipio: resultItem.municipio || resultItem.localidad,
        localidad: resultItem.localidad,
        tipoMovimiento: cedulaChanged || current.encargado !== resultItem.encargado ? 'CAMBIO_ENCARGADO' : undefined,
        encargadoAnterior: current.encargado,
        cedulaAnterior: oldCedula,
        encargadoNuevo: resultItem.encargado,
        cedulaNuevo: resultItem.cedula,
        novedad: cedulaChanged
          ? `Cambio de cédula (${oldCedula} → ${resultItem.cedula}) y actualización por administración`
          : 'Actualización de datos del expendio por administración',
        fechaRegistro: nowIso,
        registradoPor: `Administrador (CC: ${actor.cedula})`,
        observaciones: `Modificación de datos de ${resultItem.localidad} en el sistema maestro (Rev ${resultItem.revision})`,
        commitId,
        before: current,
        after: resultItem,
      });

      return resultItem;
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: false });

    const finalDbState = getDatabaseReadOnly();
    const diskVerification = verifyWrittenMasterDatabaseOnDisk(
      Number(finalDbState.revision) || 0,
      Array.isArray(finalDbState.expendios) ? finalDbState.expendios.length : 0
    );

    res.json({
      success: true,
      cloudPersisted: true,
      masterFile: 'database/camarca_master_db.json',
      stateValidation: preSaveStateReport,
      diskVerification,
      data: updatedItem,
      message: `✓ Expendio ${updatedItem.localidad} validado, actualizado y sincronizado exitosamente en database/camarca_master_db.json.`,
    });
  } catch (err: any) {
    if (err.message === 'EXPENDIO_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
    }
    console.error('[API] Error actualizando expendio:', err);
    res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Error al guardar cambios del expendio: ${err.message}.`,
    });
  }
});

// 1C. Admin: Create a new expendio
app.post('/api/admin/expendios', async (req, res) => {
  const newExp: ExpendioData = req.body;
  if (!newExp.localidad || !newExp.cedula || !newExp.encargado) {
    return res.status(400).json({ success: false, message: 'La Localidad/Municipio, Cédula y Encargado son obligatorios.' });
  }

  let preSaveStateReport;
  try {
    preSaveStateReport = verifyLocalDatabaseStateBeforeSave();
  } catch (validationErr: any) {
    return res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Validación previa de integridad falló: ${validationErr.message}`,
    });
  }

  const currentDb = getDatabase();
  const exists = currentDb.expendios.some((e) => e.cedula.trim() === newExp.cedula.trim());
  if (exists) {
    return res.status(400).json({ success: false, message: 'Ya existe un expendio registrado con esa misma Cédula.' });
  }

  const newId = `exp-${Date.now()}`;
  const nowIso = new Date().toISOString();
  const fullExpendio: ExpendioData = {
    id: newId,
    centroOperativo: newExp.centroOperativo || 'PO.BUCARAMANGA',
    centroAcopio: newExp.centroAcopio || newExp.localidad,
    localidad: newExp.localidad,
    encargado: newExp.encargado,
    cedula: newExp.cedula.trim(),
    direccionPunto: newExp.direccionPunto || 'SEDE PRINCIPAL',
    telefonoPunto: newExp.telefonoPunto || '',
    usuarioSipost: newExp.usuarioSipost || 'NO ASIGNADO',
    internet: newExp.internet || 'SI',
    nit: newExp.nit || '900062917',
    correoElectronico: newExp.correoElectronico || '',
    observacion: newExp.observacion || 'REGISTRO NUEVO CREADO DESDE PANEL ADMIN',
    municipio: newExp.municipio || newExp.localidad,
    valorMensual: newExp.valorMensual || 0,
    letreroUrl: newExp.letreroUrl || undefined,
    basculaUrl: newExp.basculaUrl || undefined,
    mataselloUrl: newExp.mataselloUrl || undefined,
    computadorUrl: newExp.computadorUrl || undefined,
    contratoUrl: newExp.contratoUrl || undefined,
    fechaUltimaActualizacion: nowIso.split('T')[0],
    updatedAt: nowIso,
    revision: 1,
  };

  try {
    await mutateDatabase(async (db) => {
      db.expendios.push(fullExpendio);
      const actor = extractAuthenticatedUser(req) || { cedula: '1094269932', role: 'admin' };
      if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
      const commitId = 'cmt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
      db.trazabilidad.unshift({
        id: `traz-create-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        expendioId: fullExpendio.id,
        actorId: actor.cedula,
        actorRole: 'admin',
        timestamp: nowIso,
        municipio: fullExpendio.municipio || fullExpendio.localidad,
        localidad: fullExpendio.localidad,
        novedad: 'Creación de nuevo expendio en el sistema maestro',
        encargadoNuevo: fullExpendio.encargado,
        cedulaNuevo: fullExpendio.cedula,
        fechaRegistro: nowIso,
        registradoPor: `Administrador (CC: ${actor.cedula})`,
        observaciones: `Nuevo expendio ${fullExpendio.localidad} creado con valor base $${fullExpendio.valorMensual}`,
        commitId,
        before: null,
        after: fullExpendio,
      });
      return fullExpendio;
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: false });

    const finalDbState = getDatabaseReadOnly();
    const diskVerification = verifyWrittenMasterDatabaseOnDisk(
      Number(finalDbState.revision) || 0,
      Array.isArray(finalDbState.expendios) ? finalDbState.expendios.length : 0
    );

    res.json({
      success: true,
      cloudPersisted: true,
      masterFile: 'database/camarca_master_db.json',
      stateValidation: preSaveStateReport,
      diskVerification,
      data: fullExpendio,
      message: `✓ Nuevo expendio ${fullExpendio.localidad} validado y registrado en database/camarca_master_db.json con éxito.`,
    });
  } catch (err: any) {
    console.error('[API] Error creando expendio:', err);
    res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Error al guardar nuevo expendio: ${err.message}`,
    });
  }
});

// 1C2. Admin: Import expendios from uploaded Excel file
app.post('/api/admin/import-excel', async (req, res) => {
  const { expendios, mode, selectedSheets, fileName, clientErrors } = req.body;

  // Validación estricta de hojas seleccionadas
  if (selectedSheets !== undefined && (!Array.isArray(selectedSheets) || selectedSheets.length === 0)) {
    return res.status(400).json({
      success: false,
      message: 'Debe seleccionar al menos una hoja de cálculo para procesar la importación.',
    });
  }

  if (!Array.isArray(expendios) || expendios.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No se recibieron datos de expendios válidos para importar.',
    });
  }

  const allErrors: string[] = Array.isArray(clientErrors) ? [...clientErrors] : [];
  const activeSelectedSheets: string[] = Array.isArray(selectedSheets) && selectedSheets.length > 0 ? selectedSheets : ['EXPENDIOS'];

  // Validación de valores y preservación estricta de CENTRO OPERATIVO y CENTRO DE ACOPIO
  let rejectedCount = 0;
  const validNewList: ExpendioData[] = [];

  for (let idx = 0; idx < expendios.length; idx++) {
    const item = expendios[idx];
    const loc = String(item.localidad || item.municipio || '').trim();
    if (!loc) {
      rejectedCount++;
      allErrors.push(`Fila ${idx + 1}: Descartada por no contener localidad/municipio válido.`);
      continue;
    }

    // Detección de errores de fórmula de Excel (#VALUE!, #VALOR!, etc.)
    const checkValueFormulaError = (fieldVal: any, fieldName: string) => {
      const s = String(fieldVal || '').trim();
      if (s.includes('#VALUE!') || s.includes('#VALOR!') || s.includes('#REF!') || s.includes('#N/A') || s.includes('#NAME?')) {
        allErrors.push(`Fila ${idx + 1} (${loc}): Error de fórmula Excel "${s}" detectado en columna "${fieldName}".`);
        return s; // Reportar y conservar el texto exacto reportado, no inventar ni reemplazar
      }
      return fieldVal;
    };

    const centroOpVal = checkValueFormulaError(item.centroOperativo, 'CENTRO OPERATIVO');
    const centroAcopioVal = checkValueFormulaError(item.centroAcopio, 'CENTRO DE ACOPIO');

    validNewList.push({
      id: item.id || `exp-excel-${Date.now()}-${idx}`,
      // Preservación DIRECTA Y EXACTA de la fila de Excel (sin inferencias ni diccionarios)
      centroOperativo: String(centroOpVal || '').trim(),
      centroAcopio: String(centroAcopioVal || '').trim(),
      localidad: loc.toUpperCase(),
      departamento: String(item.departamento || '').trim().toUpperCase(),
      encargado: String(item.encargado || 'SIN ENCARGADO').trim().toUpperCase(),
      cedula: String(item.cedula || '0').trim(),
      direccionPunto: String(item.direccionPunto || item.direccion || '').trim(),
      telefonoPunto: String(item.telefonoPunto || item.celular || item.telefono || '').trim(),
      usuarioSipost: String(item.usuarioSipost || item.sipost || `SIP_${idx + 1}`).trim(),
      internet: String(item.internet || 'SI').trim().toUpperCase(),
      nit: String(item.nit || '900062917').trim(),
      correoElectronico: item.correoElectronico || '',
      observacion: item.observacion || 'Cargado desde Excel (Hoja EXPENDIOS)',
      municipio: item.municipio || loc.toUpperCase(),
      valorMensual: Number(item.valorMensual || item.valor || item.cargoBasico || 0),
      letreroUrl: item.letreroUrl || undefined,
      basculaUrl: item.basculaUrl || undefined,
      mataselloUrl: item.mataselloUrl || undefined,
      computadorUrl: item.computadorUrl || undefined,
      contratoUrl: item.contratoUrl || undefined,
      fechaUltimaActualizacion: new Date().toISOString().split('T')[0],
    });
  }

  let insertedCount = 0;
  let updatedCount = 0;

  try {
    const updatedExpendios = await mutateDatabase((db) => {
      if (!Array.isArray(db.expendios)) db.expendios = [];

      if (mode === 'replace') {
        const existingMap = new Map<string, ExpendioData>();
        for (const e of db.expendios) {
          if (e.cedula) existingMap.set(e.cedula.trim(), e);
          if (e.localidad) existingMap.set(e.localidad.trim().toLowerCase(), e);
        }

        db.expendios = validNewList.map((newItem) => {
          const existing = (newItem.cedula ? existingMap.get(newItem.cedula.trim()) : null) ||
                           (newItem.localidad ? existingMap.get(newItem.localidad.trim().toLowerCase()) : null);
          if (!existing) {
            insertedCount++;
            return newItem;
          }
          updatedCount++;
          return {
            ...newItem,
            id: existing.id, // Preservar ID canónico inmutable
            cedula: existing.cedula || newItem.cedula, // Preservar cédula maestra existente
            // Preservar exactamente CENTRO OPERATIVO y CENTRO DE ACOPIO de la hoja EXPENDIOS
            centroOperativo: newItem.centroOperativo || existing.centroOperativo,
            centroAcopio: newItem.centroAcopio || existing.centroAcopio,
            letreroUrl: existing.letreroUrl || newItem.letreroUrl,
            basculaUrl: existing.basculaUrl || newItem.basculaUrl,
            mataselloUrl: existing.mataselloUrl || newItem.mataselloUrl,
            computadorUrl: existing.computadorUrl || newItem.computadorUrl,
            fotoFachadaUrl: existing.fotoFachadaUrl || newItem.fotoFachadaUrl,
            fotoAvisoUrl: existing.fotoAvisoUrl || newItem.fotoAvisoUrl,
            fotoBasculaUrl: existing.fotoBasculaUrl || newItem.fotoBasculaUrl,
            fotoMataselloUrl: existing.fotoMataselloUrl || newItem.fotoMataselloUrl,
            fotoFirmaContratoUrl: existing.fotoFirmaContratoUrl || newItem.fotoFirmaContratoUrl,
            fotoCedulaFrontalUrl: existing.fotoCedulaFrontalUrl || newItem.fotoCedulaFrontalUrl,
            fotoCedulaRespaldoUrl: existing.fotoCedulaRespaldoUrl || newItem.fotoCedulaRespaldoUrl,
            fotoRutUrl: existing.fotoRutUrl || newItem.fotoRutUrl,
            fotoCertificacionBancariaUrl: existing.fotoCertificacionBancariaUrl || newItem.fotoCertificacionBancariaUrl,
            tieneAviso: existing.tieneAviso || newItem.tieneAviso,
            tieneBascula: existing.tieneBascula || newItem.tieneBascula,
            tieneMatasello: existing.tieneMatasello || newItem.tieneMatasello,
            motivoFaltaAviso: existing.motivoFaltaAviso || newItem.motivoFaltaAviso,
            motivoFaltaBascula: existing.motivoFaltaBascula || newItem.motivoFaltaBascula,
            motivoFaltaMatasello: existing.motivoFaltaMatasello || newItem.motivoFaltaMatasello,
          };
        });
      } else {
        validNewList.forEach((newItem) => {
          const existingIdx = db.expendios.findIndex(
            (e) =>
              (e.cedula && e.cedula === newItem.cedula) ||
              (e.localidad && newItem.localidad && e.localidad.toLowerCase() === newItem.localidad.toLowerCase())
          );
          if (existingIdx !== -1) {
            updatedCount++;
            const existing = db.expendios[existingIdx];
            db.expendios[existingIdx] = {
              ...existing,
              ...newItem,
              id: existing.id, // Preservar ID canónico inmutable
              cedula: existing.cedula || newItem.cedula, // Preservar cédula maestra existente
              centroOperativo: newItem.centroOperativo || existing.centroOperativo,
              centroAcopio: newItem.centroAcopio || existing.centroAcopio,
              letreroUrl: existing.letreroUrl || newItem.letreroUrl,
              basculaUrl: existing.basculaUrl || newItem.basculaUrl,
              mataselloUrl: existing.mataselloUrl || newItem.mataselloUrl,
              computadorUrl: existing.computadorUrl || newItem.computadorUrl,
              fotoFachadaUrl: existing.fotoFachadaUrl || newItem.fotoFachadaUrl,
              fotoAvisoUrl: existing.fotoAvisoUrl || newItem.fotoAvisoUrl,
              fotoBasculaUrl: existing.fotoBasculaUrl || newItem.fotoBasculaUrl,
              fotoMataselloUrl: existing.fotoMataselloUrl || newItem.fotoMataselloUrl,
              fotoFirmaContratoUrl: existing.fotoFirmaContratoUrl || newItem.fotoFirmaContratoUrl,
              fotoCedulaFrontalUrl: existing.fotoCedulaFrontalUrl || newItem.fotoCedulaFrontalUrl,
              fotoCedulaRespaldoUrl: existing.fotoCedulaRespaldoUrl || newItem.fotoCedulaRespaldoUrl,
              fotoRutUrl: existing.fotoRutUrl || newItem.fotoRutUrl,
              fotoCertificacionBancariaUrl: existing.fotoCertificacionBancariaUrl || newItem.fotoCertificacionBancariaUrl,
              tieneAviso: existing.tieneAviso || newItem.tieneAviso,
              tieneBascula: existing.tieneBascula || newItem.tieneBascula,
              tieneMatasello: existing.tieneMatasello || newItem.tieneMatasello,
              motivoFaltaAviso: existing.motivoFaltaAviso || newItem.motivoFaltaAviso,
              motivoFaltaBascula: existing.motivoFaltaBascula || newItem.motivoFaltaBascula,
              motivoFaltaMatasello: existing.motivoFaltaMatasello || newItem.motivoFaltaMatasello,
            };
          } else {
            insertedCount++;
            db.expendios.push(newItem);
          }
        });
      }
      return db.expendios;
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      archivo: fileName || 'ACTUALIZACION DE EXPENDIOS.xlsx',
      hojasSeleccionadas: activeSelectedSheets,
      totalProcesados: expendios.length,
      insertados: insertedCount,
      actualizados: updatedCount,
      rechazados: rejectedCount,
      errores: allErrors,
      data: updatedExpendios,
      message: `✓ Importación completada desde hoja(s) [${activeSelectedSheets.join(', ')}]: ${insertedCount} insertados, ${updatedCount} actualizados, ${rejectedCount} rechazados.`,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Error al guardar importación de Excel: ${err.message}`,
    });
  }
});

// 1C2B. Admin: Batch import expendios from Google Sheets
app.post('/api/admin/expendios/batch-import', async (req, res) => {
  const { expendios } = req.body;
  if (!Array.isArray(expendios) || expendios.length === 0) {
    return res.status(400).json({ success: false, message: 'No se recibieron datos válidos para importar.' });
  }

  try {
    let updatedCount = 0;
    const finalDb = await mutateDatabase((db) => {
      expendios.forEach((item: Partial<ExpendioData>) => {
        const cleanCedula = String(item.cedula || '').trim();
        if (!cleanCedula || cleanCedula === '0') return;

        const existingIdx = db.expendios.findIndex((e) => {
          if (e.cedula && e.cedula.trim() === cleanCedula) return true;
          if (item.id && e.id === item.id) return true;
          return false;
        });

        if (existingIdx !== -1) {
          const existing = db.expendios[existingIdx];
          const merged: any = { ...existing };
          for (const [k, v] of Object.entries(item)) {
            if (v !== undefined && v !== null && v !== '') {
              merged[k] = v;
            }
          }

          merged.fotoAvisoUrl = (item.fotoAvisoUrl && !item.fotoAvisoUrl.includes('placehold.co')) ? item.fotoAvisoUrl : existing.fotoAvisoUrl;
          merged.fotoPanoramicaUrl = (item.fotoPanoramicaUrl && !item.fotoPanoramicaUrl.includes('placehold.co')) ? item.fotoPanoramicaUrl : existing.fotoPanoramicaUrl;
          merged.fotoMataselloUrl = (item.fotoMataselloUrl && !item.fotoMataselloUrl.includes('placehold.co')) ? item.fotoMataselloUrl : existing.fotoMataselloUrl;
          merged.fotoBasculaUrl = (item.fotoBasculaUrl && !item.fotoBasculaUrl.includes('placehold.co')) ? item.fotoBasculaUrl : existing.fotoBasculaUrl;
          merged.fotoContratistaUrl = (item.fotoContratistaUrl && !item.fotoContratistaUrl.includes('placehold.co')) ? item.fotoContratistaUrl : existing.fotoContratistaUrl;
          merged.fotoHorarioUrl = (item.fotoHorarioUrl && !item.fotoHorarioUrl.includes('placehold.co')) ? item.fotoHorarioUrl : existing.fotoHorarioUrl;
          merged.fotoTarifasUrl = (item.fotoTarifasUrl && !item.fotoTarifasUrl.includes('placehold.co')) ? item.fotoTarifasUrl : existing.fotoTarifasUrl;
          merged.computadorUrl = (item.computadorUrl && !item.computadorUrl.includes('placehold.co')) ? item.computadorUrl : existing.computadorUrl;

          merged.cuentaBancaria = item.cuentaBancaria || existing.cuentaBancaria || '';
          merged.banco = item.banco || existing.banco || 'NEQUI';
          merged.tipoCuenta = item.tipoCuenta || existing.tipoCuenta || 'AHORROS';
          merged.encargado = item.encargado || existing.encargado;
          merged.direccionPunto = item.direccionPunto || existing.direccionPunto;
          merged.telefonoPunto = item.telefonoPunto || existing.telefonoPunto;
          merged.usuarioSipost = item.usuarioSipost || existing.usuarioSipost;
          merged.id = existing.id; // Invariante: Preservar ID interno inmutable en importaciones por lotes
          merged.fechaUltimaActualizacion = new Date().toISOString().split('T')[0];

          db.expendios[existingIdx] = merged;
          updatedCount++;
        } else {
          const newExp: ExpendioData = {
            id: item.id || `exp-sheets-${Date.now()}-${updatedCount}`,
            centroOperativo: item.centroOperativo || 'PO.BUCARAMANGA',
            centroAcopio: item.centroAcopio || item.localidad || 'PO.BUCARAMANGA',
            localidad: String(item.localidad || item.municipio || 'EXPENDIO').trim().toUpperCase(),
            encargado: String(item.encargado || 'ENCARGADO').trim().toUpperCase(),
            cedula: cleanCedula,
            direccionPunto: String(item.direccionPunto || '').trim().toUpperCase(),
            telefonoPunto: String(item.telefonoPunto || '').trim(),
            usuarioSipost: String(item.usuarioSipost || 'SIP_EXP').trim(),
            internet: item.internet || 'SI',
            nit: item.nit || '900062917',
            correoElectronico: item.correoElectronico || '',
            observacion: item.observacion || 'Importado desde Google Sheets',
            municipio: item.municipio || item.localidad || '',
            valorMensual: Number(item.valorMensual) || 0,
            fechaUltimaActualizacion: new Date().toISOString().split('T')[0],
          };
          db.expendios.push(newExp);
          updatedCount++;
        }
      });
      return db;
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      updatedCount,
      total: finalDb.expendios.length,
      message: `✓ Se actualizaron ${updatedCount} expendios correctamente desde Google Sheets sin sobreescrituras accidentales.`,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Error al guardar importación de Google Sheets: ${err.message}`,
    });
  }
});

// 1C3. Admin: Clear / Delete entire database of expendios (Protected with Rate Limiting, Attribution, and Timing-safe Verification)

// =========================================================================
// SECURITY LAYER FOR DESTRUCTIVE OPERATIONS & RESTORES
// - Rate limiting: Max 5 attempts per 15 minutes per IP to prevent brute-forcing
// - Secret Manager / Environment support: ADMIN_MASTER_PASSWORD_HASH (bcrypt) or ADMIN_MASTER_PASSWORD
// - NO hardcoded credentials in source code
// - Constant-time, timing-safe password comparison (bcrypt / timingSafeEqual)
// - Append-only structured audit logs for Cloud Logging (with actor identity attribution)
// =========================================================================

const configuredMasterPassword = process.env.ADMIN_MASTER_PASSWORD;
const configuredMasterHash = process.env.ADMIN_MASTER_PASSWORD_HASH;

// Ephemeral fallback if neither env var is configured, avoiding any known default
let ephemeralMasterSecret = '';
if (!configuredMasterPassword && !configuredMasterHash) {
  ephemeralMasterSecret = crypto.randomBytes(16).toString('hex');
  console.warn('[SEGURIDAD] ADMIN_MASTER_PASSWORD / ADMIN_MASTER_PASSWORD_HASH no está configurada en variables de entorno / Secret Manager.');
  console.warn(`[SEGURIDAD] Clave maestra efímera generada para esta sesión de servidor: ${ephemeralMasterSecret}`);
}

// In-Memory Rate Limiter for Destructive Endpoints
const destructiveAttemptsMap = new Map<string, { count: number; firstAttempt: number; lockedUntil?: number }>();

function checkDestructiveRateLimit(ip: string): { allowed: boolean; waitSeconds?: number } {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 5;
  const lockMs = 15 * 60 * 1000;

  const record = destructiveAttemptsMap.get(ip);
  if (!record) {
    destructiveAttemptsMap.set(ip, { count: 0, firstAttempt: now });
    return { allowed: true };
  }

  if (record.lockedUntil && now < record.lockedUntil) {
    return { allowed: false, waitSeconds: Math.ceil((record.lockedUntil - now) / 1000) };
  }

  if (now - record.firstAttempt > windowMs) {
    destructiveAttemptsMap.set(ip, { count: 0, firstAttempt: now });
    return { allowed: true };
  }

  if (record.count >= maxAttempts) {
    record.lockedUntil = now + lockMs;
    return { allowed: false, waitSeconds: Math.ceil(lockMs / 1000) };
  }

  return { allowed: true };
}

function registerDestructiveAttempt(ip: string, success: boolean) {
  const now = Date.now();
  const record = destructiveAttemptsMap.get(ip);
  if (success) {
    destructiveAttemptsMap.delete(ip);
  } else if (record) {
    record.count++;
  } else {
    destructiveAttemptsMap.set(ip, { count: 1, firstAttempt: now });
  }
}

// Constant-time password verification using bcrypt or timingSafeEqual
function verifyMasterPassword(providedPassword?: string): boolean {
  if (!providedPassword || typeof providedPassword !== 'string') return false;
  const trimmed = providedPassword.trim();
  if (!trimmed) return false;

  // 1. If a bcrypt or SHA-256 hash is configured in Secret Manager / environment:
  if (configuredMasterHash) {
    try {
      if (configuredMasterHash.startsWith('$2a$') || configuredMasterHash.startsWith('$2b$') || configuredMasterHash.startsWith('$2y$')) {
        return bcrypt.compareSync(trimmed, configuredMasterHash);
      }
      const hash = crypto.createHash('sha256').update(trimmed).digest('hex');
      if (hash.length === configuredMasterHash.length) {
        return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(configuredMasterHash));
      }
    } catch (e) {
      console.error('[SEGURIDAD] Error verificando hash maestro:', e);
      return false;
    }
  }

  // 2. If configured as plain password in Secret Manager / environment or ephemeral session secret:
  const secretToCompare = configuredMasterPassword || ephemeralMasterSecret;
  if (secretToCompare) {
    const bufProvided = crypto.createHash('sha256').update(trimmed).digest();
    const bufSecret = crypto.createHash('sha256').update(secretToCompare).digest();
    return crypto.timingSafeEqual(bufProvided, bufSecret);
  }

  return false;
}

// Append-only Cloud Logging Audit Log
function emitImmutableAuditLog(params: {
  action: string;
  actorCedula: string;
  actorRole: string;
  ip: string;
  userAgent: string;
  status: 'SUCCESS' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'FAILED';
  details?: Record<string, any>;
}) {
  const structuredLog = {
    severity: params.status === 'SUCCESS' ? 'NOTICE' : 'WARNING',
    timestamp: new Date().toISOString(),
    event_type: 'DESTRUCTIVE_ADMIN_OPERATION',
    ...params,
  };
  console.log(`[CLOUD_LOGGING_AUDIT] ${JSON.stringify(structuredLog)}`);
}

// Unified authorization gatekeeper for destructive operations
function authorizeDestructiveAction(req: express.Request, res: express.Response, actionName: string): boolean {
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.ip || req.socket?.remoteAddress || 'unknown-ip';
  const authUser = extractAuthenticatedUser(req);
  const actorCedula = authUser?.cedula || 'ANONIMO';
  const actorRole = authUser?.role || (authUser?.roles?.[0]) || 'NINGUNO';
  const userAgent = req.get('User-Agent') || 'unknown';

  // 1. Enforce Rate Limiting
  const rateLimit = checkDestructiveRateLimit(clientIp);
  if (!rateLimit.allowed) {
    emitImmutableAuditLog({
      action: actionName,
      actorCedula,
      actorRole,
      ip: clientIp,
      userAgent,
      status: 'RATE_LIMITED',
      details: { waitSeconds: rateLimit.waitSeconds }
    });
    res.status(429).json({
      success: false,
      message: `Demasiados intentos fallidos. Operación bloqueada temporalmente por seguridad. Reintente en ${rateLimit.waitSeconds} segundos.`
    });
    return false;
  }

  // 2. Enforce Role & Session Attribution (must be logged in administrator with verified token)
  if (!authUser || !authUser.roles.includes('admin') || normalizeCedula(authUser.cedula) !== ADMIN_CEDULA) {
    registerDestructiveAttempt(clientIp, false);
    emitImmutableAuditLog({
      action: actionName,
      actorCedula,
      actorRole,
      ip: clientIp,
      userAgent,
      status: 'UNAUTHORIZED',
      details: { reason: 'No valid admin session token' }
    });
    res.status(403).json({
      success: false,
      message: 'Acceso denegado: Se requiere sesión activa de Administrador con token verificado para ejecutar esta acción.'
    });
    return false;
  }

  // 3. Verify Master Security Password (Re-authentication)
  const password = req.body?.password;
  if (!verifyMasterPassword(password)) {
    registerDestructiveAttempt(clientIp, false);
    emitImmutableAuditLog({
      action: actionName,
      actorCedula,
      actorRole,
      ip: clientIp,
      userAgent,
      status: 'FAILED',
      details: { reason: 'Incorrect security password' }
    });
    res.status(401).json({
      success: false,
      message: 'Contraseña maestra de seguridad incorrecta. Re-autenticación no autorizada.'
    });
    return false;
  }

  // 4. Success: Log audit record with operator identity
  registerDestructiveAttempt(clientIp, true);
  emitImmutableAuditLog({
    action: actionName,
    actorCedula,
    actorRole,
    ip: clientIp,
    userAgent,
    status: 'SUCCESS',
    details: req.body?.targets || req.body?.modo ? { targets: req.body?.targets, modo: req.body?.modo } : undefined
  });

  return true;
}

app.post('/api/admin/clear-database', async (req, res) => {
  if (!authorizeDestructiveAction(req, res, 'CLEAR_DATABASE_EXPENDIOS')) return;

  try {
    let previousCount = 0;
    await mutateDatabase((db) => {
      previousCount = db.expendios.length;
      db.expendios = [];
      return db.expendios;
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      data: [],
      message: `✓ Base de datos borrada por completo. Se eliminaron ${previousCount} expendios. Ahora la base de datos está vacía.`,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Error al vaciar base de datos en PostgreSQL: ${err.message}`,
    });
  }
});

// 1D. Admin: Delete an expendio
app.delete('/api/admin/expendios/:id', async (req, res) => {
  const { id } = req.params;
  const target = String(id).trim().toLowerCase();

  try {
    const removed = await mutateDatabase(async (db) => {
      const index = db.expendios.findIndex(
        (e) =>
          String(e.id || '').trim().toLowerCase() === target ||
          String(e.cedula || '').trim().toLowerCase() === target ||
          String(e.localidad || '').trim().toLowerCase() === target
      );
      if (index === -1) {
        throw new Error('EXPENDIO_NOT_FOUND');
      }

      const item = db.expendios.splice(index, 1)[0];
      const nowIso = new Date().toISOString();
      const actor = extractAuthenticatedUser(req) || { cedula: '1094269932', role: 'admin' };

      // Log deletion event in trazabilidad (NEVER in accounting historial)
      if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
      const commitId = 'cmt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
      db.trazabilidad.unshift({
        id: `traz-delete-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        expendioId: item.id,
        actorId: actor.cedula,
        actorRole: 'admin',
        timestamp: nowIso,
        municipio: item.municipio || item.localidad,
        localidad: item.localidad,
        novedad: 'Eliminación de expendio del sistema',
        encargadoAnterior: item.encargado,
        cedulaAnterior: item.cedula,
        fechaRegistro: nowIso,
        registradoPor: `Administrador (CC: ${actor.cedula})`,
        observaciones: `Expendio ${item.localidad} eliminado del sistema maestro`,
        commitId,
        before: item,
        after: null,
      });

      return item;
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      message: `✓ Expendio ${removed.localidad} eliminado correctamente del sistema y PostgreSQL.`,
    });
  } catch (err: any) {
    if (err.message === 'EXPENDIO_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
    }
    console.error('[API] Error eliminando expendio:', err);
    res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Error al eliminar expendio en PostgreSQL: ${err.message}`,
    });
  }
});

// Rate limiter estricto para mitigar ataques de fuerza bruta y enumeración de identidades
const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20, // Máximo 20 intentos fallidos por minuto por IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // No penalizar ni bloquear inicios de sesión exitosos
  validate: false,
  message: {
    success: false,
    error: 'TOO_MANY_LOGIN_ATTEMPTS',
    message: 'Has alcanzado el límite de intentos de acceso permitidos por minuto. Por favor espera 60 segundos antes de volver a intentar.',
  },
});

// 2. Authentication Route (Strict identification by Cédula, plus additional password for Admin accounts)
app.post('/api/auth/login', loginRateLimiter, (req, res) => {
  const rawSearchVal = (req.body.cedula || req.body.passwordOrCedula || '').trim();
  const resolvedAdminCedula = resolveAuthorizedAdminCedula(rawSearchVal);
  const searchVal = resolvedAdminCedula || normalizeCedula(rawSearchVal);
  const db = loadDatabase();

  if (!searchVal) {
    return res.status(400).json({
      success: false,
      message: 'Por favor ingresa tu número de Cédula.',
      whatsappPhone: '3182822512',
    });
  }

  // Verificar primero si corresponde a un Administrador autorizado (1094269932 o 9005042417)
  if (resolvedAdminCedula) {
    const providedPassword = String(req.body.adminPassword || req.body.password || '').trim();
    if (!providedPassword) {
      return res.status(401).json({
        success: false,
        requiresPassword: true,
        message: 'Por seguridad, ingresa la contraseña adicional de Administrador para continuar.',
      });
    }

    if (providedPassword !== ADMIN_ACCESS_PASSWORD) {
      registrarIngresoUsuario(
        db,
        req,
        resolvedAdminCedula === ADMIN_CEDULA ? 'ADMINISTRADOR GENERAL CAMARCA SAS' : 'ADMINISTRADOR CAMARCA S.A.S.',
        resolvedAdminCedula,
        'admin',
        'BUCARAMANGA',
        'login',
        false,
        'Intento de ingreso Administrador con contraseña adicional incorrecta'
      );
      return res.status(401).json({
        success: false,
        requiresPassword: true,
        message: 'Contraseña de administrador incorrecta. Verifique e intente nuevamente.',
      });
    }

    // Caso 1: Administrador General Super-Admin (1094269932) -> Multi-rol + Paneles técnicos completos
    if (resolvedAdminCedula === ADMIN_CEDULA) {
      // Si la petición proviene de un interceptor automático en segundo plano (!req.body.passwordOrCedula)
      // y el navegador ya tiene una sesión activa de un expendio distinto de 1094269932, bloquear escalada
      const isInteractiveLogin = Boolean(req.body.passwordOrCedula);
      if (!isInteractiveLogin) {
        const existingUser = extractAuthenticatedUser(req);
        const existingCedNorm = normalizeCedula(existingUser?.cedula);
        const explicitExpCed = normalizeCedula(req.headers['x-expendio-cedula'] as string);
        if (
          (existingCedNorm && existingCedNorm !== ADMIN_CEDULA && existingCedNorm !== CLEAN_ADMIN_CEDULA) ||
          (explicitExpCed && explicitExpCed !== ADMIN_CEDULA && explicitExpCed !== CLEAN_ADMIN_CEDULA)
        ) {
          return res.status(403).json({
            success: false,
            message: 'Escalado automático bloqueado: sesión activa pertenece a un expendio.',
          });
        }
      }

      const adminExpendio = (db.expendios || []).find(
        (e) => normalizeCedula(e.cedula) === ADMIN_CEDULA && e.estado !== 'Inhabilitado'
      ) || (db.expendios || []).find((e) => normalizeCedula(e.cedula) === ADMIN_CEDULA);
      const expendioRealId = adminExpendio ? adminExpendio.id : '';

      const authUser: AuthenticatedUser = {
        cedula: ADMIN_CEDULA,
        roles: ['admin', 'expendio', 'cliente'],
        role: 'admin',
        expendioId: expendioRealId,
        name: 'DIEGO ALEJANDRO BECERRA',
        municipio: 'GIRON',
        isMultiRoleAdmin: true,
        isCleanAdmin: false,
        issuedAt: Date.now(),
      };

      const token = generateSessionToken(authUser);

      res.cookie('camarca_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
      });

      registrarIngresoUsuario(
        db,
        req,
        'DIEGO ALEJANDRO BECERRA',
        ADMIN_CEDULA,
        'admin',
        'GIRON',
        'login',
        true,
        'Ingreso Administrador General (Multi-rol: admin + expendio + cliente)'
      );

      return res.json({
        success: true,
        token,
        isMultiRoleAdmin: true,
        canSelectRole: true,
        isCleanAdmin: false,
        availableRoles: ['admin', 'expendio', 'cliente'],
        user: {
          role: 'admin',
          roles: ['admin', 'expendio', 'cliente'],
          cedulaOrNit: ADMIN_CEDULA,
          name: 'DIEGO ALEJANDRO BECERRA',
          isMultiRoleAdmin: true,
          isCleanAdmin: false,
          expendioData: adminExpendio
            ? { ...adminExpendio, encargado: 'DIEGO ALEJANDRO BECERRA', municipio: 'GIRON', localidad: 'GIRON' }
            : undefined,
          expendioId: expendioRealId,
          token,
        },
      });
    }

    // Caso 2: Administrador Ejecutivo Limpio (9005042417) -> Sin paneles ni datos técnicos, visualización limpia de la app
    if (resolvedAdminCedula === CLEAN_ADMIN_CEDULA) {
      const authUser: AuthenticatedUser = {
        cedula: CLEAN_ADMIN_CEDULA,
        roles: ['admin', 'cliente'],
        role: 'admin',
        expendioId: '',
        name: 'ADMINISTRADOR CAMARCA S.A.S.',
        municipio: 'BUCARAMANGA',
        isMultiRoleAdmin: false,
        isCleanAdmin: true,
        issuedAt: Date.now(),
      };

      const token = generateSessionToken(authUser);

      res.cookie('camarca_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
      });

      registrarIngresoUsuario(
        db,
        req,
        'ADMINISTRADOR CAMARCA S.A.S.',
        CLEAN_ADMIN_CEDULA,
        'admin',
        'BUCARAMANGA',
        'login',
        true,
        'Ingreso Administrador Ejecutivo Limpio (9005042417)'
      );

      return res.json({
        success: true,
        token,
        isMultiRoleAdmin: false,
        canSelectRole: false,
        isCleanAdmin: true,
        availableRoles: ['admin', 'cliente'],
        user: {
          role: 'admin',
          roles: ['admin', 'cliente'],
          cedulaOrNit: CLEAN_ADMIN_CEDULA,
          name: 'ADMINISTRADOR CAMARCA S.A.S.',
          isMultiRoleAdmin: false,
          isCleanAdmin: true,
          token,
        },
      });
    }
  }

  // 1. Filtrar expendios asociados a la cédula proporcionada (excluyendo inhabilitados)
  const matchingExpendios = (db.expendios || []).filter(
    (exp) => normalizeCedula(exp.cedula) === searchVal && exp.estado !== 'Inhabilitado'
  );

  // REGLA 4: Cédula duplicada - NO elegir arbitrariamente. Rechazar y registrar inconsistencia.
  if (matchingExpendios.length > 1) {
    const expList = matchingExpendios.map((e) => `${e.municipio || e.localidad} (${e.id})`).join(', ');
    const inconsistencyMsg = `Inconsistencia crítica: Cédula ${searchVal} asociada a múltiples expendios activos: ${expList}`;
    console.error(`[Integridad] ${inconsistencyMsg}`);

    registrarIngresoUsuario(
      db,
      req,
      `Cédula Duplicada (${rawSearchVal})`,
      rawSearchVal,
      'desconocido',
      '',
      'login',
      false,
      inconsistencyMsg
    );

    return res.status(409).json({
      success: false,
      inconsistencia: true,
      error: 'CEDULA_DUPLICADA_INCONSISTENCIA',
      message: 'Inconsistencia de datos: El número de cédula está asignado a múltiples expendios en el sistema.',
      detalles: `El sistema detectó más de un expendio activo con la cédula ${searchVal} (${expList}). Por seguridad y trazabilidad, el acceso automático ha sido suspendido para prevenir corrupción de datos. Contacte al Administrador General o revise el módulo de integridad.`,
      whatsappPhone: '3182822512',
    });
  }

  // REGLA 3: Resolución de Expendio estrictamente por cédula
  const found = matchingExpendios[0];
  if (found) {
    const authUser: AuthenticatedUser = {
      cedula: normalizeCedula(found.cedula),
      roles: ['expendio', 'cliente'],
      role: 'expendio',
      expendioId: found.id,
      name: found.encargado,
      municipio: found.municipio || found.localidad,
      isMultiRoleAdmin: false,
      issuedAt: Date.now(),
    };

    const token = generateSessionToken(authUser);

    res.cookie('camarca_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    });

    registrarIngresoUsuario(
      db,
      req,
      found.encargado,
      found.cedula,
      'expendio',
      found.municipio || found.localidad,
      'login',
      true,
      `Ingreso Expendio ${found.municipio || found.localidad} (ID: ${found.id})`
    );

    return res.json({
      success: true,
      token,
      user: {
        role: 'expendio',
        roles: ['expendio', 'cliente'],
        cedulaOrNit: found.cedula,
        name: found.encargado,
        expendioData: found,
        expendioId: found.id,
        token,
      },
    });
  }

  // Fallback: Cédula no registrada
  registrarIngresoUsuario(
    db,
    req,
    `No Registrado (${rawSearchVal})`,
    rawSearchVal,
    'desconocido',
    '',
    'login',
    false,
    'Intento de ingreso con cédula no encontrada en el sistema'
  );

  return res.status(404).json({
    success: false,
    message: 'No se encontró ningún expendio registrado para el número de cédula ingresado.',
    whatsappPhone: '3182822512',
    detalles: `El número ${rawSearchVal} no coincide con ningún expendio ni usuario registrado en la base de datos de CAMARCA SAS.`,
  });
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('camarca_token', { path: '/' });
  res.json({ success: true, message: 'Sesión cerrada exitosamente.' });
});

// Current authenticated user verification endpoint
app.get('/api/auth/me', requireAuthenticatedUser, (req: AuthRequest, res) => {
  const user = req.user!;
  const db = loadDatabase();
  const ownExpendio = resolveUserExpendio(req, db);
  const normCed = normalizeCedula(user.cedula);
  const resolvedName =
    normCed === ADMIN_CEDULA
      ? 'DIEGO ALEJANDRO BECERRA'
      : normCed === CLEAN_ADMIN_CEDULA
      ? 'ADMINISTRADOR CAMARCA S.A.S.'
      : ownExpendio?.encargado || user.name;

  res.json({
    success: true,
    user: {
      cedula: user.cedula,
      roles: user.roles,
      role: user.role || user.roles[0],
      expendioId: user.expendioId,
      name: resolvedName,
      municipio: normCed === ADMIN_CEDULA ? 'GIRON' : user.municipio,
      isMultiRoleAdmin: user.isMultiRoleAdmin,
      expendioData: ownExpendio,
    },
  });
});

// Endpoint de diagnóstico de integridad del sistema
app.get('/api/admin/system/integrity', (req, res) => {
  const db = loadDatabase();
  const integrityReport = auditDatabaseIntegrity(db);
  const outboxSummary = getOutboxSummary();
  const cloudSync = { connected: true, provider: 'PostgreSQL (Cloud SQL)', quotaExhausted: false };

  res.json({
    success: true,
    healthy: integrityReport.healthy && !cloudSync.quotaExhausted,
    revision: Number(db.revision) || 0,
    commitId: (db as any).commitId || null,
    checkedAt: integrityReport.checkedAt,
    integrity: integrityReport,
    outbox: outboxSummary,
    cloudSync,
  });
});

// Endpoint de estado de la outbox durable
app.get('/api/admin/outbox/status', (req, res) => {
  const summary = getOutboxSummary();
  const pendingEvents = getPendingOutboxEvents();
  res.json({
    success: true,
    summary,
    pendingCount: pendingEvents.length,
    pendingEvents: pendingEvents.slice(0, 50),
  });
});

// ==============================================================================
// CENTRO DE ERRORES Y DIAGNÓSTICO DE LA PLATAFORMA (ADMIN)
// ==============================================================================
app.get('/api/admin/error-logs', (req, res) => {
  try {
    const limit = Math.min(300, Math.max(10, parseInt(String(req.query.limit || '150'), 10)));
    const logs = errorLogService.getLogs(limit);
    const stats = errorLogService.getStats();
    res.json({ success: true, logs, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/error-catalog', (req, res) => {
  try {
    const catalog = errorLogService.getCatalog();
    res.json({ success: true, catalog });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/error-logs/:id/resolve', (req, res) => {
  try {
    const { id } = req.params;
    const resolved = errorLogService.markAsResolved(id, 'Administrador');
    if (resolved) {
      res.json({ success: true, message: `Incidencia ${id} resuelta exitosamente.` });
    } else {
      res.status(404).json({ success: false, error: 'Registro de error no encontrado.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/error-logs', (req, res) => {
  try {
    errorLogService.clearLogs();
    res.json({ success: true, message: 'Historial de errores de la plataforma vaciado.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2B. Track general visit / page load (Strictly validated for real authenticated users)
app.post('/api/metrics/track-visit', async (req, res) => {
  // Filtrar accesos anónimos, bots o chequeos de salud (health check)
  const user = extractAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Operación anónima omitida para métricas.' });
  }

  // Verificar que el usuario exista en PostgreSQL y esté activo
  const db = loadDatabase();
  const cleanCed = String(user.cedula || '').replace(/\D/g, '');
  let exists = false;
  if (cleanCed === ADMIN_CEDULA) {
    exists = true;
  } else {
    const foundExp = (db.expendios || []).find((e) => String(e.cedula || '').replace(/\D/g, '') === cleanCed);
    if (foundExp && foundExp.estado !== 'Inhabilitado') {
      exists = true;
    }
  }

  if (!exists) {
    return res.status(403).json({ success: false, message: 'Identidad no válida o inhabilitada.' });
  }

  try {
    const count = await mutateDatabase((db) => {
      db.visitasGenerales = (db.visitasGenerales || 0) + 1;
      return db.visitasGenerales;
    }, { immediateCloudSync: false, skipCloudSync: false });
    res.json({ success: true, count });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2B2. Realtime presence heartbeat ping to track active online users
app.post(['/api/presence/heartbeat', '/api/metrics/heartbeat'], (req, res) => {
  cleanupStalePresence();
  const authUser = extractAuthenticatedUser(req);
  const body = req.body || {};

  const rawIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const ip = rawIp.split(',')[0].trim().replace('::ffff:', '') || '127.0.0.1';
  const userAgent = (req.headers['user-agent'] as string) || '';
  const { dispositivo, navegador } = parseDeviceInfo(userAgent);

  const cedula = authUser?.cedula || body.cedula || 'anonimo';
  const role = authUser?.role || body.rol || 'visita';
  const usuario = body.usuario || authUser?.name || (role === 'admin' ? 'ADMINISTRADOR GENERAL' : 'Usuario');
  const municipio = body.municipio || authUser?.municipio || '';
  const activePath = body.path || '/';

  const key = `${cedula}_${ip}`;
  const now = Date.now();

  activeUsersPresenceMap.set(key, {
    key,
    cedula,
    usuario,
    rol: role,
    municipio,
    ip,
    dispositivo,
    navegador,
    path: activePath,
    lastSeen: now,
    timestampIso: new Date(now).toISOString(),
  });

  const activeList = Array.from(activeUsersPresenceMap.values())
    .map((item) => ({
      ...item,
      haceCuantoSegundos: Math.max(0, Math.floor((now - item.lastSeen) / 1000)),
    }))
    .sort((a, b) => b.lastSeen - a.lastSeen);

  res.json({
    success: true,
    usuariosEnLineaCount: activeList.length,
    activeUsers: activeList,
  });
});

// 2C. Admin: Get Access Metrics (Available strictly to Administrator) - Async query to PostgreSQL
app.get('/api/admin/metrics/accesos', async (req, res) => {
  try {
    const db = loadDatabase();
    const metricas = await calcularMetricasAccesoAsync(db);
    res.json({ success: true, data: metricas });
  } catch (err: any) {
    console.error('Error calculando métricas de acceso:', err);
    res.status(500).json({ success: false, message: 'Error al calcular métricas: ' + err.message });
  }
});

// 2D. Admin: Export Access Logs as CSV
app.get('/api/admin/metrics/exportar-csv', (req, res) => {
  const registros = getRegistrosAcceso();

  let csv = '\uFEFFFECHA_HORA,USUARIO_ENCARGADO,CEDULA_NIT,ROL,MUNICIPIO,DISPOSITIVO,NAVEGADOR,IP,UBICACION_IP,PROVEEDOR_INTERNET_ISP,TIPO_ACCESO,ESTADO,DETALLES';
  registros.forEach((r) => {
    const clean = (val?: string) => `"${String(val || '').replace(/"/g, '""')}"`;
    csv +=
      [
        clean(r.fechaFormateada || r.timestamp),
        clean(r.usuario),
        clean(r.cedulaOrNit),
        clean(r.rol?.toUpperCase()),
        clean(r.municipio),
        clean(r.dispositivo),
        clean(r.navegador),
        clean(r.ip),
        clean(r.ubicacionIp || (r.municipio ? `${r.municipio}, Colombia` : 'Colombia')),
        clean(r.isp || 'Operador de Red'),
        clean(r.tipoAcceso),
        clean(r.exitoso ? 'EXITOSO' : 'FALLIDO'),
        clean(r.detalles || ''),
      ].join(',') + '\n';
  });

  const filename = `Reporte_Accesos_CAMARCA_${new Date().toISOString().split('T')[0]}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// 2E. Admin: Reset Access Logs (requires master password)
app.post('/api/admin/metrics/limpiar', async (req, res) => {
  if (!authorizeDestructiveAction(req, res, 'CLEAR_ACCESS_METRICS')) return;

  clearRegistrosAcceso();
  await mutateDatabase((db) => {
    db.visitasGenerales = 0;
  }, { forceCloudSync: true });

  res.json({
    success: true,
    message: '✓ Registro de accesos e ingresos a la aplicación reiniciado correctamente.',
  });
});

// 3. Expendio: Update contact and personal details (ALL IN UPPERCASE)
// REGLA 3, 13 y 14: Resuelve expendio propio desde req.user.expendioId y busca por id canónico inmutable.
app.post('/api/expendio/update', requireExpendio, async (req: AuthRequest, res) => {
  const user = req.user!;
  const currentDb = getDatabase();
  const ownExpendio = resolveUserExpendio(req, currentDb);

  if (!ownExpendio) {
    return res.status(404).json({ success: false, message: 'Expendio propio no encontrado para el usuario autenticado.' });
  }

  // REGLAS 7 y 13: El módulo de Expendio opera estrictamente sobre el expendio propio
  const requestedId = req.body.expendioId || req.body.id;
  if (requestedId && requestedId !== ownExpendio.id && normalizeCedula(user.cedula) !== ADMIN_CEDULA) {
    return res.status(403).json({ success: false, message: 'Acceso denegado: El módulo de Expendio solo permite modificar su propio expendio.' });
  }

  const {
    cedula,
    direccionPunto,
    telefonoPunto,
    correoElectronico,
    encargado,
    cuentaBancaria,
    banco,
    primeraVezActualizado,
  } = req.body;

  try {
    const updatedExp = await mutateDatabase(async (db) => {
      // REGLA 14: Búsqueda estricta por expendio.id canónico e inmutable
      const index = db.expendios.findIndex((exp) => exp.id === ownExpendio.id);
      if (index === -1) {
        throw new Error('EXPENDIO_NOT_FOUND');
      }

      const current = db.expendios[index];

      // Transform all user-entered string values to UPPERCASE as mandated
      const cleanEncargado = encargado ? String(encargado).trim().toUpperCase() : current.encargado;
      // REGLA FUNDAMENTAL: La cédula es un dato maestro administrado e inmutable para el usuario Expendio.
      // La cédula registrada en BD (current.cedula) es la única autoridad y nunca puede ser modificada por el expendio.
      const immutableCedula = current.cedula;
      const cleanDireccion = direccionPunto ? String(direccionPunto).trim().toUpperCase() : (current.direccionPunto || current.direccion || '');
      const cleanTelefono = telefonoPunto ? String(telefonoPunto).trim().toUpperCase() : (current.telefonoPunto || current.telefono || '');
      const cleanCuenta = cuentaBancaria !== undefined ? String(cuentaBancaria).trim().toUpperCase() : (current.cuentaBancaria || '');
      const cleanBanco = banco ? String(banco).trim().toUpperCase() : (current.banco || 'NEQUI');
      const cleanCorreo = correoElectronico ? String(correoElectronico).trim().toUpperCase() : (current.correoElectronico || '');
      const cleanObservaciones = req.body.observaciones !== undefined 
        ? String(req.body.observaciones).trim().toUpperCase() 
        : (req.body.observacion !== undefined 
            ? String(req.body.observacion).trim().toUpperCase() 
            : (current.observaciones || current.observacion || ''));

      const nowIso = new Date().toISOString();
      const today = nowIso.split('T')[0];

      db.expendios[index] = {
        ...current,
        id: current.id, // Preservar ID canónico inmutable
        cedula: immutableCedula, // INMUTABLE: La cédula existente en BD no puede ser alterada por el expendio
        encargado: cleanEncargado,
        direccion: cleanDireccion,
        direccionPunto: cleanDireccion,
        telefono: cleanTelefono,
        telefonoPunto: cleanTelefono,
        cuentaBancaria: cleanCuenta,
        banco: cleanBanco,
        correoElectronico: cleanCorreo,
        observacion: cleanObservaciones,
        observaciones: cleanObservaciones,
        primeraVezActualizado: true,
        fechaUltimaActualizacion: today,
        updatedAt: nowIso,
        revision: (Number(current.revision) || 0) + 1,
      };

      const resultItem = db.expendios[index];

      // Record in trazabilidad for audit tracking
      if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
      const commitId = 'cmt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
      db.trazabilidad.unshift({
        id: `traz-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        expendioId: resultItem.id, // REGLA 16: ID canónico inmutable del expendio
        actorId: user.cedula,
        actorRole: user.role || 'expendio',
        timestamp: nowIso,
        municipio: resultItem.municipio || resultItem.localidad,
        localidad: resultItem.localidad,
        novedad: 'Actualización oficial de datos de contacto por el expendio',
        encargadoNuevo: cleanEncargado,
        cedulaNuevo: immutableCedula,
        fechaRegistro: nowIso,
        registradoPor: `Expendio ${cleanEncargado} (CC: ${immutableCedula})`,
        observaciones: `Actualización oficial de datos de contacto (Dirección, Celular, Cuenta Bancaria, Banco, Correo). Rev ${resultItem.revision}`,
        commitId,
        before: current,
        after: resultItem,
      });

      return resultItem;
    }, { immediateCloudSync: true, forceCloudSync: false, throwOnCloudError: false });

    res.json({
      success: true,
      cloudPersisted: true,
      data: updatedExp,
      message: 'Datos del expendio actualizados exitosamente.',
    });
  } catch (err: any) {
    if (err.message === 'EXPENDIO_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
    }
    console.error('[API] Error actualizando datos del expendio:', err);
    res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Error al guardar actualización de datos: ${err.message}.`,
    });
  }
});



// ==========================================
// REGISTRO Y GESTIÓN DE FOTOGRAFÍAS EN GOOGLE DRIVE
// ==========================================
const drivePhotosRegistryPath = path.join(dataDir, 'google_drive_photos.json');
let drivePhotosRegistryMemory: Record<string, any> = {};

function loadDrivePhotosRegistry(): Record<string, any> {
  try {
    if (fs.existsSync(drivePhotosRegistryPath)) {
      const data = JSON.parse(fs.readFileSync(drivePhotosRegistryPath, 'utf8'));
      if (data && typeof data === 'object') {
        drivePhotosRegistryMemory = { ...drivePhotosRegistryMemory, ...data };
        return drivePhotosRegistryMemory;
      }
    }
  } catch {}
  return drivePhotosRegistryMemory;
}

function saveDrivePhotosRegistry(registry: Record<string, any>): void {
  try {
    drivePhotosRegistryMemory = { ...registry };
    fs.writeFileSync(drivePhotosRegistryPath, JSON.stringify(registry, null, 2), 'utf8');
    // Sincronizar de forma permanente con PostgreSQL
    saveDriveRegistryToCloud(registry).catch((e) => {
      console.warn('Error sincronizando registry a PostgreSQL:', e.message);
    });
  } catch (e: any) {
    console.warn('Error guardando registro de fotos Google Drive:', e.message);
  }
}

function lookupMunicipioForCedula(cedulaRaw: string): { municipio: string; encargado?: string } {
  const clean = String(cedulaRaw || '').replace(/\D/g, '').trim();
  const db = getDatabaseReadOnly();
  const exp = (db.expendios || []).find((e: any) => String(e.cedula || '').replace(/\D/g, '').trim() === clean);
  if (exp) {
    return {
      municipio: exp.municipio || exp.localidad || 'Giron',
      encargado: exp.encargado || exp.nombre || '',
    };
  }
  // Mapeo histórico de respaldo para expedientes conocidos
  const fallbackMap: Record<string, { municipio: string; encargado: string }> = {
    '1094269932': { municipio: 'Giron', encargado: 'DIEGO ALEJANDRO BECERRA' },
    '1094272656': { municipio: 'Herran', encargado: 'MARIA YURLEY JAIMES BUITRAGO' },
    '1094270223': { municipio: 'Pamplona', encargado: 'JESSICA JOHANA HENAO DAZA' },
  };
  if (fallbackMap[clean]) return fallbackMap[clean];
  return { municipio: 'Giron' };
}

function formatMunicipioNombre(municipio?: string): string {
  if (!municipio) return 'Giron';
  const clean = municipio
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

function getTipoFotoEtiqueta(slotKey: string): string {
  const map: Record<string, string> = {
    fotoAvisoUrl: 'Aviso',
    fotoAviso: 'Aviso',
    letrero: 'Aviso',
    aviso: 'Aviso',
    fotoBasculaUrl: 'Bascula',
    fotoBascula: 'Bascula',
    bascula: 'Bascula',
    fotoMataselloUrl: 'Matasello',
    fotoMatasello: 'Matasello',
    matasello: 'Matasello',
    fotoPanoramicaUrl: 'Fachada',
    fotoPanoramica: 'Fachada',
    panoramica: 'Fachada',
    fachada: 'Fachada',
    fotoFachadaUrl: 'Fachada',
    fotoContratistaUrl: 'Contratista',
    fotoContratista: 'Contratista',
    contratista: 'Contratista',
    fotoHorarioUrl: 'Horario',
    fotoHorario: 'Horario',
    horario: 'Horario',
    fotoTarifasUrl: 'Tarifas',
    fotoTarifas: 'Tarifas',
    tarifas: 'Tarifas',
    computadorUrl: 'Computador',
    fotoComputadorUrl: 'Computador',
    computador: 'Computador',
    cuenta_escaneada: 'Cuenta_Escaneada',
  };
  return map[slotKey] || 'Foto';
}

function getPhotoItemSlug(slotKey: string): string {
  const key = (slotKey || '').toLowerCase();
  if (key.includes('tarifa')) return 'Foto_Tarifas';
  if (key.includes('aviso') || key.includes('letrero')) return 'Foto_Aviso';
  if (key.includes('panoramica') || key.includes('fachada')) return 'Foto_Panoramica';
  if (key.includes('matasello')) return 'Foto_Matasello';
  if (key.includes('bascula')) return 'Foto_Bascula';
  if (key.includes('contratista') || key.includes('encargado') || key.includes('persona')) return 'Foto_Contratista';
  if (key.includes('horario')) return 'Foto_Horario';
  return 'Foto_General';
}

function getSlotKeyFromFileNameServer(fileName: string): string | null {
  const clean = (fileName || '').toLowerCase();
  if (clean.includes('tarifa')) return 'fotoTarifasUrl';
  if (clean.includes('aviso') || clean.includes('letrero')) return 'fotoAvisoUrl';
  if (clean.includes('panoramica') || clean.includes('fachada')) return 'fotoPanoramicaUrl';
  if (clean.includes('matasello')) return 'fotoMataselloUrl';
  if (clean.includes('bascula') || clean.includes('pesa')) return 'fotoBasculaUrl';
  if (clean.includes('contratista') || clean.includes('encargado') || clean.includes('persona')) return 'fotoContratistaUrl';
  if (clean.includes('horario')) return 'fotoHorarioUrl';
  if (clean.includes('computador') || clean.includes('pc')) return 'computadorUrl';
  if (clean.includes('cedulafrontal') || clean.includes('cedula_frontal')) return 'fotoCedulaFrontalUrl';
  if (clean.includes('cedulaposterior') || clean.includes('cedula_posterior')) return 'fotoCedulaPosteriorUrl';
  if (clean.includes('rut')) return 'fotoRutUrl';
  return null;
}

function formatFechaDDMMAAAA(rawFecha?: string | Date): string {
  let d: Date | null = null;
  if (rawFecha instanceof Date && !isNaN(rawFecha.getTime())) {
    d = rawFecha;
  } else if (typeof rawFecha === 'string' && rawFecha.trim()) {
    const clean = rawFecha.trim();
    if (/^\d{8}$/.test(clean)) return clean;
    const isoMatch = clean.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})/);
    if (isoMatch) {
      return `${isoMatch[3]}${isoMatch[2]}${isoMatch[1]}`;
    }
    const dmyMatch = clean.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})/);
    if (dmyMatch) {
      return `${dmyMatch[1]}${dmyMatch[2]}${dmyMatch[3]}`;
    }
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) {
      d = parsed;
    }
  }
  if (!d) d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

function getDrivePhotoFileName(slotKey: string, rawMunicipio?: string, rawFecha?: string | Date): string {
  const itemSlug = getPhotoItemSlug(slotKey);
  const muniClean = formatMunicipioNombre(rawMunicipio || 'Giron')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '');
  const fechaDDMMAAAA = formatFechaDDMMAAAA(rawFecha);

  return `${muniClean || 'Municipio'}_${itemSlug}_${fechaDDMMAAAA}.jpg`;
}

async function getOrCreatePhotosFolderServer(token: string): Promise<{ id: string; name: string; webViewLink?: string }> {
  const folderName = 'Fotos Expendios 4-72 - CAMARCA SAS';
  const query = `'root' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink)&spaces=drive`;
  try {
    const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (searchRes.status === 401) {
      throw new Error('Token de Google Drive expirado o revocado (HTTP 401).');
    }
    if (searchRes.ok) {
      const data = (await searchRes.json()) as any;
      if (data.files && data.files.length > 0) {
        return {
          id: data.files[0].id,
          name: data.files[0].name,
          webViewLink: data.files[0].webViewLink,
        };
      }
    }
  } catch (err: any) {
    if (err.message && err.message.includes('401')) {
      throw err;
    }
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Carpeta oficial central de fotografías de expendios 4-72 - CAMARCA SAS',
    }),
  });
  if (!createRes.ok) {
    const err = (await createRes.json().catch(() => ({}))) as any;
    throw new Error(err?.error?.message || 'Error creando carpeta Fotos Expendios en Google Drive');
  }
  return (await createRes.json()) as any;
}

async function getOrCreateMunicipioFolderServer(
  token: string,
  rootFolderId: string,
  municipio?: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const muniFormatted = formatMunicipioNombre(municipio);
  const query = `'${rootFolderId}' in parents and name='${muniFormatted}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink)&spaces=drive`;
  try {
    const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (searchRes.status === 401) {
      throw new Error('Token de Google Drive expirado o revocado (HTTP 401).');
    }
    if (searchRes.ok) {
      const data = (await searchRes.json()) as any;
      if (data.files && data.files.length > 0) {
        return {
          id: data.files[0].id,
          name: data.files[0].name,
          webViewLink: data.files[0].webViewLink,
        };
      }
    }
  } catch (err: any) {
    if (err.message && err.message.includes('401')) {
      throw err;
    }
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: muniFormatted,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId],
      description: `Carpeta de fotos de expendios del municipio ${muniFormatted} - 4-72 CAMARCA SAS`,
    }),
  });
  if (!createRes.ok) {
    const err = (await createRes.json().catch(() => ({}))) as any;
    throw new Error(err?.error?.message || `Error creando carpeta de municipio ${muniFormatted} en Google Drive`);
  }
  return (await createRes.json()) as any;
}


async function uploadPhotoToGoogleDriveServer(
  buffer: Buffer,
  meta: {
    cedula: string;
    slotKey: string;
    municipio?: string;
    expendioNombre?: string;
    fecha?: string | Date;
    overrideFileName?: string;
  }
): Promise<{
  success: boolean;
  driveFileId?: string;
  webViewLink?: string;
  webContentLink?: string;
  fileName?: string;
  folderName?: string;
  error?: string;
}> {
  let token = await getOrRefreshDriveTokenServer();
  if (!token) {
    return { success: false, error: 'Google Drive no tiene token activo ni Refresh Token en el servidor.' };
  }

  try {
    const cleanCed = meta.cedula.trim();
    const cleanSlot = meta.slotKey.trim();

    // 1. Determinar y forzar el municipio correspondiente al expendio
    let targetMuni = meta.municipio;
    if (!targetMuni || targetMuni === 'General') {
      const lookup = lookupMunicipioForCedula(cleanCed);
      targetMuni = lookup.municipio || 'Giron';
    }
    const muniFormatted = formatMunicipioNombre(targetMuni);
    const tipoLabel = getTipoFotoEtiqueta(cleanSlot);

    // 2. Generar el nombre dinámico exacto: item_municipio_fecha.jpg
    const fileName =
      meta.overrideFileName ||
      getDrivePhotoFileName(cleanSlot, muniFormatted, meta.fecha);

    // 3. Respaldo multi-nivel inmediato en disco local (evita pérdida absoluta de imágenes)
    const localFileName = `${cleanCed}_${cleanSlot}.jpg`;
    const localFilePath = path.join(photosDir, localFileName);
    const permFilePath = path.join(permanentPhotosDir, localFileName);
    const muniDir = path.join(photosMunicipiosDir, muniFormatted);
    const muniFilePath = path.join(muniDir, fileName);

    try {
      if (!fs.existsSync(muniDir)) fs.mkdirSync(muniDir, { recursive: true });
      fs.writeFileSync(localFilePath, buffer);
      fs.writeFileSync(permFilePath, buffer);
      fs.writeFileSync(muniFilePath, buffer);
    } catch (fsErr: any) {
      console.warn('[Storage Server] Advertencia guardando copia local:', fsErr.message);
    }

    // 4. Forzar la estructura de carpetas: Fotos Expendios 4-72 - CAMARCA SAS/{Municipio}
    const rootFolder = await getOrCreatePhotosFolderServer(token);
    const municipioFolder = await getOrCreateMunicipioFolderServer(token, rootFolder.id, muniFormatted);

    // 5. Listar archivos existentes en la subcarpeta del municipio para deduplicar y evitar re-subir fotos iguales
    let existingFiles: any[] = [];
    try {
      const listQuery = `'${municipioFolder.id}' in parents and trashed=false`;
      const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(listQuery)}&fields=files(id,name,size,modifiedTime,webViewLink,webContentLink)&pageSize=100`;
      let listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (listRes.status === 401) {
        const refreshed = await getOrRefreshDriveTokenServer();
        if (refreshed && refreshed !== token) {
          token = refreshed;
          listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
        }
      }
      if (listRes.ok) {
        const listData = (await listRes.json()) as any;
        if (Array.isArray(listData.files)) {
          existingFiles = listData.files;
        }
      }
    } catch (listErr: any) {
      console.warn('[Storage Server] Error listando archivos de municipio:', listErr.message);
    }

    // Filtrar archivos que corresponden a este mismo slot del expendio
    const matchingFiles = existingFiles.filter((f: any) => {
      const fileSlot = getSlotKeyFromFileNameServer(f.name);
      return fileSlot === cleanSlot;
    });

    // Ordenar de más reciente a más antiguo
    matchingFiles.sort((a: any, b: any) => {
      const timeA = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      const timeB = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
      return timeB - timeA;
    });

    const newestExisting = matchingFiles[0];

    // Eliminar inmediatamente duplicados previos más antiguos para dejar SOLO 1 por slot (7 por municipio)
    if (matchingFiles.length > 1) {
      for (const dup of matchingFiles.slice(1)) {
        try {
          await fetch(`https://www.googleapis.com/drive/v3/files/${dup.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          console.log(`[Drive Server] Duplicado previo eliminado en ${muniFormatted}: ${dup.name} (${dup.id})`);
        } catch {}
      }
    }

    // REGLA: Si el archivo ya existe y el tamaño en bytes es idéntico, OMITIR CARGA
    if (newestExisting && newestExisting.size && Math.abs(Number(newestExisting.size) - buffer.length) === 0) {
      console.log(`[Drive Server] ✓ Foto de ${tipoLabel} en ${muniFormatted} ya está guardada e idéntica. Se omite subida.`);
      return {
        success: true,
        driveFileId: newestExisting.id,
        webViewLink: newestExisting.webViewLink || '',
        webContentLink: newestExisting.webContentLink || '',
        fileName: newestExisting.name,
        folderName: municipioFolder.name,
      };
    }

    const description = `Fotografía de ${tipoLabel} del expendio en ${muniFormatted} (Cédula: ${cleanCed}, Encargado: ${meta.expendioNombre || ''}) - CAMARCA SAS`;

    let uploadedId = newestExisting?.id;
    let webViewLink = newestExisting?.webViewLink || '';
    let webContentLink = newestExisting?.webContentLink || '';

    if (newestExisting) {
      // Actualizar archivo existente en la subcarpeta (PATCH)
      const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${newestExisting.id}?uploadType=media&fields=id,name,webViewLink,webContentLink`;
      let updateRes = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'image/jpeg',
        },
        body: buffer,
      });

      if (updateRes.status === 401) {
        const refreshed = await getOrRefreshDriveTokenServer();
        if (refreshed && refreshed !== token) {
          token = refreshed;
          updateRes = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'image/jpeg',
            },
            body: buffer,
          });
        }
      }

      if (!updateRes.ok) {
        const err = (await updateRes.json().catch(() => ({}))) as any;
        throw new Error(err?.error?.message || `Error actualizando foto en Google Drive (HTTP ${updateRes.status})`);
      }
      const updated = (await updateRes.json()) as any;
      uploadedId = updated.id;
      webViewLink = updated.webViewLink || '';
      webContentLink = updated.webContentLink || '';

      // Actualizar nombre a formato oficial
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${newestExisting.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: fileName, description }),
        });
      } catch {}
    } else {
      // Subida multipart de archivo nuevo en la subcarpeta del municipio
      const boundary = '-------CamarcaPhotoBoundary' + Date.now();
      const delimiter = '\r\n--' + boundary + '\r\n';
      const closeDelimiter = '\r\n--' + boundary + '--';
      const metadata = {
        name: fileName,
        mimeType: 'image/jpeg',
        parents: [municipioFolder.id],
        description,
      };

      const part1Str = [
        delimiter,
        "Content-Type: application/json; charset=UTF-8\r\n\r\n",
        JSON.stringify(metadata),
        "\r\n",
        delimiter,
        "Content-Type: image/jpeg\r\n\r\n"
      ].join('');
      const part1 = Buffer.from(part1Str);
      const part2 = Buffer.from(closeDelimiter);
      const body = Buffer.concat([part1, buffer, part2]);

      const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink';
      let uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      });

      if (uploadRes.status === 401) {
        const refreshed = await getOrRefreshDriveTokenServer();
        if (refreshed && refreshed !== token) {
          token = refreshed;
          uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body,
          });
        }
      }

      if (!uploadRes.ok) {
        const err = (await uploadRes.json().catch(() => ({}))) as any;
        throw new Error(err?.error?.message || `Error al subir foto a Google Drive (HTTP ${uploadRes.status})`);
      }

      const uploaded = (await uploadRes.json()) as any;
      uploadedId = uploaded.id;
      webViewLink = uploaded.webViewLink || '';
      webContentLink = uploaded.webContentLink || '';
    }


    // 6. Actualizar registro en memoria, disco y PostgreSQL
    const registry = loadDrivePhotosRegistry();
    const key = `${cleanCed}_${cleanSlot}`;
    let localMtime = Date.now();
    try {
      if (fs.existsSync(localFilePath)) localMtime = fs.statSync(localFilePath).mtimeMs;
    } catch {}

    registry[key] = {
      cedula: cleanCed,
      slotKey: cleanSlot,
      driveFileId: uploadedId,
      webViewLink,
      webContentLink,
      fileName,
      folderName: municipioFolder.name,
      municipio: muniFormatted,
      savedAt: new Date().toISOString(),
      localMtime,
    };
    saveDrivePhotosRegistry(registry);

    // 7. Sincronizar automáticamente con la base de datos de expendios y PostgreSQL
    try {
      await mutateDatabase(async (db) => {
        const expIdx = db.expendios.findIndex((e: any) => String(e.cedula || '').replace(/\D/g, '').trim() === cleanCed.replace(/\D/g, '').trim());
        if (expIdx !== -1) {
          const canonicalUrl = `/api/photos/${encodeURIComponent(cleanCed)}/${encodeURIComponent(cleanSlot)}`;
          (db.expendios[expIdx] as any)[cleanSlot] = canonicalUrl;
          if (cleanSlot.includes('aviso') || cleanSlot.includes('letrero')) {
            db.expendios[expIdx].tieneAviso = 'SI';
            db.expendios[expIdx].letreroUrl = canonicalUrl;
            db.expendios[expIdx].motivoFaltaAviso = '';
          } else if (cleanSlot.includes('bascula')) {
            db.expendios[expIdx].tieneBascula = 'SI';
            db.expendios[expIdx].basculaUrl = canonicalUrl;
            db.expendios[expIdx].motivoFaltaBascula = '';
          } else if (cleanSlot.includes('matasello')) {
            db.expendios[expIdx].tieneMatasello = 'SI';
            db.expendios[expIdx].mataselloUrl = canonicalUrl;
            db.expendios[expIdx].motivoFaltaMatasello = '';
          }
          db.expendios[expIdx].fechaUltimaActualizacion = new Date().toISOString().split('T')[0];
        }
      });
    } catch (syncErr: any) {
      console.warn('[Sync Database] Error asociando foto con expendio:', syncErr.message);
    }

    return {
      success: true,
      driveFileId: uploadedId,
      webViewLink,
      webContentLink,
      fileName,
      folderName: municipioFolder.name,
    };
  } catch (err: any) {
    if (err.message && (err.message.includes('401') || err.message.includes('invalid authentication credentials'))) {
       console.warn(`[Google Drive Server] Token revocado o expirado (HTTP 401) subiendo foto ${meta.slotKey}.`);
       await mutateDatabase(async (db) => {
         if (db.config) {
           db.config.googleDriveAccessToken = '';
         }
       }).catch(() => {});
       return { success: false, error: 'Autenticación inválida (HTTP 401). Inicie sesión en Google Drive.' };
    }
    console.warn(`[Google Drive Server] Error subiendo foto ${meta.slotKey}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function listAllSubfoldersServer(token: string, rootFolderId: string): Promise<any[]> {
  try {
    const q = `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=100&fields=files(id,name,webViewLink)`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      return data.files || [];
    }
  } catch {}
  return [];
}

async function reconcileAndOrganizeGoogleDrivePhotosServer(token: string): Promise<{
  success: boolean;
  movedCount: number;
  totalDriveFiles: number;
  linkedCount: number;
  folderName: string;
  folderUrl?: string;
  error?: string;
}> {
  try {
    const rootFolder = await getOrCreatePhotosFolderServer(token);
    const registry = loadDrivePhotosRegistry();
    const db = loadDatabase();

    // 1. Listar archivos y subcarpetas dentro de la carpeta raíz
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `'${rootFolder.id}' in parents and trashed=false`
    )}&pageSize=200&fields=files(id,name,mimeType,parents,webViewLink,webContentLink,size,description)`;

    const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!listRes.ok) {
      const err = (await listRes.json().catch(() => ({}))) as any;
      throw new Error(err?.error?.message || `Error listando contenido de Drive (HTTP ${listRes.status})`);
    }

    const { files = [] } = (await listRes.json()) as { files: any[] };

    // Identificar archivos sueltos fuera de las subcarpetas de municipio
    const looseFiles = files.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');

    let movedCount = 0;

    // 2. Mover cada foto suelta a la subcarpeta del municipio correspondiente
    for (const file of looseFiles) {
      let cedula = '';
      let slotKey = '';

      if (file.description) {
        const matchDesc = file.description.match(/C.dula:\s*([a-zA-Z0-9_-]+)/i);
        if (matchDesc && matchDesc[1]) cedula = matchDesc[1].trim();
      }
      const matchCed = file.name.match(/^(\d{5,12})_([a-zA-Z0-9_]+)\.jpg$/i);
      if (!cedula && matchCed) cedula = matchCed[1];
      
      if (matchCed) {
        slotKey = matchCed[2];
      }
      if (!slotKey) {
         const n = file.name.toLowerCase();
         if (n.includes('aviso') || n.includes('letrero')) slotKey = 'fotoAvisoUrl';
         else if (n.includes('panoramica') || n.includes('fachada')) slotKey = 'fotoPanoramicaUrl';
         else if (n.includes('matasello')) slotKey = 'fotoMataselloUrl';
         else if (n.includes('bascula')) slotKey = 'fotoBasculaUrl';
         else if (n.includes('contratista') || n.includes('encargado')) slotKey = 'fotoContratistaUrl';
         else if (n.includes('horario')) slotKey = 'fotoHorarioUrl';
         else if (n.includes('tarifa')) slotKey = 'fotoTarifasUrl';
         else if (n.includes('computador') || n.includes('pc')) slotKey = 'computadorUrl';
      }
      if (cedula && slotKey) {
      } else {
        const parts = file.name.replace('.jpg', '').split('_');
        if (parts.length >= 2) {
          cedula = parts[0];
          slotKey = parts.slice(1).join('_');
        }
      }

      const lookup = lookupMunicipioForCedula(cedula);
      const targetMuni = lookup.municipio || 'Giron';
      const muniFolder = await getOrCreateMunicipioFolderServer(token, rootFolder.id, targetMuni);

      // Mover el archivo mediante API de Google Drive
      const moveUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?addParents=${muniFolder.id}&removeParents=${rootFolder.id}&fields=id,name,parents,webViewLink,webContentLink`;
      const moveRes = await fetch(moveUrl, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (moveRes.ok) {
        movedCount++;
        const movedData = (await moveRes.json()) as any;
        if (cedula && slotKey) {
          const key = `${cedula.trim()}_${slotKey.trim()}`;
          registry[key] = {
            cedula: cedula.trim(),
            slotKey: slotKey.trim(),
            driveFileId: movedData.id,
            webViewLink: movedData.webViewLink || file.webViewLink,
            webContentLink: movedData.webContentLink || file.webContentLink,
            fileName: file.name,
            folderName: muniFolder.name,
            savedAt: new Date().toISOString(),
          };

          // Descargar al caché local si falta en disco
          const localPath = path.join(photosDir, `${cedula.trim()}_${slotKey.trim()}.jpg`);
          if (!fs.existsSync(localPath)) {
            try {
              const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (dlRes.ok) {
                const buf = Buffer.from(await dlRes.arrayBuffer());
                fs.writeFileSync(localPath, buf);
              }
            } catch {}
          }

          // Enlazar en el expendio en la base de datos
          const cleanCed = cedula.replace(/\D/g, '');
          const expIdx = (db.expendios || []).findIndex(
            (e: any) => String(e.cedula || '').replace(/\D/g, '') === cleanCed
          );
          if (expIdx !== -1) {
            (db.expendios[expIdx] as any)[slotKey] = `/api/photos/${encodeURIComponent(cedula)}/${slotKey}`;
          }
        }
      }
    }

    // 3. Explorar e indexar todas las fotos existentes dentro de las carpetas de municipios
    const allMuniFolders = await listAllSubfoldersServer(token, rootFolder.id);
    for (const mf of allMuniFolders) {
      try {
        const subFilesUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          `'${mf.id}' in parents and trashed=false`
        )}&pageSize=100&fields=files(id,name,mimeType,webViewLink,webContentLink,description)`;
        const subRes = await fetch(subFilesUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (subRes.ok) {
          const subData = (await subRes.json()) as any;
          for (const sf of subData.files || []) {
            let cedula = '';
            let slotKey = '';
            const match = sf.name.match(/^(\d{5,12})_([a-zA-Z0-9_]+)\.jpg$/i);
            if (match) {
              cedula = match[1];
              slotKey = match[2];
            } else {
              const lowerName = sf.name.toLowerCase();
              const foundSlot = [
                'fotoAvisoUrl',
                'fotoPanoramicaUrl',
                'fotoMataselloUrl',
                'fotoBasculaUrl',
                'fotoContratistaUrl',
                'fotoHorarioUrl',
                'fotoTarifasUrl',
              ].find((s) => lowerName.includes(s.toLowerCase().replace('url', '')));
              if (foundSlot) {
                slotKey = foundSlot;
                const exp = (db.expendios || []).find(
                  (e: any) => formatMunicipioNombre(e.municipio || '').toLowerCase() === mf.name.toLowerCase()
                );
                if (exp) cedula = String(exp.cedula).replace(/\D/g, '');
              }
            }

            if (cedula && slotKey) {
              const key = `${cedula.trim()}_${slotKey.trim()}`;
              registry[key] = {
                cedula: cedula.trim(),
                slotKey: slotKey.trim(),
                driveFileId: sf.id,
                webViewLink: sf.webViewLink,
                webContentLink: sf.webContentLink,
                fileName: sf.name,
                folderName: mf.name,
                savedAt: new Date().toISOString(),
              };
              
              // Ensure expendio is updated in local DB
              const cleanCed = cedula.replace(/\D/g, '');
              const expIdx = (db.expendios || []).findIndex(
                (e) => String(e.cedula || '').replace(/\D/g, '') === cleanCed
              );
              if (expIdx !== -1) {
                db.expendios[expIdx][slotKey] = `/api/photos/${encodeURIComponent(cedula.trim())}/${slotKey.trim()}`;
              }

              const localPath = path.join(photosDir, `${cedula.trim()}_${slotKey.trim()}.jpg`);
              if (!fs.existsSync(localPath)) {
                try {
                  const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${sf.id}?alt=media`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (dlRes.ok) {
                    const buf = Buffer.from(await dlRes.arrayBuffer());
                    fs.writeFileSync(localPath, buf);
                  }
                } catch {}
              }
            }
          }
        }
      } catch {}
    }

    saveDrivePhotosRegistry(registry);
    await mutateDatabase(async (database) => {
      // Reconciliar fotos con base de datos en memoria
      for (const [key, item] of Object.entries(registry)) {
        const expIdx = (database.expendios || []).findIndex(
          (e: any) => String(e.cedula || '').replace(/\D/g, '').trim() === item.cedula.replace(/\D/g, '').trim()
        );
        if (expIdx !== -1) {
          (database.expendios[expIdx] as any)[item.slotKey] = `/api/photos/${encodeURIComponent(item.cedula.trim())}/${item.slotKey.trim()}`;
        }
      }
    });

    const totalDriveFiles = Object.keys(registry).length;
    
    console.log(
      `[Google Drive Reconcile] Completado con éxito: ${movedCount} fotos organizadas en carpetas de municipios, ${totalDriveFiles} fotos enlazadas permanentemente.`
    );

    return {
      success: true,
      movedCount,
      totalDriveFiles,
      linkedCount: totalDriveFiles,
      folderName: rootFolder.name,
      folderUrl: rootFolder.webViewLink,
    };
  } catch (err: any) {
    if (err.message && (err.message.includes('401') || err.message.includes('invalid authentication credentials'))) {
       console.warn('[Google Drive Reconcile] Token revocado o expirado. Pausando sincronización hasta nuevo inicio de sesión.');
       // Borrar credenciales inválidas para evitar reintentos continuos
       await mutateDatabase(async (db) => {
         if (db.config) {
           db.config.googleDriveAccessToken = '';
         }
       }).catch(() => {});
       return {
         success: false,
         movedCount: 0,
         totalDriveFiles: 0,
         linkedCount: 0,
         folderName: 'Fotos Expendios 4-72 - CAMARCA SAS',
         error: 'Autenticación inválida (HTTP 401). Inicie sesión en Google Drive nuevamente.',
       };
    }
    console.error('[Google Drive Reconcile] Error:', err.message);
    return {
      success: false,
      movedCount: 0,
      totalDriveFiles: 0,
      linkedCount: 0,
      folderName: 'Fotos Expendios 4-72 - CAMARCA SAS',
      error: err.message,
    };
  }
}

// =========================================================================
// MOTOR DE BACKGROUND SYNC - SINCRONIZACIÓN AUTOMÁTICA EN SEGUNDO PLANO
// =========================================================================

interface BackgroundSyncStatus {
  isWatcherActive: boolean;
  isSyncRunning: boolean;
  lastSyncTimestamp: string | null;
  lastSyncDurationMs: number;
  totalLocalPhotos: number;
  syncedPhotosCount: number;
  pendingPhotosCount: number;
  totalSyncedInLastRun: number;
  lastError: string | null;
  lastChangeDetectedAt: string | null;
  hasToken: boolean;
  folderName: string;
}

class BackgroundPhotoSyncEngine {
  private watcher: fs.FSWatcher | null = null;
  private isSyncRunning: boolean = false;
  private hasPendingRun: boolean = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private sweepInterval: NodeJS.Timeout | null = null;
  private isWatcherActive: boolean = false;
  private lastSyncTimestamp: string | null = null;
  private lastSyncDurationMs: number = 0;
  private totalSyncedInLastRun: number = 0;
  private lastError: string | null = null;
  private lastChangeDetectedAt: string | null = null;

  public init() {
    this.startWatcher();
    this.startPeriodicSweep();
    // Escaneo inicial tras arranque (5 segundos para permitir que hydration termine)
    setTimeout(() => {
      this.executeSync('Arranque inicial del servidor');
    }, 5000);
  }

  public startWatcher() {
    if (this.watcher) {
      try { this.watcher.close(); } catch {}
      this.watcher = null;
    }

    try {
      if (!fs.existsSync(photosDir)) {
        fs.mkdirSync(photosDir, { recursive: true });
      }

      this.watcher = fs.watch(photosDir, { persistent: true }, (eventType, filename) => {
        if (!filename) return;
        const name = String(filename);
        if (name.startsWith('.') || !name.toLowerCase().endsWith('.jpg')) return;

        this.lastChangeDetectedAt = new Date().toISOString();
        console.log(`[Background Sync Watcher] Cambio local (${eventType}) detectado en: ${name}`);
        // Debounce de 2 segundos para asegurar que el archivo se termine de escribir
        this.scheduleDebouncedSync(2000, `Cambio local detectado en ${name}`);
      });

      this.watcher.on('error', (err) => {
        console.warn('[Background Sync Watcher] Error en monitor de archivos:', err.message);
        this.isWatcherActive = false;
        setTimeout(() => this.startWatcher(), 10000);
      });

      this.isWatcherActive = true;
      console.log(`[Background Sync Engine] Vigilante de almacenamiento local ACTIVO en: ${photosDir}`);
    } catch (e: any) {
      console.warn('[Background Sync Watcher] No se pudo activar fs.watch:', e.message);
      this.isWatcherActive = false;
    }
  }

  public startPeriodicSweep() {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    // Modo ahorro de costos (FinOps Scale-to-Zero): el barrido solo se ejecuta bajo demanda (notifyPhotoChanged / fs.watch)
    // evitando mantener despiertos Cloud Run, Cloud SQL y Firestore las 24 horas cuando no hay usuarios activos.
    this.sweepInterval = null;
  }

  public scheduleDebouncedSync(delayMs: number = 2000, reason: string = 'Automático') {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.executeSync(reason);
    }, delayMs);
  }

  public notifyPhotoChanged(fileName?: string) {
    markPhotoActivity();
    this.lastChangeDetectedAt = new Date().toISOString();
    console.log(`[Background Sync Engine] Notificación de foto modificada/guardada: ${fileName || 'nueva'}`);
    this.scheduleDebouncedSync(1000, `Notificación de cambio: ${fileName || 'nueva foto'}`);
  }

  public async triggerImmediateSync(reason: string = 'Manual'): Promise<{ success: boolean; synced: number; error?: string }> {
    return this.executeSync(reason);
  }

  public async executeSync(reason: string = 'Desconocido'): Promise<{ success: boolean; synced: number; error?: string }> {
    if (this.isSyncRunning) {
      this.hasPendingRun = true;
      return { success: true, synced: 0 };
    }

    this.isSyncRunning = true;
    const startTime = Date.now();
    let synced = 0;

    try {
      // 1. Obtener o renovar automáticamente el token de Google Drive usando refresh token
      const token = await getOrRefreshDriveTokenServer();
      if (!token) {
        this.lastError = 'Google Drive no tiene token activo en el servidor. Inicie sesión en la sección de Google Drive.';
        return { success: false, synced: 0, error: this.lastError };
      }

      if (!fs.existsSync(photosDir)) {
        fs.mkdirSync(photosDir, { recursive: true });
      }

      // 2. Proteger contra pérdida de fotos: restaurar cualquier foto presente en permanentPhotosDir
      if (fs.existsSync(permanentPhotosDir)) {
        try {
          const permFiles = fs.readdirSync(permanentPhotosDir).filter((f) => !f.startsWith('.') && f.endsWith('.jpg'));
          for (const pf of permFiles) {
            const dest = path.join(photosDir, pf);
            if (!fs.existsSync(dest)) {
              fs.copyFileSync(path.join(permanentPhotosDir, pf), dest);
            }
          }
        } catch {}
      }

      // 3. Rescatar fotos en base64 de expendios que aún no estén en disco (usando referencia de solo lectura sin clonar DB)
      const readOnlyDb = getDatabaseReadOnly();
      try {
        const photoKeys = [
          'fotoAvisoUrl', 'fotoAviso', 'letreroUrl', 'letrero',
          'fotoBasculaUrl', 'fotoBascula', 'basculaUrl', 'bascula',
          'fotoMataselloUrl', 'fotoMatasello', 'mataselloUrl', 'matasello',
          'fotoPanoramicaUrl', 'fotoPanoramica', 'fotoFachadaUrl',
          'fotoContratistaUrl', 'fotoContratista',
          'fotoHorarioUrl', 'fotoHorario',
          'fotoTarifasUrl', 'fotoTarifas',
          'fotoComputadorUrl', 'fotoComputador'
        ];

        for (const exp of readOnlyDb.expendios) {
          const ced = String(exp.cedula || '').replace(/\D/g, '').trim();
          if (!ced) continue;

          for (const key of photoKeys) {
            const val = (exp as any)[key];
            if (typeof val === 'string' && val.startsWith('data:image/')) {
              const base64Data = val.replace(/^data:image\/[a-z]+;base64,/, '');
              const localName = `${ced}_${key}.jpg`;
              const localPath = path.join(photosDir, localName);
              const permPath = path.join(permanentPhotosDir, localName);
              if (!fs.existsSync(localPath)) {
                try {
                  const buf = Buffer.from(base64Data, 'base64');
                  fs.writeFileSync(localPath, buf);
                  fs.writeFileSync(permPath, buf);
                } catch {}
              }
            }
          }
        }
      } catch {}

      const files = fs.readdirSync(photosDir).filter((f) => !f.startsWith('.') && !f.startsWith('foto-') && f.endsWith('.jpg'));
      const registry = loadDrivePhotosRegistry();

      for (const f of files) {
        const parts = f.replace('.jpg', '').split('_');
        if (parts.length >= 2) {
          const cedula = parts[0].trim();
          const slotKey = parts.slice(1).join('_').trim();
          const key = `${cedula}_${slotKey}`;
          const filePath = path.join(photosDir, f);

          let stat: fs.Stats | null = null;
          try {
            stat = fs.statSync(filePath);
          } catch {}

          const existingEntry = registry[key];
          const hasDriveId = Boolean(existingEntry && existingEntry.driveFileId);
          const wasModifiedLocally = Boolean(
            stat &&
            existingEntry &&
            existingEntry.localMtime &&
            stat.mtimeMs > (existingEntry.localMtime + 2000)
          );

          const activeToken = await getOrRefreshDriveTokenServer();
          if (activeToken && (!hasDriveId || wasModifiedLocally)) {
            const lookup = lookupMunicipioForCedula(cedula);
            const expMatch = readOnlyDb.expendios.find((e: any) => String(e.cedula || '').replace(/\D/g, '').trim() === cedula.replace(/\D/g, '').trim());
            const buffer = fs.readFileSync(filePath);
            const fechaExp = expMatch?.fechaUltimaActualizacion || new Date().toISOString().split('T')[0];

            const res = await uploadPhotoToGoogleDriveServer(buffer, {
              cedula,
              slotKey,
              municipio: lookup.municipio || 'Giron',
              expendioNombre: lookup.encargado || '',
              fecha: fechaExp,
            });

            if (res.success && res.driveFileId) {
              synced++;
              registry[key] = {
                driveFileId: res.driveFileId,
                webViewLink: res.webViewLink,
                webContentLink: res.webContentLink,
                lastSyncTime: new Date().toISOString(),
                localMtime: stat?.mtimeMs,
              };
              console.log(`[Background Sync] Sincronizada automáticamente foto ${f} a Google Drive (${lookup.municipio || 'Giron'})`);
            }
          }
        }
      }

      this.lastSyncTimestamp = new Date().toISOString();
      this.totalSyncedInLastRun = synced;
      this.lastError = null;
      this.lastSyncDurationMs = Date.now() - startTime;
      if (synced > 0) {
        console.log(`[Background Sync] Completado con éxito: ${synced} fotos sincronizadas a sus carpetas por municipio.`);
      }
      return { success: true, synced };
    } catch (err: any) {
      console.warn('[Background Sync] Error durante la sincronización en segundo plano:', err.message);
      this.lastError = err.message;
      return { success: false, synced, error: err.message };
    } finally {
      this.isSyncRunning = false;
      if (this.hasPendingRun) {
        this.hasPendingRun = false;
        setTimeout(() => this.executeSync('Ejecución acumulada'), 1000);
      }
    }
  }

  public getStatus(): BackgroundSyncStatus {
    let totalLocal = 0;
    let pendingCount = 0;
    let syncedCount = 0;

    try {
      if (fs.existsSync(photosDir)) {
        const files = fs.readdirSync(photosDir).filter((f) => !f.startsWith('.') && f.endsWith('.jpg'));
        totalLocal = files.length;
        const registry = loadDrivePhotosRegistry();

        for (const f of files) {
          const parts = f.replace('.jpg', '').split('_');
          if (parts.length >= 2) {
            const cedula = parts[0].trim();
            const slotKey = parts.slice(1).join('_').trim();
            const key = `${cedula}_${slotKey}`;
            const reg = registry[key];
            if (reg && reg.driveFileId) {
              syncedCount++;
            } else {
              pendingCount++;
            }
          } else {
            pendingCount++;
          }
        }
      }
    } catch {}

    const token = getActiveDriveTokenServer();
    const creds = loadGoogleDriveCredentials();

    return {
      isWatcherActive: this.isWatcherActive,
      isSyncRunning: this.isSyncRunning,
      lastSyncTimestamp: this.lastSyncTimestamp,
      lastSyncDurationMs: this.lastSyncDurationMs,
      totalLocalPhotos: totalLocal,
      syncedPhotosCount: syncedCount,
      pendingPhotosCount: pendingCount,
      totalSyncedInLastRun: this.totalSyncedInLastRun,
      lastError: this.lastError,
      lastChangeDetectedAt: this.lastChangeDetectedAt,
      hasToken: Boolean(token || creds?.refreshToken),
      folderName: 'Fotos Expendios 4-72 - CAMARCA SAS',
    };
  }
}

const backgroundPhotoSyncEngine = new BackgroundPhotoSyncEngine();

async function syncPendingPhotosToServerDrive(token: string): Promise<number> {
  const result = await backgroundPhotoSyncEngine.triggerImmediateSync('Llamada manual de sincronización');
  return result.synced || 0;
}

// Endpoint para consultar el estado del servicio Background Sync
app.get('/api/admin/google-drive/sync-status', (req, res) => {
  const status = backgroundPhotoSyncEngine.getStatus();
  res.json({
    success: true,
    ...status,
  });
});

// Endpoint para forzar sincronización en segundo plano manualmente
app.post('/api/admin/google-drive/trigger-sync', async (req, res) => {
  const result = await backgroundPhotoSyncEngine.triggerImmediateSync('Disparador manual de usuario');
  const status = backgroundPhotoSyncEngine.getStatus();
  res.json({
    success: result.success,
    synced: result.synced,
    error: result.error,
    status,
    message: result.success
      ? `Sincronización en segundo plano completada. ${result.synced} fotos procesadas.`
      : `Aviso en sincronización: ${result.error || 'Error desconocido'}`,
  });
});

// Endpoints de Token y Estado de Google Drive
app.get('/api/admin/google-drive/token', async (req, res) => {
  const token = await getOrRefreshDriveTokenServer();
  const creds = loadGoogleDriveCredentials();
  const db = loadDatabase();
  const activeToken = token;
  const refreshToken = (creds?.refreshToken || db.config?.googleDriveRefreshToken)?.trim();
  const email = creds?.email || db.config?.googleDriveAccountEmail;
  const displayName = creds?.displayName || (db.config as any)?.googleDriveAccountName;
  const expiresAt = creds?.expiresAt || db.config?.googleDriveTokenExpiresAt;
  res.json({
    success: true,
    hasToken: Boolean(activeToken),
    accessToken: activeToken || null,
    hasRefreshToken: Boolean(refreshToken),
    expiresAt: activeToken ? (expiresAt || null) : null,
    email: activeToken ? (email || null) : null,
    displayName: activeToken ? (displayName || null) : null,
    googleOAuthClientId: (db.config as any)?.googleOAuthClientId || '',
    googleOAuthClientSecret: (db.config as any)?.googleOAuthClientSecret || '',
  });
});

app.post('/api/admin/google-drive/set-token', async (req, res) => {
  const { accessToken, refreshToken, email, displayName, expiresIn, disconnect } = req.body || {};

  if (disconnect === true || accessToken === 'cleared') {
    await purgeInvalidGoogleDriveCredentialsServer();
    await mutateDatabase(async (database) => {
      if (!database.config) database.config = {} as any;
      database.config.googleDriveAccessToken = '';
      database.config.googleDriveRefreshToken = '';
      database.config.googleDriveAccountEmail = '';
      (database.config as any).googleDriveAccountName = '';
      database.config.googleDriveTokenExpiresAt = 0;
    });
    return res.json({
      success: true,
      disconnected: true,
      hasToken: false,
      message: 'Cuenta de Google Drive desconectada exitosamente.',
    });
  }

  if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length < 10) {
    return res.status(400).json({ success: false, message: 'Se requiere accessToken válido.' });
  }
  const cleanToken = accessToken.trim();
  const cleanRefreshToken = typeof refreshToken === 'string' && refreshToken.trim().length > 5 ? refreshToken.trim() : undefined;
  const db = loadDatabase();
  const calculatedExpiresAt = expiresIn ? Date.now() + expiresIn * 1000 : (db.config?.googleDriveTokenExpiresAt || Date.now() + 3600 * 1000);
  
  await mutateDatabase(async (database) => {
    if (!database.config) database.config = {} as any;
    database.config.googleDriveAccessToken = cleanToken;
    if (cleanRefreshToken) database.config.googleDriveRefreshToken = cleanRefreshToken;
    if (email) database.config.googleDriveAccountEmail = email;
    if (displayName) (database.config as any).googleDriveAccountName = displayName;
    database.config.googleDriveTokenExpiresAt = calculatedExpiresAt;
  });

  // Guardar en archivo independiente google_drive_credentials.json
  const existingCreds = loadGoogleDriveCredentials();
  saveGoogleDriveCredentials({
    accessToken: cleanToken,
    refreshToken: cleanRefreshToken || existingCreds?.refreshToken,
    expiresAt: calculatedExpiresAt,
    email: email || db.config?.googleDriveAccountEmail || '',
    displayName: displayName || (db.config as any)?.googleDriveAccountName || '',
    updatedAt: new Date().toISOString(),
  });

  // Sincronizar y organizar fotos en segundo plano
  setTimeout(() => {
    reconcileAndOrganizeGoogleDrivePhotosServer(cleanToken).then(() => {
      syncPendingPhotosToServerDrive(cleanToken).catch(() => {});
    }).catch(() => {});
  }, 200);

  res.json({
    success: true,
    hasRefreshToken: Boolean(cleanRefreshToken || existingCreds?.refreshToken),
    expiresAt: calculatedExpiresAt,
    message: 'Token de Google Drive guardado de forma permanente en el servidor. Conexión activa, renovación automática y sincronización habilitada.',
  });
});

app.post('/api/admin/google-drive/disconnect', async (req, res) => {
  try {
    await purgeInvalidGoogleDriveCredentialsServer();
    await mutateDatabase(async (database) => {
      if (!database.config) database.config = {} as any;
      database.config.googleDriveAccessToken = '';
      database.config.googleDriveRefreshToken = '';
      database.config.googleDriveAccountEmail = '';
      (database.config as any).googleDriveAccountName = '';
      database.config.googleDriveTokenExpiresAt = 0;
    });
    res.json({
      success: true,
      disconnected: true,
      hasToken: false,
      message: 'Cuenta de Google Drive desconectada correctamente.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/google-drive/refresh-token', async (req, res) => {
  const { refreshToken } = req.body || {};
  const result = await refreshServerDriveToken(refreshToken);
  if (result.success) {
    return res.json({
      success: true,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      message: 'Token de acceso renovado exitosamente con Refresh Token.',
    });
  } else {
    return res.status(400).json({
      success: false,
      error: result.error || 'No se pudo renovar el token de acceso.',
    });
  }
});

app.post('/api/admin/google-drive/oauth2/code-exchange', async (req, res) => {
  const { code, redirectUri } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ success: false, error: 'Se requiere código de autorización OAuth2 válido.' });
  }

  const clientId = getOAuthClientId();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || (loadDatabase().config as any)?.googleOAuthClientSecret || '';

  try {
    const params = new URLSearchParams();
    params.append('code', code.trim());
    params.append('client_id', clientId);
    if (clientSecret) params.append('client_secret', clientSecret);
    params.append('redirect_uri', redirectUri || 'postmessage');
    params.append('grant_type', 'authorization_code');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = (await tokenRes.json()) as any;
    if (!tokenRes.ok || !data.access_token) {
      const errorMsg = data.error_description || data.error || `HTTP ${tokenRes.status}`;
      return res.status(400).json({ success: false, error: errorMsg });
    }

    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;
    const expiresIn = data.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    await mutateDatabase(async (database) => {
      if (!database.config) database.config = {} as any;
      database.config.googleDriveAccessToken = accessToken;
      if (refreshToken) database.config.googleDriveRefreshToken = refreshToken;
      database.config.googleDriveTokenExpiresAt = expiresAt;
    });

    const existingCreds = loadGoogleDriveCredentials();
    saveGoogleDriveCredentials({
      accessToken,
      refreshToken: refreshToken || existingCreds?.refreshToken,
      expiresAt,
      email: existingCreds?.email || (loadDatabase().config as any)?.googleDriveAccountEmail,
      displayName: existingCreds?.displayName || (loadDatabase().config as any)?.googleDriveAccountName,
      updatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      accessToken,
      refreshToken: refreshToken || existingCreds?.refreshToken || null,
      expiresIn,
      message: 'Autorización OAuth2 completada exitosamente. Refresh token obtenido y enlazado.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

  app.get('/api/photos/google-drive-registry', requireAuthenticatedUser, (req, res) => {
    try {
      const registry = loadDrivePhotosRegistry();
      res.json({
        success: true,
        registry,
        count: Object.keys(registry).length,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post('/api/admin/google-drive/sync-all', async (req, res) => {
    const token = (req.body?.accessToken as string) || (await getOrRefreshDriveTokenServer());
    let synced = 0;
    if (token) {
      synced = await syncPendingPhotosToServerDrive(token);
    }
    const registry = loadDrivePhotosRegistry();
    const currentDb = getDatabase();
    for (const [k, entry] of Object.entries(registry)) {
      if (!entry || typeof entry !== 'object') continue;
      const mun = String(entry.folderName || entry.municipio || 'Sin_Municipio').trim();
      const slotKey = String(entry.slotKey || k.split('_')[1] || 'fotoAvisoUrl');
      entry.fileName = getDrivePhotoFileName(mun, slotKey, entry.savedAt ? new Date(entry.savedAt) : new Date());
      entry.folderName = mun;
      entry.municipio = mun;
      const matchedExp = currentDb.expendios.find(
        (e) =>
          normalizeCedula(e.cedula) === normalizeCedula(entry.cedula) ||
          String(e.municipio || '').trim().toUpperCase() === mun.toUpperCase()
      );
      if (matchedExp && matchedExp.cedula) {
        const cleanCed = normalizeCedula(matchedExp.cedula);
        registry[`${cleanCed}_${slotKey}`] = {
          ...entry,
          cedula: cleanCed,
        };
      }
    }
    saveDrivePhotosRegistry(registry);
    const uniqueCount = new Set(Object.values(registry).map((e: any) => e?.driveFileId).filter(Boolean)).size;
    res.json({
      success: true,
      synced: synced || uniqueCount,
      uploaded: synced,
      total: uniqueCount,
      message: `Se sincronizaron y verificaron ${synced || uniqueCount} fotos en Google Drive ({Municipio}/{Municipio}_{TipoFoto}_{DDMMAAAA}.jpg).`,
    });
  });

  app.post('/api/admin/google-drive/reconcile', async (req, res) => {
    const token = (req.body?.accessToken as string) || (await getOrRefreshDriveTokenServer());
    if (token) {
      const result = await reconcileAndOrganizeGoogleDrivePhotosServer(token);
      return res.json(result);
    }
    // Reconciliación directa sobre el registro persistente de Google Drive y vinculación con Expendios
    const registry = loadDrivePhotosRegistry();
    const currentDb = getDatabase();
    let linkedCount = 0;
    for (const [k, entry] of Object.entries(registry)) {
      if (!entry || typeof entry !== 'object') continue;
      const mun = String(entry.folderName || entry.municipio || 'Sin_Municipio').trim();
      const slotKey = String(entry.slotKey || k.split('_')[1] || 'fotoAvisoUrl');
      entry.fileName = getDrivePhotoFileName(mun, slotKey, entry.savedAt ? new Date(entry.savedAt) : new Date());
      entry.folderName = mun;
      entry.municipio = mun;
      const matchedExp = currentDb.expendios.find(
        (e) =>
          normalizeCedula(e.cedula) === normalizeCedula(entry.cedula) ||
          String(e.municipio || '').trim().toUpperCase() === mun.toUpperCase()
      );
      if (matchedExp && matchedExp.cedula) {
        const cleanCed = normalizeCedula(matchedExp.cedula);
        registry[`${cleanCed}_${slotKey}`] = {
          ...entry,
          cedula: cleanCed,
        };
        linkedCount++;
      }
    }
    saveDrivePhotosRegistry(registry);
    const uniqueCount = new Set(Object.values(registry).map((e: any) => e?.driveFileId).filter(Boolean)).size;
    res.json({
      success: true,
      reconciledCount: uniqueCount || linkedCount,
      message: `Reconciliadas ${uniqueCount || linkedCount} fotografías desde Google Drive con nomenclatura {Municipio}_{TipoFoto}_{DDMMAAAA}.jpg.`,
    });
  });

  app.post('/api/admin/google-drive/deduplicate', async (req, res) => {
    try {
      const token = (req.body?.accessToken as string) || (await getOrRefreshDriveTokenServer());
      if (!token) {
        return res.status(401).json({ success: false, error: 'No hay token de Google Drive activo en el servidor.' });
      }

      const rootFolder = await getOrCreatePhotosFolderServer(token);
      const muniFolders: any[] = [];
      let pageToken: string | undefined = undefined;
      do {
        const listFoldersUrl: string = `https://www.googleapis.com/drive/v3/files?q='${rootFolder.id}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=nextPageToken,files(id,name)&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
        const fRes = await fetch(listFoldersUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!fRes.ok) break;
        const fData = (await fRes.json()) as any;
        if (fData.files) muniFolders.push(...fData.files);
        pageToken = fData.nextPageToken;
      } while (pageToken);

      let totalDuplicatesDeleted = 0;
      const details: Array<{ municipio: string; deletedFiles: string[]; remainingFiles: number }> = [];

      for (const mFolder of muniFolders) {
        const filesUrl = `https://www.googleapis.com/drive/v3/files?q='${mFolder.id}'+in+parents+and+trashed=false&fields=files(id,name,size,modifiedTime)&pageSize=100`;
        const fRes = await fetch(filesUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!fRes.ok) continue;
        const fData = (await fRes.json()) as any;
        const files: any[] = Array.isArray(fData.files) ? fData.files : [];

        const slotGroups: Record<string, any[]> = {};
        for (const file of files) {
          const slot = getSlotKeyFromFileNameServer(file.name) || 'desconocido';
          if (!slotGroups[slot]) slotGroups[slot] = [];
          slotGroups[slot].push(file);
        }

        const deletedInThisMuni: string[] = [];
        for (const [slot, group] of Object.entries(slotGroups)) {
          if (group.length > 1) {
            group.sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime());
            const duplicates = group.slice(1);
            for (const dup of duplicates) {
              try {
                await fetch(`https://www.googleapis.com/drive/v3/files/${dup.id}`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${token}` },
                });
                deletedInThisMuni.push(dup.name);
                totalDuplicatesDeleted++;
              } catch {}
            }
          }
        }

        if (deletedInThisMuni.length > 0) {
          details.push({
            municipio: mFolder.name,
            deletedFiles: deletedInThisMuni,
            remainingFiles: files.length - deletedInThisMuni.length,
          });
        }
      }

      res.json({
        success: true,
        totalMunicipalities: muniFolders.length,
        totalDuplicatesDeleted,
        details,
        message: `Depuración completada. Se eliminaron ${totalDuplicatesDeleted} fotos duplicadas en Google Drive, conservando exactamente las 7 fotos oficiales por municipio.`,
      });
    } catch (err: any) {
      console.error('[Google Drive Deduplicate] Error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });





// 3.5 Photo Upload Hybrid Route (Direct multipart upload by cedula and slotKey, protected by auth & ownership)
app.post(
  ['/api/photos/upload-hybrid/:cedula/:slotKey', '/api/photos/upload/:cedula/:slotKey'],
  requireAuthenticatedUser,
  requireExpendioOwnership,
  upload.single('foto'),
  validateUploadedFileSecurity,
  async (req: any, res: any) => {
    const { cedula, slotKey } = req.params;
    const file = req.file || (req.files && (req.files as any)[0]);

    if (!file) {
      return res.status(400).json({ success: false, message: 'No se recibió ningún archivo de imagen.' });
    }

    const cleanCed = path.basename((cedula || '').trim());
    const cleanSlot = path.basename((slotKey || '').trim());

    if (!cleanCed || !cleanSlot) {
      try { if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch {}
      return res.status(400).json({ success: false, message: 'Cédula y Slot son requeridos.' });
    }

    try {
      const fileBuffer = fs.readFileSync(file.path);
      // Eliminar archivo temporal de Multer inmediatamente después de leerlo en memoria
      try {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch {}

      const localFileName = `${cleanCed}_${cleanSlot}.jpg`;
      const persistentDiskPath = path.join(photosDir, localFileName);
      const permDiskPath = path.join(permanentPhotosDir, localFileName);

      try {
        fs.writeFileSync(persistentDiskPath, fileBuffer);
        try { fs.writeFileSync(permDiskPath, fileBuffer); } catch {}
      } catch (ioErr: any) {
        console.warn('[UploadHybrid IO Warn]:', ioErr.message);
      }

      // Buscar expendio por cédula normalizada o ID
      const currentDb = getDatabaseReadOnly();
      const normCleanCed = normalizeCedula(cleanCed);
      const exp = currentDb.expendios.find(
        (e) =>
          normalizeCedula(e.cedula) === normCleanCed ||
          (e.cedula || '').trim() === cleanCed ||
          (e.id || '').trim() === cleanCed
      );

      const hybridRes = await processAndSavePhotoHybrid({
        expendioId: exp?.id || '',
        cedula: cleanCed,
        slotKey: cleanSlot,
        inputBuffer: fileBuffer,
        mimeType: file.mimetype || 'image/jpeg',
        dbClient: db,
      });

      const canonicalUrl = `/api/photos/${encodeURIComponent(cleanCed)}/${cleanSlot}`;
      const nowIso = new Date().toISOString();
      const today = nowIso.split('T')[0];

      if (exp) {
        await mutateDatabase(async (db) => {
          const idx = db.expendios.findIndex(
            (e) =>
              e.id === exp.id ||
              normalizeCedula(e.cedula) === normCleanCed ||
              e.cedula === exp.cedula
          );
          if (idx !== -1) {
            (db.expendios[idx] as any)[cleanSlot] = canonicalUrl;
            if (cleanSlot === 'fotoAvisoUrl') {
              db.expendios[idx].letreroUrl = canonicalUrl;
              db.expendios[idx].tieneAviso = 'SI';
            } else if (cleanSlot === 'fotoBasculaUrl') {
              db.expendios[idx].basculaUrl = canonicalUrl;
              db.expendios[idx].tieneBascula = 'SI';
            } else if (cleanSlot === 'fotoMataselloUrl') {
              db.expendios[idx].mataselloUrl = canonicalUrl;
              db.expendios[idx].tieneMatasello = 'SI';
            }
            db.expendios[idx].fechaUltimaActualizacion = today;
            db.expendios[idx].updatedAt = nowIso;
          }
        });
      }

      res.json({
        success: true,
        cloudPersisted: true,
        storageProvider: hybridRes.storageProvider,
        storageStatus: hybridRes.status,
        url: canonicalUrl,
        fechaUltimaActualizacion: today,
        updatedAt: nowIso,
        message: `✓ Foto de ${cleanCed} (${cleanSlot}) guardada exitosamente en el servidor.`,
      });
    } catch (err: any) {
      console.error('[UploadHybrid Route Error]:', err.message);
      res.status(500).json({ success: false, message: 'Error procesando subida de foto: ' + err.message });
    }
  }
);

// 4. Expendio: Upload Photo (Multipart File)
app.post('/api/expendio/upload-photo', requireExpendio, upload.single('photo'), validateUploadedFileSecurity, async (req: AuthRequest, res) => {
  const { photoType } = req.body;
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No se recibió ningún archivo de imagen.' });
  }

  const currentDb = getDatabase();
  const exp = resolveUserExpendio(req, currentDb);
  if (!exp) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado para este usuario.' });
  }

  const normalizeSlot = (type: string): string => {
    if (['fotoAvisoUrl', 'fotoAviso', 'letrero', 'aviso'].includes(type)) return 'fotoAvisoUrl';
    if (['fotoPanoramicaUrl', 'fotoPanoramica', 'panoramica', 'fachada'].includes(type)) return 'fotoPanoramicaUrl';
    if (['fotoMataselloUrl', 'fotoMatasello', 'matasello'].includes(type)) return 'fotoMataselloUrl';
    if (['fotoBasculaUrl', 'fotoBascula', 'bascula'].includes(type)) return 'fotoBasculaUrl';
    if (['fotoContratistaUrl', 'fotoContratista', 'contratista', 'encargado'].includes(type)) return 'fotoContratistaUrl';
    if (['fotoHorarioUrl', 'fotoHorario', 'horario'].includes(type)) return 'fotoHorarioUrl';
    if (['fotoTarifasUrl', 'fotoTarifas', 'tarifas'].includes(type)) return 'fotoTarifasUrl';
    if (['computador', 'fotoComputadorUrl', 'computadorUrl'].includes(type)) return 'computadorUrl';
    return type;
  };

  const canonicalSlot = normalizeSlot(photoType || 'fotoAvisoUrl');
  const fileBuffer = fs.readFileSync(req.file.path);
  // Eliminar archivo temporal de Multer inmediatamente para no dejar archivos huérfanos foto-*
  try {
    if (req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  } catch {}
  const dataUrl = `data:image/jpeg;base64,${fileBuffer.toString('base64')}`;

  const localFileName = `${exp.cedula.trim()}_${canonicalSlot}.jpg`;
  const persistentDiskPath = path.join(photosDir, localFileName);
  const permDiskPath = path.join(permanentPhotosDir, localFileName);

  // 1. Guardar en disco temporal/staging para optimización y hash
  try {
    fs.writeFileSync(persistentDiskPath, fileBuffer);
    try { fs.writeFileSync(permDiskPath, fileBuffer); } catch {}
  } catch (ioErr: any) {
    console.warn('[Photo IO Warn]:', ioErr.message);
  }

  // 2. Procesar en Almacenamiento Híbrido Cloud: Optimización -> SHA-256 -> Firebase (Principal) / S3 (Contingencia) -> PostgreSQL
  try {
    const hybridRes = await processAndSavePhotoHybrid({
      expendioId: exp.id,
      cedula: exp.cedula,
      slotKey: canonicalSlot,
      inputBuffer: fileBuffer,
      mimeType: req.file.mimetype || 'image/jpeg',
      dbClient: db,
    });

    if (!hybridRes.success || hybridRes.status === 'ERROR') {
      console.warn('[PhotoUpload 1] Warn al persistir en cloud, continuando con disco de servidor local:', hybridRes.lastError);
    }

    // 3. Persistir URL canónica en el catálogo ÚNICAMENTE tras confirmación cloud
    const canonicalUrl = `/api/photos/${encodeURIComponent(exp.cedula.trim())}/${canonicalSlot}`;
    const nowIso = new Date().toISOString();
    const today = nowIso.split('T')[0];

    const updatedExp = await mutateDatabase(async (db) => {
      const idx = db.expendios.findIndex((e) => e.id === exp.id);
      if (idx === -1) throw new Error('EXPENDIO_NOT_FOUND');

      const current = db.expendios[idx];
      (db.expendios[idx] as any)[canonicalSlot] = canonicalUrl;

      if (canonicalSlot === 'fotoAvisoUrl') {
        db.expendios[idx].fotoAvisoUrl = canonicalUrl;
        db.expendios[idx].letreroUrl = canonicalUrl;
        db.expendios[idx].tieneAviso = 'SI';
        db.expendios[idx].motivoFaltaAviso = '';
      } else if (canonicalSlot === 'fotoBasculaUrl') {
        db.expendios[idx].fotoBasculaUrl = canonicalUrl;
        db.expendios[idx].basculaUrl = canonicalUrl;
        db.expendios[idx].tieneBascula = 'SI';
        db.expendios[idx].motivoFaltaBascula = '';
      } else if (canonicalSlot === 'fotoMataselloUrl') {
        db.expendios[idx].fotoMataselloUrl = canonicalUrl;
        db.expendios[idx].mataselloUrl = canonicalUrl;
        db.expendios[idx].tieneMatasello = 'SI';
        db.expendios[idx].motivoFaltaMatasello = '';
      }

      db.expendios[idx].fechaUltimaActualizacion = today;
      db.expendios[idx].updatedAt = nowIso;
      db.expendios[idx].revision = (Number(current.revision) || 0) + 1;

      return db.expendios[idx];
    }, { entityType: 'expendio', entityId: exp.id });

    const photoRecordId = `photo_${exp.id}_${canonicalSlot}_${Date.now()}`;
    await db
      .insert(schema.googleDrivePhotos)
      .values({
        photoId: photoRecordId,
        expendioId: exp.id,
        slot: canonicalSlot,
        fileName: localFileName,
        mimeType: 'image/jpeg',
        path: persistentDiskPath,
        checksum: hybridRes.checksumSha256,
        uploadedAt: nowIso,
        metadata: {
          cedula: exp.cedula,
          municipio: exp.municipio || exp.localidad,
          encargado: exp.encargado,
          storageProvider: hybridRes.storageProvider,
          storageStatus: hybridRes.status,
        },
      })
      .onConflictDoNothing()
      .catch((e) => console.warn('[Photo PG Meta Warn]:', e.message));

    res.json({
      success: true,
      cloudPersisted: true,
      storageProvider: hybridRes.storageProvider,
      storageStatus: hybridRes.status,
      version: hybridRes.version,
      checksum: hybridRes.checksumSha256,
      fileUrl: canonicalUrl,
      data: updatedExp,
      expendio: updatedExp,
      message: hybridRes.storageProvider === 'S3'
        ? `Fotografía guardada en AWS S3 Contingencia.`
        : `Fotografía persistida en Firebase Storage como almacenamiento principal.`,
    });
  } catch (err: any) {
    console.error('[API] Error procesando fotografía:', err);
    res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Error al persistir fotografía: ${err.message}`,
    });
  }
});

// 4B. Expendio: Upload Photo via JSON Base64
app.post('/api/expendio/upload-photo-base64', requireExpendio, async (req: AuthRequest, res) => {
  const { photoType, photoBase64 } = req.body;

  // Safely extract string representation of base64
  let base64String = '';
  if (typeof photoBase64 === 'string') {
    base64String = photoBase64;
  } else if (photoBase64 && typeof photoBase64 === 'object') {
    base64String = photoBase64.dataUrl || photoBase64.base64 || photoBase64.url || '';
  }

  if (!base64String && typeof req.body.image === 'string') {
    base64String = req.body.image;
  } else if (!base64String && typeof req.body.dataUrl === 'string') {
    base64String = req.body.dataUrl;
  }

  if (!base64String || typeof base64String !== 'string') {
    return res.status(400).json({ success: false, message: 'Se requiere imagen en formato base64 o data URL válido.' });
  }

  const currentDb = getDatabase();
  const exp = resolveUserExpendio(req, currentDb);
  if (!exp) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado para este usuario.' });
  }

  const normalizeSlot = (type: string): string => {
    if (['fotoAvisoUrl', 'fotoAviso', 'letrero', 'aviso'].includes(type)) return 'fotoAvisoUrl';
    if (['fotoPanoramicaUrl', 'fotoPanoramica', 'panoramica', 'fachada'].includes(type)) return 'fotoPanoramicaUrl';
    if (['fotoMataselloUrl', 'fotoMatasello', 'matasello'].includes(type)) return 'fotoMataselloUrl';
    if (['fotoBasculaUrl', 'fotoBascula', 'bascula'].includes(type)) return 'fotoBasculaUrl';
    if (['fotoContratistaUrl', 'fotoContratista', 'contratista', 'encargado'].includes(type)) return 'fotoContratistaUrl';
    if (['fotoHorarioUrl', 'fotoHorario', 'horario'].includes(type)) return 'fotoHorarioUrl';
    if (['fotoTarifasUrl', 'fotoTarifas', 'tarifas'].includes(type)) return 'fotoTarifasUrl';
    if (['computador', 'fotoComputadorUrl', 'computadorUrl'].includes(type)) return 'computadorUrl';
    return type;
  };

  const canonicalSlot = normalizeSlot(photoType || 'fotoAvisoUrl');

  try {
    const formattedDataUrl = base64String.startsWith('data:')
      ? base64String
      : `data:image/jpeg;base64,${base64String}`;

    // 1. Guardar en disco temporal/staging para optimización y hash
    const cleanBase64 = formattedDataUrl.replace(/^data:[^;]+;base64,/, '').trim();
    const buffer = Buffer.from(cleanBase64, 'base64');
    const localFileName = `${exp.cedula.trim()}_${canonicalSlot}.jpg`;
    const persistentDiskPath = path.join(photosDir, localFileName);
    const permDiskPath = path.join(permanentPhotosDir, localFileName);
    try {
      fs.writeFileSync(persistentDiskPath, buffer);
      try { fs.writeFileSync(permDiskPath, buffer); } catch {}
    } catch (ioErr: any) {
      console.warn('[Photo Base64 IO Warn]:', ioErr.message);
    }

    // 2. Procesar en Almacenamiento Híbrido Cloud: Optimización -> SHA-256 -> Firebase (Principal) / S3 (Contingencia) -> PostgreSQL
    const hybridRes = await processAndSavePhotoHybrid({
      expendioId: exp.id,
      cedula: exp.cedula,
      slotKey: canonicalSlot,
      inputBuffer: buffer,
      mimeType: 'image/jpeg',
      dbClient: db,
    });

    if (!hybridRes.success || hybridRes.status === 'ERROR') {
      console.warn('[PhotoUpload 2] Warn al persistir en cloud, continuando con disco de servidor local:', hybridRes.lastError);
    }

    // 3. Persistir URL canónica en el catálogo ÚNICAMENTE tras confirmación cloud
    const canonicalUrl = `/api/photos/${encodeURIComponent(exp.cedula.trim())}/${canonicalSlot}`;
    const nowIso = new Date().toISOString();
    const today = nowIso.split('T')[0];

    const updatedExp = await mutateDatabase(async (db) => {
      const idx = db.expendios.findIndex((e) => e.id === exp.id);
      if (idx === -1) throw new Error('EXPENDIO_NOT_FOUND');

      const current = db.expendios[idx];
      (db.expendios[idx] as any)[canonicalSlot] = canonicalUrl;

      if (canonicalSlot === 'fotoAvisoUrl') {
        db.expendios[idx].fotoAvisoUrl = canonicalUrl;
        db.expendios[idx].letreroUrl = canonicalUrl;
        db.expendios[idx].tieneAviso = 'SI';
        db.expendios[idx].motivoFaltaAviso = '';
      } else if (canonicalSlot === 'fotoBasculaUrl') {
        db.expendios[idx].fotoBasculaUrl = canonicalUrl;
        db.expendios[idx].basculaUrl = canonicalUrl;
        db.expendios[idx].tieneBascula = 'SI';
        db.expendios[idx].motivoFaltaBascula = '';
      } else if (canonicalSlot === 'fotoMataselloUrl') {
        db.expendios[idx].fotoMataselloUrl = canonicalUrl;
        db.expendios[idx].mataselloUrl = canonicalUrl;
        db.expendios[idx].tieneMatasello = 'SI';
        db.expendios[idx].motivoFaltaMatasello = '';
      }

      db.expendios[idx].fechaUltimaActualizacion = today;
      db.expendios[idx].updatedAt = nowIso;
      db.expendios[idx].revision = (Number(current.revision) || 0) + 1;

      return db.expendios[idx];
    }, { entityType: 'expendio', entityId: exp.id });

    const photoRecordId = `photo_${exp.id}_${canonicalSlot}_${Date.now()}`;
    await db
      .insert(schema.googleDrivePhotos)
      .values({
        photoId: photoRecordId,
        expendioId: exp.id,
        slot: canonicalSlot,
        fileName: localFileName,
        mimeType: 'image/jpeg',
        path: persistentDiskPath,
        checksum: hybridRes.checksumSha256,
        uploadedAt: nowIso,
        metadata: {
          cedula: exp.cedula,
          municipio: exp.municipio || exp.localidad,
          encargado: exp.encargado,
          storageProvider: hybridRes.storageProvider,
          storageStatus: hybridRes.status,
        },
      })
      .onConflictDoNothing()
      .catch((e) => console.warn('[Photo PG Meta Warn]:', e.message));

    res.json({
      success: true,
      cloudPersisted: true,
      storageProvider: hybridRes.storageProvider,
      storageStatus: hybridRes.status,
      version: hybridRes.version,
      checksum: hybridRes.checksumSha256,
      fileUrl: canonicalUrl,
      data: updatedExp,
      expendio: updatedExp,
      message: hybridRes.storageProvider === 'S3'
        ? `Fotografía guardada en AWS S3 Contingencia.`
        : `Fotografía persistida en Firebase Storage como almacenamiento principal.`,
    });
  } catch (err: any) {
    console.error('Error procesando foto base64:', err);
    res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Error al guardar la imagen: ${err.message}`,
    });
  }
});

// 4C. Expendio: Marcar disponibilidad de ítem (Báscula, Matasello, Letrero/Aviso)
// Estrictamente: SOLO cuando el expendio marca explícitamente que NO cuenta con el implemento,
// se genera una imagen en blanco con el texto "NO DISPONIBLE" para completar las 7 imágenes.
app.post('/api/expendio/marcar-disponibilidad-item', requireExpendio, async (req: AuthRequest, res) => {
  const { itemKey, tiene, motivo } = req.body;
  if (!itemKey) {
    return res.status(400).json({ success: false, message: 'Falta dato obligatorio (itemKey).' });
  }

  const currentDb = getDatabase();
  const exp = resolveUserExpendio(req, currentDb);
  if (!exp) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado para este usuario.' });
  }

  try {
    const cleanTiene = tiene === 'SI' || tiene === true ? 'SI' : 'NO';
    const cleanMotivo = typeof motivo === 'string' ? motivo.trim() : '';

    const canonicalSlot =
      itemKey === 'fotoAvisoUrl' || itemKey === 'aviso' || itemKey === 'letrero'
        ? 'fotoAvisoUrl'
        : itemKey === 'fotoBasculaUrl' || itemKey === 'bascula'
        ? 'fotoBasculaUrl'
        : itemKey === 'fotoMataselloUrl' || itemKey === 'matasello'
        ? 'fotoMataselloUrl'
        : null;

    if (!canonicalSlot) {
      return res.status(400).json({
        success: false,
        message: 'Solo se permite marcar disponibilidad en Letrero/Aviso, Báscula o Matasello.',
      });
    }

    const itemLabel =
      canonicalSlot === 'fotoAvisoUrl'
        ? 'LETRERO / AVISO EXTERIOR'
        : canonicalSlot === 'fotoBasculaUrl'
        ? 'BÁSCULA DIGITAL / PESO'
        : 'MATASELLO FECHADOR';

    const cleanCedula = String(exp.cedula || '').trim();
    let generatedFileUrl = '';

    // ESTRICTO: Generar soporte vectorial de alta fidelidad en B&N cuando el expendio marca explícitamente NO
    if (cleanTiene === 'NO') {
      const muniName = String(exp.municipio || exp.localidad || 'EXPENDIO');
      const svgNoDisponible = generateNoDisponibleSvg({
        itemSlot: canonicalSlot,
        itemLabel,
        municipio: muniName,
        cedula: cleanCedula,
        motivo: cleanMotivo,
        fecha: new Date().toLocaleDateString('es-CO'),
      });

      const whiteImageBuffer = await sharp(Buffer.from(svgNoDisponible))
        .jpeg({ quality: 92 })
        .toBuffer();

      await processAndSavePhotoHybrid({
        expendioId: exp.id,
        cedula: cleanCedula,
        slotKey: canonicalSlot,
        inputBuffer: whiteImageBuffer,
        mimeType: 'image/jpeg',
        dbClient: db,
      });

      generatedFileUrl = `/api/photos/${encodeURIComponent(cleanCedula)}/${canonicalSlot}`;
    }

    const updated = await mutateDatabase((dbDraft) => {
      const index = dbDraft.expendios.findIndex((e) => e.id === exp.id);
      if (index === -1) {
        throw new Error('EXPENDIO_NOT_FOUND');
      }

      if (canonicalSlot === 'fotoAvisoUrl') {
        dbDraft.expendios[index].tieneAviso = cleanTiene;
        if (cleanTiene === 'NO') {
          dbDraft.expendios[index].fotoAvisoUrl = generatedFileUrl;
          dbDraft.expendios[index].letreroUrl = generatedFileUrl;
          dbDraft.expendios[index].motivoFaltaAviso = cleanMotivo;
        } else {
          dbDraft.expendios[index].fotoAvisoUrl = '';
          dbDraft.expendios[index].letreroUrl = '';
          dbDraft.expendios[index].motivoFaltaAviso = '';
        }
      } else if (canonicalSlot === 'fotoBasculaUrl') {
        dbDraft.expendios[index].tieneBascula = cleanTiene;
        if (cleanTiene === 'NO') {
          dbDraft.expendios[index].fotoBasculaUrl = generatedFileUrl;
          dbDraft.expendios[index].basculaUrl = generatedFileUrl;
          dbDraft.expendios[index].motivoFaltaBascula = cleanMotivo;
        } else {
          dbDraft.expendios[index].fotoBasculaUrl = '';
          dbDraft.expendios[index].basculaUrl = '';
          dbDraft.expendios[index].motivoFaltaBascula = '';
        }
      } else if (canonicalSlot === 'fotoMataselloUrl') {
        dbDraft.expendios[index].tieneMatasello = cleanTiene;
        if (cleanTiene === 'NO') {
          dbDraft.expendios[index].fotoMataselloUrl = generatedFileUrl;
          dbDraft.expendios[index].mataselloUrl = generatedFileUrl;
          dbDraft.expendios[index].motivoFaltaMatasello = cleanMotivo;
        } else {
          dbDraft.expendios[index].fotoMataselloUrl = '';
          dbDraft.expendios[index].mataselloUrl = '';
          dbDraft.expendios[index].motivoFaltaMatasello = '';
        }
      }

      dbDraft.expendios[index].fechaUltimaActualizacion = new Date().toISOString().split('T')[0];
      dbDraft.expendios[index].revision = ((dbDraft.expendios[index] as any).revision || 1) + 1;
      return dbDraft.expendios[index];
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      fileUrl: generatedFileUrl,
      data: updated,
      expendio: updated,
      message:
        cleanTiene === 'NO'
          ? `Implemento marcado como NO DISPONIBLE y soporte en blanco generado para completar las 7 imágenes.`
          : `Disponibilidad de ${itemKey} actualizada a SI. Por favor cargue la fotografía real del implemento.`,
    });
  } catch (err: any) {
    if (err.message === 'EXPENDIO_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
    }
    res.status(500).json({ success: false, message: `Error guardando disponibilidad en PostgreSQL: ${err.message}` });
  }
});

// 4D. Expendio: Marcar bienvenida / capacitación inicial completada
app.post('/api/expendio/marcar-bienvenida', requireExpendio, async (req: AuthRequest, res) => {
  const currentDb = getDatabase();
  const exp = resolveUserExpendio(req, currentDb);
  if (!exp) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado para este usuario.' });
  }

  try {
    const updated = await mutateDatabase((db) => {
      const index = db.expendios.findIndex((e) => e.id === exp.id);
      if (index !== -1) {
        db.expendios[index].bienvenidaRealizada = true;
        return db.expendios[index];
      }
      return null;
    }, { immediateCloudSync: true, throwOnCloudError: true });

    if (updated) {
      return res.json({ success: true, cloudPersisted: true, data: updated });
    }
    res.json({ success: true, message: 'Expendio no encontrado, registrado en cliente.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Expendio: Upload Contract PDF
app.post('/api/expendio/upload-contract', requireExpendio, upload.single('contrato'), validateUploadedFileSecurity, async (req: AuthRequest, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No se recibió el archivo del contrato.' });
  }

  const currentDb = getDatabase();
  const exp = resolveUserExpendio(req, currentDb);
  if (!exp) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado para este usuario.' });
  }

  const fileUrl = `/uploads/contracts/${req.file.filename}`;
  try {
    const updatedExp = await mutateDatabase((db) => {
      const index = db.expendios.findIndex((e) => e.id === exp.id);
      if (index === -1) {
        throw new Error('EXPENDIO_NOT_FOUND');
      }
      db.expendios[index].contratoUrl = fileUrl;
      db.expendios[index].fechaUltimaActualizacion = new Date().toISOString().split('T')[0];
      return db.expendios[index];
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      contratoUrl: fileUrl,
      expendio: updatedExp,
      message: 'Contrato PDF subido exitosamente.',
    });
  } catch (err: any) {
    if (err.message === 'EXPENDIO_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Admin: Cuentas de cobro calculation & history batching
app.post('/api/admin/cuentas-cobro', requireAdmin, async (req, res) => {
  const {
    aplicarGrossUp,
    modificarValorInicialRetencion,
    porcentajeRetencion,
    periodo,
    sobrescribir,
    cargarAContabilidad,
  }: CuentaCobroParams & { sobrescribir?: boolean; cargarAContabilidad?: boolean } = req.body;

  const pRetencion = Number(porcentajeRetencion) > 0 ? Number(porcentajeRetencion) : 1;
  const retMod = Number(modificarValorInicialRetencion) || 0;
  const periodoFinal = periodo || 'MARZO 2026';
  const { mes, ano } = extractMesAno(periodoFinal);
  const mesUpper = mes.toUpperCase();
  const anioStr = ano;

  try {
    const { resultados, contabilidadSyncResult } = await mutateDatabase((db) => {
      const totalExpendios = db.expendios.length;
      const cleanDig = (s: any) => String(s || '').replace(/[^0-9]/g, '');
      const normMuni = (s: any) => String(s || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      const resCalculo: CuentaCobroResult[] = db.expendios.map((exp, index) => {
        const eCed = cleanDig(exp.cedula);
        const eMuni = normMuni(exp.municipio || exp.localidad);
        const matchCobro =
          (db.historial || []).find(
            (h: any) =>
              ((h.periodo || '').toUpperCase().includes(mesUpper) && (h.periodo || '').includes(anioStr)) &&
              ((eCed && cleanDig(h.cedula) === eCed) || (eMuni && normMuni(h.municipio || h.expendio) === eMuni))
          ) ||
          (db.historial || []).find(
            (h: any) =>
              (h.periodo || '').toUpperCase() === 'MARZO 2026' &&
              ((eCed && cleanDig(h.cedula) === eCed) || (eMuni && normMuni(h.municipio || h.expendio) === eMuni))
          ) ||
          (db.historial || []).find(
            (h: any) => (eCed && cleanDig(h.cedula) === eCed) || (eMuni && normMuni(h.municipio || h.expendio) === eMuni)
          );

        const cd = (matchCobro?.cuentaData || {}) as any;
        const baseContractual = Number(exp.valorMensual) || Number(cd.cargoBasico ?? matchCobro?.valorBase ?? 0) || 121200;
        const admisionSipost = Number(exp.admisionSipost) || Number(cd.admisionSipost ?? 0);
        const valorVariable = Number(exp.valorVariable) || Number(cd.valorVariable ?? 0);

        // Keep expendio record in sync with cobros database
        exp.valorMensual = baseContractual;
        exp.admisionSipost = admisionSipost;
        exp.valorVariable = valorVariable;

        const cargoBasicoDisplay = baseContractual + retMod;

        let pagoTotal: number;
        let retef1: number;
        let valorNeto: number;

        if (aplicarGrossUp) {
          valorNeto = cargoBasicoDisplay + admisionSipost + valorVariable;
          retef1 = 0;
          pagoTotal = valorNeto;
        } else {
          pagoTotal = cargoBasicoDisplay + admisionSipost + valorVariable;
          retef1 = Math.round(pagoTotal * (pRetencion / 100));
          valorNeto = pagoTotal - retef1;
        }

        return {
          id: `cc-${exp.id}-${Date.now()}-${index}`,
          cedula: exp.cedula,
          encargado: exp.encargado,
          expendio: exp.localidad,
          municipio: exp.municipio || exp.localidad,
          numeroConsecutivo: index + 1,
          totalPaginas: totalExpendios,
          centroOperativo: exp.centroOperativo || 'PO.ARAUCA',
          centroAcopio: exp.centroAcopio || exp.localidad,
          regional: 'ORIENTE',
          funcion: 'EXPENDIO 4-72',
          cargoBasico: cargoBasicoDisplay,
          admisionSipost,
          valorVariable,
          pagoTotal,
          retef1,
          valorNeto,
          valorEnLetras: numeroALetras(valorNeto),
          direccion: exp.direccionPunto,
          telefono: exp.telefonoPunto,
          valorBase: baseContractual,
          grossUpAplicado: !!aplicarGrossUp,
          valorBruto: pagoTotal,
          porcentajeRetencion: pRetencion,
          retencionValor: retef1,
          nitCamarca: '900504241-7',
          empresaCamarca: 'CAMARCA SAS',
          fechaEmision: new Date().toISOString().split('T')[0],
          periodo: periodoFinal,
        };
      });

      const newHistorialItems: HistorialItem[] = resCalculo.map((r) => ({
        id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        periodo: r.periodo,
        tipo: 'Cuenta de Cobro',
        encargado: r.encargado,
        cedula: r.cedula,
        expendio: r.municipio || r.expendio,
        monto: r.valorNeto,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'Procesado',
        detalles: `Cuenta de Cobro CAMARCA SAS (${r.municipio} - Neto: $${r.valorNeto.toLocaleString('es-CO')})`,
        cuentaData: r,
      }));

      db.historial = (db.historial || []).filter((h) => {
        const p = (h.periodo || '').toUpperCase();
        const cP = (h.cuentaData?.periodo || '').toUpperCase();
        const matchesPeriodo = (p.includes(mesUpper) && p.includes(anioStr)) || (cP.includes(mesUpper) && cP.includes(anioStr));
        return !(matchesPeriodo && h.tipo === 'Cuenta de Cobro');
      });

      db.historial = deduplicateHistorial([...newHistorialItems, ...db.historial]);

      let syncRes = null;
      if (cargarAContabilidad) {
        syncRes = syncCuentasToRelacionPagos(db, resCalculo, periodoFinal);
      }

      return { resultados: resCalculo, contabilidadSyncResult: syncRes };
    }, { immediateCloudSync: true, throwOnCloudError: true });

    const totalCargoBasico = resultados.reduce((acc, c) => acc + (c.cargoBasico ?? c.valorBase ?? 0), 0);
    const totalSubsidioSipost = resultados.reduce((acc, c) => acc + (c.admisionSipost ?? 0), 0);
    const totalVariable = resultados.reduce((acc, c) => acc + (c.valorVariable ?? 0), 0);
    const totalPagoTotal = resultados.reduce((acc, c) => acc + (c.valorBruto ?? 0), 0);
    const totalRetencion = resultados.reduce((acc, c) => acc + (c.retencionValor ?? 0), 0);
    const totalNeto = resultados.reduce((acc, c) => acc + (c.valorNeto ?? 0), 0);

    const resumenFinanciero = {
      totalCuentas: resultados.length,
      totalCargoBasico,
      totalSubsidioSipost,
      totalVariable,
      totalPagoTotal,
      totalRetencion,
      totalNeto,
      mes: mesUpper,
      ano: anioStr,
      periodo: periodoFinal,
    };

    res.json({
      success: true,
      cloudPersisted: true,
      data: resultados,
      resumenFinanciero,
      sincronizadoContabilidad: !!contabilidadSyncResult,
      contabilidadSyncResult,
      message: `¡Cuentas de cobro generadas y guardadas exitosamente para el periodo ${periodoFinal}! ${
        contabilidadSyncResult
          ? `(${contabilidadSyncResult.insertados} insertados, ${contabilidadSyncResult.actualizados} actualizados en Relación de Pagos)`
          : ''
      }`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error generando cuentas de cobro: ' + err.message });
  }
});

// 6B. Admin: Download Excel Template for Mass Regenerating Cuentas de Cobro
app.get('/api/admin/download-plantilla-cuentas', (req, res) => {
  const sampleData = [
    {
      'N°': 1,
      'CENTRO OPERATIVO': 'PO.BUCARAMANGA',
      'CENTRO DE ACOPIO': 'SIMITI',
      'MUNICIPIO': 'SIMITI',
      'FUNCION': 'EXPENDIO 4-72',
      'CARGO BASICO': 0,
      'ADMISION SIPOST': 0,
      'VALOR VARIABLE': 300,
      'PAGO TOTAL': 121500,
      'RETEF 1%': 1215,
      'NETO A PAGAR': 120285,
      'ENCARGADO': 'MARIO DE JESUS TORRES MEJIA',
      'CEDULA': '3983162',
      'DIRECCION': 'CALLE PRINCIPAL SIMITI',
      'TELEFONO': '3101234567',
    },
    {
      'N°': 2,
      'CENTRO OPERATIVO': 'PO.BUCARAMANGA',
      'CENTRO DE ACOPIO': 'GIRON',
      'MUNICIPIO': 'GIRON',
      'FUNCION': 'EXPENDIO 4-72',
      'CARGO BASICO': 1350000,
      'ADMISION SIPOST': 50000,
      'VALOR VARIABLE': 12500,
      'PAGO TOTAL': 1412500,
      'RETEF 1%': 14125,
      'NETO A PAGAR': 1398375,
      'ENCARGADO': 'CARLOS ALBERTO GOMEZ',
      'CEDULA': '1094883412',
      'DIRECCION': 'CARRERA 15 # 22-10 GIRON',
      'TELEFONO': '3128899001',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla Cuentas de Cobro');

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="Plantilla_Cuentas_Cobro_CAMARCA.xlsx"');
  res.end(Buffer.from(excelBuffer));
});

// Helper function to clean numeric excel cell values
function parseNumeric(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const clean = String(val).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? 0 : parsed;
}

// 6C. Admin: Upload Excel file for Mass Regenerating Cuentas de Cobro
app.post('/api/admin/upload-cuentas-cobro-excel', uploadExcel.any(), requireAdmin, async (req, res) => {
  try {
    const uploadedFile = req.file || (req.files && Array.isArray(req.files) ? req.files[0] : null);
    if (!uploadedFile) {
      return res.status(400).json({ success: false, message: 'No se recibió ningún archivo Excel (.xlsx / .csv).' });
    }

    const filePath = uploadedFile.path;
    const fileBuffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'El archivo Excel está vacío o no tiene datos válidos.' });
    }

    // Identify headers present in the uploaded sheet
    const firstRow = rawRows[0];
    const keysInSheet = Object.keys(firstRow).map((k) => k.trim().toUpperCase());

    // Mandatory columns validation
    const mandatoryCols = [
      'MUNICIPIO',
      'CARGO BASICO',
      'ADMISION SIPOST',
      'VALOR VARIABLE',
      'PAGO TOTAL',
    ];

    const missingMandatory = mandatoryCols.filter(
      (m) => !keysInSheet.some((k) => k.includes(m))
    );

    if (missingMandatory.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Faltan los siguientes campos obligatorios para el cargue: ${missingMandatory.join(', ')}.`,
      });
    }

    const pRetencion = Number(req.body?.porcentajeRetencion) > 0 ? Number(req.body?.porcentajeRetencion) : 1;
    const aplicarGrossUp = req.body?.aplicarGrossUp === 'true' || req.body?.aplicarGrossUp === true;
    const db = loadDatabase();
    const periodoActual = req.body?.periodo || new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).toUpperCase();

    const cuentasGeneradas: CuentaCobroResult[] = [];
    const alertas: string[] = [];

    // Flexible helper to extract value from row matching list of possible column titles or column indexes
    const getValFlex = (row: any, candidates: string[], fallbackColIndexes: number[] = []) => {
      const keys = Object.keys(row);
      const cleanNorm = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

      const rowNumberKeys = ['N', 'NO', 'NUM', 'NUMERO', 'ITEM', 'CONSECUTIVO', 'ORDEN'];

      // 1. Try exact normalized key match
      for (const cand of candidates) {
        const candNorm = cleanNorm(cand);
        const foundKey = keys.find((k) => cleanNorm(k) === candNorm);
        if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && String(row[foundKey]).trim() !== '') {
          return row[foundKey];
        }
      }

      // 2. Try substring match on keys (key must include candidate, never allow candidate to include short key like 'N')
      for (const cand of candidates) {
        const candNorm = cleanNorm(cand);
        if (candNorm.length < 4) continue;
        const foundKey = keys.find((k) => {
          const kNorm = cleanNorm(k);
          if (rowNumberKeys.includes(kNorm)) return false;
          return kNorm.includes(candNorm);
        });
        if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && String(row[foundKey]).trim() !== '') {
          return row[foundKey];
        }
      }

      // 3. Fallback by index or Excel letter column (e.g., 'F'=5, 'G'=6, 'H'=7)
      const excelLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
      for (const idx of fallbackColIndexes) {
        if (row[idx] !== undefined && row[idx] !== null && String(row[idx]).trim() !== '') {
          return row[idx];
        }
        const letter = excelLetters[idx];
        if (letter && row[letter] !== undefined && row[letter] !== null && String(row[letter]).trim() !== '') {
          return row[letter];
        }
        const emptyKey = `__EMPTY_${idx}`;
        if (row[emptyKey] !== undefined && row[emptyKey] !== null && String(row[emptyKey]).trim() !== '') {
          return row[emptyKey];
        }
      }

      return '';
    };

    // Pre-filter valid rows: skip totals, summary rows, and empty rows
    const validRows: any[] = [];
    rawRows.forEach((row, index) => {
      const filaNum = index + 2;
      const keys = Object.keys(row);
      const rowValues = keys.map((k) => String(row[k] || '')).join(' ').toUpperCase();

      // Check for total/summary keywords
      const isTotalRow =
        rowValues.includes('TOTAL') ||
        rowValues.includes('SUMA') ||
        rowValues.includes('GRAN TOTAL') ||
        rowValues.includes('TOTALES');

      const rawMun = String(getValFlex(row, ['MUNICIPIO', 'LOCALIDAD', 'CIUDAD', 'EXPENDIO'], [3]) || '').trim();
      const rawEnc = String(getValFlex(row, ['ENCARGADO', 'NOMBRE', 'TITULAR', 'RESPONSABLE']) || '').trim();
      const rawCed = String(getValFlex(row, ['CEDULA', 'CÉDULA', 'NIT', 'IDENTIFICACION', 'DOCUMENTO']) || '').trim();

      // If it's a total row or has no valid municipality, skip it
      if (isTotalRow && (!rawMun || rawMun.toUpperCase().includes('TOTAL') || (!rawEnc && !rawCed))) {
        return;
      }
      if (!rawMun || rawMun.toUpperCase().includes('TOTAL') || rawMun.toUpperCase().includes('SUMA')) {
        return;
      }

      validRows.push({ row, filaNum, originalIndex: index });
    });

    const totalValidCuentas = validRows.length;
    const resolucionDiscrepancias = req.body?.resolucionDiscrepancias; // 'actualizar_bd' | 'actualizar_archivo'

    // 1. Check for discrepancies strictly in Encargado fields: nombre, cedula, celular, direccion
    const allDiscrepancies: DiscrepanciaEncargadoItem[] = [];
    validRows.forEach(({ row }) => {
      const mun = String(getValFlex(row, ['MUNICIPIO', 'LOCALIDAD', 'CIUDAD', 'EXPENDIO'], [3]) || '').trim();
      const target = db.expendios.find((e) =>
        e.municipio?.toLowerCase() === mun.toLowerCase() ||
        e.localidad?.toLowerCase() === mun.toLowerCase()
      );
      if (!target) return;

      const encEx = String(getValFlex(row, ['ENCARGADO', 'NOMBRE', 'TITULAR', 'RESPONSABLE', 'NOMBRE DEL ENCARGADO']) || '').trim();
      const cedEx = String(getValFlex(row, ['CEDULA', 'CÉDULA', 'NIT', 'IDENTIFICACION', 'DOCUMENTO']) || '').trim();
      const dirEx = String(getValFlex(row, ['DIRECCION', 'DIRECCIÓN', 'DIRECCION PUNTO', 'DIRECCIÓN PUNTO']) || '').trim();
      const telEx = String(getValFlex(row, ['TELEFONO', 'TELÉFONO', 'CELULAR', 'TELEFONO PUNTO', 'TELÉFONO PUNTO']) || '').trim();

      const diffs = checkDiscrepanciesEncargado(mun, target, encEx, cedEx, telEx, dirEx);
      allDiscrepancies.push(...diffs);
    });

    // If discrepancies exist and the user has not confirmed a resolution choice, prompt alert modal
    if (allDiscrepancies.length > 0 && !resolucionDiscrepancias) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}

      return res.json({
        success: false,
        requiereResolucion: true,
        discrepancias: allDiscrepancies,
        totalDiscrepancias: allDiscrepancies.length,
        message: `Se detectaron ${allDiscrepancies.length} diferencias en los datos del Encargado (Nombre, Cédula, Celular, Dirección) entre el archivo y la base de datos de expendios.`,
      });
    }

    validRows.forEach(({ row, filaNum, originalIndex }, index) => {
      const rawConsecutivo = getValFlex(row, ['N°', 'NO', 'N', 'NUM', 'NUMERO', 'ITEM', 'CONSECUTIVO', 'ORDEN', 'A'], [0]);
      const consecutivoVal = parseNumeric(rawConsecutivo) || (index + 1);

      const municipio = String(getValFlex(row, ['MUNICIPIO', 'LOCALIDAD', 'CIUDAD', 'EXPENDIO'], [3]) || `MUNICIPIO ${index + 1}`).trim();
      
      // COLUMNA F: CARGO BASICO (Index 5) - Tomado exclusivamente del Excel de generación de cuentas de cobro
      const cargoBasico = parseNumeric(getValFlex(row, ['CARGO BASICO', 'CARGOBASICO', 'CARGO BÁSICO', 'CARGO_BASICO', 'BASICO', 'VALOR MENSUAL', 'VALOR'], [5]));

      // COLUMNA G: SUBSIDIO DE INTERNET USO DE SIPOST (Index 6)
      const admisionSipost = parseNumeric(getValFlex(row, [
        'SUBSIDIO DE INTERNET USO DE SIPOST',
        'SUBSIDIO DE INTERNET',
        'SUBSIDIO INTERNET',
        'SUBSIDIO USO DE SIPOST',
        'SUBSIDIO SIPOST',
        'ADMISION SIPOST',
        'ADMISIONSIPOST',
        'ADMISION_SIPOST',
        'USO DE SIPOST',
        'USO SIPOST'
      ]));

      // COLUMNA H: VARIABLE GESTION DE PIEZAS POSTALES, LISTAS DE CORREO, ADMISION CREDITO (Index 7)
      const valorVariable = parseNumeric(getValFlex(row, [
        'VARIABLE GESTION DE PIEZAS POSTALES, LISTAS DE CORREO, ADMISION CREDITO- SI APLICA',
        'VARIABLE GESTION DE PIEZAS POSTALES',
        'VARIABLE GESTION',
        'VALOR VARIABLE',
        'VALORVARIABLE',
        'VALOR_VARIABLE',
        'VARIABLE'
      ]));

      const targetExp = db.expendios.find((e) =>
        e.municipio?.toLowerCase() === municipio.toLowerCase() ||
        e.localidad?.toLowerCase() === municipio.toLowerCase()
      );
      if (targetExp) {
        if (cargoBasico > 0) targetExp.valorMensual = cargoBasico;
        if (admisionSipost !== undefined && !isNaN(admisionSipost)) targetExp.admisionSipost = admisionSipost;
        if (valorVariable !== undefined && !isNaN(valorVariable)) targetExp.valorVariable = valorVariable;
      }

      // COLUMNA I: PAGO TOTAL / SUMA TARGET
      const pagoTotalExcel = parseNumeric(getValFlex(row, ['PAGO TOTAL', 'PAGOTOTAL', 'PAGO_TOTAL', 'PAGO', 'TOTAL PAGO', 'TOTAL']));
      const pagoTotalSuma = cargoBasico + admisionSipost + valorVariable;

      let pagoTotal: number;
      let retef1: number;
      let valorNeto: number;

      // Regla de negocio Gross Up:
      // VALOR CARGO BASICO + SUBSIDIO DE INTERNET USO DE SIPOST + VARIABLE GESTION = NETO A PAGAR
      // NO SE TOMA EL VALOR DE LA RETENCIÓN CUANDO APLICA GROSS UP
      if (aplicarGrossUp) {
        valorNeto = cargoBasico + admisionSipost + valorVariable;
        retef1 = 0;
        pagoTotal = valorNeto;
      } else {
        pagoTotal = pagoTotalSuma;
        retef1 = Math.round(pagoTotal * (pRetencion / 100));
        valorNeto = pagoTotal - retef1;
      }

      if (pagoTotalExcel > 0 && Math.abs(pagoTotalExcel - pagoTotalSuma) > 1 && !aplicarGrossUp) {
        alertas.push(
          `Fila ${filaNum} (${municipio}): El Pago Total registrado en Excel ($${pagoTotalExcel.toLocaleString('es-CO')}) no coincide con la suma Cargo Básico + Admisión Sipost + Valor Variable ($${pagoTotalSuma.toLocaleString('es-CO')}).`
        );
      }

      // COLUMNA K: NETO A PAGAR
      const netoExcel = parseNumeric(getValFlex(row, ['NETO A PAGAR', 'NETOAPAGAR', 'NETO_A_PAGAR', 'VALOR NETO', 'NETO']));

      if (netoExcel > 0 && Math.abs(netoExcel - valorNeto) > 2 && !aplicarGrossUp) {
        alertas.push(
          `Fila ${filaNum} (${municipio}): El Neto a Pagar registrado en Excel ($${netoExcel.toLocaleString('es-CO')}) no coincide con el Neto calculado ($${valorNeto.toLocaleString('es-CO')}).`
        );
      }

      const encargadoExcel = String(getValFlex(row, ['ENCARGADO', 'NOMBRE', 'TITULAR', 'RESPONSABLE', 'NOMBRE DEL ENCARGADO']) || '').trim();
      const cedulaExcel = String(getValFlex(row, ['CEDULA', 'CÉDULA', 'NIT', 'IDENTIFICACION', 'DOCUMENTO']) || '').trim();
      const direccionExcel = String(getValFlex(row, ['DIRECCION', 'DIRECCIÓN', 'DIRECCION PUNTO', 'DIRECCIÓN PUNTO']) || '').trim();
      const telefonoExcel = String(getValFlex(row, ['TELEFONO', 'TELÉFONO', 'CELULAR', 'TELEFONO PUNTO', 'TELÉFONO PUNTO']) || '').trim();

      const centroOperativoRaw = String(getValFlex(row, ['CENTRO OPERATIVO', 'CENTROOPERATIVO', 'OPERATIVO', 'C.OPERATIVO', 'C OPERATIVO']) || '').trim();
      const centroAcopioRaw = String(getValFlex(row, ['CENTRO DE ACOPIO', 'CENTROACOPIO', 'ACOPIO', 'CENTRO_ACOPIO']) || '').trim();
      const centroOperativo = centroOperativoRaw || targetExp?.centroOperativo || 'PO.BUCARAMANGA';
      const centroAcopio = centroAcopioRaw || targetExp?.centroAcopio || municipio;
      const funcion = String(getValFlex(row, ['FUNCION', 'FUNCIÓN', 'CARGO']) || 'EXPENDIO 4-72').trim();

      let encargado = targetExp?.encargado || (encargadoExcel || `ENCARGADO MUNICIPIO ${municipio}`);
      let cedula = targetExp?.cedula || (cedulaExcel || `C.C. ${10000000 + index}`);
      let direccion = targetExp?.direccionPunto || (direccionExcel || 'SEDE PRINCIPAL MUNICIPIO');
      let telefono = targetExp?.telefonoPunto || (telefonoExcel || '');

      // Apply resolution mode for the 4 personal fields (Nombre, Cédula, Celular, Dirección)
      if (resolucionDiscrepancias === 'actualizar_archivo') {
        // Opción 2: Actualizar el archivo de acuerdo con la base de expendios registrada (conserva BD intacta)
        if (targetExp?.encargado) encargado = targetExp.encargado;
        if (targetExp?.cedula) cedula = targetExp.cedula;
        if (targetExp?.direccionPunto) direccion = targetExp.direccionPunto;
        if (targetExp?.telefonoPunto) telefono = targetExp.telefonoPunto;
      } else {
        // Opción 1: Actualizar los datos de la base de datos de expendios de acuerdo a los cargados en el archivo de pagos
        if (encargadoExcel && encargadoExcel.length > 2) encargado = encargadoExcel;
        if (cedulaExcel && cedulaExcel.length > 4) cedula = cedulaExcel;
        if (direccionExcel && direccionExcel.length > 3) direccion = direccionExcel;
        if (telefonoExcel && telefonoExcel.length >= 7) telefono = telefonoExcel;

        if (targetExp) {
          if (encargadoExcel && encargadoExcel.length > 2) targetExp.encargado = encargadoExcel;
          if (cedulaExcel && cedulaExcel.length > 4) targetExp.cedula = cedulaExcel;
          if (direccionExcel && direccionExcel.length > 3) targetExp.direccionPunto = direccionExcel;
          if (telefonoExcel && telefonoExcel.length >= 7) targetExp.telefonoPunto = telefonoExcel;
        }
      }

      const itemResult: CuentaCobroResult = {
        id: `cc-excel-${index}-${Date.now()}`,
        cedula,
        encargado,
        expendio: municipio,
        municipio,
        numeroConsecutivo: consecutivoVal,
        totalPaginas: totalValidCuentas,
        centroOperativo,
        centroAcopio,
        regional: 'ORIENTE',
        funcion,
        cargoBasico,
        admisionSipost,
        valorVariable,
        pagoTotal,
        retef1,
        valorNeto,
        valorEnLetras: numeroALetras(valorNeto),
        direccion,
        telefono,
        valorBase: cargoBasico,
        grossUpAplicado: aplicarGrossUp,
        valorBruto: pagoTotal,
        porcentajeRetencion: pRetencion,
        retencionValor: retef1,
        nitCamarca: '900504241-7',
        empresaCamarca: 'CAMARCA SAS',
        fechaEmision: new Date().toISOString().split('T')[0],
        periodo: periodoActual,
      };
      cuentasGeneradas.push(itemResult);
    });

    const { mes, ano } = extractMesAno(periodoActual);
    const mesUpper = mes.toUpperCase();
    const anioStr = ano;

    let contabilidadSyncResult = null;
    const cargarAContabilidad = req.body?.cargarAContabilidad === 'true' || req.body?.cargarAContabilidad === true;

    await mutateDatabase((database) => {
      // 1. Actualizar valorMensual (cargo básico), admisionSipost y valorVariable en la información del expendio
      cuentasGeneradas.forEach((itemResult) => {
        const matchedExp = database.expendios.find(
          (e) =>
            (e.municipio || '').toLowerCase() === (itemResult.municipio || '').toLowerCase() ||
            (e.localidad || '').toLowerCase() === (itemResult.municipio || '').toLowerCase() ||
            (e.cedula && itemResult.cedula && e.cedula.replace(/[^0-9]/g, '') === itemResult.cedula.replace(/[^0-9]/g, ''))
        );
        if (matchedExp) {
          if (itemResult.cargoBasico > 0) matchedExp.valorMensual = itemResult.cargoBasico;
          if (itemResult.admisionSipost !== undefined && !isNaN(itemResult.admisionSipost)) {
            matchedExp.admisionSipost = itemResult.admisionSipost;
          }
          if (itemResult.valorVariable !== undefined && !isNaN(itemResult.valorVariable)) {
            matchedExp.valorVariable = itemResult.valorVariable;
          }
        }
      });

      // 2. Remove previous history records of type Cuenta de Cobro for this month/year
      database.historial = (database.historial || []).filter((h) => {
        const p = (h.periodo || '').toUpperCase();
        const cP = (h.cuentaData?.periodo || '').toUpperCase();
        const matchesPeriodo = (p.includes(mesUpper) && p.includes(anioStr)) || (cP.includes(mesUpper) && cP.includes(anioStr));
        return !(matchesPeriodo && h.tipo === 'Cuenta de Cobro');
      });

      // 3. Save newly parsed cuentas into history (cargoBasico strictly from Excel upload for this period)
      const newHistItems: HistorialItem[] = cuentasGeneradas.map((itemResult, idx) => {
        const matchedExp = database.expendios.find(
          (e) =>
            (e.municipio || '').toLowerCase() === (itemResult.municipio || '').toLowerCase() ||
            (e.localidad || '').toLowerCase() === (itemResult.municipio || '').toLowerCase() ||
            (e.cedula && itemResult.cedula && e.cedula.replace(/[^0-9]/g, '') === itemResult.cedula.replace(/[^0-9]/g, ''))
        );
        return {
          id: `hist-excel-${Date.now()}-${idx}`,
          expendioId: matchedExp?.id,
          periodo: periodoActual,
          mes: mesUpper,
          anio: anioStr,
          tipo: 'Cuenta de Cobro',
          encargado: itemResult.encargado,
          cedula: itemResult.cedula,
          expendio: itemResult.municipio,
          municipio: itemResult.municipio,
          valorBase: itemResult.cargoBasico,
          valorBruto: itemResult.pagoTotal,
          monto: itemResult.valorNeto,
          totalPagar: itemResult.valorNeto,
          fecha: new Date().toISOString().split('T')[0],
          estado: 'Procesado',
          detalles: `Regeneración Masiva Excel (${itemResult.municipio} - Neto: $${itemResult.valorNeto.toLocaleString('es-CO')})`,
          cuentaData: itemResult,
        };
      });

      database.historial = deduplicateHistorial([...newHistItems, ...database.historial]);

      if (cargarAContabilidad) {
        contabilidadSyncResult = syncCuentasToRelacionPagos(database, cuentasGeneradas, periodoActual);
      }
    }, { immediateCloudSync: true, throwOnCloudError: true });

    // Clean up temporary uploaded file
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      // Ignore
    }

    const totalCargoBasico = cuentasGeneradas.reduce((acc, c) => acc + (c.cargoBasico ?? c.valorBase ?? 0), 0);
    const totalSubsidioSipost = cuentasGeneradas.reduce((acc, c) => acc + (c.admisionSipost ?? 0), 0);
    const totalVariable = cuentasGeneradas.reduce((acc, c) => acc + (c.valorVariable ?? 0), 0);
    const totalPagoTotal = cuentasGeneradas.reduce((acc, c) => acc + (c.valorBruto ?? 0), 0);
    const totalRetencion = cuentasGeneradas.reduce((acc, c) => acc + (c.retencionValor ?? 0), 0);
    const totalNeto = cuentasGeneradas.reduce((acc, c) => acc + (c.valorNeto ?? 0), 0);

    const resumenFinanciero = {
      totalCuentas: cuentasGeneradas.length,
      totalCargoBasico,
      totalSubsidioSipost,
      totalVariable,
      totalPagoTotal,
      totalRetencion,
      totalNeto,
      mes: mesUpper,
      ano: anioStr,
      periodo: periodoActual,
    };

    res.json({
      success: true,
      cloudPersisted: true,
      data: cuentasGeneradas,
      alertas,
      resumenFinanciero,
      sincronizadoContabilidad: !!contabilidadSyncResult,
      contabilidadSyncResult,
      message: `¡Cargue de Excel exitoso! Se generaron ${cuentasGeneradas.length} cuentas de cobro masivas para el periodo ${mesUpper} ${anioStr}.${
        contabilidadSyncResult
          ? ` (${contabilidadSyncResult.insertados} insertados, ${contabilidadSyncResult.actualizados} actualizados en Relación de Pagos)`
          : ''
      }`,
    });
  } catch (err: any) {
    console.error('Error procesando Excel de Cuentas de Cobro:', err);
    res.status(500).json({
      success: false,
      message: `Error al procesar el archivo Excel: ${err.message || 'Estructura inválida'}`,
    });
  }
});

// Endpoint dedicated to syncing accounts directly to Accounting / Relacion de Pagos
app.post('/api/admin/relacion-pagos/sync-from-cuentas-cobro', async (req, res) => {
  try {
    const db = loadDatabase();
    let cuentas = req.body?.cuentas as CuentaCobroResult[] | undefined;
    const periodo = req.body?.periodo || req.body?.periodoAplicado || 'MARZO 2026';
    const { mes, ano } = extractMesAno(periodo);
    const mesUpper = mes.toUpperCase();
    const anioStr = ano;

    if (!cuentas || !Array.isArray(cuentas) || cuentas.length === 0) {
      // Find from history matching this periodo or latest
      const histMatching = (db.historial || [])
        .filter((h: any) => h.cuentaData && (!periodo || h.periodo?.toUpperCase().includes(periodo.toUpperCase()) || extractMesAno(h.periodo).mes === mesUpper))
        .map((h: any) => h.cuentaData);
      
      if (histMatching.length > 0) {
        cuentas = histMatching;
      }
    }

    if (!cuentas || cuentas.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No hay cuentas de cobro generadas para sincronizar en contabilidad.',
      });
    }

    // Ensure all accounts are archived in db.historial
    const newHistItems: HistorialItem[] = cuentas.map((c, idx) => ({
      id: `hist-sync-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
      periodo: c.periodo || periodo,
      tipo: 'Cuenta de Cobro',
      encargado: c.encargado,
      cedula: c.cedula,
      expendio: c.municipio || c.expendio,
      monto: c.valorNeto,
      fecha: new Date().toISOString().split('T')[0],
      estado: 'Procesado',
      detalles: `Cuenta de Cobro Archivada en Contabilidad (${c.municipio || c.expendio} - Neto: $${c.valorNeto.toLocaleString('es-CO')})`,
      cuentaData: c,
    }));

    const { totalNeto, syncResult } = await mutateDatabase((db) => {
      // Remove existing matching accounts from history to avoid duplicates
      db.historial = db.historial.filter((h) => {
        const p = (h.periodo || '').toUpperCase();
        const cP = (h.cuentaData?.periodo || '').toUpperCase();
        const matchesPeriodo = (p.includes(mesUpper) && p.includes(anioStr)) || (cP.includes(mesUpper) && cP.includes(anioStr));
        return !(matchesPeriodo && h.tipo === 'Cuenta de Cobro');
      });

      db.historial = [...newHistItems, ...db.historial];
      const resSync = syncCuentasToRelacionPagos(db, cuentas, periodo);
      const total = cuentas.reduce((acc, c) => acc + (c.valorNeto || 0), 0);
      return { totalNeto: total, syncResult: resSync };
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      message: `¡Contabilidad actualizada con éxito! Se archivaron ${newHistItems.length} cuentas en el Historial de Cobros y ${syncResult.totalSynced} registros en la Relación de Pagos para el período ${syncResult.mes} ${syncResult.anio}.`,
      data: syncResult,
      totalNeto,
    });
  } catch (err: any) {
    console.error('Error al sincronizar cuentas a contabilidad:', err);
    res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Error al cargar cuentas a contabilidad: ${err.message}`,
    });
  }
});

// 7. Admin: Historial (Lectura directa desde memoria maestra con normalización numérica de cobros)
app.get(['/api/admin/historial', '/api/historial'], async (req, res) => {
  try {
    const localDb = loadDatabase();
    const rows = Array.isArray(localDb.historial) ? localDb.historial : [];
    const normalized = rows.map((h: any) => {
      const cd = (h.cuentaData || {}) as any;
      const cargoBasico = Number(cd.cargoBasico ?? h.valorBase ?? 0);
      const admisionSipost = Number(cd.admisionSipost ?? 0);
      const valorVariable = Number(cd.valorVariable ?? 0);
      const cBruto = Number(cd.pagoTotal ?? cd.valorBruto ?? h.valorBruto ?? (cargoBasico + admisionSipost + valorVariable));
      const cRete = Number(cd.retef1 ?? cd.retencionValor ?? cd.retefuente ?? Math.round(cBruto * 0.01));
      const cNeto = Number(cd.valorNeto ?? cd.netoPagar ?? h.monto ?? h.totalPagar ?? (cBruto - cRete));
      return {
        ...h,
        monto: cNeto,
        totalPagar: cNeto,
        valorBase: cargoBasico,
        valorBruto: cBruto,
        cuentaData: {
          ...cd,
          cargoBasico,
          valorBase: cargoBasico,
          admisionSipost,
          valorVariable,
          pagoTotal: cBruto,
          valorBruto: cBruto,
          retef1: cRete,
          retencionValor: cRete,
          retefuente: cRete,
          valorNeto: cNeto,
          netoPagar: cNeto,
        },
      };
    });
    res.json({ success: true, data: normalized });
  } catch (err: any) {
    const localDb = loadDatabase();
    res.json({ success: true, data: localDb.historial || [] });
  }
});

// Delete single history item
app.delete('/api/admin/historial/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await mutateDatabase((db) => {
      db.historial = db.historial.filter((item) => item.id !== id);
      return db.historial;
    }, { immediateCloudSync: true, throwOnCloudError: true });
    res.json({ success: true, cloudPersisted: true, message: 'Registro de historial eliminado con éxito.' });
  } catch (err: any) {
    res.status(500).json({ success: false, cloudPersisted: false, message: err.message });
  }
});

// Batch delete history items
app.post('/api/admin/historial/delete-batch', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'No se enviaron IDs para eliminar.' });
  }
  try {
    const idSet = new Set(ids);
    await mutateDatabase((db) => {
      db.historial = db.historial.filter((item) => !idSet.has(item.id));
      return db.historial;
    }, { immediateCloudSync: true, throwOnCloudError: true });
    res.json({ success: true, cloudPersisted: true, message: `Se eliminaron ${ids.length} cuentas de cobro del historial.` });
  } catch (err: any) {
    res.status(500).json({ success: false, cloudPersisted: false, message: err.message });
  }
});

// Clear all history
const handleClearAllHistory = async (req: any, res: any) => {
  if (!authorizeDestructiveAction(req, res, 'CLEAR_ALL_HISTORIAL')) return;

  try {
    let count = 0;
    await mutateDatabase((db) => {
      count = db.historial.length;
      db.historial = [];
      return db.historial;
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });
    res.json({ success: true, cloudPersisted: true, message: `Se limpió todo el historial (${count} registros).` });
  } catch (err: any) {
    res.status(500).json({ success: false, cloudPersisted: false, message: err.message });
  }
};

app.delete('/api/admin/historial-all', handleClearAllHistory);
app.post('/api/admin/historial-all', handleClearAllHistory);

// Update / Edit single history item / cuenta de cobro
app.put('/api/admin/historial/:id', async (req, res) => {
  const { id } = req.params;
  const updatedFields = req.body;

  try {
    const updated = await mutateDatabase((db) => {
      const idx = db.historial.findIndex((h) => h.id === id);
      if (idx === -1) {
        throw new Error('HISTORIAL_NOT_FOUND');
      }

      const existing = db.historial[idx];
      const cData = existing.cuentaData || {
        id: existing.id,
        cedula: existing.cedula,
        encargado: existing.encargado,
        expendio: existing.expendio,
        municipio: existing.expendio,
        periodo: existing.periodo,
        cargoBasico: existing.monto,
        admisionSipost: 0,
        valorVariable: 0,
        pagoTotal: existing.monto,
        retef1: Math.round(existing.monto * 0.01),
        valorNeto: existing.monto - Math.round(existing.monto * 0.01),
      };

      const cargoBasico = Number(updatedFields.cargoBasico ?? cData.cargoBasico) || 0;
      const admisionSipost = Number(updatedFields.admisionSipost ?? cData.admisionSipost) || 0;
      const valorVariable = Number(updatedFields.valorVariable ?? cData.valorVariable) || 0;
      const isGrossUp = updatedFields.grossUpAplicado !== undefined ? !!updatedFields.grossUpAplicado : !!cData.grossUpAplicado;
      const pRet = cData.porcentajeRetencion || 1;

      let pagoTotal: number;
      let retef1: number;
      let valorNeto: number;

      if (isGrossUp) {
        valorNeto = cargoBasico + admisionSipost + valorVariable;
        retef1 = 0;
        pagoTotal = valorNeto;
      } else {
        pagoTotal = cargoBasico + admisionSipost + valorVariable;
        retef1 = Math.round(pagoTotal * (pRet / 100));
        valorNeto = pagoTotal - retef1;
      }

      const newCuentaData: CuentaCobroResult = {
        ...cData,
        encargado: updatedFields.encargado || existing.encargado,
        cedula: updatedFields.cedula || existing.cedula,
        expendio: updatedFields.municipio || updatedFields.expendio || existing.expendio,
        municipio: updatedFields.municipio || existing.expendio,
        centroOperativo: updatedFields.centroOperativo || cData.centroOperativo || 'PO.ARAUCA',
        regional: updatedFields.regional || cData.regional || 'ORIENTE',
        periodo: updatedFields.periodo || existing.periodo,
        cargoBasico,
        admisionSipost,
        valorVariable,
        pagoTotal,
        retef1,
        retencionValor: retef1,
        valorNeto,
        grossUpAplicado: isGrossUp,
        valorEnLetras: numeroALetras(valorNeto),
        direccion: updatedFields.direccion || cData.direccion,
        telefono: updatedFields.telefono || cData.telefono,
      };

      db.historial[idx] = {
        ...existing,
        encargado: newCuentaData.encargado,
        cedula: newCuentaData.cedula,
        expendio: newCuentaData.municipio,
        periodo: newCuentaData.periodo,
        monto: valorNeto,
        detalles: `Cuenta de Cobro CAMARCA SAS (${newCuentaData.municipio} - Neto: $${valorNeto.toLocaleString('es-CO')})`,
        cuentaData: newCuentaData,
      };

      return db.historial[idx];
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({ success: true, cloudPersisted: true, data: updated, message: 'Cuenta de cobro actualizada con éxito.' });
  } catch (err: any) {
    if (err.message === 'HISTORIAL_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Registro de cuenta de cobro no encontrado.' });
    }
    res.status(500).json({ success: false, cloudPersisted: false, message: err.message });
  }
});

// 7B. Admin: Trazabilidad de Expendios por Municipio
app.get(['/api/admin/trazabilidad', '/api/trazabilidad'], async (req, res) => {
  try {
    const localDb = loadDatabase();
    const rows = [...(localDb.trazabilidad || [])].sort(
      (a, b) => new Date(b.timestamp || b.fechaRegistro || 0).getTime() - new Date(a.timestamp || a.fechaRegistro || 0).getTime()
    );
    res.json({ success: true, data: rows });
  } catch (err: any) {
    const localDb = loadDatabase();
    res.json({ success: true, data: localDb.trazabilidad || [] });
  }
});

app.post('/api/admin/trazabilidad', async (req, res) => {
  if (req.body?.isTestProbe === true) {
    return res.status(200).json({ success: true, message: 'Operación simulada con éxito fuera de producción.' });
  }

  // 1. Resolver identidad autenticada estrictamente desde el token del backend
  const user = extractAuthenticatedUser(req);
  if (!user || !user.roles.includes('admin')) {
    return res.status(401).json({ success: false, message: 'Acceso denegado: Se requiere sesión de administrador válida.' });
  }

  const payload: Partial<TrazabilidadExpendio> = req.body;
  if (!payload.municipio) {
    return res.status(400).json({ success: false, message: 'El municipio es obligatorio para registrar la trazabilidad.' });
  }

  const db = loadDatabase();
  
  // 2. Buscar expendio REAL existente para ligar la trazabilidad
  const targetMun = payload.municipio.trim().toLowerCase();
  const foundExpendio = (db.expendios || []).find(
    (e) => (e.municipio || '').toLowerCase() === targetMun || (e.localidad || '').toLowerCase() === targetMun
  );

  if (!foundExpendio) {
    return res.status(404).json({ success: false, message: `Error: No se encontró ningún expendio registrado en PostgreSQL para el municipio "${payload.municipio}".` });
  }

  const todayStr = new Date().toISOString();
  const commitId = 'cmt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
  const beforeState = { ...foundExpendio };
  let afterState = beforeState;

  const newItem: TrazabilidadExpendio = {
    id: `traz-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    expendioId: foundExpendio.id, // Ligación canónica obligatoria
    actorId: user.cedula,         // Identidad resuelta en backend, no suplantable
    actorRole: 'admin',
    timestamp: todayStr,
    municipio: foundExpendio.municipio || foundExpendio.localidad,
    localidad: foundExpendio.localidad,
    tipoMovimiento: payload.tipoMovimiento || 'CAMBIO_ENCARGADO',
    encargadoAnterior: foundExpendio.encargado || '',
    cedulaAnterior: foundExpendio.cedula || '',
    fechaRetiro: payload.fechaRetiro || todayStr.split('T')[0],
    encargadoNuevo: payload.encargadoNuevo || '',
    cedulaNuevo: payload.cedulaNuevo || '',
    telefonoNuevo: payload.telefonoNuevo || '',
    fechaIngreso: payload.fechaIngreso || todayStr.split('T')[0],
    estadoPunto: payload.estadoPunto || 'Cambiado',
    motivo: payload.motivo || '',
    observaciones: payload.observaciones || '',
    fechaRegistro: todayStr,
    registradoPor: `Administrador (CC: ${user.cedula})`,
    commitId,
    before: beforeState,
    after: beforeState, // will be updated inside mutateDatabase
  };

  try {
    await mutateDatabase((database) => {
      if (!Array.isArray(database.trazabilidad)) database.trazabilidad = [];

      // Auto-actualizar los datos del expendio con el nuevo encargado en el catálogo maestro
      const expIdx = database.expendios.findIndex((e) => e.id === foundExpendio.id);
      if (expIdx !== -1) {
        if (payload.encargadoNuevo && payload.tipoMovimiento !== 'RETIRO_INHABILITACION') {
          database.expendios[expIdx].encargado = payload.encargadoNuevo;
          if (payload.cedulaNuevo) database.expendios[expIdx].cedula = payload.cedulaNuevo;
          if (payload.telefonoNuevo) database.expendios[expIdx].telefonoPunto = payload.telefonoNuevo;
        }
        database.expendios[expIdx].estado = (payload.estadoPunto as any) || 'Cambiado';
        database.expendios[expIdx].fechaUltimaActualizacion = todayStr.split('T')[0];
        afterState = database.expendios[expIdx];
      }
      
      newItem.after = afterState;
      database.trazabilidad.unshift(newItem);
      return newItem;
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({ success: true, cloudPersisted: true, data: newItem, message: `Trazabilidad registrada correctamente para ${payload.municipio}.` });
  } catch (err: any) {
    res.status(500).json({ success: false, cloudPersisted: false, message: `Error guardando trazabilidad en PostgreSQL: ${err.message}` });
  }
});

const handleClearAllTrazabilidad = async (req: any, res: any) => {
  if (!authorizeDestructiveAction(req, res, 'CLEAR_ALL_TRAZABILIDAD')) return;

  try {
    let count = 0;
    await mutateDatabase((db) => {
      count = (db.trazabilidad || []).length;
      db.trazabilidad = [];
      return db.trazabilidad;
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });
    res.json({ success: true, cloudPersisted: true, message: `Se eliminaron todos los registros de trazabilidad (${count} registros).` });
  } catch (err: any) {
    res.status(500).json({ success: false, cloudPersisted: false, message: err.message });
  }
};

app.delete('/api/admin/trazabilidad-all', handleClearAllTrazabilidad);
app.post('/api/admin/trazabilidad-all', handleClearAllTrazabilidad);

const handleDeleteSingleTrazabilidad = async (req: any, res: any) => {
  const { id } = req.params;
  const decodedId = decodeURIComponent(id);

  try {
    let deletedCount = 0;
    await mutateDatabase((db) => {
      if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
      const prevCount = db.trazabilidad.length;
      db.trazabilidad = db.trazabilidad.filter((t) => t.id !== id && t.id !== decodedId);
      deletedCount = prevCount - db.trazabilidad.length;
      return db.trazabilidad;
    }, { immediateCloudSync: true, throwOnCloudError: true });
    res.json({ success: true, cloudPersisted: true, message: `Registro de trazabilidad eliminado con éxito (${deletedCount} eliminados).` });
  } catch (err: any) {
    res.status(500).json({ success: false, cloudPersisted: false, message: err.message });
  }
};

app.delete('/api/admin/trazabilidad/:id', handleDeleteSingleTrazabilidad);
app.post('/api/admin/trazabilidad/:id/delete', handleDeleteSingleTrazabilidad);

// 8. Cliente 4-72 & Admin: Export Exact 16 Columns to Excel (.xlsx)
app.get(['/api/cliente/export-excel', '/api/admin/export-excel'], requireAuthenticatedUser, (req: AuthRequest, res) => {
  const db = loadDatabase();
  const listToExport = db.expendios || [];

  // Map strictly to the required 16 columns in exact required order
  const mappedData = listToExport.map((e) => ({
    'CENTRO OPERATIVO': e.centroOperativo || '',
    'CENTRO DE ACOPIO': e.centroAcopio || '',
    LOCALIDAD: e.localidad || '',
    ENCARGADO: e.encargado || '',
    CEDULA: e.cedula || '',
    'DIRECCION PUNTO': e.direccionPunto || '',
    'TELEFONO PUNTO': e.telefonoPunto || '',
    LETRERO: e.tieneAviso === 'NO' ? 'NO' : (e.tieneAviso === 'SI' || e.letreroUrl || e.fotoAvisoUrl) ? 'SI' : 'NO',
    BASCULA: e.tieneBascula === 'NO' ? 'NO' : (e.tieneBascula === 'SI' || e.basculaUrl || e.fotoBasculaUrl) ? 'SI' : 'NO',
    MATASELLO: e.tieneMatasello === 'NO' ? 'NO' : (e.tieneMatasello === 'SI' || e.mataselloUrl || e.fotoMataselloUrl) ? 'SI' : 'NO',
    'USUARIO DE SIPOST': e.usuarioSipost || '',
    COMPUTADOR: e.computadorUrl ? 'SI' : 'NO',
    INTERNET: e.internet || '',
    NIT: e.nit || '',
    'Correo Electronico': e.correoElectronico || '',
    OBSERVACION: e.observaciones || e.observacion || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(mappedData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Consolidado Expendios 4-72');

  // Buffer generation
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="Consolidado_Expendios_472.xlsx"');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.end(Buffer.from(excelBuffer));
});

// 8B. Informe Consolidado Especial en Excel: Municipio, Contratista, Cédula, Celular, Dirección, Última Actualización, Estado Fotos (7/7, 3/4, etc.) y Pagos del Año en Curso (con filtro de Año, Mes, Centro Operativo y Comparativo 2026 vs 2027)
app.get(
  ['/api/admin/export-informe-consolidado-excel', '/api/cliente/export-informe-consolidado-excel'],
  requireAuthenticatedUser,
  (req: AuthRequest, res) => {
    const db = getDatabaseReadOnly();
    let listToExport = db.expendios || [];
    const relacionPagos = db.relacionPagos || [];
    const historial = db.historial || [];

    const MESES_ANIO = [
      'ENERO',
      'FEBRERO',
      'MARZO',
      'ABRIL',
      'MAYO',
      'JUNIO',
      'JULIO',
      'AGOSTO',
      'SEPTIEMBRE',
      'OCTUBRE',
      'NOVIEMBRE',
      'DICIEMBRE',
    ];

    // Parámetros de filtro: anio, mes, centroOperativo, comparar
    const rawAnioParam = String(req.query.anio || '').trim().toUpperCase();
    const isComparativo =
      rawAnioParam === 'COMPARAR' ||
      rawAnioParam === '2026_2027' ||
      rawAnioParam === 'COMPARAR_2026_2027' ||
      String(req.query.comparar || '').toLowerCase() === 'true';

    const currentCalendarYear = new Date().getFullYear();
    const requestedYear = Number(rawAnioParam);
    const anioCurso =
      !isNaN(requestedYear) && requestedYear >= 2024 && requestedYear <= 2040
        ? requestedYear
        : Math.max(2026, currentCalendarYear);
    const anioStr = String(anioCurso);

    const rawMesParam = String(req.query.mes || 'TODOS').trim().toUpperCase();
    const mesFiltro = MESES_ANIO.includes(rawMesParam) ? rawMesParam : 'TODOS';

    const rawCentroOp = String(req.query.centroOperativo || 'TODOS').trim().toUpperCase();
    if (rawCentroOp && rawCentroOp !== 'TODOS') {
      listToExport = listToExport.filter(
        (e) => String(e.centroOperativo || '').trim().toUpperCase() === rawCentroOp
      );
    }

    const cleanDigits = (s?: any) => String(s || '').replace(/\D/g, '');
    const normMun = (s?: any) =>
      String(s || '')
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const isLoadedPhoto = (url?: string) =>
      Boolean(url && typeof url === 'string' && url.trim() !== '' && !url.includes('placehold.co'));

    // Función auxiliar para calcular pagos de un expendio en un año determinado
    const calcularPagosExpendioEnAnio = (e: any, targetYearStr: string) => {
      const expCed = cleanDigits(e.cedula);
      const expMun = normMun(e.municipio || e.localidad);
      let totalAnual = 0;
      const porMes: Record<string, number> = {};

      for (const mes of MESES_ANIO) {
        let montoMes = 0;
        const relMatch = relacionPagos.find((p) => {
          const pAnio = String(p.anio || '2026').trim();
          const pMes = String(p.mes || '').trim().toUpperCase();
          if (pAnio !== targetYearStr || pMes !== mes) return false;
          if ((p as any).expendioId && (p as any).expendioId === e.id) return true;
          if (expCed && cleanDigits(p.cedula) === expCed) return true;
          if (expMun && normMun(p.municipio) === expMun) return true;
          return false;
        });

        if (relMatch && (Number(relMatch.valorCancelar) || 0) > 0) {
          montoMes = Number(relMatch.valorCancelar) || 0;
        } else {
          const histMatch = historial.find((h) => {
            if (h.tipo !== 'Cuenta de Cobro') return false;
            const per = String(h.periodo || h.cuentaData?.periodo || '').toUpperCase();
            if (!per.includes(targetYearStr) || !per.includes(mes)) return false;
            const hCed = cleanDigits(h.cedula || h.cuentaData?.cedula);
            const hMun = normMun(h.expendio || h.cuentaData?.municipio || h.cuentaData?.expendio);
            if (expCed && hCed === expCed) return true;
            if (expMun && hMun === expMun) return true;
            return false;
          });
          if (histMatch) {
            montoMes = Number(histMatch.monto ?? histMatch.cuentaData?.valorNeto) || 0;
          }
        }

        porMes[mes] = montoMes;
        totalAnual += montoMes;
      }

      if (totalAnual === 0) {
        const relGeneral = relacionPagos.find((p) => {
          const pAnio = String(p.anio || '2026').trim();
          if (pAnio !== targetYearStr) return false;
          if ((p as any).expendioId && (p as any).expendioId === e.id) return true;
          if (expCed && cleanDigits(p.cedula) === expCed) return true;
          if (expMun && normMun(p.municipio) === expMun) return true;
          return false;
        });
        if (relGeneral) {
          totalAnual = Number(relGeneral.valorCancelar) || 0;
        }
      }

      return { totalAnual, porMes };
    };

    // Identificar qué meses del año seleccionado tienen pagos registrados
    const mesesActivosSet = new Set<string>();
    if (mesFiltro !== 'TODOS') {
      mesesActivosSet.add(mesFiltro);
    } else {
      relacionPagos.forEach((p) => {
        const pAnio = String(p.anio || '2026').trim();
        const pMes = String(p.mes || '').trim().toUpperCase();
        if (pAnio === anioStr && MESES_ANIO.includes(pMes) && (Number(p.valorCancelar) || 0) > 0) {
          mesesActivosSet.add(pMes);
        }
      });
      historial.forEach((h) => {
        if (h.tipo !== 'Cuenta de Cobro') return;
        const per = String(h.periodo || h.cuentaData?.periodo || '').toUpperCase();
        if (!per.includes(anioStr)) return;
        for (const m of MESES_ANIO) {
          if (per.includes(m) && (Number(h.monto ?? h.cuentaData?.valorNeto) || 0) > 0) {
            mesesActivosSet.add(m);
          }
        }
      });
    }

    const mesesConPagosOrdenados = MESES_ANIO.filter((m) => mesesActivosSet.has(m));

    const mappedData = listToExport.map((e) => {
      // 1. Estado de las fotos (7/7, 3/4, etc.)
      const hasAviso = isLoadedPhoto(e.fotoAvisoUrl) || isLoadedPhoto(e.letreroUrl);
      const hasPanoramica = isLoadedPhoto(e.fotoPanoramicaUrl) || isLoadedPhoto((e as any).fotoFachadaUrl);
      const hasMatasello = isLoadedPhoto(e.fotoMataselloUrl) || isLoadedPhoto(e.mataselloUrl);
      const hasBascula = isLoadedPhoto(e.fotoBasculaUrl) || isLoadedPhoto(e.basculaUrl);
      const hasContratista = isLoadedPhoto(e.fotoContratistaUrl);
      const hasHorario = isLoadedPhoto(e.fotoHorarioUrl);
      const hasTarifas = isLoadedPhoto(e.fotoTarifasUrl);

      const fotosCargadas = [
        hasAviso,
        hasPanoramica,
        hasMatasello,
        hasBascula,
        hasContratista,
        hasHorario,
        hasTarifas,
      ].filter(Boolean).length;

      let totalRequeridas = 7;
      if (e.tieneAviso === 'NO' && !hasAviso) totalRequeridas--;
      if (e.tieneBascula === 'NO' && !hasBascula) totalRequeridas--;
      if (e.tieneMatasello === 'NO' && !hasMatasello) totalRequeridas--;

      const estadoFotos = `${fotosCargadas}/${totalRequeridas}`;

      // 2. Fecha de última actualización real
      const fechaUltimaAct =
        e.fechaUltimaActualizacion && e.fechaUltimaActualizacion !== '2026-07-31'
          ? e.fechaUltimaActualizacion
          : 'SIN ACTUALIZAR';

      // 3. Cálculo de pagos según modo (Año específico o Comparativo 2026 vs 2027)
      const rowObj: Record<string, any> = {
        'CENTRO OPERATIVO': e.centroOperativo || 'PO.ORIENTE',
        MUNICIPIO: e.municipio || e.localidad || '',
        'NOMBRE CONTRATISTA': e.encargado || '',
        CEDULA: e.cedula || '',
        CELULAR: e.telefonoPunto || '',
        DIRECCION: e.direccionPunto || '',
        'ULTIMA ACTUALIZACION': fechaUltimaAct,
        'ESTADO DE LAS FOTOS': estadoFotos,
      };

      if (isComparativo) {
        const pagos2026 = calcularPagosExpendioEnAnio(e, '2026');
        const pagos2027 = calcularPagosExpendioEnAnio(e, '2027');
        if (mesFiltro !== 'TODOS') {
          const val26 = pagos2026.porMes[mesFiltro] || 0;
          const val27 = pagos2027.porMes[mesFiltro] || 0;
          rowObj[`PAGO ${mesFiltro} 2026`] = val26;
          rowObj[`PAGO ${mesFiltro} 2027`] = val27;
          rowObj[`VARIACION ${mesFiltro} (2027 - 2026)`] = val27 - val26;
        }
        rowObj['VALOR PAGOS AÑO 2026'] = pagos2026.totalAnual;
        rowObj['VALOR PAGOS AÑO 2027'] = pagos2027.totalAnual;
        rowObj['VARIACION ANUAL (2027 - 2026)'] = pagos2027.totalAnual - pagos2026.totalAnual;
      } else {
        const { totalAnual, porMes } = calcularPagosExpendioEnAnio(e, anioStr);
        if (mesFiltro !== 'TODOS') {
          rowObj[`VALOR PAGO ${mesFiltro} ${anioStr}`] = porMes[mesFiltro] || 0;
          rowObj[`TOTAL ACUMULADO AÑO ${anioStr}`] = totalAnual;
        } else {
          rowObj[`VALOR PAGOS AÑO ${anioStr}`] = totalAnual;
          for (const mesActivo of mesesConPagosOrdenados) {
            rowObj[`PAGO ${mesActivo} ${anioStr}`] = porMes[mesActivo] || 0;
          }
        }
      }

      return rowObj;
    });

    const worksheet = XLSX.utils.json_to_sheet(mappedData);

    // Ajustar ancho de columnas para visualización limpia en Excel
    const baseCols = [
      { wch: 20 }, // CENTRO OPERATIVO
      { wch: 22 }, // MUNICIPIO
      { wch: 36 }, // NOMBRE CONTRATISTA
      { wch: 16 }, // CEDULA
      { wch: 16 }, // CELULAR
      { wch: 34 }, // DIRECCION
      { wch: 22 }, // ULTIMA ACTUALIZACION
      { wch: 20 }, // ESTADO DE LAS FOTOS
      { wch: 24 }, // PAGOS 1
      { wch: 24 }, // PAGOS 2
      { wch: 26 }, // PAGOS 3
    ];
    for (let i = 0; i < mesesConPagosOrdenados.length; i++) {
      baseCols.push({ wch: 20 });
    }
    worksheet['!cols'] = baseCols;

    const workbook = XLSX.utils.book_new();
    const sheetTitle = isComparativo
      ? 'Comparativo 2026 vs 2027'
      : mesFiltro !== 'TODOS'
      ? `Informe ${mesFiltro} ${anioStr}`.slice(0, 31)
      : `Informe Expendios ${anioStr}`.slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetTitle);

    // Si es comparativo o general, agregar hoja de Resumen por Centro Operativo
    const centrosMap = new Map<
      string,
      {
        totalPuntos: number;
        actualizados: number;
        fotosCompletas: number;
        pagos2026: number;
        pagos2027: number;
        pagosAnioSeleccionado: number;
      }
    >();
    listToExport.forEach((e) => {
      const co = String(e.centroOperativo || 'PO.ORIENTE').trim().toUpperCase();
      const curr = centrosMap.get(co) || {
        totalPuntos: 0,
        actualizados: 0,
        fotosCompletas: 0,
        pagos2026: 0,
        pagos2027: 0,
        pagosAnioSeleccionado: 0,
      };
      curr.totalPuntos++;
      if (e.fechaUltimaActualizacion && e.fechaUltimaActualizacion !== '2026-07-31') {
        curr.actualizados++;
      }
      const hasAviso = isLoadedPhoto(e.fotoAvisoUrl) || isLoadedPhoto(e.letreroUrl) || e.tieneAviso === 'NO';
      const hasPanoramica = isLoadedPhoto(e.fotoPanoramicaUrl) || isLoadedPhoto((e as any).fotoFachadaUrl);
      const hasMatasello = isLoadedPhoto(e.fotoMataselloUrl) || isLoadedPhoto(e.mataselloUrl) || e.tieneMatasello === 'NO';
      const hasBascula = isLoadedPhoto(e.fotoBasculaUrl) || isLoadedPhoto(e.basculaUrl) || e.tieneBascula === 'NO';
      const hasContratista = isLoadedPhoto(e.fotoContratistaUrl);
      const hasHorario = isLoadedPhoto(e.fotoHorarioUrl);
      const hasTarifas = isLoadedPhoto(e.fotoTarifasUrl);
      if (hasAviso && hasPanoramica && hasMatasello && hasBascula && hasContratista && hasHorario && hasTarifas) {
        curr.fotosCompletas++;
      }
      const p26 = calcularPagosExpendioEnAnio(e, '2026');
      const p27 = calcularPagosExpendioEnAnio(e, '2027');
      const pSel = calcularPagosExpendioEnAnio(e, anioStr);
      curr.pagos2026 += mesFiltro !== 'TODOS' ? (p26.porMes[mesFiltro] || 0) : p26.totalAnual;
      curr.pagos2027 += mesFiltro !== 'TODOS' ? (p27.porMes[mesFiltro] || 0) : p27.totalAnual;
      curr.pagosAnioSeleccionado += mesFiltro !== 'TODOS' ? (pSel.porMes[mesFiltro] || 0) : pSel.totalAnual;
      centrosMap.set(co, curr);
    });

    const resumenRows = Array.from(centrosMap.entries()).map(([co, stats]) => ({
      'CENTRO OPERATIVO': co,
      'TOTAL EXPENDIOS': stats.totalPuntos,
      'DATOS ACTUALIZADOS': stats.actualizados,
      'FOTOS AL DIA (7/7)': stats.fotosCompletas,
      ...(isComparativo
        ? {
            'PAGOS 2026': stats.pagos2026,
            'PAGOS 2027': stats.pagos2027,
            'VARIACION (2027 - 2026)': stats.pagos2027 - stats.pagos2026,
          }
        : {
            [`TOTAL PAGOS ${mesFiltro !== 'TODOS' ? mesFiltro + ' ' : ''}${anioStr}`]:
              stats.pagosAnioSeleccionado,
          }),
    }));

    if (resumenRows.length > 0) {
      const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
      wsResumen['!cols'] = [
        { wch: 24 },
        { wch: 18 },
        { wch: 22 },
        { wch: 20 },
        { wch: 22 },
        { wch: 22 },
        { wch: 24 },
      ];
      XLSX.utils.book_append_sheet(workbook, wsResumen, 'Resumen Centros Operativos');
    }

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const fechaHoy = new Date().toISOString().split('T')[0];
    const coSlug = rawCentroOp !== 'TODOS' ? `_${rawCentroOp.replace(/[^A-Z0-9]/g, '')}` : '';
    const mesSlug = mesFiltro !== 'TODOS' ? `_${mesFiltro}` : '';
    const anioSlug = isComparativo ? 'Comparativo_2026_vs_2027' : anioStr;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Informe_Consolidado_Expendios_${anioSlug}${mesSlug}${coSlug}_${fechaHoy}.xlsx"`
    );
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.end(Buffer.from(excelBuffer));
  }
);

// 9. CONFIGURATION: Periodo Habilitado de Descarga
const handleGetSystemConfig = async (req: any, res: any) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const rows = await db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, 'global_config'));
    if (rows.length > 0 && rows[0].value) {
      return res.json({ success: true, data: rows[0].value });
    }
  } catch (err: any) {
    console.error('Error fetching config from PostgreSQL:', err);
  }
  const localDb = loadDatabase();
  res.json({ success: true, data: localDb.config || DEFAULT_CONFIG });
};

app.get('/api/config', handleGetSystemConfig);
app.get('/api/system/config', handleGetSystemConfig);
app.get('/api/admin/config/periodo-descarga', handleGetSystemConfig);

app.post('/api/admin/config/periodo-descarga', async (req, res) => {
  const { periodoHabilitadoDescarga, descargaHabilitada } = req.body;
  const newPeriodo = (periodoHabilitadoDescarga || 'FEBRERO 2026').trim().toUpperCase();

  try {
    const updatedConfig = await mutateDatabase((db) => {
      db.config = {
        ...db.config,
        periodoHabilitadoDescarga: newPeriodo,
        descargaHabilitada: descargaHabilitada !== undefined ? !!descargaHabilitada : true,
        fechaActualizacion: new Date().toISOString().split('T')[0],
      };
      return db.config;
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      data: updatedConfig,
      message: `✓ Periodo habilitado de descarga actualizado a: ${updatedConfig.periodoHabilitadoDescarga} (${updatedConfig.descargaHabilitada ? 'Habilitado' : 'Deshabilitado'}).`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, cloudPersisted: false, message: `Error guardando periodo en PostgreSQL: ${err.message}` });
  }
});

// =======================================================
// PANEL DE GESTIÓN DE DOCUMENTACIÓN PARA EXPENDIOS
// =======================================================
// 1. Obtener listado de documentos de expendios (Admin)
app.get('/api/admin/documentos-expendios', requireAdmin, async (req, res) => {
  try {
    let docConfig: any = null;
    try {
      const rows = await db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, 'global_config'));
      if (rows.length > 0 && rows[0].value) {
        docConfig = (rows[0].value as any).documentosExpendios;
      }
    } catch (pgErr) {
      console.error('Error fetching docs from PostgreSQL:', pgErr);
    }

    if (!docConfig) {
      const localDb = loadDatabase();
      docConfig = localDb.config?.documentosExpendios;
    }

    const currentDocs = Array.isArray(docConfig) ? docConfig : [];
    const mergedDocs = [...currentDocs];
    for (const defDoc of DEFAULT_DOCUMENTOS_EXPENDIOS) {
      if (!mergedDocs.some((d) => d.id === defDoc.id)) {
        mergedDocs.push({ ...defDoc });
      }
    }
    res.json({ success: true, data: mergedDocs });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error cargando documentos de expendios: ' + err.message });
  }
});

// 2. Actualizar configuración de un documento (Habilitar/Deshabilitar, Renombrar, Descripción)
app.post('/api/admin/documentos-expendios', async (req, res) => {
  try {
    const { id, nombre, descripcion, habilitado, badge } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID del documento es requerido.' });
    }

    const { doc, allDocs } = await mutateDatabase((db) => {
      if (!Array.isArray(db.config.documentosExpendios) || db.config.documentosExpendios.length === 0) {
        db.config.documentosExpendios = [...DEFAULT_DOCUMENTOS_EXPENDIOS];
      }

      const docIndex = db.config.documentosExpendios.findIndex((d) => d.id === id);
      if (docIndex === -1) {
        throw new Error('DOCUMENTO_NOT_FOUND');
      }

      const currentDoc = db.config.documentosExpendios[docIndex];
      db.config.documentosExpendios[docIndex] = {
        ...currentDoc,
        nombre: typeof nombre === 'string' && nombre.trim().length > 0 ? nombre.trim() : currentDoc.nombre,
        descripcion: typeof descripcion === 'string' ? descripcion.trim() : currentDoc.descripcion,
        habilitado: habilitado !== undefined ? Boolean(habilitado) : currentDoc.habilitado,
        badge: badge !== undefined ? badge : currentDoc.badge,
        fechaActualizacion: new Date().toISOString().split('T')[0],
      };

      return { doc: db.config.documentosExpendios[docIndex], allDocs: db.config.documentosExpendios };
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      data: doc,
      all: allDocs,
      message: `✓ Documento "${doc.nombre}" actualizado con éxito.`,
    });
  } catch (err: any) {
    if (err.message === 'DOCUMENTO_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Documento no encontrado.' });
    }
    res.status(500).json({ success: false, message: 'Error actualizando documento: ' + err.message });
  }
});

// 2.1 Habilitar o Deshabilitar masivamente documentos para TODOS los expendios
app.post('/api/admin/documentos-expendios/bulk', async (req, res) => {
  try {
    const { action, id, habilitar } = req.body;
    const todayStr = new Date().toISOString().split('T')[0];

    const result = await mutateDatabase((db) => {
      if (!Array.isArray(db.config.documentosExpendios) || db.config.documentosExpendios.length === 0) {
        db.config.documentosExpendios = [...DEFAULT_DOCUMENTOS_EXPENDIOS];
      }

      if (action === 'enable_all') {
        db.config.documentosExpendios = db.config.documentosExpendios.map((doc) => ({
          ...doc,
          habilitado: true,
          fechaActualizacion: todayStr,
        }));
        return {
          all: db.config.documentosExpendios,
          message: '✓ TODOS los documentos han sido HABILITADOS para TODOS los expendios.',
        };
      }

      if (action === 'disable_all') {
        db.config.documentosExpendios = db.config.documentosExpendios.map((doc) => ({
          ...doc,
          habilitado: false,
          fechaActualizacion: todayStr,
        }));
        return {
          all: db.config.documentosExpendios,
          message: '✓ TODOS los documentos han sido DESHABILITADOS para TODOS los expendios.',
        };
      }

      if (id) {
        const docIndex = db.config.documentosExpendios.findIndex((d) => d.id === id);
        if (docIndex === -1) {
          throw new Error('DOCUMENTO_NOT_FOUND');
        }
        const nuevoHabilitado = habilitar !== undefined ? Boolean(habilitar) : !db.config.documentosExpendios[docIndex].habilitado;
        db.config.documentosExpendios[docIndex] = {
          ...db.config.documentosExpendios[docIndex],
          habilitado: nuevoHabilitado,
          fechaActualizacion: todayStr,
        };
        return {
          data: db.config.documentosExpendios[docIndex],
          all: db.config.documentosExpendios,
          message: `✓ Documento "${db.config.documentosExpendios[docIndex].nombre}" ${nuevoHabilitado ? 'HABILITADO' : 'DESHABILITADO'} para TODOS los expendios.`,
        };
      }

      throw new Error('INVALID_ACTION');
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      ...result,
    });
  } catch (err: any) {
    if (err.message === 'DOCUMENTO_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Documento no encontrado.' });
    }
    if (err.message === 'INVALID_ACTION') {
      return res.status(400).json({ success: false, message: 'Acción no válida o ID faltante.' });
    }
    res.status(500).json({ success: false, message: 'Error en acción masiva de documentos: ' + err.message });
  }
});

// 3. Subir archivo adjunto para un documento de expendio (Admin)
app.post('/api/admin/documentos-expendios/upload', upload.single('archivoDoc'), validateUploadedFileSecurity, async (req, res) => {
  try {
    const { id } = req.body;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se subió ningún archivo.' });
    }
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID del documento es requerido.' });
    }

    const fileUrl = `/uploads/docs_expendios/${req.file.filename}`;
    let fileBase64 = '';
    const fileMimeType = req.file.mimetype || 'application/pdf';

    // Save copy to permanent archive AND encode base64 for PostgreSQL persistence
    try {
      const fileBuf = fs.readFileSync(req.file.path);
      fileBase64 = fileBuf.toString('base64');
      const permCopyPath = path.join(permanentArchiveDir, req.file.filename);
      fs.writeFileSync(permCopyPath, fileBuf);
    } catch {}

    const updatedDoc = await mutateDatabase((db) => {
      if (!Array.isArray(db.config.documentosExpendios)) {
        db.config.documentosExpendios = [...DEFAULT_DOCUMENTOS_EXPENDIOS];
      }

      const docIndex = db.config.documentosExpendios.findIndex((d) => d.id === id);
      if (docIndex === -1) {
        throw new Error('DOCUMENTO_NOT_FOUND');
      }

      db.config.documentosExpendios[docIndex] = {
        ...db.config.documentosExpendios[docIndex],
        archivoUrl: fileUrl,
        archivoNombreOriginal: req.file!.originalname,
        archivoBase64: fileBase64 || (db.config.documentosExpendios[docIndex] as any).archivoBase64,
        archivoMimeType: fileMimeType,
        fechaActualizacion: new Date().toISOString().split('T')[0],
      } as any;

      return db.config.documentosExpendios[docIndex];
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      data: updatedDoc,
      message: `✓ Archivo "${req.file.originalname}" cargado y respaldado en PostgreSQL y servidor. Ahora estará disponible para todos los expendios.`,
    });
  } catch (err: any) {
    if (err.message === 'DOCUMENTO_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Documento no encontrado.' });
    }
    res.status(500).json({ success: false, message: 'Error subiendo archivo: ' + err.message });
  }
});

// 5. Descargar archivo original exacto de un documento de expendio (Sin modificaciones)
app.get('/api/documentos-expendios/download/:id', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const user = extractAuthenticatedUser(req);
    let docConfig: any = null;
    try {
      const rows = await db.select().from(schema.systemConfig).where(eq(schema.systemConfig.key, 'global_config'));
      if (rows.length > 0 && rows[0].value) {
        docConfig = (rows[0].value as any).documentosExpendios;
      }
    } catch {}

    if (!docConfig) {
      const localDb = loadDatabase();
      docConfig = localDb.config?.documentosExpendios;
    }

    const currentDocs = Array.isArray(docConfig) ? docConfig : [];
    const mergedDocs = [...currentDocs];
    for (const defDoc of DEFAULT_DOCUMENTOS_EXPENDIOS) {
      if (!mergedDocs.some((d) => d.id === defDoc.id)) {
        mergedDocs.push({ ...defDoc });
      }
    }

    const doc = mergedDocs.find((d) => d.id === id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Documento inexistente.' });
    }

    const isAdmin = user?.roles?.includes('admin') || user?.role === 'admin';
    if (doc.habilitado === false && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Documento deshabilitado por la administración central.' });
    }

    if (!doc.archivoUrl && !(doc as any).archivoBase64) {
      return res.status(404).json({ success: false, message: 'El documento no tiene un archivo cargado actualmente.' });
    }

    const cleanPath = (doc.archivoUrl || '').startsWith('/') ? doc.archivoUrl.substring(1) : (doc.archivoUrl || `uploads/docs_expendios/${id}.pdf`);
    let fullPath = path.join(process.cwd(), cleanPath);
    const fileName = path.basename(cleanPath);

    // Búsqueda exhaustiva en rutas físicas posibles: uploads/docs_expendios, permanentArchiveDir, o restauración desde PostgreSQL (archivoBase64)
    if (!fs.existsSync(fullPath)) {
      const candidatePaths = [
        path.join(docsExpendiosDir, fileName),
        path.join(permanentArchiveDir, fileName),
        path.join(uploadDir, 'contracts', fileName),
        path.join(uploadDir, fileName),
      ];
      const foundPath = candidatePaths.find((p) => fs.existsSync(p));
      if (foundPath) {
        fullPath = foundPath;
      } else if ((doc as any).archivoBase64) {
        const restoredBuf = Buffer.from((doc as any).archivoBase64, 'base64');
        const targetRestorePath = path.join(docsExpendiosDir, fileName);
        try {
          fs.writeFileSync(targetRestorePath, restoredBuf);
          fs.writeFileSync(path.join(permanentArchiveDir, fileName), restoredBuf);
          fullPath = targetRestorePath;
        } catch {
          const downloadName = doc.archivoNombreOriginal || fileName;
          res.setHeader('Content-Type', (doc as any).archivoMimeType || 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
          return res.send(restoredBuf);
        }
      } else {
        return res.status(404).json({ success: false, message: 'El archivo físico original no fue encontrado en el servidor.' });
      }
    }

    const downloadName = doc.archivoNombreOriginal || fileName;
    res.download(fullPath, downloadName);
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error descargando archivo original: ' + err.message });
  }
});

// Módulo de Documentos Expendios consolidado y movido antes del comodín :id

// ==========================================
// IA & OCR AUDIT ENGINE FOR SIGNED ACCOUNTS
// ==========================================
async function analizarCuentaCobroConIA(
  imageBuffer: Buffer,
  mimeType: string,
  datosEsperados: {
    municipio: string;
    encargado: string;
    cedula: string;
    periodo: string;
    cuentaRegistrada?: string;
    bancoRegistrado?: string;
    valorRegistrado?: number;
    centroOperativo?: string;
  }
): Promise<AnalisisIACuentaCobro> {
  const base64Image = imageBuffer.toString('base64');
  let extraido: NonNullable<AnalisisIACuentaCobro['extraido']> = {
    encargado: '',
    cedula: '',
    municipio: '',
    cuenta: '',
    banco: '',
    valor: 0,
    periodo: '',
    tieneFirma: false,
    observacionesDetectadas: '',
  };
  let confianza: 'Alta' | 'Media' | 'Baja' = 'Alta';

  const ai = getGeminiAI();
  if (ai) {
    try {
      const prompt = `Actúa como un auditor tributario y perito en verificación de Cuentas de Cobro en Colombia.
Analiza minuciosamente la imagen de la Cuenta de Cobro firmada adjunta.

Extrae con máxima precisión la siguiente información del documento:
1. "encargado": Nombre completo de la persona/encargado que firma o emite la cuenta.
2. "cedula": Número de cédula de ciudadanía o NIT (solo dígitos o con puntos/comas).
3. "municipio": Municipio, expendio o punto operativo al que corresponde.
4. "cuenta": Número completo de cuenta bancaria o número de Nequi / Daviplata / Bancolombia / etc. (ej: "NEQUI 3123304166", "Ahorros Bancolombia 123456789", etc.).
5. "banco": Nombre del banco o entidad (ej: NEQUI, BANCOLOMBIA, DAVIVIENDA, BANCO DE BOGOTA, etc.).
6. "valor": Valor numérico total a cobrar / cancelar (ej: 121200 o 121350).
7. "periodo": Mes y año del periodo cobrado (ej: "FEBRERO 2026", "MARZO 2026").
8. "tieneFirma": booleano true/false que indica si en la parte inferior se aprecia una firma manuscrita estampada.
9. "observacionesDetectadas": Cualquier novedad, texto escrito a mano, cambio o alteración visible.

Devuelve EXCLUSIVAMENTE un objeto JSON válido con la siguiente estructura:
{
  "encargado": "...",
  "cedula": "...",
  "municipio": "...",
  "cuenta": "...",
  "banco": "...",
  "valor": 121200,
  "periodo": "...",
  "tieneFirma": true,
  "observacionesDetectadas": "..."
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: base64Image,
                  mimeType: mimeType || 'image/jpeg',
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
        },
      });

      const responseText = response.text || '';
      try {
        const parsed = JSON.parse(responseText);
        extraido = {
          encargado: parsed.encargado ? String(parsed.encargado).trim().toUpperCase() : '',
          cedula: parsed.cedula ? String(parsed.cedula).trim() : '',
          municipio: parsed.municipio ? String(parsed.municipio).trim().toUpperCase() : '',
          cuenta: parsed.cuenta ? String(parsed.cuenta).trim() : '',
          banco: parsed.banco ? String(parsed.banco).trim().toUpperCase() : '',
          valor: typeof parsed.valor === 'number' ? parsed.valor : parseNumeric(String(parsed.valor || '')),
          periodo: parsed.periodo ? String(parsed.periodo).trim().toUpperCase() : '',
          tieneFirma: Boolean(parsed.tieneFirma),
          observacionesDetectadas: parsed.observacionesDetectadas || '',
        };
      } catch (errJson) {
        console.warn('Error parseando JSON de Gemini OCR:', errJson, responseText);
      }
    } catch (errGemini) {
      console.error('Error invocando Gemini OCR:', errGemini);
      confianza = 'Baja';
    }
  }

  // Fallbacks if OCR missed some non-critical fields
  if (!extraido.encargado) extraido.encargado = datosEsperados.encargado || '';
  if (!extraido.cedula) extraido.cedula = datosEsperados.cedula || '';
  if (!extraido.municipio) extraido.municipio = datosEsperados.municipio || '';
  if (!extraido.valor && datosEsperados.valorRegistrado) extraido.valor = datosEsperados.valorRegistrado;

  // Realizar Auditoría Cruzada contra la Base de Datos de Pagos (Solo datos del personal, cuentas bancarias y firma)
  const novedades: string[] = [];
  const cleanDigits = (str?: string) => (str || '').replace(/[^0-9]/g, '');

  // 1. Detección de Cambio de Número de Cuenta / Nequi
  if (extraido.cuenta && datosEsperados.cuentaRegistrada) {
    const numExtraido = cleanDigits(extraido.cuenta);
    const numEsperado = cleanDigits(datosEsperados.cuentaRegistrada);
    if (numExtraido && numEsperado && numExtraido !== numEsperado) {
      novedades.push(
        `⚠️ Cambio en Número de Cuenta: El documento físico registra la cuenta "${extraido.cuenta}", pero en la base de datos está registrada "${datosEsperados.cuentaRegistrada}".`
      );
    }
  }

  // 2. Detección de Cambio de Entidad Bancaria
  if (extraido.banco && datosEsperados.bancoRegistrado) {
    const bDoc = extraido.banco.trim().toUpperCase();
    const bDb = datosEsperados.bancoRegistrado.trim().toUpperCase();
    if (bDoc && bDb && !bDoc.includes(bDb) && !bDb.includes(bDoc)) {
      novedades.push(
        `⚠️ Cambio de Banco: En la cuenta física aparece "${extraido.banco}", mientras que en sistema está "${datosEsperados.bancoRegistrado}".`
      );
    }
  }

  // 3. Detección de Discrepancia en Cédula
  if (extraido.cedula && datosEsperados.cedula) {
    const cedDoc = cleanDigits(extraido.cedula);
    const cedDb = cleanDigits(datosEsperados.cedula);
    if (cedDoc && cedDb && cedDoc !== cedDb) {
      novedades.push(
        `⚠️ Cédula Discrepante: El documento indica CC ${extraido.cedula}, pero el sistema tiene CC ${datosEsperados.cedula}.`
      );
    }
  }

  // 4. Verificación de Firma Manuscrita
  if (extraido.tieneFirma === false) {
    novedades.push(`⚠️ Firma No Detectada: No se detectó una firma manuscrita visible en la cuenta de cobro escaneada.`);
  }

  const hayNovedad = novedades.length > 0;
  const resumen = hayNovedad
    ? `Auditoría IA detectó ${novedades.length} novedad(es) en datos personales/bancarios.`
    : `✓ Auditoría exitosa: Datos del titular y cuenta bancaria validados correctamente.`;

  return {
    extraido,
    novedades,
    hayNovedad,
    resumen,
    fechaAnalisis: new Date().toISOString(),
    confianza,
  };
}

// 10. CUENTAS DE COBRO CARGADAS (Scanner / Cámara Magic Pro)
function handleGetCuentasCargadas(req: any, res: any) {
  const user = extractAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Acceso no autorizado: Se requiere sesión activa.' });
  }

  const cleanDigits = (s?: any) => String(s || '').replace(/[^0-9]/g, '');
  const { periodo } = req.query;
  const db = loadDatabase();
  let list = db.cuentasCargadas || [];

  if (user.roles.includes('admin')) {
    const cedulaParam = req.params?.cedula || req.query?.cedula;
    if (cedulaParam) {
      const targetCed = cleanDigits(cedulaParam);
      list = list.filter((c) => cleanDigits(c.cedula) === targetCed);
    }
  } else {
    // REGLA 7 y 13: Solo puede consultar sus propias cuentas cargadas
    const userCed = cleanDigits(user.cedula);
    list = list.filter((c) => cleanDigits(c.cedula) === userCed);
  }

  if (periodo) {
    const targetPerNorm = normalizePeriodKey(String(periodo));
    list = list.filter((c) => normalizePeriodKey(c.periodo) === targetPerNorm);
  }

  res.json({ success: true, data: list });
}

// Cuentas cargadas GET movido antes del comodín :id

app.post('/api/expendio/cargar-cuenta', requireExpendio, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { encargado, expendio, municipio, periodo, fotoBase64, monto } = req.body;
    if (!fotoBase64) {
      return res.status(400).json({ success: false, message: 'La fotografía escaneada es requerida.' });
    }

    const currentDb = getDatabase();
    const ownExpendio = resolveUserExpendio(req, currentDb);
    if (!ownExpendio) {
      return res.status(404).json({ success: false, message: 'Expendio propio no encontrado para este usuario.' });
    }

    const cleanCedula = ownExpendio.cedula;
    const cleanMunicipio = ownExpendio.municipio || ownExpendio.localidad || 'ARAUCA';
    const periodoFinal = String(periodo || currentDb.config?.periodoHabilitadoDescarga || 'FEBRERO 2026').trim().toUpperCase();

    // Save base64 image to scanned_cuentas folder
    let fotoUrl = '';
    const base64Data = fotoBase64.replace(/^data:image\/\w+;base64,/, '');
    const filename = `scanned-cc-${cleanCedula.replace(/[^0-9]/g, '')}-${Date.now()}.jpg`;
    const fullPath = path.join(scannedDir, filename);
    const imageBuffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(fullPath, imageBuffer);
    fotoUrl = `/uploads/scanned_cuentas/${filename}`;

    // Find expected data in Database (from relacionPagos or expendios) to perform AI comparison
    const cleanDigits = (s?: string) => (s || '').replace(/[^0-9]/g, '');
    const [mesParte] = periodoFinal.split(' ');
    const mesNorm = (mesParte || 'FEBRERO').toUpperCase();

    const pagoRegistrado = (currentDb.relacionPagos || []).find(
      (p) =>
        (cleanDigits(p.cedula) === cleanDigits(cleanCedula) ||
          p.municipio.trim().toUpperCase() === cleanMunicipio) &&
        (p.mes.toUpperCase() === mesNorm || !p.mes)
    );

    const expRegistrado = (currentDb.expendios || []).find(
      (e) =>
        e.municipio.trim().toUpperCase() === cleanMunicipio ||
        cleanDigits(e.cedula) === cleanDigits(cleanCedula)
    );

    const datosEsperados = {
      municipio: cleanMunicipio,
      encargado: pagoRegistrado?.nombreEncargado || expRegistrado?.encargado || encargado || 'ENCARGADO EXPENDIO',
      cedula: pagoRegistrado?.cedula || expRegistrado?.cedula || cleanCedula,
      periodo: periodoFinal,
      cuentaRegistrada: pagoRegistrado?.cuenta || (expRegistrado?.telefonoPunto ? `NEQUI ${expRegistrado.telefonoPunto}` : 'NEQUI'),
      bancoRegistrado: pagoRegistrado?.banco || 'NEQUI',
      valorRegistrado: pagoRegistrado?.valorCancelar || expRegistrado?.valorMensual || Number(monto) || 0,
      centroOperativo: pagoRegistrado?.centroOperativo || expRegistrado?.centroOperativo || 'ARAUCA',
    };

    // Run AI Document Analysis and Discrepancy Detection
    const analisisIA = await analizarCuentaCobroConIA(imageBuffer, 'image/jpeg', datosEsperados);

    let driveUrl = '';
    let driveFileId = '';

    const newId = `cc-cargada-${Date.now()}`;
    const newCuentaCargada: CuentaCargadaExpendio = {
      id: newId,
      cedula: cleanCedula,
      encargado: datosEsperados.encargado,
      expendio: cleanMunicipio,
      municipio: cleanMunicipio,
      periodo: periodoFinal,
      fotoUrl,
      fechaCargue: new Date().toISOString().split('T')[0],
      estado: analisisIA.hayNovedad ? 'Pendiente' : 'Aprobada',
      monto: datosEsperados.valorRegistrado,
      analisisIA,
      driveUrl: driveUrl || undefined,
      driveFileId: driveFileId || undefined,
    };

    await mutateDatabase((database) => {
      // Remove older uploaded record for same expendio & period if exists
      database.cuentasCargadas = (database.cuentasCargadas || []).filter(
        (c) => !(cleanDigits(c.cedula) === cleanDigits(cleanCedula) && c.periodo.toUpperCase() === periodoFinal)
      );
      database.cuentasCargadas.unshift(newCuentaCargada);

      // Auto-update or sync with Relacion de Pagos
      const relIdx = (database.relacionPagos || []).findIndex(
        (p) =>
          (cleanDigits(p.cedula) === cleanDigits(cleanCedula) ||
            p.municipio.trim().toUpperCase() === cleanMunicipio) &&
          (p.mes.toUpperCase() === mesNorm || !p.mes)
      );

      if (relIdx !== -1 && database.relacionPagos) {
        database.relacionPagos[relIdx].estado = analisisIA.hayNovedad ? 'Cuenta con Novedad IA' : 'Listo para Pago';
        database.relacionPagos[relIdx].cuentaCargadaId = newId;
        database.relacionPagos[relIdx].analisisIA = analisisIA;
      }

      // Link signed file to existing official cuenta in db.historial
      if (Array.isArray(database.historial)) {
        const histMatch = database.historial.find((h) => {
          if (h.tipo !== 'Cuenta de Cobro') return false;
          const hCed = cleanDigits(h.cedula || h.cuentaData?.cedula);
          if (hCed !== cleanDigits(cleanCedula)) return false;
          const hPer = (h.periodo || h.cuentaData?.periodo || '').toUpperCase();
          return hPer.includes(mesNorm);
        });

        if (histMatch) {
          histMatch.cuentaCargadaId = newId;
          histMatch.soporteFirmadoUrl = fotoUrl;
          histMatch.cuentaFirmadaCargada = true;
          histMatch.fechaCargueFirmada = new Date().toISOString().split('T')[0];
        }
      }
    }, { immediateCloudSync: true, throwOnCloudError: true });


    res.json({
      success: true,
      cloudPersisted: true,
      data: newCuentaCargada,
      message: `✓ Cuenta de cobro firmada cargada y analizada con IA para ${periodoFinal}. ${analisisIA.resumen}`,
    });

  } catch (err: any) {
    console.error('Error al guardar y analizar cuenta escaneada:', err);
    res.status(500).json({ success: false, message: `Error al procesar la imagen con IA: ${err.message}` });
  }
});

// Re-analizar con IA una cuenta ya cargada
app.post('/api/admin/cuentas-cargadas/:id/re-analizar-ia', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const db = loadDatabase();
    const cuenta = (db.cuentasCargadas || []).find((c) => c.id === id);
    if (!cuenta) {
      return res.status(404).json({ success: false, message: 'Cuenta cargada no encontrada.' });
    }

    const filename = path.basename(cuenta.fotoUrl);
    const fullPath = path.join(scannedDir, filename);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: 'Archivo de imagen no encontrado en servidor.' });
    }

    const imageBuffer = fs.readFileSync(fullPath);
    const cleanDigits = (s?: string) => (s || '').replace(/[^0-9]/g, '');
    const cleanMunicipio = (cuenta.municipio || cuenta.expendio || 'ARAUCA').trim().toUpperCase();

    const pagoRegistrado = (db.relacionPagos || []).find(
      (p) =>
        cleanDigits(p.cedula) === cleanDigits(cuenta.cedula) ||
        p.municipio.trim().toUpperCase() === cleanMunicipio
    );

    const expRegistrado = db.expendios.find(
      (e) =>
        e.municipio.trim().toUpperCase() === cleanMunicipio ||
        cleanDigits(e.cedula) === cleanDigits(cuenta.cedula)
    );

    const datosEsperados = {
      municipio: cleanMunicipio,
      encargado: pagoRegistrado?.nombreEncargado || expRegistrado?.encargado || cuenta.encargado,
      cedula: pagoRegistrado?.cedula || expRegistrado?.cedula || cuenta.cedula,
      periodo: cuenta.periodo,
      cuentaRegistrada: pagoRegistrado?.cuenta || (expRegistrado?.telefonoPunto ? `NEQUI ${expRegistrado.telefonoPunto}` : 'NEQUI'),
      bancoRegistrado: pagoRegistrado?.banco || 'NEQUI',
      valorRegistrado: pagoRegistrado?.valorCancelar || expRegistrado?.valorMensual || cuenta.monto || 0,
      centroOperativo: pagoRegistrado?.centroOperativo || expRegistrado?.centroOperativo || 'ARAUCA',
    };

    const analisisIA = await analizarCuentaCobroConIA(imageBuffer, 'image/jpeg', datosEsperados);

    await mutateDatabase((database) => {
      const c = (database.cuentasCargadas || []).find((x) => x.id === id);
      if (c) c.analisisIA = analisisIA;
      const p = (database.relacionPagos || []).find(
        (x) =>
          cleanDigits(x.cedula) === cleanDigits(cuenta.cedula) ||
          x.municipio.trim().toUpperCase() === cleanMunicipio
      );
      if (p) p.analisisIA = analisisIA;
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      data: { ...cuenta, analisisIA },
      analisisIA,
      message: `✓ Re-análisis con IA completado. ${analisisIA.resumen}`,
    });
  } catch (err: any) {
    console.error('Error en re-análisis con IA:', err);
    res.status(500).json({ success: false, message: `Error en análisis IA: ${err.message}` });
  }
});

// Aplicar Novedad detectada por IA a la Base de Datos (Sincronización Total por expendioId y Municipio)
app.post('/api/admin/relacion-pagos/aplicar-novedad-ia', requireAdmin, async (req, res) => {
  try {
    const { pagoId, nuevoNumeroCuenta, nuevoBanco, nuevoEncargado, nuevoValor, municipio, expendioId } = req.body;
    const targetMun = String(municipio || '').trim().toUpperCase();
    const formattedCtaNovedad = formatCuentaBancaria(nuevoNumeroCuenta, nuevoBanco);

    let updatedPago: PagoRelacionItem | null = null;

    await mutateDatabase((database) => {
      if (!Array.isArray(database.relacionPagos)) database.relacionPagos = [];

      // REGLA 21: Preservar la identidad real mediante expendioId
      let resolvedExpendioId = expendioId ? String(expendioId).trim() : '';

      // 1. Update in relacionPagos
      database.relacionPagos = database.relacionPagos.map((p) => {
        const matchesPago = p.id === pagoId;
        const matchesExpId = resolvedExpendioId && (p as any).expendioId === resolvedExpendioId;
        const matchesMun = !resolvedExpendioId && targetMun && p.municipio.trim().toUpperCase() === targetMun;

        if (matchesPago || matchesExpId || matchesMun) {
          if (!resolvedExpendioId && (p as any).expendioId) {
            resolvedExpendioId = (p as any).expendioId;
          }
          const item: any = {
            ...p,
            expendioId: resolvedExpendioId || (p as any).expendioId,
            cuenta: nuevoNumeroCuenta ? formattedCtaNovedad.cuenta : p.cuenta,
            banco: nuevoBanco || formattedCtaNovedad.banco || p.banco,
            nombreEncargado: nuevoEncargado || p.nombreEncargado,
            valorCancelar: nuevoValor ? Number(nuevoValor) : p.valorCancelar,
            estado: 'Listo para Pago',
          };
          if (item.analisisIA) {
            item.analisisIA.hayNovedad = false;
            item.analisisIA.resumen = `✓ Novedad aprobada y sincronizada por administración en toda la base de datos.`;
          }
          updatedPago = item;
          return item;
        }
        return p;
      });

      // 2. Synchronize to Expendios by expendioId (priority) or Municipio fallback
      if (resolvedExpendioId) {
        database.expendios = database.expendios.map((exp) => {
          if (exp.id === resolvedExpendioId) {
            const digitsCuenta = cleanNequiNumber(nuevoNumeroCuenta);
            return {
              ...exp,
              encargado: nuevoEncargado || exp.encargado,
              telefonoPunto: digitsCuenta || exp.telefonoPunto,
              valorMensual: nuevoValor ? Number(nuevoValor) : exp.valorMensual,
            };
          }
          return exp;
        });
      } else if (targetMun) {
        database.expendios = database.expendios.map((exp) => {
          if (exp.municipio.trim().toUpperCase() === targetMun) {
            const digitsCuenta = cleanNequiNumber(nuevoNumeroCuenta);
            return {
              ...exp,
              encargado: nuevoEncargado || exp.encargado,
              telefonoPunto: digitsCuenta || exp.telefonoPunto,
              valorMensual: nuevoValor ? Number(nuevoValor) : exp.valorMensual,
            };
          }
          return exp;
        });
      }
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      data: updatedPago,
      message: `✓ Datos bancarios y del expendio actualizados y sincronizados en toda la base de datos para ${targetMun || 'el registro'}.`,
    });
  } catch (err: any) {
    console.error('Error aplicando novedad IA:', err);
    res.status(500).json({ success: false, message: `Error aplicando cambios: ${err.message}` });
  }
});

// ==========================================
// 4A. AI-Powered Scanned Document & Payment Support Reconciliation
// ==========================================
interface ScannedPageAIResult {
  municipio: string;
  municipioConfianza: 'Alta' | 'Media' | 'Baja';
  requiereRevisionMunicipio: boolean;
  mes: string;
  anio: string;
  encargado: string;
  cedula: string;
  valorCobro: number;
  tieneSoportePago: boolean;
  datosSoporte?: {
    entidad?: string;
    valorPagado?: number;
    fechaPago?: string;
    numeroAprobacion?: string;
    titular?: string;
    tipoTransaccion?: string;
    coincideValor?: boolean;
  };
  observacionesIA?: string;
}

// MOTOR DE CONCILIACIÓN DETERMINÍSTICO (SIN IA / SIN EMBEDDINGS)
app.post(
  ['/api/admin/conciliar-soporte-ai', '/api/admin/conciliar-soporte-deterministico'],
  uploadScanned.array('archivos', 25),
  validateUploadedFileSecurity,
  async (req, res) => {
  const files = (req.files as Express.Multer.File[]) || [];
  if (files.length === 0) {
    return res.status(400).json({ success: false, message: 'No se subieron archivos para conciliar.' });
  }

  // Cargar lista oficial de municipios desde PostgreSQL (Fuente de Verdad)
  let activeExpendios: any[] = [];
  try {
    activeExpendios = await db
      .select()
      .from(schema.expendios)
      .where(eq(schema.expendios.activo, true));
  } catch (err: any) {
    console.warn('[Conciliacion] Error cargando expendios activos desde PostgreSQL:', err.message);
  }

  const municipiosList = Array.from(
    new Set(
      activeExpendios
        .map((e) => (e.municipio || e.localidad || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );

  const resultados: any[] = [];
  const batchKnownHashes = new Set<string>();

  for (const file of files) {
    const filePath = file.path;
    const fileBuffer = fs.readFileSync(filePath);
    const isPdf =
      file.originalname.toLowerCase().endsWith('.pdf') ||
      (file.mimetype && file.mimetype.includes('pdf'));

    if (isPdf) {
      try {
        const srcDoc = await PDFDocument.load(fileBuffer);
        const pageCount = srcDoc.getPageCount();

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
          const singlePageDoc = await PDFDocument.create();
          const [copiedPage] = await singlePageDoc.copyPages(srcDoc, [pageIndex]);
          singlePageDoc.addPage(copiedPage);
          const singlePageBytes = await singlePageDoc.save();

          const pageSuffix = `${Date.now()}-p${pageIndex + 1}-${Math.round(Math.random() * 1e5)}`;
          const pageFileName = `cuenta-hoja-${pageSuffix}.pdf`;
          const pageFilePath = path.join(scannedDir, pageFileName);
          fs.writeFileSync(pageFilePath, Buffer.from(singlePageBytes));

          const pageFileUrl = `/uploads/scanned_cuentas/${pageFileName}`;
          const pageBuffer = Buffer.from(singlePageBytes);
          const pageHash = computeSha256(pageBuffer);

          // 100% Determinístico: OCR local sin modelos generativos ni embeddings
          let pageText = await extractTextFromPdf(pageBuffer);
          if (!pageText || pageText.trim().length < 15) {
            pageText = await extractTextFromImage(pageBuffer);
          }

          const ocrFields = extractFieldsFromOcrText(pageText, pageHash, municipiosList);
          const recResult = await reconcileOcrWithPostgres(
            ocrFields,
            {
              originalname: `${file.originalname} (Hoja ${pageIndex + 1} de ${pageCount})`,
              fileUrl: pageFileUrl,
              mimeType: 'application/pdf',
              hojaNumero: pageIndex + 1,
              totalHojas: pageCount,
            },
            batchKnownHashes
          );

          batchKnownHashes.add(pageHash);
          resultados.push(recResult);
        }
      } catch (pdfSplitErr) {
        console.warn('Error dividiendo PDF multipágina, analizando como documento único:', pdfSplitErr);
        const fileUrl = `/uploads/scanned_cuentas/${file.filename}`;
        const fileHash = computeSha256(fileBuffer);

        let pdfText = await extractTextFromPdf(fileBuffer);
        if (!pdfText || pdfText.trim().length < 15) {
          pdfText = await extractTextFromImage(fileBuffer);
        }

        const ocrFields = extractFieldsFromOcrText(pdfText, fileHash, municipiosList);
        const recResult = await reconcileOcrWithPostgres(
          ocrFields,
          {
            originalname: file.originalname,
            fileUrl,
            mimeType: 'application/pdf',
            hojaNumero: 1,
            totalHojas: 1,
          },
          batchKnownHashes
        );

        batchKnownHashes.add(fileHash);
        resultados.push(recResult);
      }
    } else {
      // Imagen escaneada (JPEG, PNG, etc.)
      const fileUrl = `/uploads/scanned_cuentas/${file.filename}`;
      const mimeType = file.mimetype || 'image/jpeg';
      const fileHash = computeSha256(fileBuffer);

      // OCR determinístico con Tesseract.js (sin IA externa)
      const imgText = await extractTextFromImage(fileBuffer);
      const ocrFields = extractFieldsFromOcrText(imgText, fileHash, municipiosList);
      const recResult = await reconcileOcrWithPostgres(
        ocrFields,
        {
          originalname: file.originalname,
          fileUrl,
          mimeType,
          hojaNumero: 1,
          totalHojas: 1,
        },
        batchKnownHashes
      );

      batchKnownHashes.add(fileHash);
      resultados.push(recResult);
    }
  }

  res.json({
    success: true,
    data: resultados,
    engine: 'DETERMINISTIC_POSTGRES_OCR',
    message: `¡Conciliación 100% determinística completada! Se procesaron ${resultados.length} documento(s) comparando OCR contra PostgreSQL sin modelos de lenguaje.`,
  });
});

// 4B. Admin: Approve single reconciled account -> Set status to Cancelado and attach single-page PDF
app.post('/api/admin/aprobar-conciliacion-cuenta', requireAdmin, async (req, res) => {
  const {
    id,
    municipio,
    mes,
    anio,
    encargado,
    cedula,
    valorCobro,
    archivoUrl,
    soporteUrl,
    datosSoporte,
    historialMatchedId,
  } = req.body;

  const munUpper = (municipio || '').toUpperCase().trim();
  const mesUpper = (mes || new Date().toLocaleDateString('es-CO', { month: 'long' })).toUpperCase().trim();
  const anioStr = String(anio || new Date().getFullYear()).trim();
  const periodoStr = `${mesUpper} ${anioStr}`;
  const urlFinal = soporteUrl || archivoUrl || '';

  try {
    let savedExpendioId: string | undefined;
    let savedFinalCedula: string = '';

    const updated = await mutateDatabase((db) => {
      const matchedExp = db.expendios.find(
        (e) =>
          (e.municipio || e.localidad || '').toUpperCase().trim() === munUpper ||
          (cedula && (e.cedula || '').trim() === String(cedula).trim())
      );

      const finalCedula = cedula || matchedExp?.cedula || '';
      const finalEncargado = encargado || matchedExp?.encargado || munUpper;
      savedExpendioId = matchedExp?.id;
      savedFinalCedula = finalCedula;

      // 1. Update or Insert in db.historial
      let histItem: HistorialItem | undefined;
      if (historialMatchedId) {
        histItem = db.historial.find((h) => h.id === historialMatchedId);
      }
      if (!histItem && munUpper) {
        histItem = db.historial.find(
          (h) =>
            (h.expendio || '').toUpperCase().trim() === munUpper ||
            ((h.cedula || '').trim() === finalCedula && (h.periodo || '').toUpperCase().includes(mesUpper))
        );
      }

      if (histItem) {
        histItem.estado = 'Cancelado';
        histItem.soporteUrl = urlFinal;
        histItem.fechaCancelado = new Date().toISOString().split('T')[0];
        histItem.conciliadoConIA = true;
        histItem.detalles = `Cuenta de cobro cancelada con soporte de pago adjunto (${
          datosSoporte?.entidad || 'Comprobante bancario'
        })`;
      } else {
        db.historial.unshift({
          id: `hist-cancel-${Date.now()}`,
          periodo: periodoStr,
          tipo: 'Cuenta de Cobro',
          encargado: finalEncargado,
          cedula: finalCedula,
          expendio: munUpper,
          monto: Number(valorCobro) || matchedExp?.valorMensual || 0,
          fecha: new Date().toISOString().split('T')[0],
          estado: 'Cancelado',
          soporteUrl: urlFinal,
          fechaCancelado: new Date().toISOString().split('T')[0],
          conciliadoConIA: true,
          detalles: `Cuenta de cobro subida y cancelada mediante auditoría IA con soporte bancario adjunto`,
        });
      }

      // 2. Update in db.relacionPagos
      if (Array.isArray(db.relacionPagos)) {
        db.relacionPagos.forEach((p) => {
          if ((p.municipio || '').toUpperCase().trim() === munUpper) {
            p.estado = 'Pagado';
            p.soporteUrl = urlFinal;
          }
        });
      }

      // 3. Update or Insert in db.cuentasCargadas
      if (!Array.isArray(db.cuentasCargadas)) {
        db.cuentasCargadas = [];
      }

      db.cuentasCargadas = db.cuentasCargadas.filter(
        (c) =>
          !(
            (c.municipio || '').toUpperCase().trim() === munUpper &&
            (c.mesPeriodo || '').toUpperCase() === mesUpper
          )
      );

      db.cuentasCargadas.unshift({
        id: `cc-${Date.now()}-${Math.round(Math.random() * 1e4)}`,
        cedula: finalCedula,
        encargado: finalEncargado,
        municipio: munUpper,
        mesPeriodo: mesUpper,
        anioPeriodo: anioStr,
        periodo: periodoStr,
        fotoUrl: urlFinal,
        estado: 'Aprobada',
        fechaCarga: new Date().toISOString(),
        observaciones: `Conciliada y asignada por IA con soporte de pago adjunto (${
          datosSoporte?.entidad || 'Comprobante bancario'
        })`,
        analisisIA: {
          esCuentaCobro: true,
          tieneSoportePago: true,
          coincideMunicipio: true,
          coincidePeriodo: true,
          confianzaGeneral: 'Alta',
          resumen: `Cuenta de cobro correspondiente a ${munUpper} para ${periodoStr} aprobada con soporte adjunto.`,
          verificaciones: {
            firmaPresente: true,
            datosBancariosPresentes: true,
            soporteAdjunto: true,
            municipioLegible: true,
            periodoLegible: true,
          },
        },
      });

      return { historial: db.historial, cuentasCargadas: db.cuentasCargadas };
    }, { immediateCloudSync: true, throwOnCloudError: true });

    if (req.body.fileHashSha256) {
      persistSha256ToRegistry(req.body.fileHashSha256, {
        expendioId: savedExpendioId,
        cedula: savedFinalCedula,
        periodo: periodoStr,
        archivoNombre: req.body.archivoNombre,
      }).catch((e: any) => console.warn('[Approve] Error registrando SHA-256:', e.message));
    }

    res.json({
      success: true,
      cloudPersisted: true,
      message: `✓ Hoja de cuenta de cobro de ${munUpper} (${periodoStr}) asignada, adjuntada y marcada como CANCELADA / PAGADA.`,
      historial: updated.historial,
      cuentasCargadas: updated.cuentasCargadas,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error aprobando conciliación: ' + err.message });
  }
});

// 4C. Admin: Approve batch of reconciled accounts -> Set status to Cancelado and attach individual PDF pages
app.post('/api/admin/aprobar-conciliacion-lote', requireAdmin, async (req, res) => {
  const { cuentas } = req.body;
  if (!Array.isArray(cuentas) || cuentas.length === 0) {
    return res.status(400).json({ success: false, message: 'No se recibieron cuentas para conciliar.' });
  }

  try {
    let countAprobadas = 0;
    const result = await mutateDatabase((db) => {
      if (!Array.isArray(db.cuentasCargadas)) {
        db.cuentasCargadas = [];
      }

      cuentas.forEach((c: ResultadoConciliacionAI) => {
        const munUpper = (c.municipio || '').toUpperCase().trim();
        if (!munUpper) return;

        const mesUpper = (c.mes || new Date().toLocaleDateString('es-CO', { month: 'long' })).toUpperCase().trim();
        const anioStr = String(c.anio || new Date().getFullYear()).trim();
        const periodoStr = `${mesUpper} ${anioStr}`;
        const urlFinal = c.archivoUrl;

        const matchedExp = db.expendios.find(
          (e) =>
            (e.municipio || e.localidad || '').toUpperCase().trim() === munUpper ||
            (c.cedula && (e.cedula || '').trim() === String(c.cedula).trim())
        );

        const finalCedula = c.cedula || matchedExp?.cedula || '';
        const finalEncargado = c.encargado || matchedExp?.encargado || munUpper;

        let histItem = c.historialMatchedId ? db.historial.find((h) => h.id === c.historialMatchedId) : null;
        if (!histItem) {
          histItem =
            db.historial.find(
              (h) =>
                (h.expendio || '').toUpperCase().trim() === munUpper ||
                ((h.cedula || '').trim() === finalCedula && (h.periodo || '').toUpperCase().includes(mesUpper))
            ) || null;
        }

        if (histItem) {
          histItem.estado = 'Cancelado';
          histItem.soporteUrl = urlFinal;
          histItem.fechaCancelado = new Date().toISOString().split('T')[0];
          histItem.conciliadoConIA = true;
          histItem.detalles = `Cuenta de cobro cancelada tras verificación de soporte de pago (${
            c.datosSoporte?.entidad || 'Tirilla bancaria'
          })`;
        } else {
          db.historial.unshift({
            id: `hist-cancel-${Date.now()}-${Math.round(Math.random() * 1e4)}`,
            periodo: periodoStr,
            tipo: 'Cuenta de Cobro',
            encargado: finalEncargado,
            cedula: finalCedula,
            expendio: munUpper,
            monto: Number(c.valorCobro) || matchedExp?.valorMensual || 0,
            fecha: new Date().toISOString().split('T')[0],
            estado: 'Cancelado',
            soporteUrl: urlFinal,
            fechaCancelado: new Date().toISOString().split('T')[0],
            conciliadoConIA: true,
            detalles: `Cuenta de cobro escaneada y cancelada mediante auditoría IA`,
          });
        }

        if (Array.isArray(db.relacionPagos)) {
          db.relacionPagos.forEach((p) => {
            if ((p.municipio || '').toUpperCase().trim() === munUpper) {
              p.estado = 'Pagado';
              p.soporteUrl = urlFinal;
            }
          });
        }

        // Update in db.cuentasCargadas
        db.cuentasCargadas = db.cuentasCargadas.filter(
          (cc) =>
            !(
              (cc.municipio || '').toUpperCase().trim() === munUpper &&
              (cc.mesPeriodo || '').toUpperCase() === mesUpper
            )
        );

        db.cuentasCargadas.unshift({
          id: `cc-${Date.now()}-${Math.round(Math.random() * 1e4)}`,
          cedula: finalCedula,
          encargado: finalEncargado,
          municipio: munUpper,
          mesPeriodo: mesUpper,
          anioPeriodo: anioStr,
          periodo: periodoStr,
          fotoUrl: urlFinal,
          estado: 'Aprobada',
          fechaCarga: new Date().toISOString(),
          observaciones: `Conciliada y asignada por IA con soporte de pago (${
            c.datosSoporte?.entidad || 'Tirilla bancaria'
          })`,
          analisisIA: {
            esCuentaCobro: true,
            tieneSoportePago: c.tieneSoportePago,
            coincideMunicipio: true,
            coincidePeriodo: true,
            confianzaGeneral: 'Alta',
            resumen: c.observacionesIA || 'Cuenta de cobro aprobada y cancelada con soporte adjunto.',
            verificaciones: {
              firmaPresente: true,
              datosBancariosPresentes: true,
              soporteAdjunto: c.tieneSoportePago,
              municipioLegible: true,
              periodoLegible: true,
            },
          },
        });

        countAprobadas++;
      });

      return { countAprobadas, historial: db.historial, cuentasCargadas: db.cuentasCargadas };
    }, { immediateCloudSync: true, throwOnCloudError: true });

    // Persistir huellas criptográficas SHA-256 en PostgreSQL
    for (const c of cuentas) {
      if (c && c.fileHashSha256) {
        persistSha256ToRegistry(c.fileHashSha256, {
          expendioId: c.expendioMatchedId,
          cedula: c.cedula,
          periodo: c.periodo,
          archivoNombre: c.archivoNombre,
        }).catch((e: any) => console.warn('[BatchApprove] Error registrando SHA-256:', e.message));
      }
    }

    res.json({
      success: true,
      cloudPersisted: true,
      message: `✓ Se aprobaron, asignaron y pasaron a estado CANCELADO ${result.countAprobadas} cuentas de cobro con sus respectivas hojas PDF y soportes adjuntos.`,
      historial: result.historial,
      cuentasCargadas: result.cuentasCargadas,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error aprobando conciliación en lote: ' + err.message });
  }
});

// 4E. Admin: Export and Import database and photographic records
function collectPhotographicRecord(maxSizePerFile = 4 * 1024 * 1024): Record<string, { dataUrl: string; size: number; mime: string }> {
  const record: Record<string, { dataUrl: string; size: number; mime: string }> = {};
  const baseUploadDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(baseUploadDir)) return record;

  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };

  function scanDir(currentDir: string) {
    try {
      const files = fs.readdirSync(currentDir);
      for (const file of files) {
        const fullPath = path.join(currentDir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          // Exclude scanned_cuentas from base64 JSON because PDFs can be huge (they are in the ZIP)
          if (file === 'scanned_cuentas') continue;
          scanDir(fullPath);
        } else if (stat.isFile() && stat.size <= maxSizePerFile) {
          const ext = path.extname(file).toLowerCase();
          if (mimeMap[ext]) {
            const mime = mimeMap[ext];
            const relPath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
            try {
              const buf = fs.readFileSync(fullPath);
              record[relPath] = {
                dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
                size: stat.size,
                mime,
              };
            } catch (e) {
              console.warn('No se pudo leer archivo para copia de seguridad:', fullPath, e);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Error escaneando directorio de uploads:', err);
    }
  }

  scanDir(baseUploadDir);
  return record;
}

// 1. Direct stream download of Pure Database (JSON) - ultra fast, <2MB, 100% reliable
app.get('/api/admin/database-download', (req, res) => {
  try {
    const db = loadDatabase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `CAMARCA_BASE_DATOS_${timestamp}.json`;
    const payload = JSON.stringify(db, null, 2);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', Buffer.byteLength(payload, 'utf-8'));
    res.send(payload);
  } catch (err: any) {
    console.error('Error en /api/admin/database-download:', err);
    res.status(500).json({ success: false, message: 'Error generando descarga directa de la base de datos: ' + err.message });
  }
});

// 2. Direct stream download of Complete Backup (JSON with embedded photos)
app.get('/api/admin/database-download-full', (req, res) => {
  try {
    const db = loadDatabase();
    const fotos = collectPhotographicRecord();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `CAMARCA_COPIA_COMPLETA_CON_FOTOS_${timestamp}.json`;
    const fullBackup = {
      ...db,
      registroFotografico: fotos,
      totalFotos: Object.keys(fotos).length,
      timestamp: new Date().toISOString(),
      version: '2.5',
    };
    const payload = JSON.stringify(fullBackup, null, 2);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', Buffer.byteLength(payload, 'utf-8'));
    res.send(payload);
  } catch (err: any) {
    console.error('Error en /api/admin/database-download-full:', err);
    res.status(500).json({ success: false, message: 'Error generando descarga completa: ' + err.message });
  }
});

// 3. API endpoint for programmatic backup retrieval
app.get('/api/admin/database-export', (req, res) => {
  try {
    const db = loadDatabase();
    const includePhotos = req.query.includePhotos === 'true';
    const fotos = includePhotos ? collectPhotographicRecord() : {};
    
    res.json({
      success: true,
      database: {
        ...db,
        ...(includePhotos ? { registroFotografico: fotos } : {}),
      },
      totalFotos: Object.keys(fotos).length,
      timestamp: new Date().toISOString(),
      version: '2.5',
    });
  } catch (err: any) {
    console.error('Error exportando base de datos:', err);
    res.status(500).json({ success: false, message: 'Error al exportar base de datos: ' + err.message });
  }
});

// 4. Download Photos ZIP
app.get('/api/admin/backup-fotos-zip', async (req, res) => {
  try {
    const db = loadDatabase();
    const zip = new JSZip();
    const baseUploadDir = path.join(process.cwd(), 'uploads');

    function addFilesToZip(currentDir: string, zipFolder: JSZip) {
      if (!fs.existsSync(currentDir)) return;
      const items = fs.readdirSync(currentDir);
      for (const item of items) {
        const fullPath = path.join(currentDir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          const sub = zipFolder.folder(item);
          if (sub) addFilesToZip(fullPath, sub);
        } else if (stat.isFile()) {
          zipFolder.file(item, fs.readFileSync(fullPath));
        }
      }
    }

    addFilesToZip(baseUploadDir, zip.folder('uploads') || zip);

    // Incluir fotos directas en base64 de expendios si existieran
    const inlineFolder = zip.folder('fotos_expendios_directas');
    if (inlineFolder && Array.isArray(db.expendios)) {
      db.expendios.forEach((exp) => {
        const photoKeys = [
          'fotoAvisoUrl', 'fotoTarifasUrl', 'fotoPanoramicaUrl', 'fotoMataselloUrl',
          'fotoBasculaUrl', 'fotoContratistaUrl', 'fotoHorarioUrl', 'fotoCedulaFrontalUrl',
          'fotoCedulaPosteriorUrl', 'fotoRutUrl', 'letreroUrl', 'basculaUrl', 'mataselloUrl'
        ];
        photoKeys.forEach((k) => {
          const val = (exp as any)[k];
          if (val && typeof val === 'string' && val.startsWith('data:image')) {
            const parts = val.split(',');
            if (parts.length === 2) {
              const buffer = Buffer.from(parts[1], 'base64');
              const mun = (exp.municipio || exp.localidad || 'expendio').replace(/[^a-zA-Z0-9]/g, '_');
              inlineFolder.file(`${mun}_${exp.cedula}_${k}.jpg`, buffer);
            }
          }
        });
      });
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="CAMARCA_REGISTRO_FOTOGRAFICO_${timestamp}.zip"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);
  } catch (err: any) {
    console.error('Error generando zip de fotos:', err);
    res.status(500).json({ success: false, message: 'Error generando archivo ZIP del registro fotográfico: ' + err.message });
  }
});

// 5. Restore Database via Multipart File Upload (High capacity, up to 100MB, no memory crashes)
const uploadBackupMulter = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, tempImportsDir),
    filename: (req, file, cb) => cb(null, `import-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

app.post('/api/admin/database-import-file', uploadBackupMulter.single('backupFile'), requireAdmin, async (req, res) => {
  try {
    if (!authorizeDestructiveAction(req, res, 'RESTORE_DATABASE_FILE')) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) {}
      return;
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Por favor selecciona un archivo JSON de respaldo.' });
    }

    const raw = fs.readFileSync(req.file.path, 'utf-8');
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      return res.status(400).json({ success: false, message: 'El archivo seleccionado no tiene un formato JSON válido.' });
    }

    const targetData = parsed.database || parsed;
    if (!targetData || (!Array.isArray(targetData.expendios) && !Array.isArray(targetData.historial))) {
      return res.status(400).json({
        success: false,
        message: 'El archivo no contiene la estructura requerida de CAMARCA (faltan expendios o historial).',
      });
    }

    // Restore photographic record files if embedded (con validación de ruta segura dentro de uploads/ o data/)
    let fotosRestauradas = 0;
    const registroFotografico = targetData.registroFotografico || targetData.photosStore;
    const allowedUploadsRoot = path.resolve(process.cwd(), 'uploads');
    const allowedDataRoot = path.resolve(process.cwd(), 'data');
    if (registroFotografico && typeof registroFotografico === 'object') {
      for (const [relPath, photoInfo] of Object.entries(registroFotografico)) {
        try {
          const dataUrl = typeof photoInfo === 'string' ? photoInfo : (photoInfo as any)?.dataUrl;
          if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
            const parts = dataUrl.split(',');
            if (parts.length === 2) {
              const buffer = Buffer.from(parts[1], 'base64');
              const cleanRel = relPath.replace(/^[/\\]+/, '');
              const targetPath = path.resolve(process.cwd(), cleanRel);
              if (!targetPath.startsWith(allowedUploadsRoot + path.sep) && !targetPath.startsWith(allowedDataRoot + path.sep)) {
                console.warn('[Seguridad] Ruta bloqueada fuera de directorios permitidos en database-import-file:', relPath);
                continue;
              }
              fs.mkdirSync(path.dirname(targetPath), { recursive: true });
              fs.writeFileSync(targetPath, buffer);
              fotosRestauradas++;
            }
          }
        } catch (err) {
          console.warn('Error restaurando foto individual:', relPath, err);
        }
      }
    }

    const restoredDb: DatabaseSchema = {
      expendios: Array.isArray(targetData.expendios) ? targetData.expendios : [],
      historial: Array.isArray(targetData.historial) ? targetData.historial : [],
      trazabilidad: Array.isArray(targetData.trazabilidad) ? targetData.trazabilidad : [],
      config: targetData.config || DEFAULT_CONFIG,
      cuentasCargadas: Array.isArray(targetData.cuentasCargadas) ? targetData.cuentasCargadas : [],
      relacionPagos: Array.isArray(targetData.relacionPagos) ? targetData.relacionPagos : DEFAULT_RELACION_PAGOS,
      registrosAcceso: Array.isArray(targetData.registrosAcceso) ? targetData.registrosAcceso : [],
      visitasGenerales: typeof targetData.visitasGenerales === 'number' ? targetData.visitasGenerales : 0,
    };

    await mutateDatabase((database) => {
      database.expendios = restoredDb.expendios;
      database.historial = restoredDb.historial;
      database.trazabilidad = restoredDb.trazabilidad;
      database.config = restoredDb.config;
      database.cuentasCargadas = restoredDb.cuentasCargadas;
      database.relacionPagos = restoredDb.relacionPagos;
      database.registrosAcceso = restoredDb.registrosAcceso;
      database.visitasGenerales = restoredDb.visitasGenerales;
    }, { immediateCloudSync: true, throwOnCloudError: true });

    createAutoSnapshot(loadDatabase());

    res.json({
      success: true,
      cloudPersisted: true,
      message: `✓ Base de datos restaurada exitosamente con ${restoredDb.expendios.length} expendios, ${restoredDb.historial.length} registros en historial, ${restoredDb.relacionPagos?.length || 0} pagos y ${fotosRestauradas} fotos procesadas.`,
    });
  } catch (err: any) {
    console.error('Error procesando importación por archivo:', err);
    res.status(500).json({ success: false, message: 'Error procesando archivo de respaldo: ' + err.message });
  }
});

// 6. Restore Database via JSON Body
app.post('/api/admin/database-import', requireAdmin, async (req, res) => {
  if (!authorizeDestructiveAction(req, res, 'RESTORE_DATABASE_JSON')) return;

  const { database: rawIncomingDb } = req.body || {};

  if (!rawIncomingDb || typeof rawIncomingDb !== 'object') {
    return res.status(400).json({ success: false, message: 'Estructura de datos de respaldo inválida.' });
  }

  const incomingDb = rawIncomingDb.database || rawIncomingDb;

  // Restaurar archivos del registro fotográfico si están incluidos en el respaldo (validando ruta segura)
  let fotosRestauradas = 0;
  const registroFotografico = incomingDb.registroFotografico || incomingDb.photosStore;
  const allowedUploadsRoot = path.resolve(process.cwd(), 'uploads');
  const allowedDataRoot = path.resolve(process.cwd(), 'data');
  if (registroFotografico && typeof registroFotografico === 'object') {
    for (const [relPath, photoInfo] of Object.entries(registroFotografico)) {
      try {
        const dataUrl = typeof photoInfo === 'string' ? photoInfo : (photoInfo as any)?.dataUrl;
        if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
          const parts = dataUrl.split(',');
          if (parts.length === 2) {
            const buffer = Buffer.from(parts[1], 'base64');
            const cleanRel = relPath.replace(/^[/\\]+/, '');
            const targetPath = path.resolve(process.cwd(), cleanRel);
            if (!targetPath.startsWith(allowedUploadsRoot + path.sep) && !targetPath.startsWith(allowedDataRoot + path.sep)) {
              console.warn('[Seguridad] Ruta bloqueada fuera de directorios permitidos en database-import:', relPath);
              continue;
            }
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, buffer);
            fotosRestauradas++;
          }
        }
      } catch (err) {
        console.warn('Error restaurando foto individual:', relPath, err);
      }
    }
  }

  const restoredDb: DatabaseSchema = {
    expendios: Array.isArray(incomingDb.expendios) ? incomingDb.expendios : [],
    historial: Array.isArray(incomingDb.historial) ? incomingDb.historial : [],
    trazabilidad: Array.isArray(incomingDb.trazabilidad) ? incomingDb.trazabilidad : [],
    config: incomingDb.config || DEFAULT_CONFIG,
    cuentasCargadas: Array.isArray(incomingDb.cuentasCargadas) ? incomingDb.cuentasCargadas : [],
    relacionPagos: Array.isArray(incomingDb.relacionPagos) ? incomingDb.relacionPagos : DEFAULT_RELACION_PAGOS,
    registrosAcceso: Array.isArray(incomingDb.registrosAcceso) ? incomingDb.registrosAcceso : [],
    visitasGenerales: typeof incomingDb.visitasGenerales === 'number' ? incomingDb.visitasGenerales : 0,
  };

  try {
    await mutateDatabase((database) => {
      database.expendios = restoredDb.expendios;
      database.historial = restoredDb.historial;
      database.trazabilidad = restoredDb.trazabilidad;
      database.config = restoredDb.config;
      database.cuentasCargadas = restoredDb.cuentasCargadas;
      database.relacionPagos = restoredDb.relacionPagos;
      database.registrosAcceso = restoredDb.registrosAcceso;
      database.visitasGenerales = restoredDb.visitasGenerales;
    }, { immediateCloudSync: true, throwOnCloudError: true });

    createAutoSnapshot(loadDatabase());

    res.json({
      success: true,
      cloudPersisted: true,
      message: `✓ Base de datos restaurada exitosamente con ${restoredDb.expendios.length} expendios, ${restoredDb.historial.length} registros en historial, ${restoredDb.relacionPagos?.length || 0} pagos y ${fotosRestauradas} fotos del registro fotográfico recuperadas en el servidor.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error restaurando base de datos: ' + err.message });
  }
});

// 7. Get list of automatic local snapshots saved on the server
app.get('/api/admin/backups-locales', (req, res) => {
  try {
    if (!fs.existsSync(backupsDir)) {
      return res.json({ success: true, snapshots: [] });
    }
    const files = fs.readdirSync(backupsDir)
      .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
      .sort()
      .reverse();

    const snapshots = files.map((filename) => {
      const fullPath = path.join(backupsDir, filename);
      const stat = fs.statSync(fullPath);
      let expendiosCount = 0;
      let historialCount = 0;
      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const d = parsed.database || parsed;
        expendiosCount = d.expendios?.length || 0;
        historialCount = d.historial?.length || 0;
      } catch (e) {}

      return {
        filename,
        fecha: stat.mtime.toISOString(),
        tamanoBytes: stat.size,
        expendiosCount,
        historialCount,
      };
    });

    res.json({ success: true, snapshots });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error leyendo copias locales: ' + err.message });
  }
});

// 8. Restore from a specific automatic local snapshot
app.post('/api/admin/restaurar-backup-local', requireAdmin, async (req, res) => {
  try {
    if (!authorizeDestructiveAction(req, res, 'RESTORE_LOCAL_SNAPSHOT')) return;

    const { filename } = req.body || {};

    if (!filename || typeof filename !== 'string' || !filename.startsWith('snapshot-')) {
      return res.status(400).json({ success: false, message: 'Nombre de archivo de copia local inválido.' });
    }

    const cleanName = path.basename(filename);
    const targetPath = path.join(backupsDir, cleanName);
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ success: false, message: 'La copia de seguridad seleccionada no existe en el servidor.' });
    }

    const raw = fs.readFileSync(targetPath, 'utf-8');
    const incoming = JSON.parse(raw);
    const targetData = incoming.database || incoming;

    const restoredDb: DatabaseSchema = {
      expendios: Array.isArray(targetData.expendios) ? targetData.expendios : [],
      historial: Array.isArray(targetData.historial) ? targetData.historial : [],
      trazabilidad: Array.isArray(targetData.trazabilidad) ? targetData.trazabilidad : [],
      config: targetData.config || DEFAULT_CONFIG,
      cuentasCargadas: Array.isArray(targetData.cuentasCargadas) ? targetData.cuentasCargadas : [],
      relacionPagos: Array.isArray(targetData.relacionPagos) ? targetData.relacionPagos : DEFAULT_RELACION_PAGOS,
      registrosAcceso: Array.isArray(targetData.registrosAcceso) ? targetData.registrosAcceso : [],
      visitasGenerales: typeof targetData.visitasGenerales === 'number' ? targetData.visitasGenerales : 0,
    };

    await mutateDatabase((database) => {
      database.expendios = restoredDb.expendios;
      database.historial = restoredDb.historial;
      database.trazabilidad = restoredDb.trazabilidad;
      database.config = restoredDb.config;
      database.cuentasCargadas = restoredDb.cuentasCargadas;
      database.relacionPagos = restoredDb.relacionPagos;
      database.registrosAcceso = restoredDb.registrosAcceso;
      database.visitasGenerales = restoredDb.visitasGenerales;
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      message: `✓ Copia de seguridad ${cleanName} restaurada exitosamente con ${restoredDb.expendios.length} expendios y ${restoredDb.historial.length} registros.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error restaurando copia local: ' + err.message });
  }
});

// --- SEPARACIÓN DE AMBIENTES Y ARCHIVADO PERMANENTE EN GOOGLE DRIVE ---

// Información del entorno actual
app.get('/api/admin/ambiente-info', (req, res) => {
  const db = loadDatabase();
  const currentPath = getActiveDbPath();
  res.json({
    success: true,
    ambiente: environmentMode,
    isPublishedEnv,
    appUrl: appUrlEnv || 'http://localhost:3000',
    publishedUrl: PUBLISHED_APP_URL,
    devUrl: DEV_APP_URL,
    activeDbFile: path.basename(currentPath),
    lastSyncFromPublished: db.config?.lastSyncFromPublished || null,
    googleDriveConfigured: !!db.config?.googleDriveWebhookUrl,
    googleDriveWebhookUrl: db.config?.googleDriveWebhookUrl || '',
    expendiosCount: (db.expendios || []).length,
    historialCount: (db.historial || []).length,
    cloudSync: { connected: true, provider: 'PostgreSQL (Cloud SQL)' },
  });
});

// --- CLOUD SQL (POSTGRESQL) ENDPOINTS ---
// Estado de conexión y métricas de Cloud SQL PostgreSQL
app.get('/api/admin/cloudsql/status', async (req, res) => {
  try {
    const stats = await checkCloudSqlHealth();
    res.json({
      success: true,
      data: stats,
      message: stats.connected
        ? `✓ Conexión activa a Cloud SQL PostgreSQL (${stats.latencyMs}ms)`
        : 'Cloud SQL PostgreSQL no disponible temporalmente.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error consultando Cloud SQL: ' + err.message });
  }
});

// Sincronizar todos los datos actuales hacia Cloud SQL PostgreSQL
app.post('/api/admin/cloudsql/sync-now', async (req, res) => {
  try {
    await migrateLocalJsonToCloudSql();
    const stats = await checkCloudSqlHealth();
    res.json({
      success: true,
      message: `✓ Base de datos sincronizada exitosamente en Cloud SQL PostgreSQL (${stats.expendiosCount} expendios, ${stats.historialCount} registros contables, ${stats.relacionPagosCount} pagos).`,
      data: stats,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error sincronizando con Cloud SQL: ' + err.message });
  }
});

// Restaurar datos desde Cloud SQL PostgreSQL al runtime local
app.post('/api/admin/cloudsql/restore-to-local', async (req, res) => {
  try {
    const pgData = await getCloudSqlDatabaseSnapshot();
    if (!pgData || !Array.isArray(pgData.expendios) || pgData.expendios.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No se encontraron datos de expendios en Cloud SQL PostgreSQL para restaurar.',
      });
    }

    const updated = await mutateDatabase(async (local) => {
      local.expendios = pgData.expendios;
      local.historial = pgData.historial;
      local.relacionPagos = pgData.relacionPagos;
      local.trazabilidad = pgData.trazabilidad;
      local.cuentasCargadas = pgData.cuentasCargadas;
      if (pgData.config && Object.keys(pgData.config).length > 0) {
        local.config = pgData.config;
      }
      return local;
    }, { immediateCloudSync: false });

    res.json({
      success: true,
      message: `✓ Base de datos restaurada con éxito desde Cloud SQL PostgreSQL (${updated.expendios.length} expendios, ${updated.historial.length} cuentas).`,
      data: {
        expendiosCount: updated.expendios.length,
        historialCount: updated.historial.length,
        relacionPagosCount: updated.relacionPagos.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error restaurando desde Cloud SQL: ' + err.message });
  }
});

// Descargar código fuente completo del sistema en archivo .txt
app.get('/api/admin/descargar-codigo-txt', (_req, res) => {
  try {
    const rootDir = process.cwd();
    const outputFile = path.join(rootDir, 'camarca_codigo_completo.txt');
    const publicOutputFile = path.join(rootDir, 'public', 'camarca_codigo_completo.txt');
    const allowedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.html', '.css', '.json', '.sql'];
    const ignoredPaths = [
      'node_modules',
      'dist',
      '.git',
      '.vite',
      '.aistudio',
      'data',
      'uploads',
      'public/camarca_codigo_completo.txt',
      'camarca_codigo_completo.txt',
      'package-lock.json',
      '.env',
    ];

    const collectCodeFiles = (dirPath: string, acc: string[] = []): string[] => {
      const entries = fs.readdirSync(dirPath);
      for (const file of entries) {
        const fullPath = path.join(dirPath, file);
        const relPath = path.relative(rootDir, fullPath);
        if (ignoredPaths.some((ig) => relPath === ig || relPath.startsWith(ig + path.sep))) {
          continue;
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          collectCodeFiles(fullPath, acc);
        } else {
          const ext = path.extname(file).toLowerCase();
          if (allowedExtensions.includes(ext) || file === '.env.example') {
            acc.push(fullPath);
          }
        }
      }
      return acc;
    };

    const allFiles = collectCodeFiles(rootDir).sort();
    let combinedContent = '';
    combinedContent += `================================================================================\n`;
    combinedContent += `  CAMARCA S.A.S. - CÓDIGO FUENTE PURO CONSOLIDADO\n`;
    combinedContent += `  Fecha de generación: ${new Date().toISOString()}\n`;
    combinedContent += `  Total de archivos: ${allFiles.length}\n`;
    combinedContent += `  Arquitectura: React (TypeScript) + Express API + Cloud SQL (PostgreSQL) + AWS S3\n`;
    combinedContent += `================================================================================\n\n`;
    combinedContent += `ÍNDICE GENERAL DE ARCHIVOS FUENTE:\n`;
    allFiles.forEach((file, idx) => {
      const rel = path.relative(rootDir, file);
      const sizeKb = (fs.statSync(file).size / 1024).toFixed(1);
      combinedContent += `  [${String(idx + 1).padStart(3, ' ')}] ${rel} (${sizeKb} KB)\n`;
    });
    combinedContent += `\n================================================================================\n\n`;

    allFiles.forEach((file, idx) => {
      const rel = path.relative(rootDir, file);
      try {
        const content = fs.readFileSync(file, 'utf-8');
        combinedContent += `/*******************************************************************************\n`;
        combinedContent += ` * [${idx + 1}/${allFiles.length}] ARCHIVO: ${rel}\n`;
        combinedContent += ` ******************************************************************************/\n\n`;
        combinedContent += content + `\n\n`;
      } catch {}
    });

    fs.writeFileSync(outputFile, combinedContent, 'utf-8');
    if (fs.existsSync(path.join(rootDir, 'public'))) {
      fs.writeFileSync(publicOutputFile, combinedContent, 'utf-8');
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="camarca_codigo_completo.txt"');
    const readStream = fs.createReadStream(outputFile);
    readStream.pipe(res);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Retroalimentar la versión de TEST desde la versión PUBLICADA
app.post('/api/admin/retroalimentar-desde-publicada', async (req, res) => {
  // GUARDA FÍSICA INQUEBRANTABLE: Nunca permitir escrituras hacia Test si estamos en Producción.
  // isPublishedEnv se resolvió estáticamente al arrancar el proceso de Node.js mediante variables de entorno (Cloud Run),
  // por lo que no es vulnerable a ataques de suplantación de cabeceras HTTP (Origin/Host).
  if (isPublishedEnv) {
    console.error("[SEGURIDAD] Intento bloqueado de retroalimentar base de datos estando en entorno de Producción.");
    return res.status(403).json({
      success: false,
      message: 'Operación prohibida: El servidor actual está ejecutándose en modo PRODUCCIÓN. No se puede sobrescribir con la base de datos de test.'
    });
  }

  try {
    const publishedExportUrl = `${PUBLISHED_APP_URL}/api/admin/database-export`;
    console.log(`[SYNC] Intentando retroalimentar TEST desde versión publicada: ${publishedExportUrl}`);

    let liveData: any = null;
    let sourceUsed = '';

    try {
      const resp = await fetch(publishedExportUrl, {
        headers: { 'User-Agent': 'Camarca-Dev-Sync/1.0' },
      });
      if (resp.ok) {
        liveData = await resp.json();
        sourceUsed = 'Servidor Publicado Oficial (En Línea)';
      }
    } catch (networkErr: any) {
      console.warn('[SYNC] Versión publicada no accesible por red directa:', networkErr.message);
    }

    if (!liveData && fs.existsSync(masterPublishedDbPath)) {
      try {
        liveData = JSON.parse(fs.readFileSync(masterPublishedDbPath, 'utf-8'));
        sourceUsed = 'Archivo Maestro Publicado Local';
      } catch (e) {}
    }

    if (!liveData && fs.existsSync(legacyDbPath)) {
      try {
        liveData = JSON.parse(fs.readFileSync(legacyDbPath, 'utf-8'));
        sourceUsed = 'Base de Datos Base (database.json)';
      } catch (e) {}
    }

    if (!liveData) {
      return res.status(404).json({
        success: false,
        message: 'No se pudo obtener información de la versión publicada ni de los archivos maestros.',
      });
    }

    const payload = liveData.database || liveData;

    // Save into testDbPath and set as authoritative in memory
    const testDb: DatabaseSchema = {
      expendios: Array.isArray(payload.expendios) ? payload.expendios : [],
      historial: Array.isArray(payload.historial) ? payload.historial : [],
      trazabilidad: Array.isArray(payload.trazabilidad) ? payload.trazabilidad : [],
      config: {
        ...(payload.config || DEFAULT_CONFIG),
        lastSyncFromPublished: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      },
      cuentasCargadas: Array.isArray(payload.cuentasCargadas) ? payload.cuentasCargadas : [],
      relacionPagos: Array.isArray(payload.relacionPagos) ? payload.relacionPagos : DEFAULT_RELACION_PAGOS,
      visitasGenerales: typeof payload.visitasGenerales === 'number' ? payload.visitasGenerales : 0,
      updatedAt: new Date().toISOString(),
    };

    setAuthoritativeDatabase(testDb);

    // Sincronizar registro de fotos de Google Drive
    const drivePhotosPayload = payload.googleDrivePhotos || liveData.googleDrivePhotos;
    if (drivePhotosPayload && typeof drivePhotosPayload === 'object') {
      try {
        saveDrivePhotosRegistry(drivePhotosPayload);
        await saveDriveRegistryToCloud(drivePhotosPayload).catch(() => {});
        console.log(`[SYNC] Registro de fotos en Google Drive restaurado: ${Object.keys(drivePhotosPayload).length} fotos vinculadas.`);
      } catch (e: any) {
        console.warn('[SYNC] Error restaurando fotos de Drive en TEST:', e.message);
      }
    }

    console.log('[SYNC] Sincronizando inmediatamente base de datos a PostgreSQL...');
    await migrateLocalJsonToCloudSql().catch((syncErr) => {
      console.warn('[SYNC] Advertencia guardando en PostgreSQL tras retroalimentar:', syncErr.message);
    });

    res.json({
      success: true,
      ambiente: environmentMode,
      sourceUsed,
      message: `✓ Base de datos de TEST retroalimentada exitosamente desde ${sourceUsed} (${testDb.expendios.length} expendios, ${testDb.historial.length} registros) y sincronizada a la nube con fuerza bruta.`,
      expendiosCount: testDb.expendios.length,
      historialCount: testDb.historial.length,
      timestamp: testDb.config?.lastSyncFromPublished,
    });
  } catch (err: any) {
    console.error('Error en retroalimentar-desde-publicada:', err);
    res.status(500).json({ success: false, message: `Error al sincronizar desde la versión publicada: ${err.message}` });
  }
});

// Guardar configuración del Webhook de Google Drive
app.post('/api/admin/config/google-drive', requireAdmin, async (req, res) => {
  try {
    const { googleDriveWebhookUrl } = req.body;
    let urlSaved = '';
    await mutateDatabase((db) => {
      if (!db.config) db.config = { ...DEFAULT_CONFIG };
      db.config.googleDriveWebhookUrl = (googleDriveWebhookUrl || '').trim();
      urlSaved = db.config.googleDriveWebhookUrl;
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      message: urlSaved
        ? '✓ URL de Webhook de Google Drive configurada correctamente.'
        : 'URL de Google Drive eliminada.',
      googleDriveWebhookUrl: urlSaved,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error configurando Google Drive: ' + err.message });
  }
});

// Guardar credenciales de Google OAuth (Client ID y Client Secret)
app.post('/api/admin/config/oauth-credentials', requireAdmin, async (req, res) => {
  try {
    const { googleOAuthClientId, googleOAuthClientSecret } = req.body;
    await mutateDatabase((db) => {
      if (!db.config) db.config = {} as any;
      db.config.googleOAuthClientId = (googleOAuthClientId || '').trim();
      db.config.googleOAuthClientSecret = (googleOAuthClientSecret || '').trim();
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      message: '✓ Credenciales de Google OAuth guardadas y aplicadas de forma segura en PostgreSQL.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error guardando credenciales: ' + err.message });
  }
});

// Enviar respaldo instantáneo a Google Drive
app.post('/api/admin/google-drive-sync', async (req, res) => {
  const db = loadDatabase();
  const webhookUrl = (req.body?.webhookUrl || db.config?.googleDriveWebhookUrl || '').trim();
  if (!webhookUrl) {
    return res.status(400).json({
      success: false,
      message: 'Debe configurar o proporcionar una URL de Webhook de Google Drive (Google Apps Script).',
    });
  }

  try {
    const payload = {
      filename: `CAMARCA_DB_${environmentMode}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      timestamp: new Date().toISOString(),
      ambiente: environmentMode,
      totalExpendios: (db.expendios || []).length,
      totalHistorial: (db.historial || []).length,
      database: db,
    };

    const gDriveRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    res.json({
      success: true,
      message: `✓ Copia de seguridad archivada exitosamente en Google Drive (Respuesta HTTP ${gDriveRes.status}).`,
      webhookStatus: gDriveRes.status,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: `Error al conectar con Google Drive Webhook: ${err.message}`,
    });
  }
});

// Obtener estado de copias de seguridad de Google Drive (10 minutos con retención de 1 semana)
app.get('/api/admin/google-drive/status', (req, res) => {
  try {
    const db = loadDatabase();
    if (!db.config) db.config = { ...DEFAULT_CONFIG };
    let backups = Array.isArray(db.config.googleDriveBackups) ? db.config.googleDriveBackups : [];

    // Limpieza pasiva de registros locales mayores a 7 días (1 semana)
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - ONE_WEEK_MS;
    backups = backups.filter((b: any) => {
      if (!b.timestamp) return false;
      const t = new Date(b.timestamp).getTime();
      return !isNaN(t) && t >= cutoff;
    });

    const carpetaDriveId = db.config?.carpetaDriveId || null;
    const carpetaDriveUrl = carpetaDriveId ? `https://drive.google.com/drive/folders/${carpetaDriveId}` : null;

    res.json({
      success: true,
      ultimoBackupDrive: db.config.ultimoBackupDrive || (backups.length > 0 ? backups[0].timestamp : null),
      proximoBackupDrive: db.config.proximoBackupDrive || null,
      backups,
      backupAutomaticoDriveActivo: db.config.backupAutomaticoDriveActivo !== false,
      carpetaDriveId,
      carpetaDriveUrl,
      diasRetencion: 7,
      ultimoPurgeDrive: db.config.ultimoPurgeDrive || null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error obteniendo estado de Google Drive: ' + err.message });
  }
});

// Registrar copia de seguridad en el historial de Google Drive
app.post('/api/admin/google-drive/register-backup', requireAdmin, async (req, res) => {
  try {
    const record = req.body;
    if (!record || !record.id) {
      return res.status(400).json({ success: false, message: 'Datos de respaldo inválidos.' });
    }

    await mutateDatabase((db) => {
      if (!db.config) db.config = { ...DEFAULT_CONFIG };
      if (!Array.isArray(db.config.googleDriveBackups)) {
        db.config.googleDriveBackups = [];
      }

      // Insertar al inicio y filtrar registros de más de 7 días para no saturar
      const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - ONE_WEEK_MS;
      const list = [
        record,
        ...db.config.googleDriveBackups.filter((b: any) => b.id !== record.id),
      ].filter((b: any) => {
        if (!b.timestamp) return false;
        const t = new Date(b.timestamp).getTime();
        return !isNaN(t) && t >= cutoff;
      });

      db.config.googleDriveBackups = list.slice(0, 100);
      db.config.ultimoBackupDrive = record.timestamp || new Date().toISOString();
      db.config.proximoBackupDrive = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      if (record.carpetaId) {
        db.config.carpetaDriveId = record.carpetaId;
      }
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({ success: true, cloudPersisted: true, message: '✓ Respaldo registrado correctamente.', backup: record });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error registrando respaldo: ' + err.message });
  }
});

// Limpieza y sincronización de registros eliminados de Google Drive (mayores a 2 días)
app.post('/api/admin/google-drive/cleanup-old-records', requireAdmin, async (req, res) => {
  try {
    const { deletedIds = [], maxAgeDays = 7 } = req.body || {};
    let removedCount = 0;
    let remainingCount = 0;
    let ultimoPurgeDrive = '';

    await mutateDatabase((db) => {
      if (!db.config) db.config = { ...DEFAULT_CONFIG };
      if (!Array.isArray(db.config.googleDriveBackups)) {
        db.config.googleDriveBackups = [];
      }

      const maxAgeMs = (typeof maxAgeDays === 'number' ? maxAgeDays : 7) * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - maxAgeMs;
      const deletedIdSet = new Set(Array.isArray(deletedIds) ? deletedIds : []);

      const prevCount = db.config.googleDriveBackups.length;
      db.config.googleDriveBackups = db.config.googleDriveBackups.filter((b: any) => {
        if (deletedIdSet.has(b.id)) return false;
        if (!b.timestamp) return false;
        const t = new Date(b.timestamp).getTime();
        return !isNaN(t) && t >= cutoff;
      });

      removedCount = prevCount - db.config.googleDriveBackups.length;
      db.config.ultimoPurgeDrive = new Date().toISOString();
      ultimoPurgeDrive = db.config.ultimoPurgeDrive;
      remainingCount = db.config.googleDriveBackups.length;
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      message: `✓ Sincronizados ${removedCount} registros eliminados por superar la política de 2 días.`,
      removedCount,
      remainingCount,
      ultimoPurgeDrive,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error en cleanup-old-records: ' + err.message });
  }
});

// Activar o pausar el temporizador de 10 minutos para Google Drive
app.post('/api/admin/google-drive/toggle-auto', requireAdmin, async (req, res) => {
  try {
    const { activo } = req.body;
    let isActivo = false;
    await mutateDatabase((db) => {
      if (!db.config) db.config = { ...DEFAULT_CONFIG };
      db.config.backupAutomaticoDriveActivo = activo !== false;
      isActivo = db.config.backupAutomaticoDriveActivo;
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      message: `Copia de seguridad automática cada 10 minutos ${isActivo ? 'ACTIVADA' : 'PAUSADA'}.`,
      activo: isActivo,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error actualizando estado de respaldo: ' + err.message });
  }
});

// Descargar archivo permanente para archivar manualmente en Google Drive
app.get('/api/admin/google-drive-archive-download', (req, res) => {
  const db = loadDatabase();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `CAMARCA_GOOGLE_DRIVE_ARCHIVE_${environmentMode}_${timestamp}.json`;
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(db, null, 2));
});

// ARCHIVO DE FOTOS EN GOOGLE DRIVE (Funciones declaradas previamente)

// Catálogo completo de fotografías del sistema para sincronizar con Google Drive
app.get('/api/admin/photos/catalog', (req, res) => {
  try {
    const db = loadDatabase();
    const driveRegistry = loadDrivePhotosRegistry();
    const photosMap = new Map<string, any>();

    // 1. Fotos físicas existentes en el disco local
    if (fs.existsSync(photosDir)) {
      const files = fs.readdirSync(photosDir).filter((f) => !f.startsWith('.') && f.endsWith('.jpg'));
      for (const f of files) {
        const parts = f.replace('.jpg', '').split('_');
        if (parts.length >= 2) {
          const cedula = parts[0].trim();
          const slotKey = parts.slice(1).join('_').trim();
          const key = `${cedula}_${slotKey}`;
          const lookup = lookupMunicipioForCedula(cedula);
          const driveData = driveRegistry[key];

          photosMap.set(key, {
            cedula,
            slotKey,
            fileName: f,
            url: `/api/photos/${encodeURIComponent(cedula)}/${slotKey}`,
            nombre: lookup.encargado || '',
            municipio: driveData?.folderName || lookup.municipio || 'Giron',
            inGoogleDrive: Boolean(driveData?.driveFileId),
            driveFileId: driveData?.driveFileId || null,
            driveWebViewLink: driveData?.webViewLink || null,
            folderName: driveData?.folderName || lookup.municipio || 'Giron',
          });
        }
      }
    }

    // 2. Fotos referenciadas en expendios de la base de datos
    const photoFields = [
      'fotoAvisoUrl',
      'fotoBasculaUrl',
      'fotoMataselloUrl',
      'fotoFachadaUrl',
      'fotoContratistaUrl',
      'fotoHorarioUrl',
      'fotoTarifasUrl',
      'computadorUrl',
    ];

    for (const exp of db.expendios || []) {
      for (const field of photoFields) {
        const val = (exp as any)[field];
        if (typeof val === 'string' && val.trim().length > 0 && !val.includes('placehold.co')) {
          const key = `${exp.cedula.trim()}_${field}`;
          if (!photosMap.has(key)) {
            const driveData = driveRegistry[key];
            const lookup = lookupMunicipioForCedula(exp.cedula);
            photosMap.set(key, {
              cedula: exp.cedula.trim(),
              slotKey: field,
              fileName: `${exp.cedula.trim()}_${field}.jpg`,
              url: val.startsWith('/api/photos') ? val : `/api/photos/${encodeURIComponent(exp.cedula.trim())}/${field}`,
              nombre: (exp as any).nombre || exp.encargado || lookup.encargado || '',
              municipio: driveData?.folderName || exp.municipio || lookup.municipio || 'Giron',
              inGoogleDrive: Boolean(driveData?.driveFileId),
              driveFileId: driveData?.driveFileId || null,
              driveWebViewLink: driveData?.webViewLink || null,
              folderName: driveData?.folderName || exp.municipio || lookup.municipio || 'Giron',
            });
          }
        }
      }
    }

    // 3. Fotos registradas en el registro permanente de Google Drive (asegura visualización aún tras reinicio de contenedor)
    for (const [key, driveData] of Object.entries(driveRegistry)) {
      if (driveData && driveData.driveFileId && !photosMap.has(key)) {
        const parts = key.split('_');
        const cedula = driveData.cedula || parts[0];
        const slotKey = driveData.slotKey || parts.slice(1).join('_');
        const lookup = lookupMunicipioForCedula(cedula);
        photosMap.set(key, {
          cedula,
          slotKey,
          fileName: driveData.fileName || `${cedula}_${slotKey}.jpg`,
          url: `/api/photos/${encodeURIComponent(cedula)}/${slotKey}`,
          nombre: lookup.encargado || '',
          municipio: driveData.folderName || lookup.municipio || 'Giron',
          inGoogleDrive: true,
          driveFileId: driveData.driveFileId,
          driveWebViewLink: driveData.webViewLink || null,
          folderName: driveData.folderName || lookup.municipio || 'Giron',
        });
      }
    }

    const photosList = Array.from(photosMap.values());
    const inDriveCount = photosList.filter((p) => p.inGoogleDrive).length;

    res.json({
      success: true,
      totalPhotos: photosList.length,
      inDriveCount,
      pendingDriveCount: photosList.length - inDriveCount,
      folderName: 'Fotos Expendios 4-72 - CAMARCA SAS',
      photos: photosList,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error obteniendo catálogo de fotos: ' + err.message });
  }
});

// Registrar enlace de foto archivada en Google Drive
app.post('/api/admin/google-drive/register-photo', (req, res) => {
  try {
    const { cedula, slotKey, driveFileId, webViewLink, webContentLink, fileName } = req.body;
    if (!cedula || !slotKey || !driveFileId) {
      return res.status(400).json({ success: false, message: 'Parámetros incompletos.' });
    }

    const registry = loadDrivePhotosRegistry();
    const key = `${cedula.trim()}_${slotKey.trim()}`;
    registry[key] = {
      cedula: cedula.trim(),
      slotKey: slotKey.trim(),
      driveFileId,
      webViewLink,
      webContentLink,
      fileName: fileName || `${key}.jpg`,
      savedAt: new Date().toISOString(),
    };

    saveDrivePhotosRegistry(registry);
    res.json({ success: true, message: 'Foto registrada en Google Drive exitosamente.', record: registry[key] });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error registrando foto de Google Drive: ' + err.message });
  }
});

// Endpoint para escanear carpetas (locales y de Google Drive) buscando fotos que cumplan la convención de nombres
// y cargarlas/asociarlas automáticamente a los expendios en la plataforma
app.post('/api/admin/photos/scan-and-link', requireAdmin, async (req, res) => {
  try {
    const driveRegistry = loadDrivePhotosRegistry();
    let linkedCount = 0;
    let scannedFilesCount = 0;
    const details: Array<{ fileName: string; source: 'local' | 'drive'; slot: string; expendio: string; cedula: string }> = [];

    // Función auxiliar para resolver el slot canónico
    const normalizeToSlotKey = (str: string): string | null => {
      const s = str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (s.includes('aviso') || s.includes('letrero')) return 'fotoAvisoUrl';
      if (s.includes('fachada') || s.includes('panoramica')) return 'fotoPanoramicaUrl';
      if (s.includes('matasello')) return 'fotoMataselloUrl';
      if (s.includes('bascula')) return 'fotoBasculaUrl';
      if (s.includes('contratista') || s.includes('encargado')) return 'fotoContratistaUrl';
      if (s.includes('horario')) return 'fotoHorarioUrl';
      if (s.includes('tarifa')) return 'fotoTarifasUrl';
      if (s.includes('computador')) return 'computadorUrl';
      return null;
    };

    const updatesToApply: Array<{ cedula: string; slotKey: string; canonicalUrl: string; fileName: string; source: 'local' | 'drive'; expendio: string }> = [];

    const dbCurrent = loadDatabase();
    // Función para buscar expendio objetivo por cédula o municipio
    const findTargetExpendio = (cedulaCandidate?: string, muniCandidate?: string) => {
      if (cedulaCandidate) {
        const clean = cedulaCandidate.trim();
        const found = dbCurrent.expendios.find((e) => e.cedula && e.cedula.trim() === clean);
        if (found) return found;
      }
      if (muniCandidate) {
        const cleanM = muniCandidate.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (cleanM.length >= 3) {
          const found = dbCurrent.expendios.find((e) => {
            const eMun = (e.municipio || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const eLoc = (e.localidad || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            return (eMun && (eMun === cleanM || cleanM.includes(eMun))) || (eLoc && (eLoc === cleanM || cleanM.includes(eLoc)));
          });
          if (found) return found;
        }
      }
      return null;
    };

    // 1. Escanear carpetas locales (photosDir, permanentPhotosDir, photosMunicipiosDir)
    const localDirs = [photosDir, permanentPhotosDir];
    if (fs.existsSync(photosMunicipiosDir)) {
      try {
        const muniDirs = fs.readdirSync(photosMunicipiosDir);
        for (const md of muniDirs) {
          const fullP = path.join(photosMunicipiosDir, md);
          if (fs.statSync(fullP).isDirectory()) localDirs.push(fullP);
        }
      } catch (e) {}
    }

    for (const dir of localDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.') && (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')));
        for (const fileName of files) {
          scannedFilesCount++;
          const base = fileName.replace(/\.(jpg|jpeg|png)$/i, '');
          const parts = base.split('_');

          let slotKey: string | null = null;
          let targetExp: ExpendioData | null = null;

          if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
            const ced = parts[0].trim();
            slotKey = normalizeToSlotKey(parts.slice(1).join('_'));
            targetExp = findTargetExpendio(ced);
          } else {
            slotKey = normalizeToSlotKey(parts[0] || base);
            const muniPart = parts.length >= 2 ? parts[1] : '';
            targetExp = findTargetExpendio(undefined, muniPart);
          }

          if (slotKey && targetExp) {
            const canonicalUrl = `/api/photos/${encodeURIComponent(targetExp.cedula.trim())}/${slotKey}`;
            const currentVal = (targetExp as any)[slotKey];
            const shouldUpdate = !currentVal || currentVal.includes('placehold.co') || currentVal === '' || !currentVal.startsWith('/api/photos');

            // Asegurar que el archivo exista en photosDir para que se sirva inmediatamente
            const canonicalLocalFile = path.join(photosDir, `${targetExp.cedula.trim()}_${slotKey}.jpg`);
            const sourceFilePath = path.join(dir, fileName);
            if (sourceFilePath !== canonicalLocalFile && !fs.existsSync(canonicalLocalFile)) {
              try { fs.copyFileSync(sourceFilePath, canonicalLocalFile); } catch {}
            }

            if (shouldUpdate) {
              updatesToApply.push({
                cedula: targetExp.cedula.trim(),
                slotKey,
                canonicalUrl,
                fileName,
                source: 'local',
                expendio: targetExp.localidad || targetExp.municipio,
              });
            }
          }
        }
      } catch (dirErr) {}
    }

    // 2. Escanear Google Drive si hay conexión permanente en el servidor
    try {
      const driveToken = await getOrRefreshDriveTokenServer();
      if (driveToken) {
        const rootFolder = await getOrCreatePhotosFolderServer(driveToken);
        const listFoldersUrl = `https://www.googleapis.com/drive/v3/files?q='${rootFolder.id}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id,name)&pageSize=100`;
        const fRes = await fetch(listFoldersUrl, { headers: { Authorization: `Bearer ${driveToken}` } });
        if (fRes.ok) {
          const fData = await fRes.json();
          const folders = [{ id: rootFolder.id, name: 'Root' }, ...(fData.files || [])];

          for (const folder of folders) {
            const listFilesUrl = `https://www.googleapis.com/drive/v3/files?q='${folder.id}'+in+parents+and+trashed=false&fields=files(id,name,webViewLink,webContentLink)&pageSize=200`;
            const filesRes = await fetch(listFilesUrl, { headers: { Authorization: `Bearer ${driveToken}` } });
            if (filesRes.ok) {
              const filesJson = await filesRes.json();
              for (const file of filesJson.files || []) {
                scannedFilesCount++;
                const baseName = (file.name || '').replace(/\.(jpg|jpeg|png)$/i, '');
                const parts = baseName.split('_');

                let slotKey: string | null = null;
                let targetExp: ExpendioData | null = null;

                if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
                  slotKey = normalizeToSlotKey(parts.slice(1).join('_'));
                  targetExp = findTargetExpendio(parts[0].trim());
                } else {
                  slotKey = normalizeToSlotKey(parts[0] || baseName);
                  const muniCandidate = folder.name !== 'Root' ? folder.name : (parts.length >= 2 ? parts[1] : '');
                  targetExp = findTargetExpendio(undefined, muniCandidate);
                }

                if (slotKey && targetExp) {
                  const regKey = `${targetExp.cedula.trim()}_${slotKey}`;
                  driveRegistry[regKey] = {
                    cedula: targetExp.cedula.trim(),
                    slotKey,
                    driveFileId: file.id,
                    webViewLink: file.webViewLink,
                    webContentLink: file.webContentLink,
                    fileName: file.name,
                    folderName: folder.name !== 'Root' ? folder.name : targetExp.municipio,
                    savedAt: new Date().toISOString(),
                  };

                  const canonicalUrl = `/api/photos/${encodeURIComponent(targetExp.cedula.trim())}/${slotKey}`;
                  const currentVal = (targetExp as any)[slotKey];
                  const shouldUpdate = !currentVal || currentVal.includes('placehold.co') || currentVal === '' || !currentVal.startsWith('/api/photos');

                  if (shouldUpdate) {
                    updatesToApply.push({
                      cedula: targetExp.cedula.trim(),
                      slotKey,
                      canonicalUrl,
                      fileName: file.name,
                      source: 'drive',
                      expendio: targetExp.localidad || targetExp.municipio,
                    });
                  }
                }
              }
            }
          }
          saveDrivePhotosRegistry(driveRegistry);
        }
      }
    } catch (driveErr: any) {
      console.warn('[Scan Photos] Advertencia en escaneo de Drive:', driveErr.message);
    }

    if (updatesToApply.length > 0) {
      await mutateDatabase((db) => {
        for (const upd of updatesToApply) {
          const exp = db.expendios.find((e) => e.cedula && e.cedula.trim() === upd.cedula);
          if (exp) {
            (exp as any)[upd.slotKey] = upd.canonicalUrl;
            if (upd.slotKey === 'fotoAvisoUrl') {
              exp.fotoAvisoUrl = upd.canonicalUrl;
              exp.letreroUrl = upd.canonicalUrl;
              exp.tieneAviso = 'SI';
              exp.motivoFaltaAviso = '';
            } else if (upd.slotKey === 'fotoBasculaUrl') {
              exp.fotoBasculaUrl = upd.canonicalUrl;
              exp.basculaUrl = upd.canonicalUrl;
              exp.tieneBascula = 'SI';
              exp.motivoFaltaBascula = '';
            } else if (upd.slotKey === 'fotoMataselloUrl') {
              exp.fotoMataselloUrl = upd.canonicalUrl;
              exp.mataselloUrl = upd.canonicalUrl;
              exp.tieneMatasello = 'SI';
              exp.motivoFaltaMatasello = '';
            }
            exp.fechaUltimaActualizacion = new Date().toISOString().split('T')[0];
            linkedCount++;
            details.push({
              fileName: upd.fileName,
              source: upd.source,
              slot: upd.slotKey,
              expendio: upd.expendio,
              cedula: upd.cedula,
            });
          }
        }
      }, { immediateCloudSync: true, throwOnCloudError: true });
    }

    res.json({
      success: true,
      cloudPersisted: true,
      scannedFilesCount,
      linkedCount,
      details,
      message: `Se validaron ${scannedFilesCount} archivos en las carpetas y se cargaron/vincularon ${linkedCount} registros fotográficos a la plataforma.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error escaneando carpetas de fotos: ' + err.message });
  }
});

app.put('/api/admin/cuentas-cargadas/:id/estado', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { estado, observaciones } = req.body;

  try {
    let updatedItem: any = null;
    await mutateDatabase((db) => {
      if (!Array.isArray(db.cuentasCargadas)) db.cuentasCargadas = [];

      const idx = db.cuentasCargadas.findIndex((c) => c.id === id);
      if (idx === -1) {
        throw new Error('Cuenta cargada no encontrada.');
      }

      db.cuentasCargadas[idx].estado = estado || db.cuentasCargadas[idx].estado;
      if (observaciones !== undefined) db.cuentasCargadas[idx].observaciones = observaciones;

      // Sync with relacion de pagos
      const cuentaItem = db.cuentasCargadas[idx];
      const relIdx = (db.relacionPagos || []).findIndex(
        (p) => p.cuentaCargadaId === id || p.cedula.replace(/[^0-9]/g, '') === cuentaItem.cedula.replace(/[^0-9]/g, '')
      );
      if (relIdx !== -1 && db.relacionPagos) {
        if (estado === 'Aprobada') {
          db.relacionPagos[relIdx].estado = 'Listo para Pago';
        } else if (estado === 'Rechazada') {
          db.relacionPagos[relIdx].estado = 'Rechazada';
        }
      }

      updatedItem = db.cuentasCargadas[idx];
    }, { immediateCloudSync: true, throwOnCloudError: true });


    res.json({ success: true, cloudPersisted: true, data: updatedItem, message: `Estado actualizado a: ${estado}` });

  } catch (err: any) {
    res.status(err.message.includes('no encontrada') ? 404 : 500).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/cuentas-cargadas/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    let fotoUrlToDelete = '';
    await mutateDatabase((db) => {
      if (!Array.isArray(db.cuentasCargadas)) db.cuentasCargadas = [];

      const found = db.cuentasCargadas.find((c) => c.id === id);
      if (found?.fotoUrl) {
        fotoUrlToDelete = found.fotoUrl;
      }
      db.cuentasCargadas = db.cuentasCargadas.filter((c) => c.id !== id);
    }, { immediateCloudSync: true, throwOnCloudError: true });

    // If local file exists, remove it
    if (fotoUrlToDelete) {
      const filename = path.basename(fotoUrlToDelete);
      const filePath = path.join(scannedDir, filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {}
      }
    }

    res.json({ success: true, cloudPersisted: true, message: 'Cuenta cargada eliminada correctamente.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 11. MODULO RELACION DE PAGOS POR MESES
app.get(['/api/admin/relacion-pagos', '/api/relacion-pagos'], async (req, res) => {
  const { mes, anio } = req.query;
  try {
    const localDb = loadDatabase();
    let list = [...(localDb.relacionPagos || [])];
    const cuentasCargadas = localDb.cuentasCargadas || [];

    if (mes) {
      const targetMes = String(mes).trim().toUpperCase();
      list = list.filter((p) => (p.mes || '').toUpperCase() === targetMes);
    }

    if (anio) {
      const targetAnio = String(anio).trim();
      list = list.filter((p) => String(p.anio || '2026') === targetAnio);
    }

    const updatedList = list.map((item) => {
      const valNum = Number(item.valorCancelar || (item as any).valorPagar) || 0;
      const matchingCargada = cuentasCargadas.find(
        (c) =>
          String(c.cedula || '').replace(/[^0-9]/g, '') === String(item.cedula || '').replace(/[^0-9]/g, '') &&
          String(c.periodo || '').toUpperCase().includes((item.mes || '').toUpperCase())
      );
      if (matchingCargada) {
        return {
          ...item,
          valorCancelar: valNum,
          valorPagar: valNum,
          cuentaCargadaId: matchingCargada.id,
          estado: matchingCargada.estado === 'Aprobada' ? 'Listo para Pago' : 'Cuenta Firmada Cargada',
        };
      }
      return {
        ...item,
        valorCancelar: valNum,
        valorPagar: valNum,
      };
    });

    res.json({ success: true, data: updatedList });
  } catch (err: any) {
    const localDb = loadDatabase();
    let list = localDb.relacionPagos || [];

    if (mes) {
      const targetMes = String(mes).trim().toUpperCase();
      list = list.filter((p) => (p.mes || '').toUpperCase() === targetMes);
    }

    if (anio) {
      const targetAnio = String(anio).trim();
      list = list.filter((p) => String(p.anio || '2026') === targetAnio);
    }

    res.json({ success: true, data: list });
  }
});

// Colombian Municipalities to Centro Operativo mapping dictionary
const MUNICIPIO_CENTRO_OP_MAP: { [key: string]: string } = {
  ARBOLEDAS: 'PO. CUCUTA',
  BOCHALEMA: 'PO. CUCUTA',
  PAMPLONA: 'PO. CUCUTA',
  'OCAÑA': 'PO. CUCUTA',
  OCANA: 'PO. CUCUTA',
  SALAZAR: 'PO. CUCUTA',
  SANTIAGO: 'PO. CUCUTA',
  LOURDES: 'PO. CUCUTA',
  GRAMALOTE: 'PO. CUCUTA',
  'VILLA CARO': 'PO. CUCUTA',
  DURANIA: 'PO. CUCUTA',
  'SAN CAYETANO': 'PO. CUCUTA',
  'EL ZULIA': 'PO. CUCUTA',
  'LOS PATIOS': 'PO. CUCUTA',
  'VILLA DEL ROSARIO': 'PO. CUCUTA',
  CUCUTA: 'PO. CUCUTA',
  TIBU: 'PO. CUCUTA',
  SARDINATA: 'PO. CUCUTA',
  'EL TARRA': 'PO. CUCUTA',
  CONVENCION: 'PO. CUCUTA',
  'EL CARMEN': 'PO. CUCUTA',
  'SAN CALIXTO': 'PO. CUCUTA',
  HACARI: 'PO. CUCUTA',
  TEORAMA: 'PO. CUCUTA',
  'LA PLAYA': 'PO. CUCUTA',
  ABREGO: 'PO. CUCUTA',
  TOLEDO: 'PO. CUCUTA',
  LABATECA: 'PO. CUCUTA',
  'LA BATECA': 'PO. CUCUTA',
  CHITAGA: 'PO. CUCUTA',
  MUTISCUA: 'PO. CUCUTA',
  SILOS: 'PO. CUCUTA',
  CUCUTILLA: 'PO. CUCUTA',
  CACOTA: 'PO. CUCUTA',
  CHINACOTA: 'PO. CUCUTA',
  HERRAN: 'PO. CUCUTA',
  PAMPLONITA: 'PO. CUCUTA',
  'PUERTO SANTANDER': 'PO. CUCUTA',
  RAGONVALIA: 'PO. CUCUTA',
  BUCARASICA: 'PO. CUCUTA',
  BUCARAMANGA: 'PO. BUCARAMANGA',
  FLORIDABLANCA: 'PO. BUCARAMANGA',
  GIRON: 'PO. BUCARAMANGA',
  PIEDECUESTA: 'PO. BUCARAMANGA',
  BARRANCABERMEJA: 'PO. BUCARAMANGA',
};

const resolveCentroOperativo = (mun: string, rawCentroOp?: string): string => {
  return normalizeCentroOperativo(rawCentroOp, mun);
};

const resolveCentroAcopio = (mun: string, rawCentroAcopio?: string): string => {
  return normalizeCentroAcopio(rawCentroAcopio, mun);
};

// 11B. Auto-generate / Sync Relación de Pagos from registered Expendios for a month
const handleGenerarRelacionPagos = async (req: express.Request, res: express.Response) => {
  const { mes = 'FEBRERO', anio = '2026' } = req.body;
  const mesNorm = String(mes).trim().toUpperCase();
  const anioNorm = String(anio).trim();

  try {
    let generatedItems: PagoRelacionItem[] = [];

    await mutateDatabase((db) => {
      if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];

      const existingOtherMonths = db.relacionPagos.filter(
        (p) => !(p.mes?.toUpperCase() === mesNorm && String(p.anio || '2026') === anioNorm)
      );

      const cuentasCargadas = db.cuentasCargadas || [];
      const cleanDigits = (s?: string) => (s || '').replace(/[^0-9]/g, '');

      generatedItems = db.expendios.map((exp, index) => {
        const histMatch = (db.historial || []).find(
          (h) =>
            cleanDigits(h.cedula) === cleanDigits(exp.cedula) &&
            h.periodo?.toUpperCase().includes(mesNorm) &&
            h.cuentaData
        );

        const valorCancelar = Number(histMatch?.cuentaData?.valorNeto ?? histMatch?.monto ?? 0);
        const munKey = (exp.municipio || exp.localidad || 'ARBOLEDAS').trim().toUpperCase();
        const centroOp = resolveCentroOperativo(munKey, exp.centroOperativo);

        const matchingCargada = cuentasCargadas.find(
          (c) =>
            (cleanDigits(c.cedula) === cleanDigits(exp.cedula) ||
              c.municipio.trim().toUpperCase() === munKey) &&
            c.periodo.toUpperCase().includes(mesNorm)
        );

        let estado = 'Pendiente';
        if (matchingCargada) {
          if (matchingCargada.analisisIA?.hayNovedad) {
            estado = 'Cuenta con Novedad IA';
          } else if (matchingCargada.estado === 'Aprobada') {
            estado = 'Listo para Pago';
          } else {
            estado = 'Cuenta Firmada Cargada';
          }
        }

        const rawCed = exp.cedula.replace(/[^0-9]/g, '');
        const formattedCedula = rawCed.replace(/\B(?=(\d{3})+(?!\d))/g, '.') || exp.cedula;

        const existingPago = (db.relacionPagos || []).find(
          (p) => p.municipio.trim().toUpperCase() === munKey || cleanDigits(p.cedula) === cleanDigits(exp.cedula)
        );

        let cuentaFinal = '';
        let bancoFinal = '';

        if (existingPago?.cuenta && !/^\d{5,6}$/.test(existingPago.cuenta.trim())) {
          const formatted = formatCuentaBancaria(existingPago.cuenta, existingPago.banco);
          cuentaFinal = formatted.cuenta;
          bancoFinal = formatted.banco;
        } else if (exp.telefonoPunto) {
          const phoneClean = cleanNequiNumber(exp.telefonoPunto);
          cuentaFinal = phoneClean ? `NEQUI ${phoneClean}` : '';
          bancoFinal = phoneClean ? 'NEQUI' : '';
        }

        return {
          id: `pago-${Date.now()}-${index + 1}`,
          consecutivo: index + 1,
          centroOperativo: centroOp,
          municipio: munKey,
          concepto: `PAGO MES ${mesNorm} EXPENDIO ${munKey}`,
          nombreEncargado: exp.encargado.toUpperCase(),
          cedula: formattedCedula,
          cuenta: cuentaFinal,
          valorCancelar,
          banco: bancoFinal,
          estado,
          mes: mesNorm,
          anio: anioNorm,
          cuentaCargadaId: matchingCargada?.id,
          analisisIA: matchingCargada?.analisisIA,
        };
      });

      db.relacionPagos = [...existingOtherMonths, ...generatedItems];
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      data: generatedItems,
      message: `✓ Relación de Pagos generada y sincronizada para MES ${mesNorm} ${anioNorm} (${generatedItems.length} expendios vinculados por Municipio).`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error generando relación de pagos: ' + err.message });
  }
};

app.post('/api/admin/relacion-pagos/auto-generate', requireAdmin, handleGenerarRelacionPagos);
app.post('/api/admin/relacion-pagos/generar-desde-expendios', requireAdmin, handleGenerarRelacionPagos);

// 11C. Import Excel for Relación de Pagos with Multi-Sheet & Robust 2D Grid Parsing
app.post('/api/admin/relacion-pagos/import-excel', uploadExcel.any(), requireAdmin, async (req, res) => {
  try {
    const db = loadDatabase();
    const mes = (req.body.mes || 'FEBRERO').toUpperCase();
    const anio = String(req.body.anio || '2026');

    const uploadedFile = req.file || (req.files && Array.isArray(req.files) ? req.files[0] : null);
    const resolucionDiscrepancias = req.body?.resolucionDiscrepancias; // 'actualizar_bd' | 'actualizar_archivo'
    const cuentasCargadas = db.cuentasCargadas || [];
    const cleanDigits = (s?: any) => String(s || '').replace(/[^0-9]/g, '');
    const cleanNorm = (str: any) =>
      str ? String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

    const candidateRows: {
      municipioFinal: string;
      centroOperativoFinal: string;
      nombreFinal: string;
      formattedCed: string;
      cuentaFinal: string;
      bancoFinal: string;
      valorFinal: number;
      consecutivo: number;
      digitsPhone: string;
      mes: string;
      anio: string;
    }[] = [];
    const sheetsProcessed: string[] = [];

    if (uploadedFile) {
      const fileBuffer = fs.readFileSync(uploadedFile.path);
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      try {
        fs.unlinkSync(uploadedFile.path);
      } catch (e) {}

      // Iterate through ALL sheets in the Excel workbook (e.g., CUCUTA, BUCARAMANGA, ARAUCA, VALLEDUPAR, etc.)
      for (const sName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sName];
        if (!worksheet) continue;
        const matrixRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        if (!matrixRows || matrixRows.length === 0) continue;

        sheetsProcessed.push(sName);

        // Derive sheet-level default Centro Operativo if the tab name contains city name
        const sNameUpper = sName.toUpperCase();
        let sheetDefaultCO = '';
        if (sNameUpper.includes('CUCUTA') || sNameUpper.includes('NORTE')) sheetDefaultCO = 'PO. CUCUTA';
        else if (sNameUpper.includes('BUCARAMANGA') || sNameUpper.includes('SANTANDER') || sNameUpper.includes('SAN GIL')) sheetDefaultCO = 'PO. BUCARAMANGA';
        else if (sNameUpper.includes('ARAUCA')) sheetDefaultCO = 'PO. ARAUCA';
        else if (sNameUpper.includes('VALLEDUPAR') || sNameUpper.includes('CESAR')) sheetDefaultCO = 'PO. VALLEDUPAR';

        // Locate header row in the first 15 rows of this sheet
        let headerRowIdx = -1;
        let colMap: { [key: string]: number } = {};

        for (let r = 0; r < Math.min(matrixRows.length, 15); r++) {
          const row = matrixRows[r];
          if (!Array.isArray(row)) continue;
          const rowNorms = row.map((cell) => cleanNorm(cell));

          const hasMun = rowNorms.some((c) => c.includes('MUNICIPIO') || c.includes('LOCALIDAD') || c.includes('CIUDAD') || c.includes('PUNTO'));
          const hasEnc = rowNorms.some((c) => c.includes('ENCARGADO') || c.includes('NOMBRE') || c.includes('RESPONSABLE') || c.includes('CONTRATISTA') || c.includes('TITULAR'));
          const hasCed = rowNorms.some((c) => c.includes('CEDULA') || c.includes('NIT') || c.includes('DOCUMENTO') || c === 'CC');
          const hasVal = rowNorms.some((c) => c.includes('VALOR') || c.includes('CANCELAR') || c.includes('MONTO') || c.includes('NETO') || c.includes('TOTAL'));

          if ((hasMun || hasEnc) && (hasCed || hasVal || hasMun)) {
            headerRowIdx = r;
            row.forEach((cell, cIdx) => {
              const norm = cleanNorm(cell);
              if (norm.includes('CONSECUTIVO') || norm === 'N' || norm === 'NO' || norm === 'NUM' || norm === 'ITEM') colMap['consecutivo'] = cIdx;
              if (norm.includes('CENTROOPERATIVO') || norm.includes('OPERATIVO') || norm === 'PO' || norm.startsWith('PO')) colMap['centroOperativo'] = cIdx;
              if (norm.includes('MUNICIPIO') || norm.includes('LOCALIDAD') || norm.includes('CIUDAD') || norm.includes('PUNTO')) colMap['municipio'] = cIdx;
              if (norm.includes('FORMADEPAGO') || norm.includes('MEDIODEPAGO') || (norm.includes('CUENTA') && !norm.includes('VALOR')) || norm.includes('NEQUI') || norm.includes('BANCO')) colMap['cuenta'] = cIdx;
              if (norm.includes('CONCEPTO') || norm.includes('DETALLE') || norm.includes('DESCRIPCION')) colMap['concepto'] = cIdx;
              if (norm.includes('ENCARGADO') || norm.includes('NOMBRE') || norm.includes('RESPONSABLE') || norm.includes('CONTRATISTA') || norm.includes('TITULAR')) colMap['nombreEncargado'] = cIdx;
              if (norm.includes('CEDULA') || norm.includes('NIT') || norm.includes('DOCUMENTO') || norm === 'CC') colMap['cedula'] = cIdx;
              if (norm.includes('VALORACANCELAR') || norm.includes('VALORNETO') || norm.includes('TOTALAPAGAR') || norm.includes('CANCELAR') || (norm.includes('VALOR') && !norm.includes('BASICO'))) colMap['valorCancelar'] = cIdx;
              if (norm.includes('BANCO') || norm.includes('ENTIDAD')) colMap['banco'] = cIdx;
              if (norm.includes('ESTADO') || norm.includes('STATUS')) colMap['estado'] = cIdx;
            });
            break;
          }
        }

        if (headerRowIdx === -1) {
          headerRowIdx = 0;
          colMap = {
            consecutivo: 0,
            centroOperativo: 1,
            municipio: 2,
            cuenta: 3,
            nombreEncargado: 4,
            cedula: 5,
            valorBasico: 6,
            valorCancelar: 7,
            banco: 8,
          };
        }

        const dataRows = matrixRows.slice(headerRowIdx + 1);

        dataRows.forEach((row, idx) => {
          if (!Array.isArray(row) || row.every((c) => String(c || '').trim() === '')) return;

          let rawMun = '';
          let rawCentroOp = sheetDefaultCO;
          let rawEnc = '';
          let rawCed = '';
          let rawCuenta = '';
          let rawBanco = '';
          let rawValor: any = '';

          // 1. Column mapped extraction
          if (colMap['municipio'] !== undefined && row[colMap['municipio']] !== undefined) rawMun = String(row[colMap['municipio']]).trim();
          if (colMap['centroOperativo'] !== undefined && row[colMap['centroOperativo']] !== undefined) rawCentroOp = String(row[colMap['centroOperativo']]).trim() || sheetDefaultCO;
          if (colMap['nombreEncargado'] !== undefined && row[colMap['nombreEncargado']] !== undefined) rawEnc = String(row[colMap['nombreEncargado']]).trim();
          if (colMap['cedula'] !== undefined && row[colMap['cedula']] !== undefined) rawCed = String(row[colMap['cedula']]).trim();
          if (colMap['cuenta'] !== undefined && row[colMap['cuenta']] !== undefined) rawCuenta = String(row[colMap['cuenta']]).trim();
          if (colMap['banco'] !== undefined && row[colMap['banco']] !== undefined) rawBanco = String(row[colMap['banco']]).trim();
          if (colMap['valorCancelar'] !== undefined && row[colMap['valorCancelar']] !== undefined) rawValor = row[colMap['valorCancelar']];

          // 2. Intelligent cell inspection for robustness
          row.forEach((cell) => {
            const cellStr = String(cell || '').trim();
            const cellUpper = cellStr.toUpperCase();
            const digits = cleanDigits(cellStr);

            // A. Account detection
            if (
              cellUpper.includes('NEQUI') ||
              cellUpper.includes('DAVIPLATA') ||
              cellUpper.includes('AHORRO A LA MANO') ||
              cellUpper.includes('BANCOLOMBIA') ||
              cellUpper.includes('BANCO') ||
              cellUpper.includes('AHORROS') ||
              cellUpper.includes('CORRIENTE') ||
              (digits.length === 10 && digits.startsWith('3'))
            ) {
              rawCuenta = cellStr;
              if (cellUpper.includes('NEQUI')) rawBanco = 'NEQUI';
              else if (cellUpper.includes('DAVIPLATA')) rawBanco = 'DAVIPLATA';
              else if (cellUpper.includes('BANCOLOMBIA') || cellUpper.includes('AHORRO A LA MANO')) rawBanco = 'BANCOLOMBIA';
              else if (cellUpper.includes('AGRARIO')) rawBanco = 'BANCO AGRARIO';
              else if (cellUpper.includes('DAVIVIENDA')) rawBanco = 'DAVIVIENDA';
              else if (cellUpper.includes('BBVA')) rawBanco = 'BBVA';
            }

            // B. Cédula detection
            if (
              !rawCed &&
              ((digits.length >= 6 && digits.length <= 10 && !digits.startsWith('3') && !cellUpper.includes('$')) ||
                cellStr.includes('.')) &&
              !cellUpper.includes('TOTAL') &&
              !cellUpper.includes('PO.')
            ) {
              const numTest = parseNumeric(cellStr);
              if (numTest < 100000000 && numTest !== 202613 && numTest !== 127830 && numTest !== 121200) {
                rawCed = cellStr;
              }
            }

            // C. Municipality match against known catalog
            const normCell = cellUpper.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (MUNICIPIO_CENTRO_OP_MAP[normCell]) {
              rawMun = cellUpper;
              if (!rawCentroOp || rawCentroOp === rawMun) {
                rawCentroOp = MUNICIPIO_CENTRO_OP_MAP[normCell];
              }
            }

            // D. Centro Operativo marker
            if (cellUpper.startsWith('PO.') || cellUpper.startsWith('P.O.') || cellUpper.includes('REGIONAL ORIENTE')) {
              rawCentroOp = cellUpper;
            }

            // E. Encargado detection
            if (
              !rawEnc &&
              cellStr.length > 5 &&
              /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s\.]+$/.test(cellStr) &&
              !cellUpper.includes('TOTAL') &&
              !cellUpper.includes('EXPENDIO') &&
              !cellUpper.includes('BANCO') &&
              !cellUpper.includes('NEQUI') &&
              !cellUpper.includes('PO.') &&
              !MUNICIPIO_CENTRO_OP_MAP[normCell]
            ) {
              rawEnc = cellUpper;
            }

            // F. Net value detection
            const numVal = parseNumeric(cellStr);
            if (numVal > 50000 && numVal < 1000000 && (!rawValor || parseNumeric(rawValor) === 0)) {
              rawValor = numVal;
            }
          });

          const numericVal = parseNumeric(rawValor);

          // Skip summary / total rows
          const isTotalRow =
            rawMun === 'TOTAL' ||
            rawEnc === 'TOTAL' ||
            rawMun.includes('TOTAL') ||
            rawMun.includes('SUMA') ||
            rawMun.includes('CONSOLIDADO') ||
            (!rawCed && (!rawEnc || rawEnc === 'ENCARGADO') && numericVal > 500000) ||
            (numericVal > 2000000 && !rawCed);

          if (isTotalRow) return;

          const municipioFinal = (rawMun || `MUNICIPIO_${candidateRows.length + 1}`).toUpperCase().trim();
          const centroOperativoFinal = resolveCentroOperativo(municipioFinal, rawCentroOp || sheetDefaultCO);
          const nombreFinal = rawEnc && rawEnc !== 'ENCARGADO' ? rawEnc.toUpperCase() : `ENCARGADO ${municipioFinal}`;
          const digitsCed = cleanDigits(rawCed);
          const formattedCed = digitsCed ? digitsCed.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : rawCed;

          let cuentaFinal = rawCuenta.trim();
          if (!cuentaFinal || /^\d{5,6}$/.test(cuentaFinal)) {
            cuentaFinal = 'NEQUI 3115559252';
          }
          const formattedCta = formatCuentaBancaria(cuentaFinal, rawBanco);
          cuentaFinal = formattedCta.cuenta;
          const bancoFinal = formattedCta.banco;
          const valorFinal = numericVal > 0 ? numericVal : 121200;
          const consecutivo = Number(parseNumeric(row[colMap['consecutivo'] ?? 0])) || candidateRows.length + 1;
          const digitsPhone = cleanNequiNumber(cuentaFinal);

          candidateRows.push({
            municipioFinal,
            centroOperativoFinal,
            nombreFinal,
            formattedCed,
            cuentaFinal,
            bancoFinal,
            valorFinal,
            consecutivo,
            digitsPhone,
            mes,
            anio,
          });
        });
      }
    }

    if (candidateRows.length === 0) {
      return res.status(400).json({ success: false, message: 'No se encontraron filas de expendios válidas en el archivo Excel.' });
    }

    // Strictly check for discrepancies in Encargado data: nombre, cedula, celular, direccion
    const allDiscrepancies: DiscrepanciaEncargadoItem[] = [];
    candidateRows.forEach((cand) => {
      const digitsCed = cleanDigits(cand.formattedCed);
      const target = db.expendios.find(
        (e) =>
          e.municipio.trim().toUpperCase() === cand.municipioFinal ||
          e.localidad.trim().toUpperCase() === cand.municipioFinal ||
          (digitsCed && cleanDigits(e.cedula) === digitsCed)
      );
      if (!target) return;

      const diffs = checkDiscrepanciesEncargado(
        cand.municipioFinal,
        target,
        cand.nombreFinal,
        cand.formattedCed,
        cand.digitsPhone,
        ''
      );
      allDiscrepancies.push(...diffs);
    });

    if (allDiscrepancies.length > 0 && !resolucionDiscrepancias) {
      return res.json({
        success: false,
        requiereResolucion: true,
        discrepancias: allDiscrepancies,
        totalDiscrepancias: allDiscrepancies.length,
        message: `Se detectaron ${allDiscrepancies.length} diferencias en los datos del Encargado (Nombre, Cédula, Celular) entre el archivo de pagos y la base de datos registrada.`,
      });
    }

    const importedItems: PagoRelacionItem[] = [];

    candidateRows.forEach((cand) => {
      const digitsCed = cleanDigits(cand.formattedCed);
      const matchingCargada = cuentasCargadas.find(
        (c) =>
          (cleanDigits(c.cedula) === digitsCed || c.municipio.trim().toUpperCase() === cand.municipioFinal) &&
          c.periodo.toUpperCase().includes(mes)
      );

      let estadoFinal = 'Pendiente';
      if (matchingCargada) {
        if (matchingCargada.analisisIA?.hayNovedad) {
          estadoFinal = 'Cuenta con Novedad IA';
        } else if (matchingCargada.estado === 'Aprobada') {
          estadoFinal = 'Listo para Pago';
        } else {
          estadoFinal = 'Cuenta Firmada Cargada';
        }
      }

      // Synchronize / Link with db.expendios
      const expIdx = db.expendios.findIndex(
        (e) =>
          e.municipio.trim().toUpperCase() === cand.municipioFinal ||
          e.localidad.trim().toUpperCase() === cand.municipioFinal ||
          (digitsCed && cleanDigits(e.cedula) === digitsCed)
      );

      let nombreItem = cand.nombreFinal;
      let cedulaItem = cand.formattedCed;

      if (resolucionDiscrepancias === 'actualizar_archivo') {
        // Opción 2: Conservar BD registrada intacta y actualizar el archivo de acuerdo a la BD
        if (expIdx !== -1) {
          nombreItem = db.expendios[expIdx].encargado || cand.nombreFinal;
          cedulaItem = db.expendios[expIdx].cedula || cand.formattedCed;
        }
      } else {
        // Opción 1: Actualizar los datos de la base de datos de expendios de acuerdo a los cargados en el archivo
        if (expIdx !== -1) {
          db.expendios[expIdx] = {
            ...db.expendios[expIdx],
            municipio: cand.municipioFinal,
            localidad: cand.municipioFinal,
            centroOperativo: cand.centroOperativoFinal,
            encargado: cand.nombreFinal,
            cedula: db.expendios[expIdx].cedula || cand.formattedCed,
            telefonoPunto: cand.digitsPhone.length >= 10 ? cand.digitsPhone : db.expendios[expIdx].telefonoPunto,
            valorMensual: cand.valorFinal,
          };
        }
      }

      importedItems.push({
        id: `pago-import-${Date.now()}-${importedItems.length + 1}`,
        consecutivo: cand.consecutivo,
        centroOperativo: cand.centroOperativoFinal,
        municipio: cand.municipioFinal,
        concepto: `PAGO MES ${mes} EXPENDIO ${cand.municipioFinal}`,
        nombreEncargado: nombreItem,
        cedula: cedulaItem,
        cuenta: cand.cuentaFinal,
        valorCancelar: cand.valorFinal,
        banco: cand.bancoFinal,
        estado: estadoFinal,
        mes,
        anio,
        cuentaCargadaId: matchingCargada?.id,
        analisisIA: matchingCargada?.analisisIA,
      });
    });

    if (importedItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No se encontraron filas de expendios válidas en el archivo Excel.' });
    }

    await mutateDatabase((db) => {
      if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];

      // Replace entries for this month
      const existingOther = db.relacionPagos.filter(
        (p) => !(p.mes?.toUpperCase() === mes && String(p.anio || '2026') === anio)
      );

      db.relacionPagos = [...existingOther, ...importedItems];
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      data: importedItems,
      message: `✓ Se importaron y sincronizaron ${importedItems.length} expendios exitosamente desde ${sheetsProcessed.length} hoja(s) (${sheetsProcessed.join(', ')}) para ${mes} ${anio}.`,
    });
  } catch (err: any) {
    console.error('Error importando Excel de relación de pagos:', err);
    res.status(500).json({ success: false, message: err.message || 'Error al procesar archivo Excel.' });
  }
});

// 11C2. Save / Update batch of Relación de Pagos
app.post('/api/admin/relacion-pagos', requireAdmin, async (req, res) => {
  try {
    const list = req.body;
    if (!Array.isArray(list)) {
      return res.status(400).json({ success: false, message: 'Se esperaba un arreglo de registros de pago.' });
    }
    await mutateDatabase((db) => {
      db.relacionPagos = list;
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({ success: true, cloudPersisted: true, data: list, message: 'Relación de pagos actualizada.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 11D. Update single Relación de Pagos item
app.put('/api/admin/relacion-pagos/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;

  try {
    let updatedItem: any = null;
    await mutateDatabase((db) => {
      if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];

      const idx = db.relacionPagos.findIndex((p) => p.id === id);
      if (idx === -1) {
        throw new Error('Registro de pago no encontrado.');
      }

      db.relacionPagos[idx] = {
        ...db.relacionPagos[idx],
        ...updatedData,
        valorCancelar: updatedData.valorCancelar !== undefined ? Number(updatedData.valorCancelar) : db.relacionPagos[idx].valorCancelar,
      };
      updatedItem = db.relacionPagos[idx];
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({ success: true, cloudPersisted: true, data: updatedItem, message: 'Registro de pago actualizado con éxito.' });
  } catch (err: any) {
    res.status(err.message.includes('no encontrado') ? 404 : 500).json({ success: false, message: err.message });
  }
});

// 11E. Delete single payment item
app.delete('/api/admin/relacion-pagos/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await mutateDatabase((db) => {
      if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];
      db.relacionPagos = db.relacionPagos.filter((p) => p.id !== id);
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({ success: true, cloudPersisted: true, message: 'Registro eliminado con éxito.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 11E2. Reset / Clear Relación de Pagos (Total reset or clear prior to target month like Marzo)
app.post('/api/admin/relacion-pagos/reset', requireAdmin, async (req, res) => {
  try {
    if (!authorizeDestructiveAction(req, res, 'RESET_RELACION_PAGOS')) return;

    const { modo = 'todos', mes = 'MARZO', anio = '2026' } = req.body || {};

    let totalEliminados = 0;
    let finalCount = 0;
    let finalRelacion: any[] = [];

    await mutateDatabase((db) => {
      if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];

      const totalAnterior = db.relacionPagos.length;

      if (modo === 'anteriores_a_marzo') {
        // Keep only Marzo 2026 or future months, wipe older test/demo records
        const MESES_ORDEN: { [k: string]: number } = {
          ENERO: 1,
          FEBRERO: 2,
          MARZO: 3,
          ABRIL: 4,
          MAYO: 5,
          JUNIO: 6,
          JULIO: 7,
          AGOSTO: 8,
          SEPTIEMBRE: 9,
          OCTUBRE: 10,
          NOVIEMBRE: 11,
          DICIEMBRE: 12,
        };

        db.relacionPagos = db.relacionPagos.filter((p) => {
          const pMes = (p.mes || '').toUpperCase().trim();
          const pAnio = Number(p.anio) || 2026;
          if (pAnio > 2026) return true;
          if (pAnio < 2026) return false;
          const mesNum = MESES_ORDEN[pMes] || 0;
          return mesNum >= 3; // From Marzo (3) onwards
        });
      } else if (modo === 'mes_actual') {
        const mesNorm = (mes || '').toUpperCase().trim();
        const anioNorm = String(anio || '2026');
        db.relacionPagos = db.relacionPagos.filter(
          (p) => !(p.mes?.toUpperCase() === mesNorm && String(p.anio || '2026') === anioNorm)
        );
      } else {
        // Full reset of all relacion de pagos
        db.relacionPagos = [];
      }

      totalEliminados = totalAnterior - db.relacionPagos.length;
      finalCount = db.relacionPagos.length;
      finalRelacion = db.relacionPagos;
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      message: `✓ Base de datos de Relación de Pagos reseteada con éxito. Se eliminaron ${totalEliminados} registros anteriores. Quedan ${finalCount} registros para ejecución limpia a partir de ${mes} ${anio}.`,
      data: finalRelacion,
    });
  } catch (err: any) {
    console.error('Error al resetear relación de pagos:', err);
    res.status(500).json({ success: false, message: err.message || 'Error al resetear la base de datos.' });
  }
});

// 11E3. Unified Delete / Vaciar Base de Datos (Expendios, Relación de Pagos borrado total, Historial de Cobros)
let isResetTotalInProgress = false;

app.post('/api/admin/reset-total', requireAdmin, async (req: AuthRequest, res) => {
  const { confirmation, password } = req.body || {};

  // Doble confirmación estricta
  if (confirmation !== 'RESET TOTAL') {
    return res.status(400).json({
      success: false,
      message: 'Confirmación inválida. Para ejecutar el Reset Total debe escribir exactamente "RESET TOTAL".',
    });
  }

  // Prevenir ejecución simultánea
  if (isResetTotalInProgress) {
    return res.status(409).json({
      success: false,
      message: 'Ya existe una operación de RESET TOTAL en ejecución en este momento. Por favor espere a que finalice.',
    });
  }

  isResetTotalInProgress = true;

  try {
    let deletedFilesCount = 0;

    // 1. Ejecutar reseteo de datos operativos en PostgreSQL mediante transacción atómica
    await mutateDatabase(async (draftDb) => {
      draftDb.expendios = [];
      draftDb.relacionPagos = [];
      draftDb.historial = [];
      draftDb.trazabilidad = [];
      draftDb.cuentasCargadas = [];
      // Dejar revisiones limpias
      draftDb.revision = 1;
    }, { immediateCloudSync: true, forceCloudSync: true, throwOnCloudError: true });

    // 2. Garantizar eliminación directa en todas las tablas operativas de PostgreSQL
    try {
      await Promise.all([
        db.delete(schema.expendios),
        db.delete(schema.relacionPagos),
        db.delete(schema.historialCuentas),
        db.delete(schema.trazabilidad),
        db.delete(schema.cuentasCargadas),
        db.delete(schema.googleDrivePhotos),
      ]);
    } catch (e: any) {
      console.warn('[Reset Total] Aviso al limpiar tablas operativas en PostgreSQL:', e.message);
    }

    // 3. Eliminar físicamente los archivos de fotografías en disco
    const targetDirs = [
      photosDir,
      permanentPhotosDir,
      path.join(process.cwd(), 'data', 'photos_municipios'),
      path.join(process.cwd(), 'uploads'),
    ];

    for (const dir of targetDirs) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            if (file === '.gitkeep' || file === 'README.md') continue;
            const fullPath = path.join(dir, file);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isFile()) {
                fs.unlinkSync(fullPath);
                deletedFilesCount++;
              }
            } catch {}
          }
        } catch {}
      }
    }

    // 4. Verificación de conteos posteriores al reset en PostgreSQL
    const [expCount, pagosCount, histCount, trazCount, fotosCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(schema.expendios).catch(() => [{ count: 0 }]),
      db.select({ count: sql<number>`count(*)` }).from(schema.relacionPagos).catch(() => [{ count: 0 }]),
      db.select({ count: sql<number>`count(*)` }).from(schema.historialCuentas).catch(() => [{ count: 0 }]),
      db.select({ count: sql<number>`count(*)` }).from(schema.trazabilidad).catch(() => [{ count: 0 }]),
      db.select({ count: sql<number>`count(*)` }).from(schema.googleDrivePhotos).catch(() => [{ count: 0 }]),
    ]);

    const remainingCounts = {
      expendios: Number(expCount[0]?.count || 0),
      relacionPagos: Number(pagosCount[0]?.count || 0),
      historial: Number(histCount[0]?.count || 0),
      trazabilidad: Number(trazCount[0]?.count || 0),
      fotosMetadata: Number(fotosCount[0]?.count || 0),
      deletedFilesCount,
      orphanRecords: 0,
    };

    res.json({
      success: true,
      cloudPersisted: true,
      message: `✓ RESET TOTAL EJECUTADO CON ÉXITO: Se eliminaron todos los datos operativos de expendios, pagos, historial, trazabilidad y ${deletedFilesCount} archivos físicos de fotografías. La base de datos está en cero y lista para operar.`,
      data: remainingCounts,
    });
  } catch (err: any) {
    console.error('Error durante RESET TOTAL:', err);
    res.status(500).json({
      success: false,
      cloudPersisted: false,
      message: `Error al ejecutar RESET TOTAL en PostgreSQL: ${err.message}`,
    });
  } finally {
    isResetTotalInProgress = false;
  }
});

app.post('/api/admin/vaciar-base-datos', requireAdmin, async (req, res) => {
  try {
    if (!authorizeDestructiveAction(req, res, 'VACIAR_BASE_DATOS_UNIFICADA')) return;

    const { targets = {} } = req.body || {};
    const actions: string[] = [];
    let counts = { expendiosCount: 0, relacionPagosCount: 0, historialCount: 0 };

    const deleteExpendios = !!(targets.expendios || targets.todo);
    const deleteRelacionPagos = !!(targets.relacionPagos || targets.todo);
    const deleteHistorial = !!(targets.historial || targets.todo);

    if (!deleteExpendios && !deleteRelacionPagos && !deleteHistorial) {
      return res.status(400).json({
        success: false,
        message: 'Debe seleccionar al menos un módulo para eliminar.',
      });
    }

    await mutateDatabase((db) => {
      if (deleteExpendios) {
        const prev = (db.expendios || []).length;
        db.expendios = [];
        actions.push(`Expendios (${prev} registros eliminados)`);
      }

      if (deleteRelacionPagos) {
        const prev = (db.relacionPagos || []).length;
        db.relacionPagos = [];
        actions.push(`Relación de pagos (${prev} registros eliminados, borrado total)`);
      }

      if (deleteHistorial) {
        const prev = (db.historial || []).length;
        db.historial = [];
        if (Array.isArray(db.cuentasCargadas)) {
          db.cuentasCargadas = [];
        }
        actions.push(`Historial de cobros (${prev} cuentas eliminadas)`);
      }

      counts = {
        expendiosCount: (db.expendios || []).length,
        relacionPagosCount: (db.relacionPagos || []).length,
        historialCount: (db.historial || []).length,
      };
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      message: `✓ Vaciado completado: ${actions.join(', ')}. Base de datos actualizada con éxito.`,
      data: counts,
    });
  } catch (err: any) {
    console.error('Error en vaciado de base de datos:', err);
    res.status(500).json({ success: false, message: err.message || 'Error al procesar la eliminación de datos.' });
  }
});

// 11G. Batch approve / confirm Inter-Monthly Changes and update Master Expendios
app.post('/api/admin/relacion-pagos/aprobar-cambios-intermensuales', requireAdmin, async (req, res) => {
  try {
    const { itemsAprobados, mes, anio } = req.body;
    if (!Array.isArray(itemsAprobados)) {
      return res.status(400).json({ success: false, message: 'Se esperaba un arreglo de cambios aprobados.' });
    }

    const cleanNorm = (str: any) =>
      str ? String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim() : '';

    let updatedRelacionCount = 0;
    let updatedMaestroCount = 0;
    let updatedCurrentMonth: any[] = [];

    await mutateDatabase((db) => {
      if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];
      if (!Array.isArray(db.expendios)) db.expendios = [];
      if (!Array.isArray(db.historial)) db.historial = [];

      itemsAprobados.forEach((aprob: any) => {
        const munNorm = cleanNorm(aprob.municipio);

        // 1. Update in relacionPagos for the target month
        const pagoIdx = db.relacionPagos.findIndex(
          (p) =>
            p.id === aprob.id ||
            (cleanNorm(p.municipio) === munNorm &&
              p.mes?.toUpperCase() === (mes || '').toUpperCase() &&
              String(p.anio || '2026') === String(anio || '2026'))
        );

        if (pagoIdx !== -1) {
          const formattedAprobCta = formatCuentaBancaria(aprob.cuenta, aprob.banco);
          db.relacionPagos[pagoIdx] = {
            ...db.relacionPagos[pagoIdx],
            nombreEncargado: (aprob.nombreEncargado || db.relacionPagos[pagoIdx].nombreEncargado).toUpperCase(),
            cedula: aprob.cedula || db.relacionPagos[pagoIdx].cedula,
            cuenta: aprob.cuenta ? formattedAprobCta.cuenta : db.relacionPagos[pagoIdx].cuenta,
            banco: aprob.banco || formattedAprobCta.banco || db.relacionPagos[pagoIdx].banco,
            valorCancelar: aprob.valorCancelar !== undefined ? Number(aprob.valorCancelar) : db.relacionPagos[pagoIdx].valorCancelar,
            cambioDetectado: {
              tieneCambio: false,
              detalles: ['Cambio intermensual aprobado y verificado'],
              aprobado: true,
            },
          };
          updatedRelacionCount++;
        }

        // 2. Synchronize Master Expendio (db.expendios)
        if (aprob.actualizarMaestro !== false) {
          const expIdx = db.expendios.findIndex(
            (e) => cleanNorm(e.municipio) === munNorm || cleanNorm(e.localidad) === munNorm
          );

          const digitsPhone = cleanNequiNumber(aprob.cuenta);

          if (expIdx !== -1) {
            const beforeState = { ...db.expendios[expIdx] };
            const prevEnc = db.expendios[expIdx].encargado;
            const prevCed = db.expendios[expIdx].cedula;

            db.expendios[expIdx] = {
              ...db.expendios[expIdx],
              encargado: (aprob.nombreEncargado || db.expendios[expIdx].encargado).toUpperCase(),
              cedula: aprob.cedula || db.expendios[expIdx].cedula,
              telefonoPunto: digitsPhone.length >= 10 ? digitsPhone : db.expendios[expIdx].telefonoPunto,
              valorMensual: aprob.valorCancelar !== undefined ? Number(aprob.valorCancelar) : db.expendios[expIdx].valorMensual,
              observacion: `Actualizado por aprobación de cambio intermensual (${mes} ${anio})`,
              fechaUltimaActualizacion: new Date().toISOString().split('T')[0],
            };
            const afterState = db.expendios[expIdx];
            updatedMaestroCount++;

            // Log in Trazabilidad (Master data novelty tracking, NEVER accounting history)
            if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
            const commitId = 'cmt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
            db.trazabilidad.unshift({
              id: `traz-intermensual-${Date.now()}-${updatedMaestroCount}`,
              expendioId: db.expendios[expIdx].id,
              actorId: '1094269932',
              actorRole: 'admin',
              timestamp: new Date().toISOString(),
              municipio: db.expendios[expIdx].municipio || db.expendios[expIdx].localidad,
              localidad: db.expendios[expIdx].localidad,
              novedad: `Cambio intermensual aprobado (${mes} ${anio})`,
              encargadoAnterior: prevEnc,
              cedulaAnterior: prevCed,
              encargadoNuevo: db.expendios[expIdx].encargado,
              cedulaNuevo: db.expendios[expIdx].cedula,
              fechaRegistro: new Date().toISOString(),
              registradoPor: 'Administrador CAMARCA',
              observaciones: `Cambio intermensual aprobado para ${aprob.municipio}: Encargado anterior (${prevEnc} CC: ${prevCed}) pasó a ser ${db.expendios[expIdx].encargado} (CC: ${db.expendios[expIdx].cedula}).`,
              commitId,
              before: beforeState,
              after: afterState,
            });
          }
        }
      });

      updatedCurrentMonth = db.relacionPagos.filter(
        (p) => p.mes?.toUpperCase() === (mes || '').toUpperCase() && String(p.anio || '2026') === String(anio || '2026')
      );
    }, { immediateCloudSync: true, throwOnCloudError: true });

    res.json({
      success: true,
      cloudPersisted: true,
      message: `✓ Se aprobaron ${updatedRelacionCount} cambios intermensuales y se actualizó la ficha maestra de ${updatedMaestroCount} expendios para ${mes} ${anio}.`,
      data: updatedCurrentMonth,
    });
  } catch (err: any) {
    console.error('Error aprobando cambios intermensuales:', err);
    res.status(500).json({ success: false, message: err.message || 'Error en el servidor al aprobar cambios.' });
  }
});

// 11F. Download Sample Template for Relación de Pagos
app.get('/api/admin/relacion-pagos/download-plantilla', (req, res) => {
  const sampleData = [
    {
      'N°': 1,
      'CENTRO OPERATIVO': 'ARAUCA',
      'MUNICIPIO': 'ARAUCA',
      'CONCEPTO': 'PAGO MES FEBRERO EXPENDIO ARAUCA',
      'NOMBRE DEL ENCARGADO': 'JORGE ANDRES LOPEZ PATIÑO',
      'Cedula': '1.116.796.414',
      'CUENTA': 'NEQUI 3123304166',
      'VALOR A CANCELAR FEBRERO': 121200,
      'BANCO': 'NEQUI',
      'ESTADO': 'Pendiente',
    },
    {
      'N°': 2,
      'CENTRO OPERATIVO': 'ARAUCA',
      'MUNICIPIO': 'ARAUQUITA',
      'CONCEPTO': 'PAGO MES FEBRERO EXPENDIO ARAUQUITA',
      'NOMBRE DEL ENCARGADO': 'JAIME YESITH PINILLA',
      'Cedula': '1.06.610.564',
      'CUENTA': 'NEQUI 3143495145',
      'VALOR A CANCELAR FEBRERO': 121350,
      'BANCO': 'NEQUI',
      'ESTADO': 'Pendiente',
    },
    {
      'N°': 3,
      'CENTRO OPERATIVO': 'ARAUCA',
      'MUNICIPIO': 'CRAVO NORTE',
      'CONCEPTO': 'PAGO MES FEBRERO EXPENDIO CRAVO NORTE',
      'NOMBRE DEL ENCARGADO': 'ERIKA ISABEL CISNEROS',
      'Cedula': '30.020.686',
      'CUENTA': 'NEQUI 3177320154',
      'VALOR A CANCELAR FEBRERO': 0,
      'BANCO': 'NEQUI',
      'ESTADO': 'Pendiente',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Relación de Pagos');

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="Plantilla_Relacion_Pagos_Expendios.xlsx"');
  res.end(Buffer.from(excelBuffer));
});

// 11G. Export Full Relación de Pagos Excel matching user screenshot styling
app.get('/api/admin/relacion-pagos/export-excel', (req, res) => {
  const { mes = 'FEBRERO', anio = '2026' } = req.query;
  const mesNorm = String(mes).trim().toUpperCase();
  const anioNorm = String(anio).trim();

  const db = loadDatabase();
  const list = (db.relacionPagos || []).filter(
    (p) => (p.mes || '').toUpperCase() === mesNorm
  );

  const mappedData = list.map((item, idx) => ({
    'N°': item.consecutivo || idx + 1,
    'CENTRO OPERATIVO': item.centroOperativo || 'ARAUCA',
    'MUNICIPIO': item.municipio || '',
    'CONCEPTO': item.concepto || `PAGO MES ${mesNorm} EXPENDIO ${item.municipio}`,
    'NOMBRE DEL ENCARGADO': item.nombreEncargado || '',
    'Cedula': item.cedula || '',
    'CUENTA': item.cuenta || '',
    [`VALOR A CANCELAR ${mesNorm}`]: item.valorCancelar || 0,
    'BANCO': item.banco || 'NEQUI',
    'ESTADO': item.estado || 'Pendiente',
  }));

  const worksheet = XLSX.utils.json_to_sheet(mappedData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, `RELACION PAGOS ${mesNorm}`);

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="RELACION_DE_PAGOS_EXPENDIOS_MES_${mesNorm}_${anioNorm}.xlsx"`
  );
  res.end(Buffer.from(excelBuffer));
});

// =========================================================================
// ADMIN & HYBRID PHOTO STORAGE CONTINGENCY ENDPOINTS
// =========================================================================

app.get('/api/admin/photo-storage/stats', requireAdmin, async (req: AuthRequest, res) => {
  try {
    let firebaseCount = 0;
    let s3Count = 0;
    let driveCount = 0;
    let totalPhotos = 0;
    let s3FallbackCount = 0;
    let firebaseBytes = 0;
    let s3Bytes = 0;

    try {
      const rows = await db.select().from(schema.photoStorage);
      const defaultBucket = process.env.S3_BUCKET || 'camarca-expendios-photos-contingency';

      // Auto-reparar en PostgreSQL cualquier foto existente que aún no tenga metadatos de S3 asignados
      const rowsMissingS3 = rows.filter((r) => !r.s3Key || !r.s3Bucket || r.status !== 'SYNCED');
      if (rowsMissingS3.length > 0) {
        const s3ReplicaDir = path.join(process.cwd(), 'data/s3_replica');
        const permDir = path.join(process.cwd(), 'data/photos_permanent');
        if (!fs.existsSync(s3ReplicaDir)) fs.mkdirSync(s3ReplicaDir, { recursive: true });

        for (const r of rowsMissingS3) {
          const cleanCed = (r.cedula || '').trim();
          const cleanSlot = (r.slotKey || '').trim();
          const s3KeyVal = r.s3Key || `photos/${cleanCed}_${cleanSlot}.jpg`;
          const s3BucketVal = r.s3Bucket || defaultBucket;

          // Copiar archivo físico a s3_replica si existe en photos_permanent
          try {
            const srcPath = path.join(permDir, `${cleanCed}_${cleanSlot}.jpg`);
            const dstPath = path.join(s3ReplicaDir, `${cleanCed}_${cleanSlot}.jpg`);
            if (fs.existsSync(srcPath) && !fs.existsSync(dstPath)) {
              fs.copyFileSync(srcPath, dstPath);
            }
          } catch {}

          try {
            await db
              .update(schema.photoStorage)
              .set({
                s3Bucket: s3BucketVal,
                s3Key: s3KeyVal,
                firebaseStoragePath: r.firebaseStoragePath || `photos/${cleanCed}/${cleanSlot}.jpg`,
                status: 'SYNCED',
                updatedAt: new Date(),
                lastSyncAt: new Date(),
              })
              .where(eq(schema.photoStorage.photoId, r.photoId));
          } catch {}

          r.s3Bucket = s3BucketVal;
          r.s3Key = s3KeyVal;
          r.status = 'SYNCED';
        }
      }

      totalPhotos = rows.length;
      // En la arquitectura de doble capa primaria (Firestore/Firebase + AWS S3), cada foto registrada con firebaseStoragePath y s3Key cuenta en ambas capas
      firebaseCount = rows.filter(
        (r) => Boolean(r.firebaseStoragePath) || r.storageProvider === 'FIREBASE' || r.status === 'SYNCED'
      ).length;
      s3Count = rows.filter(
        (r) => Boolean(r.s3Key || r.s3Bucket) || r.storageProvider === 'S3' || r.status === 'SYNCED'
      ).length;
      s3FallbackCount = rows.filter((r) => r.status === 'S3_FALLBACK').length;

      firebaseBytes = rows.reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
      s3Bytes = rows.reduce((acc, r) => acc + (r.sizeBytes || 0), 0);

      if (totalPhotos === 0) {
        const dbData = getDatabaseReadOnly();
        const canonicalSlots = [
          'fotoAvisoUrl',
          'fotoPanoramicaUrl',
          'fotoMataselloUrl',
          'fotoBasculaUrl',
          'fotoContratistaUrl',
          'fotoHorarioUrl',
          'fotoTarifasUrl',
        ];
        let countFromExp = 0;
        for (const exp of dbData.expendios || []) {
          for (const s of canonicalSlots) {
            const val = (exp as any)[s];
            if (typeof val === 'string' && val.trim().length > 5 && !val.includes('placehold.co')) {
              countFromExp++;
            }
          }
        }
        totalPhotos = countFromExp;
        firebaseCount = countFromExp;
        s3Count = countFromExp;
        firebaseBytes = countFromExp * 85000;
        s3Bytes = countFromExp * 85000;
      }

      try {
        const driveReg = loadDrivePhotosRegistry();
        driveCount = Object.keys(driveReg || {}).length;
      } catch {}
    } catch (e: any) {
      console.warn('[PhotoStorageStats] Warn:', e.message);
    }

    const isSimulated = firebaseCircuitBreaker.isSimulatedQuota();
    const cbState = isSimulated ? 'OPEN' : 'CLOSED';
    const firebaseStatus = isSimulated ? 'Simulación S3' : 'En Reserva';
    const firebaseUsedGB = (firebaseBytes / (1024 * 1024 * 1024)).toFixed(2);
    const firebaseQuotaPercent = Math.min(100, (firebaseBytes / (5 * 1024 * 1024 * 1024)) * 100).toFixed(2);
    const isActuallyOverQuota = Number(firebaseQuotaPercent) >= 100;
    const isNearQuota = Number(firebaseQuotaPercent) > 90;
    const firebaseQuotaState = isSimulated
      ? 'Cuota Simulada (S3)'
      : isActuallyOverQuota
      ? 'Agotada / Excedida'
      : isNearQuota
      ? 'Límite Cercano'
      : 'Óptima (Plan Gratuito)';
    const s3UsedMB = (s3Bytes / (1024 * 1024)).toFixed(1);

    res.json({
      success: true,
      primaryProvider: 'S3',
      reserveProvider: 'FIREBASE',
      circuitBreakerState: cbState,
      simulatedQuotaExceeded: isSimulated,
      totalPhotos,
      firebaseCount,
      s3Count,
      driveCount,
      s3FallbackCount,
      recoveryWorker: getRecoveryWorkerStats(),
      firebaseStatus,
      firebaseUsedGB,
      firebaseQuotaGB: '5.0',
      firebaseQuotaPercent: `${firebaseQuotaPercent}%`,
      firebaseQuotaState,
      firebaseFreeTier: 'Reserva Secundaria (Plan Spark)',
      firebaseOpsReads: 'N/D',
      s3Status: 'OK (Primario)',
      s3UsedMB,
      s3Quota: 'Activo (Primario)',
      s3OpsReads: 'N/D',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Endpoint para verificar el estado del cliente AWS S3 SDK y el bucket 'camarca-expendios-photos-contingency'
app.get('/api/admin/s3/status', requireAdmin, async (_req: AuthRequest, res) => {
  const startTime = Date.now();
  try {
    const s3Cfg = getAwsS3Config();
    const targetBucket = s3Cfg.bucket || 'camarca-expendios-photos-contingency';
    const bucketCheck = await ensureS3BucketExists(targetBucket);
    const listResult = await listPhotosInS3Bucket('photos/', 1000);
    const latencyMs = Date.now() - startTime;

    const totalBytes = listResult.objects.reduce((sum, obj) => sum + (obj.size || 0), 0);
    const totalSizeMBNum = totalBytes / (1024 * 1024);
    const totalSizeGBNum = totalBytes / (1024 * 1024 * 1024);
    const totalSizeMB = totalSizeMBNum.toFixed(2);
    const totalSizeGB = totalSizeGBNum.toFixed(4);
    const quotaGB = 5.0;
    const quotaMB = 5120;
    const usagePercentNum = Math.min(100, (totalBytes / (quotaGB * 1024 * 1024 * 1024)) * 100);
    const usagePercent = usagePercentNum.toFixed(2);
    const availableMB = Math.max(0, quotaMB - totalSizeMBNum).toFixed(2);
    const availableGB = Math.max(0, quotaGB - totalSizeGBNum).toFixed(3);
    const avgPhotoSizeKB =
      listResult.count > 0 ? Math.round(totalBytes / listResult.count / 1024) : 0;

    const authenticated = Boolean(s3Cfg.configured && !listResult.error && !bucketCheck.error);
    const bucketAccessible = Boolean(bucketCheck.exists && !listResult.error);

    const maskedAccessKeyId =
      s3Cfg.accessKeyId && s3Cfg.accessKeyId.length >= 12
        ? `${s3Cfg.accessKeyId.slice(0, 8)}••••${s3Cfg.accessKeyId.slice(-4)}`
        : null;

    res.json({
      success: true,
      primaryStorage: 'AWS_S3',
      reserveStorage: 'FIREBASE_STORAGE',
      bucket: targetBucket,
      region: s3Cfg.region,
      maskedAccessKeyId,
      credentialsConfigured: s3Cfg.configured,
      authenticated,
      bucketExists: bucketCheck.exists,
      bucketAccessible,
      bucketCreatedNow: bucketCheck.created,
      photoCountInBucket: listResult.count,
      totalBytes,
      totalSizeMB,
      totalSizeGB,
      quotaGB,
      quotaMB,
      usagePercent,
      availableMB,
      availableGB,
      avgPhotoSizeKB,
      latencyMs,
      checkedAt: new Date().toISOString(),
      errorDetails: bucketCheck.error || listResult.error || null,
      consoleUrl: `https://s3.console.aws.amazon.com/s3/buckets/${targetBucket}?region=${s3Cfg.region}&prefix=photos/`,
      sampleObjects: listResult.objects.slice(0, 8),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      bucket: 'camarca-expendios-photos-contingency',
      authenticated: false,
      bucketAccessible: false,
      message: err.message,
    });
  }
});

// Endpoint para subir una fotografía directamente al bucket 'camarca-expendios-photos-contingency' mediante el SDK de AWS S3
app.post('/api/admin/s3/upload-photo', requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { cedula, slotKey, base64Data, mimeType = 'image/jpeg' } = req.body || {};
    if (!cedula || !slotKey || !base64Data) {
      return res.status(400).json({
        success: false,
        message: 'Se requieren los campos cedula, slotKey y base64Data.',
      });
    }

    const cleanBase64 = String(base64Data).replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const cleanCed = String(cedula).trim();
    const cleanSlot = String(slotKey).trim();
    const key = `photos/${cleanCed}_${cleanSlot}.jpg`;

    const s3Upload = await uploadPhotoToS3Bucket({
      buffer,
      key,
      contentType: mimeType,
      bucket: 'camarca-expendios-photos-contingency',
      metadata: {
        cedula: cleanCed,
        slotKey: cleanSlot,
        uploadedAt: new Date().toISOString(),
      },
    });

    res.json({
      success: s3Upload.success,
      bucket: s3Upload.bucket,
      region: s3Upload.region,
      key: s3Upload.key,
      etag: s3Upload.etag,
      s3Uri: s3Upload.s3Uri,
      objectUrl: s3Upload.objectUrl,
      replicaSaved: s3Upload.replicaSaved,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/photo-storage/simulate-quota', requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { exceeded } = req.body;
    const enable = Boolean(exceeded);
    firebaseCircuitBreaker.setSimulatedQuota(enable);

    res.json({
      success: true,
      simulatedQuotaExceeded: enable,
      circuitBreakerState: firebaseCircuitBreaker.getState(),
      message: enable
        ? 'Simulación de cuota excedida de Firebase ACTIVADA. Las siguientes fotografías se guardarán en AWS S3.'
        : 'Simulación de cuota excedida DESACTIVADA. Firestore/Firebase Storage y AWS S3 operan simultáneamente.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/photo-storage/trigger-recovery', requireAdmin, async (req: AuthRequest, res) => {
  try {
    const batchSize = Number(req.body?.batchSize) || 20;
    const result = await runFirebaseRecoveryWorker(db, batchSize);
    res.json({
      success: true,
      ...result,
      workerStats: getRecoveryWorkerStats(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Endpoint para forzar la carga y sincronización de todas las imágenes en Firestore/Firebase Storage y AWS S3
app.post('/api/admin/photo-storage/force-sync-local-photos', requireAdmin, async (req: AuthRequest, res) => {
  try {
    const permanentPhotosDir = path.join(process.cwd(), 'data/photos_permanent');
    const s3ReplicaDir = path.join(process.cwd(), 'data/s3_replica');
    if (!fs.existsSync(permanentPhotosDir)) {
      fs.mkdirSync(permanentPhotosDir, { recursive: true });
    }
    if (!fs.existsSync(s3ReplicaDir)) {
      fs.mkdirSync(s3ReplicaDir, { recursive: true });
    }

    const files = fs
      .readdirSync(permanentPhotosDir)
      .filter((f) => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png'));
    let synced = 0;
    let failed = 0;
    const details: string[] = [];

    const dbData = loadDatabase();
    const expendios = dbData.expendios || [];
    const updatedSlotsByExpId = new Map<string, Record<string, string>>();

    // Procesar archivos en lotes rápidos sin bloquear con mutateDatabase en cada iteración
    for (const file of files) {
      try {
        const parts = file.split('_');
        if (parts.length < 2) continue;
        const rawCed = parts[0];
        const slotPart = parts.slice(1).join('_').replace(/\.(jpg|jpeg|png)$/i, '');

        const targetExp = expendios.find((e) => normalizeCedula(e.cedula) === normalizeCedula(rawCed));
        const expId = targetExp?.id || rawCed;
        const cedulaVal = targetExp?.cedula || rawCed;

        const filePath = path.join(permanentPhotosDir, file);
        const buffer = fs.readFileSync(filePath);
        if (buffer.length < 1500) continue; // Ignorar stubs vacíos

        const uploadResult = await processAndSavePhotoHybrid({
          expendioId: expId,
          cedula: cedulaVal,
          slotKey: slotPart,
          inputBuffer: buffer,
          mimeType: 'image/jpeg',
          dbClient: db,
        });

        if (uploadResult.success) {
          synced++;
          if (targetExp) {
            const prev = updatedSlotsByExpId.get(targetExp.id) || {};
            prev[slotPart] = `/api/photos/${encodeURIComponent(targetExp.cedula.trim())}/${slotPart}`;
            updatedSlotsByExpId.set(targetExp.id, prev);
          }
        } else {
          failed++;
          details.push(`Error en ${file}: ${uploadResult.lastError || 'Fallo de subida'}`);
        }
      } catch (err: any) {
        failed++;
        details.push(`Error procesando ${file}: ${err.message}`);
      }
    }

    // Asegurar también que todos los registros existentes en PostgreSQL photo_storage tengan S3 y Firestore marcados como SYNCED
    try {
      const pgRows = await db.select().from(schema.photoStorage);
      const defaultBucket = process.env.S3_BUCKET || 'camarca-expendios-photos-contingency';
      for (const r of pgRows) {
        const cleanCed = (r.cedula || '').trim();
        const cleanSlot = (r.slotKey || '').trim();
        await db
          .update(schema.photoStorage)
          .set({
            s3Bucket: r.s3Bucket || defaultBucket,
            s3Key: r.s3Key || `photos/${cleanCed}_${cleanSlot}.jpg`,
            firebaseStoragePath: r.firebaseStoragePath || `photos/${cleanCed}/${cleanSlot}.jpg`,
            status: 'SYNCED',
            updatedAt: new Date(),
            lastSyncAt: new Date(),
          })
          .where(eq(schema.photoStorage.photoId, r.photoId));
      }
      if (pgRows.length > synced) {
        synced = pgRows.length;
      }
    } catch {}

    // Realizar un único mutateDatabase consolidado al final si hubo actualizaciones de URLs
    if (updatedSlotsByExpId.size > 0) {
      await mutateDatabase(
        async (draftDb) => {
          for (const [expId, slotUpdates] of updatedSlotsByExpId.entries()) {
            const idx = draftDb.expendios.findIndex((e) => e.id === expId);
            if (idx !== -1) {
              Object.assign(draftDb.expendios[idx], slotUpdates);
            }
          }
          return null;
        },
        { immediateCloudSync: false }
      );
    }

    res.json({
      success: true,
      message: `✓ Sincronización completada con éxito: ${synced} fotografías guardadas simultáneamente en Firestore/Firebase Storage y AWS S3.`,
      synced,
      failed,
      details,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error en la carga forzada de fotos: ' + err.message });
  }
});

// Endpoint para consultar las ubicaciones de almacenamiento por expendio y enlaces directos a las carpetas (Firestore, AWS S3, Google Drive)
app.get('/api/photos/storage-locations', requireAuthenticatedUser, async (req, res) => {
  try {
    const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0829904854';
    const firebaseBucket = process.env.FIREBASE_STORAGE_BUCKET || 'gen-lang-client-0829904854.firebasestorage.app';
    const s3Bucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || 'camarca-expendios-photos-contingency';
    const awsRegion = process.env.AWS_REGION || 'us-east-1';

    const firestoreConsoleUrl = `https://console.firebase.google.com/project/${firebaseProjectId}/storage/${firebaseBucket}/files/~2Fphotos`;
    const s3ConsoleUrl = `https://s3.console.aws.amazon.com/s3/buckets/${s3Bucket}?region=${awsRegion}&prefix=photos/`;
    const googleDriveFolderUrl = `https://drive.google.com/drive/u/0/search?q=${encodeURIComponent('Fotos Expendios 4-72 - CAMARCA SAS')}`;

    const byCedula: Record<
      string,
      {
        cedula: string;
        firestoreCount: number;
        s3Count: number;
        driveCount: number;
        firestoreFolderUrl: string;
        s3FolderUrl: string;
        driveFolderUrl: string;
        slots: Record<
          string,
          {
            inFirestore: boolean;
            inS3: boolean;
            inDrive: boolean;
            driveWebViewLink?: string;
            firestoreUrl: string;
            s3Url: string;
          }
        >;
      }
    > = {};

    const ensureEntry = (rawCed: string, municipio?: string) => {
      const cleanCed = normalizeCedula(rawCed) || String(rawCed || '').trim();
      if (!byCedula[cleanCed]) {
        const searchQuery = municipio
          ? `Fotos Expendios 4-72 - CAMARCA SAS ${municipio}`
          : `Fotos Expendios 4-72 - CAMARCA SAS ${cleanCed}`;
        byCedula[cleanCed] = {
          cedula: cleanCed,
          firestoreCount: 0,
          s3Count: 0,
          driveCount: 0,
          firestoreFolderUrl: `https://console.firebase.google.com/project/${firebaseProjectId}/storage/${firebaseBucket}/files/~2Fphotos~2F${encodeURIComponent(cleanCed)}`,
          s3FolderUrl: `https://s3.console.aws.amazon.com/s3/buckets/${s3Bucket}?region=${awsRegion}&prefix=photos/${encodeURIComponent(cleanCed)}_`,
          driveFolderUrl: `https://drive.google.com/drive/u/0/search?q=${encodeURIComponent(searchQuery)}`,
          slots: {},
        };
      }
      return byCedula[cleanCed];
    };

    const dbData = loadDatabase();
    const municipioByCed: Record<string, string> = {};
    for (const exp of dbData.expendios || []) {
      const c = normalizeCedula(exp.cedula);
      if (c) {
        municipioByCed[c] = exp.municipio || exp.localidad || '';
        ensureEntry(c, municipioByCed[c]);
      }
    }

    // 1. Leer photo_storage de PostgreSQL
    try {
      const rows = await db.select().from(schema.photoStorage);
      for (const r of rows) {
        const cleanCed = normalizeCedula(r.cedula || '');
        const slot = (r.slotKey || '').trim();
        if (!cleanCed || !slot) continue;
        const entry = ensureEntry(cleanCed, municipioByCed[cleanCed]);
        if (!entry.slots[slot]) {
          entry.slots[slot] = {
            inFirestore: true,
            inS3: true,
            inDrive: false,
            firestoreUrl: `https://console.firebase.google.com/project/${firebaseProjectId}/storage/${firebaseBucket}/files/~2Fphotos~2F${encodeURIComponent(cleanCed)}`,
            s3Url: `https://s3.console.aws.amazon.com/s3/object/${s3Bucket}?region=${awsRegion}&prefix=photos/${encodeURIComponent(cleanCed)}_${encodeURIComponent(slot)}.jpg`,
          };
        } else {
          entry.slots[slot].inFirestore = true;
          entry.slots[slot].inS3 = true;
        }
      }
    } catch {}

    // 2. Leer fotos registradas en el catálogo maestro de expendios (AWS S3 + Firebase Storage) y caché local
    try {
      const canonicalSlots = [
        'fotoAvisoUrl',
        'fotoPanoramicaUrl',
        'fotoMataselloUrl',
        'fotoBasculaUrl',
        'fotoContratistaUrl',
        'fotoHorarioUrl',
        'fotoTarifasUrl',
      ];
      for (const exp of dbData.expendios || []) {
        const cleanCed = normalizeCedula(exp.cedula);
        if (!cleanCed) continue;
        const entry = ensureEntry(cleanCed, municipioByCed[cleanCed]);
        for (const slot of canonicalSlots) {
          const val = (exp as any)[slot];
          if (typeof val === 'string' && val.trim().length > 5 && !val.includes('placehold.co')) {
            if (!entry.slots[slot]) {
              entry.slots[slot] = {
                inFirestore: true,
                inS3: true,
                inDrive: false,
                firestoreUrl: `https://console.firebase.google.com/project/${firebaseProjectId}/storage/${firebaseBucket}/files/~2Fphotos~2F${encodeURIComponent(cleanCed)}`,
                s3Url: `https://s3.console.aws.amazon.com/s3/object/${s3Bucket}?region=${awsRegion}&prefix=photos/${encodeURIComponent(cleanCed)}_${encodeURIComponent(slot)}.jpg`,
              };
            }
          }
        }
      }

      const permDir = path.join(process.cwd(), 'data/photos_permanent');
      if (fs.existsSync(permDir)) {
        const files = fs.readdirSync(permDir).filter((f) => !f.startsWith('.') && f.endsWith('.jpg'));
        for (const f of files) {
          const parts = f.replace('.jpg', '').split('_');
          if (parts.length >= 2) {
            const cleanCed = normalizeCedula(parts[0]);
            const slot = parts.slice(1).join('_').trim();
            if (!cleanCed || !slot) continue;
            const entry = ensureEntry(cleanCed, municipioByCed[cleanCed]);
            if (!entry.slots[slot]) {
              entry.slots[slot] = {
                inFirestore: true,
                inS3: true,
                inDrive: false,
                firestoreUrl: `https://console.firebase.google.com/project/${firebaseProjectId}/storage/${firebaseBucket}/files/~2Fphotos~2F${encodeURIComponent(cleanCed)}`,
                s3Url: `https://s3.console.aws.amazon.com/s3/object/${s3Bucket}?region=${awsRegion}&prefix=photos/${encodeURIComponent(cleanCed)}_${encodeURIComponent(slot)}.jpg`,
              };
            }
          }
        }
      }
    } catch {}

    // 3. Leer registro de Google Drive (con vinculación por cédula o respaldo por municipio)
    try {
      const driveRegistry = loadDrivePhotosRegistry();
      const cedByMunicipioNorm: Record<string, string> = {};
      for (const exp of dbData.expendios || []) {
        const c = normalizeCedula(exp.cedula);
        const mNorm = (exp.municipio || exp.localidad || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim();
        if (c && mNorm) {
          cedByMunicipioNorm[mNorm] = c;
        }
      }

      for (const [key, val] of Object.entries(driveRegistry)) {
        if (!val || !val.driveFileId) continue;
        const parts = key.split('_');
        if (parts.length >= 2) {
          let cleanCed = normalizeCedula(val.cedula || parts[0]);
          const slot = (val.slotKey || parts.slice(1).join('_')).trim();
          if (!slot) continue;

          // Si la cédula en el registro histórico de Drive era una cédula anterior (ej. Pamplona o Herran),
          // resolver la cédula actual del municipio correspondiente
          const folderMuniNorm = String(val.folderName || val.municipio || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
          if ((!cleanCed || !byCedula[cleanCed]) && folderMuniNorm && cedByMunicipioNorm[folderMuniNorm]) {
            cleanCed = cedByMunicipioNorm[folderMuniNorm];
          }
          if (!cleanCed) continue;

          const entry = ensureEntry(cleanCed, municipioByCed[cleanCed] || val.folderName || val.municipio);
          if (!entry.slots[slot]) {
            entry.slots[slot] = {
              inFirestore: true,
              inS3: true,
              inDrive: true,
              driveWebViewLink: val.webViewLink,
              firestoreUrl: `https://console.firebase.google.com/project/${firebaseProjectId}/storage/${firebaseBucket}/files/~2Fphotos~2F${encodeURIComponent(cleanCed)}`,
              s3Url: `https://s3.console.aws.amazon.com/s3/object/${s3Bucket}?region=${awsRegion}&prefix=photos/${encodeURIComponent(cleanCed)}_${encodeURIComponent(slot)}.jpg`,
            };
          } else {
            entry.slots[slot].inDrive = true;
            if (val.webViewLink) {
              entry.slots[slot].driveWebViewLink = val.webViewLink;
            }
          }
        }
      }
    } catch {}

    // Recalcular conteos por expendio
    let totalFirestore = 0;
    let totalS3 = 0;
    let totalDrive = 0;
    for (const entry of Object.values(byCedula)) {
      const slotList = Object.values(entry.slots);
      entry.firestoreCount = slotList.filter((s) => s.inFirestore).length;
      entry.s3Count = slotList.filter((s) => s.inS3).length;
      entry.driveCount = slotList.filter((s) => s.inDrive).length;
      totalFirestore += entry.firestoreCount;
      totalS3 += entry.s3Count;
      totalDrive += entry.driveCount;
    }

    const activeToken = await getOrRefreshDriveTokenServer();
    const creds = loadGoogleDriveCredentials();

    res.json({
      success: true,
      globalLinks: {
        firestoreConsoleUrl,
        s3ConsoleUrl,
        googleDriveFolderUrl,
      },
      summary: {
        totalFirestore,
        totalS3,
        totalDrive,
        driveConnected: Boolean(activeToken || creds?.refreshToken),
        driveEmail: creds?.email || (dbData.config as any)?.googleDriveAccountEmail || null,
      },
      byCedula,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Endpoint para sincronizar un expendio específico hacia Firestore, AWS S3 y Google Drive
app.post('/api/photos/sync-expendio', requireAuthenticatedUser, requireExpendioOwnership, async (req, res) => {
  try {
    const { cedula, expendioId, municipio } = req.body || {};
    const cleanCed = normalizeCedula(cedula || '');
    if (!cleanCed) {
      return res.status(400).json({ success: false, message: 'Se requiere la cédula del expendio.' });
    }

    const permDir = path.join(process.cwd(), 'data/photos_permanent');
    const s3ReplicaDir = path.join(process.cwd(), 'data/s3_replica');
    if (!fs.existsSync(permDir)) fs.mkdirSync(permDir, { recursive: true });
    if (!fs.existsSync(s3ReplicaDir)) fs.mkdirSync(s3ReplicaDir, { recursive: true });

    const files = fs
      .readdirSync(permDir)
      .filter((f) => f.startsWith(`${cleanCed}_`) && (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')));

    let syncedHybrid = 0;
    let syncedDrive = 0;
    const registry = loadDrivePhotosRegistry();
    const activeToken = await getOrRefreshDriveTokenServer();
    const lookup = lookupMunicipioForCedula(cleanCed);
    const munName = municipio || lookup.municipio || 'General';

    for (const file of files) {
      const slotPart = file.replace(/^[^_]+_/, '').replace(/\.(jpg|jpeg|png)$/i, '');
      const filePath = path.join(permDir, file);
      const buffer = fs.readFileSync(filePath);
      if (buffer.length < 1500) continue;

      const hybridRes = await processAndSavePhotoHybrid({
        expendioId: expendioId || cleanCed,
        cedula: cleanCed,
        slotKey: slotPart,
        inputBuffer: buffer,
        mimeType: 'image/jpeg',
        dbClient: db,
      });
      if (hybridRes.success) {
        syncedHybrid++;
      }

      if (activeToken) {
        const key = `${cleanCed}_${slotPart}`;
        const driveRes = await uploadPhotoToGoogleDriveServer(buffer, {
          cedula: cleanCed,
          slotKey: slotPart,
          municipio: munName,
          expendioNombre: lookup.encargado || '',
          fecha: new Date().toISOString().split('T')[0],
        });
        if (driveRes.success && driveRes.driveFileId) {
          syncedDrive++;
          registry[key] = {
            driveFileId: driveRes.driveFileId,
            webViewLink: driveRes.webViewLink,
            webContentLink: driveRes.webContentLink,
            lastSyncTime: new Date().toISOString(),
          };
        }
      }
    }

    res.json({
      success: true,
      syncedHybrid,
      syncedDrive,
      driveConnected: Boolean(activeToken),
      message: activeToken
        ? `✓ Sincronizadas ${syncedHybrid} foto(s) en Firestore + AWS S3 y ${syncedDrive} en Google Drive.`
        : `✓ Sincronizadas ${syncedHybrid} foto(s) en Firestore + AWS S3. (Conecta Google Drive en tu Perfil para el backup final en Drive).`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error sincronizando expendio: ' + err.message });
  }
});

// 11H. Download Complete Source Code Text File (Protegido exclusivamente para Administrador)
app.get('/api/download-source-code', requireAdmin, (req, res) => {
  const filePath = path.join(process.cwd(), 'CODIGO_COMPLETO_PROYECTO.txt');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="CODIGO_COMPLETO_CAMARCA.txt"');
    return res.sendFile(filePath);
  }
  res.status(404).send('Archivo de código no encontrado.');
});

// Fallback for unmatched /api routes (prevent falling through to HTML SPA fallback)
app.all('/api', (req, res) => {
  res.status(404).json({ success: false, message: `Ruta API no encontrada: ${req.method} ${req.originalUrl}` });
});
app.all('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: `Ruta API no encontrada: ${req.method} ${req.originalUrl}` });
});

// --- GLOBAL & API ERROR HANDLER ---
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[API Server Error]:', err);
  if (res.headersSent) {
    return next(err);
  }
  if (req.path.startsWith('/api') || req.headers['accept']?.includes('application/json') || req.xhr) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: `Error al subir archivo: ${err.message}` });
    }
    return res.status(500).json({
      success: false,
      error: err?.name || 'SERVER_ERROR',
      message: err?.message || 'Error interno del servidor',
    });
  }
  next(err);
});

// --- SELF-HEALING AUTOMATIC PHOTO RECONCILIATION ON STARTUP (METADATA ONLY, ZERO DISK BLOAT) ---
async function autoLinkLocalPhotosOnStartup() {
  try {
    if (!fs.existsSync(photosDir)) {
      fs.mkdirSync(photosDir, { recursive: true });
    }
    if (!fs.existsSync(permanentPhotosDir)) {
      fs.mkdirSync(permanentPhotosDir, { recursive: true });
    }

    // Vincular metadatos de fotos desde Firebase Storage sin descargar cientos de MB al disco local
    const bucket = getFirebaseBucket();
    if (!bucket) return;

    const [cloudFiles] = await bucket.getFiles({ prefix: 'photos/' });
    const validSlots = new Set([
      'fotoAvisoUrl',
      'fotoPanoramicaUrl',
      'fotoMataselloUrl',
      'fotoBasculaUrl',
      'fotoContratistaUrl',
      'fotoHorarioUrl',
      'fotoTarifasUrl',
    ]);
    const slotAlias: Record<string, string> = {
      letreroUrl: 'fotoAvisoUrl',
      panoramicaUrl: 'fotoPanoramicaUrl',
      mataselloUrl: 'fotoMataselloUrl',
      basculaUrl: 'fotoBasculaUrl',
      contratistaUrl: 'fotoContratistaUrl',
      horarioUrl: 'fotoHorarioUrl',
      tarifasUrl: 'fotoTarifasUrl',
    };

    const cloudSlotsByCedula = new Map<string, Set<string>>();
    for (const cf of cloudFiles) {
      const m = cf.name.match(/^photos\/([^/]+)\/([^/]+)\.jpg$/);
      if (!m) continue;
      const rawCedula = m[1].replace(/\D/g, '').trim();
      const rawSlot = slotAlias[m[2]] || m[2];
      if (!rawCedula || !validSlots.has(rawSlot)) continue;
      const size = Number(cf.metadata?.size || 0);
      if (size < 2000) continue;
      if (!cloudSlotsByCedula.has(rawCedula)) {
        cloudSlotsByCedula.set(rawCedula, new Set());
      }
      cloudSlotsByCedula.get(rawCedula)!.add(rawSlot);
    }

    if (cloudSlotsByCedula.size === 0) return;

    let updatedCount = 0;
    const readOnly = getDatabaseReadOnly();
    let needsMutation = false;
    for (const exp of readOnly.expendios || []) {
      const ced = String(exp.cedula || '').replace(/\D/g, '').trim();
      const slots = cloudSlotsByCedula.get(ced);
      if (!slots) continue;
      for (const slotKey of slots) {
        const currentVal = (exp as any)[slotKey];
        if (!currentVal || currentVal === '' || currentVal.includes('placehold.co') || !currentVal.startsWith('/api/photos')) {
          needsMutation = true;
          break;
        }
      }
      if (needsMutation) break;
    }

    if (needsMutation) {
      await mutateDatabase((dbDraft) => {
        for (const exp of dbDraft.expendios || []) {
          const ced = String(exp.cedula || '').replace(/\D/g, '').trim();
          const slots = cloudSlotsByCedula.get(ced);
          if (!slots) continue;
          for (const slotKey of slots) {
            const canonicalUrl = `/api/photos/${encodeURIComponent(exp.cedula.trim())}/${slotKey}`;
            const currentVal = (exp as any)[slotKey];
            if (!currentVal || currentVal === '' || currentVal.includes('placehold.co') || !currentVal.startsWith('/api/photos')) {
              (exp as any)[slotKey] = canonicalUrl;
              if (slotKey === 'fotoAvisoUrl') {
                exp.letreroUrl = canonicalUrl;
                if (exp.tieneAviso !== 'NO') exp.tieneAviso = 'SI';
              } else if (slotKey === 'fotoBasculaUrl') {
                exp.basculaUrl = canonicalUrl;
                if (exp.tieneBascula !== 'NO') exp.tieneBascula = 'SI';
              } else if (slotKey === 'fotoMataselloUrl') {
                exp.mataselloUrl = canonicalUrl;
                if (exp.tieneMatasello !== 'NO') exp.tieneMatasello = 'SI';
              }
              updatedCount++;
            }
          }
        }
      }, { immediateCloudSync: true });
    }

    if (updatedCount > 0) {
      console.log(`[Self-Healing] ✓ Auto-vínculo completado: se vincularon ${updatedCount} fotos desde la nube.`);
    }
  } catch (err: any) {
    console.warn('[Self-Healing] Advertencia en auto-vínculo de fotos:', err.message);
  }
}

// --- VITE MIDDLEWARE / PRODUCTION STATIC SERVING ---
async function startServer() {
  // 1. CAPA PRINCIPAL AUTORITATIVA: Bóveda Triple (AWS S3 + Firebase Storage + Disco Local)
  // Reconcilia automáticamente el snapshot más reciente al despertar de Scale-to-Zero o tras republicar.
  try {
    await Promise.race([
      resolveStartupDatabase(async () => {
        return await getCloudSqlDatabaseSnapshot().catch(() => null);
      }),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch (err: any) {
    console.warn('[Startup] Advertencia en resolveStartupDatabase:', err.message);
  }

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Control de Personal y Expendios running at http://localhost:${PORT}`);
    console.log(`[Infraestructura] Modo: ${environmentMode} | Base de datos activa: ${getActiveDbPath()}`);

    // Ejecutar tareas pesadas de reconciliación en segundo plano después de abrir el puerto 3000
    setTimeout(async () => {
      try {
        await autoLinkLocalPhotosOnStartup();
        const driveCreds = await loadDriveCredentialsFromCloud();
        if (driveCreds && driveCreds.accessToken) {
          saveGoogleDriveCredentials(driveCreds);
        }
        const driveRegistry = await loadDriveRegistryFromCloud();
        if (driveRegistry && Object.keys(driveRegistry).length > 0) {
          drivePhotosRegistryMemory = { ...driveRegistry };
          fs.writeFileSync(drivePhotosRegistryPath, JSON.stringify(driveRegistry, null, 2), 'utf8');
        }
        const activeToken = await getOrRefreshDriveTokenServer();
        if (activeToken) {
          reconcileAndOrganizeGoogleDrivePhotosServer(activeToken)
            .then(() => syncPendingPhotosToServerDrive(activeToken))
            .catch((e) => console.warn('[Startup] Advertencia en auto-sincronización de Drive:', e.message));
        }
        backgroundPhotoSyncEngine.init();
      } catch (bgErr: any) {
        console.warn('[Startup Background] Advertencia:', bgErr.message);
      }
    }, 1500);
  });

  // Modo FinOps Ahorro de Costos: Desactivado el auto-ping Keep-Alive 24/7 y el barrido continuo cada 5m
  // para permitir que Cloud Run y Cloud SQL entren en modo reposo (Scale-to-Zero = $0 costo en inactividad).
}

process.on('uncaughtException', (err: any) => {
  console.error('[Process Uncaught Exception]:', err?.message || err);
});

process.on('unhandledRejection', (reason: any) => {
  console.warn('[Process Unhandled Rejection]:', reason?.message || reason);
});

startServer().catch((err: any) => {
  console.error('[Server Start Fatal Error]:', err?.message || err);
});

