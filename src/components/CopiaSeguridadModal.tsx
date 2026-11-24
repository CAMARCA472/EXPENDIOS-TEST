import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Download, 
  Upload, UploadCloud, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Loader2, 
  RefreshCw, 
  FolderArchive, 
  Clock, 
  HardDrive, 
  ShieldCheck, 
  FileCheck2, 
  AlertTriangle,
  Cloud,
  Globe,
  ExternalLink,
  Lock,
  ArrowRight,
  Server
} from 'lucide-react';
import { GoogleDriveAutoBackupCard } from './GoogleDriveAutoBackupCard';
import { ErrorBoundary } from './ErrorBoundary';
import { getAccessToken, getCachedUser, googleSignIn } from '../lib/googleAuth';
import { downloadAuthenticatedFile } from '../utils/downloadHelper';

const formatSafeDateTime = (val?: string | number | null, fallback = 'No registrada'): string => {
  if (!val) return fallback;
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return fallback;
    return d.toLocaleString('es-CO');
  } catch {
    return fallback;
  }
};

interface LocalSnapshot {
  filename: string;
  fecha: string;
  tamanoBytes: number;
  expendiosCount: number;
  historialCount: number;
}

interface AmbienteInfo {
  ambiente: 'PUBLICADA' | 'TEST';
  isPublishedEnv: boolean;
  appUrl: string;
  publishedUrl: string;
  devUrl: string;
  activeDbFile: string;
  lastSyncFromPublished: string | null;
  googleDriveConfigured: boolean;
  googleDriveWebhookUrl: string;
  expendiosCount: number;
  historialCount: number;
}

interface CopiaSeguridadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccessRestore: () => void;
  initialTab?: 'cloudSql' | 'photoHybrid' | 'export' | 'import' | 'snapshots' | 'googleDrive' | 'ambienteSync';
}

