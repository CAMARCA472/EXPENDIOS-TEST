import React, { useState, useEffect, useCallback } from 'react';
import {
  Cloud,
  RefreshCw,
  Upload,
  Download,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  KeyRound,
} from 'lucide-react';
import { ExpendioData } from '../types';
import {
  syncAllPhotosToGoogleDrive,
  restorePhotosFromGoogleDrive,
} from '../lib/googleDriveService';
import { getAccessToken, googleSignIn } from '../lib/googleAuth';

const getValidGoogleDriveToken = () => getAccessToken();
const requestGoogleDriveToken = async (): Promise<string | null> => {
  const res = await googleSignIn();
  return res?.accessToken || getAccessToken();
};

interface GoogleDrivePhotoBackupModuleProps {
  expendios: ExpendioData[];
  onUpdateExpendio?: (updated: ExpendioData) => void;
  onRefreshExpendios?: () => void;
}

interface DriveRegistryEntry {
  cedula: string;
  slotKey: string;
  driveFileId: string;
  webViewLink?: string;
  webContentLink?: string;
  fileName?: string;
  folderName?: string;
  municipio?: string;
  savedAt?: string;
}

export const GoogleDrivePhotoBackupModule: React.FC<GoogleDrivePhotoBackupModuleProps> = ({
  onRefreshExpendios,
}) => {
  const [isSyncingToDrive, setIsSyncingToDrive] = useState(false);
  const [isReloadingFromDrive, setIsReloadingFromDrive] = useState(false);
  const [isConnectingOAuth, setIsConnectingOAuth] = useState(false);
  const [progressText, setProgressText] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'warning' | 'error' | 'info';
    message: string;
  } | null>(null);

  const [backedUpCount, setBackedUpCount] = useState<number>(0);
  const [driveConfiguredOnServer, setDriveConfiguredOnServer] = useState<boolean>(false);
  const [hasClientToken, setHasClientToken] = useState<boolean>(false);
  const [driveRootFolderUrl, setDriveRootFolderUrl] = useState<string>(
    'https://drive.google.com/drive/u/0/search?q=Fotos%20Expendios%204-72%20-%20CAMARCA%20SAS'
  );

  const fetchDriveStatus = useCallback(async () => {
    try {
      const token = getValidGoogleDriveToken();
      setHasClientToken(Boolean(token));

      const [regRes, statusRes, locRes] = await Promise.all([
        fetch(`/api/photos/google-drive-registry?_t=${Date.now()}`, { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => null),
        fetch(`/api/admin/google-drive/status?_t=${Date.now()}`, { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => null),
        fetch(`/api/photos/storage-locations?_t=${Date.now()}`, { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => null),
      ]);

      if (regRes?.success && regRes.registry) {
        const entries = Object.values(regRes.registry) as DriveRegistryEntry[];
        const uniqueKeys = new Set<string>();
        for (const entry of entries) {
          if (!entry || !entry.driveFileId) continue;
          uniqueKeys.add(`${entry.folderName || entry.municipio || entry.cedula}_${entry.slotKey}`);
        }
        setBackedUpCount(uniqueKeys.size);
      }
      if (statusRes) {
        setDriveConfiguredOnServer(Boolean(statusRes.connected || statusRes.hasRefreshToken));
      }
      if (locRes?.globalLinks?.googleDriveFolderUrl) {
        setDriveRootFolderUrl(locRes.globalLinks.googleDriveFolderUrl);
      }
    } catch {
      // Ignore transient errors
    }
  }, []);

  useEffect(() => {
    fetchDriveStatus();
  }, [fetchDriveStatus]);

  const handleConnectGoogleDrive = async () => {
    setIsConnectingOAuth(true);
    setStatusBanner(null);
    try {
      const token = await requestGoogleDriveToken();
      if (token) {
        setHasClientToken(true);
        setStatusBanner({
          type: 'success',
          message: 'Cuenta de Google Drive autorizada correctamente.',
        });
      }
    } catch (err: any) {
      setStatusBanner({
        type: 'warning',
        message:
          err?.message ||
          'No se completó la autorización emergente. Se utilizará la sincronización del servidor.',
      });
    } finally {
      setIsConnectingOAuth(false);
    }
  };

  const handleSyncPhotosToGoogleDrive = async () => {
    if (isSyncingToDrive || isReloadingFromDrive) return;
    setIsSyncingToDrive(true);
    setStatusBanner(null);
    setProgressPercent(10);
    setProgressText('Preparando respaldo hacia Google Drive...');

    try {
      let syncedCount = 0;

      setProgressPercent(25);
      setProgressText('Sincronizando fotografías desde el servidor hacia Google Drive...');
      const serverSyncRes = await fetch('/api/admin/google-drive/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
        .then((r) => r.json())
        .catch(() => null);

      if (serverSyncRes?.success) {
        syncedCount += Number(serverSyncRes.uploaded || 0) + Number(serverSyncRes.skipped || 0);
      }

      let token = await getValidGoogleDriveToken();
      if (!token && !serverSyncRes?.success) {
        try {
          setProgressText('Solicitando autorización de Google Drive...');
          token = await requestGoogleDriveToken();
          setHasClientToken(Boolean(token));
        } catch {
          // Continuar con reconciliación de servidor
        }
      }

      if (token) {
        setProgressPercent(50);
        const clientResult = await syncAllPhotosToGoogleDrive(
          token,
          (current, total, photoName) => {
            setProgressText(`Subiendo (${current}/${total}): ${photoName}`);
            if (total > 0) {
              setProgressPercent(Math.min(95, 40 + Math.round((current / total) * 55)));
            }
          }
        );
        syncedCount = Math.max(syncedCount, clientResult.totalUploaded);
      }

      setProgressPercent(95);
      setProgressText('Verificando registro de respaldo...');
      const recRes = await fetch('/api/admin/google-drive/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
        .then((r) => r.json())
        .catch(() => null);

      await fetchDriveStatus();
      if (onRefreshExpendios) onRefreshExpendios();

      setProgressPercent(100);
      const totalBackedUp = recRes?.reconciledCount || backedUpCount || syncedCount;
      setStatusBanner({
        type: 'success',
        message: `Sincronización completada: ${totalBackedUp} fotografías respaldadas en Google Drive.`,
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: `Error al sincronizar con Google Drive: ${err?.message || 'Error inesperado'}`,
      });
    } finally {
      setIsSyncingToDrive(false);
      setTimeout(() => {
        setProgressText('');
        setProgressPercent(0);
      }, 2500);
    }
  };

  const handleReloadPhotosFromGoogleDrive = async () => {
    if (isReloadingFromDrive || isSyncingToDrive) return;
    setIsReloadingFromDrive(true);
    setStatusBanner(null);
    setProgressPercent(15);
    setProgressText('Consultando respaldo de Google Drive...');

    try {
      let restoredTotal = 0;

      const token = await getValidGoogleDriveToken();
      if (token) {
        setProgressPercent(35);
        const restoreRes = await restorePhotosFromGoogleDrive(
          token,
          (current, total, fileName) => {
            setProgressText(`Restaurando (${current}/${total}): ${fileName}`);
            if (total > 0) {
              setProgressPercent(Math.min(75, 25 + Math.round((current / total) * 50)));
            }
          }
        );
        restoredTotal += restoreRes.restoredCount;
      }

      setProgressPercent(85);
      setProgressText('Vinculando fotografías en el sistema...');
      const [reconcileRes, scanRes] = await Promise.all([
        fetch('/api/admin/google-drive/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
          .then((r) => r.json())
          .catch(() => null),
        fetch('/api/admin/photos/scan-and-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
          .then((r) => r.json())
          .catch(() => null),
      ]);

      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          await window.caches.delete('camarca-verified-photos-v2');
        } catch {}
      }

      await fetchDriveStatus();
      if (onRefreshExpendios) onRefreshExpendios();

      setProgressPercent(100);
      const totalLinked =
        restoredTotal ||
        reconcileRes?.reconciledCount ||
        scanRes?.linkedPhotosCount ||
        backedUpCount;

      setStatusBanner({
        type: 'success',
        message: `Fotografías cargadas exitosamente desde Google Drive (${totalLinked} imágenes vinculadas).`,
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: `Error al cargar fotos desde Google Drive: ${err?.message || 'Error de conexión'}`,
      });
    } finally {
      setIsReloadingFromDrive(false);
      setTimeout(() => {
        setProgressText('');
        setProgressPercent(0);
      }, 2500);
    }
  };

  const isConnected = backedUpCount > 0 || driveConfiguredOnServer || hasClientToken;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left: Clean title & unboxed metadata */}
        <div className="flex items-start space-x-3.5 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-sky-400 shrink-0 mt-0.5">
            <Cloud className="w-5 h-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm sm:text-base font-semibold text-slate-100 tracking-tight">
              Respaldo Fotográfico en Google Drive
            </h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 tabular-nums">
              <span className={isConnected ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                {backedUpCount} fotografías respaldadas
              </span>
              <span aria-hidden="true">·</span>
              <span>Organización automática por municipio</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-500 font-mono text-[11px]">
                &#123;Municipio&#125;_&#123;TipoFoto&#125;_&#123;DDMMAAAA&#125;.jpg
              </span>
            </div>
          </div>
        </div>

        {/* Right: Primary & secondary controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSyncPhotosToGoogleDrive}
            disabled={isSyncingToDrive || isReloadingFromDrive}
            className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-xs flex items-center space-x-2 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            title="Sincronizar fotografías hacia Google Drive"
          >
            <Upload className={`w-3.5 h-3.5 shrink-0 ${isSyncingToDrive ? 'animate-bounce' : ''}`} />
            <span>
              {isSyncingToDrive ? 'Sincronizando...' : 'Sincronizar a Google Drive'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleReloadPhotosFromGoogleDrive}
            disabled={isReloadingFromDrive || isSyncingToDrive}
            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 border border-slate-700 font-semibold py-2 px-4 rounded-lg text-xs flex items-center space-x-2 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            title="Cargar y restaurar fotografías desde Google Drive en caso necesario"
          >
            <Download className={`w-3.5 h-3.5 text-emerald-400 shrink-0 ${isReloadingFromDrive ? 'animate-bounce' : ''}`} />
            <span>
              {isReloadingFromDrive ? 'Cargando fotos...' : 'Cargar desde Google Drive'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleConnectGoogleDrive}
            disabled={isConnectingOAuth || isSyncingToDrive || isReloadingFromDrive}
            className="bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 font-medium py-2 px-3 rounded-lg text-xs flex items-center space-x-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            title="Conectar o renovar autorización de Google Drive"
          >
            <KeyRound className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{hasClientToken ? 'Cuenta Conectada' : 'Conectar Cuenta'}</span>
          </button>

          <a
            href={driveRootFolderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 font-medium py-2 px-3 rounded-lg text-xs flex items-center space-x-1.5 transition-colors whitespace-nowrap shrink-0"
            title="Abrir carpeta principal en Google Drive"
          >
            <FolderOpen className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>Abrir Drive</span>
            <ExternalLink className="w-3 h-3 text-slate-500 shrink-0" />
          </a>
        </div>
      </div>

      {/* Progress Bar */}
      {(isSyncingToDrive || isReloadingFromDrive || progressPercent > 0) && (
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-300 tabular-nums">
            <div className="flex items-center space-x-2 min-w-0">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400 shrink-0" />
              <span className="truncate">{progressText || 'Procesando operación en Google Drive...'}</span>
            </div>
            <span className="font-mono text-sky-400 shrink-0 ml-2">{progressPercent}%</span>
          </div>
          <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-sky-500 h-full transition-all duration-200 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Status Notification */}
      {statusBanner && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-3 ${
            statusBanner.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : statusBanner.type === 'warning'
              ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
              : statusBanner.type === 'error'
              ? 'bg-rose-950/40 border-rose-800/60 text-rose-200'
              : 'bg-sky-950/40 border-sky-800/60 text-sky-200'
          }`}
        >
          <div className="flex items-center space-x-2 min-w-0">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span className="truncate">{statusBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-slate-400 hover:text-slate-200 text-[11px] underline shrink-0 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
};
