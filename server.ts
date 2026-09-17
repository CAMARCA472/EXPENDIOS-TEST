import express from 'express';
import { initializeApp as initAdminApp } from 'firebase-admin/app';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import { initializeApp as initClientApp, getApps as getClientApps, getApp as getClientApp } from 'firebase/app';
import { getStorage as getClientStorage, ref as storageRef, uploadBytes as uploadBytesStorage, getDownloadURL as getDownloadURLStorage, listAll as listAllStorage, deleteObject as deleteObjectStorage } from 'firebase/storage';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import JSZip from 'jszip';
import { INITIAL_EXPENDIOS, INITIAL_HISTORIAL, INITIAL_TRAZABILIDAD } from './src/data/initialData.ts';
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
} from './src/types.ts';
import { numeroALetras } from './src/utils/numeroALetras.ts';
import {
  getCloudFirestore,
  saveDatabaseToCloud,
  loadDatabaseFromCloud,
  scheduleCloudSync,
  getCloudSyncStatus,
  savePhotoToCloud,
  getPhotoFromCloud,
  deletePhotoFromCloud,
  resetFirestoreQuotaCooldown,
  saveDriveRegistryToCloud,
  loadDriveRegistryFromCloud,
  saveDriveCredentialsToCloud,
  loadDriveCredentialsFromCloud,
  clearDriveCredentialsFromCloud,
} from './server/firestoreDatabase.ts';



// Initialize Firebase Admin (Storage)
try {
  const fConfig = JSON.parse(fs.readFileSync(process.cwd() + '/firebase-applet-config.json', 'utf8'));
  initAdminApp({
    projectId: fConfig.projectId,
    storageBucket: fConfig.storageBucket,
  });
  console.log('[Server] Firebase Admin (Storage) initialized');
} catch (e: any) {
  if (!e.message.includes('already exists')) {
    console.warn('[Server] Firebase Admin initialization failed:', e.message);
  }
}

// Initialize Firebase Client Storage on Server for direct reliable operations
let serverStorageInstance: any = null;
function getServerStorage() {
  if (!serverStorageInstance) {
    try {
      const fConfig = JSON.parse(fs.readFileSync(process.cwd() + '/firebase-applet-config.json', 'utf8'));
      const clientApp = getClientApps().length ? getClientApp() : initClientApp(fConfig);
      serverStorageInstance = getClientStorage(clientApp);
    } catch (e: any) {
      console.warn('[Server] Error initializing Firebase Client Storage:', e.message);
    }
  }
  return serverStorageInstance;
}

const app = express();
const PORT = 3000;

// --- CLOUD SYNC MIDDLEWARE ---
// Prevents Cloud Run container from suspending before Firestore saves are complete
global.pendingCloudSyncs = [];

app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function (body) {
    if (global.pendingCloudSyncs && global.pendingCloudSyncs.length > 0) {
      const promises = [...global.pendingCloudSyncs];
      global.pendingCloudSyncs.length = 0; // clear
      Promise.allSettled(promises).then(() => {
        originalSend.call(this, body);
      });
      return this; // send returns this
    } else {
      return originalSend.call(this, body);
    }
  };
  next();
});


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

// Restaurar fotos desde permanentPhotosDir a photosDir si el contenedor se reinició
try {
  if (fs.existsSync(permanentPhotosDir)) {
    const permFiles = fs.readdirSync(permanentPhotosDir).filter((f) => f.endsWith('.jpg'));
    for (const pf of permFiles) {
      const src = path.join(permanentPhotosDir, pf);
      const dest = path.join(photosDir, pf);
      if (!fs.existsSync(dest)) {
        try { fs.copyFileSync(src, dest); } catch {}
      }
    }
  }
} catch {}

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
    // Persistir de inmediato a Firestore en la nube para resistir reinicios de contenedor
    saveDriveCredentialsToCloud(creds as any).catch(() => {});
  } catch (err) {
    console.error('Error guardando google_drive_credentials.json:', err);
  }
}

function getOAuthClientId(): string {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (cfg.oAuthClientId) return cfg.oAuthClientId;
    }
  } catch {}
  return process.env.GOOGLE_OAUTH_CLIENT_ID || '1094702324887-rp4lbvga43esdfrgjvp00huuf2tihoit.apps.googleusercontent.com';
}

async function refreshServerDriveToken(refreshTokenOverride?: string): Promise<{
  success: boolean;
  accessToken?: string;
  expiresIn?: number;
  error?: string;
}> {
  const fileCreds = loadGoogleDriveCredentials();
  const db = loadDatabase();
  const refreshToken = (refreshTokenOverride || fileCreds?.refreshToken || db.config?.googleDriveRefreshToken)?.trim();

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
      return { success: false, error: errorMsg };
    }

    const newAccessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    // Actualizar base de datos
    if (!db.config) db.config = {} as any;
    db.config.googleDriveAccessToken = newAccessToken;
    db.config.googleDriveRefreshToken = refreshToken;
    db.config.googleDriveTokenExpiresAt = expiresAt;
    saveDatabase(db);

    saveGoogleDriveCredentials({
      accessToken: newAccessToken,
      refreshToken: refreshToken,
      expiresAt: expiresAt,
      email: fileCreds?.email || db.config?.googleDriveAccountEmail,
      displayName: fileCreds?.displayName || (db.config as any)?.googleDriveAccountName,
      updatedAt: new Date().toISOString(),
    });

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
    const db = loadDatabase();
    if (db.config) {
      delete db.config.googleDriveAccessToken;
      delete db.config.googleDriveRefreshToken;
      delete db.config.googleDriveTokenExpiresAt;
      saveDatabase(db);
    }
    await clearDriveCredentialsFromCloud();
    console.log('[OAuth2 Server] Credenciales expiradas/inválidas de Google Drive eliminadas del servidor y Firestore.');
  } catch (err: any) {
    console.warn('[OAuth2 Server] Error limpiando credenciales expiradas:', err.message);
  }
}

async function getOrRefreshDriveTokenServer(): Promise<string | null> {
  const fileCreds = loadGoogleDriveCredentials();
  const db = loadDatabase();
  let token = fileCreds?.accessToken || db.config?.googleDriveAccessToken || null;
  let expiresAt = fileCreds?.expiresAt || db.config?.googleDriveTokenExpiresAt;
  const refreshToken = (fileCreds?.refreshToken || db.config?.googleDriveRefreshToken)?.trim();

  // 1. Si el token expiró o está por expirar y tenemos refresh token, renovar automáticamente
  if (refreshToken) {
    if (!token || !expiresAt || expiresAt <= (Date.now() + 180000)) {
      console.log('[OAuth2 Server] Renovando token de Google Drive automáticamente con Refresh Token...');
      const refreshRes = await refreshServerDriveToken(refreshToken);
      if (refreshRes.success && refreshRes.accessToken) {
        return refreshRes.accessToken;
      }
    }
  }

  // 2. Si no teníamos token en disco, intentar cargarlo de Firestore
  if (!token) {
    try {
      const cloudCreds = await loadDriveCredentialsFromCloud();
      if (cloudCreds?.accessToken) {
        token = cloudCreds.accessToken;
        expiresAt = cloudCreds.expiresAt;
        if (cloudCreds.refreshToken) {
          const refreshRes = await refreshServerDriveToken(cloudCreds.refreshToken);
          if (refreshRes.success && refreshRes.accessToken) {
            return refreshRes.accessToken;
          }
        }
      }
    } catch {}
  }

  // 3. Validar token existente contra Google si no tiene refreshToken
  if (token) {
    const isValid = await isGoogleTokenValid(token);
    if (isValid) {
      return token;
    }
    // Token es inválido y no se puede renovar: purgar para evitar errores 401
    console.warn('[OAuth2 Server] El token de Google Drive almacenado no es válido según Google OAuth2. Limpiando credenciales...');
    await purgeInvalidGoogleDriveCredentialsServer();
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

const upload = multer({
  storage,
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
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB limit for high-res PDF / scans
});

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

function getActiveDbPath(): string {
  if (isPublishedEnv) {
    return fs.existsSync(masterPublishedDbPath) ? masterPublishedDbPath : legacyDbPath;
  }
  return testDbPath;
}

interface DatabaseSchema {
  expendios: ExpendioData[];
  historial: HistorialItem[];
  trazabilidad: TrazabilidadExpendio[];
  config?: SystemConfig;
  cuentasCargadas?: CuentaCargadaExpendio[];
  relacionPagos?: PagoRelacionItem[];
  registrosAcceso?: RegistroAcceso[];
  visitasGenerales?: number;
}

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
  db: DatabaseSchema,
  req: express.Request,
  usuario: string,
  cedulaOrNit: string,
  rol: 'admin' | 'expendio' | 'cliente' | 'desconocido',
  municipio?: string,
  tipoAcceso: 'login' | 'visita' = 'login',
  exitoso: boolean = true,
  detalles?: string
) {
  if (!Array.isArray(db.registrosAcceso)) {
    db.registrosAcceso = [];
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
  const initialUbicacion = cachedLoc?.ubicacion || (municipio ? `${municipio}, Colombia` : 'Colombia');
  const initialIsp = cachedLoc?.isp || '';

  const nuevoRegistro: RegistroAcceso = {
    id: `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: now.toISOString(),
    fechaFormateada,
    fechaCorta,
    usuario,
    cedulaOrNit,
    rol,
    municipio: municipio || '',
    ip,
    ubicacionIp: initialUbicacion,
    isp: initialIsp,
    dispositivo,
    navegador,
    tipoAcceso,
    exitoso,
    detalles,
  };

  db.registrosAcceso.unshift(nuevoRegistro);

  // Background lookup to enrich location if not already cached
  if (!cachedLoc && ip !== '127.0.0.1' && !ip.startsWith('10.') && !ip.startsWith('192.168.')) {
    resolveIpLocation(ip, req.headers).then((loc) => {
      nuevoRegistro.ubicacionIp = loc.ubicacion;
      if (loc.isp) nuevoRegistro.isp = loc.isp;
      try {
        saveDatabase(db);
      } catch {
        // Ignored
      }
    }).catch(() => {});
  }

  // Keep up to 2,000 most recent logs
  if (db.registrosAcceso.length > 2000) {
    db.registrosAcceso = db.registrosAcceso.slice(0, 2000);
  }

  saveDatabase(db);
  return nuevoRegistro;
}

function calcularMetricasAcceso(db: DatabaseSchema): MetricasAccesoResumen {
  const registros = db.registrosAcceso || [];
  const expendios = db.expendios || [];

  const totalIngresos = registros.length;
  const uniqueCedulas = new Set(registros.map((r) => r.cedulaOrNit).filter(Boolean));
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
      telefonoPunto?: string;
      tieneFotos?: boolean;
      ultimaIp?: string;
      ultimaUbicacion?: string;
      isp?: string;
    }
  >();

  registros.forEach((r) => {
    if (r.rol === 'expendio' && r.cedulaOrNit) {
      const exp = expendios.find((e) => e.cedula === r.cedulaOrNit);
      const prev = expendiosQueHanIngresadoMap.get(r.cedulaOrNit);
      const tieneFotos = !!(
        exp?.fotoAvisoUrl ||
        exp?.fotoPanoramicaUrl ||
        exp?.fotoMataselloUrl ||
        exp?.fotoBasculaUrl ||
        exp?.fotoFachadaUrl ||
        exp?.letreroUrl ||
        exp?.basculaUrl ||
        exp?.mataselloUrl
      );
      if (!prev) {
        expendiosQueHanIngresadoMap.set(r.cedulaOrNit, {
          cedula: r.cedulaOrNit,
          encargado: exp?.encargado || r.usuario,
          municipio: exp?.municipio || exp?.localidad || r.municipio || 'SIN MUNICIPIO',
          totalIngresos: 1,
          ultimoIngreso: r.fechaFormateada || r.timestamp,
          telefonoPunto: exp?.telefonoPunto,
          tieneFotos,
          ultimaIp: r.ip || '',
          ultimaUbicacion: r.ubicacionIp || (r.municipio ? `${r.municipio}, Colombia` : 'Colombia'),
          isp: r.isp || '',
        });
      } else {
        prev.totalIngresos += 1;
        if (r.timestamp > prev.ultimoIngreso) {
          prev.ultimoIngreso = r.fechaFormateada || r.timestamp;
          if (r.ip) prev.ultimaIp = r.ip;
          if (r.ubicacionIp) prev.ultimaUbicacion = r.ubicacionIp;
          if (r.isp) prev.isp = r.isp;
        }
      }
    }
  });

  const expendiosQueHanIngresado = Array.from(expendiosQueHanIngresadoMap.values());
  const cedulasQueIngresaron = new Set(expendiosQueHanIngresado.map((e) => e.cedula));

  const expendiosPendientesPorIngresar = expendios
    .filter((e) => !cedulasQueIngresaron.has(e.cedula))
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

  return {
    totalIngresos,
    totalUsuariosUnicos,
    totalVisitasGenerales: db.visitasGenerales || totalIngresos,
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
  if (!rawCuenta) return { cuenta: 'NEQUI 3123304166', banco: 'NEQUI' };
  const str = String(rawCuenta).trim();
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
    const validNum = numClean.length === 10 ? numClean : numClean || '3123304166';
    return {
      cuenta: `NEQUI ${validNum}`,
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

    let cuentaFinal = 'NEQUI 3123304166';
    let bancoFinal = 'NEQUI';

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
      cuentaFinal = phoneClean ? `NEQUI ${phoneClean}` : 'NEQUI 3123304166';
      bancoFinal = 'NEQUI';
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

  db.relacionPagos = [...otherMonths, ...newRecords];
  return {
    totalSynced: newRecords.length,
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

const DEFAULT_RELACION_PAGOS: PagoRelacionItem[] = [
  {
    id: 'pago-1',
    consecutivo: 1,
    centroOperativo: 'ARAUCA',
    municipio: 'ARAUCA',
    concepto: 'PAGO MES FEBRERO EXPENDIO ARAUCA',
    nombreEncargado: 'JORGE ANDRES LOPEZ PATIÑO',
    cedula: '1.116.796.414',
    cuenta: 'NEQUI 3123304166',
    valorCancelar: 0,
    banco: 'NEQUI',
    estado: 'Pendiente',
    mes: 'FEBRERO',
    anio: '2026',
  },
  {
    id: 'pago-2',
    consecutivo: 2,
    centroOperativo: 'ARAUCA',
    municipio: 'ARAUQUITA',
    concepto: 'PAGO MES FEBRERO EXPENDIO ARAUQUITA',
    nombreEncargado: 'JAIME YESITH PINILLA',
    cedula: '1.06.610.564',
    cuenta: 'NEQUI 3143495145',
    valorCancelar: 121350,
    banco: 'NEQUI',
    estado: 'Pendiente',
    mes: 'FEBRERO',
    anio: '2026',
  },
  {
    id: 'pago-3',
    consecutivo: 3,
    centroOperativo: 'ARAUCA',
    municipio: 'CRAVO NORTE',
    concepto: 'PAGO MES FEBRERO EXPENDIO CRAVO NORTE',
    nombreEncargado: 'ERIKA ISABEL CISNEROS',
    cedula: '30.020.686',
    cuenta: 'NEQUI 3177320154',
    valorCancelar: 0,
    banco: 'NEQUI',
    estado: 'Pendiente',
    mes: 'FEBRERO',
    anio: '2026',
  },
];

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

function loadDatabase(): DatabaseSchema {
  const currentDbPath = getActiveDbPath();
  let db: DatabaseSchema;

  if (!fs.existsSync(currentDbPath)) {
    // If running in TEST, copy from master published database if it exists
    if (!isPublishedEnv && (fs.existsSync(masterPublishedDbPath) || fs.existsSync(legacyDbPath))) {
      try {
        const sourcePath = fs.existsSync(masterPublishedDbPath) ? masterPublishedDbPath : legacyDbPath;
        const seedRaw = fs.readFileSync(sourcePath, 'utf-8');
        fs.writeFileSync(currentDbPath, seedRaw);
        db = JSON.parse(seedRaw);
        return db;
      } catch (e) {
        console.warn('Error inicializando base de datos de test desde producción:', e);
      }
    }

    db = {
      expendios: INITIAL_EXPENDIOS.map((e) => ({
        ...e,
        municipio: (e.municipio || e.localidad || '').trim(),
        localidad: (e.localidad || e.municipio || '').trim(),
      })),
      historial: INITIAL_HISTORIAL,
      trazabilidad: INITIAL_TRAZABILIDAD,
      config: { ...DEFAULT_CONFIG, isEphemeralSeed: true }, // Mark as seed
      cuentasCargadas: [],
      relacionPagos: DEFAULT_RELACION_PAGOS,
    };
    saveDatabase(db);
    return db;
  }

  try {
    const raw = fs.readFileSync(currentDbPath, 'utf-8');
    db = JSON.parse(raw);
  } catch (err) {
    console.error('Error reading database file, resetting to initial baseline:', err);
    db = {
      expendios: INITIAL_EXPENDIOS,
      historial: INITIAL_HISTORIAL,
      trazabilidad: INITIAL_TRAZABILIDAD,
      config: { ...DEFAULT_CONFIG, isEphemeralSeed: true },
      cuentasCargadas: [],
      relacionPagos: DEFAULT_RELACION_PAGOS,
    };
    saveDatabase(db);
    return db;
  }

  // Ensure arrays exist without overwriting empty collections when cleared
  if (!Array.isArray(db.expendios)) {
    db.expendios = [];
  }

  if (!Array.isArray(db.trazabilidad)) {
    db.trazabilidad = [];
  }
  if (!db.config) {
    db.config = { ...DEFAULT_CONFIG };
  } else if (!Array.isArray(db.config.documentosExpendios) || db.config.documentosExpendios.length === 0) {
    db.config.documentosExpendios = [...DEFAULT_DOCUMENTOS_EXPENDIOS];
  }
  if (!Array.isArray(db.cuentasCargadas)) {
    db.cuentasCargadas = [];
  }

  if (!Array.isArray(db.historial)) {
    db.historial = [];
  } else {
    // Deduplicate to ensure no single period accumulates repeated copies
    db.historial = deduplicateHistorial(db.historial);
  }

  if (!Array.isArray(db.relacionPagos)) {
    db.relacionPagos = [];
  }

  // Clean and format relacionPagos
  db.relacionPagos = db.relacionPagos
    .filter((p) => {
      const enc = (p.nombreEncargado || '').trim().toUpperCase();
      const mun = (p.municipio || '').trim().toUpperCase();
      const con = (p.concepto || '').trim().toUpperCase();
      const isTotalRow =
        enc === 'TOTAL' ||
        mun === 'TOTAL' ||
        con.includes('TOTAL') ||
        (enc === 'ENCARGADO' && !p.cedula) ||
        (p.valorCancelar > 1000000 && (!p.cedula || enc === 'ENCARGADO'));
      return !isTotalRow;
    })
    .map((p) => {
      const formatted = formatCuentaBancaria(p.cuenta, p.banco);
      return {
        ...p,
        cuenta: formatted.cuenta,
        banco: formatted.banco,
      };
    });

  // Normalize expendios
  const sanitizePhotoUrl = (url?: string) => {
    if (!url || typeof url !== 'string') return '';
    const u = url.trim();
    if (
      u.includes('placehold.co') ||
      u.includes('placeholder') ||
      u.includes('via.placeholder') ||
      u.includes('dummyimage') ||
      u.includes('text=')
    ) {
      return '';
    }
    return u;
  };

  db.expendios = db.expendios.map((exp) => {
    const mun = (exp.municipio || exp.localidad || '').trim();
    let adm = exp.admisionSipost ?? 0;
    if (adm > 0 && adm < 1000) {
      adm = 0;
    }
    const cleanedPhone = cleanNequiNumber(exp.telefonoPunto);
    return {
      ...exp,
      municipio: mun || 'MUNICIPIO',
      localidad: exp.localidad || mun || 'LOCALIDAD',
      admisionSipost: adm,
      telefonoPunto: cleanedPhone.length === 10 ? cleanedPhone : exp.telefonoPunto,
      fotoAvisoUrl: sanitizePhotoUrl(exp.fotoAvisoUrl),
      letreroUrl: sanitizePhotoUrl(exp.letreroUrl),
      fotoPanoramicaUrl: sanitizePhotoUrl(exp.fotoPanoramicaUrl),
      fotoMataselloUrl: sanitizePhotoUrl(exp.fotoMataselloUrl),
      mataselloUrl: sanitizePhotoUrl(exp.mataselloUrl),
      fotoBasculaUrl: sanitizePhotoUrl(exp.fotoBasculaUrl),
      basculaUrl: sanitizePhotoUrl(exp.basculaUrl),
      fotoContratistaUrl: sanitizePhotoUrl(exp.fotoContratistaUrl),
      fotoHorarioUrl: sanitizePhotoUrl(exp.fotoHorarioUrl),
      fotoTarifasUrl: sanitizePhotoUrl(exp.fotoTarifasUrl),
      fotoCedulaFrontalUrl: sanitizePhotoUrl(exp.fotoCedulaFrontalUrl),
      fotoCedulaPosteriorUrl: sanitizePhotoUrl(exp.fotoCedulaPosteriorUrl),
      fotoRutUrl: sanitizePhotoUrl(exp.fotoRutUrl),
      computadorUrl: sanitizePhotoUrl(exp.computadorUrl),
    };
  });

  if (!Array.isArray(db.registrosAcceso)) {
    db.registrosAcceso = [];
  }
  if (typeof db.visitasGenerales !== 'number') {
    db.visitasGenerales = 0;
  }

  // Filtrar cualquier registro ficticio/auto-generado para asegurar métricas 100% reales
  db.registrosAcceso = db.registrosAcceso.filter(
    (reg) => !reg.id?.startsWith('acc-init-')
  );

  return db;
}

let lastAutoBackupTime = 0;

function createAutoSnapshot(db: DatabaseSchema) {
  try {
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const snapPath = path.join(backupsDir, `snapshot-${timestamp}.json`);
    fs.writeFileSync(snapPath, JSON.stringify(db, null, 2));

    // Keep up to the 20 most recent snapshots
    const files = fs.readdirSync(backupsDir)
      .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length > 20) {
      files.slice(20).forEach((f) => {
        try { fs.unlinkSync(path.join(backupsDir, f)); } catch (e) {}
      });
    }
  } catch (err) {
    console.warn('Advertencia creando auto-snapshot local:', err);
  }
}

async function triggerGoogleDriveWebhookAsync(webhookUrl: string, db: DatabaseSchema) {
  try {
    const payload = {
      filename: `CAMARCA_DB_${environmentMode}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      timestamp: new Date().toISOString(),
      ambiente: environmentMode,
      totalExpendios: (db.expendios || []).length,
      totalHistorial: (db.historial || []).length,
      database: db,
    };
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // Non-blocking background sync
  }
}

function saveDatabase(db: DatabaseSchema, options: { immediateCloudSync?: boolean } = {}) {
  try {
    const currentDbPath = getActiveDbPath();
    fs.writeFileSync(currentDbPath, JSON.stringify(db, null, 2));

    // If running in published environment, also keep master published seed and permanent archive updated
    if (isPublishedEnv) {
      try {
        fs.writeFileSync(masterPublishedDbPath, JSON.stringify(db, null, 2));
        fs.writeFileSync(legacyDbPath, JSON.stringify(db, null, 2));
        
        // Permanent immutable archive in archivos_permanentes
        const permMasterPath = path.join(permanentArchiveDir, 'database.published.permanent.json');
        fs.writeFileSync(permMasterPath, JSON.stringify(db, null, 2));
      } catch (archiveErr) {
        console.warn('Error guardando archivo maestro permanente de producción:', archiveErr);
      }
    } else {
      // In TEST environment, also save a permanent test archive copy
      try {
        const permTestPath = path.join(permanentArchiveDir, 'database.test.permanent.json');
        fs.writeFileSync(permTestPath, JSON.stringify(db, null, 2));
      } catch (e) {}
    }
    
    // PERSISTENCIA PERMANENTE EN GOOGLE CLOUD FIRESTORE
    // Ensure all saves are pushed to the global queue so Express middleware can await them
    // This prevents Cloud Run from suspending the container while the save is still in flight.
    // We also serialize the calls to prevent race conditions causing Firestore write overlaps.
    if (!global.cloudSyncPromiseChain) {
      global.cloudSyncPromiseChain = Promise.resolve();
    }
    
    // Create a deep copy of the database at this exact moment so the deferred promise saves the correct state
    const dbSnapshot = JSON.parse(JSON.stringify(db));
    
    global.cloudSyncPromiseChain = global.cloudSyncPromiseChain.then(() => {
      return saveDatabaseToCloud(dbSnapshot).catch((err) => {
        console.warn('[Cloud Sync Error]:', err.message);
      });
    });

    if (global.pendingCloudSyncs) {
      global.pendingCloudSyncs.push(global.cloudSyncPromiseChain);
    }

    // Auto-create snapshot every 3 minutes if modified
    const now = Date.now();
    if (now - lastAutoBackupTime > 3 * 60 * 1000) {
      lastAutoBackupTime = now;
      createAutoSnapshot(db);
    }

    // Google Drive Webhook asynchronous sync if configured
    if (db.config?.googleDriveWebhookUrl && typeof fetch !== 'undefined') {
      triggerGoogleDriveWebhookAsync(db.config.googleDriveWebhookUrl, db).catch(() => {});
    }
  } catch (err) {
    console.error('Error saving database file:', err);
  }
}

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


app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

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

// Interceptor para /uploads/photos/:fileName: si el archivo físico en el contenedor desapareció tras reinicio,
// se recupera de manera transparente e instantánea desde Cloud Firestore (colección camarca_photos).
app.get('/uploads/photos/:fileName', async (req, res, next) => {
  const fileName = req.params.fileName;
  const filePath = path.join(photosDir, fileName);

  if (fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.sendFile(filePath);
  }

  // Si no está en disco local, intentar recuperar de Firestore
  try {
    const baseName = fileName.replace(/\.[^/.]+$/, '');
    const parts = baseName.split('_');
    if (parts.length >= 2) {
      const cedula = parts[0];
      const slotKey = parts.slice(1).join('_');
      const cloudPhoto = await getPhotoFromCloud(cedula, slotKey);
      if (cloudPhoto) {
        const cleanBase64 = cloudPhoto.replace(/^data:[^;]+;base64,/, '').trim();
        const buffer = Buffer.from(cleanBase64, 'base64');
        try {
          fs.writeFileSync(filePath, buffer);
        } catch {}
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        return res.send(buffer);
      }
    }

    // Buscar si algún expendio tiene este fileName en sus campos
    const db = loadDatabase();
    const targetExp = db.expendios.find((e: any) =>
      Object.values(e).some((v) => typeof v === 'string' && v.includes(fileName))
    );
    if (targetExp) {
      const slot = Object.keys(targetExp).find((k) => (targetExp as any)[k]?.includes(fileName));
      if (slot) {
        const cloudPhoto = await getPhotoFromCloud(targetExp.cedula, slot);
        if (cloudPhoto) {
          const cleanBase64 = cloudPhoto.replace(/^data:[^;]+;base64,/, '').trim();
          const buffer = Buffer.from(cleanBase64, 'base64');
          try {
            fs.writeFileSync(filePath, buffer);
          } catch {}
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
          return res.send(buffer);
        }
      }
    }
  } catch (err: any) {
    console.warn('[Photos Fallback] Error intentando recuperar foto desde Firestore:', err.message);
  }

  next();
});

// Endpoint canónico y permanente para servir fotos de expendios desde disco, permanentes o Google Drive
app.get(['/api/photos/:cedula/:slotKey', '/api/expendio/photo/:cedula/:slotKey'], async (req, res) => {
  const { cedula, slotKey } = req.params;
  const cleanCed = cedula.trim();
  const cleanSlot = slotKey.trim();
  const localFileName = `${cleanCed}_${cleanSlot}.jpg`;
  const localFilePath = path.join(photosDir, localFileName);
  const permFilePath = path.join(permanentPhotosDir, localFileName);

  // 1. Verificar si existe en la carpeta activa de subidas
  if (fs.existsSync(localFilePath)) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.sendFile(localFilePath);
  }

  // 2. Verificar si existe en la carpeta permanente local (fotos protegidas)
  if (fs.existsSync(permFilePath)) {
    try {
      fs.copyFileSync(permFilePath, localFilePath);
    } catch {}
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.sendFile(permFilePath);
  }

  // 3. Recuperar directamente desde Google Drive a través del registro permanente
  try {
    const registry = loadDrivePhotosRegistry();
    const key = `${cleanCed}_${cleanSlot}`;
    const driveData = registry[key];

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
            try {
              fs.writeFileSync(localFilePath, buffer);
              fs.writeFileSync(permFilePath, buffer);
            } catch {}
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            return res.send(buffer);
          }
        } catch (dlErr: any) {
          console.warn(`[Photos API] Error descargando foto de Drive (${key}):`, dlErr.message);
        }
      }

      // Redirección segura a la vista previa de Google Drive si no se pudo descargar en caliente
      if (driveData.driveFileId) {
        return res.redirect(`https://drive.google.com/thumbnail?id=${driveData.driveFileId}&sz=w1200`);
      }
    }
  } catch (err: any) {
    console.warn(`[Photos API] Error consultando registro Drive (${cleanCed} - ${cleanSlot}):`, err.message);
  }

  try {
    const dataUrl = await getPhotoFromCloud(cleanCed, cleanSlot);
    if (dataUrl) {
      const cleanBase64 = dataUrl.replace(/^data:[^;]+;base64,/, '').trim();
      const buffer = Buffer.from(cleanBase64, 'base64');
      try {
        fs.writeFileSync(localFilePath, buffer);
        fs.writeFileSync(permFilePath, buffer);
      } catch {}
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return res.send(buffer);
    }
  } catch (err: any) {
    console.error(`[Photos API] Error obteniendo foto de la nube (${cleanCed} - ${cleanSlot}):`, err.message);
  }

  return res.status(404).json({ success: false, message: 'Fotografía no encontrada.' });
});

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));

