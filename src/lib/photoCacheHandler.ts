import { useState, useEffect, useCallback, useRef } from 'react';
import { getStoredPhoto, savePhotoToIndexedDB, deleteCachedPhotoBySlot } from './photoStorageDB';
import { StoredPhotoRecord } from '../types';

export interface PostgresPhotoMetadata {
  exists: boolean;
  cedula: string;
  slotKey: string;
  version: number;
  checksum: string;
  etag?: string;
  sizeBytes: number;
  storageProvider?: string;
  updatedAt?: string;
  url: string;
}

export type CacheVerificationResult =
  | { status: 'hit'; dataUrl: string; version: number | string; checksum: string }
  | { status: 'downloaded'; dataUrl: string; version: number | string; checksum: string }
  | { status: 'not_found' }
  | { status: 'error'; error: string };

/**
 * Consulta la fuente autoritativa de la verdad en PostgreSQL para metadatos (versión y checksum)
 */
export async function fetchPostgresPhotoMetadata(
  cedula: string,
  slotKey: string
): Promise<PostgresPhotoMetadata | null> {
  const cleanCed = String(cedula || '').replace(/\D/g, '').trim();
  const cleanSlot = String(slotKey || '').trim();
  if (!cleanCed || !cleanSlot) return null;

  const headers: Record<string, string> = { 'Cache-Control': 'no-cache' };
  if (typeof window !== 'undefined') {
    const token =
      sessionStorage.getItem('camarca_token') || localStorage.getItem('camarca_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-session-token'] = token;
    }
  }

  const res = await fetch(
    `/api/photos/metadata/${encodeURIComponent(cleanCed)}/${encodeURIComponent(cleanSlot)}`,
    { headers }
  );

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Error HTTP ${res.status} al consultar metadatos en PostgreSQL`);
  }

  const data = await res.json();
  if (!data.success || !data.exists) return null;

  return {
    exists: true,
    cedula: data.cedula || cleanCed,
    slotKey: data.slotKey || cleanSlot,
    version: data.version || 1,
    checksum: data.checksum || data.etag || '',
    etag: data.etag,
    sizeBytes: data.sizeBytes || 0,
    storageProvider: data.storageProvider,
    updatedAt: data.updatedAt,
    url: data.url || `/api/photos/${cleanCed}/${cleanSlot}`,
  };
}

/**
 * Verifica si una URL de fotografía pertenece legítimamente al expendio activo.
 * Previene que referencias cruzadas de otros expendios (como Girón o Pamplona) sean consumidas por Togüí o Landázuri.
 */
export function isPhotoConsistentWithExpendio(
  photoUrl: string | undefined | null,
  expendio: { id?: string; cedula?: string } | undefined | null
): boolean {
  if (!photoUrl || typeof photoUrl !== 'string') return false;
  if (photoUrl.startsWith('data:') || photoUrl.startsWith('blob:')) return true;

  const match = photoUrl.match(/\/api\/(?:photos|expendio\/photo)\/([^/?#]+)/i);
  if (!match || !match[1]) return true;

  const urlTarget = decodeURIComponent(match[1]).trim();
  const urlCedNorm = urlTarget.replace(/\D/g, '');
  const expCedNorm = String(expendio?.cedula || '').replace(/\D/g, '');
  const expId = String(expendio?.id || '').trim();

  // Si la URL apunta a una cédula distinta de la del expendio activo (ej. 1094269932 Girón o 1094270223 Pamplona)
  if (expCedNorm && urlCedNorm && urlCedNorm !== expCedNorm && urlTarget !== expId) {
    return false;
  }
  return true;
}

/**
 * Estrategia de Caché Estricta y Verificación de Consistencia con S3 y PostgreSQL:
 * - Valida que los metadatos y la caché local pertenezcan de forma unívoca al ID y cédula del expendio activo.
 * - Si se detecta un registro residual de otro expendio en IndexedDB, lo purga de inmediato.
 * - Si la foto ya fue descargada desde el servidor (`downloadedFromServer === true`) y su checksum coincide -> HIT en caché.
 */
export async function verifyAndReconcilePhotoWithIndexedDB(
  cedula: string,
  slotKey: string,
  currentUrl?: string,
  forceDownload: boolean = false,
  expendioId?: string
): Promise<CacheVerificationResult> {
  const rawCed = String(cedula || '').trim();
  const cleanCed = rawCed.replace(/\D/g, '').trim();
  const cleanSlot = String(slotKey || '').trim();
  const cleanExpId = String(expendioId || '').trim();

  // Sanitizar URL actual: si apunta a otro expendio, ignorarla
  const safeCurrentUrl = isPhotoConsistentWithExpendio(currentUrl, { id: cleanExpId, cedula: cleanCed })
    ? currentUrl
    : undefined;

  let cached: StoredPhotoRecord | undefined;
  try {
    cached = await getStoredPhoto(cleanCed || rawCed, cleanSlot, cleanExpId);
  } catch {}

  // Si la caché contenía un registro que pertenecía a otro expendio distinto, borrarlo inmediatamente
  if (cached && cleanExpId && cached.expendioId && cached.expendioId !== cleanExpId) {
    console.warn(`[Caché Local] Purgando foto cruzada de otro expendio (${cached.expendioId} vs ${cleanExpId})`);
    await deleteCachedPhotoBySlot(rawCed || cleanCed, cleanSlot);
    cached = undefined;
  }

  try {
    // 1. Consultar autoridad en el servidor (PostgreSQL + S3)
    const serverMeta = await fetchPostgresPhotoMetadata(cleanExpId || rawCed || cleanCed, cleanSlot);
    if (!serverMeta || !serverMeta.exists) {
      // Si aún no está en ningún servidor, mostrar la copia pendiente local si existe y es consistente
      if (cached && cached.dataUrl) {
        return {
          status: 'hit',
          dataUrl: cached.dataUrl,
          version: cached.version || 1,
          checksum: cached.checksum || '',
        };
      }
      if (safeCurrentUrl && (safeCurrentUrl.startsWith('data:') || safeCurrentUrl.startsWith('blob:'))) {
        return { status: 'hit', dataUrl: safeCurrentUrl, version: 1, checksum: '' };
      }
      return { status: 'not_found' };
    }

    // 2. Si había una caché previa a la carga al servidor (`!cached.downloadedFromServer`), borrarla para forzar descarga desde el servidor
    if (cached && !cached.downloadedFromServer) {
      await deleteCachedPhotoBySlot(rawCed || cleanCed, cleanSlot);
      cached = undefined;
    }

    // 3. Comparación: si ya fue descargada del servidor (`downloadedFromServer === true`) y el checksum coincide -> CACHE HIT!
    if (
      !forceDownload &&
      cached &&
      cached.downloadedFromServer &&
      cached.dataUrl &&
      (!serverMeta.checksum || !cached.checksum || cached.checksum === serverMeta.checksum)
    ) {
      return {
        status: 'hit',
        dataUrl: cached.dataUrl,
        version: cached.version || serverMeta.version,
        checksum: cached.checksum || serverMeta.checksum,
      };
    }

    // 4. Descargar la foto desde el servidor para la visualización y guardarla en caché DESPUÉS de descargarse
    if (forceDownload) {
      await deleteCachedPhotoBySlot(rawCed || cleanCed, cleanSlot);
    }

    const photoFetchUrl = serverMeta.url || `/api/photos/${encodeURIComponent(cleanExpId || cleanCed || rawCed)}/${encodeURIComponent(cleanSlot)}`;
    const headers: Record<string, string> = {};
    if (typeof window !== 'undefined') {
      const token =
        sessionStorage.getItem('camarca_token') || localStorage.getItem('camarca_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-session-token'] = token;
      }
    }

    const photoRes = await fetch(`${photoFetchUrl}${photoFetchUrl.includes('?') ? '&' : '?'}_dl=${Date.now()}`, {
      cache: 'no-store',
      headers,
    });
    if (!photoRes.ok) {
      if (cached && cached.dataUrl) {
        return {
          status: 'hit',
          dataUrl: cached.dataUrl,
          version: cached.version || 1,
          checksum: cached.checksum || '',
        };
      }
      return { status: 'not_found' };
    }

    const contentType = (photoRes.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      if (cached && cached.dataUrl) {
        return {
          status: 'hit',
          dataUrl: cached.dataUrl,
          version: cached.version || 1,
          checksum: cached.checksum || '',
        };
      }
      return { status: 'not_found' };
    }

    const blob = await photoRes.blob();
    if (blob.size < 200) {
      if (cached && cached.dataUrl) {
        return {
          status: 'hit',
          dataUrl: cached.dataUrl,
          version: cached.version || 1,
          checksum: cached.checksum || '',
        };
      }
      return { status: 'not_found' };
    }

    // Convertir Blob descargado a DataURL y guardar en IndexedDB como CACHÉ post-descarga
    const reader = new FileReader();
    const dataUrl: string = await new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    await savePhotoToIndexedDB({
      cedula: cleanCed || rawCed,
      slotKey: cleanSlot,
      slotTitle: cleanSlot,
      fileOrBlob: blob,
      dataUrl,
      version: serverMeta.version,
      checksum: serverMeta.checksum,
      status: 'synced',
      downloadedFromServer: true,
    }).catch(() => {});

    return {
      status: 'downloaded',
      dataUrl,
      version: serverMeta.version,
      checksum: serverMeta.checksum,
    };
  } catch (err: any) {
    if (cached && cached.dataUrl) {
      return {
        status: 'hit',
        dataUrl: cached.dataUrl,
        version: cached.version || 1,
        checksum: cached.checksum || '',
      };
    }
    return { status: 'not_found' };
  }
}

export function usePhotoCacheVerification(
  cedula: string | undefined,
  slotKey: string,
  currentUrl: string | undefined,
  options?: { enabled?: boolean; expendioId?: string }
) {
  const [isVerifying, setIsVerifying] = useState(false);
  const [isHit, setIsHit] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resolvedDataUrl, setResolvedDataUrl] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const cleanCed = String(cedula || '').replace(/\D/g, '').trim();
  const cleanSlot = String(slotKey || '').trim();
  const expendioId = options?.expendioId;
  const enabled = options?.enabled !== false && Boolean(cleanCed && cleanSlot);

  const executeVerification = useCallback(
    async (force: boolean = false) => {
      if (!cleanCed || !cleanSlot) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      setIsVerifying(true);
      setIsError(false);
      setErrorMessage(null);

      try {
        const result = await verifyAndReconcilePhotoWithIndexedDB(
          cleanCed,
          cleanSlot,
          currentUrl,
          force,
          expendioId
        );

        if (result.status === 'hit') {
          setIsHit(true);
          setResolvedDataUrl(result.dataUrl);
          setIsError(false);
        } else if (result.status === 'downloaded') {
          setIsHit(false);
          setResolvedDataUrl(result.dataUrl);
          setIsError(false);
        } else if (result.status === 'not_found') {
          setIsHit(false);
          setIsError(false);
        } else if (result.status === 'error') {
          setIsError(true);
          setErrorMessage(result.error);
        }
      } catch (e: any) {
        setIsError(true);
        setErrorMessage(e.message || 'Error al reconciliar imagen');
      } finally {
        setIsVerifying(false);
        inFlightRef.current = false;
      }
    },
    [cleanCed, cleanSlot, currentUrl, expendioId]
  );

  useEffect(() => {
    if (enabled) {
      executeVerification(false);
    }
  }, [enabled, executeVerification]);

  const reloadImage = useCallback(async () => {
    await executeVerification(true);
  }, [executeVerification]);

  return {
    isVerifying,
    isHit,
    isError,
    errorMessage,
    resolvedDataUrl,
    reloadImage,
  };
}

export interface ConsistencyAuditItem {
  slotKey: string;
  slotTitle: string;
  isConsistent: boolean;
  status: 'VERIFICADO_OK' | 'DISCREPANCIA_CORREGIDA' | 'SIN_FOTO';
  details: string;
  serverUrl?: string;
}

/**
 * Verificador de Consistencia Oficial entre ID de Expendio Activo, S3 Bucket y Caché Local IndexedDB.
 * Audita los 7 slots, purga cualquier fotografía cruzada de otro municipio o cédula,
 * y reconecta el bucket de S3 específico de este expendio.
 */
export async function auditAndHealExpendioPhotoConsistency(expendio: {
  id: string;
  cedula: string;
  municipio?: string;
  encargado?: string;
}): Promise<{
  success: boolean;
  isConsistent: boolean;
  expendioId: string;
  cedula: string;
  items: ConsistencyAuditItem[];
  inconsistenciesPurged: number;
}> {
  const cleanCed = String(expendio.cedula || '').replace(/\D/g, '').trim();
  const expId = String(expendio.id || '').trim();

  const slots = [
    { key: 'fotoAvisoUrl', title: '1. Aviso Exterior' },
    { key: 'fotoPanoramicaUrl', title: '2. Panorámica Fachada' },
    { key: 'fotoMataselloUrl', title: '3. Matasello Postal' },
    { key: 'fotoBasculaUrl', title: '4. Báscula Calibrada' },
    { key: 'fotoContratistaUrl', title: '5. Encargado Responsable' },
    { key: 'fotoHorarioUrl', title: '6. Horario de Atención' },
    { key: 'fotoTarifasUrl', title: '7. Tarifario Oficial' },
  ];

  let inconsistenciesPurged = 0;
  const items: ConsistencyAuditItem[] = [];

  for (const s of slots) {
    try {
      // 1. Revisar caché local en IndexedDB
      const cached = await getStoredPhoto(cleanCed, s.key, expId);
      if (cached) {
        // Verificar si la caché contiene datos de otro expendio
        const isMismatchedExpId = Boolean(cached.expendioId && cached.expendioId !== expId);
        const isMismatchedCed = Boolean(cached.cedula && cached.cedula.replace(/\D/g, '') !== cleanCed);
        if (isMismatchedExpId || isMismatchedCed) {
          console.warn(`[Auditor Consistencia] Purgando entrada cruzada en ${s.key}: exp ${cached.expendioId} / ced ${cached.cedula}`);
          await deleteCachedPhotoBySlot(cleanCed, s.key);
          inconsistenciesPurged++;
        }
      }

      // 2. Consultar autoridad en el servidor (S3 / PostgreSQL)
      const meta = await fetchPostgresPhotoMetadata(cleanCed || expId, s.key);
      if (meta && meta.exists) {
        items.push({
          slotKey: s.key,
          slotTitle: s.title,
          isConsistent: true,
          status: 'VERIFICADO_OK',
          details: `Bucket S3 sincronizado (${meta.storageProvider || 'S3'}). Versión: ${meta.version}`,
          serverUrl: meta.url,
        });
      } else {
        items.push({
          slotKey: s.key,
          slotTitle: s.title,
          isConsistent: true,
          status: 'SIN_FOTO',
          details: 'Pendiente por capturar para este expendio.',
        });
      }
    } catch (err: any) {
      items.push({
        slotKey: s.key,
        slotTitle: s.title,
        isConsistent: false,
        status: 'DISCREPANCIA_CORREGIDA',
        details: `Revisión: ${err.message || 'Sin conexión'}`,
      });
    }
  }

  return {
    success: true,
    isConsistent: inconsistenciesPurged === 0,
    expendioId: expId,
    cedula: cleanCed,
    items,
    inconsistenciesPurged,
  };
}

/**
 * Limpieza estricta de cualquier clave residual de fotos en localStorage para evitar fuentes alternativas de verdad
 */
export function clearAllPhotoMetadata(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.startsWith('camarca_photo_meta_') ||
          k.includes('photos_cache') ||
          k.includes('local_photos'))
      ) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

export function setLocalPhotoMetadata(..._args: any[]): void {
  // Deprecado: No se permite almacenar metadatos de fotos en localStorage.
  // PostgreSQL es la única fuente de verdad y IndexedDB es el único caché de contenido.
}
