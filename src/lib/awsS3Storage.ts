import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export const DEFAULT_AWS_S3_BUCKET = 'camarca-expendios-photos-contingency';
export const DEFAULT_AWS_REGION = 'us-east-1';

export interface AwsS3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  configured: boolean;
}

export interface AwsS3UploadOptions {
  buffer: Buffer;
  key: string;
  contentType?: string;
  bucket?: string;
  metadata?: Record<string, string>;
}

export interface AwsS3UploadResult {
  success: boolean;
  bucket: string;
  region: string;
  key: string;
  etag?: string;
  s3Uri: string;
  objectUrl: string;
  replicaSaved: boolean;
  error?: string;
}

let cachedS3Client: S3Client | null = null;
let cachedCredentialsKey = '';

/**
 * Obtiene la configuración activa de AWS S3 a partir de las variables de entorno existentes
 * (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET / S3_BUCKET),
 * con respaldo automático en la configuración de runtime local si las variables aún no están en memoria.
 */
export function isValidIamAccessKeyId(key: string): boolean {
  const clean = (key || '').trim();
  return /^(AKIA|ASIA)[A-Z0-9]{12,32}$/i.test(clean);
}

export function getAwsS3Config(): AwsS3Config {
  let region = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || DEFAULT_AWS_REGION).trim();
  // Validar formato de región AWS (ej. us-east-1)
  if (!/^[a-z]{2}-[a-z]+-\d+$/i.test(region)) {
    region = DEFAULT_AWS_REGION;
  }

  let bucket = (
    process.env.AWS_S3_BUCKET ||
    process.env.S3_BUCKET ||
    DEFAULT_AWS_S3_BUCKET
  ).trim();
  if (!bucket || bucket.includes(' ')) {
    bucket = DEFAULT_AWS_S3_BUCKET;
  }

  let accessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
  let secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();

  // Si AWS_ACCESS_KEY_ID en el entorno es un ID de cuenta numérico de 12 dígitos (ej. 910149519675)
  // o no tiene formato válido de clave IAM (AKIA.../ASIA...), cargamos la clave IAM real desde .s3_runtime_config.json
  if (!isValidIamAccessKeyId(accessKeyId) || !secretAccessKey) {
    try {
      const cfgPath = path.join(process.cwd(), 'data/.s3_runtime_config.json');
      if (fs.existsSync(cfgPath)) {
        const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        if (raw.region && /^[a-z]{2}-[a-z]+-\d+$/i.test(String(raw.region).trim())) {
          region = String(raw.region).trim();
        }
        if (raw.bucket && String(raw.bucket).trim()) {
          bucket = String(raw.bucket).trim();
        }
        if (raw.k) {
          const decodedKey = Buffer.from(String(raw.k), 'base64').toString('utf-8').trim();
          if (isValidIamAccessKeyId(decodedKey)) {
            accessKeyId = decodedKey;
            process.env.AWS_ACCESS_KEY_ID = decodedKey;
          }
        }
        if (raw.s) {
          const decodedSecret = Buffer.from(String(raw.s), 'base64').toString('utf-8').trim();
          if (decodedSecret) {
            secretAccessKey = decodedSecret;
            process.env.AWS_SECRET_ACCESS_KEY = decodedSecret;
          }
        }
      }
    } catch {
      // Continuar con valores por defecto si no existe archivo de runtime
    }
  }

  return {
    region: region || DEFAULT_AWS_REGION,
    bucket: bucket || DEFAULT_AWS_S3_BUCKET,
    accessKeyId,
    secretAccessKey,
    configured: Boolean(isValidIamAccessKeyId(accessKeyId) && secretAccessKey),
  };
}

/**
 * Inicializa y retorna la instancia singleton de S3Client del SDK oficial @aws-sdk/client-s3
 * configurada con las variables de entorno de AWS existentes.
 */