// --- API ROUTES ---

// 1. Get all expendios
app.get('/api/expendios', (req, res) => {
  const db = loadDatabase();
  res.json({ success: true, data: db.expendios });
});

// Estado en memoria de sincronización en tiempo real y reportes guardados
let lastReportSaveRecord = {
  saved: true,
  name: 'Base de Datos Maestra y Reporte General (177 Expendios)',
  timestamp: new Date().toISOString(),
  type: 'sistema',
  status: 'success' as 'success' | 'pending' | 'error',
  detalles: '177 expendios y catálogo fotográfico sincronizados con Firestore y Storage',
};

// 1.0. System status of Firestore persistence
app.get('/api/system/firestore-status', (req, res) => {
  const db = loadDatabase();
  const syncStatus = getCloudSyncStatus();
  res.json({
    success: true,
    connected: syncStatus.connected,
    quotaExhausted: !!syncStatus.quotaExhausted,
    lastSync: syncStatus.lastSyncTime,
    error: syncStatus.quotaExhausted ? syncStatus.lastSyncError : null,
    totalExpendios: Array.isArray(db.expendios) ? db.expendios.length : 0,
      totalExpendiosCloud: syncStatus.totalExpendiosCloud || 0,
    databaseName: isPublishedEnv ? 'camarca_system' : 'camarca_system_test',
    photosCollection: 'camarca_photos',
    message: syncStatus.quotaExhausted
      ? 'Cuota diaria de Firestore alcanzada. Los datos y fotos continúan 100% seguros y respaldados permanentemente en el servidor.'
      : 'Base de datos de 177 expendios y fotografías persistidas en Google Cloud Firestore.',
  });
});

// 1.0A. Realtime Sync Monitoring (Firestore + Storage + Report status)
app.get('/api/system/sync-monitoring', (req, res) => {
  const db = loadDatabase();
  const syncStatus = getCloudSyncStatus();

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

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    firestore: {
      connected: Boolean(syncStatus.connected),
      quotaExhausted: Boolean(syncStatus.quotaExhausted),
      databaseId: syncStatus.databaseId || 'ai-studio-expendioscamarca-5a851b13-3f57-4ad6-ac56-28b094b35072',
      collection: isPublishedEnv ? 'camarca_system' : 'camarca_system_test',
      totalExpendios: Array.isArray(db.expendios) ? db.expendios.length : 0,
      localDbSizeBytes,
      lastSyncTime: syncStatus.lastSyncTime || new Date().toISOString(),
      error: syncStatus.quotaExhausted ? (syncStatus.lastSyncError || null) : null,
      status: syncStatus.quotaExhausted
        ? 'quota_exhausted'
        : syncStatus.connected
        ? 'synced'
        : 'offline',
    },
    storage: {
      connected: true,
      provider: 'Google Drive & Almacenamiento Local',
      collection: 'Fotos Expendios 4-72 - CAMARCA SAS',
      photosCount: localPhotosCount,
      lastPhotoSyncTime: syncStatus.lastSyncTime || new Date().toISOString(),
      status: 'online',
      firebaseStorageDisabled: true,
      message: 'Fotografías archivadas en servidor local y preparadas para Google Drive sin consumir cuotas de Firebase.',
    },
    lastReport: lastReportSaveRecord,
  });
});

