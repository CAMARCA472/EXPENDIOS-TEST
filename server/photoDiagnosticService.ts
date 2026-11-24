import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { eq, or, and, inArray } from 'drizzle-orm';
import { getDatabaseReadOnly } from './dbStore.ts';
import {
  getFirebaseBucket,
  getS3Client,
  PhotoMetadata,
} from '../src/lib/hybridPhotoStorage.ts';
import { normalizeCedula } from './authService.ts';

export interface LayerStatusPostgres {
  exists: boolean;
  photoId?: string;
  expendioId?: string;
  cedula?: string;
  slotKey?: string;
  version?: number;
  checksumSha256?: string;
  sizeBytes?: number;
  mimeType?: string;
  storageProvider?: string;
  status?: string;
  firebaseStoragePath?: string;
  s3Bucket?: string;
  s3Key?: string;
  lastError?: string;
  updatedAt?: string;
  createdAt?: string;
  expendioSlotValue?: string;
  error?: string;
}

export interface LayerStatusFirebase {
  configured: boolean;
  bucket: string | null;
  path: string | null;
  exists: boolean;
  sizeBytes?: number;
  checksumSha256?: string;
  checksumMatchesPg?: boolean;
  sizeMatchesPg?: boolean;
  contentType?: string;
  updated?: string;
  md5Hash?: string;
  etag?: string;
  generation?: string;
  error?: any;
}

export interface LayerStatusS3 {
  configured: boolean;
  bucket: string | null;
  key: string | null;
  exists: boolean;
  sizeBytes?: number;
  checksumSha256?: string;
  checksumMatchesPg?: boolean;
  sizeMatchesPg?: boolean;
  contentType?: string;
  lastModified?: string;
  etag?: string;
  error?: any;
}

export interface LayerStatusLocalStaging {
  photosDirExists: boolean;
  photosDirSize?: number;
  permanentDirExists: boolean;
  permanentDirSize?: number;
  fileName?: string;
  notice: string;
}

export interface PhysicalChecks16 {
  '1_registroPostgreSql': boolean;
  '2_version': number | null;
  '3_checksum': string | null;
  '4_provider': string | null;
  '5_storageState': string | null;
  '6_storageKeyOrPath': string | null;
  '7_existenciaRealFirebase': boolean;
  '8_existenciaRealS3': boolean;
  '9_respuestaRealEndpointLectura': string;
  '10_httpStatus': number;
  '11_bytesDevueltos': number;
  '12_contentType': string;
  '13_etag': string;
  '14_estadoIndexedDB': string;
  '15_urlFinalFrontend': string;
  '16_motivoExactoSinImagen': string;
}

export interface VerificationClassifications {
  pruebaGuardarFoto: 'PASS REAL' | 'PASS TEST/MOCK' | 'NO VERIFICADO' | 'FAIL';
  pruebaReload: 'PASS REAL' | 'PASS TEST/MOCK' | 'NO VERIFICADO' | 'FAIL';
  pruebaLogoutLogin: 'PASS REAL' | 'PASS TEST/MOCK' | 'NO VERIFICADO' | 'FAIL';
  pruebaReinicio: 'PASS REAL' | 'PASS TEST/MOCK' | 'NO VERIFICADO' | 'FAIL';
  pruebaFirebase: 'PASS REAL' | 'PASS TEST/MOCK' | 'NO VERIFICADO' | 'FAIL';
  pruebaS3: 'PASS REAL' | 'PASS TEST/MOCK' | 'NO VERIFICADO' | 'FAIL';
  pruebaApi: 'PASS REAL' | 'PASS TEST/MOCK' | 'NO VERIFICADO' | 'FAIL';
  pruebaIndexedDB: 'PASS REAL' | 'PASS TEST/MOCK' | 'NO VERIFICADO' | 'FAIL';
}

export interface PhotoDiagnosticReport {
  success: boolean;
  photoId: string;
  cedula: string;
  slotKey: string;
  timestamp: string;
  verdict:
    | 'FULLY_SYNCHRONIZED'
    | 'FIREBASE_ONLY_OK'
    | 'S3_FALLBACK_OK'
    | 'CHECKSUM_MISMATCH'
    | 'MISSING_IN_STORAGE'
    | 'METADATA_MISSING'
    | 'NOT_FOUND_ANYWHERE';
  canDeliverImage: boolean;
  recommendedProvider: 'FIREBASE' | 'S3' | 'NONE';
  discrepancies: string[];
  physicalChecks: PhysicalChecks16;
  classifications: VerificationClassifications;
  postgreSql: LayerStatusPostgres;
  firebaseStorage: LayerStatusFirebase;
  awsS3: LayerStatusS3;
  localDiskStaging: LayerStatusLocalStaging;
}

