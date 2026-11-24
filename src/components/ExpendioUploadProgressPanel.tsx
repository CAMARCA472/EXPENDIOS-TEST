import React, { useEffect, useState, useCallback } from 'react';
import { CloudUpload, CheckCircle2, Clock, RefreshCw, HardDriveDownload } from 'lucide-react';
import { getAllStoredPhotos, PHOTO_DB_UPDATED_EVENT } from '../lib/photoStorageDB';

const PHOTO_CACHE_UPDATED_EVENT = 'photoCacheVerificationUpdated';
const VERIFIED_PHOTO_CACHE_NAME = 'camarca-verified-photos-v2';

interface ExpendioUploadProgressPanelProps {
  cedula?: string;
  totalLoadedPhotos: number;
  uploadingPhotoType: string | null;
  offlineQueue?: any[];
  isSyncingOffline?: boolean;
  onSyncOffline?: () => void;
  isLight?: boolean;
}

export const ExpendioUploadProgressPanel: React.FC<ExpendioUploadProgressPanelProps> = ({
  cedula,
  totalLoadedPhotos,
  uploadingPhotoType,
  offlineQueue = [],
  isSyncingOffline = false,
  onSyncOffline,
  isLight = true,
}) => {
  const [idbPendingCount, setIdbPendingCount] = useState<number>(0);
  const [idbSyncedCount, setIdbSyncedCount] = useState<number>(0);
  const [idbTotalCount, setIdbTotalCount] = useState<number>(0);
  const [cacheApiVerifiedCount, setCacheApiVerifiedCount] = useState<number>(0);
  const [activeUploadPulse, setActiveUploadPulse] = useState<number>(0);

  const normalizeCedula = (val?: string) => String(val || '').replace(/\D/g, '').trim();

  const inspectStorageStates = useCallback(async () => {
    const cleanCed = normalizeCedula(cedula);
    if (!cleanCed) return;

    try {
      // 1. Leer estados directamente desde IndexedDB (Dexie photoDB.photos)
      const allRecords = await getAllStoredPhotos();
      const records = allRecords.filter((r) => normalizeCedula(r.cedula) === cleanCed);
      const pendingInIdb = records.filter(
        (r) => !r.serverSynced && r.status !== 'synced'
      ).length;
      const syncedInIdb = records.filter(
        (r) => r.serverSynced || r.status === 'synced'
      ).length;

      setIdbPendingCount(pendingInIdb);
      setIdbSyncedCount(syncedInIdb);
      setIdbTotalCount(records.length);
    } catch {
      // Fallback silencioso si IndexedDB está bloqueado
    }

    try {
      // 2. Leer estados directamente desde Browser Cache API (post-descarga verificada)
      if (typeof window !== 'undefined' && 'caches' in window) {
        const cache = await window.caches.open(VERIFIED_PHOTO_CACHE_NAME);
        const requests = await cache.keys();
        const matchingForCedula = requests.filter((req) =>
          req.url.includes(`/api/photos/${encodeURIComponent(cleanCed)}/`) ||
          req.url.includes(`/api/photos/${cleanCed}/`)
        );
        setCacheApiVerifiedCount(matchingForCedula.length);
      }
    } catch {
      // Fallback silencioso
    }
  }, [cedula]);

  useEffect(() => {
    inspectStorageStates();

    const handleUpdate = () => {
      inspectStorageStates();
    };

    window.addEventListener(PHOTO_DB_UPDATED_EVENT, handleUpdate);
    window.addEventListener(PHOTO_CACHE_UPDATED_EVENT, handleUpdate);
    window.addEventListener('photoStorageUpdated', handleUpdate);

    const interval = setInterval(inspectStorageStates, 4000);
    return () => {
      window.removeEventListener(PHOTO_DB_UPDATED_EVENT, handleUpdate);
      window.removeEventListener(PHOTO_CACHE_UPDATED_EVENT, handleUpdate);
      window.removeEventListener('photoStorageUpdated', handleUpdate);
      clearInterval(interval);
    };
  }, [inspectStorageStates]);

  // Efecto visual de avance inmediato mientras se está subiendo una fotografía al servidor
  useEffect(() => {
    if (!uploadingPhotoType && !isSyncingOffline) {
      setActiveUploadPulse(0);
      return;
    }
    setActiveUploadPulse(25);
    const timer = setInterval(() => {
      setActiveUploadPulse((prev) => (prev < 92 ? prev + 12 : prev));
    }, 350);
    return () => clearInterval(timer);
  }, [uploadingPhotoType, isSyncingOffline]);

  // Cola offline + pendientes en IndexedDB
  const queueUnsyncedCount = Array.isArray(offlineQueue)
    ? offlineQueue.filter((item) => item.status !== 'synced').length
    : 0;

  const pendingFilesCount = Math.max(idbPendingCount, queueUnsyncedCount);
  const isUploadingNow = Boolean(uploadingPhotoType) || isSyncingOffline;

  // Total de archivos gestionados para calcular progreso de subida a servidores
  const effectiveTotalFiles = Math.max(totalLoadedPhotos, idbTotalCount, pendingFilesCount);
  const syncedFilesCount = Math.max(
    0,
    effectiveTotalFiles - pendingFilesCount - (uploadingPhotoType ? 1 : 0)
  );

  let uploadProgressPercent = 100;
  if (effectiveTotalFiles === 0 && !isUploadingNow) {
    uploadProgressPercent = 0;
  } else if (isUploadingNow) {
    const baseRatio =
      effectiveTotalFiles > 0 ? (syncedFilesCount / Math.max(1, effectiveTotalFiles)) * 100 : 0;
    const stepContribution =
      effectiveTotalFiles > 0
        ? (activeUploadPulse / 100) * (100 / Math.max(1, effectiveTotalFiles))
        : activeUploadPulse;
    uploadProgressPercent = Math.min(98, Math.max(15, Math.round(baseRatio + stepContribution)));
  } else if (pendingFilesCount > 0) {
    uploadProgressPercent =
      effectiveTotalFiles > 0
        ? Math.round((syncedFilesCount / effectiveTotalFiles) * 100)
        : 0;
  } else if (effectiveTotalFiles > 0) {
    uploadProgressPercent = 100;
  }

  const hasUnsyncedPhotos = pendingFilesCount > 0;

  return (
    <div
      className={`mt-3 rounded-xl border p-3 transition-all ${
        isLight
          ? 'bg-white/90 border-slate-300 text-slate-900 shadow-xs'
          : 'bg-slate-950/90 border-slate-800 text-slate-100'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        {/* Estado de subida y contador de pendientes */}
        <div className="flex items-center space-x-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              isUploadingNow
                ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                : pendingFilesCount > 0
                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                : effectiveTotalFiles > 0
                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
            }`}
          >
            {isUploadingNow ? (
              <CloudUpload className="w-4 h-4 animate-bounce" />
            ) : pendingFilesCount > 0 ? (
              <Clock className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="text-xs font-black uppercase tracking-tight">
                {isUploadingNow
                  ? 'Subiendo fotografía al servidor y actualizando caché...'
                  : pendingFilesCount > 0
                  ? `${pendingFilesCount} archivo(s) pendiente(s) por subir al servidor`
                  : effectiveTotalFiles > 0
                  ? 'Todas las fotografías cargadas están en los servidores'
                  : 'Sin fotografías pendientes de subida'}
              </span>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                  pendingFilesCount > 0
                    ? 'bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-700'
                    : 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-700'
                }`}
              >
                Pendientes: {pendingFilesCount}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-400 mt-0.5">
              <span>
                Servidor: {syncedFilesCount}/{effectiveTotalFiles} sincronizadas ({uploadProgressPercent}%)
              </span>
              <span className="inline-flex items-center space-x-1">
                <HardDriveDownload className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>
                  Caché tras descarga: {Math.max(cacheApiVerifiedCount, idbSyncedCount)}/{effectiveTotalFiles}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Botón Sincronizar (habilitado únicamente si hay imágenes no sincronizadas a ninguno de los servidores) */}
        {onSyncOffline && (
          <button
            type="button"
            onClick={onSyncOffline}
            disabled={isSyncingOffline || !hasUnsyncedPhotos}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-black flex items-center justify-center space-x-1.5 shadow-xs shrink-0 transition-all min-w-[140px] ${
              hasUnsyncedPhotos && !isSyncingOffline
                ? 'bg-blue-600 hover:bg-blue-500 text-white active:scale-95 cursor-pointer'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-300 dark:border-slate-700 opacity-60 cursor-not-allowed'
            }`}
            title={
              hasUnsyncedPhotos
                ? 'Sincronizar fotografías pendientes hacia los servidores'
                : 'Todas las fotografías cargadas ya fueron sincronizadas en los servidores'
            }
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingOffline ? 'animate-spin' : ''}`} />
            <span>{isSyncingOffline ? 'Sincronizando...' : 'Sincronizar'}</span>
            {hasUnsyncedPhotos && (
              <span className="bg-blue-800 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-0.5">
                {pendingFilesCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Barra de progreso de subida a servidores */}
      <div className="mt-2.5 space-y-1">
        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400">
          <span>Progreso de Subida a Servidores</span>
          <span>{uploadProgressPercent}%</span>
        </div>
        <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              isUploadingNow
                ? 'bg-blue-500'
                : pendingFilesCount > 0
                ? 'bg-amber-500'
                : 'bg-emerald-500'
            }`}
            style={{ width: `${uploadProgressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
};