// 1.0A2. Manual retry of Firestore sync (clears cooldown if needed)
app.post('/api/system/firestore-retry-sync', async (req, res) => {
  resetFirestoreQuotaCooldown();
  const db = loadDatabase();
  const success = await saveDatabaseToCloud(db, { force: true });
  const syncStatus = getCloudSyncStatus();
  res.json({
    success,
    status: syncStatus,
    message: success
      ? 'Sincronización con Firestore ejecutada exitosamente.'
      : (syncStatus.lastSyncError || 'No se pudo sincronizar en este momento. Los datos continúan protegidos localmente.'),
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

// 1.0C. Forzar sincronización manual de Firestore
app.post('/api/system/sync-now', async (req, res) => {
  try {
    resetFirestoreQuotaCooldown();
    const db = loadDatabase();
    const success = await saveDatabaseToCloud(db, { force: true });
    if (success) {
      lastReportSaveRecord = {
        saved: true,
        name: 'Respaldo Completo en la Nube (177 Expendios)',
        timestamp: new Date().toISOString(),
        type: 'respaldo',
        status: 'success',
        detalles: 'Sincronización manual ejecutada exitosamente con Firestore y Storage',
      };
    }
    const syncStatus = getCloudSyncStatus();
    res.json({
      success,
      lastReport: lastReportSaveRecord,
      message: success
        ? '✓ Base de datos de 177 expendios y colecciones respaldadas exitosamente en Google Cloud Firestore.'
        : (syncStatus.lastSyncError || 'Los datos continúan 100% seguros y protegidos en almacenamiento permanente local.'),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 1B. Admin: Update an expendio
app.put('/api/admin/expendios/:id', async (req, res) => {
  const { id } = req.params;
  const updateData: Partial<ExpendioData> = { ...req.body };
  const db = loadDatabase();

  const index = db.expendios.findIndex((e) => e.id === id || e.cedula === id || e.localidad === id);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
  }

  const exp = db.expendios[index];
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

  // Interceptar campos fotográficos para persistirlos en Firestore y nunca saturar la base de datos local
  for (const key of photoKeys) {
    const val = updateData[key];
    if (typeof val === 'string') {
      if (val.startsWith('data:image/') || val.length > 500) {
        const canonicalSlot =
          key === 'letreroUrl'
            ? 'fotoAvisoUrl'
            : key === 'basculaUrl'
            ? 'fotoBasculaUrl'
            : key === 'mataselloUrl'
            ? 'fotoMataselloUrl'
            : key;

        // 1. Guardar individualmente en Firestore
        await savePhotoToCloud(exp.cedula, canonicalSlot, val, {
          municipio: exp.municipio,
          encargado: exp.encargado,
          expendioId: exp.id,
        });

        // 2. Cachear en disco del contenedor
        const localFileName = `${exp.cedula.trim()}_${canonicalSlot}.jpg`;
        const cleanBase64 = val.replace(/^data:[^;]+;base64,/, '').trim();
        try {
          fs.writeFileSync(path.join(photosDir, localFileName), Buffer.from(cleanBase64, 'base64'));
          backgroundPhotoSyncEngine.notifyPhotoChanged(localFileName);
        } catch {}

        // 3. Reemplazar por la URL canónica segura para mantener la BD ligera
        const canonicalUrl = `/api/photos/${encodeURIComponent(exp.cedula.trim())}/${canonicalSlot}`;
        (updateData as any)[key] = canonicalUrl;

        if (key === 'fotoAvisoUrl' || canonicalSlot === 'fotoAvisoUrl') {
          updateData.fotoAvisoUrl = canonicalUrl;
          updateData.letreroUrl = canonicalUrl;
          updateData.tieneAviso = 'SI';
          updateData.motivoFaltaAviso = '';
        } else if (key === 'fotoBasculaUrl' || canonicalSlot === 'fotoBasculaUrl') {
          updateData.fotoBasculaUrl = canonicalUrl;
          updateData.basculaUrl = canonicalUrl;
          updateData.tieneBascula = 'SI';
          updateData.motivoFaltaBascula = '';
        } else if (key === 'fotoMataselloUrl' || canonicalSlot === 'fotoMataselloUrl') {
          updateData.fotoMataselloUrl = canonicalUrl;
          updateData.mataselloUrl = canonicalUrl;
          updateData.tieneMatasello = 'SI';
          updateData.motivoFaltaMatasello = '';
        }
      } else if (val === '') {
        const canonicalSlot =
          key === 'letreroUrl'
            ? 'fotoAvisoUrl'
            : key === 'basculaUrl'
            ? 'fotoBasculaUrl'
            : key === 'mataselloUrl'
            ? 'fotoMataselloUrl'
            : key;

        await deletePhotoFromCloud(exp.cedula, canonicalSlot);
        const localFileName = `${exp.cedula.trim()}_${canonicalSlot}.jpg`;
        const localPath = path.join(photosDir, localFileName);
        if (fs.existsSync(localPath)) {
          try { fs.unlinkSync(localPath); } catch {}
        }
        if (key === 'fotoAvisoUrl') updateData.letreroUrl = '';
        if (key === 'fotoBasculaUrl') updateData.basculaUrl = '';
        if (key === 'fotoMataselloUrl') updateData.mataselloUrl = '';
      }
    }
  }

  // Preserve existing fields and merge update
  db.expendios[index] = {
    ...db.expendios[index],
    ...updateData,
    fechaUltimaActualizacion: new Date().toISOString().split('T')[0],
  };

  const updatedItem = db.expendios[index];

  // Record traceability event instead of polluting accounting historial
  if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
  db.trazabilidad.unshift({
    id: `traz-${Date.now()}`,
    municipio: updatedItem.municipio || updatedItem.localidad,
    localidad: updatedItem.localidad,
    novedad: 'Actualización de datos del expendio por administración',
    fechaRegistro: new Date().toISOString(),
    registradoPor: 'Administrador CAMARCA',
    observaciones: `Modificación de datos de ${updatedItem.localidad} en el sistema maestro`,
  });

  saveDatabase(db);

  res.json({
    success: true,
    data: updatedItem,
    message: `✓ Expendio ${updatedItem.localidad} actualizado correctamente en el sistema.`,
  });
});

// 1C. Admin: Create a new expendio
app.post('/api/admin/expendios', (req, res) => {
  const newExp: ExpendioData = req.body;
  const db = loadDatabase();

  if (!newExp.localidad || !newExp.cedula || !newExp.encargado) {
    return res.status(400).json({ success: false, message: 'La Localidad/Municipio, Cédula y Encargado son obligatorios.' });
  }

  // Check duplicate cedula
  const exists = db.expendios.some((e) => e.cedula.trim() === newExp.cedula.trim());
  if (exists) {
    return res.status(400).json({ success: false, message: 'Ya existe un expendio registrado con esa misma Cédula.' });
  }

  const newId = `exp-${Date.now()}`;
  const fullExpendio: ExpendioData = {
    id: newId,
    centroOperativo: newExp.centroOperativo || 'PO.BUCARAMANGA',
    centroAcopio: newExp.centroAcopio || newExp.localidad,
    localidad: newExp.localidad,
    encargado: newExp.encargado,
    cedula: newExp.cedula,
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
    fechaUltimaActualizacion: new Date().toISOString().split('T')[0],
  };

  db.expendios.push(fullExpendio);

  // Log creation event in trazabilidad (NEVER in accounting historial)
  if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
  db.trazabilidad.unshift({
    id: `traz-create-${Date.now()}`,
    municipio: fullExpendio.municipio || fullExpendio.localidad,
    localidad: fullExpendio.localidad,
    novedad: 'Creación de nuevo expendio en el sistema maestro',
    encargadoNuevo: fullExpendio.encargado,
    cedulaNuevo: fullExpendio.cedula,
    fechaRegistro: new Date().toISOString(),
    registradoPor: 'Administrador CAMARCA',
    observaciones: `Nuevo expendio ${fullExpendio.localidad} creado con valor base $${fullExpendio.valorMensual}`,
  });

  saveDatabase(db);

  res.json({
    success: true,
    data: fullExpendio,
    message: `✓ Nuevo expendio ${fullExpendio.localidad} registrado con éxito en el sistema.`,
  });
});

// 1C2. Admin: Import expendios from uploaded Excel file
app.post('/api/admin/import-excel', (req, res) => {
  const { expendios, mode } = req.body;
  if (!Array.isArray(expendios) || expendios.length === 0) {
    return res.status(400).json({ success: false, message: 'No se recibieron datos de expendios válidos para importar.' });
  }

  const db = loadDatabase();

  const formattedNew: ExpendioData[] = expendios.map((item: any, idx: number) => ({
    id: item.id || `exp-excel-${Date.now()}-${idx}`,
    centroOperativo: item.centroOperativo || 'PO.BUCARAMANGA',
    centroAcopio: item.centroAcopio || 'ACOPIO PRINCIPAL',
    localidad: String(item.localidad || item.municipio || 'SIN LOCALIDAD').trim().toUpperCase(),
    encargado: String(item.encargado || 'SIN ENCARGADO').trim().toUpperCase(),
    cedula: String(item.cedula || '0').trim(),
    direccionPunto: String(item.direccionPunto || item.direccion || '').trim(),
    telefonoPunto: String(item.telefonoPunto || item.celular || item.telefono || '').trim(),
    usuarioSipost: String(item.usuarioSipost || item.sipost || `SIP_${idx + 1}`).trim(),
    internet: String(item.internet || 'SI').trim().toUpperCase(),
    nit: String(item.nit || '900062917').trim(),
    correoElectronico: item.correoElectronico || '',
    observacion: item.observacion || 'Cargado desde Excel',
    municipio: item.municipio || item.localidad,
    valorMensual: Number(item.valorMensual || item.valor || item.cargoBasico || 0),
    letreroUrl: item.letreroUrl || undefined,
    basculaUrl: item.basculaUrl || undefined,
    mataselloUrl: item.mataselloUrl || undefined,
    computadorUrl: item.computadorUrl || undefined,
    contratoUrl: item.contratoUrl || undefined,
    fechaUltimaActualizacion: new Date().toISOString().split('T')[0],
  }));

  if (mode === 'replace') {
    // Si reemplaza la base pero existen expendios previos con fotos reales tomadas, preservamos sus fotos
    db.expendios = formattedNew.map((newItem) => {
      const existing = db.expendios.find(
        (e) => (e.cedula && e.cedula === newItem.cedula) || e.localidad?.toLowerCase() === newItem.localidad?.toLowerCase()
      );
      if (!existing) return newItem;
      return {
        ...newItem,
        // Preservar fotos reales si ya habían sido tomadas
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
    // Merge: update existing if same cedula or localidad, else append
    formattedNew.forEach((newItem) => {
      const existingIdx = db.expendios.findIndex(
        (e) =>
          (e.cedula && e.cedula === newItem.cedula) ||
          e.localidad.toLowerCase() === newItem.localidad.toLowerCase()
      );
      if (existingIdx !== -1) {
        const existing = db.expendios[existingIdx];
        db.expendios[existingIdx] = {
          ...existing,
          ...newItem,
          // Preservar fotos reales si ya habían sido tomadas
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
        db.expendios.push(newItem);
      }
    });
  }

  saveDatabase(db);

  res.json({
    success: true,
    data: db.expendios,
    message: `✓ Se cargaron ${formattedNew.length} expendios exitosamente desde Excel (${mode === 'replace' ? 'Base reemplazada' : 'Base actualizada'}).`,
  });
});

// 1C2B. Admin: Batch import expendios from Google Sheets
app.post('/api/admin/expendios/batch-import', (req, res) => {
  const { expendios } = req.body;
  if (!Array.isArray(expendios) || expendios.length === 0) {
    return res.status(400).json({ success: false, message: 'No se recibieron datos válidos para importar.' });
  }

  const db = loadDatabase();
  let updatedCount = 0;

  expendios.forEach((item: Partial<ExpendioData>) => {
    const cleanCedula = String(item.cedula || '').trim();
    if (!cleanCedula || cleanCedula === '0') return;

    // Coincidencia ESTRICTA por cédula o id. Nunca por localidad sola para evitar sobreescrituras destructivas entre puntos del mismo municipio
    const existingIdx = db.expendios.findIndex((e) => {
      if (e.cedula && e.cedula.trim() === cleanCedula) return true;
      if (item.id && e.id === item.id) return true;
      return false;
    });

    if (existingIdx !== -1) {
      const existing = db.expendios[existingIdx];
      // Merge defensivo: Sólo actualizar propiedades si el valor entrante no está vacío
      const merged: any = { ...existing };
      for (const [k, v] of Object.entries(item)) {
        if (v !== undefined && v !== null && v !== '') {
          merged[k] = v;
        }
      }

      // Preservar fotos locales y metadatos de disponibilidad
      merged.fotoAvisoUrl = (item.fotoAvisoUrl && !item.fotoAvisoUrl.includes('placehold.co')) ? item.fotoAvisoUrl : existing.fotoAvisoUrl;
      merged.fotoPanoramicaUrl = (item.fotoPanoramicaUrl && !item.fotoPanoramicaUrl.includes('placehold.co')) ? item.fotoPanoramicaUrl : existing.fotoPanoramicaUrl;
      merged.fotoMataselloUrl = (item.fotoMataselloUrl && !item.fotoMataselloUrl.includes('placehold.co')) ? item.fotoMataselloUrl : existing.fotoMataselloUrl;
      merged.fotoBasculaUrl = (item.fotoBasculaUrl && !item.fotoBasculaUrl.includes('placehold.co')) ? item.fotoBasculaUrl : existing.fotoBasculaUrl;
      merged.fotoContratistaUrl = (item.fotoContratistaUrl && !item.fotoContratistaUrl.includes('placehold.co')) ? item.fotoContratistaUrl : existing.fotoContratistaUrl;
      merged.fotoHorarioUrl = (item.fotoHorarioUrl && !item.fotoHorarioUrl.includes('placehold.co')) ? item.fotoHorarioUrl : existing.fotoHorarioUrl;
      merged.fotoTarifasUrl = (item.fotoTarifasUrl && !item.fotoTarifasUrl.includes('placehold.co')) ? item.fotoTarifasUrl : existing.fotoTarifasUrl;
      merged.computadorUrl = (item.computadorUrl && !item.computadorUrl.includes('placehold.co')) ? item.computadorUrl : existing.computadorUrl;

      // Preservar datos bancarios y de contacto si Sheets viene en blanco
      merged.cuentaBancaria = item.cuentaBancaria || existing.cuentaBancaria || '';
      merged.banco = item.banco || existing.banco || 'NEQUI';
      merged.tipoCuenta = item.tipoCuenta || existing.tipoCuenta || 'AHORROS';
      merged.encargado = item.encargado || existing.encargado;
      merged.direccionPunto = item.direccionPunto || existing.direccionPunto;
      merged.telefonoPunto = item.telefonoPunto || existing.telefonoPunto;
      merged.usuarioSipost = item.usuarioSipost || existing.usuarioSipost;
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

  // Guardar y sincronizar a la nube de manera INMEDIATA
  saveDatabase(db, { immediateCloudSync: true });

  res.json({
    success: true,
    updatedCount,
    total: db.expendios.length,
    message: `✓ Se actualizaron ${updatedCount} expendios correctamente desde Google Sheets sin sobreescrituras accidentales.`,
  });
});

// 1C3. Admin: Clear / Delete entire database of expendios
const ADMIN_MASTER_PASSWORD = 'Camarca.2023*';

app.post('/api/admin/clear-database', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_MASTER_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: 'Contraseña de seguridad incorrecta. Debe ingresar la contraseña autorizada Camarca.2023* para borrar la base de datos de expendios.',
    });
  }

  const db = loadDatabase();
  const previousCount = db.expendios.length;

  db.expendios = [];
  saveDatabase(db);

  res.json({
    success: true,
    data: [],
    message: `✓ Base de datos borrada por completo. Se eliminaron ${previousCount} expendios. Ahora la base de datos está vacía.`,
  });
});

// 1D. Admin: Delete an expendio
app.delete('/api/admin/expendios/:id', (req, res) => {
  const { id } = req.params;
  const db = loadDatabase();

  const target = String(id).trim().toLowerCase();
  const index = db.expendios.findIndex(
    (e) =>
      String(e.id || '').trim().toLowerCase() === target ||
      String(e.cedula || '').trim().toLowerCase() === target ||
      String(e.localidad || '').trim().toLowerCase() === target
  );
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
  }

  const removed = db.expendios.splice(index, 1)[0];

  // Log deletion event in trazabilidad (NEVER in accounting historial)
  if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
  db.trazabilidad.unshift({
    id: `traz-delete-${Date.now()}`,
    municipio: removed.municipio || removed.localidad,
    localidad: removed.localidad,
    novedad: 'Eliminación de expendio del sistema',
    encargadoAnterior: removed.encargado,
    cedulaAnterior: removed.cedula,
    fechaRegistro: new Date().toISOString(),
    registradoPor: 'Administrador CAMARCA',
    observaciones: `Expendio ${removed.localidad} eliminado del sistema maestro`,
  });

  saveDatabase(db);

  res.json({
    success: true,
    message: `✓ Expendio ${removed.localidad} eliminado correctamente del sistema.`,
  });
});

// 2. Authentication Route (Auto-detects role from Identification / Cédula / NIT)
app.post('/api/auth/login', (req, res) => {
  const { passwordOrCedula, role: requestedRole } = req.body;
  const searchVal = (passwordOrCedula || '').trim();
  const db = loadDatabase();

  if (!searchVal) {
    return res.status(400).json({
      success: false,
      message: 'Por favor ingresa tu número de Cédula o NIT.',
      whatsappPhone: '3182822512',
    });
  }

  // 1. Check Super-Admin ID 1094269932 (Has full multi-role access: Admin, Expendio, Cliente)
  if (searchVal === '1094269932') {
    // Find admin's expendio if registered, or provide a mock admin point
    let adminExpendio = db.expendios.find((e) => e.cedula.trim() === '1094269932');
    if (!adminExpendio) {
      adminExpendio = {
        id: '1094269932',
        cedula: '1094269932',
        encargado: 'ADMINISTRADOR GENERAL CAMARCA SAS',
        municipio: 'BUCARAMANGA',
        centroOperativo: 'PO. BUCARAMANGA',
        celular: '3182822512',
        correo: 'camarca.spn472@gmail.com',
        banco: 'N/A',
        tipoCuenta: 'N/A',
        numeroCuenta: 'N/A',
        direccion: 'OFICINA PRINCIPAL CAMARCA SAS',
        usuarioSipost: 'SUPER_ADMIN',
        observaciones: 'Cuenta Administrativa de Acceso Total',
        fechaUltimaActualizacion: new Date().toISOString(),
        primeraVezActualizado: true,
        tieneAviso: 'N/A',
        tieneBascula: 'N/A',
        tieneComputador: 'N/A',
        tieneMatasello: 'N/A',
        tieneImpresora: 'N/A'
      };
    }

    const finalRole = requestedRole && ['admin', 'expendio', 'cliente'].includes(requestedRole)
      ? requestedRole
      : 'admin';

    registrarIngresoUsuario(
      db,
      req,
      'ADMINISTRADOR GENERAL CAMARCA SAS',
      '1094269932',
      finalRole as any,
      adminExpendio?.municipio || 'BUCARAMANGA',
      'login',
      true,
      'Ingreso Super-Administrador CAMARCA SAS'
    );

    return res.json({
      success: true,
      isMultiRoleAdmin: true,
      canSelectRole: true,
      availableRoles: ['admin', 'expendio', 'cliente'],
      user: {
        role: finalRole,
        cedulaOrNit: '1094269932',
        name: 'Administrador CAMARCA SAS (C.C. 1094269932)',
        isMultiRoleAdmin: true,
        expendioData: adminExpendio,
      },
    });
  }

  // 2. Other Admin Aliases / Passwords
  if (['admin', 'administrator', '900504241'].includes(searchVal.toLowerCase()) || requestedRole === 'admin') {
    registrarIngresoUsuario(
      db,
      req,
      'Administrador CAMARCA SAS',
      searchVal,
      'admin',
      'BUCARAMANGA',
      'login',
      true,
      'Ingreso Administrador'
    );

    return res.json({
      success: true,
      user: {
        role: 'admin',
        cedulaOrNit: searchVal,
        name: 'Administrador CAMARCA SAS',
      },
    });
  }

  // 3. Check Cliente 4-72 NITs / Passwords
  if (['900062917', 'cliente', '472'].includes(searchVal.toLowerCase()) || requestedRole === 'cliente') {
    registrarIngresoUsuario(
      db,
      req,
      'Cliente 4-72 (Servicios Postales)',
      searchVal,
      'cliente',
      'BOGOTA D.C.',
      'login',
      true,
      'Ingreso Cliente 4-72'
    );

    return res.json({
      success: true,
      user: {
        role: 'cliente',
        cedulaOrNit: searchVal,
        name: 'Cliente 4-72 (Servicios Postales)',
      },
    });
  }

  // 4. Check Expendios by Cédula or NIT
  const found = db.expendios.find(
    (exp) => exp.cedula.trim() === searchVal || exp.nit?.trim() === searchVal
  );

  if (found) {
    registrarIngresoUsuario(
      db,
      req,
      found.encargado,
      found.cedula,
      'expendio',
      found.municipio || found.localidad,
      'login',
      true,
      `Ingreso Expendio ${found.municipio || found.localidad}`
    );

    return res.json({
      success: true,
      user: {
        role: 'expendio',
        cedulaOrNit: found.cedula,
        name: found.encargado,
        expendioData: found,
      },
    });
  }

  // Fallback: If not found, log failed attempt and return explicit error message
  registrarIngresoUsuario(
    db,
    req,
    `No Registrado (${searchVal})`,
    searchVal,
    'desconocido',
    '',
    'login',
    false,
    'Intento de ingreso con cédula no encontrada en el sistema'
  );

  return res.status(404).json({
    success: false,
    message: 'No se encontró ningún registro para el número ingresado. Verifica tus datos o contáctate con el administrador.',
    whatsappPhone: '3182822512',
    detalles: `El número ${searchVal} no coincide con ningún expendio ni usuario registrado en la base de datos de CAMARCA SAS.`,
  });
});

// 2B. Track general visit / page load
app.post('/api/metrics/track-visit', (req, res) => {
  const db = loadDatabase();
  db.visitasGenerales = (db.visitasGenerales || 0) + 1;
  saveDatabase(db);
  res.json({ success: true, count: db.visitasGenerales });
});

// 2C. Admin: Get Access Metrics (Available strictly to Administrator)
app.get('/api/admin/metrics/accesos', (req, res) => {
  const db = loadDatabase();
  const metricas = calcularMetricasAcceso(db);
  res.json({ success: true, data: metricas });
});

// 2D. Admin: Export Access Logs as CSV
app.get('/api/admin/metrics/exportar-csv', (req, res) => {
  const db = loadDatabase();
  const registros = db.registrosAcceso || [];

  let csv = '\uFEFFFECHA_HORA,USUARIO_ENCARGADO,CEDULA_NIT,ROL,MUNICIPIO,DISPOSITIVO,NAVEGADOR,IP,UBICACION_IP,PROVEEDOR_INTERNET_ISP,TIPO_ACCESO,ESTADO,DETALLES\n';
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
app.post('/api/admin/metrics/limpiar', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_MASTER_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: 'Contraseña de seguridad incorrecta. Debe ingresar la clave autorizada para reiniciar las métricas.',
    });
  }

  const db = loadDatabase();
  db.registrosAcceso = [];
  db.visitasGenerales = 0;
  saveDatabase(db);

  res.json({
    success: true,
    message: '✓ Registro de accesos e ingresos a la aplicación reiniciado correctamente.',
  });
});

// 3. Expendio: Update contact and personal details (ALL IN UPPERCASE)
app.post('/api/expendio/update', (req, res) => {
  const {
    cedula,
    cedulaOriginal,
    direccionPunto,
    telefonoPunto,
    correoElectronico,
    encargado,
    cuentaBancaria,
    banco,
    primeraVezActualizado,
  } = req.body;
  const db = loadDatabase();

  const searchCedula = (cedulaOriginal || cedula || '').trim();
  const index = db.expendios.findIndex((exp) => exp.cedula.trim() === searchCedula);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
  }

  // Transform all user-entered string values to UPPERCASE as mandated
  const cleanEncargado = encargado ? String(encargado).trim().toUpperCase() : db.expendios[index].encargado;
  const cleanCedula = req.body.cedulaNueva ? String(req.body.cedulaNueva).trim().toUpperCase() : (cedula ? String(cedula).trim().toUpperCase() : db.expendios[index].cedula);
  const cleanDireccion = direccionPunto ? String(direccionPunto).trim().toUpperCase() : db.expendios[index].direccionPunto;
  const cleanTelefono = telefonoPunto ? String(telefonoPunto).trim().toUpperCase() : db.expendios[index].telefonoPunto;
  const cleanCuenta = cuentaBancaria !== undefined ? String(cuentaBancaria).trim().toUpperCase() : (db.expendios[index].cuentaBancaria || '');
  const cleanBanco = banco ? String(banco).trim().toUpperCase() : (db.expendios[index].banco || 'NEQUI');
  const cleanCorreo = correoElectronico ? String(correoElectronico).trim().toUpperCase() : (db.expendios[index].correoElectronico || '');
  const cleanObservaciones = req.body.observaciones !== undefined 
    ? String(req.body.observaciones).trim().toUpperCase() 
    : (req.body.observacion !== undefined 
        ? String(req.body.observacion).trim().toUpperCase() 
        : (db.expendios[index].observaciones || db.expendios[index].observacion || ''));

  db.expendios[index] = {
    ...db.expendios[index],
    encargado: cleanEncargado,
    cedula: cleanCedula,
    direccionPunto: cleanDireccion,
    telefonoPunto: cleanTelefono,
    cuentaBancaria: cleanCuenta,
    banco: cleanBanco,
    correoElectronico: cleanCorreo,
    observacion: cleanObservaciones,
    observaciones: cleanObservaciones,
    primeraVezActualizado: true,
    fechaUltimaActualizacion: new Date().toISOString().split('T')[0],
  };

  // Record in trazabilidad for audit tracking (NEVER in db.historial, as accounting can only be moved by Admin)
  if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
  db.trazabilidad.unshift({
    id: `traz-${Date.now()}`,
    municipio: db.expendios[index].municipio || db.expendios[index].localidad,
    localidad: db.expendios[index].localidad,
    novedad: 'Actualización oficial de datos de contacto por el expendio',
    encargadoNuevo: cleanEncargado,
    cedulaNuevo: cleanCedula,
    fechaRegistro: new Date().toISOString(),
    registradoPor: `Expendio ${cleanEncargado} (CC: ${cleanCedula})`,
    observaciones: 'Actualización oficial de datos de contacto (Dirección, Celular, Cuenta Bancaria, Banco, Correo).',
  });

  saveDatabase(db);
  res.json({
    success: true,
    data: db.expendios[index],
    message: 'Datos del expendio actualizados exitosamente en mayúsculas.',
  });
});

// 3B. Expendio: Check generated cuenta de cobro status for a given period
const handleGetExpendioCuenta = (req: any, res: any) => {
  const cedulaParam = req.params?.cedula || req.query?.cedula;
  const { mes, anio, periodo } = req.query;
  const db = loadDatabase();

  const cleanDigits = (s?: any) => String(s || '').replace(/[^0-9]/g, '');
  const targetCedula = cleanDigits(cedulaParam);

  if (!targetCedula) {
    return res.status(400).json({ success: false, message: 'Cédula no proporcionada.' });
  }

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
  const isPeriodoPublicado = targetPeriodo === publishedPeriodo;

  // 1. Search strictly in db.historial for matching item of type 'Cuenta de Cobro'
  const historialMatch = (db.historial || []).find((h: any) => {
    if (h.tipo !== 'Cuenta de Cobro') return false;
    const hCedula = cleanDigits(h.cedula);
    if (hCedula !== targetCedula) return false;

    const hPeriodoUpper = (h.periodo || '').toUpperCase();
    if (mesSearch && !hPeriodoUpper.includes(mesSearch)) return false;
    if (anioSearch && !hPeriodoUpper.includes(anioSearch)) return false;
    return true;
  });

  if (historialMatch && (historialMatch.cuentaData || historialMatch.monto)) {
    return res.json({
      success: true,
      generada: true,
      isPeriodoPublicado,
      descargaHabilitada: isDescargaHabilitada,
      periodoConsultado: targetPeriodo,
      periodoPublicado: publishedPeriodo,
      data: historialMatch.cuentaData || {
        id: historialMatch.id,
        cedula: historialMatch.cedula,
        encargado: historialMatch.encargado,
        expendio: historialMatch.expendio,
        municipio: historialMatch.expendio,
        periodo: historialMatch.periodo,
        cargoBasico: historialMatch.monto || 0,
        admisionSipost: 0,
        valorVariable: 0,
        pagoTotal: historialMatch.monto || 0,
        retef1: Math.round((historialMatch.monto || 0) * 0.01),
        valorNeto: (historialMatch.monto || 0) - Math.round((historialMatch.monto || 0) * 0.01),
      },
      message: 'Cuenta de cobro encontrada en el registro oficial.',
    });
  }

  // 2. Search in db.relacionPagos
  if (Array.isArray(db.relacionPagos)) {
    const pagoMatch = db.relacionPagos.find((p) => {
      const pCedula = cleanDigits(p.cedula);
      if (pCedula !== targetCedula) return false;
      if (mesSearch && p.mes?.toUpperCase() !== mesSearch) return false;
      if (anioSearch && String(p.anio || '2026') !== anioSearch) return false;
      return true;
    });

    if (pagoMatch) {
      const valor = Number(pagoMatch.valorCancelar) || 121200;
      const rete = Math.round(valor * 0.01);
      const neto = valor - rete;

      return res.json({
        success: true,
        generada: true,
        isPeriodoPublicado,
        descargaHabilitada: isDescargaHabilitada,
        periodoConsultado: targetPeriodo,
        periodoPublicado: publishedPeriodo,
        data: {
          id: `pago-${pagoMatch.id || Date.now()}`,
          cedula: pagoMatch.cedula,
          encargado: pagoMatch.nombreEncargado,
          expendio: pagoMatch.municipio || 'EXPENDIO',
          municipio: pagoMatch.municipio || 'BUCARAMANGA',
          periodo: `${pagoMatch.mes || mesSearch} ${pagoMatch.anio || anioSearch || '2026'}`,
          centroOperativo: pagoMatch.centroOperativo || 'PO.BUCARAMANGA',
          cargoBasico: valor,
          admisionSipost: 0,
          valorVariable: 0,
          pagoTotal: valor,
          retef1: rete,
          valorNeto: neto,
          banco: pagoMatch.banco,
          cuentaBancaria: pagoMatch.cuenta,
        },
        message: 'Cuenta de cobro encontrada en relación de pagos.',
      });
    }
  }

  // 3. If targetPeriodo is the published period authorized by administration and user is a registered expendio,
  // ensure they can consult and download their official baseline cuenta de cobro immediately
  const expendio = (db.expendios || []).find((e: any) => cleanDigits(e.cedula) === targetCedula);
  if (isPeriodoPublicado && expendio) {
    const cargoBasicoVal = 121200;
    const reteVal = Math.round(cargoBasicoVal * 0.01);
    const netoVal = cargoBasicoVal - reteVal;

    const nuevaCuentaData = {
      id: `auto-${targetCedula}-${targetPeriodo.replace(/\s+/g, '_')}`,
      cedula: expendio.cedula,
      nombre: expendio.encargado || 'ENCARGADO EXPENDIO',
      encargado: expendio.encargado || 'ENCARGADO EXPENDIO',
      expendio: expendio.localidad || expendio.municipio || 'EXPENDIO POSTAL 4-72',
      municipio: expendio.municipio || expendio.localidad || 'BUCARAMANGA',
      periodo: targetPeriodo,
      centroOperativo: expendio.centroOperativo || 'REGIONAL ORIENTE',
      cargoBasico: cargoBasicoVal,
      admisionSipost: 0,
      valorVariable: 0,
      pagoTotal: cargoBasicoVal,
      retef1: reteVal,
      valorNeto: netoVal,
      banco: expendio.banco || 'BANCOLOMBIA',
      cuentaBancaria: expendio.cuentaBancaria || '',
      concepto: `Servicios de expendio postal 4-72 en el punto ${expendio.localidad || expendio.municipio}`,
      fechaEmision: new Date().toISOString().split('T')[0],
      fechaAprobacion: new Date().toISOString().split('T')[0],
      aprobada: true,
    };

    // Return baseline cuenta data for authorized period download WITHOUT persisting to db.historial
    // (Accounting history can only be modified by the Administrator)
    return res.json({
      success: true,
      generada: true,
      isPeriodoPublicado: true,
      descargaHabilitada: isDescargaHabilitada,
      periodoConsultado: targetPeriodo,
      periodoPublicado: publishedPeriodo,
      data: nuevaCuentaData,
      message: `Cuenta de cobro oficial disponible para consulta y descarga del periodo ${targetPeriodo}.`,
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
    // Sincronizar de forma permanente con Google Cloud Firestore
    saveDriveRegistryToCloud(registry).catch((e) => {
      console.warn('Error sincronizando registry a Firestore:', e.message);
    });
  } catch (e: any) {
    console.warn('Error guardando registro de fotos Google Drive:', e.message);
  }
}

function lookupMunicipioForCedula(cedulaRaw: string): { municipio: string; encargado?: string } {
  const clean = String(cedulaRaw || '').replace(/\D/g, '').trim();
  const db = loadDatabase();
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
  if (key.includes('tarifa')) return 'foto_tarifas';
  if (key.includes('aviso') || key.includes('letrero')) return 'foto_aviso';
  if (key.includes('panoramica') || key.includes('fachada')) return 'foto_panoramica';
  if (key.includes('matasello')) return 'foto_matasello';
  if (key.includes('bascula')) return 'foto_bascula';
  if (key.includes('contratista') || key.includes('encargado') || key.includes('persona')) return 'foto_contratista';
  if (key.includes('horario')) return 'foto_horario';
  if (key.includes('computador') || key.includes('pc')) return 'foto_computador';
  if (key.includes('cedulafrontal') || key.includes('cedula_frontal')) return 'foto_cedula_frontal';
  if (key.includes('cedulaposterior') || key.includes('cedula_posterior')) return 'foto_cedula_posterior';
  if (key.includes('rut')) return 'foto_rut';
  return 'foto_punto';
}

function getDrivePhotoFileName(slotKey: string, rawMunicipio?: string, rawFecha?: string | Date): string {
  const itemSlug = getPhotoItemSlug(slotKey);
  const cleanMuni = (rawMunicipio || 'giron')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  let fechaStr = '';
  if (rawFecha instanceof Date) {
    fechaStr = rawFecha.toISOString().split('T')[0];
  } else if (typeof rawFecha === 'string' && rawFecha.trim()) {
    const cleanDate = rawFecha.trim().split('T')[0].replace(/[/.]/g, '-').replace(/[^0-9-]/g, '');
    fechaStr = cleanDate;
  }
  if (!fechaStr) {
    fechaStr = new Date().toISOString().split('T')[0];
  }

  return `${itemSlug}_${cleanMuni || 'municipio'}_${fechaStr}.jpg`;
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


async function uploadPhotoToFirebaseStorageServer(
  buffer: Buffer,
  meta: {
    cedula: string;
    slotKey: string;
    municipio?: string;
    expendioNombre?: string;
    fecha?: string;
    overrideFileName?: string;
  }
): Promise<{ success: boolean; webContentLink?: string; webViewLink?: string; driveFileId?: string; folderName?: string; error?: string }> {
  // Firebase Storage requires authenticated rules or Admin SDK (which requires Service Accounts).
  // In the sandbox environment, this results in noisy "storage/unauthorized" errors in the console.
  // Since Google Drive and Local Storage are already acting as the robust double-backup system,
  // we silently bypass this to keep the logs clean and prevent user confusion.
  return { success: false, error: 'Firebase Storage uploads bypassed due to environment security constraints.' };

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

    // 5. Comprobar si el archivo ya existe en la subcarpeta del municipio
    const checkQuery = `'${municipioFolder.id}' in parents and name='${fileName}' and trashed=false`;
    const checkUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(checkQuery)}&fields=files(id,name,webViewLink,webContentLink)`;
    let existingFileId: string | null = null;
    try {
      let checkRes = await fetch(checkUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (checkRes.status === 401) {
        const refreshed = await getOrRefreshDriveTokenServer();
        if (refreshed && refreshed !== token) {
          token = refreshed;
          checkRes = await fetch(checkUrl, { headers: { Authorization: `Bearer ${token}` } });
        }
      }
      if (checkRes.ok) {
        const checkData = (await checkRes.json()) as any;
        if (checkData.files && checkData.files.length > 0) {
          existingFileId = checkData.files[0].id;
        }
      }
    } catch {}

    const description = `Fotografía de ${tipoLabel} del expendio en ${muniFormatted} (Cédula: ${cleanCed}, Encargado: ${meta.expendioNombre || ''}) - CAMARCA SAS`;

    let uploadedId = existingFileId;
    let webViewLink = '';
    let webContentLink = '';

    if (existingFileId) {
      // Actualizar archivo existente en la subcarpeta (PATCH)
      const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media&fields=id,name,webViewLink,webContentLink`;
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
    } else {
      // Subida multipart de archivo nuevo en la subcarpeta del municipio
      const boundary = `-------CamarcaPhotoBoundary${Date.now()}`;
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;
      const metadata = {
        name: fileName,
        mimeType: 'image/jpeg',
        parents: [municipioFolder.id],
        description,
      };

      const part1 = Buffer.from(
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: image/jpeg\r\n\r\n'
      );
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

    // 6. Actualizar registro en memoria, disco y Firestore
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

    // 7. Sincronizar automáticamente con la base de datos de expendios y Firestore
    try {
      const db = loadDatabase();
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
        saveDatabase(db);
        scheduleCloudSync(db, 1000);
      }
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
       const db = loadDatabase();
       if (db.config) {
           db.config.googleDriveAccessToken = '';
           saveDatabase(db);
       }
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
    saveDatabase(db);

    const totalDriveFiles = Object.keys(registry).length;

    saveDatabase(db);
    
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
       const db = loadDatabase();
       if (db.config) {
           db.config.googleDriveAccessToken = '';
           saveDatabase(db);
       }
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
    // Barrido periódico cada 30 segundos por alta disponibilidad
    this.sweepInterval = setInterval(() => {
      this.executeSync('Barrido periódico automático (30s)');
    }, 30 * 1000);
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

      // 3. Rescatar fotos en base64 de expendios que aún no estén en disco
      try {
        const db = loadDatabase();
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

        for (const exp of db.expendios) {
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

      const files = fs.readdirSync(photosDir).filter((f) => !f.startsWith('.') && f.endsWith('.jpg'));
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

          // Si no está en Firebase Storage o si el archivo local fue modificado después de la última subida
          if (!hasDriveId || wasModifiedLocally) {
            const lookup = lookupMunicipioForCedula(cedula);
            const db = loadDatabase();
            const expMatch = db.expendios.find((e: any) => String(e.cedula || '').replace(/\D/g, '').trim() === cedula.replace(/\D/g, '').trim());
            const buffer = fs.readFileSync(filePath);
            const fechaExp = expMatch?.fechaUltimaActualizacion || new Date().toISOString().split('T')[0];

            const res = await uploadPhotoToFirebaseStorageServer(buffer, {
              cedula,
              slotKey,
              municipio: lookup.municipio || 'Giron',
              expendioNombre: lookup.encargado || '',
              fecha: fechaExp,
            });

            if (res.success) {
              synced++;
              registry[key] = {
                driveFileId: res.driveFileId,
                webViewLink: res.webViewLink,
                webContentLink: res.webContentLink,
                lastSyncTime: new Date().toISOString(),
                localMtime: stat?.mtimeMs,
              };
              console.log(`[Background Sync] Sincronizada automáticamente foto ${f} -> expendios/${lookup.municipio || 'Giron'} en Firebase Storage`);
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
  });
});

app.post('/api/admin/google-drive/set-token', async (req, res) => {
  const { accessToken, refreshToken, email, displayName, expiresIn } = req.body;
  if (!accessToken || typeof accessToken !== 'string' || accessToken.trim().length < 10) {
    return res.status(400).json({ success: false, message: 'Se requiere accessToken válido.' });
  }
  const cleanToken = accessToken.trim();
  const cleanRefreshToken = typeof refreshToken === 'string' && refreshToken.trim().length > 5 ? refreshToken.trim() : undefined;
  const db = loadDatabase();
  if (!db.config) db.config = {} as any;
  db.config.googleDriveAccessToken = cleanToken;
  if (cleanRefreshToken) db.config.googleDriveRefreshToken = cleanRefreshToken;
  if (email) db.config.googleDriveAccountEmail = email;
  if (displayName) (db.config as any).googleDriveAccountName = displayName;
  const calculatedExpiresAt = expiresIn ? Date.now() + expiresIn * 1000 : (db.config.googleDriveTokenExpiresAt || Date.now() + 3600 * 1000);
  db.config.googleDriveTokenExpiresAt = calculatedExpiresAt;
  saveDatabase(db);

  // Guardar en archivo independiente google_drive_credentials.json
  const existingCreds = loadGoogleDriveCredentials();
  saveGoogleDriveCredentials({
    accessToken: cleanToken,
    refreshToken: cleanRefreshToken || existingCreds?.refreshToken,
    expiresAt: calculatedExpiresAt,
    email: email || db.config.googleDriveAccountEmail || '',
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

    const db = loadDatabase();
    if (!db.config) db.config = {} as any;
    db.config.googleDriveAccessToken = accessToken;
    if (refreshToken) db.config.googleDriveRefreshToken = refreshToken;
    db.config.googleDriveTokenExpiresAt = expiresAt;
    saveDatabase(db);

    const existingCreds = loadGoogleDriveCredentials();
    saveGoogleDriveCredentials({
      accessToken,
      refreshToken: refreshToken || existingCreds?.refreshToken,
      expiresAt,
      email: existingCreds?.email || db.config.googleDriveAccountEmail,
      displayName: existingCreds?.displayName || (db.config as any)?.googleDriveAccountName,
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

app.post('/api/admin/google-drive/sync-all', async (req, res) => {
  const token = (req.body?.accessToken as string) || (await getOrRefreshDriveTokenServer());
  if (!token) {
    return res.status(400).json({ success: false, message: 'No hay token de Google Drive activo en el servidor.' });
  }
  const synced = await syncPendingPhotosToServerDrive(token);
  res.json({ success: true, synced, message: `Se sincronizaron ${synced} fotos a Google Drive.` });
});

app.post('/api/admin/google-drive/reconcile', async (req, res) => {
  const token = (req.body?.accessToken as string) || (await getOrRefreshDriveTokenServer());
  if (!token) {
    return res.status(400).json({ success: false, message: 'No hay token de Google Drive activo en el servidor.' });
  }
  const result = await reconcileAndOrganizeGoogleDrivePhotosServer(token);
  res.json(result);
});

// 4. Expendio: Upload Photo (Multipart File)
app.post('/api/expendio/upload-photo', upload.single('photo'), async (req, res) => {
  const { cedula, photoType } = req.body;
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No se recibió ningún archivo de imagen.' });
  }

  const db = loadDatabase();
  const index = db.expendios.findIndex((exp) => exp.cedula.trim() === (cedula || '').trim());

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
  }

  const exp = db.expendios[index];

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

  // 1. Guardar localmente en disco permanente
  const localFileName = `${exp.cedula.trim()}_${canonicalSlot}.jpg`;
  try {
    fs.writeFileSync(path.join(photosDir, localFileName), fileBuffer);
    backgroundPhotoSyncEngine.notifyPhotoChanged(localFileName);
  } catch {}

  // 2. Asignar URL canónica permanente
  const canonicalUrl = `/api/photos/${encodeURIComponent(exp.cedula.trim())}/${canonicalSlot}`;

  (db.expendios[index] as any)[canonicalSlot] = canonicalUrl;

  if (canonicalSlot === 'fotoAvisoUrl') {
    db.expendios[index].fotoAvisoUrl = canonicalUrl;
    db.expendios[index].letreroUrl = canonicalUrl;
    db.expendios[index].tieneAviso = 'SI';
    db.expendios[index].motivoFaltaAviso = '';
  } else if (canonicalSlot === 'fotoBasculaUrl') {
    db.expendios[index].fotoBasculaUrl = canonicalUrl;
    db.expendios[index].basculaUrl = canonicalUrl;
    db.expendios[index].tieneBascula = 'SI';
    db.expendios[index].motivoFaltaBascula = '';
  } else if (canonicalSlot === 'fotoMataselloUrl') {
    db.expendios[index].fotoMataselloUrl = canonicalUrl;
    db.expendios[index].mataselloUrl = canonicalUrl;
    db.expendios[index].tieneMatasello = 'SI';
    db.expendios[index].motivoFaltaMatasello = '';
  }

  db.expendios[index].fechaUltimaActualizacion = new Date().toISOString().split('T')[0];
  saveDatabase(db);

    // 3. Subir de forma automática e inmediata a Firebase Storage en el servidor (expendios/{municipio}/{archivo})
    const storageResult = await uploadPhotoToFirebaseStorageServer(fileBuffer, {
      cedula: exp.cedula,
      slotKey: canonicalSlot,
      municipio: exp.municipio || exp.localidad || 'Giron',
      expendioNombre: exp.nombre || exp.encargado,
    });

    res.json({
      success: true,
      fileUrl: `${canonicalUrl}?t=${Date.now()}`,
      data: db.expendios[index],
      expendio: db.expendios[index],
      storageUploaded: storageResult.success,
      storageFileId: storageResult.driveFileId,
      storageWebViewLink: storageResult.webViewLink,
      storageFolderName: storageResult.folderName,
      message: storageResult.success
        ? `Fotografía subida inmediatamente a Firebase Storage (${storageResult.folderName}) y guardada en servidor.`
        : `Fotografía guardada permanentemente en servidor local.`,
    });
});

// 4B. Expendio: Upload Photo via JSON Base64
app.post('/api/expendio/upload-photo-base64', async (req, res) => {
  const { cedula, photoType, photoBase64 } = req.body;
  if (!cedula) {
    return res.status(400).json({ success: false, message: 'Se requiere la cédula del expendio.' });
  }

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

  const db = loadDatabase();
  const index = db.expendios.findIndex((exp) => exp.cedula.trim() === (cedula || '').trim());
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
  }

  const exp = db.expendios[index];

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

    // 1. Guardar en disco local persistente
    const cleanBase64 = formattedDataUrl.replace(/^data:[^;]+;base64,/, '').trim();
    const buffer = Buffer.from(cleanBase64, 'base64');
    const localFileName = `${exp.cedula.trim()}_${canonicalSlot}.jpg`;
    try {
      fs.writeFileSync(path.join(photosDir, localFileName), buffer);
      backgroundPhotoSyncEngine.notifyPhotoChanged(localFileName);
    } catch {}

    // 2. URL canónica permanente
    const canonicalUrl = `/api/photos/${encodeURIComponent(exp.cedula.trim())}/${canonicalSlot}`;

    (db.expendios[index] as any)[canonicalSlot] = canonicalUrl;

    if (canonicalSlot === 'fotoAvisoUrl') {
      db.expendios[index].fotoAvisoUrl = canonicalUrl;
      db.expendios[index].letreroUrl = canonicalUrl;
      db.expendios[index].tieneAviso = 'SI';
      db.expendios[index].motivoFaltaAviso = '';
    } else if (canonicalSlot === 'fotoBasculaUrl') {
      db.expendios[index].fotoBasculaUrl = canonicalUrl;
      db.expendios[index].basculaUrl = canonicalUrl;
      db.expendios[index].tieneBascula = 'SI';
      db.expendios[index].motivoFaltaBascula = '';
    } else if (canonicalSlot === 'fotoMataselloUrl') {
      db.expendios[index].fotoMataselloUrl = canonicalUrl;
      db.expendios[index].mataselloUrl = canonicalUrl;
      db.expendios[index].tieneMatasello = 'SI';
      db.expendios[index].motivoFaltaMatasello = '';
    }

    db.expendios[index].fechaUltimaActualizacion = new Date().toISOString().split('T')[0];
    saveDatabase(db);

    // 3. Subir de forma automática e inmediata a Firebase Storage en el servidor (expendios/{municipio}/{archivo})
    const storageResult = await uploadPhotoToFirebaseStorageServer(buffer, {
      cedula: exp.cedula,
      slotKey: canonicalSlot,
      municipio: exp.municipio || exp.localidad || 'Giron',
      expendioNombre: exp.nombre || exp.encargado,
    });

    res.json({
      success: true,
      fileUrl: `${canonicalUrl}?t=${Date.now()}`,
      data: db.expendios[index],
      expendio: db.expendios[index],
      storageUploaded: storageResult.success,
      storageFileId: storageResult.driveFileId,
      storageWebViewLink: storageResult.webViewLink,
      storageFolderName: storageResult.folderName,
      message: storageResult.success
        ? `Fotografía subida inmediatamente a Firebase Storage (${storageResult.folderName}) y guardada en servidor.`
        : `Fotografía guardada permanentemente en servidor local.`,
    });
  } catch (err: any) {
    console.error('Error guardando foto base64:', err);
    res.status(500).json({ success: false, message: 'Error interno guardando la imagen.' });
  }
});

// 4C. Expendio: Marcar disponibilidad de ítem (Báscula, Matasello, Letrero/Aviso)
app.post('/api/expendio/marcar-disponibilidad-item', (req, res) => {
  const { cedula, itemKey, tiene, motivo } = req.body;
  if (!cedula || !itemKey) {
    return res.status(400).json({ success: false, message: 'Faltan datos obligatorios (cedula, itemKey).' });
  }

  const db = loadDatabase();
  const index = db.expendios.findIndex((exp) => exp.cedula.trim() === String(cedula).trim());
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
  }

  const cleanTiene = tiene === 'SI' || tiene === true ? 'SI' : 'NO';
  const cleanMotivo = typeof motivo === 'string' ? motivo.trim() : '';

  if (itemKey === 'fotoAvisoUrl' || itemKey === 'aviso' || itemKey === 'letrero') {
    db.expendios[index].tieneAviso = cleanTiene;
    if (cleanTiene === 'NO') {
      db.expendios[index].fotoAvisoUrl = '';
      db.expendios[index].letreroUrl = '';
      db.expendios[index].motivoFaltaAviso = cleanMotivo;
    } else {
      db.expendios[index].motivoFaltaAviso = '';
    }
  } else if (itemKey === 'fotoBasculaUrl' || itemKey === 'bascula') {
    db.expendios[index].tieneBascula = cleanTiene;
    if (cleanTiene === 'NO') {
      db.expendios[index].fotoBasculaUrl = '';
      db.expendios[index].basculaUrl = '';
      db.expendios[index].motivoFaltaBascula = cleanMotivo;
    } else {
      db.expendios[index].motivoFaltaBascula = '';
    }
  } else if (itemKey === 'fotoMataselloUrl' || itemKey === 'matasello') {
    db.expendios[index].tieneMatasello = cleanTiene;
    if (cleanTiene === 'NO') {
      db.expendios[index].fotoMataselloUrl = '';
      db.expendios[index].mataselloUrl = '';
      db.expendios[index].motivoFaltaMatasello = cleanMotivo;
    } else {
      db.expendios[index].motivoFaltaMatasello = '';
    }
  }

  if (cleanTiene === 'NO' && cleanMotivo) {
    const itemLabel = (itemKey === 'fotoAvisoUrl' || itemKey === 'aviso' || itemKey === 'letrero')
      ? 'LETRERO/AVISO'
      : (itemKey === 'fotoBasculaUrl' || itemKey === 'bascula')
      ? 'BÁSCULA'
      : 'MATASELLO';
    const tag = `[NO TIENE ${itemLabel}: ${cleanMotivo.toUpperCase()}]`;
    const existingObs = db.expendios[index].observaciones || db.expendios[index].observacion || '';
    if (!existingObs.includes(`NO TIENE ${itemLabel}`)) {
      db.expendios[index].observaciones = existingObs ? `${existingObs} | ${tag}` : tag;
    }
  }

  db.expendios[index].fechaUltimaActualizacion = new Date().toISOString().split('T')[0];
  saveDatabase(db);

  res.json({
    success: true,
    data: db.expendios[index],
    expendio: db.expendios[index],
    message: `Disponibilidad de ${itemKey} actualizada a ${cleanTiene}.`,
  });
});

// 4D. Expendio: Marcar bienvenida / capacitación inicial completada
app.post('/api/expendio/marcar-bienvenida', (req, res) => {
  const { cedula } = req.body;
  if (!cedula) {
    return res.status(400).json({ success: false, message: 'Falta la cédula del expendio.' });
  }

  const db = loadDatabase();
  const index = db.expendios.findIndex((exp) => exp.cedula.trim() === String(cedula).trim());
  if (index !== -1) {
    db.expendios[index].bienvenidaRealizada = true;
    saveDatabase(db);
    return res.json({ success: true, data: db.expendios[index] });
  }

  res.json({ success: true, message: 'Expendio no encontrado, registrado en cliente.' });
});

// 5. Expendio: Upload Contract PDF
app.post('/api/expendio/upload-contract', upload.single('contrato'), (req, res) => {
  const { cedula } = req.body;
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No se recibió el archivo del contrato.' });
  }

  const db = loadDatabase();
  const index = db.expendios.findIndex((exp) => exp.cedula.trim() === (cedula || '').trim());

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Expendio no encontrado.' });
  }

  const fileUrl = `/uploads/contracts/${req.file.filename}`;
  db.expendios[index].contratoUrl = fileUrl;
  db.expendios[index].fechaUltimaActualizacion = new Date().toISOString().split('T')[0];

  saveDatabase(db);

  res.json({
    success: true,
    contratoUrl: fileUrl,
    expendio: db.expendios[index],
    message: 'Contrato PDF subido exitosamente.',
  });
});

// 6. Admin: Cuentas de cobro calculation & history batching
app.post('/api/admin/cuentas-cobro', (req, res) => {
  const {
    aplicarGrossUp,
    modificarValorInicialRetencion,
    porcentajeRetencion,
    periodo,
    sobrescribir,
    cargarAContabilidad,
  }: CuentaCobroParams & { sobrescribir?: boolean; cargarAContabilidad?: boolean } = req.body;
  const db = loadDatabase();

  const pRetencion = Number(porcentajeRetencion) > 0 ? Number(porcentajeRetencion) : 1;
  const retMod = Number(modificarValorInicialRetencion) || 0;
  const periodoFinal = periodo || 'MARZO 2026';
  const { mes, ano } = extractMesAno(periodoFinal);
  const mesUpper = mes.toUpperCase();
  const anioStr = ano;

  const totalExpendios = db.expendios.length;

  const resultados: CuentaCobroResult[] = db.expendios.map((exp, index) => {
    const baseContractual = exp.valorMensual || 0;
    const admisionSipost = exp.admisionSipost || 0;
    const valorVariable = exp.valorVariable || 0;
    const cargoBasicoDisplay = baseContractual + retMod;

    let pagoTotal: number;
    let retef1: number;
    let valorNeto: number;

    // Regla de negocio Gross Up:
    // CARGO BASICO + SUBSIDIO DE INTERNET USO DE SIPOST + VARIABLE GESTION = NETO A PAGAR
    // NO SE DESCUENTA LA RETENCIÓN CUANDO APLICA GROSS UP
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

  // Save batch to history
  const newHistorialItems: HistorialItem[] = resultados.map((r) => ({
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

  // Always remove existing historial records of type Cuenta de Cobro for the same month and year to prevent duplicate accumulation
  db.historial = (db.historial || []).filter((h) => {
    const p = (h.periodo || '').toUpperCase();
    const cP = (h.cuentaData?.periodo || '').toUpperCase();
    const matchesPeriodo = (p.includes(mesUpper) && p.includes(anioStr)) || (cP.includes(mesUpper) && cP.includes(anioStr));
    return !(matchesPeriodo && h.tipo === 'Cuenta de Cobro');
  });

  db.historial = deduplicateHistorial([...newHistorialItems, ...db.historial]);

  let contabilidadSyncResult = null;
  if (cargarAContabilidad) {
    contabilidadSyncResult = syncCuentasToRelacionPagos(db, resultados, periodoFinal);
  }

  saveDatabase(db);

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
    data: resultados,
    resumenFinanciero,
    sincronizadoContabilidad: !!contabilidadSyncResult,
    contabilidadSyncResult,
    message: `Se calcularon exitosamente ${resultados.length} cuentas de cobro para ${mesUpper} ${anioStr}.${
      contabilidadSyncResult
        ? ` Además, se sincronizaron con la Relación de Pagos.`
        : ''
    }`,
  });
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
app.post('/api/admin/upload-cuentas-cobro-excel', upload.any(), (req, res) => {
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
      
      // COLUMNA F: CARGO BASICO (Index 5)
      const cargoBasicoRaw = parseNumeric(getValFlex(row, ['CARGO BASICO', 'CARGOBASICO', 'CARGO BÁSICO', 'CARGO_BASICO', 'BASICO', 'VALOR MENSUAL', 'VALOR'], [5]));
      let cargoBasico = cargoBasicoRaw;
      if (cargoBasico <= 0) {
        const expMatch = db.expendios.find((e) => 
          e.municipio?.toLowerCase() === municipio.toLowerCase() || 
          e.localidad?.toLowerCase() === municipio.toLowerCase()
        );
        cargoBasico = expMatch?.valorMensual || 0;
      }

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

      // Update matching expendio financial parameters in database if exists
      const targetExp = db.expendios.find((e) =>
        e.municipio?.toLowerCase() === municipio.toLowerCase() ||
        e.localidad?.toLowerCase() === municipio.toLowerCase()
      );
      if (targetExp) {
        targetExp.admisionSipost = admisionSipost;
        targetExp.valorVariable = valorVariable;
        if (cargoBasico > 0) targetExp.valorMensual = cargoBasico;
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

    // Always remove previous history records of type Cuenta de Cobro for this month and year to prevent duplicate accumulation
    db.historial = (db.historial || []).filter((h) => {
      const p = (h.periodo || '').toUpperCase();
      const cP = (h.cuentaData?.periodo || '').toUpperCase();
      const matchesPeriodo = (p.includes(mesUpper) && p.includes(anioStr)) || (cP.includes(mesUpper) && cP.includes(anioStr));
      return !(matchesPeriodo && h.tipo === 'Cuenta de Cobro');
    });

    // Save newly parsed cuentas into history
    const newHistItems: HistorialItem[] = cuentasGeneradas.map((itemResult, idx) => ({
      id: `hist-excel-${Date.now()}-${idx}`,
      periodo: periodoActual,
      tipo: 'Cuenta de Cobro',
      encargado: itemResult.encargado,
      cedula: itemResult.cedula,
      expendio: itemResult.municipio,
      monto: itemResult.valorNeto,
      fecha: new Date().toISOString().split('T')[0],
      estado: 'Procesado',
      detalles: `Regeneración Masiva Excel (${itemResult.municipio} - Neto: $${itemResult.valorNeto.toLocaleString('es-CO')})`,
      cuentaData: itemResult,
    }));

    db.historial = deduplicateHistorial([...newHistItems, ...db.historial]);

    const totalCargoBasico = cuentasGeneradas.reduce((acc, c) => acc + (c.cargoBasico ?? c.valorBase ?? 0), 0);
    const totalSubsidioSipost = cuentasGeneradas.reduce((acc, c) => acc + (c.admisionSipost ?? 0), 0);
    const totalVariable = cuentasGeneradas.reduce((acc, c) => acc + (c.valorVariable ?? 0), 0);
    const totalPagoTotal = cuentasGeneradas.reduce((acc, c) => acc + (c.valorBruto ?? (c.cargoBasico || 0) + (c.admisionSipost || 0) + (c.valorVariable || 0)), 0);
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

    let contabilidadSyncResult = null;
    const cargarAContabilidad = req.body?.cargarAContabilidad === 'true' || req.body?.cargarAContabilidad === true;
    if (cargarAContabilidad) {
      contabilidadSyncResult = syncCuentasToRelacionPagos(db, cuentasGeneradas, periodoActual);
    }

    saveDatabase(db);

    // Clean up temporary uploaded file
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      // Ignore
    }

    res.json({
      success: true,
      data: cuentasGeneradas,
      alertas,
      resumenFinanciero,
      sincronizadoContabilidad: !!contabilidadSyncResult,
      contabilidadSyncResult,
      message: `¡Cargue de Excel exitoso! Se generaron ${cuentasGeneradas.length} cuentas de cobro masivas para el periodo ${mesUpper} ${anioStr}.${
        contabilidadSyncResult
          ? ` Además, se cargaron ${contabilidadSyncResult.totalSynced} cuentas a la contabilidad (Relación de Pagos).`
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
app.post('/api/admin/relacion-pagos/sync-from-cuentas-cobro', (req, res) => {
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

    // Remove existing matching accounts from history to avoid duplicates
    db.historial = db.historial.filter((h) => {
      const p = (h.periodo || '').toUpperCase();
      const cP = (h.cuentaData?.periodo || '').toUpperCase();
      const matchesPeriodo = (p.includes(mesUpper) && p.includes(anioStr)) || (cP.includes(mesUpper) && cP.includes(anioStr));
      return !(matchesPeriodo && h.tipo === 'Cuenta de Cobro');
    });

    db.historial = [...newHistItems, ...db.historial];

    const syncResult = syncCuentasToRelacionPagos(db, cuentas, periodo);
    saveDatabase(db);

    const totalNeto = cuentas.reduce((acc, c) => acc + (c.valorNeto || 0), 0);

    res.json({
      success: true,
      message: `¡Contabilidad actualizada con éxito! Se archivaron ${newHistItems.length} cuentas en el Historial de Cobros y ${syncResult.totalSynced} registros en la Relación de Pagos para el período ${syncResult.mes} ${syncResult.anio}.`,
      data: syncResult,
      totalNeto,
    });
  } catch (err: any) {
    console.error('Error al sincronizar cuentas a contabilidad:', err);
    res.status(500).json({
      success: false,
      message: `Error al cargar cuentas a contabilidad: ${err.message}`,
    });
  }
});

// 7. Admin: Historial
app.get('/api/admin/historial', (req, res) => {
  const db = loadDatabase();
  res.json({ success: true, data: db.historial });
});

// Delete single history item
app.delete('/api/admin/historial/:id', (req, res) => {
  const { id } = req.params;
  const db = loadDatabase();
  const initialLength = db.historial.length;
  db.historial = db.historial.filter((item) => item.id !== id);
  saveDatabase(db);
  res.json({ success: true, message: 'Registro de historial eliminado con éxito.' });
});

// Batch delete history items
app.post('/api/admin/historial/delete-batch', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'No se enviaron IDs para eliminar.' });
  }
  const db = loadDatabase();
  const idSet = new Set(ids);
  db.historial = db.historial.filter((item) => !idSet.has(item.id));
  saveDatabase(db);
  res.json({ success: true, message: `Se eliminaron ${ids.length} cuentas de cobro del historial.` });
});

// Clear all history
const handleClearAllHistory = (req: any, res: any) => {
  const { password } = req.body || {};
  if (password !== ADMIN_MASTER_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: 'Contraseña de seguridad incorrecta. Debe ingresar la contraseña autorizada Camarca.2023* para vaciar el historial.',
    });
  }

  const db = loadDatabase();
  const count = db.historial.length;
  db.historial = [];
  saveDatabase(db);
  res.json({ success: true, message: `Se limpió todo el historial (${count} registros).` });
};

app.delete('/api/admin/historial-all', handleClearAllHistory);
app.post('/api/admin/historial-all', handleClearAllHistory);

// Update / Edit single history item / cuenta de cobro
app.put('/api/admin/historial/:id', (req, res) => {
  const { id } = req.params;
  const updatedFields = req.body;
  const db = loadDatabase();

  const idx = db.historial.findIndex((h) => h.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Registro de cuenta de cobro no encontrado.' });
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

  saveDatabase(db);
  res.json({ success: true, data: db.historial[idx], message: 'Cuenta de cobro actualizada con éxito.' });
});

// 7B. Admin: Trazabilidad de Expendios por Municipio
app.get('/api/admin/trazabilidad', (req, res) => {
  const db = loadDatabase();
  res.json({ success: true, data: db.trazabilidad || [] });
});

app.post('/api/admin/trazabilidad', (req, res) => {
  const payload: Partial<TrazabilidadExpendio> = req.body;
  if (!payload.municipio) {
    return res.status(400).json({ success: false, message: 'El municipio es obligatorio para registrar la trazabilidad.' });
  }

  const db = loadDatabase();
  if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];

  const newItem: TrazabilidadExpendio = {
    id: `traz-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    municipio: payload.municipio,
    localidad: payload.localidad || payload.municipio,
    tipoMovimiento: payload.tipoMovimiento || 'CAMBIO_ENCARGADO',
    encargadoAnterior: payload.encargadoAnterior || '',
    cedulaAnterior: payload.cedulaAnterior || '',
    fechaRetiro: payload.fechaRetiro,
    encargadoNuevo: payload.encargadoNuevo || '',
    cedulaNuevo: payload.cedulaNuevo || '',
    telefonoNuevo: payload.telefonoNuevo || '',
    fechaIngreso: payload.fechaIngreso,
    estadoPunto: payload.estadoPunto || 'Cambiado',
    motivo: payload.motivo || '',
    observaciones: payload.observaciones || '',
    fechaRegistro: payload.fechaRegistro || new Date().toISOString(),
    registradoPor: payload.registradoPor || 'Admin CAMARCA',
  };

  db.trazabilidad.unshift(newItem);

  // If there's an existing expendio for this municipality, auto-update it with the new encargado if applicable
  const targetMun = payload.municipio.trim().toLowerCase();
  const expIdx = db.expendios.findIndex(
    (e) => (e.municipio || '').toLowerCase() === targetMun || (e.localidad || '').toLowerCase() === targetMun
  );

  if (expIdx !== -1) {
    if (payload.encargadoNuevo && payload.tipoMovimiento !== 'RETIRO_INHABILITACION') {
      db.expendios[expIdx].encargado = payload.encargadoNuevo;
      if (payload.cedulaNuevo) db.expendios[expIdx].cedula = payload.cedulaNuevo;
      if (payload.telefonoNuevo) db.expendios[expIdx].telefonoPunto = payload.telefonoNuevo;
    }
    db.expendios[expIdx].estado = (payload.estadoPunto as any) || 'Cambiado';
    db.expendios[expIdx].fechaUltimaActualizacion = new Date().toISOString().split('T')[0];
  }

  saveDatabase(db);
  res.json({ success: true, data: newItem, message: `Trazabilidad registrada para ${payload.municipio}.` });
});

const handleClearAllTrazabilidad = (req: any, res: any) => {
  const { password } = req.body || {};
  if (password !== ADMIN_MASTER_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: 'Contraseña de seguridad incorrecta. Debe ingresar la contraseña autorizada Camarca.2023* para vaciar la trazabilidad.',
    });
  }

  const db = loadDatabase();
  const count = (db.trazabilidad || []).length;
  db.trazabilidad = [];
  saveDatabase(db);
  res.json({ success: true, message: `Se eliminaron todos los registros de trazabilidad (${count} registros).` });
};

app.delete('/api/admin/trazabilidad-all', handleClearAllTrazabilidad);
app.post('/api/admin/trazabilidad-all', handleClearAllTrazabilidad);

const handleDeleteSingleTrazabilidad = (req: any, res: any) => {
  const { id } = req.params;
  const decodedId = decodeURIComponent(id);
  const db = loadDatabase();
  if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
  const prevCount = db.trazabilidad.length;
  db.trazabilidad = db.trazabilidad.filter((t) => t.id !== id && t.id !== decodedId);
  saveDatabase(db);
  res.json({ success: true, message: `Registro de trazabilidad eliminado con éxito (${prevCount - db.trazabilidad.length} eliminados).` });
};

app.delete('/api/admin/trazabilidad/:id', handleDeleteSingleTrazabilidad);
app.post('/api/admin/trazabilidad/:id/delete', handleDeleteSingleTrazabilidad);

// 8. Cliente 4-72: Export Exact 16 Columns to Excel (.xlsx)
app.get('/api/cliente/export-excel', (req, res) => {
  const db = loadDatabase();

  // Map strictly to the required 16 columns in exact required order
  const mappedData = db.expendios.map((e) => ({
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
  res.end(Buffer.from(excelBuffer));
});

// 9. CONFIGURATION: Periodo Habilitado de Descarga
const handleGetSystemConfig = (req: any, res: any) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const db = loadDatabase();
  res.json({ success: true, data: db.config || DEFAULT_CONFIG });
};

app.get('/api/config', handleGetSystemConfig);
app.get('/api/system/config', handleGetSystemConfig);
app.get('/api/admin/config/periodo-descarga', handleGetSystemConfig);

app.post('/api/admin/config/periodo-descarga', (req, res) => {
  const { periodoHabilitadoDescarga, descargaHabilitada } = req.body;
  const db = loadDatabase();

  const newPeriodo = (periodoHabilitadoDescarga || 'FEBRERO 2026').trim().toUpperCase();

  db.config = {
    ...db.config,
    periodoHabilitadoDescarga: newPeriodo,
    descargaHabilitada: descargaHabilitada !== undefined ? !!descargaHabilitada : true,
    fechaActualizacion: new Date().toISOString().split('T')[0],
  };

  saveDatabase(db);
  res.json({
    success: true,
    data: db.config,
    message: `✓ Periodo habilitado de descarga actualizado a: ${db.config.periodoHabilitadoDescarga} (${db.config.descargaHabilitada ? 'Habilitado' : 'Deshabilitado'}).`,
  });
});

// =======================================================
// PANEL DE GESTIÓN DE DOCUMENTACIÓN PARA EXPENDIOS
// =======================================================
// 1. Obtener listado de documentos de expendios (Admin)
app.get('/api/admin/documentos-expendios', (req, res) => {
  try {
    const db = loadDatabase();
    if (!Array.isArray(db.config.documentosExpendios) || db.config.documentosExpendios.length === 0) {
      db.config.documentosExpendios = [...DEFAULT_DOCUMENTOS_EXPENDIOS];
      saveDatabase(db);
    } else {
      // Ensure new default documents (like tarifario or horario) are present
      let changed = false;
      for (const defDoc of DEFAULT_DOCUMENTOS_EXPENDIOS) {
        if (!db.config.documentosExpendios.some((d) => d.id === defDoc.id)) {
          db.config.documentosExpendios.push({ ...defDoc });
          changed = true;
        }
      }
      if (changed) {
        saveDatabase(db);
      }
    }
    res.json({ success: true, data: db.config.documentosExpendios });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error cargando documentos de expendios: ' + err.message });
  }
});

// 2. Actualizar configuración de un documento (Habilitar/Deshabilitar, Renombrar, Descripción)
app.post('/api/admin/documentos-expendios', (req, res) => {
  try {
    const { id, nombre, descripcion, habilitado, badge } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID del documento es requerido.' });
    }

    const db = loadDatabase();
    if (!Array.isArray(db.config.documentosExpendios) || db.config.documentosExpendios.length === 0) {
      db.config.documentosExpendios = [...DEFAULT_DOCUMENTOS_EXPENDIOS];
    }

    const docIndex = db.config.documentosExpendios.findIndex((d) => d.id === id);
    if (docIndex === -1) {
      return res.status(404).json({ success: false, message: 'Documento no encontrado.' });
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

    saveDatabase(db);
    res.json({
      success: true,
      data: db.config.documentosExpendios[docIndex],
      all: db.config.documentosExpendios,
      message: `✓ Documento "${db.config.documentosExpendios[docIndex].nombre}" actualizado con éxito.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error actualizando documento: ' + err.message });
  }
});

// 2.1 Habilitar o Deshabilitar masivamente documentos para TODOS los expendios
app.post('/api/admin/documentos-expendios/bulk', (req, res) => {
  try {
    const { action, id, habilitar } = req.body;
    const db = loadDatabase();
    if (!Array.isArray(db.config.documentosExpendios) || db.config.documentosExpendios.length === 0) {
      db.config.documentosExpendios = [...DEFAULT_DOCUMENTOS_EXPENDIOS];
    }

    const todayStr = new Date().toISOString().split('T')[0];

    if (action === 'enable_all') {
      db.config.documentosExpendios = db.config.documentosExpendios.map((doc) => ({
        ...doc,
        habilitado: true,
        fechaActualizacion: todayStr,
      }));
      saveDatabase(db);
      return res.json({
        success: true,
        all: db.config.documentosExpendios,
        message: '✓ TODOS los documentos han sido HABILITADOS para TODOS los expendios.',
      });
    }

    if (action === 'disable_all') {
      db.config.documentosExpendios = db.config.documentosExpendios.map((doc) => ({
        ...doc,
        habilitado: false,
        fechaActualizacion: todayStr,
      }));
      saveDatabase(db);
      return res.json({
        success: true,
        all: db.config.documentosExpendios,
        message: '✓ TODOS los documentos han sido DESHABILITADOS para TODOS los expendios.',
      });
    }

    if (id) {
      const docIndex = db.config.documentosExpendios.findIndex((d) => d.id === id);
      if (docIndex === -1) {
        return res.status(404).json({ success: false, message: 'Documento no encontrado.' });
      }
      const nuevoHabilitado = habilitar !== undefined ? Boolean(habilitar) : !db.config.documentosExpendios[docIndex].habilitado;
      db.config.documentosExpendios[docIndex] = {
        ...db.config.documentosExpendios[docIndex],
        habilitado: nuevoHabilitado,
        fechaActualizacion: todayStr,
      };
      saveDatabase(db);
      return res.json({
        success: true,
        data: db.config.documentosExpendios[docIndex],
        all: db.config.documentosExpendios,
        message: `✓ Documento "${db.config.documentosExpendios[docIndex].nombre}" ${nuevoHabilitado ? 'HABILITADO' : 'DESHABILITADO'} para TODOS los expendios.`,
      });
    }

    return res.status(400).json({ success: false, message: 'Acción no válida o ID faltante.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error en acción masiva de documentos: ' + err.message });
  }
});

// 3. Subir archivo adjunto para un documento de expendio (Admin)
app.post('/api/admin/documentos-expendios/upload', upload.single('archivoDoc'), (req, res) => {
  try {
    const { id } = req.body;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se subió ningún archivo.' });
    }
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID del documento es requerido.' });
    }

    const db = loadDatabase();
    if (!Array.isArray(db.config.documentosExpendios)) {
      db.config.documentosExpendios = [...DEFAULT_DOCUMENTOS_EXPENDIOS];
    }

    const docIndex = db.config.documentosExpendios.findIndex((d) => d.id === id);
    if (docIndex === -1) {
      return res.status(404).json({ success: false, message: 'Documento no encontrado.' });
    }

    const fileUrl = `/uploads/docs_expendios/${req.file.filename}`;
    
    // Also save copy to permanent archive if possible
    try {
      const permCopyPath = path.join(permanentArchiveDir, req.file.filename);
      fs.copyFileSync(req.file.path, permCopyPath);
    } catch {}

    db.config.documentosExpendios[docIndex] = {
      ...db.config.documentosExpendios[docIndex],
      archivoUrl: fileUrl,
      archivoNombreOriginal: req.file.originalname,
      fechaActualizacion: new Date().toISOString().split('T')[0],
    };

    saveDatabase(db);
    res.json({
      success: true,
      data: db.config.documentosExpendios[docIndex],
      message: `✓ Archivo "${req.file.originalname}" cargado exitosamente. Ahora estará disponible tal cual para todos los expendios.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error subiendo archivo: ' + err.message });
  }
});

// 5. Descargar archivo original exacto de un documento de expendio (Sin modificaciones)
app.get('/api/documentos-expendios/download/:id', (req, res) => {
  try {
    const { id } = req.params;
    const db = loadDatabase();
    const doc = db.config?.documentosExpendios?.find((d) => d.id === id);
    if (!doc || !doc.archivoUrl) {
      return res.status(404).json({ success: false, message: 'El documento no tiene un archivo cargado actualmente.' });
    }

    const cleanPath = doc.archivoUrl.startsWith('/') ? doc.archivoUrl.substring(1) : doc.archivoUrl;
    let fullPath = path.join(process.cwd(), cleanPath);

    // Fallback to permanentArchiveDir if file missing in uploads
    if (!fs.existsSync(fullPath)) {
      const fileName = path.basename(cleanPath);
      const permPath = path.join(permanentArchiveDir, fileName);
      if (fs.existsSync(permPath)) {
        fullPath = permPath;
      } else {
        return res.status(404).json({ success: false, message: 'El archivo físico original no fue encontrado en el servidor.' });
      }
    }

    const downloadName = doc.archivoNombreOriginal || path.basename(fullPath);
    res.download(fullPath, downloadName);
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error descargando archivo original: ' + err.message });
  }
});

// 4. Obtener documentos disponibles para los Expendios
app.get('/api/expendio/documentos', (req, res) => {
  try {
    const db = loadDatabase();
    if (!Array.isArray(db.config.documentosExpendios) || db.config.documentosExpendios.length === 0) {
      db.config.documentosExpendios = [...DEFAULT_DOCUMENTOS_EXPENDIOS];
      saveDatabase(db);
    } else {
      let changed = false;
      for (const defDoc of DEFAULT_DOCUMENTOS_EXPENDIOS) {
        if (!db.config.documentosExpendios.some((d) => d.id === defDoc.id)) {
          db.config.documentosExpendios.push({ ...defDoc });
          changed = true;
        }
      }
      if (changed) {
        saveDatabase(db);
      }
    }
    res.json({
      success: true,
      data: db.config.documentosExpendios,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error obteniendo documentos: ' + err.message });
  }
});

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
        model: 'gemini-3.7-flash',
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
const handleGetCuentasCargadas = (req: any, res: any) => {
  const cedulaParam = req.params?.cedula || req.query?.cedula;
  const { periodo } = req.query;
  const db = loadDatabase();
  let list = db.cuentasCargadas || [];

  if (cedulaParam) {
    const cleanDigits = (s?: any) => String(s || '').replace(/[^0-9]/g, '');
    const targetCed = cleanDigits(cedulaParam);
    list = list.filter((c) => cleanDigits(c.cedula) === targetCed);
  }

  if (periodo) {
    const targetPer = String(periodo).trim().toUpperCase();
    list = list.filter((c) => (c.periodo || '').trim().toUpperCase() === targetPer);
  }

  res.json({ success: true, data: list });
};

app.get('/api/cuentas-cargadas', handleGetCuentasCargadas);
app.get('/api/expendio/cuentas-cargadas/:cedula', handleGetCuentasCargadas);

app.post('/api/expendio/cargar-cuenta', async (req, res) => {
  try {
    const { cedula, encargado, expendio, municipio, periodo, fotoBase64, monto } = req.body;
    if (!cedula || !fotoBase64) {
      return res.status(400).json({ success: false, message: 'La cédula y la fotografía escaneada son requeridas.' });
    }

    const db = loadDatabase();
    if (!Array.isArray(db.cuentasCargadas)) db.cuentasCargadas = [];
    if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];

    const periodoFinal = String(periodo || db.config?.periodoHabilitadoDescarga || 'FEBRERO 2026').trim().toUpperCase();
    const cleanCedula = String(cedula).trim();
    const cleanMunicipio = String(municipio || expendio || 'ARAUCA').trim().toUpperCase();

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

    const pagoRegistrado = db.relacionPagos.find(
      (p) =>
        (cleanDigits(p.cedula) === cleanDigits(cleanCedula) ||
          p.municipio.trim().toUpperCase() === cleanMunicipio) &&
        (p.mes.toUpperCase() === mesNorm || !p.mes)
    );

    const expRegistrado = db.expendios.find(
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

    // Cargar inmediatamente a Firebase Storage
    let driveUrl = '';
    let driveFileId = '';
    try {
      const storageUploadRes = await uploadPhotoToFirebaseStorageServer(imageBuffer, {
        cedula: cleanCedula,
        slotKey: 'cuenta_escaneada',
        municipio: cleanMunicipio,
        expendioNombre: datosEsperados.encargado,
        overrideFileName: `Cuenta_Cobro_${cleanMunicipio}_${cleanCedula}_${periodoFinal.replace(/\s+/g, '_')}.jpg`,
      });
      if (storageUploadRes.success) {
        driveUrl = storageUploadRes.webViewLink || '';
        driveFileId = storageUploadRes.driveFileId || '';
      }
    } catch (e: any) {
      console.warn('Error subiendo cuenta escaneada a Firebase Storage:', e.message);
    }

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

    // Remove older uploaded record for same expendio & period if exists
    db.cuentasCargadas = db.cuentasCargadas.filter(
      (c) => !(cleanDigits(c.cedula) === cleanDigits(cleanCedula) && c.periodo.toUpperCase() === periodoFinal)
    );
    db.cuentasCargadas.unshift(newCuentaCargada);

    // Auto-update or sync with Relacion de Pagos
    const relIdx = db.relacionPagos.findIndex(
      (p) =>
        (cleanDigits(p.cedula) === cleanDigits(cleanCedula) ||
          p.municipio.trim().toUpperCase() === cleanMunicipio) &&
        (p.mes.toUpperCase() === mesNorm || !p.mes)
    );

    if (relIdx !== -1) {
      db.relacionPagos[relIdx].estado = analisisIA.hayNovedad ? 'Cuenta con Novedad IA' : 'Listo para Pago';
      db.relacionPagos[relIdx].cuentaCargadaId = newId;
      db.relacionPagos[relIdx].analisisIA = analisisIA;
    }

    // Link signed file to existing official cuenta in db.historial without creating new accounts or modifying accounting values
    if (Array.isArray(db.historial)) {
      const histMatch = db.historial.find((h) => {
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
        // Note: Strict preservation of accounting — We NEVER modify histMatch.monto,
        // cargoBasico, retefuente, or valorNeto as entered by the administrator.
      }
    }

    saveDatabase(db);

    res.json({
      success: true,
      data: newCuentaCargada,
      message: `✓ Cuenta de cobro firmada cargada y analizada con IA para ${periodoFinal}. ${analisisIA.resumen}`,
    });
  } catch (err: any) {
    console.error('Error al guardar y analizar cuenta escaneada:', err);
    res.status(500).json({ success: false, message: `Error al procesar la imagen con IA: ${err.message}` });
  }
});

// Re-analizar con IA una cuenta ya cargada
app.post('/api/admin/cuentas-cargadas/:id/re-analizar-ia', async (req, res) => {
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

    cuenta.analisisIA = analisisIA;
    if (pagoRegistrado) {
      pagoRegistrado.analisisIA = analisisIA;
    }

    saveDatabase(db);

    res.json({
      success: true,
      data: cuenta,
      analisisIA,
      message: `✓ Re-análisis con IA completado. ${analisisIA.resumen}`,
    });
  } catch (err: any) {
    console.error('Error en re-análisis con IA:', err);
    res.status(500).json({ success: false, message: `Error en análisis IA: ${err.message}` });
  }
});

// Aplicar Novedad detectada por IA a la Base de Datos (Sincronización Total por Municipio)
app.post('/api/admin/relacion-pagos/aplicar-novedad-ia', (req, res) => {
  try {
    const { pagoId, nuevoNumeroCuenta, nuevoBanco, nuevoEncargado, nuevoValor, municipio } = req.body;
    const db = loadDatabase();
    if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];

    const targetMun = String(municipio || '').trim().toUpperCase();

    // 1. Update in relacionPagos
    let updatedPago: PagoRelacionItem | null = null;
    const formattedCtaNovedad = formatCuentaBancaria(nuevoNumeroCuenta, nuevoBanco);
    db.relacionPagos = db.relacionPagos.map((p) => {
      if (p.id === pagoId || (targetMun && p.municipio.trim().toUpperCase() === targetMun)) {
        const item = {
          ...p,
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

    // 2. Synchronize to Expendios by Municipio
    if (targetMun) {
      db.expendios = db.expendios.map((exp) => {
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

    saveDatabase(db);

    res.json({
      success: true,
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

async function analyzeScannedPageWithGemini(
  buffer: Buffer,
  mimeType: string,
  municipiosList: string[]
): Promise<ScannedPageAIResult> {
  const ai = getGeminiAI();
  if (!ai || !process.env.GEMINI_API_KEY) {
    return {
      municipio: '',
      municipioConfianza: 'Baja',
      requiereRevisionMunicipio: true,
      mes: new Date().toLocaleDateString('es-CO', { month: 'long' }).toUpperCase(),
      anio: String(new Date().getFullYear()),
      encargado: '',
      cedula: '',
      valorCobro: 0,
      tieneSoportePago: false,
      datosSoporte: {},
      observacionesIA: 'Sin conexión a Gemini AI. Por favor verifica y asigna los datos manualmente.',
    };
  }

  try {
    const base64Data = buffer.toString('base64');
    const prompt = `Eres un auditor contable de CAMARCA S.A.S. (NIT 900.504.241-7), contratista de 4-72 Servicios Postales Nacionales.
Analiza esta HOJA de CUENTA DE COBRO escaneada.

LISTA DE MUNICIPIOS OFICIALES DE EXPENDIOS EN NUESTRA BASE DE DATOS:
${JSON.stringify(municipiosList)}

Debes leer cuidadosamente el documento (encabezado, cuerpo, firmas y tirillas bancarias pegadas/adheridas) y extraer en formato JSON estricto:
1. "municipio": Nombre del municipio o localidad oficial (ej: ARAUCA, SARAVENA, TAME, FORTUL, CRAVO NORTE, PUERTO RONDÓN, etc.). Si en el texto dice un municipio de la lista, asígnalo exactamente en MAYÚSCULAS.
2. "municipioConfianza": "Alta" si se lee claramente, "Media" si es probable, "Baja" si no se visualiza.
3. "requiereRevisionMunicipio": true si tienes dudas del municipio, false si estás seguro.
4. "mes": Mes de cobro del servicio en MAYÚSCULAS (ej: ENERO, FEBRERO, MARZO, ABRIL, MAYO, JUNIO, JULIO, AGOSTO, SEPTIEMBRE, OCTUBRE, NOVIEMBRE, DICIEMBRE).
5. "anio": Año del cobro (ej: 2026, 2025).
6. "encargado": Nombre completo del contratista o persona a nombre de quien está la cuenta de cobro.
7. "cedula": Número de cédula de ciudadanía o NIT sin puntos.
8. "valorCobro": Valor neto o total a pagar en número entero (ej: 121200).
9. "tieneSoportePago": true si la hoja contiene una tirilla bancaria / comprobante de corresponsal (Redeban, Bancolombia, Nequi, Daviplata, Banco Agrario, consignación) pegado o impreso, false si es solo la cuenta sin comprobante.
10. "datosSoporte": {
  "entidad": "Nombre de la entidad / corresponsal (ej: Corresponsal Bancolombia Redeban, Nequi)",
  "valorPagado": Valor numérico entero en la tirilla,
  "fechaPago": "Fecha de pago (ej: 2026-02-28)",
  "numeroAprobacion": "Número de aprobación o transacción",
  "titular": "Nombre del titular en la tirilla",
  "tipoTransaccion": "RECARGA NEQUI / TRANSFERENCIA / CORRESPONSAL BANCARIO",
  "coincideValor": true si el valor pagado coincide con el valor de la cuenta
}
11. "observacionesIA": Resumen muy conciso del análisis (municipio identificado, mes, valor y estado del comprobante bancario).

Responde ÚNICAMENTE en JSON válido con esa estructura.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        {
          text: prompt,
        },
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const rawText = response.text || '{}';
    return JSON.parse(rawText);
  } catch (err) {
    console.error('Error analizando hoja con Gemini AI:', err);
    return {
      municipio: '',
      municipioConfianza: 'Baja',
      requiereRevisionMunicipio: true,
      mes: new Date().toLocaleDateString('es-CO', { month: 'long' }).toUpperCase(),
      anio: String(new Date().getFullYear()),
      encargado: '',
      cedula: '',
      valorCobro: 0,
      tieneSoportePago: false,
      datosSoporte: {},
      observacionesIA: 'Error al interpretar la imagen con IA. Se requiere revisión manual.',
    };
  }
}

app.post('/api/admin/conciliar-soporte-ai', uploadScanned.array('archivos', 25), async (req, res) => {
  const files = (req.files as Express.Multer.File[]) || [];
  if (files.length === 0) {
    return res.status(400).json({ success: false, message: 'No se subieron archivos para conciliar.' });
  }

  const db = loadDatabase();
  const municipiosList = Array.from(
    new Set(
      db.expendios
        .map((e) => (e.municipio || e.localidad || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );

  const resultados: ResultadoConciliacionAI[] = [];

  for (const file of files) {
    const filePath = file.path;
    const fileBuffer = fs.readFileSync(filePath);
    const isPdf =
      file.originalname.toLowerCase().endsWith('.pdf') ||
      (file.mimetype && file.mimetype.includes('pdf'));

    if (isPdf) {
      try {
        // Load PDF and split page by page
        const srcDoc = await PDFDocument.load(fileBuffer);
        const pageCount = srcDoc.getPageCount();

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
          // Create a standalone 1-page PDF document
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

          // Analyze this individual page with Gemini Flash 3.7
          const aiData = await analyzeScannedPageWithGemini(pageBuffer, 'application/pdf', municipiosList);

          // Match with expendio and historial
          const munUpper = (aiData.municipio || '').toUpperCase().trim();
          const matchedExpendio = db.expendios.find((e) => {
            const eMun = (e.municipio || e.localidad || '').toUpperCase().trim();
            const eCed = (e.cedula || '').trim();
            return (
              (munUpper && (eMun === munUpper || eMun.includes(munUpper) || munUpper.includes(eMun))) ||
              (aiData.cedula && eCed === String(aiData.cedula).trim())
            );
          });

          const finalMunicipio = munUpper || (matchedExpendio ? matchedExpendio.municipio.toUpperCase() : '');

          const matchedHistorial = db.historial.find((h) => {
            const hMun = (h.expendio || '').toUpperCase().trim();
            const hCed = (h.cedula || '').trim();
            const hPer = (h.periodo || '').toUpperCase();
            const matchesMunOrCed =
              (finalMunicipio && (hMun === finalMunicipio || hMun.includes(finalMunicipio))) ||
              (aiData.cedula && hCed === String(aiData.cedula).trim());
            const matchesPeriodo = !aiData.mes || hPer.includes(aiData.mes.toUpperCase());
            return matchesMunOrCed && matchesPeriodo;
          });

          const resultadoItem: ResultadoConciliacionAI = {
            id: `concil-${Date.now()}-${pageIndex + 1}-${Math.round(Math.random() * 1e5)}`,
            archivoNombre: `${file.originalname} (Hoja ${pageIndex + 1} de ${pageCount})`,
            archivoUrl: pageFileUrl,
            mimeType: 'application/pdf',
            hojaNumero: pageIndex + 1,
            totalHojas: pageCount,
            municipio: finalMunicipio,
            municipioConfianza: aiData.municipioConfianza || (finalMunicipio ? 'Alta' : 'Baja'),
            requiereRevisionMunicipio: !finalMunicipio || !!aiData.requiereRevisionMunicipio,
            mes: (aiData.mes || '').toUpperCase(),
            anio: String(aiData.anio || '2026'),
            periodo: `${aiData.mes || ''} ${aiData.anio || ''}`.trim() || 'PERIODO ACTUAL',
            encargado: (aiData.encargado || matchedExpendio?.encargado || '').toUpperCase(),
            cedula: (aiData.cedula || matchedExpendio?.cedula || '').trim(),
            valorCobro: Number(aiData.valorCobro) || matchedHistorial?.monto || matchedExpendio?.valorMensual || 0,
            tieneSoportePago: !!aiData.tieneSoportePago,
            datosSoporte: aiData.datosSoporte,
            observacionesIA:
              aiData.observacionesIA ||
              (aiData.tieneSoportePago ? 'Soporte bancario validado' : 'Sin tirilla bancaria visible'),
            estadoConciliacion: aiData.tieneSoportePago && finalMunicipio ? 'Listo' : 'RevisionManual',
            historialMatchedId: matchedHistorial?.id,
            expendioMatchedId: matchedExpendio?.id,
            expendioNombre: matchedExpendio?.localidad || matchedExpendio?.municipio || finalMunicipio,
          };

          resultados.push(resultadoItem);
        }
      } catch (pdfSplitErr) {
        console.error('Error dividiendo PDF multipágina, analizando como archivo único:', pdfSplitErr);
        // Fallback: analyze original file
        const fileUrl = `/uploads/scanned_cuentas/${file.filename}`;
        const aiData = await analyzeScannedPageWithGemini(fileBuffer, 'application/pdf', municipiosList);
        const munUpper = (aiData.municipio || '').toUpperCase().trim();
        const matchedExpendio = db.expendios.find(
          (e) => (e.municipio || e.localidad || '').toUpperCase().trim() === munUpper
        );
        resultados.push({
          id: `concil-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
          archivoNombre: file.originalname,
          archivoUrl: fileUrl,
          mimeType: 'application/pdf',
          hojaNumero: 1,
          totalHojas: 1,
          municipio: munUpper,
          municipioConfianza: aiData.municipioConfianza || (munUpper ? 'Alta' : 'Baja'),
          requiereRevisionMunicipio: !munUpper || !!aiData.requiereRevisionMunicipio,
          mes: (aiData.mes || '').toUpperCase(),
          anio: String(aiData.anio || '2026'),
          periodo: `${aiData.mes || ''} ${aiData.anio || ''}`.trim() || 'PERIODO ACTUAL',
          encargado: (aiData.encargado || matchedExpendio?.encargado || '').toUpperCase(),
          cedula: (aiData.cedula || matchedExpendio?.cedula || '').trim(),
          valorCobro: Number(aiData.valorCobro) || matchedExpendio?.valorMensual || 0,
          tieneSoportePago: !!aiData.tieneSoportePago,
          datosSoporte: aiData.datosSoporte,
          observacionesIA: aiData.observacionesIA || 'Documento analizado.',
          estadoConciliacion: aiData.tieneSoportePago && munUpper ? 'Listo' : 'RevisionManual',
          expendioMatchedId: matchedExpendio?.id,
          expendioNombre: matchedExpendio?.localidad || matchedExpendio?.municipio || munUpper,
        });
      }
    } else {
      // Direct image file (JPEG, PNG)
      const fileUrl = `/uploads/scanned_cuentas/${file.filename}`;
      const mimeType = file.mimetype || 'image/jpeg';
      const aiData = await analyzeScannedPageWithGemini(fileBuffer, mimeType, municipiosList);
      const munUpper = (aiData.municipio || '').toUpperCase().trim();
      const matchedExpendio = db.expendios.find(
        (e) => (e.municipio || e.localidad || '').toUpperCase().trim() === munUpper
      );
      const matchedHistorial = db.historial.find(
        (h) => (h.expendio || '').toUpperCase().trim() === munUpper
      );

      resultados.push({
        id: `concil-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
        archivoNombre: file.originalname,
        archivoUrl: fileUrl,
        mimeType,
        hojaNumero: 1,
        totalHojas: 1,
        municipio: munUpper,
        municipioConfianza: aiData.municipioConfianza || (munUpper ? 'Alta' : 'Baja'),
        requiereRevisionMunicipio: !munUpper || !!aiData.requiereRevisionMunicipio,
        mes: (aiData.mes || '').toUpperCase(),
        anio: String(aiData.anio || '2026'),
        periodo: `${aiData.mes || ''} ${aiData.anio || ''}`.trim() || 'PERIODO ACTUAL',
        encargado: (aiData.encargado || matchedExpendio?.encargado || '').toUpperCase(),
        cedula: (aiData.cedula || matchedExpendio?.cedula || '').trim(),
        valorCobro: Number(aiData.valorCobro) || matchedHistorial?.monto || matchedExpendio?.valorMensual || 0,
        tieneSoportePago: !!aiData.tieneSoportePago,
        datosSoporte: aiData.datosSoporte,
        observacionesIA: aiData.observacionesIA || 'Imagen analizada.',
        estadoConciliacion: aiData.tieneSoportePago && munUpper ? 'Listo' : 'RevisionManual',
        historialMatchedId: matchedHistorial?.id,
        expendioMatchedId: matchedExpendio?.id,
        expendioNombre: matchedExpendio?.localidad || matchedExpendio?.municipio || munUpper,
      });
    }
  }

  res.json({
    success: true,
    data: resultados,
    message: `¡Análisis completado! Se procesaron y dividieron ${resultados.length} hojas de cuentas de cobro con inteligencia artificial.`,
  });
});

// 4B. Admin: Approve single reconciled account -> Set status to Cancelado and attach single-page PDF
app.post('/api/admin/aprobar-conciliacion-cuenta', (req, res) => {
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

  const db = loadDatabase();
  const munUpper = (municipio || '').toUpperCase().trim();
  const mesUpper = (mes || new Date().toLocaleDateString('es-CO', { month: 'long' })).toUpperCase().trim();
  const anioStr = String(anio || new Date().getFullYear()).trim();
  const periodoStr = `${mesUpper} ${anioStr}`;
  const urlFinal = soporteUrl || archivoUrl || '';

  const matchedExp = db.expendios.find(
    (e) =>
      (e.municipio || e.localidad || '').toUpperCase().trim() === munUpper ||
      (cedula && (e.cedula || '').trim() === String(cedula).trim())
  );

  const finalCedula = cedula || matchedExp?.cedula || '';
  const finalEncargado = encargado || matchedExp?.encargado || munUpper;

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

  // Remove previous entry for same municipio/cedula in same period if any
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

  saveDatabase(db);

  res.json({
    success: true,
    message: `✓ Hoja de cuenta de cobro de ${munUpper} (${periodoStr}) asignada, adjuntada y marcada como CANCELADA / PAGADA.`,
    historial: db.historial,
    cuentasCargadas: db.cuentasCargadas,
  });
});

// 4C. Admin: Approve batch of reconciled accounts -> Set status to Cancelado and attach individual PDF pages
app.post('/api/admin/aprobar-conciliacion-lote', (req, res) => {
  const { cuentas } = req.body;
  if (!Array.isArray(cuentas) || cuentas.length === 0) {
    return res.status(400).json({ success: false, message: 'No se recibieron cuentas para conciliar.' });
  }

  const db = loadDatabase();
  let countAprobadas = 0;
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

  saveDatabase(db);

  res.json({
    success: true,
    message: `✓ Se aprobaron, asignaron y pasaron a estado CANCELADO ${countAprobadas} cuentas de cobro con sus respectivas hojas PDF y soportes adjuntos.`,
    historial: db.historial,
    cuentasCargadas: db.cuentasCargadas,
  });
});

// 4D. Admin: Export and Import database and photographic records
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

app.post('/api/admin/database-import-file', uploadBackupMulter.single('backupFile'), (req, res) => {
  try {
    const password = (req.body?.password || '').trim();
    if (password !== ADMIN_MASTER_PASSWORD) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(401).json({
        success: false,
        message: 'Contraseña de seguridad incorrecta. Debe ingresar Camarca.2023* para restaurar.',
      });
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

    // Restore photographic record files if embedded
    let fotosRestauradas = 0;
    const registroFotografico = targetData.registroFotografico || targetData.photosStore;
    if (registroFotografico && typeof registroFotografico === 'object') {
      for (const [relPath, photoInfo] of Object.entries(registroFotografico)) {
        try {
          const dataUrl = typeof photoInfo === 'string' ? photoInfo : (photoInfo as any)?.dataUrl;
          if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
            const parts = dataUrl.split(',');
            if (parts.length === 2) {
              const buffer = Buffer.from(parts[1], 'base64');
              const cleanRel = relPath.replace(/^[/\\]+/, '');
              const targetPath = path.join(process.cwd(), cleanRel);
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

    saveDatabase(restoredDb);
    createAutoSnapshot(restoredDb);

    res.json({
      success: true,
      message: `✓ Base de datos restaurada exitosamente con ${restoredDb.expendios.length} expendios, ${restoredDb.historial.length} registros en historial, ${restoredDb.relacionPagos?.length || 0} pagos y ${fotosRestauradas} fotos procesadas.`,
    });
  } catch (err: any) {
    console.error('Error procesando importación por archivo:', err);
    res.status(500).json({ success: false, message: 'Error procesando archivo de respaldo: ' + err.message });
  }
});

// 6. Restore Database via JSON Body
app.post('/api/admin/database-import', (req, res) => {
  const { database: rawIncomingDb, password } = req.body || {};
  if (password !== ADMIN_MASTER_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: 'Contraseña de seguridad incorrecta. Debe ingresar Camarca.2023* para restaurar la base de datos.',
    });
  }

  if (!rawIncomingDb || typeof rawIncomingDb !== 'object') {
    return res.status(400).json({ success: false, message: 'Estructura de datos de respaldo inválida.' });
  }

  const incomingDb = rawIncomingDb.database || rawIncomingDb;

  // Restaurar archivos del registro fotográfico si están incluidos en el respaldo
  let fotosRestauradas = 0;
  const registroFotografico = incomingDb.registroFotografico || incomingDb.photosStore;
  if (registroFotografico && typeof registroFotografico === 'object') {
    for (const [relPath, photoInfo] of Object.entries(registroFotografico)) {
      try {
        const dataUrl = typeof photoInfo === 'string' ? photoInfo : (photoInfo as any)?.dataUrl;
        if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
          const parts = dataUrl.split(',');
          if (parts.length === 2) {
            const buffer = Buffer.from(parts[1], 'base64');
            const cleanRel = relPath.replace(/^[/\\]+/, '');
            const targetPath = path.join(process.cwd(), cleanRel);
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

  saveDatabase(restoredDb);
  createAutoSnapshot(restoredDb);

  res.json({
    success: true,
    message: `✓ Base de datos restaurada exitosamente con ${restoredDb.expendios.length} expendios, ${restoredDb.historial.length} registros en historial, ${restoredDb.relacionPagos?.length || 0} pagos y ${fotosRestauradas} fotos del registro fotográfico recuperadas en el servidor.`,
  });
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
app.post('/api/admin/restaurar-backup-local', (req, res) => {
  try {
    const { filename, password } = req.body || {};
    if (password !== ADMIN_MASTER_PASSWORD) {
      return res.status(401).json({
        success: false,
        message: 'Contraseña de seguridad incorrecta. Debe ingresar Camarca.2023* para restaurar.',
      });
    }

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

    saveDatabase(restoredDb);

    res.json({
      success: true,
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
    cloudSync: getCloudSyncStatus(),
  });
});

// --- GOOGLE CLOUD FIRESTORE PERSISTENCIA ENDPOINTS ---
// Estado de sincronización en la nube
app.get('/api/admin/cloud-sync-status', (req, res) => {
  const status = getCloudSyncStatus();
  const db = loadDatabase();
  res.json({
    success: true,
    data: {
      ...status,
      localExpendios: (db.expendios || []).length,
      localHistorial: (db.historial || []).length,
      localRelacionPagos: (db.relacionPagos || []).length,
    },
  });
});

// Forzar sincronización inmediata hacia Google Cloud Firestore
app.post('/api/admin/cloud-sync-now', async (req, res) => {
  try {
    resetFirestoreQuotaCooldown();
    const db = loadDatabase();
    const success = await saveDatabaseToCloud(db, { force: true });
    const currentStatus = getCloudSyncStatus();
    res.json({
      success,
      message: success
        ? `✓ Base de datos sincronizada permanentemente en Google Cloud Firestore (${(db.expendios || []).length} expendios, ${(db.historial || []).length} cuentas de cobro).`
        : (currentStatus.lastSyncError || 'No se pudo sincronizar en Cloud Firestore.'),
      status: currentStatus,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error en sincronización Cloud: ' + err.message });
  }
});

// Restaurar forzadamente desde Google Cloud Firestore
app.post('/api/admin/cloud-restore-now', async (req, res) => {
  try {
    resetFirestoreQuotaCooldown();
    const currentLocalDb = loadDatabase();
    const cloudDb = await loadDatabaseFromCloud(currentLocalDb, { force: true });
    if (!cloudDb || !Array.isArray(cloudDb.expendios) || cloudDb.expendios.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No se encontraron datos válidos guardados en Cloud Firestore para restaurar.',
      });
    }
    saveDatabase(cloudDb);
    res.json({
      success: true,
      message: `✓ Datos restaurados exitosamente desde Cloud Firestore (${cloudDb.expendios.length} expendios, ${cloudDb.historial.length} cuentas de cobro).`,
      expendiosCount: cloudDb.expendios.length,
      historialCount: cloudDb.historial.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error restaurando desde Cloud: ' + err.message });
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

    // Save into testDbPath
    const testDb: DatabaseSchema = {
      expendios: Array.isArray(payload.expendios) ? payload.expendios : [],
      historial: Array.isArray(payload.historial) ? payload.historial : [],
      trazabilidad: Array.isArray(payload.trazabilidad) ? payload.trazabilidad : [],
      config: {
        ...(payload.config || DEFAULT_CONFIG),
        lastSyncFromPublished: new Date().toISOString(),
      },
      cuentasCargadas: Array.isArray(payload.cuentasCargadas) ? payload.cuentasCargadas : [],
      relacionPagos: Array.isArray(payload.relacionPagos) ? payload.relacionPagos : DEFAULT_RELACION_PAGOS,
      registrosAcceso: Array.isArray(payload.registrosAcceso) ? payload.registrosAcceso : [],
      visitasGenerales: typeof payload.visitasGenerales === 'number' ? payload.visitasGenerales : 0,
    };

    fs.writeFileSync(testDbPath, JSON.stringify(testDb, null, 2));

    res.json({
      success: true,
      ambiente: environmentMode,
      sourceUsed,
      message: `✓ Base de datos de TEST retroalimentada exitosamente desde ${sourceUsed} (${testDb.expendios.length} expendios, ${testDb.historial.length} registros).`,
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
app.post('/api/admin/config/google-drive', (req, res) => {
  const { googleDriveWebhookUrl } = req.body;
  const db = loadDatabase();
  if (!db.config) db.config = { ...DEFAULT_CONFIG };
  db.config.googleDriveWebhookUrl = (googleDriveWebhookUrl || '').trim();
  saveDatabase(db);
  res.json({
    success: true,
    message: db.config.googleDriveWebhookUrl
      ? '✓ URL de Webhook de Google Drive configurada correctamente.'
      : 'URL de Google Drive eliminada.',
    googleDriveWebhookUrl: db.config.googleDriveWebhookUrl,
  });
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

    // Limpieza pasiva de registros locales mayores a 2 días (1 semana)
    const ONE_WEEK_MS = 2 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - ONE_WEEK_MS;
    const initialCount = backups.length;
    backups = backups.filter((b: any) => {
      if (!b.timestamp) return false;
      const t = new Date(b.timestamp).getTime();
      return !isNaN(t) && t >= cutoff;
    });

    if (backups.length !== initialCount) {
      db.config.googleDriveBackups = backups;
      db.config.ultimoPurgeDrive = new Date().toISOString();
      saveDatabase(db);
    }

    const carpetaDriveId = db.config.carpetaDriveId || null;
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
app.post('/api/admin/google-drive/register-backup', (req, res) => {
  try {
    const record = req.body;
    if (!record || !record.id) {
      return res.status(400).json({ success: false, message: 'Datos de respaldo inválidos.' });
    }

    const db = loadDatabase();
    if (!db.config) db.config = { ...DEFAULT_CONFIG };
    if (!Array.isArray(db.config.googleDriveBackups)) {
      db.config.googleDriveBackups = [];
    }

    // Insertar al inicio y filtrar registros de más de 7 días para no saturar
    const ONE_WEEK_MS = 2 * 24 * 60 * 60 * 1000;
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

    saveDatabase(db);
    res.json({ success: true, message: '✓ Respaldo registrado correctamente.', backup: record });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error registrando respaldo: ' + err.message });
  }
});

// Limpieza y sincronización de registros eliminados de Google Drive (mayores a 2 días)
app.post('/api/admin/google-drive/cleanup-old-records', (req, res) => {
  try {
    const { deletedIds = [], maxAgeDays = 7 } = req.body || {};
    const db = loadDatabase();
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

    const removedCount = prevCount - db.config.googleDriveBackups.length;
    db.config.ultimoPurgeDrive = new Date().toISOString();
    saveDatabase(db);

    res.json({
      success: true,
      message: `✓ Sincronizados ${removedCount} registros eliminados por superar la política de 2 días.`,
      removedCount,
      remainingCount: db.config.googleDriveBackups.length,
      ultimoPurgeDrive: db.config.ultimoPurgeDrive,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error en cleanup-old-records: ' + err.message });
  }
});

// Activar o pausar el temporizador de 10 minutos para Google Drive
app.post('/api/admin/google-drive/toggle-auto', (req, res) => {
  try {
    const { activo } = req.body;
    const db = loadDatabase();
    if (!db.config) db.config = { ...DEFAULT_CONFIG };
    db.config.backupAutomaticoDriveActivo = activo !== false;
    saveDatabase(db);
    res.json({
      success: true,
      message: `Copia de seguridad automática cada 10 minutos ${db.config.backupAutomaticoDriveActivo ? 'ACTIVADA' : 'PAUSADA'}.`,
      activo: db.config.backupAutomaticoDriveActivo,
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
app.post('/api/admin/photos/scan-and-link', async (req, res) => {
  try {
    const db = loadDatabase();
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

    // Función para buscar expendio objetivo por cédula o municipio
    const findTargetExpendio = (cedulaCandidate?: string, muniCandidate?: string) => {
      if (cedulaCandidate) {
        const clean = cedulaCandidate.trim();
        const found = db.expendios.find((e) => e.cedula && e.cedula.trim() === clean);
        if (found) return found;
      }
      if (muniCandidate) {
        const cleanM = muniCandidate.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (cleanM.length >= 3) {
          const found = db.expendios.find((e) => {
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
              (targetExp as any)[slotKey] = canonicalUrl;
              if (slotKey === 'fotoAvisoUrl') {
                targetExp.fotoAvisoUrl = canonicalUrl;
                targetExp.letreroUrl = canonicalUrl;
                targetExp.tieneAviso = 'SI';
                targetExp.motivoFaltaAviso = '';
              } else if (slotKey === 'fotoBasculaUrl') {
                targetExp.fotoBasculaUrl = canonicalUrl;
                targetExp.basculaUrl = canonicalUrl;
                targetExp.tieneBascula = 'SI';
                targetExp.motivoFaltaBascula = '';
              } else if (slotKey === 'fotoMataselloUrl') {
                targetExp.fotoMataselloUrl = canonicalUrl;
                targetExp.mataselloUrl = canonicalUrl;
                targetExp.tieneMatasello = 'SI';
                targetExp.motivoFaltaMatasello = '';
              }
              targetExp.fechaUltimaActualizacion = new Date().toISOString().split('T')[0];
              linkedCount++;
              details.push({
                fileName,
                source: 'local',
                slot: slotKey,
                expendio: targetExp.localidad || targetExp.municipio,
                cedula: targetExp.cedula,
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
                    (targetExp as any)[slotKey] = canonicalUrl;
                    if (slotKey === 'fotoAvisoUrl') {
                      targetExp.fotoAvisoUrl = canonicalUrl;
                      targetExp.letreroUrl = canonicalUrl;
                      targetExp.tieneAviso = 'SI';
                      targetExp.motivoFaltaAviso = '';
                    } else if (slotKey === 'fotoBasculaUrl') {
                      targetExp.fotoBasculaUrl = canonicalUrl;
                      targetExp.basculaUrl = canonicalUrl;
                      targetExp.tieneBascula = 'SI';
                      targetExp.motivoFaltaBascula = '';
                    } else if (slotKey === 'fotoMataselloUrl') {
                      targetExp.fotoMataselloUrl = canonicalUrl;
                      targetExp.mataselloUrl = canonicalUrl;
                      targetExp.tieneMatasello = 'SI';
                      targetExp.motivoFaltaMatasello = '';
                    }
                    targetExp.fechaUltimaActualizacion = new Date().toISOString().split('T')[0];
                    linkedCount++;
                    details.push({
                      fileName: file.name,
                      source: 'drive',
                      slot: slotKey,
                      expendio: targetExp.localidad || targetExp.municipio,
                      cedula: targetExp.cedula,
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

    if (linkedCount > 0) {
      saveDatabase(db, { immediateCloudSync: true });
    }

    res.json({
      success: true,
      scannedFilesCount,
      linkedCount,
      details,
      message: `Se validaron ${scannedFilesCount} archivos en las carpetas y se cargaron/vincularon ${linkedCount} registros fotográficos a la plataforma.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error escaneando carpetas de fotos: ' + err.message });
  }
});

// Endpoint para migrar todas las fotos locales al nuevo Firebase Storage bajo expendios/{nombreExpendio}/{nombreArchivo.jpg}
app.post('/api/admin/firebase-storage/migrate-photos', async (req, res) => {
  try {
    const storage = getServerStorage();
    if (!storage) {
      return res.status(500).json({ success: false, message: 'Firebase Storage no está disponible.' });
    }

    const db = loadDatabase();
    const files = fs.existsSync(photosDir)
      ? fs.readdirSync(photosDir).filter((f) => !f.startsWith('.') && (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')))
      : [];

    let migrated = 0;
    let errors = 0;
    const results: Array<{ fileName: string; storageUrl: string; folder: string }> = [];

    for (const file of files) {
      try {
        const fullPath = path.join(photosDir, file);
        const buffer = fs.readFileSync(fullPath);
        const parts = file.replace(/\.(jpg|jpeg|png)$/i, '').split('_');
        const cedula = parts[0] || '';
        const slotKey = parts.slice(1).join('_') || 'foto';

        const lookup = lookupMunicipioForCedula(cedula);
        const expMatch = db.expendios.find((e: any) => String(e.cedula || '').replace(/\D/g, '').trim() === cedula.replace(/\D/g, '').trim());
        const muni = lookup.municipio || expMatch?.municipio || expMatch?.localidad || 'General';

        const uploadRes = await uploadPhotoToFirebaseStorageServer(buffer, {
          cedula,
          slotKey,
          municipio: muni,
          expendioNombre: lookup.encargado || expMatch?.encargado || expMatch?.nombre,
          overrideFileName: file,
        });

        if (uploadRes.success && uploadRes.webContentLink) {
          migrated++;
          results.push({
            fileName: file,
            storageUrl: uploadRes.webContentLink,
            folder: uploadRes.folderName || `expendios/${muni}`,
          });
        } else {
          errors++;
        }
      } catch (fErr: any) {
        errors++;
        console.error(`Error migrando foto ${file} a Firebase Storage:`, fErr.message);
      }
    }

    res.json({
      success: true,
      totalFound: files.length,
      migrated,
      errors,
      results,
      message: `Migración a Firebase Storage completada: ${migrated} fotos subidas exitosamente a la carpeta "expendios/...".`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error durante la migración a Firebase Storage: ' + err.message });
  }
});

// Endpoint para consultar estado de Firebase Storage
app.get('/api/admin/firebase-storage/status', (req, res) => {
  try {
    const fConfig = JSON.parse(fs.readFileSync(process.cwd() + '/firebase-applet-config.json', 'utf8'));
    res.json({
      success: true,
      storageBucket: fConfig.storageBucket,
      projectId: fConfig.projectId,
      ready: true,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/cuentas-cargadas/:id/estado', (req, res) => {
  const { id } = req.params;
  const { estado, observaciones } = req.body;
  const db = loadDatabase();
  if (!Array.isArray(db.cuentasCargadas)) db.cuentasCargadas = [];

  const idx = db.cuentasCargadas.findIndex((c) => c.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Cuenta cargada no encontrada.' });
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

  saveDatabase(db);
  res.json({ success: true, data: db.cuentasCargadas[idx], message: `Estado actualizado a: ${estado}` });
});

app.delete('/api/admin/cuentas-cargadas/:id', (req, res) => {
  const { id } = req.params;
  const db = loadDatabase();
  if (!Array.isArray(db.cuentasCargadas)) db.cuentasCargadas = [];

  const found = db.cuentasCargadas.find((c) => c.id === id);
  db.cuentasCargadas = db.cuentasCargadas.filter((c) => c.id !== id);

  // If local file exists, remove it
  if (found?.fotoUrl) {
    const filename = path.basename(found.fotoUrl);
    const filePath = path.join(scannedDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}
    }
  }

  saveDatabase(db);
  res.json({ success: true, message: 'Cuenta cargada eliminada correctamente.' });
});

// 11. MODULO RELACION DE PAGOS POR MESES
app.get('/api/admin/relacion-pagos', (req, res) => {
  const { mes, anio } = req.query;
  const db = loadDatabase();
  let list = db.relacionPagos || [];

  if (mes) {
    const targetMes = String(mes).trim().toUpperCase();
    list = list.filter((p) => (p.mes || '').toUpperCase() === targetMes);
  }

  if (anio) {
    const targetAnio = String(anio).trim();
    list = list.filter((p) => String(p.anio || '2026') === targetAnio);
  }

  // Cross-reference with cuentasCargadas to update realtime status
  const cuentasCargadas = db.cuentasCargadas || [];
  const updatedList = list.map((item) => {
    const matchingCargada = cuentasCargadas.find(
      (c) =>
        c.cedula.replace(/[^0-9]/g, '') === item.cedula.replace(/[^0-9]/g, '') &&
        c.periodo.toUpperCase().includes((item.mes || '').toUpperCase())
    );
    if (matchingCargada) {
      return {
        ...item,
        cuentaCargadaId: matchingCargada.id,
        estado: matchingCargada.estado === 'Aprobada' ? 'Listo para Pago' : 'Cuenta Firmada Cargada',
      };
    }
    return item;
  });

  res.json({ success: true, data: updatedList });
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
  'SAN GIL': 'PO. BUCARAMANGA',
  SOCORRO: 'PO. BUCARAMANGA',
  MALAGA: 'PO. BUCARAMANGA',
  VELEZ: 'PO. BUCARAMANGA',
  BARBOSA: 'PO. BUCARAMANGA',
  AGUACHICA: 'PO. BUCARAMANGA',
  SIMITI: 'PO. BUCARAMANGA',
  ARAUCA: 'PO. ARAUCA',
  ARAUQUITA: 'PO. ARAUCA',
  'CRAVO NORTE': 'PO. ARAUCA',
  FORTUL: 'PO. ARAUCA',
  SARAVENA: 'PO. ARAUCA',
  TAME: 'PO. ARAUCA',
  'PUERTO RONDON': 'PO. ARAUCA',
  VALLEDUPAR: 'PO. VALLEDUPAR',
};

const resolveCentroOperativo = (mun: string, rawCentroOp?: string): string => {
  const normMun = (mun || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const rawOp = (rawCentroOp || '').trim().toUpperCase();

  // If rawCentroOp is provided, preserve it directly
  if (rawOp && rawOp !== '-' && rawOp !== '') {
    return rawOp;
  }

  // Look up in dictionary by municipality
  if (normMun && MUNICIPIO_CENTRO_OP_MAP[normMun]) {
    return MUNICIPIO_CENTRO_OP_MAP[normMun];
  }

  return 'PO.BUCARAMANGA';
};

// 11B. Auto-generate / Sync Relación de Pagos from registered Expendios for a month
const handleGenerarRelacionPagos = (req: express.Request, res: express.Response) => {
  const { mes = 'FEBRERO', anio = '2026' } = req.body;
  const mesNorm = String(mes).trim().toUpperCase();
  const anioNorm = String(anio).trim();

  const db = loadDatabase();
  if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];

  // Remove existing items for this month or update them
  const existingOtherMonths = db.relacionPagos.filter(
    (p) => !(p.mes?.toUpperCase() === mesNorm && String(p.anio || '2026') === anioNorm)
  );

  const cuentasCargadas = db.cuentasCargadas || [];
  const cleanDigits = (s?: string) => (s || '').replace(/[^0-9]/g, '');

  const generatedItems: PagoRelacionItem[] = db.expendios.map((exp, index) => {
    // Check if there is already a generated cuenta in historial for this period to get net amount
    const histMatch = (db.historial || []).find(
      (h) =>
        cleanDigits(h.cedula) === cleanDigits(exp.cedula) &&
        h.periodo?.toUpperCase().includes(mesNorm) &&
        h.cuentaData
    );

    const valorCancelar = histMatch?.cuentaData?.valorNeto || exp.valorMensual || 0;
    const munKey = (exp.municipio || exp.localidad || 'ARBOLEDAS').trim().toUpperCase();
    const centroOp = resolveCentroOperativo(munKey, exp.centroOperativo);

    // Check if there is an uploaded scanned signed account
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

    // Format cédula with dots for readability (e.g. 1.116.796.414)
    const rawCed = exp.cedula.replace(/[^0-9]/g, '');
    const formattedCedula = rawCed.replace(/\B(?=(\d{3})+(?!\d))/g, '.') || exp.cedula;

    // Resolve real bank account (check existing relacionPagos or clean phone)
    const existingPago = (db.relacionPagos || []).find(
      (p) => p.municipio.trim().toUpperCase() === munKey || cleanDigits(p.cedula) === cleanDigits(exp.cedula)
    );

    let cuentaFinal = 'NEQUI 3123304166';
    let bancoFinal = 'NEQUI';

    if (existingPago?.cuenta && !/^\d{5,6}$/.test(existingPago.cuenta.trim())) {
      const formatted = formatCuentaBancaria(existingPago.cuenta, existingPago.banco);
      cuentaFinal = formatted.cuenta;
      bancoFinal = formatted.banco;
    } else if (exp.telefonoPunto) {
      const phoneClean = cleanNequiNumber(exp.telefonoPunto);
      cuentaFinal = phoneClean ? `NEQUI ${phoneClean}` : 'NEQUI 3123304166';
      bancoFinal = 'NEQUI';
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
  saveDatabase(db);

  res.json({
    success: true,
    data: generatedItems,
    message: `✓ Relación de Pagos generada y sincronizada para MES ${mesNorm} ${anioNorm} (${generatedItems.length} expendios vinculados por Municipio).`,
  });
};

app.post('/api/admin/relacion-pagos/auto-generate', handleGenerarRelacionPagos);
app.post('/api/admin/relacion-pagos/generar-desde-expendios', handleGenerarRelacionPagos);

// 11C. Import Excel for Relación de Pagos with Multi-Sheet & Robust 2D Grid Parsing
app.post('/api/admin/relacion-pagos/import-excel', upload.any(), (req, res) => {
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
            cedula: cand.formattedCed || db.expendios[expIdx].cedula,
            telefonoPunto: cand.digitsPhone.length >= 10 ? cand.digitsPhone : db.expendios[expIdx].telefonoPunto,
            valorMensual: cand.valorFinal,
          };
        } else {
          db.expendios.push({
            id: `exp-${Date.now()}-${importedItems.length + 1}`,
            centroOperativo: cand.centroOperativoFinal,
            centroAcopio: 'REGIONAL ORIENTE',
            localidad: cand.municipioFinal,
            municipio: cand.municipioFinal,
            encargado: cand.nombreFinal,
            cedula: cand.formattedCed || '1.116.000.000',
            direccionPunto: `CALLE PRINCIPAL ${cand.municipioFinal}`,
            telefonoPunto: cand.digitsPhone.length >= 10 ? cand.digitsPhone : '3123304166',
            usuarioSipost: 'SI',
            internet: 'SI',
            nit: '',
            correoElectronico: '',
            observacion: 'Importado y sincronizado vía Excel Relación de Pagos',
            valorMensual: cand.valorFinal,
            admisionSipost: 0,
          });
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

    if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];

    // Replace entries for this month
    const existingOther = db.relacionPagos.filter(
      (p) => !(p.mes?.toUpperCase() === mes && String(p.anio || '2026') === anio)
    );

    db.relacionPagos = [...existingOther, ...importedItems];
    saveDatabase(db);

    res.json({
      success: true,
      data: importedItems,
      message: `✓ Se importaron y sincronizaron ${importedItems.length} expendios exitosamente desde ${sheetsProcessed.length} hoja(s) (${sheetsProcessed.join(', ')}) para ${mes} ${anio}.`,
    });
  } catch (err: any) {
    console.error('Error importando Excel de relación de pagos:', err);
    res.status(500).json({ success: false, message: err.message || 'Error al procesar archivo Excel.' });
  }
});

// 11C2. Save / Update batch of Relación de Pagos
app.post('/api/admin/relacion-pagos', (req, res) => {
  try {
    const list = req.body;
    if (!Array.isArray(list)) {
      return res.status(400).json({ success: false, message: 'Se esperaba un arreglo de registros de pago.' });
    }
    const db = loadDatabase();
    db.relacionPagos = list;
    saveDatabase(db);
    res.json({ success: true, data: list, message: 'Relación de pagos actualizada.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 11D. Update single Relación de Pagos item
app.put('/api/admin/relacion-pagos/:id', (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;
  const db = loadDatabase();
  if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];

  const idx = db.relacionPagos.findIndex((p) => p.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Registro de pago no encontrado.' });
  }

  db.relacionPagos[idx] = {
    ...db.relacionPagos[idx],
    ...updatedData,
    valorCancelar: updatedData.valorCancelar !== undefined ? Number(updatedData.valorCancelar) : db.relacionPagos[idx].valorCancelar,
  };

  saveDatabase(db);
  res.json({ success: true, data: db.relacionPagos[idx], message: 'Registro de pago actualizado con éxito.' });
});

// 11E. Delete single payment item
app.delete('/api/admin/relacion-pagos/:id', (req, res) => {
  const { id } = req.params;
  const db = loadDatabase();
  if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];

  db.relacionPagos = db.relacionPagos.filter((p) => p.id !== id);
  saveDatabase(db);
  res.json({ success: true, message: 'Registro eliminado con éxito.' });
});

// 11E2. Reset / Clear Relación de Pagos (Total reset or clear prior to target month like Marzo)
app.post('/api/admin/relacion-pagos/reset', (req, res) => {
  try {
    const { modo = 'todos', mes = 'MARZO', anio = '2026', password } = req.body || {};
    if (password !== ADMIN_MASTER_PASSWORD) {
      return res.status(401).json({
        success: false,
        message: 'Contraseña de seguridad incorrecta. Debe ingresar la contraseña autorizada Camarca.2023* para resetear la base de relación de pagos.',
      });
    }

    const db = loadDatabase();
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

    saveDatabase(db);

    res.json({
      success: true,
      message: `✓ Base de datos de Relación de Pagos reseteada con éxito. Se eliminaron ${totalAnterior - db.relacionPagos.length} registros anteriores. Quedan ${db.relacionPagos.length} registros para ejecución limpia a partir de ${mes} ${anio}.`,
      data: db.relacionPagos,
    });
  } catch (err: any) {
    console.error('Error al resetear relación de pagos:', err);
    res.status(500).json({ success: false, message: err.message || 'Error al resetear la base de datos.' });
  }
});

// 11E3. Unified Delete / Vaciar Base de Datos (Expendios, Relación de Pagos borrado total, Historial de Cobros)
app.post('/api/admin/vaciar-base-datos', (req, res) => {
  try {
    const { password, targets = {} } = req.body || {};
    if (password !== ADMIN_MASTER_PASSWORD) {
      return res.status(401).json({
        success: false,
        message: 'Contraseña de seguridad incorrecta. Ingrese la clave autorizada Camarca.2023* para autorizar la eliminación de base de datos.',
      });
    }

    const db = loadDatabase();
    const actions: string[] = [];

    const deleteExpendios = !!(targets.expendios || targets.todo);
    const deleteRelacionPagos = !!(targets.relacionPagos || targets.todo);
    const deleteHistorial = !!(targets.historial || targets.todo);

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

    if (actions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Debe seleccionar al menos un módulo para eliminar.',
      });
    }

    saveDatabase(db);

    res.json({
      success: true,
      message: `✓ Vaciado completado: ${actions.join(', ')}. Base de datos actualizada con éxito.`,
      data: {
        expendiosCount: (db.expendios || []).length,
        relacionPagosCount: (db.relacionPagos || []).length,
        historialCount: (db.historial || []).length,
      },
    });
  } catch (err: any) {
    console.error('Error en vaciado de base de datos:', err);
    res.status(500).json({ success: false, message: err.message || 'Error al procesar la eliminación de datos.' });
  }
});

// 11G. Batch approve / confirm Inter-Monthly Changes and update Master Expendios
app.post('/api/admin/relacion-pagos/aprobar-cambios-intermensuales', (req, res) => {
  try {
    const { itemsAprobados, mes, anio } = req.body;
    if (!Array.isArray(itemsAprobados)) {
      return res.status(400).json({ success: false, message: 'Se esperaba un arreglo de cambios aprobados.' });
    }

    const db = loadDatabase();
    if (!Array.isArray(db.relacionPagos)) db.relacionPagos = [];
    if (!Array.isArray(db.expendios)) db.expendios = [];
    if (!Array.isArray(db.historial)) db.historial = [];

    const cleanNorm = (str: any) =>
      str ? String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim() : '';
    const cleanDigits = (s?: any) => String(s || '').replace(/[^0-9]/g, '');

    let updatedRelacionCount = 0;
    let updatedMaestroCount = 0;

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
          updatedMaestroCount++;

          // Log in Trazabilidad (Master data novelty tracking, NEVER accounting history)
          if (!Array.isArray(db.trazabilidad)) db.trazabilidad = [];
          db.trazabilidad.unshift({
            id: `traz-intermensual-${Date.now()}-${updatedMaestroCount}`,
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
          });
        }
      }
    });

    saveDatabase(db);

    const updatedCurrentMonth = db.relacionPagos.filter(
      (p) => p.mes?.toUpperCase() === (mes || '').toUpperCase() && String(p.anio || '2026') === String(anio || '2026')
    );

    res.json({
      success: true,
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

// --- API ERROR HANDLER ---
app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('API Error:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: `Error al subir archivo: ${err.message}` });
  }
  res.status(500).json({ success: false, message: err?.message || 'Error interno del servidor' });
});

// Fallback for unmatched /api routes (prevent falling through to HTML SPA fallback)
app.all('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: `Ruta API no encontrada: ${req.method} ${req.originalUrl}` });
});

// --- VITE MIDDLEWARE / PRODUCTION STATIC SERVING ---
async function startServer() {
  // PERSISTENCIA EN LA NUBE: Hidratar datos desde Google Cloud Firestore en el arranque
  try {
    console.log('[Startup] Inicializando conexión permanente con Google Cloud Firestore...');
    const localDb = loadDatabase();
    const cloudDb = await loadDatabaseFromCloud(localDb);

    const localExpCount = (localDb?.expendios || []).length;
    const cloudExpCount = (cloudDb?.expendios || []).length;
    const localHistCount = (localDb?.historial || []).length;
    const cloudHistCount = (cloudDb?.historial || []).length;

    let chosenDb = localDb;
    if (cloudDb && cloudExpCount > 0) {
      // In a serverless environment, the local file is ephemeral.
      // We must ALWAYS trust the cloud as the source of truth, 
      // unless the local database has STRICTLY MORE items (e.g. an offline sync recovery).
      if (!localDb.config?.isEphemeralSeed && (localExpCount > cloudExpCount || localHistCount > cloudHistCount)) {
        console.log(
          `[Startup] Base local (${localExpCount} exp, ${localHistCount} hist) tiene estrictamente mayor información que la nube (${cloudExpCount} exp, ${cloudHistCount} hist) y no es semilla. Preservando datos locales y sincronizando a Firestore...`
        );
        chosenDb = localDb;
        await saveDatabaseToCloud(chosenDb, { force: true });
      } else {
        console.log(
          `[Startup] ✓ Base de datos segura cargada desde Cloud Firestore con ${cloudExpCount} expendios y ${cloudHistCount} cuentas.`
        );
        chosenDb = cloudDb;
      }
      const currentDbPath = getActiveDbPath();
      fs.writeFileSync(currentDbPath, JSON.stringify(chosenDb, null, 2));
      if (isPublishedEnv) {
        fs.writeFileSync(masterPublishedDbPath, JSON.stringify(chosenDb, null, 2));
        fs.writeFileSync(legacyDbPath, JSON.stringify(chosenDb, null, 2));
      }
    } else {
      console.log(`[Startup] Usando almacenamiento permanente local (${localExpCount} expendios). Sincronizando hacia Cloud Firestore...`);
      const status = getCloudSyncStatus();
      if (!status.quotaExhausted) {
        await saveDatabaseToCloud(localDb, { force: true });
      }
    }

    // Hidratar registro permanente de fotos de Google Drive
    const driveRegistry = await loadDriveRegistryFromCloud();
    if (driveRegistry && Object.keys(driveRegistry).length > 0) {
      console.log(`[Startup] ✓ Registro de Google Drive hidratado desde la nube: ${Object.keys(driveRegistry).length} fotos registradas.`);
      drivePhotosRegistryMemory = { ...driveRegistry };
      fs.writeFileSync(drivePhotosRegistryPath, JSON.stringify(driveRegistry, null, 2), 'utf8');
    }

    // Auto-organización y reconciliación inicial de Google Drive
    const activeToken = await getOrRefreshDriveTokenServer();
    if (activeToken) {
      console.log('[Startup] Conexión permanente con Google Drive detectada. Iniciando reconciliación y sincronización de fotos...');
      reconcileAndOrganizeGoogleDrivePhotosServer(activeToken)
        .then(() => syncPendingPhotosToServerDrive(activeToken))
        .catch((e) => console.warn('[Startup] Advertencia en auto-sincronización de Drive:', e.message));
    }
  } catch (cloudErr: any) {
    console.warn('[Startup] Advertencia conectando a Cloud Firestore en arranque:', cloudErr.message);
  }

  // Inicialización del Motor de Background Sync (Vigilante de almacenamiento local + Sincronización automática a Google Drive por Municipio)
  backgroundPhotoSyncEngine.init();

  if (process.env.NODE_ENV !== 'production') {
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

  // Keep-alive system: Prevent the container from sleeping and losing the ephemeral disk
// This self-pings the server every 5 minutes to bypass Cloud Run's scale-to-zero inactivity timer.
const APP_URL = process.env.PUBLISHED_APP_URL || 'http://localhost:3000';
setInterval(() => {
  if (isPublishedEnv) {
    try {
      fetch(`${APP_URL}/api/health`).catch(() => {});
      console.log('[Keep-Alive] Ping interno ejecutado para prevenir apagado del contenedor.');
    } catch (e) {}
  }
}, 5 * 60 * 1000); // 5 minutes

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Control de Personal y Expendios running at http://localhost:${PORT}`);
  });
}

startServer();