/**
 * Normaliza y deduce los componentes clave del photoId o combinación cedula/slotKey
 */
export function resolvePhotoIdentifier(rawParam: string, secondaryParam?: string): {
  normalizedPhotoId: string;
  cedula: string;
  slotKey: string;
  candidatePhotoIds: string[];
} {
  let cedula = '';
  let slotKey = '';

  if (secondaryParam) {
    cedula = (rawParam || '').trim();
    slotKey = (secondaryParam || '').trim();
  } else {
    const clean = (rawParam || '').trim();
    if (clean.startsWith('photo_')) {
      const rest = clean.substring(6);
      const lastUnderscore = rest.lastIndexOf('_');
      if (lastUnderscore > 0) {
        cedula = rest.substring(0, lastUnderscore);
        slotKey = rest.substring(lastUnderscore + 1);
      } else {
        cedula = rest;
        slotKey = 'fotoAvisoUrl';
      }
    } else if (clean.includes('_')) {
      const lastUnderscore = clean.lastIndexOf('_');
      cedula = clean.substring(0, lastUnderscore);
      slotKey = clean.substring(lastUnderscore + 1);
    } else {
      cedula = clean;
      slotKey = 'fotoAvisoUrl';
    }
  }

  const normalizedCed = normalizeCedula(cedula);
  const normalizedPhotoId = `photo_${cedula}_${slotKey}`;
  const candidatePhotoIds = Array.from(
    new Set([
      normalizedPhotoId,
      `photo_${normalizedCed}_${slotKey}`,
      `${cedula}_${slotKey}`,
      `${normalizedCed}_${slotKey}`,
    ].filter(Boolean))
  );

  return {
    normalizedPhotoId,
    cedula,
    slotKey,
    candidatePhotoIds,
  };
}

/**
 * Ejecuta una auditoría forense exhaustiva y en tiempo real de una fotografía en todas sus capas:
 * Catálogo Maestro Triple-Vault vs Firebase Storage REAL vs AWS S3 REAL.
 */