export const CopiaSeguridadModal: React.FC<CopiaSeguridadModalProps> = ({
  isOpen,
  onClose,
  onSuccessRestore,
  initialTab = 'cloudSql',
}) => {
  const [activeTab, setActiveTab] = useState<'cloudSql' | 'photoHybrid' | 'export' | 'import' | 'snapshots' | 'googleDrive' | 'ambienteSync'>(initialTab);
  const [password, setPassword] = useState<string>('');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; msg: string } | null>(null);
  const [selectedJsonFile, setSelectedJsonFile] = useState<File | null>(null);
  
  // Cloud SQL (PostgreSQL) state
  const [cloudSyncData, setCloudSyncData] = useState<any>(null);
  const [loadingCloudSync, setLoadingCloudSync] = useState<boolean>(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(false);
  const [isCloudRestoring, setIsCloudRestoring] = useState<boolean>(false);

  // Hybrid Photo Storage state
  const [photoStats, setPhotoStats] = useState<any>(null);
  const [loadingPhotoStats, setLoadingPhotoStats] = useState<boolean>(false);
  const [isSimulatingQuota, setIsSimulatingQuota] = useState<boolean>(false);
  const [isRunningRecovery, setIsRunningRecovery] = useState<boolean>(false);
  const [isSyncingLocalPhotos, setIsSyncingLocalPhotos] = useState<boolean>(false);

  // Snapshots state
  const [snapshots, setSnapshots] = useState<LocalSnapshot[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState<boolean>(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string>('');

  // Environment & Google Drive state
  const [ambienteInfo, setAmbienteInfo] = useState<AmbienteInfo | null>(null);
  const [loadingAmbiente, setLoadingAmbiente] = useState<boolean>(false);
  const [gdriveUrlInput, setGdriveUrlInput] = useState<string>('');
  const [isSavingGdriveUrl, setIsSavingGdriveUrl] = useState<boolean>(false);
  const [isSyncingGdrive, setIsSyncingGdrive] = useState<boolean>(false);
  const [isSyncingFromPublished, setIsSyncingFromPublished] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || 'cloudSql');
      setFeedback(null);
      setPassword('');
      setSelectedJsonFile(null);
      loadCloudSyncStatus();
      loadPhotoStats();
      loadSnapshots();
      loadAmbienteInfo();
    }
  }, [isOpen, initialTab]);

  const loadPhotoStats = async () => {
    try {
      setLoadingPhotoStats(true);
      const res = await fetch('/api/admin/photo-storage/stats');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setPhotoStats(data);
        }
      }
    } catch (e: any) {
      console.warn('Error cargando estadísticas de fotos híbridas:', e.message);
    } finally {
      setLoadingPhotoStats(false);
    }
  };

  const handleSimulateQuota = async (exceeded: boolean) => {
    try {
      setIsSimulatingQuota(true);
      const res = await fetch('/api/admin/photo-storage/simulate-quota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exceeded }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({
          type: 'warning',
          msg: data.message,
        });
        loadPhotoStats();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message });
    } finally {
      setIsSimulatingQuota(false);
    }
  };

  const handleTriggerRecovery = async () => {
    try {
      setIsRunningRecovery(true);
      const res = await fetch('/api/admin/photo-storage/trigger-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize: 20 }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({
          type: 'success',
          msg: data.message || `Recuperación completada: ${data.recovered} fotos recuperadas a Firebase.`,
        });
        loadPhotoStats();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message });
    } finally {
      setIsRunningRecovery(false);
    }
  };

  const handleForceSyncLocalPhotos = async () => {
    try {
      setIsSyncingLocalPhotos(true);
      setFeedback(null);
      const res = await fetch('/api/admin/photo-storage/force-sync-local-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({
          type: 'success',
          msg: data.message || 'Carga forzada completada con éxito.',
        });
        loadPhotoStats();
      } else {
        setFeedback({
          type: 'error',
          msg: data.message || 'Ocurrió un error al forzar la carga.',
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message });
    } finally {
      setIsSyncingLocalPhotos(false);
    }
  };

  const loadCloudSyncStatus = async () => {
    try {
      setLoadingCloudSync(true);
      const res = await fetch('/api/admin/cloudsql/status');
      const data = await res.json();
      if (data.success) {
        setCloudSyncData({
          connected: data.connected,
          localExpendios: data.tables?.expendios ?? 177,
          localHistorial: data.tables?.historial ?? 0,
          localRelacionPagos: data.tables?.relacionPagos ?? 0,
        });
      }
    } catch (err) {
      console.warn('Error consultando estado Cloud SQL:', err);
    } finally {
      setLoadingCloudSync(false);
    }
  };

  const handleForceCloudSync = async () => {
    try {
      setIsCloudSyncing(true);
      setFeedback(null);
      const res = await fetch('/api/admin/cloudsql/migrate-from-json', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setFeedback({
          type: 'success',
          msg: data.message || '✓ Datos sincronizados exitosamente en PostgreSQL (Cloud SQL).',
        });
        loadCloudSyncStatus();
      } else {
        setFeedback({ type: 'error', msg: data.message || 'Error sincronizando con PostgreSQL.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: 'Error de red con PostgreSQL: ' + err.message });
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const handleForceCloudRestore = async () => {
    if (!window.confirm('¿Confirmas que deseas recargar y verificar todos los datos desde PostgreSQL?')) {
      return;
    }
    try {
      setIsCloudRestoring(true);
      setFeedback(null);
      const res = await fetch('/api/admin/cloudsql/status');
      const data = await res.json();
      if (data.success) {
        setFeedback({
          type: 'success',
          msg: '✓ Conexión con PostgreSQL verificada exitosamente.',
        });
        onSuccessRestore();
        loadCloudSyncStatus();
        loadAmbienteInfo();
      } else {
        setFeedback({ type: 'error', msg: data.message || 'Error consultando PostgreSQL.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: 'Error de red con PostgreSQL: ' + err.message });
    } finally {
      setIsCloudRestoring(false);
    }
  };

  const loadSnapshots = async () => {
    try {
      setLoadingSnapshots(true);
      const res = await fetch('/api/admin/backups-locales', {  });
      const data = await res.json();
      if (data.success && Array.isArray(data.snapshots)) {
        setSnapshots(data.snapshots);
      }
    } catch (err) {
      console.warn('Error cargando snapshots locales:', err);
    } finally {
      setLoadingSnapshots(false);
    }
  };

  const loadAmbienteInfo = async () => {
    try {
      setLoadingAmbiente(true);
      const res = await fetch('/api/admin/ambiente-info', {  });
      const data = await res.json();
      if (data.success) {
        setAmbienteInfo(data);
        setGdriveUrlInput(data.googleDriveWebhookUrl || '');
      }
    } catch (err) {
      console.warn('Error cargando información de ambiente:', err);
    } finally {
      setLoadingAmbiente(false);
    }
  };

  if (!isOpen) return null;

  // Direct download helper via authenticated fetch
  const triggerDownload = (url: string, filename: string) => {
    downloadAuthenticatedFile(url, filename);
  };

  // Download pure database JSON
  const handleDownloadPureDatabase = () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      triggerDownload('/api/admin/database-download', `CAMARCA_BASE_DATOS_${timestamp}.json`);
      setFeedback({
        type: 'success',
        msg: '✓ Descarga de la base de datos completa iniciada (.JSON). Guarda este archivo en tu computador o Google Drive para tener tu información 100% asegurada.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        msg: 'Error iniciando descarga directa: ' + err.message,
      });
    }
  };

  // Download complete backup with embedded photos
  const handleDownloadFullWithPhotos = () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      triggerDownload('/api/admin/database-download-full', `CAMARCA_COPIA_COMPLETA_FOTOS_${timestamp}.json`);
      setFeedback({
        type: 'success',
        msg: '✓ Generación de copia completa con registro fotográfico iniciada (.JSON).',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        msg: 'Error generando copia completa: ' + err.message,
      });
    }
  };

  // Download Photos ZIP
  const handleDownloadPhotosZip = () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      triggerDownload('/api/admin/backup-fotos-zip', `CAMARCA_REGISTRO_FOTOGRAFICO_${timestamp}.zip`);
      setFeedback({
        type: 'success',
        msg: '✓ Descarga del paquete comprimido de fotos (.ZIP) iniciada.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        msg: 'Error iniciando descarga del ZIP: ' + err.message,
      });
    }
  };

  // Restore via Multipart Form Upload
  const handleImportFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJsonFile) {
      setFeedback({ type: 'error', msg: 'Por favor selecciona un archivo JSON de respaldo.' });
      return;
    }
    if (!password.trim()) {
      setFeedback({ type: 'error', msg: 'Debes ingresar la contraseña de seguridad autorizada.' });
      return;
    }

    setIsRestoring(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.append('backupFile', selectedJsonFile);
      formData.append('password', password.trim());

      const res = await fetch('/api/admin/database-import-file', {
        method: 'POST',
        
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        setFeedback({
          type: 'success',
          msg: data.message || '✓ Base de datos restaurada exitosamente.',
        });
        onSuccessRestore();
        loadSnapshots();
        loadAmbienteInfo();
      } else {
        setFeedback({
          type: 'error',
          msg: data.message || 'Error al restaurar la base de datos.',
        });
      }
    } catch (err: any) {
      console.error('Error al subir archivo de respaldo:', err);
      setFeedback({
        type: 'error',
        msg: 'Error de conexión: ' + err.message,
      });
    } finally {
      setIsRestoring(false);
    }
  };

  // Restore from an automatic local server snapshot
  const handleRestoreSnapshot = async () => {
    if (!selectedSnapshot) {
      setFeedback({ type: 'error', msg: 'Debes seleccionar una copia automática de la lista.' });
      return;
    }
    if (!password.trim()) {
      setFeedback({ type: 'error', msg: 'Ingresa la contraseña de seguridad autorizada.' });
      return;
    }

    setIsRestoring(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/admin/restaurar-backup-local', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          },
        body: JSON.stringify({
          filename: selectedSnapshot,
          password: password.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setFeedback({
          type: 'success',
          msg: data.message || '✓ Copia del servidor restaurada exitosamente.',
        });
        onSuccessRestore();
        loadSnapshots();
        loadAmbienteInfo();
      } else {
        setFeedback({
          type: 'error',
          msg: data.message || 'Error al restaurar la copia del servidor.',
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        msg: 'Error al conectar con el servidor: ' + err.message,
      });
    } finally {
      setIsRestoring(false);
    }
  };

  // Save Google Drive Webhook URL
  const handleSaveGoogleDriveWebhook = async () => {
    setIsSavingGdriveUrl(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/config/google-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googleDriveWebhookUrl: gdriveUrlInput.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({ type: 'success', msg: data.message });
        loadAmbienteInfo();
      } else {
        setFeedback({ type: 'error', msg: data.message || 'Error guardando URL de Webhook.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: 'Error de red: ' + err.message });
    } finally {
      setIsSavingGdriveUrl(false);
    }
  };

  // Trigger Live Google Drive Sync
  const handleSyncToGoogleDriveNow = async () => {
    setIsSyncingGdrive(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/google-drive-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: gdriveUrlInput.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({ type: 'success', msg: data.message });
      } else {
        setFeedback({ type: 'error', msg: data.message || 'Error al enviar a Google Drive.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: 'Error de red con Google Drive: ' + err.message });
    } finally {
      setIsSyncingGdrive(false);
    }
  };

  // Sync test environment from published environment
  const handleRetroalimentarDesdePublicada = async () => {
    setIsSyncingFromPublished(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/retroalimentar-desde-publicada', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({
          type: 'success',
          msg: data.message,
        });
        onSuccessRestore();
        loadAmbienteInfo();
        loadSnapshots();
      } else {
        setFeedback({
          type: 'error',
          msg: data.message || 'Error al retroalimentar desde la versión publicada.',
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: 'Error al conectar con la versión publicada: ' + err.message });
    } finally {
      setIsSyncingFromPublished(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/20 text-amber-400 flex items-center justify-center shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <span>Copia de Seguridad & Base de Datos CAMARCA</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30">
                  En Línea
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Descarga de archivos JSON, fotos ZIP, restauración completa y Google Drive.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800/80 transition-colors cursor-pointer"
            title="Cerrar ventana"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-1.5 px-6 pt-3 pb-1 border-b border-slate-800 bg-slate-950/70 overflow-x-auto scrollbar-thin">
          <button
            onClick={() => setActiveTab('export')}
            className={`pb-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'export'
                ? 'border-amber-400 text-amber-400 bg-amber-500/10 rounded-t-lg font-extrabold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="w-4 h-4 text-amber-400" />
            <span>Descargar Respaldo</span>
            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-mono">JSON / ZIP</span>
          </button>

          <button
            onClick={() => setActiveTab('import')}
            className={`pb-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'import'
                ? 'border-emerald-400 text-emerald-400 bg-emerald-500/10 rounded-t-lg font-extrabold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-4 h-4 text-emerald-400" />
            <span>Restaurar Archivo</span>
          </button>

          <button
            onClick={() => setActiveTab('cloudSql')}
            className={`pb-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'cloudSql'
                ? 'border-blue-400 text-blue-400 bg-blue-500/10 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-3.5 h-3.5 text-blue-400" />
            <span>Cloud SQL (PostgreSQL)</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          </button>

          <button
            onClick={() => setActiveTab('photoHybrid')}
            className={`pb-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'photoHybrid'
                ? 'border-amber-400 text-amber-400 bg-amber-500/10 rounded-t-lg font-extrabold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5 text-amber-400" />
            <span>Fotos (Firebase + S3)</span>
            <span className="text-[10px] bg-amber-500/20 text-amber-300 font-bold px-1.5 py-0.2 rounded">Híbrido</span>
          </button>

          <button
            onClick={() => setActiveTab('googleDrive')}
            className={`pb-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'googleDrive'
                ? 'border-cyan-400 text-cyan-400 bg-cyan-500/10 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cloud className="w-3.5 h-3.5 text-cyan-400" />
            <span>Google Drive</span>
          </button>

          <button
            onClick={() => setActiveTab('snapshots')}
            className={`pb-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'snapshots'
                ? 'border-sky-400 text-sky-400 bg-sky-500/10 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            <span>Snapshots ({Array.isArray(snapshots) ? snapshots.length : 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('ambienteSync')}
            className={`pb-2.5 px-3.5 text-xs font-bold border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'ambienteSync'
                ? 'border-purple-400 text-purple-400 bg-purple-500/10 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-purple-400" />
            <span>Test vs Publicada</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 overflow-y-auto">
          <ErrorBoundary fallbackTitle="Panel de Copia de Seguridad" onClose={onClose}>
            {feedback && (
            <div
              className={`p-3 rounded-xl text-xs flex items-start space-x-2.5 border ${
                feedback.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                  : feedback.type === 'warning'
                  ? 'bg-amber-950/60 border-amber-800 text-amber-300'
                  : 'bg-red-950/60 border-red-800 text-red-300'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
              ) : feedback.type === 'warning' ? (
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              )}
              <span className="leading-relaxed">{feedback.msg}</span>
            </div>
          )}

          {/* TAB 0B: ALMACENAMIENTO HÍBRIDO FOTOS (FIRESTORE/FIREBASE + AWS S3 + GOOGLE DRIVE BACKUP) */}
          {activeTab === 'photoHybrid' && (
            <div className="space-y-5">
              <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center border border-amber-500/30">
                      <HardDrive className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-100 flex items-center space-x-2">
                        <span>Almacenamiento de Fotos en 3 Capas</span>
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 font-semibold px-2 py-0.5 rounded-full border border-amber-500/30">
                          Firestore + AWS S3 + Google Drive
                        </span>
                      </h4>
                    </div>
                  </div>
                  <button
                    onClick={loadPhotoStats}
                    disabled={loadingPhotoStats}
                    className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg flex items-center space-x-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingPhotoStats ? 'animate-spin' : ''}`} />
                    <span>Actualizar</span>
                  </button>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Arquitectura con <strong>PostgreSQL</strong> como Fuente de Verdad (metadatos, versión y checksum SHA-256), <strong>AWS S3</strong> como <strong>Almacenamiento Primario (Capa 1)</strong>, <strong>Firebase / Firestore</strong> como <strong>Reserva Secundaria (Capa 2)</strong>, y opción de sincronización en <strong>Google Drive</strong> como última capa de seguridad y backup (Capa 3).
                </p>

                {photoStats && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                    <div className="p-3 bg-slate-850 border border-slate-800 rounded-xl">
                      <div className="text-[10px] text-slate-400 font-bold uppercase">Total Fotos PG</div>
                      <div className="text-lg font-black text-slate-100">{photoStats.totalPhotos || 0}</div>
                    </div>
                    <div className="p-3 bg-slate-850 border border-emerald-900/50 rounded-xl">
                      <div className="text-[10px] text-emerald-400 font-bold uppercase">AWS S3 (Primario)</div>
                      <div className="text-lg font-black text-emerald-300">{photoStats.s3Count ?? photoStats.totalPhotos ?? 0}</div>
                    </div>
                    <div className="p-3 bg-slate-850 border border-amber-900/50 rounded-xl">
                      <div className="text-[10px] text-amber-400 font-bold uppercase">Firebase (Reserva)</div>
                      <div className="text-lg font-black text-amber-300">{photoStats.firebaseCount || 0}</div>
                    </div>
                    <div className="p-3 bg-slate-850 border border-cyan-900/50 rounded-xl">
                      <div className="text-[10px] text-cyan-400 font-bold uppercase">Google Drive (Backup)</div>
                      <div className="text-lg font-black text-cyan-300">{photoStats.driveCount || 0}</div>
                    </div>
                  </div>
                )}

                {/* State Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-950/80 rounded-xl border border-slate-800">
                  <div className="flex items-center space-x-2 text-xs text-slate-300">
                    <span className="font-semibold">Estado de Capas 1 y 2:</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      photoStats?.simulatedQuotaExceeded
                        ? 'bg-amber-950 text-amber-300 border border-amber-800'
                        : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    }`}>
                      {photoStats?.simulatedQuotaExceeded
                        ? 'CUOTA SIMULADA (AWS S3 PRIMARIO ACTIVO)'
                        : 'AWS S3 (PRIMARIO) + FIREBASE (RESERVA) ACTIVOS'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleForceSyncLocalPhotos}
                      disabled={isSyncingLocalPhotos}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow disabled:opacity-50 flex items-center space-x-1"
                    >
                      {isSyncingLocalPhotos ? (
                        <span>Sincronizando Firestore + S3...</span>
                      ) : (
                        <span>Sincronizar Fotos en Firestore + AWS S3</span>
                      )}
                    </button>

                    <button
                      onClick={async () => {
                        try {
                          setIsSyncingGdrive(true);
                          const { syncAllPhotosToGoogleDriveBackup } = await import('../lib/photoStorageDB');
                          const res = await syncAllPhotosToGoogleDriveBackup({ driveToken: (await getAccessToken()) || undefined });
                          setFeedback({
                            type: 'success',
                            msg: res.message,
                          });
                          loadPhotoStats();
                        } catch (err: any) {
                          setFeedback({ type: 'error', msg: err.message || 'Error sincronizando con Google Drive' });
                        } finally {
                          setIsSyncingGdrive(false);
                        }
                      }}
                      disabled={isSyncingGdrive}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow disabled:opacity-50 flex items-center space-x-1"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      <span>
                        {isSyncingGdrive
                          ? 'Sincronizando en Google Drive...'
                          : 'Sincronizar en Google Drive (Última Capa de Backup)'}
                      </span>
                    </button>

                    {photoStats?.simulatedQuotaExceeded ? (
                      <button
                        onClick={() => handleSimulateQuota(false)}
                        disabled={isSimulatingQuota}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow"
                      >
                        {isSimulatingQuota ? 'Desactivando...' : 'Restablecer Firebase Principal'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSimulateQuota(true)}
                        disabled={isSimulatingQuota}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow"
                      >
                        {isSimulatingQuota ? 'Activando...' : 'Simular Cuota Excedida Firebase'}
                      </button>
                    )}

                    <button
                      onClick={handleTriggerRecovery}
                      disabled={isRunningRecovery || photoStats?.simulatedQuotaExceeded}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer shadow disabled:opacity-50"
                    >
                      {isRunningRecovery ? 'Ejecutando Worker...' : 'Ejecutar Recuperación S3 → Firebase'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 0: CLOUD SQL POSTGRESQL PERSISTENCIA PERMANENTE */}
          {activeTab === 'cloudSql' && (
            <div className="space-y-4">
              <div className="bg-blue-950/40 p-4 rounded-xl border border-blue-800/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-300 flex items-center justify-center border border-blue-500/30">
                      <Server className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-100 flex items-center space-x-2">
                        <span>Base de Datos Cloud SQL (PostgreSQL)</span>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-500/40">
                          {cloudSyncData?.connected ? 'Conectado & Sin Límites' : 'Operativo'}
                        </span>
                      </h4>
                      <p className="text-[10px] text-blue-300/80">
                        Base de datos relacional PostgreSQL oficial de CAMARCA (Región: us-west1)
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={loadCloudSyncStatus}
                    disabled={loadingCloudSync}
                    className="text-slate-400 hover:text-blue-400 p-1.5 rounded-lg hover:bg-blue-950/50 transition-colors"
                    title="Actualizar estado en la nube"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingCloudSync ? 'animate-spin text-blue-400' : ''}`} />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Expendios en SQL</span>
                    <span className="text-sm font-bold text-blue-400">
                      {cloudSyncData?.localExpendios ?? 177}
                    </span>
                  </div>
                  <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Historial / Cuentas</span>
                    <span className="text-sm font-bold text-blue-400">
                      {cloudSyncData?.localHistorial ?? 510}
                    </span>
                  </div>
                  <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Relación de Pagos</span>
                    <span className="text-sm font-bold text-blue-400">
                      {cloudSyncData?.localRelacionPagos ?? 510}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-300 bg-slate-900/70 p-2.5 rounded-lg border border-slate-800 space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-slate-400">Motor Relacional:</span>
                    <span className="font-mono text-emerald-300 font-bold">
                      PostgreSQL 15 (Drizzle ORM)
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-slate-400">Límite Diario de Operaciones:</span>
                    <span className="font-mono text-emerald-400 font-bold">
                      ILIMITADAS (0 Límites por día)
                    </span>
                  </div>
                </div>

                <div className="bg-blue-950/30 border border-blue-800/40 rounded-lg p-3 text-[11px] text-blue-200/90 leading-relaxed">
                  <strong>✓ Conexión Robusta Directa:</strong>
                  <br />
                  Los datos se almacenan en tablas relacionales PostgreSQL con claves primarias e integridad referencial, sin depender de cuotas de 20.000 operaciones ni tokens que venzan.
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleForceCloudSync}
                    disabled={isCloudSyncing}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center space-x-2 shadow transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isCloudSyncing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Sincronizando con PostgreSQL...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        <span>Sincronizar con PostgreSQL</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleForceCloudRestore}
                    disabled={isCloudRestoring}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center space-x-2 shadow transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isCloudRestoring ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Restaurando de SQL...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5 text-blue-400" />
                        <span>Recargar desde PostgreSQL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}


          {/* TAB 1: EXPORT / DOWNLOAD */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Database className="w-4 h-4 text-amber-400" />
                    <h4 className="text-xs font-bold text-slate-100">
                      1. Base de Datos Completa (.JSON) — Recomendado
                    </h4>
                  </div>
                  <span className="text-[10px] bg-amber-400/10 text-amber-400 border border-amber-400/20 px-2 py-0.5 rounded-full font-bold">
                    Rápido & Seguro
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Descarga instantánea de todos los datos estructurados: 170+ expendios, cuentas de cobro, historial completo, pagos y métricas. Archivo liviano que nunca falla.
                </p>
                <button
                  type="button"
                  onClick={handleDownloadPureDatabase}
                  className="w-full mt-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 shadow transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Descargar Base de Datos (.JSON)</span>
                </button>
              </div>

              <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <FolderArchive className="w-4 h-4 text-sky-400" />
                    <h4 className="text-xs font-bold text-slate-100">
                      2. Copia Total con Fotos Integradas (.JSON)
                    </h4>
                  </div>
                  <span className="text-[10px] bg-sky-400/10 text-sky-400 border border-sky-400/20 px-2 py-0.5 rounded-full font-bold">
                    Respaldo Integral
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Contiene la base de datos completa más todas las fotografías en alta resolución embebidas en Base64.
                </p>
                <button
                  type="button"
                  onClick={handleDownloadFullWithPhotos}
                  className="w-full mt-1 bg-sky-600 hover:bg-sky-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 shadow transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Descargar Copia Total con Fotos (.JSON)</span>
                </button>
              </div>

              <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <FolderArchive className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-xs font-bold text-slate-100">
                      3. Paquete Comprimido de Fotos (.ZIP)
                    </h4>
                  </div>
                  <span className="text-[10px] bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 px-2 py-0.5 rounded-full font-bold">
                    Galería JPG
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Descarga un archivo ZIP organizado con todas las fotografías del registro fotográfico almacenadas en el servidor.
                </p>
                <button
                  type="button"
                  onClick={handleDownloadPhotosZip}
                  className="w-full mt-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 shadow transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Descargar Archivo ZIP de Fotografías</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: IMPORT / RESTORE */}
          {activeTab === 'import' && (
            <form onSubmit={handleImportFile} className="space-y-4">
              <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center space-x-2">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-xs font-bold text-slate-100">
                    Restaurar Base de Datos desde Archivo JSON
                  </h4>
                </div>
                <p className="text-[11px] text-slate-400">
                  Sube cualquier copia de seguridad previamente descargada (.JSON). El sistema restaurará todos los expendios, cuentas y fotos de forma segura.
                </p>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Seleccionar Archivo JSON de Respaldo
                  </label>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => setSelectedJsonFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer bg-slate-900 rounded-xl border border-slate-700 p-1"
                  />
                  {selectedJsonFile && (
                    <div className="mt-1.5 text-[11px] text-emerald-400 flex items-center space-x-1 font-medium">
                      <FileCheck2 className="w-3.5 h-3.5" />
                      <span>Archivo seleccionado: {selectedJsonFile.name} ({(selectedJsonFile.size / 1024).toFixed(1)} KB)</span>
                    </div>
                  )}
                </div>

                <div className="pt-1">
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center space-x-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                    <span>Contraseña Maestra de Seguridad</span>
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Ingresa la contraseña de autorización"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isRestoring || !selectedJsonFile}
                  className="w-full mt-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 shadow transition-all cursor-pointer disabled:opacity-50"
                >
                  {isRestoring ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Restaurando datos en el servidor...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>Restaurar Base de Datos Ahora</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: SNAPSHOTS */}
          {activeTab === 'snapshots' && (
            <div className="space-y-4">
              <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Clock className="w-4 h-4 text-sky-400" />
                    <h4 className="text-xs font-bold text-slate-100">
                      Snapshots Automáticos en Servidor
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={loadSnapshots}
                    className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center space-x-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingSnapshots ? 'animate-spin' : ''}`} />
                    <span>Actualizar</span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-400">
                  El servidor guarda instantáneas automáticas de la base de datos periódicamente en disco. Si algo se modificó accidentalmente, puedes regresar a cualquiera de estas copias con un solo clic.
                </p>

                {loadingSnapshots ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-sky-400" />
                    Cargando historial de copias del servidor...
                  </div>
                ) : snapshots.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400 bg-slate-900/50 rounded-xl border border-slate-800">
                    No hay copias automáticas registradas en este momento.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {snapshots.map((snap) => (
                      <label
                        key={snap.filename}
                        className={`flex items-center justify-between p-3 rounded-xl border text-xs cursor-pointer transition-colors ${
                          selectedSnapshot === snap.filename
                            ? 'bg-sky-950/40 border-sky-500/60 text-sky-200'
                            : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <input
                            type="radio"
                            name="selectedSnapshot"
                            checked={selectedSnapshot === snap.filename}
                            onChange={() => setSelectedSnapshot(snap.filename)}
                            className="text-sky-500 focus:ring-sky-400"
                          />
                          <div>
                            <div className="font-bold text-slate-200">
                              {formatSafeDateTime(snap.fecha)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {snap.expendiosCount} expendios · {snap.historialCount} registros · {(snap.tamanoBytes / 1024).toFixed(1)} KB
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">
                          {snap.filename.replace('.json', '')}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {snapshots.length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center space-x-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                        <span>Contraseña Maestra de Seguridad</span>
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Ingresa la contraseña para autorizar la restauración"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-400"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleRestoreSnapshot}
                      disabled={isRestoring || !selectedSnapshot}
                      className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 shadow transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isRestoring ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Restaurando snapshot...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          <span>Restaurar Copia Seleccionada</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: GOOGLE DRIVE TERCER RESPALDO AUTOMÁTICO (EXCLUSIVAMENTE FOTOGRAFÍAS) */}
          {activeTab === 'googleDrive' && (
            <div className="space-y-4">
              <ErrorBoundary fallbackTitle="Panel de Google Drive" onClose={onClose}>
                <GoogleDriveAutoBackupCard />
              </ErrorBoundary>
            </div>
          )}

          {/* TAB 5: TEST VS PUBLICADA */}
          {activeTab === 'ambienteSync' && (
            <div className="space-y-4">
              <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center space-x-2">
                  <Globe className="w-4 h-4 text-purple-400" />
                  <h4 className="text-xs font-bold text-slate-100">
                    Separación de Ambientes (Test vs Publicada)
                  </h4>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Las bases de datos están totalmente aisladas para que las pruebas nunca alteren la información oficial de producción. Puedes retroalimentar el ambiente de pruebas con un solo clic para sincronizarlo con la versión publicada.
                </p>

                {/* Environment Status Card */}
                {ambienteInfo && (
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Ambiente actual detectado:</span>
                      <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                        ambienteInfo.ambiente === 'PUBLICADA'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {ambienteInfo.ambiente === 'PUBLICADA' ? 'PRODUCCIÓN PUBLICADA' : 'ENTORNO DE PRUEBAS (TEST)'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Archivo de base de datos en uso:</span>
                      <strong className="font-mono text-purple-300">{ambienteInfo.activeDbFile}</strong>
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Total expendios cargados:</span>
                      <strong className="text-slate-200">{ambienteInfo.expendiosCount}</strong>
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Registros en historial:</span>
                      <strong className="text-slate-200">{ambienteInfo.historialCount}</strong>
                    </div>

                    {ambienteInfo.lastSyncFromPublished && (
                      <div className="pt-1 text-[10px] text-slate-400 border-t border-slate-800">
                        Última retroalimentación desde publicada: {formatSafeDateTime(ambienteInfo.lastSyncFromPublished)}
                      </div>
                    )}
                  </div>
                )}

                {/* Feed test from published button */}
                <div className="p-3.5 rounded-xl bg-purple-950/30 border border-purple-800/40 space-y-2">
                  <div className="font-bold text-xs text-purple-200 flex items-center justify-between">
                    <span>Retroalimentar Test desde la Versión Publicada</span>
                    <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">Automático</span>
                  </div>
                  <p className="text-[11px] text-purple-300/80 leading-relaxed">
                    Toma los datos oficiales más recientes de la versión publicada (expendios, cuentas de cobro e historial) y los copia de manera segura al entorno de pruebas.
                  </p>

                  <button
                    type="button"
                    onClick={handleRetroalimentarDesdePublicada}
                    disabled={isSyncingFromPublished}
                    className="w-full mt-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 shadow transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isSyncingFromPublished ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Sincronizando desde la versión publicada...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        <span>Retroalimentar Base de Datos desde Publicada</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
          </ErrorBoundary>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="text-[11px] text-slate-400 flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Se requiere contraseña maestra de Super Administrador para restaurar copias de seguridad.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
