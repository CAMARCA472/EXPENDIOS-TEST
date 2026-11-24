import React, { useState, useEffect } from 'react';
import {
  HardDrive,
  PlayCircle,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Camera,
  Layers,
  Lock,
  Trash2,
} from 'lucide-react';
import { getAccessToken, connectGoogleOAuth2Offline } from '../lib/googleAuth';
import {
  syncAllPhotosToGoogleDrive,
  deduplicateAllMunicipalityPhotosInDrive,
  PHOTOS_FOLDER_NAME,
  getOrCreatePhotosFolder,
  DriveSyncProgress,
  DriveDeduplicationProgress,
} from '../lib/googleDriveService';

export const GoogleDriveAutoBackupCard: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [isDeduplicating, setIsDeduplicating] = useState(false);
  const [syncProgress, setSyncProgress] = useState<DriveSyncProgress | null>(null);
  const [feedback, setFeedback] = useState<{ type: string; msg: string } | null>(null);
  const [showCredentialsConfig, setShowCredentialsConfig] = useState(false);
  const [customClientId, setCustomClientId] = useState('');
  const [customClientSecret, setCustomClientSecret] = useState('');
  const [savingCredentials, setSavingCredentials] = useState(false);

  const [accountInfo, setAccountInfo] = useState<{
    connected: boolean;
    hasRefreshToken: boolean;
    email: string | null;
    displayName: string | null;
  }>({
    connected: false,
    hasRefreshToken: false,
    email: null,
    displayName: null,
  });

  const [syncStatus, setSyncStatus] = useState<{
    synced: number;
    pending: number;
    total: number;
    lastSyncTime?: string;
    folderId?: string;
  }>({
    synced: 0,
    pending: 0,
    total: 0,
  });

  const fetchStatus = async () => {
    try {
      const [tokenRes, statusRes] = await Promise.all([
        fetch('/api/admin/google-drive/token?_t=' + Date.now()),
        fetch('/api/admin/google-drive/sync-status?_t=' + Date.now()).catch(() => null),
      ]);

      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        setAccountInfo({
          connected: Boolean(tokenData.hasToken || tokenData.hasRefreshToken),
          hasRefreshToken: Boolean(tokenData.hasRefreshToken),
          email: tokenData.email || null,
          displayName: tokenData.displayName || null,
        });

        if (tokenData.googleOAuthClientId) {
          setCustomClientId(tokenData.googleOAuthClientId);
        }
        if (tokenData.googleOAuthClientSecret) {
          setCustomClientSecret(tokenData.googleOAuthClientSecret);
        }
      }

      if (statusRes && statusRes.ok) {
        const syncData = await statusRes.json();
        setSyncStatus({
          synced: syncData.syncedPhotosCount || 0,
          pending: syncData.pendingPhotosCount || 0,
          total: syncData.totalLocalPhotos || 0,
          lastSyncTime: syncData.lastSyncTimestamp,
        });
      }
    } catch (err: any) {
      console.warn('[GoogleDriveCard] Error al consultar estado:', err.message);
    }
  };

  const handleSaveOAuthCredentials = async () => {
    setSavingCredentials(true);
    setFeedback({ type: 'info', msg: 'Guardando credenciales de Google OAuth...' });
    try {
      const res = await fetch('/api/admin/config/oauth-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleOAuthClientId: customClientId,
          googleOAuthClientSecret: customClientSecret,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFeedback({
          type: 'success',
          msg: '✓ Credenciales Google OAuth guardadas y aplicadas de forma segura en PostgreSQL con éxito.',
        });
        await fetchStatus();
      } else {
        throw new Error(data.message || 'Fallo al guardar en el servidor');
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: `Error guardando credenciales: ${err.message}` });
    } finally {
      setSavingCredentials(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleConnectOffline = async () => {
    setConnecting(true);
    setFeedback({ type: 'info', msg: 'Iniciando autorización OAuth 2.0 Offline con Google...' });
    try {
      const res = await connectGoogleOAuth2Offline();
      if (res.success && res.accessToken) {
        setFeedback({
          type: 'success',
          msg: '¡Conexión permanente establecida con éxito! El Refresh Token quedó persistido de forma segura en PostgreSQL.',
        });
        await fetchStatus();
      } else {
        throw new Error(res.error || 'No se completó la vinculación con Google Drive');
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: `Error de conexión: ${err.message}` });
    } finally {
      setConnecting(false);
    }
  };

  const handleSyncPhotosNow = async () => {
    setLoading(true);
    setSyncProgress(null);
    setFeedback({ type: 'info', msg: 'Iniciando sincronización de fotografías a Google Drive...' });
    try {
      let token = await getAccessToken();
      const res = await syncAllPhotosToGoogleDrive(token || undefined, (progress) => {
        setSyncProgress(progress);
        setFeedback({
          type: 'info',
          msg: `Subiendo a Google Drive: ${progress.municipio.toUpperCase()} (${progress.slotTitle}) • ${progress.current} de ${progress.total} (${progress.percent}%)`,
        });
      });
      setFeedback({
        type: 'success',
        msg: `¡Sincronización finalizada con éxito! ${res.totalUploaded} fotos actualizadas, ${res.totalSkipped} idénticas omitidas. ${res.totalDuplicatesCleaned ? `Se eliminaron ${res.totalDuplicatesCleaned} fotos duplicadas para conservar 7 por municipio.` : 'Fotos organizadas exactamente a 7 por municipio.'}`,
      });
      await fetchStatus();
    } catch (err: any) {
      setFeedback({ type: 'error', msg: `Error en sincronización: ${err.message}` });
    } finally {
      setLoading(false);
      setSyncProgress(null);
    }
  };

  const handleDeduplicatePhotosNow = async () => {
    setIsDeduplicating(true);
    setFeedback({ type: 'info', msg: 'Escaneando y eliminando fotos duplicadas en todas las carpetas de municipios en Google Drive...' });
    try {
      const res = await fetch('/api/admin/google-drive/deduplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFeedback({
          type: 'success',
          msg: `✓ ¡Depuración exitosa! Se eliminaron ${data.totalDuplicatesDeleted} fotos duplicadas en ${data.totalMunicipalities} municipios. Ahora cada municipio conserva únicamente sus 7 fotos oficiales.`,
        });
        await fetchStatus();
      } else {
        throw new Error(data.error || 'No se pudo completar la depuración');
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: `Error en depuración: ${err.message}` });
    } finally {
      setIsDeduplicating(false);
    }
  };


  const handleOpenFolder = async () => {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('No hay sesión de Google activa');
      const folder = await getOrCreatePhotosFolder(token);
      if (folder?.webViewLink) {
        window.open(folder.webViewLink, '_blank', 'noopener,noreferrer');
      } else if (folder?.id) {
        window.open(`https://drive.google.com/drive/folders/${folder.id}`, '_blank', 'noopener,noreferrer');
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: `No se pudo abrir la carpeta: ${err.message}` });
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
      {/* Encabezado */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3 text-blue-400">
          <div className="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20">
            <HardDrive className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
              <span>Tercer Respaldo Automático — Google Drive</span>
              <span className="text-[10px] bg-blue-500/20 text-blue-300 font-bold px-2 py-0.5 rounded-full">
                Exclusivo Fotografías
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Almacenamiento terciario en la nube organizado por municipios bajo OAuth 2.0 Offline.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 text-xs font-semibold">
          {accountInfo.connected ? (
            <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Conectado Permanente</span>
            </span>
          ) : (
            <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-full">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Requiere Autorización Inicial</span>
            </span>
          )}
        </div>
      </div>

      {/* Regla de Arquitectura */}
      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/80 flex items-start space-x-3 text-xs text-slate-300">
        <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
        <div className="space-y-1 text-[11px] leading-relaxed">
          <p>
            <strong>Regla Crítica del Sistema:</strong> Google Drive opera exclusivamente como{' '}
            <span className="text-emerald-400 font-semibold">Tercer Respaldo Automático de Fotografías</span>. La base
            de datos, cuentas y registros maestros residen en PostgreSQL (Fuente de Verdad).
          </p>
          <p className="text-slate-400 text-[10px]">
            Estructura Oficial en Drive: <code className="text-slate-200">{PHOTOS_FOLDER_NAME}/&#123;Municipio&#125;/</code>
          </p>
        </div>
      </div>

      {/* Tarjeta de Estado de Cuenta */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1.5">
            <span className="font-semibold text-slate-300">Cuenta de Google Vinculada</span>
            <Lock className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="font-bold text-slate-100 truncate">
            {accountInfo.email || (accountInfo.connected ? 'Cuenta Conectada' : 'Sin vincular')}
          </div>
          <div className="text-[10px] text-slate-400 mt-1 flex items-center space-x-1">
            <span>Refresh Token en PostgreSQL:</span>
            <span className={accountInfo.hasRefreshToken ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
              {accountInfo.hasRefreshToken ? '✓ Configurado y Activo' : 'Pendiente'}
            </span>
          </div>
        </div>

        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1.5">
            <span className="font-semibold text-slate-300">Estado de Sincronización</span>
            <Camera className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-base font-black text-emerald-400">{syncStatus.synced}</span>
            <span className="text-slate-400 text-[11px]">fotos respaldadas en Google Drive</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {syncStatus.pending > 0 ? (
              <span className="text-amber-400 font-bold">{syncStatus.pending} fotos pendientes en cola</span>
            ) : (
              <span className="text-slate-400">Cola de respaldo al día (0 pendientes)</span>
            )}
          </div>
        </div>
      </div>

      {/* Configuración de Credenciales de Google Cloud OAuth */}
      <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800/80 space-y-3">
        <button
          type="button"
          onClick={() => setShowCredentialsConfig(!showCredentialsConfig)}
          className="w-full flex items-center justify-between text-xs text-slate-300 font-bold hover:text-white transition-colors cursor-pointer focus:outline-none"
        >
          <div className="flex items-center space-x-2">
            <Lock className="w-3.5 h-3.5 text-blue-400" />
            <span>Configurar Credenciales Propias (GCP OAuth Client)</span>
          </div>
          <span className="text-blue-400 font-bold text-[11px] hover:underline">
            {showCredentialsConfig ? 'Ocultar' : 'Configurar'}
          </span>
        </button>

        {showCredentialsConfig && (
          <div className="space-y-3 pt-2.5 border-t border-slate-800/80 text-xs">
            <p className="text-[11px] text-slate-400 leading-normal">
              Para habilitar la vinculación automática y renovación en segundo plano sin errores, configure el{' '}
              <strong>ID de Cliente</strong> y la <strong>Clave Secreta (Client Secret)</strong> de la aplicación{' '}
              OAuth de tipo "Web Application" creada en su Google Cloud Console. El URI de redirección debe ser{' '}
              <code>postmessage</code> o la URL actual.
            </p>

            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                  ID de Cliente (Client ID)
                </label>
                <input
                  type="text"
                  value={customClientId}
                  onChange={(e) => setCustomClientId(e.target.value)}
                  placeholder="ID de cliente de Google Cloud Console..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                  Clave Secreta de Cliente (Client Secret)
                </label>
                <input
                  type="password"
                  value={customClientSecret}
                  onChange={(e) => setCustomClientSecret(e.target.value)}
                  placeholder="Clave secreta de Google Cloud Console..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveOAuthCredentials}
              disabled={savingCredentials}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-2 px-3.5 rounded-xl flex items-center justify-center space-x-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{savingCredentials ? 'Guardando...' : 'Guardar Credenciales'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Barra de progreso de carga en tiempo real por municipios */}
      {syncProgress && (
        <div className="bg-slate-950 p-3.5 rounded-xl border border-emerald-500/30 space-y-2 animate-in fade-in">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-emerald-400 flex items-center space-x-1.5">
              <Camera className="w-3.5 h-3.5 animate-pulse" />
              <span>Municipio: <strong className="text-white uppercase">{syncProgress.municipio}</strong></span>
            </span>
            <span className="text-slate-400 font-semibold">
              {syncProgress.current} de {syncProgress.total} fotos ({syncProgress.percent}%)
            </span>
          </div>
          <div className="text-[11px] text-slate-300 flex items-center justify-between">
            <span>Foto: <strong>{syncProgress.slotTitle}</strong></span>
            <span className="text-[10px] text-slate-400 truncate max-w-[200px]">{syncProgress.photoName}</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-emerald-500 to-teal-400 h-2 rounded-full transition-all duration-200"
              style={{ width: `${syncProgress.percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>Fotos subidas: <strong className="text-emerald-400">{syncProgress.uploadedCount}</strong></span>
            <span>Idénticas omitidas: <strong className="text-sky-400">{syncProgress.skippedCount}</strong></span>
          </div>
        </div>
      )}

      {/* Retroalimentación */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : feedback.type === 'error'
              ? 'bg-red-500/10 text-red-300 border-red-500/30'
              : 'bg-blue-500/10 text-blue-300 border-blue-500/30'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* Botones de Acción */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
        <button
          type="button"
          onClick={handleConnectOffline}
          disabled={connecting || loading}
          className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${connecting ? 'animate-spin' : ''}`} />
          <span>{accountInfo.connected ? 'Reconectar OAuth 2.0' : 'Vincular Google Drive'}</span>
        </button>

        <button
          type="button"
          onClick={handleSyncPhotosNow}
          disabled={loading || connecting || !accountInfo.connected}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
        >
          <PlayCircle className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Sincronizando...' : 'Sincronizar Fotos'}</span>
        </button>

        <button
          type="button"
          onClick={handleOpenFolder}
          disabled={!accountInfo.connected}
          className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Abrir en Drive</span>
        </button>

        <button
          type="button"
          onClick={handleDeduplicatePhotosNow}
          disabled={isDeduplicating || loading || !accountInfo.connected}
          className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 font-bold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50 sm:col-span-3"
        >
          <Trash2 className={`w-3.5 h-3.5 ${isDeduplicating ? 'animate-spin' : ''}`} />
          <span>{isDeduplicating ? 'Depurando Duplicados en Drive...' : 'Depurar y Eliminar Duplicados en Drive (Dejar 7 por Municipio)'}</span>
        </button>
      </div>
    </div>
  );
};
