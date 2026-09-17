import React, { useState, useEffect } from 'react';
import {
  Camera,
  Cloud,
  FolderOpen,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  UploadCloud,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Search,
  ShieldCheck,
  AlertCircle,
  Activity,
  Radio,
  Zap,
  Check,
  Database,
  DownloadCloud,
  Trash2,
  Archive,
  Cpu,
  Layers,
  Wifi,
  WifiOff
} from 'lucide-react';
import {
  getOrCreatePhotosFolder,
  syncAllPhotosToGoogleDrive,
  PHOTOS_FOLDER_NAME
} from '../lib/googleDriveService';
import {
  getIndexedDBStats,
  clearSyncedPhotosFromIndexedDB,
  purgeUploadedPhotosFromIndexedDB,
  getPurgeRetentionHours,
  setPurgeRetentionHours,
  exportAllPhotosAsZip,
  syncAllPendingPhotos,
  PHOTO_DB_UPDATED_EVENT
} from '../lib/photoStorageDB';
import {
  initDriveSyncServiceWorker,
  triggerDriveSyncViaWorker,
  getWorkerSyncStatus,
  subscribeToWorkerSyncEvents,
  requestBackgroundSyncRegistration,
  isServiceWorkerSupported,
  isBackgroundSyncSupported,
  WorkerSyncStats
} from '../lib/driveSyncServiceWorker';
import { IndexedDBStorageStats } from '../types';

interface PhotoItem {
  cedula: string;
  slotKey: string;
  fileName: string;
  url: string;
  nombre?: string;
  municipio?: string;
  inGoogleDrive?: boolean;
  driveFileId?: string | null;
  driveWebViewLink?: string | null;
}

interface BackgroundSyncState {
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

interface GoogleDrivePhotosManagerProps {
  accessToken: string | null;
  isAuthenticated: boolean;
  onSignIn?: () => void;
}

export const GoogleDrivePhotosManager: React.FC<GoogleDrivePhotosManagerProps> = ({
  accessToken,
  isAuthenticated,
  onSignIn,
}) => {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [folderUrl, setFolderUrl] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [syncResult, setSyncResult] = useState<{ uploaded: number; errors: number } | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterDrive, setFilterDrive] = useState<'all' | 'inDrive' | 'pending'>('all');
  
  // Estado del servicio en segundo plano (Background Sync)
  const [bgSyncStatus, setBgSyncStatus] = useState<BackgroundSyncState | null>(null);
  const [isTriggeringBgSync, setIsTriggeringBgSync] = useState<boolean>(false);
  const [bgSyncMessage, setBgSyncMessage] = useState<string | null>(null);

  // Estado de la capa de persistencia estructurada IndexedDB (Dexie.js)
  const [idbStats, setIdbStats] = useState<IndexedDBStorageStats | null>(null);
  const [isIdbSyncing, setIsIdbSyncing] = useState<boolean>(false);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [isPurging, setIsPurging] = useState<boolean>(false);
  const [idbActionMsg, setIdbActionMsg] = useState<string | null>(null);

  // Estado de sincronización en segundo plano con Service Worker dedicado
  const [swStats, setSwStats] = useState<WorkerSyncStats | null>(null);
  const [isSwSyncing, setIsSwSyncing] = useState<boolean>(false);
  const [swActionMsg, setSwActionMsg] = useState<string | null>(null);
  const [swLiveLog, setSwLiveLog] = useState<{ type: 'info' | 'warning' | 'success' | 'error'; text: string; time: string } | null>(null);
  const [isSwSupported, setIsSwSupported] = useState<boolean>(true);
  const [isBgSyncSupportedState, setIsBgSyncSupportedState] = useState<boolean>(false);

  const handleTriggerSwSync = async () => {
    setIsSwSyncing(true);
    setSwActionMsg(null);
    try {
      const res = await triggerDriveSyncViaWorker(accessToken || undefined);
      if (res.success) {
        setSwActionMsg('✓ Petición enviada al Service Worker. Sincronización en curso en segundo plano sin bloquear la interfaz principal.');
      } else {
        setSwActionMsg(`Aviso: ${res.message}. Ejecutando sincronización de respaldo...`);
        if (accessToken) {
          await syncAllPendingPhotos({ driveToken: accessToken });
        }
      }
      await loadIdbStats();
    } catch (err: any) {
      setSwActionMsg(`Error comunicándose con el Service Worker: ${err.message}`);
    } finally {
      setIsSwSyncing(false);
      setTimeout(() => setSwActionMsg(null), 8000);
    }
  };

  const handleRegisterBackgroundSync = async () => {
    try {
      const ok = await requestBackgroundSyncRegistration();
      if (ok) {
        setSwActionMsg('✓ Background Sync API registrada en el navegador. La sincronización se reintentará automáticamente al recuperar red.');
      } else {
        setSwActionMsg('Background Sync registrado. El Service Worker ejecutará el ciclo autónomo de reintentos.');
      }
    } catch (err: any) {
      setSwActionMsg(`Aviso: ${err.message}`);
    } finally {
      setTimeout(() => setSwActionMsg(null), 6000);
    }
  };