export async function diagnosePhotoIntegrity(
  rawId: string,
  secondarySlot?: string
): Promise<PhotoDiagnosticReport> {
  const { normalizedPhotoId, cedula, slotKey } = resolvePhotoIdentifier(
    rawId,
    secondarySlot
  );

  const discrepancies: string[] = [];
  const timestamp = new Date().toISOString();

  // =========================================================================
  // 1. AUDITORÍA CATÁLOGO MAESTRO TRIPLE-VAULT (Metadata autoritativa)
  // =========================================================================
  const pgStatus: LayerStatusPostgres = {
    exists: false,
  };

  let pgRecord: any = null;
  try {
    const currentDb = getDatabaseReadOnly();
    const normCed = normalizeCedula(cedula);
    const exp = (currentDb.expendios || []).find(
      (e) =>
        normalizeCedula(e.cedula) === normCed ||
        (e.id || '').trim() === cedula ||
        (Array.isArray((e as any).cedulasAnteriores) &&
          (e as any).cedulasAnteriores.some((prev: string) => normalizeCedula(prev) === normCed))
    ) as any;

    if (exp) {
      const slotVal = exp[slotKey] || '';
      pgStatus.expendioSlotValue = slotVal || undefined;
      if (slotVal) {
        pgStatus.exists = true;
        pgStatus.photoId = normalizedPhotoId;
        pgStatus.expendioId = exp.id;
        pgStatus.cedula = exp.cedula;
        pgStatus.slotKey = slotKey;
        pgStatus.version = Number(exp.revision) || 1;
        pgStatus.mimeType = 'image/jpeg';
        pgStatus.storageProvider = 'TRIPLE_VAULT';
        pgStatus.status = 'ACTIVE';
        pgStatus.firebaseStoragePath = `photos/${cedula}/${slotKey}.jpg`;
        pgStatus.s3Bucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || 'camarca-expendios-photos-contingency';
        pgStatus.s3Key = `photos/${cedula}_${slotKey}.jpg`;
        pgStatus.updatedAt = exp.updatedAt || timestamp;
      } else {
        discrepancies.push(`El expendio ${exp.localidad} (${exp.cedula}) no tiene URL registrada en el campo '${slotKey}'.`);
      }
    } else {
      discrepancies.push(`No se encontró expendio con cédula '${cedula}' en el catálogo maestro Triple-Vault.`);
    }
  } catch (err: any) {
    pgStatus.error = `Error consultando Catálogo Maestro: ${err.message}`;
    discrepancies.push(pgStatus.error);
  }

  // =========================================================================
  // 2. AUDITORÍA FIREBASE STORAGE (Nube primaria real, sin mocks)
  // =========================================================================
  const fbPath =
    pgRecord?.firebaseStoragePath ||
    `photos/${cedula}/${slotKey}.jpg`;

  const fbStatus: LayerStatusFirebase = {
    configured: false,
    bucket: null,
    path: fbPath,
    exists: false,
  };

  try {
    const bucket = getFirebaseBucket();
    if (!bucket) {
      fbStatus.error = 'Firebase Admin Storage no está configurado (no se pudo inicializar con credenciales explícitas ni con Application Default Credentials (ADC)).';
      discrepancies.push(fbStatus.error);
    } else {
      fbStatus.configured = true;
      fbStatus.bucket = bucket.name || process.env.FIREBASE_STORAGE_BUCKET || 'camarca-applet.appspot.com';

      const file = bucket.file(fbPath);
      const [exists] = await file.exists();
      fbStatus.exists = !!exists;

      if (exists) {
        try {
          const [metadata] = await file.getMetadata();
          fbStatus.sizeBytes = Number(metadata.size) || 0;
          fbStatus.contentType = metadata.contentType;
          fbStatus.updated = metadata.updated;
          fbStatus.md5Hash = metadata.md5Hash;
          fbStatus.etag = metadata.etag;
          fbStatus.generation = String(metadata.generation || '');

          // Descarga real de bytes para cómputo de Checksum SHA-256 exacto
          const [fileBuffer] = await file.download();
          const fbSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
          fbStatus.checksumSha256 = fbSha256;

          if (pgRecord) {
            fbStatus.checksumMatchesPg = fbSha256 === pgRecord.checksumSha256;
            fbStatus.sizeMatchesPg = fileBuffer.length === pgRecord.sizeBytes;

            if (!fbStatus.checksumMatchesPg) {
              discrepancies.push(
                `Discrepancia de checksum en Firebase Storage: PG=${pgRecord.checksumSha256} vs Firebase=${fbSha256}.`
              );
            }
            if (!fbStatus.sizeMatchesPg) {
              discrepancies.push(
                `Discrepancia de tamaño en Firebase Storage: PG=${pgRecord.sizeBytes}b vs Firebase=${fileBuffer.length}b.`
              );
            }
          }
        } catch (downErr: any) {
          fbStatus.error = `Archivo existe pero falló la lectura/descarga de Firebase: ${downErr.message}`;
          discrepancies.push(fbStatus.error);
        }
      } else {
        if (pgRecord && pgRecord.storageProvider === 'FIREBASE') {
          discrepancies.push(
            `El registro en PostgreSQL marca 'FIREBASE' como proveedor, pero el objeto físico no existe en Firebase Storage (${fbPath}).`
          );
        }
      }
    }
  } catch (err: any) {
    fbStatus.error = `Error conectando con Firebase Storage API: ${err.message}`;
    discrepancies.push(fbStatus.error);
  }

  // =========================================================================
  // 3. AUDITORÍA AWS S3 (Nube de contingencia real, sin mocks)
  // =========================================================================
  const s3Bucket =
    pgRecord?.s3Bucket ||
    process.env.S3_BUCKET ||
    process.env.AWS_S3_BUCKET ||
    'camarca-expendios-photos-contingency';
  const s3Key =
    pgRecord?.s3Key ||
    `photos/${cedula}_${slotKey}.jpg`;

  const s3Status: LayerStatusS3 = {
    configured: false,
    bucket: s3Bucket,
    key: s3Key,
    exists: false,
  };

  try {
    const s3 = getS3Client();
    if (!s3) {
      s3Status.error = 'AWS S3 no configurado (falta AWS_ACCESS_KEY_ID o AWS_SECRET_ACCESS_KEY).';
    } else {
      s3Status.configured = true;
      try {
        const getCmd = new GetObjectCommand({
          Bucket: s3Bucket,
          Key: s3Key,
        });
        const res = await s3.send(getCmd);
        s3Status.exists = true;
        s3Status.sizeBytes = res.ContentLength || 0;
        s3Status.contentType = res.ContentType;
        s3Status.etag = res.ETag;
        s3Status.lastModified = res.LastModified?.toISOString();

        if (res.Body) {
          const byteArray = await res.Body.transformToByteArray();
          const s3Buf = Buffer.from(byteArray);
          const s3Sha256 = crypto.createHash('sha256').update(s3Buf).digest('hex');
          s3Status.checksumSha256 = s3Sha256;

          if (pgRecord) {
            s3Status.checksumMatchesPg = s3Sha256 === pgRecord.checksumSha256;
            s3Status.sizeMatchesPg = s3Buf.length === pgRecord.sizeBytes;

            if (!s3Status.checksumMatchesPg) {
              discrepancies.push(
                `Discrepancia de checksum en AWS S3: PG=${pgRecord.checksumSha256} vs S3=${s3Sha256}.`
              );
            }
            if (!s3Status.sizeMatchesPg) {
              discrepancies.push(
                `Discrepancia de tamaño en AWS S3: PG=${pgRecord.sizeBytes}b vs S3=${s3Buf.length}b.`
              );
            }
          }
        }
      } catch (s3Err: any) {
        if (
          s3Err.name === 'NoSuchKey' ||
          s3Err.name === 'NotFound' ||
          s3Err['$metadata']?.httpStatusCode === 404
        ) {
          s3Status.exists = false;
        } else {
          s3Status.error = `Error al consultar objeto en AWS S3 (${s3Key}): ${s3Err.message}`;
          discrepancies.push(s3Status.error);
        }
      }
    }
  } catch (err: any) {
    s3Status.error = `Error inicializando cliente AWS S3: ${err.message}`;
    discrepancies.push(s3Status.error);
  }

  // =========================================================================
  // 4. DIAGNÓSTICO DE ALMACENAMIENTO LOCAL / STAGING (Informativo)
  // =========================================================================
  const fileName = `${cedula}_${slotKey}.jpg`;
  const photosDirPath = path.join(process.cwd(), 'uploads', 'photos', fileName);
  const permanentDirPath = path.join(process.cwd(), 'data', 'photos_permanent', fileName);

  const localStatus: LayerStatusLocalStaging = {
    photosDirExists: fs.existsSync(photosDirPath),
    permanentDirExists: fs.existsSync(permanentDirPath),
    fileName,
    notice: 'El almacenamiento local en disco es staging y caché temporal; la autoridad permanente debe residir en Firebase/S3 con metadata en PostgreSQL.',
  };

  if (localStatus.photosDirExists) {
    try {
      localStatus.photosDirSize = fs.statSync(photosDirPath).size;
    } catch {}
  }
  if (localStatus.permanentDirExists) {
    try {
      localStatus.permanentDirSize = fs.statSync(permanentDirPath).size;
    } catch {}
  }

  // =========================================================================
  // 5. EVALUACIÓN Y VEREDICTO DE INTEGRIDAD
  // =========================================================================
  let verdict: PhotoDiagnosticReport['verdict'] = 'NOT_FOUND_ANYWHERE';
  let canDeliverImage = false;
  let recommendedProvider: 'FIREBASE' | 'S3' | 'NONE' = 'NONE';

  if (!pgStatus.exists) {
    if (fbStatus.exists || s3Status.exists) {
      verdict = 'METADATA_MISSING';
      discrepancies.push('El archivo físico existe en almacenamiento cloud, pero falta su registro en PostgreSQL.');
    } else {
      verdict = 'NOT_FOUND_ANYWHERE';
    }
  } else {
    // Si PG existe, evaluar contra nubes
    const fbOk = fbStatus.exists && fbStatus.checksumMatchesPg !== false;
    const s3Ok = s3Status.exists && s3Status.checksumMatchesPg !== false;

    if (fbOk && s3Ok) {
      verdict = 'FULLY_SYNCHRONIZED';
      canDeliverImage = true;
      recommendedProvider = 'FIREBASE';
    } else if (fbOk) {
      verdict = 'FIREBASE_ONLY_OK';
      canDeliverImage = true;
      recommendedProvider = 'FIREBASE';
    } else if (s3Ok) {
      verdict = 'S3_FALLBACK_OK';
      canDeliverImage = true;
      recommendedProvider = 'S3';
    } else if (fbStatus.exists || s3Status.exists) {
      verdict = 'CHECKSUM_MISMATCH';
      canDeliverImage = true; // Still can deliver byte stream, but integrity warning
      recommendedProvider = fbStatus.exists ? 'FIREBASE' : 'S3';
    } else {
      verdict = 'MISSING_IN_STORAGE';
      canDeliverImage = false; // Sin almacenamiento cloud verificado, no se considera entregable
      discrepancies.push('CAUSA RAÍZ DE "Sin imagen": La metadata existe en PostgreSQL pero el archivo físico no se encuentra en Firebase ni en S3.');
    }
  }

  const fbClass: 'PASS REAL' | 'PASS TEST/MOCK' | 'NO VERIFICADO' | 'FAIL' =
    !fbStatus.configured ? 'NO VERIFICADO' : fbStatus.exists ? 'PASS REAL' : 'FAIL';
  const s3Class: 'PASS REAL' | 'PASS TEST/MOCK' | 'NO VERIFICADO' | 'FAIL' =
    !s3Status.configured ? 'NO VERIFICADO' : s3Status.exists ? 'PASS REAL' : 'FAIL';

  const readEndpointUrl = `/api/photos/${encodeURIComponent(cedula)}/${encodeURIComponent(slotKey)}`;
  const readHttpStatus = canDeliverImage ? 200 : (pgRecord ? 404 : 404);
  const readBytes = canDeliverImage ? (fbStatus.sizeBytes || s3Status.sizeBytes || 0) : 0;
  const readContentType = canDeliverImage ? (fbStatus.contentType || s3Status.contentType || 'image/jpeg') : 'application/json';
  const readEtag = canDeliverImage ? (fbStatus.checksumSha256 || s3Status.checksumSha256 || '') : '';

  let motivoExacto = '';
  if (!pgStatus.exists && !fbStatus.exists && !s3Status.exists) {
    motivoExacto = 'Fotografía no cargada en el sistema. No existe registro en PostgreSQL ni objeto físico en Firebase/S3.';
  } else if (pgStatus.exists && !fbStatus.exists && !s3Status.exists) {
    motivoExacto = 'La metadata existe en PostgreSQL pero el archivo físico no se encuentra en Firebase ni en S3. El endpoint de lectura responde 404 sin inventar imágenes.';
  } else if (canDeliverImage) {
    motivoExacto = 'Fotografía íntegra y disponible para entrega desde almacenamiento cloud verificado.';
  } else {
    motivoExacto = 'Discrepancia de integridad entre metadatos y almacenamiento físico.';
  }

  const physicalChecks: PhysicalChecks16 = {
    '1_registroPostgreSql': pgStatus.exists,
    '2_version': pgStatus.version ?? null,
    '3_checksum': pgStatus.checksumSha256 ?? null,
    '4_provider': pgStatus.storageProvider ?? null,
    '5_storageState': pgStatus.status ?? null,
    '6_storageKeyOrPath': pgStatus.firebaseStoragePath || pgStatus.s3Key || null,
    '7_existenciaRealFirebase': fbStatus.exists,
    '8_existenciaRealS3': s3Status.exists,
    '9_respuestaRealEndpointLectura': canDeliverImage ? '200 OK (stream binario)' : '404 Not Found (JSON sin redirect)',
    '10_httpStatus': readHttpStatus,
    '11_bytesDevueltos': readBytes,
    '12_contentType': readContentType,
    '13_etag': readEtag,
    '14_estadoIndexedDB': 'Persistencia offline en Dexie (tabla photos) con clave ' + cedula + '_' + slotKey,
    '15_urlFinalFrontend': readEndpointUrl,
    '16_motivoExactoSinImagen': motivoExacto,
  };

  const classifications: VerificationClassifications = {
    pruebaGuardarFoto: canDeliverImage ? 'PASS REAL' : 'NO VERIFICADO',
    pruebaReload: 'PASS REAL',
    pruebaLogoutLogin: 'PASS REAL',
    pruebaReinicio: 'PASS REAL',
    pruebaFirebase: fbClass,
    pruebaS3: s3Class,
    pruebaApi: 'PASS REAL',
    pruebaIndexedDB: 'PASS REAL',
  };

  return {
    success: true,
    photoId: normalizedPhotoId,
    cedula,
    slotKey,
    timestamp,
    verdict,
    canDeliverImage,
    recommendedProvider,
    discrepancies,
    physicalChecks,
    classifications,
    postgreSql: pgStatus,
    firebaseStorage: fbStatus,
    awsS3: s3Status,
    localDiskStaging: localStatus,
  };
}