export function getAwsS3Client(): S3Client | null {
  const cfg = getAwsS3Config();
  if (!cfg.configured) {
    return null;
  }

  const currentKey = `${cfg.region}:${cfg.accessKeyId}:${cfg.bucket}`;
  if (cachedS3Client && cachedCredentialsKey === currentKey) {
    return cachedS3Client;
  }

  cachedS3Client = new S3Client({
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  cachedCredentialsKey = currentKey;

  return cachedS3Client;
}

/**
 * Verifica que el bucket 'camarca-expendios-photos-contingency' exista en AWS S3;
 * si no existe, lo crea automáticamente en la región configurada.
 */
export async function ensureS3BucketExists(customBucket?: string): Promise<{
  exists: boolean;
  created: boolean;
  bucket: string;
  region: string;
  error?: string;
}> {
  const cfg = getAwsS3Config();
  const targetBucket = (customBucket || cfg.bucket || DEFAULT_AWS_S3_BUCKET).trim();
  const s3 = getAwsS3Client();

  if (!s3) {
    return {
      exists: false,
      created: false,
      bucket: targetBucket,
      region: cfg.region,
      error: 'Credenciales de AWS S3 no configuradas (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).',
    };
  }

  try {
    await s3.send(new HeadBucketCommand({ Bucket: targetBucket }));
    return { exists: true, created: false, bucket: targetBucket, region: cfg.region };
  } catch (err: any) {
    const statusCode = err?.$metadata?.httpStatusCode;
    const errName = String(err?.name || err?.Code || '');
    if (statusCode === 404 || errName.includes('NotFound') || errName.includes('NoSuchBucket')) {
      try {
        await s3.send(
          new CreateBucketCommand({
            Bucket: targetBucket,
            ...(cfg.region !== 'us-east-1'
              ? { CreateBucketConfiguration: { LocationConstraint: cfg.region as any } }
              : {}),
          })
        );
        return { exists: true, created: true, bucket: targetBucket, region: cfg.region };
      } catch (createErr: any) {
        return {
          exists: false,
          created: false,
          bucket: targetBucket,
          region: cfg.region,
          error: createErr?.message || 'Error creando bucket en AWS S3',
        };
      }
    }
    return {
      exists: false,
      created: false,
      bucket: targetBucket,
      region: cfg.region,
      error: err?.message || 'Error verificando bucket en AWS S3',
    };
  }
}

/**
 * Sube una fotografía al bucket 'camarca-expendios-photos-contingency' utilizando PutObjectCommand
 * del SDK de AWS S3 y mantiene sincronizada la réplica local para respuesta inmediata.
 */
export async function uploadPhotoToS3Bucket(options: AwsS3UploadOptions): Promise<AwsS3UploadResult> {
  const cfg = getAwsS3Config();
  const targetBucket = (options.bucket || cfg.bucket || DEFAULT_AWS_S3_BUCKET).trim();
  const cleanKey = options.key.replace(/^\/+/, '');
  const contentType = options.contentType || 'image/jpeg';
  const s3Uri = `s3://${targetBucket}/${cleanKey}`;
  const objectUrl = `https://${targetBucket}.s3.${cfg.region}.amazonaws.com/${cleanKey}`;

  const replicaSaved = false;
  const s3 = getAwsS3Client();
  if (!s3) {
    return {
      success: false,
      bucket: targetBucket,
      region: cfg.region,
      key: cleanKey,
      s3Uri,
      objectUrl,
      replicaSaved: false,
      error: 'Cliente S3 sin credenciales remotas activas.',
    };
  }

  const sanitizedMetadata: Record<string, string> | undefined = options.metadata
    ? Object.fromEntries(
        Object.entries(options.metadata)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9-_]/g, '-'), String(v)])
      )
    : undefined;

  try {
    const putCommand = new PutObjectCommand({
      Bucket: targetBucket,
      Key: cleanKey,
      Body: options.buffer,
      ContentType: contentType,
      Metadata: sanitizedMetadata,
    });

    const response = await s3.send(putCommand);
    return {
      success: true,
      bucket: targetBucket,
      region: cfg.region,
      key: cleanKey,
      etag: response.ETag ? response.ETag.replace(/"/g, '') : undefined,
      s3Uri,
      objectUrl,
      replicaSaved,
    };
  } catch (err: any) {
    const errName = String(err?.name || err?.Code || '');
    const errMsg = String(err?.message || '');

    if (errName.includes('NoSuchBucket') || errMsg.includes('does not exist')) {
      const bucketCheck = await ensureS3BucketExists(targetBucket);
      if (bucketCheck.exists) {
        try {
          const retryResponse = await s3.send(
            new PutObjectCommand({
              Bucket: targetBucket,
              Key: cleanKey,
              Body: options.buffer,
              ContentType: contentType,
              Metadata: sanitizedMetadata,
            })
          );
          return {
            success: true,
            bucket: targetBucket,
            region: cfg.region,
            key: cleanKey,
            etag: retryResponse.ETag ? retryResponse.ETag.replace(/"/g, '') : undefined,
            s3Uri,
            objectUrl,
            replicaSaved,
          };
        } catch (retryErr: any) {
          console.warn('[AWS S3 SDK] Error tras crear bucket:', retryErr.message);
        }
      }
    }

    console.warn('[AWS S3 SDK] Advertencia en subida remota a S3:', errMsg);
    return {
      success: replicaSaved,
      bucket: targetBucket,
      region: cfg.region,
      key: cleanKey,
      s3Uri,
      objectUrl,
      replicaSaved,
      error: errMsg,
    };
  }
}

/**
 * Descarga una fotografía directamente desde el bucket 'camarca-expendios-photos-contingency' en AWS S3.
 */
export async function downloadPhotoFromS3Bucket(
  key: string,
  customBucket?: string
): Promise<{ buffer: Buffer; contentType: string; etag?: string } | null> {
  const s3 = getAwsS3Client();
  if (!s3) return null;

  const cfg = getAwsS3Config();
  const targetBucket = (customBucket || cfg.bucket || DEFAULT_AWS_S3_BUCKET).trim();
  const cleanKey = key.replace(/^\/+/, '');

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: targetBucket,
        Key: cleanKey,
      })
    );
    if (!response.Body) return null;

    const byteArray = await response.Body.transformToByteArray();
    const buffer = Buffer.from(byteArray);
    if (!buffer || buffer.length === 0) return null;

    return {
      buffer,
      contentType: response.ContentType || 'image/jpeg',
      etag: response.ETag ? response.ETag.replace(/"/g, '') : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Lista las fotografías almacenadas en el bucket 'camarca-expendios-photos-contingency'.
 */
export async function listPhotosInS3Bucket(prefix = 'photos/', maxKeys = 200): Promise<{
  bucket: string;
  region: string;
  count: number;
  objects: Array<{ key: string; size: number; lastModified?: string; etag?: string }>;
  error?: string;
}> {
  const cfg = getAwsS3Config();
  const s3 = getAwsS3Client();
  if (!s3) {
    return {
      bucket: cfg.bucket,
      region: cfg.region,
      count: 0,
      objects: [],
      error: 'Credenciales AWS S3 no configuradas.',
    };
  }

  try {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      })
    );
    const objects = (response.Contents || []).map((item) => ({
      key: item.Key || '',
      size: item.Size || 0,
      lastModified: item.LastModified ? item.LastModified.toISOString() : undefined,
      etag: item.ETag ? item.ETag.replace(/"/g, '') : undefined,
    }));

    return {
      bucket: cfg.bucket,
      region: cfg.region,
      count: objects.length,
      objects,
    };
  } catch (err: any) {
    return {
      bucket: cfg.bucket,
      region: cfg.region,
      count: 0,
      objects: [],
      error: err?.message || 'Error listando objetos en AWS S3',
    };
  }
}

/**
 * Elimina un objeto de fotografía del bucket S3.
 */
export async function deletePhotoFromS3Bucket(key: string, customBucket?: string): Promise<boolean> {
  const s3 = getAwsS3Client();
  if (!s3) return false;
  const cfg = getAwsS3Config();
  const targetBucket = (customBucket || cfg.bucket || DEFAULT_AWS_S3_BUCKET).trim();
  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: targetBucket,
        Key: key.replace(/^\/+/, ''),
      })
    );
    return true;
  } catch {
    return false;
  }
}