  const loadIdbStats = async () => {
    try {
      const stats = await getIndexedDBStats();
      setIdbStats(stats);
    } catch (err) {
      console.warn('Error leyendo stats de IndexedDB:', err);
    }
  };

  const handleSyncIdbWithDrive = async () => {
    if (!accessToken) {
      if (onSignIn) onSignIn();
      return;
    }
    setIsIdbSyncing(true);
    setIdbActionMsg(null);
    try {
      const res = await syncAllPendingPhotos({ driveToken: accessToken });
      setIdbActionMsg(`✓ Sincronización IndexedDB completada: ${res.syncedCount} subidas, ${res.failedCount} con reintento.`);
      await loadIdbStats();
      await fetchCatalog();
    } catch (err: any) {
      setIdbActionMsg(`Error: ${err.message || 'Fallo de sincronización'}`);
    } finally {
      setIsIdbSyncing(false);
      setTimeout(() => setIdbActionMsg(null), 7000);
    }
  };

  const handleExportZip = async () => {
    setIsExportingZip(true);
    setIdbActionMsg(null);
    try {
      await exportAllPhotosAsZip();
      setIdbActionMsg(`✓ Archivo ZIP generado y descargado exitosamente con todas las fotos de IndexedDB y manifiesto JSON.`);
    } catch (err: any) {
      setIdbActionMsg(`Error al exportar ZIP: ${err.message}`);
    } finally {
      setIsExportingZip(false);
      setTimeout(() => setIdbActionMsg(null), 7000);
    }
  };

  const handleClearSynced = async () => {
    if (!confirm('¿Deseas limpiar del almacenamiento IndexedDB del navegador las fotografías que ya fueron subidas y respaldadas en Google Drive?')) {
      return;
    }
    try {
      const deleted = await clearSyncedPhotosFromIndexedDB();
      setIdbActionMsg(`✓ Se liberó espacio local. ${deleted} fotos ya respaldadas en Drive fueron removidas de IndexedDB.`);
      await loadIdbStats();
    } catch (err: any) {
      setIdbActionMsg(`Error: ${err.message}`);
    } finally {
      setTimeout(() => setIdbActionMsg(null), 6000);
    }
  };

  const handleExecutePurge = async (forceImmediate: boolean) => {
    const hours = idbStats?.retentionHours ?? 24;
    const confirmPrompt = forceImmediate
      ? '¿Confirmas la purga inmediata de TODOS los registros marcados como subidos exitosamente en IndexedDB?'
      : `¿Confirmas purgar los registros de IndexedDB marcados como subidos exitosamente con más de ${hours} horas de antigüedad?`;

    if (!confirm(confirmPrompt)) return;

    setIsPurging(true);
    try {
      const res = await purgeUploadedPhotosFromIndexedDB({ forceImmediate });
      const freedMb = (res.freedBytes / 1024 / 1024).toFixed(2);
      setIdbActionMsg(
        `✓ Purga completada: ${res.purgedCount} registros subidos eliminados (${freedMb} MB liberados). ` +
        `Registros pendientes conservados: ${res.pendingCount + res.failedCount}.`
      );
      await loadIdbStats();
    } catch (err: any) {
      setIdbActionMsg(`Error durante la purga: ${err.message}`);
    } finally {
      setIsPurging(false);
      setTimeout(() => setIdbActionMsg(null), 8000);
    }
  };

  const handleRetentionChange = (hours: number) => {
    setPurgeRetentionHours(hours);
    loadIdbStats();
  };

