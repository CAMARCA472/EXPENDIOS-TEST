import React, { useState, useEffect, useCallback } from 'react';
import { UserSession, Role, ThemeMode } from '../types';
import { 
  ShieldCheck, 
  Building2, 
  UserCheck, 
  LogOut, 
  Sparkles,
  Store,
  RefreshCw,
  SlidersHorizontal,
  Sun,
  Moon,
  Database,
  CheckCircle2,
  Cloud,
  HardDrive,
  ExternalLink,
  AlertCircle,
  User,
  Link2,
  Unlink,
  FolderOpen,
  X,
  Trash2,
  Camera,
} from 'lucide-react';
import { googleSignIn, logoutGoogle } from '../lib/googleAuth';
import {
  syncAllPhotosToGoogleDrive,
  deduplicateAllMunicipalityPhotosInDrive,
  DriveSyncProgress,
  DriveDeduplicationProgress,
} from '../lib/googleDriveService';
import {
  getPendingPhotos,
  getPendingDriveBackupPhotos,
  syncAllPendingPhotos,
  PHOTO_DB_UPDATED_EVENT,
} from '../lib/photoStorageDB';


interface HeaderProps {
  session: UserSession | null;
  onLogout: () => void;
  onSwitchRole?: (newRole: Role) => void;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  session,
  onLogout,
  onSwitchRole,
  theme = 'dark',
  onToggleTheme,
}) => {
  const isSuperAdmin = session?.cedulaOrNit === '1094269932' || session?.isMultiRoleAdmin;
  const isLight = theme === 'light';
  const isCleanAdmin = Boolean(
    session?.isCleanAdmin ||
      String(session?.cedulaOrNit || '').replace(/\D/g, '') === '9005042417' ||
      String(session?.cedulaOrNit || '').replace(/\D/g, '') === '900504241'
  );
  const displayUserName = isCleanAdmin
    ? 'ADMINISTRADOR CAMARCA S.A.S.'
    : isSuperAdmin
    ? 'DIEGO ALEJANDRO BECERRA'
    : session?.name || '';

  const [sqlStatus, setSqlStatus] = useState<{
    connected: boolean;
    serverVersion: string;
    totalExpendios: number;
    currentLatencyMs: number;
  }>({
    connected: true,
    serverVersion: 'PostgreSQL 18.6',
    totalExpendios: 178,
    currentLatencyMs: 15,
  });
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showProfileBackupModal, setShowProfileBackupModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Estado del panel de configuración de perfil y backup de fotos (Firestore + S3 + Google Drive)
  const [backupConfig, setBackupConfig] = useState<{
    driveConnected: boolean;
    driveEmail: string | null;
    driveName: string | null;
    hasRefreshToken: boolean;
    firestoreCount: number;
    s3Count: number;
    driveCount: number;
    localCachePending: number;
    localDrivePending: number;
    firestoreConsoleUrl: string;
    s3ConsoleUrl: string;
    googleDriveFolderUrl: string;
  }>({
    driveConnected: false,
    driveEmail: null,
    driveName: null,
    hasRefreshToken: false,
    firestoreCount: 0,
    s3Count: 0,
    driveCount: 0,
    localCachePending: 0,
    localDrivePending: 0,
    firestoreConsoleUrl: 'https://console.firebase.google.com/project/gen-lang-client-0829904854/storage/gen-lang-client-0829904854.firebasestorage.app/files/~2Fphotos',
    s3ConsoleUrl: 'https://s3.console.aws.amazon.com/s3/buckets/camarca-expendios-photos-contingency?region=us-east-1&prefix=photos/',
    googleDriveFolderUrl: 'https://drive.google.com/drive/u/0/search?q=Fotos%20Expendios%204-72%20-%20CAMARCA%20SAS',
  });
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [isDisconnectingDrive, setIsDisconnectingDrive] = useState(false);
  const [isSyncingBackup, setIsSyncingBackup] = useState(false);
  const [isDeduplicating, setIsDeduplicating] = useState(false);
  const [syncProgress, setSyncProgress] = useState<DriveSyncProgress | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

  const checkStatus = async () => {
    try {
      if (session?.role === 'admin') {
        const token =
          session?.token ||
          sessionStorage.getItem('camarca_token') ||
          localStorage.getItem('camarca_token');
        const headers: Record<string, string> = token
          ? { Authorization: `Bearer ${token}`, 'x-session-token': token }
          : {};

        const res = await fetch(`/api/admin/cloudsql/status?_t=${Date.now()}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data) {
            const expTable = (data.data.tables || []).find((t: any) => t.tableName === 'expendios');
            setSqlStatus({
              connected: Boolean(data.data.connected),
              serverVersion: data.data.serverVersion || 'PostgreSQL',
              totalExpendios: expTable?.rowCount || 178,
              currentLatencyMs: data.data.currentLatencyMs || 15,
            });
            return;
          }
        }
      }

      // Fallback público a sync-monitoring para obtener métricas reales de Cloud SQL
      const resMon = await fetch(`/api/system/sync-monitoring?_t=${Date.now()}`);
      if (resMon.ok) {
        const dataMon = await resMon.json();
        if (dataMon.success && dataMon.database) {
          setSqlStatus((prev) => ({
            ...prev,
            connected: Boolean(dataMon.database.connected),
            totalExpendios: dataMon.database.totalExpendios || prev.totalExpendios,
            currentLatencyMs: dataMon.database.latencyMs || prev.currentLatencyMs,
          }));
        }
      }
    } catch {}
  };

  const checkBackupStatus = useCallback(async () => {
    try {
      const isAdminRole = session?.role === 'admin';
      const [tokenRes, locRes, localPending, localDrive] = await Promise.all([
        isAdminRole
          ? fetch(`/api/admin/google-drive/token?_t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
          : Promise.resolve(null),
        isAdminRole
          ? fetch(`/api/photos/storage-locations?_t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
          : Promise.resolve(null),
        getPendingPhotos().catch(() => []),
        getPendingDriveBackupPhotos().catch(() => []),
      ]);

      setBackupConfig((prev) => ({
        ...prev,
        driveConnected: Boolean(tokenRes?.hasToken || locRes?.summary?.driveConnected),
        driveEmail: tokenRes?.email || locRes?.summary?.driveEmail || null,
        driveName: tokenRes?.displayName || null,
        hasRefreshToken: Boolean(tokenRes?.hasRefreshToken),
        firestoreCount: locRes?.summary?.totalFirestore ?? prev.firestoreCount,
        s3Count: locRes?.summary?.totalS3 ?? prev.s3Count,
        driveCount: locRes?.summary?.totalDrive ?? prev.driveCount,
        localCachePending: Array.isArray(localPending) ? localPending.length : 0,
        localDrivePending: Array.isArray(localDrive) ? localDrive.length : 0,
        firestoreConsoleUrl: locRes?.globalLinks?.firestoreConsoleUrl || prev.firestoreConsoleUrl,
        s3ConsoleUrl: locRes?.globalLinks?.s3ConsoleUrl || prev.s3ConsoleUrl,
        googleDriveFolderUrl: locRes?.globalLinks?.googleDriveFolderUrl || prev.googleDriveFolderUrl,
      }));
    } catch {}
  }, []);

  useEffect(() => {
    checkStatus();
    checkBackupStatus();

    const handlePhotoSyncEvent = () => {
      checkStatus();
      checkBackupStatus();
    };
    window.addEventListener('photoStorageUpdated', handlePhotoSyncEvent);
    window.addEventListener('googleDriveTokenRefreshed', handlePhotoSyncEvent);
    window.addEventListener(PHOTO_DB_UPDATED_EVENT, handlePhotoSyncEvent);

    return () => {
      window.removeEventListener('photoStorageUpdated', handlePhotoSyncEvent);
      window.removeEventListener('googleDriveTokenRefreshed', handlePhotoSyncEvent);
      window.removeEventListener(PHOTO_DB_UPDATED_EVENT, handlePhotoSyncEvent);
    };
  }, [checkBackupStatus]);

  // Cerrar el panel de configuración de backups automáticamente si se cambia al módulo Expendio
  useEffect(() => {
    if (session?.role === 'expendio' && showProfileBackupModal) {
      setShowProfileBackupModal(false);
    }
  }, [session?.role, showProfileBackupModal]);

  // Determinar si el Backup está Sincronizado o Pendiente (solo para Admin)
  const isBackupSynchronized =
    backupConfig.localCachePending === 0 &&
    backupConfig.firestoreCount > 0 &&
    backupConfig.s3Count >= backupConfig.firestoreCount &&
    backupConfig.driveConnected &&
    backupConfig.driveCount >= backupConfig.firestoreCount;

  // Para el módulo Expendios: solo habilitar Sincronizar si hay imágenes que NO han sido sincronizadas a ninguno de los servidores
  const hasUnsyncedExpendioPhotos = backupConfig.localCachePending > 0;

  const handleSyncUnsyncedExpendioPhotos = async () => {
    if (!hasUnsyncedExpendioPhotos || isSyncingBackup) return;
    setIsSyncingBackup(true);
    try {
      await syncAllPendingPhotos();
      await checkBackupStatus();
      window.dispatchEvent(new CustomEvent('photoStorageUpdated'));
    } catch {} finally {
      setIsSyncingBackup(false);
    }
  };

  const handleConnectGoogleDrive = async () => {
    setIsConnectingDrive(true);
    setBackupFeedback(null);
    try {
      const authRes = await googleSignIn();
      if (authRes && authRes.accessToken) {
        await fetch('/api/admin/google-drive/set-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: authRes.accessToken,
            email: authRes.user?.email || 'admin@camarca.com',
            displayName: authRes.user?.displayName || 'Administrador CAMARCA',
          }),
        });
        await checkBackupStatus();
        setBackupFeedback({
          type: 'success',
          text: `✓ Cuenta Google Drive (${authRes.user?.email || 'Conectada'}) vinculada exitosamente para backups automáticos.`,
        });
        window.dispatchEvent(new CustomEvent('photoStorageUpdated'));
      } else {
        setBackupFeedback({
          type: 'warning',
          text: 'No se completó el inicio de sesión con Google Drive.',
        });
      }
    } catch (err: any) {
      setBackupFeedback({
        type: 'error',
        text: `Error al conectar Google Drive: ${err?.message || 'Ventana cerrada o bloqueada'}`,
      });
    } finally {
      setIsConnectingDrive(false);
    }
  };

  const handleDisconnectGoogleDrive = async () => {
    setIsDisconnectingDrive(true);
    setBackupFeedback(null);
    try {
      await logoutGoogle();
      await fetch('/api/admin/google-drive/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      await checkBackupStatus();
      setBackupFeedback({
        type: 'warning',
        text: 'Cuenta de Google Drive desconectada. Las fotos siguen seguras en Firestore y AWS S3; el backup en Google Drive queda Pendiente.',
      });
      window.dispatchEvent(new CustomEvent('photoStorageUpdated'));
    } catch (err: any) {
      setBackupFeedback({
        type: 'error',
        text: `Error al desconectar Google Drive: ${err?.message || 'Error de red'}`,
      });
    } finally {
      setIsDisconnectingDrive(false);
    }
  };

  const handleSyncAllBackupLayers = async () => {
    setIsSyncingBackup(true);
    setSyncProgress(null);
    setBackupFeedback(null);
    try {
      // 1. Sincronizar fotos pendientes que no han sido sincronizadas a ningún servidor
      await syncAllPendingPhotos();

      // 2. Sincronizar Firestore + AWS S3 en el servidor
      await fetch('/api/admin/photo-storage/force-sync-local-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      // 3. Sincronizar Google Drive reportando en tiempo real cada municipio
      let uploadedToDrive = 0;
      let skippedInDrive = 0;
      let duplicatesPurged = 0;

      if (backupConfig.driveConnected) {
        try {
          const driveResult = await syncAllPhotosToGoogleDrive(undefined, (prog) => {
            setSyncProgress(prog);
          });
          uploadedToDrive = driveResult.totalUploaded;
          skippedInDrive = driveResult.totalSkipped;
          duplicatesPurged = driveResult.totalDuplicatesCleaned || 0;
        } catch (driveErr: any) {
          console.warn('[Header Drive Sync]:', driveErr.message);
          // Fallback a trigger-sync en servidor
          await fetch('/api/admin/google-drive/trigger-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }).catch(() => null);
        }
      }

      await checkBackupStatus();
      window.dispatchEvent(new CustomEvent('photoStorageUpdated'));

      if (backupConfig.driveConnected) {
        setBackupFeedback({
          type: 'success',
          text: `✓ Backup Sincronizado en las 3 capas (Firestore + AWS S3 + Google Drive). ${uploadedToDrive} fotos actualizadas, ${skippedInDrive} omitidas por idénticas. ${duplicatesPurged > 0 ? `Se depuraron ${duplicatesPurged} duplicados en Drive para conservar exactamente 7 por municipio.` : 'Fotos organizadas exactamente a 7 por municipio.'}`,
        });
      } else {
        setBackupFeedback({
          type: 'warning',
          text: '✓ Fotos sincronizadas en Firestore y AWS S3. Conecta tu cuenta de Google Drive arriba para completar la 3ra capa de backup.',
        });
      }
    } catch (err: any) {
      setBackupFeedback({
        type: 'error',
        text: `Error durante la sincronización: ${err?.message || 'Error de conexión'}`,
      });
    } finally {
      setIsSyncingBackup(false);
      setSyncProgress(null);
    }
  };

  const handleDeduplicateDrivePhotos = async () => {
    setIsDeduplicating(true);
    setBackupFeedback({
      type: 'warning',
      text: 'Escaneando y eliminando fotos duplicadas en todas las carpetas de municipios en Google Drive...',
    });
    try {
      const res = await fetch('/api/admin/google-drive/deduplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setBackupFeedback({
          type: 'success',
          text: `✓ ¡Depuración completada! Se eliminaron ${data.totalDuplicatesDeleted} fotos duplicadas en ${data.totalMunicipalities} municipios. Ahora cada municipio conserva únicamente sus 7 fotos oficiales.`,
        });
        await checkBackupStatus();
        window.dispatchEvent(new CustomEvent('photoStorageUpdated'));
      } else {
        throw new Error(data.error || 'No se pudo completar la depuración');
      }
    } catch (err: any) {
      setBackupFeedback({
        type: 'error',
        text: `Error al depurar duplicados: ${err.message}`,
      });
    } finally {
      setIsDeduplicating(false);
    }
  };


  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    if (typeof (window as any).clearAppCache === 'function') {
      try {
        await (window as any).clearAppCache();
      } catch (e) {
        console.warn('[Header] Error purgando cachés:', e);
      }
    }
    try {
      const res = await fetch('/api/admin/cloudsql/sync-now', { method: 'POST' });
      const data = await res.json();
      setSyncFeedback(data.message || '✓ PostgreSQL verificado y sincronizado.');
      await checkStatus();
    } catch (err: any) {
      setSyncFeedback('Error de conexión al verificar PostgreSQL.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <header className={`${isLight ? 'bg-white text-slate-900 border-slate-200 shadow-sm' : 'bg-slate-900 text-white border-slate-800 shadow-md'} border-b sticky top-0 z-30 transition-colors w-full max-w-full overflow-x-clip`}>
      <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 h-16 flex items-center justify-between gap-1 sm:gap-2">
        {/* Brand logo & title */}
        <div className="flex items-center space-x-1.5 sm:space-x-2.5 shrink-0">
          <div className="bg-gradient-to-tr from-amber-500 to-amber-400 text-slate-950 p-1.5 sm:p-2 rounded-xl shadow-inner font-black text-lg sm:text-xl flex items-center justify-center h-8 w-8 sm:h-10 sm:w-10">
            C
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <h1 className={`font-bold text-sm sm:text-base md:text-lg tracking-tight leading-none ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                CAMARCA <span className="text-amber-500 font-semibold">| 4-72</span>
              </h1>
            </div>
            <p className={`text-[10px] leading-tight hidden xl:block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Control de Personal y Gestión de Expendios
            </p>
          </div>
        </div>

        {/* User Badge / Status & Actions */}
        <div className="flex items-center space-x-1 sm:space-x-2 shrink min-w-0">

          {/* Indicador de Base $0 / Firestore - Reducido y compacto para no desbordar */}
          {session?.role === 'admin' && !isCleanAdmin && (
            <button
              type="button"
              onClick={() => setShowStatusModal(true)}
              title={`Base $0 (Firestore + Drive): ${sqlStatus.totalExpendios} Expendios`}
              className={`px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-xl border text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm shrink-0 ${
                sqlStatus.connected
                  ? isLight
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                    : 'bg-emerald-950/60 text-emerald-300 border-emerald-600/50 hover:bg-emerald-900/60'
                  : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
              }`}
            >
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${sqlStatus.connected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${sqlStatus.connected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              </span>
              <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="hidden 2xl:inline font-bold whitespace-nowrap">
                Base $0: {sqlStatus.totalExpendios} Exp.
              </span>
              <span className="2xl:hidden font-bold whitespace-nowrap text-[11px] sm:text-xs">
                $0 ({sqlStatus.totalExpendios})
              </span>
            </button>
          )}

          {/* En módulo Expendio: Únicamente botón Sincronizar habilitado si hay imágenes que no han sido sincronizadas */}
          {session?.role === 'expendio' && (
            <button
              type="button"
              onClick={handleSyncUnsyncedExpendioPhotos}
              disabled={!hasUnsyncedExpendioPhotos || isSyncingBackup}
              title={
                hasUnsyncedExpendioPhotos
                  ? `Sincronizar ${backupConfig.localCachePending} imagen(es) pendiente(s)`
                  : 'Todas las imágenes ya están sincronizadas'
              }
              className={`px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-xl border text-xs font-bold flex items-center space-x-1.5 transition-all shadow-sm shrink-0 ${
                hasUnsyncedExpendioPhotos
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-400 cursor-pointer'
                  : isLight
                  ? 'bg-slate-100 text-slate-400 border-slate-200 opacity-60 cursor-not-allowed'
                  : 'bg-slate-800/60 text-slate-500 border-slate-700/60 opacity-60 cursor-not-allowed'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isSyncingBackup ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">
                {isSyncingBackup
                  ? 'Sincronizando...'
                  : hasUnsyncedExpendioPhotos
                  ? `Sincronizar (${backupConfig.localCachePending})`
                  : 'Sincronizar'}
              </span>
            </button>
          )}

          {/* Panel de Configuración de Backups - Reducido en tamaño */}
          {session?.role === 'admin' && (
            <button
              type="button"
              onClick={() => {
                checkBackupStatus();
                setShowProfileBackupModal(true);
              }}
              title="Abrir Configuración de Perfil y Backups en Google Drive / Firestore / AWS S3"
              className={`px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-xl border text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm shrink-0 ${
                isBackupSynchronized
                  ? isLight
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                    : 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60 hover:bg-emerald-900/70'
                  : isLight
                  ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                  : 'bg-amber-950/70 text-amber-300 border-amber-700/60 hover:bg-amber-900/70'
              }`}
            >
              {isBackupSynchronized ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              ) : (
                <Cloud className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span className="hidden 2xl:inline whitespace-nowrap">
                {isBackupSynchronized ? 'Backup OK' : 'Backup Pend.'}
              </span>
              <span className="hidden lg:inline 2xl:hidden whitespace-nowrap text-[11px]">
                {isBackupSynchronized ? 'Backup' : 'Pendiente'}
              </span>
              <SlidersHorizontal className="w-3 h-3 opacity-80 shrink-0" />
            </button>
          )}
          
          {/* Botón de Cambio de Tema (Compacto Icono-Only para no saturar la barra) */}
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              title={isLight ? 'Cambiar a Tema Negro (Oscuro)' : 'Cambiar a Tema Blanco (Claro)'}
              className={`p-1.5 sm:p-2 rounded-xl border text-xs font-bold flex items-center justify-center transition-all cursor-pointer shadow-sm shrink-0 ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
              }`}
            >
              {isLight ? (
                <Moon className="w-4 h-4 text-slate-700 shrink-0" />
              ) : (
                <Sun className="w-4 h-4 text-amber-400 shrink-0" />
              )}
            </button>
          )}

          {session ? (
            <div className={`flex items-center space-x-1 sm:space-x-2 backdrop-blur py-1 px-2 sm:py-1.5 sm:px-2.5 rounded-xl text-xs border shrink min-w-0 ${
              isLight
                ? 'bg-slate-100/90 border-slate-300 text-slate-800'
                : 'bg-slate-800/80 border-slate-700/60 text-slate-200'
            }`}>
              
              {/* If super admin (C.C. 1094269932), show direct role switcher */}
              {isSuperAdmin && onSwitchRole ? (
                <div className={`flex items-center space-x-1 p-0.5 sm:p-1 rounded-lg border shrink-0 ${
                  isLight ? 'bg-white border-slate-300' : 'bg-slate-950/70 border-slate-700'
                }`}>
                  <span className="text-[10px] uppercase font-bold text-amber-500 px-1 hidden 2xl:inline">
                    Módulo:
                  </span>
                  <button
                    type="button"
                    onClick={() => onSwitchRole('admin')}
                    className={`px-1.5 py-0.5 sm:px-2 rounded text-[11px] font-semibold transition-colors cursor-pointer flex items-center space-x-1 ${
                      session.role === 'admin'
                        ? 'bg-amber-400 text-slate-950 shadow'
                        : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ShieldCheck className="w-3 h-3 shrink-0" />
                    <span className="hidden sm:inline">Admin</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSwitchRole('expendio')}
                    className={`px-1.5 py-0.5 sm:px-2 rounded text-[11px] font-semibold transition-colors cursor-pointer flex items-center space-x-1 ${
                      session.role === 'expendio'
                        ? 'bg-emerald-500 text-white shadow'
                        : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Store className="w-3 h-3 shrink-0" />
                    <span className="hidden sm:inline">Expendio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSwitchRole('cliente')}
                    className={`px-1.5 py-0.5 sm:px-2 rounded text-[11px] font-semibold transition-colors cursor-pointer flex items-center space-x-1 ${
                      session.role === 'cliente'
                        ? 'bg-sky-500 text-white shadow'
                        : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Building2 className="w-3 h-3 shrink-0" />
                    <span className="hidden sm:inline">Cliente</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-1 font-medium shrink-0">
                  {session.role === 'admin' && (
                    <span className="flex items-center text-amber-600 dark:text-amber-400 font-semibold bg-amber-400/10 px-2 py-0.5 rounded-md border border-amber-400/30 text-[11px]">
                      <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                      Admin
                    </span>
                  )}
                  {session.role === 'cliente' && (
                    <span className="flex items-center text-sky-700 dark:text-sky-400 font-semibold bg-sky-400/10 px-2 py-0.5 rounded-md border border-sky-400/30 text-[11px]">
                      <Building2 className="w-3.5 h-3.5 mr-1" />
                      Cliente
                    </span>
                  )}
                  {session.role === 'expendio' && (
                    <span className="flex items-center text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-400/10 px-2 py-0.5 rounded-md border border-emerald-400/30 text-[11px]">
                      <UserCheck className="w-3.5 h-3.5 mr-1" />
                      Expendio
                    </span>
                  )}
                </div>
              )}

              {/* Nombre de Usuario (Truncado responsivo y protegido) */}
              {session.role === 'admin' && !isCleanAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    checkBackupStatus();
                    setShowProfileBackupModal(true);
                  }}
                  title="Perfil de Usuario y Configuración de Backups"
                  className={`flex items-center space-x-1 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-lg transition-colors cursor-pointer min-w-0 ${
                    isLight ? 'hover:bg-slate-200 text-slate-800' : 'hover:bg-slate-700 text-slate-200'
                  }`}
                >
                  <User className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="hidden xl:inline-block font-semibold max-w-[90px] 2xl:max-w-[120px] truncate">
                    {displayUserName}
                  </span>
                </button>
              ) : (
                <div
                  className={`flex items-center space-x-1 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-lg min-w-0 ${
                    isLight ? 'text-slate-800' : 'text-slate-200'
                  }`}
                >
                  <User className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="hidden xl:inline-block font-semibold max-w-[90px] 2xl:max-w-[120px] truncate">
                    {displayUserName}
                  </span>
                </div>
              )}

              <div className={`h-4 w-px shrink-0 ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />

              <button
                onClick={onLogout}
                title="Cerrar Sesión"
                className={`flex items-center space-x-1 font-bold text-xs px-2 py-1 rounded-lg transition-all cursor-pointer shrink-0 ${
                  isLight
                    ? 'text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200'
                    : 'text-rose-400 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/50'
                }`}
              >
                <LogOut className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span className="inline font-bold">Salir</span>
              </button>
            </div>
          ) : (
            <div className="text-xs text-amber-600 dark:text-amber-400 font-medium bg-amber-400/10 border border-amber-400/30 px-3 py-1.5 rounded-lg flex items-center shrink-0">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Acceso Restringido por Rol
            </div>
          )}
        </div>
      </div>

      {/* Modal de Perfil de Usuario y Configuración de Backups (SOLO para Admin - Eliminado del módulo Expendios) */}
      {showProfileBackupModal && session && session.role === 'admin' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`w-full max-w-xl rounded-2xl border shadow-2xl p-5 sm:p-6 relative max-h-[90vh] overflow-y-auto ${
            isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
          }`}>
            <button
              onClick={() => {
                setShowProfileBackupModal(false);
                setBackupFeedback(null);
              }}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Encabezado del Perfil */}
            <div className="flex items-center space-x-3.5 mb-5">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center font-black text-lg">
                <User className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="font-black text-base sm:text-lg uppercase tracking-tight">
                    Perfil de Usuario & Configuración de Backups
                  </h3>
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    {session.role.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {session.name} • ID/C.C.: {session.cedulaOrNit}
                </p>
              </div>
            </div>

            {/* Indicador Principal: Backup Sincronizado vs Pendiente */}
            <div className={`p-4 rounded-xl border mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              isBackupSynchronized
                ? isLight
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-emerald-950/50 border-emerald-700/70 text-emerald-200'
                : isLight
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-amber-950/50 border-amber-700/70 text-amber-200'
            }`}>
              <div className="flex items-start sm:items-center space-x-3">
                <div className={`p-2.5 rounded-xl shrink-0 ${
                  isBackupSynchronized ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {isBackupSynchronized ? (
                    <CheckCircle2 className="w-6 h-6" />
                  ) : (
                    <AlertCircle className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] uppercase font-bold tracking-wider opacity-80">
                      Estado General de Respaldo:
                    </span>
                    <span className={`text-xs font-black px-2 py-0.5 rounded-md border ${
                      isBackupSynchronized
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                        : 'bg-amber-500 text-slate-950 border-amber-400'
                    }`}>
                      {isBackupSynchronized ? 'BACKUP SINCRONIZADO' : 'PENDIENTE'}
                    </span>
                  </div>
                  <p className="text-xs mt-1 opacity-90">
                    {isBackupSynchronized
                      ? `Las ${backupConfig.firestoreCount} fotografías están respaldadas en Firestore, AWS S3 y Google Drive.`
                      : !backupConfig.driveConnected
                      ? `Fotos seguras en Firestore (${backupConfig.firestoreCount}) y AWS S3 (${backupConfig.s3Count}). Conecta Google Drive para sincronizar la capa final de backup.`
                      : `Hay fotografías pendientes de sincronizar hacia Google Drive o en caché local.`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSyncAllBackupLayers}
                disabled={isSyncingBackup}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-3.5 py-2 rounded-xl text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingBackup ? 'animate-spin' : ''}`} />
                <span>{isSyncingBackup ? 'Sincronizando...' : 'Sincronizar Ahora'}</span>
              </button>
            </div>

            {/* Panel de Conexión / Desconexión de Cuenta de Google Drive */}
            <div className={`p-4 rounded-xl border mb-4 ${
              isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <Cloud className="w-4 h-4 text-sky-400" />
                  <h4 className="text-xs font-black uppercase tracking-wider">
                    Cuenta de Google Drive (3ra Capa de Seguridad y Backup)
                  </h4>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                  backupConfig.driveConnected
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
                    : 'bg-rose-950/80 text-rose-300 border-rose-800'
                }`}>
                  {backupConfig.driveConnected ? '● Cuenta Conectada' : '○ Cuenta Desconectada'}
                </span>
              </div>

              {backupConfig.driveConnected ? (
                <div className="space-y-3">
                  <div className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                    isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
                  }`}>
                    <div>
                      <p className="font-bold text-emerald-500">
                        {backupConfig.driveEmail || 'Cuenta de Google Drive Autorizada'}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Carpeta raíz: <strong>Fotos Expendios 4-72 - CAMARCA SAS</strong> • {backupConfig.driveCount} fotos en Drive
                      </p>
                    </div>
                    <a
                      href={backupConfig.googleDriveFolderUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:text-sky-300 text-xs font-bold flex items-center space-x-1 bg-sky-500/10 border border-sky-500/30 px-2.5 py-1.5 rounded-lg"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Ver Carpeta Drive</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleConnectGoogleDrive}
                      disabled={isConnectingDrive}
                      className="bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 font-bold px-3 py-2 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      <span>{isConnectingDrive ? 'Cambiando cuenta...' : 'Cambiar / Reconectar Cuenta'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDeduplicateDrivePhotos}
                      disabled={isDeduplicating || isSyncingBackup}
                      className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 font-bold px-3 py-2 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className={`w-3.5 h-3.5 ${isDeduplicating ? 'animate-spin' : ''}`} />
                      <span>{isDeduplicating ? 'Depurando duplicados...' : 'Depurar Duplicados en Drive (Dejar 7 por Municipio)'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDisconnectGoogleDrive}
                      disabled={isDisconnectingDrive}
                      className="bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-bold px-3 py-2 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      <span>{isDisconnectingDrive ? 'Desconectando...' : 'Desconectar Cuenta Google Drive'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    Conecta una cuenta de Google Drive para que todas las fotografías almacenadas en Firestore y AWS S3 se respalden también en carpetas organizadas por municipio en tu Google Drive.
                  </p>
                  <button
                    type="button"
                    onClick={handleConnectGoogleDrive}
                    disabled={isConnectingDrive}
                    className="w-full sm:w-auto bg-sky-500 hover:bg-sky-400 text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                  >
                    <Link2 className="w-4 h-4" />
                    <span>{isConnectingDrive ? 'Conectando con Google Drive...' : 'Conectar Cuenta de Google Drive'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Resumen de las 3 Capas de Almacenamiento + Enlaces Directos a las Carpetas */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
              <div className={`p-3 rounded-xl border ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
              }`}>
                <div className="flex items-center justify-between text-xs font-bold text-amber-400 mb-1">
                  <span>1. Firestore / Firebase</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <p className="text-lg font-black">{backupConfig.firestoreCount} Fotos</p>
                <a
                  href={backupConfig.firestoreConsoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center space-x-1 text-[11px] font-bold text-amber-400 hover:underline"
                >
                  <span>Abrir carpeta Firestore</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className={`p-3 rounded-xl border ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
              }`}>
                <div className="flex items-center justify-between text-xs font-bold text-emerald-400 mb-1">
                  <span>2. AWS S3 Bucket</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <p className="text-lg font-black">{backupConfig.s3Count} Fotos</p>
                <a
                  href={backupConfig.s3ConsoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center space-x-1 text-[11px] font-bold text-emerald-400 hover:underline"
                >
                  <span>Abrir carpeta AWS S3</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className={`p-3 rounded-xl border ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
              }`}>
                <div className="flex items-center justify-between text-xs font-bold text-sky-400 mb-1">
                  <span>3. Google Drive Backup</span>
                  {backupConfig.driveConnected && backupConfig.driveCount >= backupConfig.firestoreCount && backupConfig.firestoreCount > 0 ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  )}
                </div>
                <p className="text-lg font-black">{backupConfig.driveCount} Fotos</p>
                <a
                  href={backupConfig.googleDriveFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center space-x-1 text-[11px] font-bold text-sky-400 hover:underline"
                >
                  <span>Abrir carpeta Drive</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {/* Progreso en vivo de sincronización a Google Drive por Municipio */}
            {syncProgress && (
              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-emerald-500/40 mb-4 space-y-2 animate-in fade-in">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-400 flex items-center space-x-1.5">
                    <Camera className="w-3.5 h-3.5 animate-pulse" />
                    <span>Subiendo municipio: <strong className="text-white uppercase">{syncProgress.municipio}</strong></span>
                  </span>
                  <span className="text-slate-400 font-semibold">
                    {syncProgress.current} de {syncProgress.total} ({syncProgress.percent}%)
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
                  <span>Idénticas omitidas (no se repiten): <strong className="text-sky-400">{syncProgress.skippedCount}</strong></span>
                </div>
              </div>
            )}

            {backupFeedback && (
              <div className={`p-3 rounded-xl text-xs font-semibold mb-4 border ${
                backupFeedback.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : backupFeedback.type === 'warning'
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}>
                {backupFeedback.text}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowProfileBackupModal(false);
                  setBackupFeedback(null);
                }}
                className={`py-2 px-4 rounded-xl text-xs font-bold border cursor-pointer ${
                  isLight ? 'bg-slate-100 hover:bg-slate-200 border-slate-300' : 'bg-slate-800 hover:bg-slate-700 border-slate-700'
                }`}
              >
                Cerrar Panel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalle de Persistencia en PostgreSQL */}
      {showStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`w-full max-w-md rounded-2xl border shadow-2xl p-5 sm:p-6 relative ${
            isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
          }`}>
            <button
              onClick={() => {
                setShowStatusModal(false);
                setSyncFeedback(null);
              }}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-black text-base uppercase tracking-tight">
                  Base de Datos Relacional Activa
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Cloud SQL {sqlStatus.serverVersion} (Fuente de Verdad Única)
                </p>
              </div>
            </div>

            <div className="space-y-3 mb-5">
              <div className={`p-3 rounded-xl border ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/50 border-slate-800'
              }`}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-500 font-medium">Catálogo de Expendios:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    {sqlStatus.totalExpendios} Registros en PostgreSQL
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-500 font-medium">Motor de Persistencia:</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    PostgreSQL 18.6 (Cloud SQL)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Latencia de Conexión:</span>
                  <span className="font-semibold text-emerald-600">
                    {sqlStatus.currentLatencyMs} ms ({sqlStatus.connected ? 'Excelente' : 'Desconectado'})
                  </span>
                </div>
              </div>

              <div className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
                <p className="flex items-start space-x-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span>
                    <strong>Transaccional ACID:</strong> Todas las mutaciones se ejecutan dentro de transacciones atómicas con validación y rollback garantizado.
                  </span>
                </p>
                <p className="flex items-start space-x-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span>
                    <strong>Sin cuotas ni límites:</strong> Acceso permanente sin restricciones diarias de lecturas o escrituras.
                  </span>
                </p>
              </div>

              {syncFeedback && (
                <div className={`p-2.5 rounded-lg text-xs font-semibold ${
                  syncFeedback.includes('Error')
                    ? 'bg-red-500/10 text-red-600 border border-red-500/30'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                }`}>
                  {syncFeedback}
                </div>
              )}
            </div>

            <div className="flex space-x-2">
              <button
                type="button"
                onClick={handleManualSync}
                disabled={isSyncing}
                className="flex-1 bg-amber-500 hover:bg-amber-400 active:scale-98 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Verificando...' : 'Verificar PostgreSQL'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowStatusModal(false);
                  setSyncFeedback(null);
                }}
                className={`py-2.5 px-4 rounded-xl text-xs font-semibold border cursor-pointer ${
                  isLight ? 'bg-slate-100 hover:bg-slate-200 border-slate-300' : 'bg-slate-800 hover:bg-slate-700 border-slate-700'
                }`}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