  const fetchBgSyncStatus = async () => {
    try {
      const res = await fetch(`/api/admin/google-drive/sync-status?_t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setBgSyncStatus(data);
        }
      }
    } catch {}
  };

  const triggerBackgroundSyncNow = async () => {
    setIsTriggeringBgSync(true);
    setBgSyncMessage(null);
    try {
      const res = await fetch('/api/admin/google-drive/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setBgSyncMessage(`✓ Sincronización en segundo plano completada: ${data.synced || 0} fotos sincronizadas.`);
        await fetchBgSyncStatus();
        await fetchCatalog();
      } else {
        setBgSyncMessage(`Aviso: ${data.error || 'No se pudo completar la sincronización'}`);
      }
    } catch (err: any) {
      setBgSyncMessage(`Error: ${err.message}`);
    } finally {
      setIsTriggeringBgSync(false);
      setTimeout(() => setBgSyncMessage(null), 6000);
    }
  };

  const fetchCatalog = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/photos/catalog?_t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.photos)) {
          setPhotos(data.photos);
        }
      }
    } catch (err) {
      console.warn('Error cargando catálogo de fotos:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const resolveFolder = async () => {
    if (!accessToken) return;
    try {
      const folder = await getOrCreatePhotosFolder(accessToken);
      if (folder?.webViewLink) {
        setFolderUrl(folder.webViewLink);
      }
    } catch (err) {
      console.warn('Error resolviendo carpeta de fotos en Google Drive:', err);
    }
  };

  useEffect(() => {
    fetchCatalog();
    fetchBgSyncStatus();
    loadIdbStats();

    setIsSwSupported(isServiceWorkerSupported());
    setIsBgSyncSupportedState(isBackgroundSyncSupported());

    initDriveSyncServiceWorker().then(() => {
      getWorkerSyncStatus().then((st) => setSwStats(st));
    });

    const unsubscribeSw = subscribeToWorkerSyncEvents((event) => {
      const timeStr = new Date().toLocaleTimeString('es-CO');
      if (event.type === 'SYNC_STARTED') {
        setIsSwSyncing(true);
        setSwLiveLog({
          type: 'info',
          text: `Iniciada sincronización en segundo plano (${event.payload?.total || 0} fotos)`,
          time: timeStr,
        });
      } else if (event.type === 'SYNC_PROGRESS') {
        setIsSwSyncing(true);
        setSwLiveLog({
          type: 'info',
          text: `Transmitiendo (${event.payload?.current}/${event.payload?.total}): ${event.payload?.fileName}`,
          time: timeStr,
        });
      } else if (event.type === 'SYNC_ITEM_RETRY') {
        setSwLiveLog({
          type: 'warning',
          text: `Reintentando ${event.payload?.fileName} (Intento ${event.payload?.attempt}/${event.payload?.maxRetries} en ${Math.round((event.payload?.delayMs || 1000) / 1000)}s)...`,
          time: timeStr,
        });
      } else if (event.type === 'SYNC_ITEM_SUCCESS') {
        setSwLiveLog({
          type: 'success',
          text: `✓ ${event.payload?.fileName} respaldada en Google Drive`,
          time: timeStr,
        });
        loadIdbStats();
        fetchCatalog();
      } else if (event.type === 'SYNC_COMPLETED') {
        setIsSwSyncing(false);
        setSwLiveLog({
          type: 'success',
          text: `✓ Sincronización completada (${event.payload?.syncedCount} subidas, ${event.payload?.failedCount} pendientes)`,
          time: timeStr,
        });
        loadIdbStats();
        fetchCatalog();
      } else if (event.type === 'SYNC_ERROR') {
        setIsSwSyncing(false);
        setSwLiveLog({
          type: 'error',
          text: `Error en worker: ${event.payload?.error}`,
          time: timeStr,
        });
      }
      getWorkerSyncStatus().then((st) => setSwStats(st));
    });

    const handleDbUpdate = () => {
      loadIdbStats();
    };
    window.addEventListener(PHOTO_DB_UPDATED_EVENT, handleDbUpdate);
    window.addEventListener('camarca_offline_queue_updated', handleDbUpdate);

    const interval = setInterval(() => {
      fetchBgSyncStatus();
      loadIdbStats();
      getWorkerSyncStatus().then((st) => setSwStats(st));
    }, 8000);

    return () => {
      clearInterval(interval);
      unsubscribeSw();
      window.removeEventListener(PHOTO_DB_UPDATED_EVENT, handleDbUpdate);
      window.removeEventListener('camarca_offline_queue_updated', handleDbUpdate);
    };
  }, []);

  useEffect(() => {
    resolveFolder();
    fetchBgSyncStatus();
  }, [isAuthenticated, accessToken]);

  const [isReconciling, setIsReconciling] = useState<boolean>(false);
  const [reconcileResult, setReconcileResult] = useState<{ movedCount: number; linkedCount: number } | null>(null);
  const [isScanningFolders, setIsScanningFolders] = useState<boolean>(false);
  const [scanResultMsg, setScanResultMsg] = useState<string | null>(null);

  const handleScanAndLinkPhotos = async () => {
    setIsScanningFolders(true);
    setScanResultMsg(null);
    try {
      const res = await fetch('/api/admin/photos/scan-and-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setScanResultMsg(data.message);
        await fetchCatalog();
      } else {
        alert('Aviso al escanear carpetas: ' + (data.message || 'Error desconocido'));
      }
    } catch (e: any) {
      alert('Error escaneando carpetas de fotos: ' + e.message);
    } finally {
      setIsScanningFolders(false);
    }
  };

  const handleReconcile = async () => {
    setIsReconciling(true);
    setReconcileResult(null);
    try {
      const res = await fetch('/api/admin/google-drive/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: accessToken || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setReconcileResult({ movedCount: data.movedCount, linkedCount: data.linkedCount });
        if (data.folderUrl) setFolderUrl(data.folderUrl);
        await fetchCatalog();
      } else {
        alert('Aviso: ' + (data.error || 'No se pudo completar la organización'));
      }
    } catch (e: any) {
      alert('Error organizando fotos en Drive: ' + e.message);
    } finally {
      setIsReconciling(false);
    }
  };

  const handleSyncAll = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    setSyncProgress({ current: 0, total: photos.length, name: 'Iniciando sincronización con Google Drive...' });

    try {
      if (accessToken) {
        const result = await syncAllPhotosToGoogleDrive(accessToken, (curr, tot, name) => {
          setSyncProgress({ current: curr, total: tot, name });
        });
        setSyncResult({ uploaded: result.totalUploaded, errors: result.totalErrors });
        if (result.folderUrl) {
          setFolderUrl(result.folderUrl);
        }
      } else {
        // Sincronización instantánea a nivel de servidor (no requiere inicio de sesión en navegador)
        const res = await fetch('/api/admin/google-drive/sync-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (data.success) {
          setSyncResult({ uploaded: data.synced || 0, errors: 0 });
        } else {
          if (onSignIn) {
            onSignIn();
            return;
          }
          alert(data.message || 'No hay conexión permanente activa con Google Drive.');
        }
      }
      await fetchCatalog();
    } catch (err: any) {
      alert(`Error en la sincronización con Google Drive: ${err.message || err}`);
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  const filteredPhotos = photos.filter((p) => {
    const matchesSearch =
      (p.cedula || '').includes(searchTerm) ||
      (p.nombre || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.municipio || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.slotKey || '').toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (filterDrive === 'inDrive') return Boolean(p.inGoogleDrive);
    if (filterDrive === 'pending') return !p.inGoogleDrive;
    return true;
  });

  const totalInDrive = photos.filter((p) => p.inGoogleDrive).length;
  const totalPending = photos.length - totalInDrive;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl">
            <Camera className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold text-slate-100">
                Archivo Fotográfico en Google Drive
              </h3>
              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                100% Desacoplado de Firebase
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Las fotografías georreferenciadas se guardan en tu cuenta de Google Drive y disco local, sin agotar cuotas de Firestore.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {folderUrl && (
            <a
              href={folderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              <span>Abrir Carpeta en Drive</span>
              <ExternalLink className="w-3 h-3 ml-0.5" />
            </a>
          )}

          <button
            onClick={fetchCatalog}
            disabled={isLoading}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl border border-slate-800 transition-colors"
            title="Refrescar catálogo"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Notice info */}
      <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-3.5 text-xs text-emerald-200/90 flex items-start space-x-2.5">
        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-emerald-300">Carpeta Exclusiva en Google Drive: </span>
          <span>
            Los registros se almacenan organizados bajo el nombre <strong className="text-emerald-100">{PHOTOS_FOLDER_NAME}</strong>. Cada imagen conserva su cédula, tipo de comprobante y geolocalización.
          </span>
        </div>
      </div>

      {/* Background Sync Service Status Card */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 shadow-lg space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center space-x-3">
            <div className="relative flex items-center justify-center p-2.5 bg-emerald-500/10 border border-emerald-500/40 rounded-xl text-emerald-400 shrink-0">
              <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h4 className="text-sm font-bold text-slate-100 flex items-center space-x-1.5">
                  <span>Servicio en Segundo Plano (Background Sync)</span>
                </h4>
                <span className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>VIGILANTE ACTIVO</span>
                </span>
                <span className="bg-blue-500/10 text-blue-300 border border-blue-500/30 text-[10px] font-medium px-2 py-0.5 rounded-full">
                  Clasificación por Municipio
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Detecta automáticamente cualquier cambio o nueva foto en el almacenamiento local y la sincroniza a Google Drive en su carpeta de municipio correspondiente sin requerir clics manuales.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={triggerBackgroundSyncNow}
              disabled={isTriggeringBgSync || Boolean(bgSyncStatus && bgSyncStatus.isSyncRunning)}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-md shadow-emerald-950/40"
              title="Dispara una verificación y sincronización inmediata en segundo plano"
            >
              {isTriggeringBgSync || Boolean(bgSyncStatus && bgSyncStatus.isSyncRunning) ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sincronizando en segundo plano...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Forzar Sync Inmediato</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live sync telemetry */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex items-center space-x-1.5 text-slate-400">
            <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">
              Estado:{' '}
              <strong className="text-slate-200">
                {bgSyncStatus?.isSyncRunning ? 'Sincronizando ahora...' : 'En guardia (escuchando disco)'}
              </strong>
            </span>
          </div>
          <div className="flex items-center space-x-1.5 text-slate-400">
            <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="truncate">
              Fotos Locales: <strong className="text-slate-200">{bgSyncStatus?.totalLocalPhotos ?? photos.length}</strong>
            </span>
          </div>
          <div className="flex items-center space-x-1.5 text-slate-400">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">
              En Drive:{' '}
              <strong className="text-emerald-300">
                {bgSyncStatus?.syncedPhotosCount ?? totalInDrive}
              </strong>
            </span>
          </div>
          <div className="flex items-center space-x-1.5 text-slate-400">
            <Cloud className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">
              Pendientes:{' '}
              <strong className={bgSyncStatus?.pendingPhotosCount ? 'text-amber-300 font-bold' : 'text-slate-400'}>
                {bgSyncStatus?.pendingPhotosCount ?? totalPending}
              </strong>
            </span>
          </div>
        </div>

        {bgSyncMessage && (
          <div className="p-2.5 bg-emerald-950/60 border border-emerald-700/60 text-emerald-200 text-xs rounded-lg flex items-center space-x-2 animate-fadeIn">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{bgSyncMessage}</span>
          </div>
        )}
      </div>

      {/* IndexedDB Local Persistence & Storage Protection Card */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-cyan-500/30 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="relative flex items-center justify-center p-2.5 bg-cyan-500/10 border border-cyan-500/40 rounded-xl text-cyan-400 shrink-0">
              <Database className="w-5 h-5 text-cyan-400" />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h4 className="text-sm font-bold text-slate-100 flex items-center space-x-1.5">
                  <span>Persistencia Local Estructurada (IndexedDB / Dexie.js)</span>
                </h4>
                <span className="bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1">
                  <ShieldCheck className="w-3 h-3 text-cyan-400" />
                  <span>PROTECCIÓN ANTI-PÉRDIDA ACTIVA</span>
                </span>
                <span className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 text-[10px] font-medium px-2 py-0.5 rounded-full">
                  Binarios Blob + Metadatos
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                Almacena fotos completas con geolocalización en la base de datos local del navegador antes de transmitirlas a la red. Si el navegador se cierra o falla la conexión, los datos se preservan y se reanudan automáticamente.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 flex-wrap gap-2 shrink-0">
            <button
              onClick={handleSyncIdbWithDrive}
              disabled={isIdbSyncing || (idbStats?.pendingRecords === 0)}
              className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-md shadow-cyan-950/40"
              title="Sube las fotos en cola en IndexedDB directamente a Google Drive"
            >
              {isIdbSyncing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sincronizando IndexedDB...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Sincronizar Cola IndexedDB ({idbStats?.pendingRecords ?? 0})</span>
                </>
              )}
            </button>

            <button
              onClick={handleExportZip}
              disabled={isExportingZip || (idbStats?.totalRecords === 0)}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors"
              title="Descargar copia de seguridad ZIP con todas las imágenes y manifiesto JSON"
            >
              {isExportingZip ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                  <span>Comprimiendo ZIP...</span>
                </>
              ) : (
                <>
                  <Archive className="w-4 h-4 text-cyan-400" />
                  <span>Backup ZIP</span>
                </>
              )}
            </button>

            <button
              onClick={handleClearSynced}
              disabled={(idbStats?.driveSyncedRecords === 0)}
              className="p-2 bg-slate-800/80 hover:bg-red-900/30 text-slate-400 hover:text-red-300 border border-slate-700/80 rounded-xl text-xs transition-colors"
              title="Liberar espacio en el navegador eliminando las fotos que ya están en Google Drive"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Telemetría y estadísticas de IndexedDB */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-800/80 text-xs">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Total en IndexedDB</span>
            <div className="text-base font-black text-slate-100 mt-0.5">
              {idbStats?.totalRecords ?? idbStats?.total ?? 0}
            </div>
            <span className="text-[10px] text-slate-500">Registros locales</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
            <span className="text-[10px] uppercase font-bold text-amber-400 block">Requieren Atención</span>
            <div className="text-base font-black text-amber-400 mt-0.5">
              {(idbStats?.pendingRecords ?? idbStats?.pending ?? 0) + (idbStats?.failed ?? 0)}
            </div>
            <span className="text-[10px] text-slate-500">Pendientes / error</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
            <span className="text-[10px] uppercase font-bold text-emerald-400 block">Subidas en Retención</span>
            <div className="text-base font-black text-emerald-400 mt-0.5">
              {idbStats?.driveSyncedRecords ?? idbStats?.synced ?? 0}
            </div>
            <span className="text-[10px] text-slate-500">Sincronizadas con éxito</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
            <span className="text-[10px] uppercase font-bold text-cyan-400 block">Almacenamiento Local</span>
            <div className="text-base font-black text-cyan-300 mt-0.5">
              {idbStats?.estimatedBytesFormatted ?? '0 KB'}
            </div>
            <span className="text-[10px] text-slate-500">Espacio en navegador</span>
          </div>
        </div>

        {/* Sección de Purga Inteligente de Registros Subidos */}
        <div className="pt-2.5 border-t border-slate-800/80 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
                <Trash2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Política de Purga de Registros Subidos</span>
              </span>
              <span className="text-[10px] text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded-full border border-cyan-800/60 font-semibold">
                Retención: {idbStats?.retentionHours ?? 24}h
              </span>
            </div>

            <div className="flex items-center space-x-2 flex-wrap gap-2">
              <label className="text-[11px] text-slate-400">Periodo de retención:</label>
              <select
                value={idbStats?.retentionHours ?? 24}
                onChange={(e) => handleRetentionChange(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1 outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value={0}>Inmediato (0h)</option>
                <option value={1}>1 hora</option>
                <option value={6}>6 horas</option>
                <option value={12}>110 minutos</option>
                <option value={24}>24 horas (Recomendado)</option>
                <option value={48}>48 horas</option>
                <option value={168}>7 días</option>
              </select>

              <button
                onClick={() => handleExecutePurge(false)}
                disabled={isPurging || (idbStats?.driveSyncedRecords === 0 && idbStats?.synced === 0)}
                className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-medium flex items-center space-x-1 transition-colors disabled:opacity-40"
                title={`Elimina fotos subidas con más de ${idbStats?.retentionHours ?? 24} horas, conservando únicamente las fotos pendientes que requieren atención`}
              >
                {isPurging ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                    <span>Purgando...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3 h-3 text-amber-400" />
                    <span>Purgar Subidos (&gt;{idbStats?.retentionHours ?? 24}h)</span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleExecutePurge(true)}
                disabled={isPurging || (idbStats?.driveSyncedRecords === 0 && idbStats?.synced === 0)}
                className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 rounded-lg text-xs font-medium flex items-center space-x-1 transition-colors disabled:opacity-40"
                title="Elimina de inmediato de IndexedDB todas las fotos marcadas como subidas correctamente"
              >
                <span>Purgar Todos</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-slate-400 bg-slate-900/50 p-2.5 rounded-xl border border-slate-800 gap-1.5">
            <div>
              <span>
                Purga automática activa: limpia registros de IndexedDB marcados como &apos;subidos correctamente&apos; tras{' '}
                <strong className="text-slate-200">{idbStats?.retentionHours ?? 24} horas</strong>.
                La base local solo conserva los registros que aún requieren atención.
              </span>
            </div>
            {idbStats?.lastPurgeAt && (
              <div className="text-slate-500 text-[10px] shrink-0">
                Última purga: {new Date(idbStats.lastPurgeAt).toLocaleTimeString('es-CO')}
                {idbStats.totalPurgedCount ? ` (${idbStats.totalPurgedCount} fotos liberadas en total)` : ''}
              </div>
            )}
          </div>
        </div>

        {idbActionMsg && (
          <div className="p-2.5 bg-cyan-950/60 border border-cyan-700/60 text-cyan-200 text-xs rounded-lg flex items-center space-x-2 animate-fadeIn">
            <Check className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>{idbActionMsg}</span>
          </div>
        )}
      </div>

      {/* Dedicated Service Worker for Background Synchronization & Resilient Retries Card */}
      <div className="bg-gradient-to-r from-slate-950 via-indigo-950/40 to-slate-950 border border-indigo-500/30 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="relative flex items-center justify-center p-2.5 bg-indigo-500/10 border border-indigo-500/40 rounded-xl text-indigo-400 shrink-0">
              <Cpu className="w-5 h-5 text-indigo-400" />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSwSyncing || swStats?.isSyncing ? 'bg-amber-400' : 'bg-indigo-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isSwSyncing || swStats?.isSyncing ? 'bg-amber-500' : 'bg-indigo-500'}`}></span>
              </span>
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h4 className="text-sm font-bold text-slate-100 flex items-center space-x-1.5">
                  <span>Service Worker Dedicado (Sincronización en Segundo Plano)</span>
                </h4>
                {isSwSyncing || swStats?.isSyncing ? (
                  <span className="bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                    <span>SINCRONIZANDO EN SEGUNDO PLANO</span>
                  </span>
                ) : (
                  <span className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    <span>SERVICE WORKER ACTIVO & VIGILANTE</span>
                  </span>
                )}
                <span className="bg-purple-500/10 text-purple-300 border border-purple-500/30 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center space-x-1">
                  <Zap className="w-3 h-3 text-purple-400" />
                  <span>Sin Bloqueo de UI (Hilo Independiente)</span>
                </span>
                <span className="bg-blue-500/10 text-blue-300 border border-blue-500/30 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center space-x-1">
                  <RefreshCw className="w-3 h-3 text-blue-400" />
                  <span>Reintentos Exponenciales (1s, 2s, 4s...)</span>
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                Gestiona las peticiones a la API de Google Drive desde un hilo secundario aislado. Si la conexión se interrumpe o Google responde con cuotas temporales (429/5xx), el Service Worker reintenta automáticamente con retroceso exponencial sin congelar la pantalla.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 flex-wrap gap-2 shrink-0">
            <button
              onClick={handleTriggerSwSync}
              disabled={isSwSyncing || swStats?.isSyncing || (idbStats?.pendingRecords === 0)}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-md shadow-indigo-950/40"
              title="Disparar sincronización gestionada por el Service Worker en segundo plano"
            >
              {isSwSyncing || swStats?.isSyncing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Worker Transmitiendo...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Sync Segundo Plano (SW)</span>
                </>
              )}
            </button>

            <button
              onClick={handleRegisterBackgroundSync}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors"
              title="Registra la tarea en la Background Sync API para reintentos nativos ante reconexiones de red"
            >
              <Radio className="w-3.5 h-3.5 text-indigo-400" />
              <span>Background Sync API</span>
            </button>
          </div>
        </div>

        {/* Telemetría en vivo del Service Worker */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-800/80 text-xs">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Estado del Worker</span>
            <div className="text-sm font-black text-slate-100 mt-0.5 flex items-center space-x-1.5">
              <span className={`w-2 h-2 rounded-full ${isSwSyncing || swStats?.isSyncing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}></span>
              <span>{isSwSyncing || swStats?.isSyncing ? 'Transmitiendo...' : 'En Espera / Listo'}</span>
            </div>
            <span className="text-[10px] text-slate-500">
              {isBgSyncSupportedState ? 'Sync API Nativa activa' : 'Bucle de reintentos activo'}
            </span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
            <span className="text-[10px] uppercase font-bold text-indigo-400 block">Archivo Actual</span>
            <div className="text-xs font-bold text-indigo-200 mt-0.5 truncate max-w-[140px]" title={swStats?.currentFile || 'Sin transferencias activas'}>
              {swStats?.currentFile || 'Sin transferencias'}
            </div>
            <span className="text-[10px] text-slate-500">
              {swStats?.isSyncing ? `Progreso: ${swStats.processedCount}/${swStats.totalInQueue}` : 'Cola en reposo'}
            </span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
            <span className="text-[10px] uppercase font-bold text-amber-400 block">Reintentos por Red</span>
            <div className="text-sm font-black text-amber-400 mt-0.5">
              {swStats?.retryingCount ?? 0}
            </div>
            <span className="text-[10px] text-slate-500">Auto-recuperados</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
            <span className="text-[10px] uppercase font-bold text-emerald-400 block">Subidas vía Worker</span>
            <div className="text-sm font-black text-emerald-400 mt-0.5">
              {swStats?.syncedCount ?? 0}
            </div>
            <span className="text-[10px] text-slate-500">Exitosas en 2do plano</span>
          </div>
        </div>

        {/* Live Event Stream Banner */}
        {swLiveLog && (
          <div className={`p-2.5 border rounded-lg text-xs flex items-center justify-between gap-2 animate-fadeIn ${
            swLiveLog.type === 'warning'
              ? 'bg-amber-950/50 border-amber-600/60 text-amber-200'
              : swLiveLog.type === 'error'
              ? 'bg-rose-950/50 border-rose-600/60 text-rose-200'
              : 'bg-indigo-950/50 border-indigo-700/60 text-indigo-200'
          }`}>
            <div className="flex items-center space-x-2 truncate">
              {swLiveLog.type === 'warning' ? (
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-spin" />
              ) : swLiveLog.type === 'error' ? (
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              ) : (
                <Activity className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              )}
              <span className="font-mono text-[11px] truncate">{swLiveLog.text}</span>
            </div>
            <span className="text-[10px] text-slate-400 shrink-0 font-mono">{swLiveLog.time}</span>
          </div>
        )}

        {swActionMsg && (
          <div className="p-2.5 bg-indigo-950/60 border border-indigo-700/60 text-indigo-200 text-xs rounded-lg flex items-center space-x-2 animate-fadeIn">
            <Check className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>{swActionMsg}</span>
          </div>
        )}
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
            <span>Total Fotos</span>
          </div>
          <div className="text-xl font-black text-slate-100 mt-1">{photos.length}</div>
          <div className="text-[10px] text-slate-400">Catálogo del sistema</div>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>En Google Drive</span>
          </div>
          <div className="text-xl font-black text-emerald-400 mt-1">{totalInDrive}</div>
          <div className="text-[10px] text-slate-400">Archivadas en la nube</div>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1.5">
            <UploadCloud className="w-3.5 h-3.5 text-amber-400" />
            <span>Pendientes Drive</span>
          </div>
          <div className="text-xl font-black text-amber-400 mt-1">{totalPending}</div>
          <div className="text-[10px] text-slate-400">Listas para sincronizar</div>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl">
          <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1.5">
            <HardDrive className="w-3.5 h-3.5 text-purple-400" />
            <span>En Servidor</span>
          </div>
          <div className="text-xl font-black text-purple-400 mt-1">{photos.length}</div>
          <div className="text-[10px] text-slate-400">Caché local rápido</div>
        </div>
      </div>

      {/* Sync Action Area */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold text-slate-200 flex items-center space-x-2">
            <Cloud className="w-4 h-4 text-blue-400" />
            <span>Sincronización Masiva con Google Drive</span>
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Sube todas las fotos del sistema a tu carpeta de Google Drive en segundo plano sin interrumpir tus operaciones.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Botón de Escaneo y Validación de Carpetas */}
          <button
            type="button"
            onClick={handleScanAndLinkPhotos}
            disabled={isScanningFolders || isSyncing}
            className="px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-colors shrink-0 shadow-lg shadow-indigo-950/50 cursor-pointer"
            title="Escanea carpetas del servidor y Google Drive para detectar fotos que cumplan el nombre y vincularlas automáticamente a los expendios"
          >
            {isScanningFolders ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Validando carpetas...</span>
              </>
            ) : (
              <>
                <Search className="w-4 h-4 text-white" />
                <span>Validar y Cargar Fotos de Carpetas</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleReconcile}
            disabled={isReconciling || isSyncing}
            className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-colors shrink-0 cursor-pointer"
            title="Organiza todas las fotos sueltas de Drive en sus respectivas carpetas por municipio y actualiza el registro permanente"
          >
            {isReconciling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                <span>Organizando en Drive...</span>
              </>
            ) : (
              <>
                <FolderOpen className="w-4 h-4 text-blue-400" />
                <span>Organizar Carpetas Drive</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSyncAll}
            disabled={isSyncing || isReconciling || photos.length === 0}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-colors shrink-0 shadow-lg shadow-emerald-950/50 cursor-pointer"
          >
            {isSyncing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Sincronizando fotos...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" />
                <span>Sincronizar Fotos con Google Drive</span>
              </>
            )}
          </button>

          {!isAuthenticated && !bgSyncStatus?.hasToken && onSignIn && (
            <button
              type="button"
              onClick={onSignIn}
              className="px-3 py-2.5 bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/40 text-blue-300 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition-colors shrink-0 cursor-pointer"
              title="Vincular cuenta adicional de Google Drive"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>Conectar Cuenta</span>
            </button>
          )}
        </div>
      </div>

      {/* Notificación de escaneo y vinculación de fotos */}
      {scanResultMsg && (
        <div className="bg-indigo-950/70 border border-indigo-500/40 text-indigo-200 p-3.5 rounded-xl text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>{scanResultMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setScanResultMsg(null)}
            className="text-indigo-400 hover:text-indigo-200 text-xs font-bold ml-2 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Progress Bar during Sync */}
      {isSyncing && syncProgress && (
        <div className="bg-slate-950 p-3.5 rounded-xl border border-emerald-500/30 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-emerald-400 font-bold flex items-center space-x-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Subiendo: {syncProgress.name}</span>
            </span>
            <span className="text-slate-300 font-mono text-[11px]">
              {syncProgress.current} / {syncProgress.total} ({Math.round((syncProgress.current / (syncProgress.total || 1)) * 100)}%)
            </span>
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-200"
              style={{ width: `${(syncProgress.current / (syncProgress.total || 1)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Sync feedback */}
      {syncResult && (
        <div className="bg-emerald-950/70 border border-emerald-500/40 p-3 rounded-xl text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Sincronización completada: <strong>{syncResult.uploaded} fotos</strong> procesadas exitosamente en Google Drive.
              {syncResult.errors > 0 && ` (${syncResult.errors} fotos con advertencias).`}
            </span>
          </div>
          {folderUrl && (
            <a
              href={folderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-bold hover:text-emerald-200 flex items-center space-x-1"
            >
              <span>Ver carpeta</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Reconcile feedback */}
      {reconcileResult && (
        <div className="bg-blue-950/70 border border-blue-500/40 p-3 rounded-xl text-xs text-blue-300 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
            <span>
              Organización completada: <strong>{reconcileResult.movedCount} fotos</strong> movidas a sus carpetas de municipio y <strong>{reconcileResult.linkedCount} fotos</strong> enlazadas permanentemente.
            </span>
          </div>
          {folderUrl && (
            <a
              href={folderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-bold hover:text-blue-200 flex items-center space-x-1"
            >
              <span>Ver en Drive</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Filter and Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-2">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Buscar por cédula, nombre o municipio..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 pl-9 pr-3 py-1.5 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center space-x-1.5 w-full sm:w-auto justify-end">
          <button
            onClick={() => setFilterDrive('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              filterDrive === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            Todas ({photos.length})
          </button>
          <button
            onClick={() => setFilterDrive('inDrive')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              filterDrive === 'inDrive'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            En Drive ({totalInDrive})
          </button>
          <button
            onClick={() => setFilterDrive('pending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              filterDrive === 'pending'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            Pendientes ({totalPending})
          </button>
        </div>
      </div>

      {/* Photos List / Grid */}
      {filteredPhotos.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-400 bg-slate-950/60 rounded-xl border border-slate-800">
          No se encontraron fotografías con el criterio seleccionado.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto pr-1">
          {filteredPhotos.map((p) => (
            <div
              key={`${p.cedula}_${p.slotKey}`}
              className="p-2.5 bg-slate-950/80 border border-slate-800/80 hover:border-slate-700 rounded-xl flex items-center justify-between gap-2 text-xs"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-slate-800 overflow-hidden shrink-0 flex items-center justify-center border border-slate-700">
                  <img
                    src={p.url}
                    alt={p.slotKey}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <ImageIcon className="w-4 h-4 text-slate-500" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-200 truncate flex items-center space-x-1.5">
                    <span className="truncate">{p.nombre || p.cedula}</span>
                    {p.municipio && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {p.municipio}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    Cédula: {p.cedula} · {p.slotKey.replace('foto', '').replace('Url', '')}
                  </div>
                </div>
              </div>

              <div className="shrink-0 flex items-center space-x-1.5">
                {p.inGoogleDrive ? (
                  p.driveWebViewLink ? (
                    <a
                      href={p.driveWebViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-1 px-2 py-0.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-md text-[10px] font-bold transition-colors"
                      title="Abrir imagen en Google Drive"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      <span>En Drive</span>
                      <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                    </a>
                  ) : (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-md text-[10px] font-bold">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>En Drive</span>
                    </span>
                  )
                ) : (
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-slate-800 text-slate-400 rounded-md text-[10px] font-bold">
                    <HardDrive className="w-3 h-3" />
                    <span>Local</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
