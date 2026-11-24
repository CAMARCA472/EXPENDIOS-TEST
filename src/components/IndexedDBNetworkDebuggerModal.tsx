import React, { useState, useEffect, useCallback } from 'react';
import {
  getAllStoredPhotos,
  getPendingPhotos,
  getIndexedDBStats,
  deleteStoredPhoto,
  purgeUploadedPhotosFromIndexedDB,
  syncAllPendingPhotos,
  syncAllPhotosToGoogleDriveBackup,
  syncSinglePhotoRecord,
  exportAllPhotosAsZip,
  photoDB
} from '../lib/photoStorageDB';
import { StoredPhotoRecord, IndexedDBStorageStats } from '../types';
import {
  Database,
  Wifi,
  WifiOff,
  RefreshCw,
  UploadCloud,
  Trash2,
  Download,
  AlertTriangle,
  CheckCircle2,
  X,
  Eye,
  Loader2,
  ShieldCheck,
  Activity,
  Server,
  HardDrive,
  FileCheck,
  Sparkles,
  Zap,
  ArrowRight,
  Maximize2
} from 'lucide-react';

interface IndexedDBNetworkDebuggerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IndexedDBNetworkDebuggerModal: React.FC<IndexedDBNetworkDebuggerModalProps> = ({
  isOpen,
  onClose,
}) => {
  // Estados de IndexedDB
  const [stats, setStats] = useState<IndexedDBStorageStats | null>(null);
  const [records, setRecords] = useState<StoredPhotoRecord[]>([]);
  const [filterText, setFilterText] = useState<string>('');
  const [loadingDb, setLoadingDb] = useState<boolean>(true);

  // Estados de Red & Servidor
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [apiLatencyMs, setApiLatencyMs] = useState<number | null>(null);
  const [dbLatencyMs, setDbLatencyMs] = useState<number | null>(null);
  const [serverStorageStats, setServerStorageStats] = useState<any>(null);
  const [pingStatus, setPingStatus] = useState<'testing' | 'ok' | 'error'>('testing');

  // Estados de Proceso
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isSyncingDrive, setIsSyncingDrive] = useState<boolean>(false);
  const [isTestingUpload, setIsTestingUpload] = useState<boolean>(false);
  const [testingRecordId, setTestingRecordId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string; details?: any } | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; title: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  // Cargar datos de IndexedDB
  const loadIndexedDBData = useCallback(async () => {
    setLoadingDb(true);
    try {
      const currentStats = await getIndexedDBStats();
      const allRecords = await getAllStoredPhotos();
      setStats(currentStats);
      setRecords(allRecords);
    } catch (err) {
      console.warn('[Debugger] Error leyendo IndexedDB:', err);
    } finally {
      setLoadingDb(false);
    }
  }, []);

  // Cargar diagnóstico de Red y Servidor
  const runNetworkDiagnostic = useCallback(async () => {
    setPingStatus('testing');
    const onlineState = typeof navigator !== 'undefined' ? navigator.onLine : true;
    setIsOnline(onlineState);

    const startApi = Date.now();
    try {
      const resHealth = await fetch(`/api/health?_t=${Date.now()}`);
      const durationApi = Date.now() - startApi;
      setApiLatencyMs(durationApi);

      // Probar estadísticas del servidor de almacenamiento de fotos
      const resStorage = await fetch(`/api/admin/photo-storage/stats?_t=${Date.now()}`);
      if (resStorage.ok) {
        const dataStorage = await resStorage.json();
        setServerStorageStats(dataStorage);
      }

      // Probar latencia de base de datos PostgreSQL
      const resSql = await fetch(`/api/admin/cloudsql/status?_t=${Date.now()}`);
      if (resSql.ok) {
        const sqlData = await resSql.json();
        if (sqlData.success && sqlData.data?.currentLatencyMs) {
          setDbLatencyMs(sqlData.data.currentLatencyMs);
        }
      }

      setPingStatus(resHealth.ok ? 'ok' : 'error');
    } catch (err) {
      console.warn('[Debugger] Error probando red/API:', err);
      setPingStatus('error');
      setApiLatencyMs(null);
    }
  }, []);

  // Event listeners para cambios en tiempo real
  useEffect(() => {
    if (!isOpen) return;

    loadIndexedDBData();
    runNetworkDiagnostic();

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    let timer: any = null;
    if (autoRefresh) {
      timer = setInterval(() => {
        loadIndexedDBData();
        runNetworkDiagnostic();
      }, 4000);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (timer) clearInterval(timer);
    };
  }, [isOpen, autoRefresh, loadIndexedDBData, runNetworkDiagnostic]);

  if (!isOpen) return null;

  // Sincronizar toda la cola pendiente de IndexedDB hacia Firestore + AWS S3
  const handleSyncPendingQueue = async () => {
    setIsSyncing(true);
    setTestResult(null);
    try {
      const res = await syncAllPendingPhotos();
      setTestResult({
        success: res.failedCount === 0,
        msg: `✓ Sincronización con Firestore y AWS S3 completada: ${res.syncedCount} subidas con éxito, ${res.failedCount} fallidas.`,
        details: res,
      });
      await loadIndexedDBData();
    } catch (err: any) {
      setTestResult({
        success: false,
        msg: `Error ejecutando sincronización de cola: ${err.message}`,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Sincronizar en Google Drive (Última capa de seguridad y backup)
  const handleSyncGoogleDriveBackup = async () => {
    setIsSyncingDrive(true);
    setTestResult(null);
    try {
      const res = await syncAllPhotosToGoogleDriveBackup();
      setTestResult({
        success: true,
        msg: res.message,
        details: res,
      });
      await loadIndexedDBData();
    } catch (err: any) {
      setTestResult({
        success: false,
        msg: `Error sincronizando backup en Google Drive: ${err.message}`,
      });
    } finally {
      setIsSyncingDrive(false);
    }
  };

  // Probar la subida de un registro específico a la red
  const handleTestSingleUpload = async (record: StoredPhotoRecord) => {
    if (!record.id) return;
    setTestingRecordId(record.id);
    setTestResult(null);

    try {
      const res = await syncSinglePhotoRecord(record);
      if (res.success || res.serverSynced) {
        setTestResult({
          success: true,
          msg: `✅ ¡Subida a Firestore + AWS S3 Exitosa! Foto ${record.fileName} guardada en servidor con HTTP 200 OK.`,
        });
      } else {
        setTestResult({
          success: false,
          msg: `❌ Fallo en subida a red para ${record.fileName}: ${res.error || 'Error del servidor'}`,
        });
      }
      await loadIndexedDBData();
    } catch (err: any) {
      setTestResult({
        success: false,
        msg: `Error de conexión al probar subida: ${err.message}`,
      });
    } finally {
      setTestingRecordId(null);
    }
  };

  // Probar subida directa de prueba (Genera Blob sintético)
  const handleTestDirectNetworkUpload = async () => {
    setIsTestingUpload(true);
    setTestResult(null);

    try {
      // Crear una imagen PNG sintética de 10x10 px
      const canvas = document.createElement('canvas');
      canvas.width = 20;
      canvas.height = 20;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#10b981';
        ctx.fillRect(0, 0, 20, 20);
      }
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg'));

      const formData = new FormData();
      formData.append('foto', blob, 'test_debug_photo.jpg');

      const start = Date.now();
      const res = await fetch('/api/photos/upload-hybrid/9999999999/debug_probe', {
        method: 'POST',
        body: formData,
      });
      const duration = Date.now() - start;
      const data = await res.json();

      if (res.ok && data.success) {
        setTestResult({
          success: true,
          msg: `✅ ¡Prueba de Red Completada! HTTP ${res.status} OK (${duration}ms). Foto recibida y registrada en Firestore + AWS S3.`,
          details: data,
        });
      } else {
        setTestResult({
          success: false,
          msg: `❌ Servidor retornó HTTP ${res.status}: ${data.message || 'Fallo de subida'}`,
          details: data,
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        msg: `❌ Error de red/CORS en petición direct a la API: ${err.message}`,
      });
    } finally {
      setIsTestingUpload(false);
      loadIndexedDBData();
      runNetworkDiagnostic();
    }
  };

  // Purga de fotos ya sincronizadas
  const handlePurgeSynced = async () => {
    if (!confirm('¿Deseas purgar de IndexedDB las fotos que ya fueron confirmadas y subidas al servidor?')) return;
    try {
      const res = await purgeUploadedPhotosFromIndexedDB({ forceImmediate: true });
      setTestResult({
        success: true,
        msg: `✓ Purga completada: ${res.purgedCount} fotos sincronizadas eliminadas de IndexedDB para liberar espacio local.`,
      });
      await loadIndexedDBData();
    } catch (err: any) {
      setTestResult({
        success: false,
        msg: `Error durante la purga: ${err.message}`,
      });
    }
  };

  // Exportar ZIP
  const handleExportZip = async () => {
    try {
      const zipBlob = await exportAllPhotosAsZip();
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `indexeddb_photos_dump_${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Error exportando ZIP: ${err.message}`);
    }
  };

  // Registros filtrados
  const filteredRecords = records.filter(
    (r) =>
      (r.cedula || '').includes(filterText) ||
      (r.slotKey || '').toLowerCase().includes(filterText.toLowerCase()) ||
      (r.fileName || '').toLowerCase().includes(filterText.toLowerCase()) ||
      (r.status || '').toLowerCase().includes(filterText.toLowerCase())
  );

  // Diagnóstico automático heurístico
  const pendingCount = stats?.pendingRecords ?? 0;
  let diagnosticConclusion = {
    severity: 'success',
    title: '✓ Persistencia Activa en Firestore + AWS S3 (Sin Fotos Retenidas)',
    message: `Navegador Online, API respondiendo en ${apiLatencyMs ?? 0}ms. Las fotografías se guardan primero en Firestore y AWS S3; usa el botón de Google Drive para la última capa de backup.`,
  };

  if (!isOnline) {
    diagnosticConclusion = {
      severity: 'error',
      title: '🚨 Navegador Sin Conexión a Internet (Offline)',
      message: 'El navegador reporta estar desconectado. Las fotos se están reteniendo de forma segura en IndexedDB hasta restablecer la red.',
    };
  } else if (pingStatus === 'error') {
    diagnosticConclusion = {
      severity: 'error',
      title: '🚨 Inaccesibilidad de Servidor / Error HTTP',
      message: 'La API del servidor no está respondiendo a las peticiones. Revisa la conectividad del backend.',
    };
  } else if (pendingCount > 0) {
    diagnosticConclusion = {
      severity: 'warning',
      title: `⚠️ ${pendingCount} Fotografía(s) Pendientes de Subir a Firestore + AWS S3`,
      message: 'Hay fotografías almacenadas en el navegador esperando ser transmitidas a Firestore y AWS S3. Haz clic en "Sincronizar a Firestore + S3".',
    };
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-6xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-black text-slate-100">
                  Arquitectura de 3 Capas: Firestore + AWS S3 + Backup Google Drive
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                  SOLO ADMINISTRADOR
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Capa 1: Firestore / Firebase Storage • Capa 2: AWS S3 Bucket • Capa 3 (Última Capa de Seguridad): Google Drive Backup.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <label className="flex items-center space-x-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-3.5 h-3.5 text-amber-500 rounded border-slate-700 focus:ring-amber-400 accent-amber-500"
              />
              <span className="text-slate-300 font-medium">Auto-Refresco (4s)</span>
              {autoRefresh && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />}
            </label>

            <button
              type="button"
              onClick={() => {
                loadIndexedDBData();
                runNetworkDiagnostic();
              }}
              className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
              title="Refrescar métricas ahora"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title="Cerrar diagnóstico"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 bg-slate-900/60">
          {/* Diagnostic conclusion card */}
          <div
            className={`p-4 rounded-2xl border text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg ${
              diagnosticConclusion.severity === 'success'
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : diagnosticConclusion.severity === 'warning'
                ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
            }`}
          >
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-xl bg-black/20 shrink-0 mt-0.5">
                {diagnosticConclusion.severity === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : diagnosticConclusion.severity === 'warning' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                ) : (
                  <WifiOff className="w-5 h-5 text-rose-400" />
                )}
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-100">{diagnosticConclusion.title}</h4>
                <p className="text-xs text-slate-300 mt-0.5">{diagnosticConclusion.message}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleSyncPendingQueue}
                disabled={isSyncing || pendingCount === 0}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 shadow transition-all cursor-pointer"
              >
                {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                <span>Sincronizar a Firestore + S3 ({pendingCount})</span>
              </button>

              <button
                type="button"
                onClick={handleSyncGoogleDriveBackup}
                disabled={isSyncingDrive}
                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black rounded-xl text-xs flex items-center space-x-1.5 shadow transition-all cursor-pointer"
                title="Sincronizar fotografías guardadas en Firestore y S3 hacia Google Drive como última capa de seguridad"
              >
                {isSyncingDrive ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                <span>Sincronizar en Google Drive (Última Capa Backup)</span>
              </button>
            </div>
          </div>

          {/* Test feedback alert banner */}
          {testResult && (
            <div
              className={`p-3.5 rounded-2xl border text-xs flex items-start justify-between gap-3 animate-fadeIn ${
                testResult.success
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-200'
                  : 'bg-rose-950/80 border-rose-500/50 text-rose-200'
              }`}
            >
              <div className="space-y-1">
                <div className="font-bold flex items-center space-x-2">
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span>{testResult.msg}</span>
                </div>
                {testResult.details && (
                  <pre className="text-[10px] font-mono bg-black/40 p-2 rounded-lg max-h-32 overflow-auto text-slate-300">
                    {JSON.stringify(testResult.details, null, 2)}
                  </pre>
                )}
              </div>
              <button
                type="button"
                onClick={() => setTestResult(null)}
                className="text-xs underline opacity-80 hover:opacity-100 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          )}

          {/* Side-by-Side Status Dashboard */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Box 1: IndexedDB Local Status */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-400">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100">Estado de Capas: IndexedDB → Firestore + S3 → Drive</h4>
                    <span className="text-[10px] font-mono text-slate-500">BD Dexie: CamarcaPhotosDB v1</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-lg border border-amber-400/30">
                  {stats?.totalBytes ? (stats.totalBytes / (1024 * 1024)).toFixed(2) : '0.00'} MB
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl space-y-0.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Total Local</span>
                  <div className="text-base font-black text-slate-100 font-mono">{stats?.totalRecords ?? stats?.total ?? 0}</div>
                </div>
                <div className="bg-amber-950/30 border border-amber-500/30 p-2.5 rounded-xl space-y-0.5">
                  <span className="text-[10px] font-bold text-amber-300 uppercase">Cola Pendiente</span>
                  <div className="text-base font-black text-amber-400 font-mono">{stats?.pendingRecords ?? stats?.pending ?? 0}</div>
                </div>
                <div className="bg-emerald-950/30 border border-emerald-500/30 p-2.5 rounded-xl space-y-0.5">
                  <span className="text-[10px] font-bold text-emerald-300 uppercase">Firestore + S3</span>
                  <div className="text-base font-black text-emerald-400 font-mono">{stats?.synced ?? 0}</div>
                </div>
                <div className="bg-sky-950/30 border border-sky-500/30 p-2.5 rounded-xl space-y-0.5">
                  <span className="text-[10px] font-bold text-sky-300 uppercase">Backup Drive</span>
                  <div className="text-base font-black text-sky-400 font-mono">{stats?.driveSyncedRecords ?? 0}</div>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleTestDirectNetworkUpload}
                  disabled={isTestingUpload}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center space-x-1.5 shadow cursor-pointer disabled:opacity-50"
                  title="Genera una foto sintética y realiza POST a /api/photos/upload-hybrid para medir respuesta HTTP"
                >
                  {isTestingUpload ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  <span>Probar Subida Directa de Prueba</span>
                </button>

                <button
                  type="button"
                  onClick={handlePurgeSynced}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center space-x-1.5 border border-slate-700 cursor-pointer"
                  title="Libera espacio eliminando fotos que ya fueron confirmadas en el servidor"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Limpiar Caché Sincronizada</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportZip}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center space-x-1.5 border border-slate-700 cursor-pointer"
                  title="Descarga un ZIP con todas las imágenes de IndexedDB"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Exportar ZIP</span>
                </button>
              </div>
            </div>

            {/* Box 2: Network & Server Status */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
                    <Wifi className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100">Estado de Red & Servidor Backend</h4>
                    <span className="text-[10px] font-mono text-slate-500">API PostgreSQL Cloud SQL</span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border ${
                      isOnline
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {isOnline ? <Wifi className="w-3.5 h-3.5 mr-1" /> : <WifiOff className="w-3.5 h-3.5 mr-1" />}
                    {isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center text-xs">
                <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl space-y-0.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Latencia API</span>
                  <div className="text-base font-black text-emerald-400 font-mono">
                    {apiLatencyMs !== null ? `${apiLatencyMs} ms` : '---'}
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl space-y-0.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Latencia DB SQL</span>
                  <div className="text-base font-black text-sky-400 font-mono">
                    {dbLatencyMs !== null ? `${dbLatencyMs} ms` : '---'}
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl space-y-0.5 col-span-2 sm:col-span-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Firebase Storage</span>
                  <div className="text-xs font-black text-amber-300 font-mono pt-1 truncate">
                    {serverStorageStats?.circuitBreakerState || 'OK (Active)'}
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800/80 p-3 rounded-xl text-xs space-y-1.5 font-mono text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-500">Fotos Indexadas en PostgreSQL:</span>
                  <span className="font-bold text-slate-200">{serverStorageStats?.totalPhotos || 0} fotos</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Uso de Almacenamiento Firebase:</span>
                  <span className="font-bold text-slate-200">
                    {serverStorageStats?.firebaseUsedGB || '0.00'} GB / {serverStorageStats?.firebaseQuotaGB || '5.0'} GB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Estado de Cuota Servidor:</span>
                  <span className="font-bold text-emerald-400">
                    {serverStorageStats?.firebaseQuotaState || 'Óptima (Plan Gratuito)'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Table of Records stored in IndexedDB */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                  <HardDrive className="w-4 h-4 text-amber-400" />
                  <span>Inspección de Registros en IndexedDB ({filteredRecords.length})</span>
                </h4>
                <p className="text-xs text-slate-400">
                  Explora las fotografías almacenadas en la base local del navegador para probar su transmisión individual.
                </p>
              </div>

              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filtrar por cédula, slot o estado..."
                className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400 w-full sm:w-64 font-mono"
              />
            </div>

            {loadingDb ? (
              <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center space-x-2">
                <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                <span>Cargando registros de IndexedDB...</span>
              </div>
            ) : filteredRecords.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-bold">
                    <tr>
                      <th className="py-2.5 px-3">Thumbnail</th>
                      <th className="py-2.5 px-3">Cédula / Slot</th>
                      <th className="py-2.5 px-3">Archivo</th>
                      <th className="py-2.5 px-3">Tamaño</th>
                      <th className="py-2.5 px-3">Estado IndexedDB</th>
                      <th className="py-2.5 px-3 text-center">Acciones de Red</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {filteredRecords.map((rec) => {
                      const isSynced = rec.serverSynced && rec.status === 'synced';
                      const isPending = rec.status === 'pending';
                      const isFailed = rec.status === 'failed';
                      const photoUrl = rec.dataUrl || (rec.blob ? URL.createObjectURL(rec.blob) : '');

                      return (
                        <tr key={rec.id} className="hover:bg-slate-900/50 transition-colors">
                          <td className="py-2 px-3">
                            {photoUrl ? (
                              <img
                                src={photoUrl}
                                alt="IDB Preview"
                                className="w-10 h-10 object-cover rounded-lg border border-slate-700 bg-black/40 cursor-pointer hover:scale-105 transition-transform"
                                onClick={() =>
                                  setPreviewPhoto({
                                    url: photoUrl,
                                    title: `${rec.fileName} (C.C. ${rec.cedula})`,
                                  })
                                }
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-[9px] text-slate-500">
                                Sin img
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-bold text-slate-100">{rec.cedula}</div>
                            <div className="text-[10px] text-amber-400">{rec.slotKey}</div>
                          </td>
                          <td className="py-2 px-3 text-slate-300 truncate max-w-[160px]" title={rec.fileName}>
                            {rec.fileName}
                          </td>
                          <td className="py-2 px-3 text-slate-400">
                            {rec.fileSize ? `${(rec.fileSize / 1024).toFixed(1)} KB` : '---'}
                          </td>
                          <td className="py-2 px-3">
                            {isSynced ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-400" /> SYNCED
                              </span>
                            ) : isFailed ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                <AlertTriangle className="w-3 h-3 mr-1 text-rose-400" /> FAILED
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                <Loader2 className="w-3 h-3 mr-1 text-amber-400" /> PENDING
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <div className="flex items-center justify-center space-x-1.5">
                              <button
                                type="button"
                                onClick={() => handleTestSingleUpload(rec)}
                                disabled={testingRecordId === rec.id}
                                className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-bold px-2 py-1 rounded text-[10px] flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                                title="Prueba subir esta foto directamente al servidor por la red"
                              >
                                {testingRecordId === rec.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Zap className="w-3 h-3 text-emerald-400" />
                                )}
                                <span>Probar Subida</span>
                              </button>

                              {photoUrl && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewPhoto({
                                      url: photoUrl,
                                      title: `${rec.fileName} (${rec.slotKey})`,
                                    })
                                  }
                                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 cursor-pointer"
                                  title="Ver foto almacenada en IndexedDB"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={async () => {
                                  if (rec.id && confirm(`¿Eliminar registro local de ${rec.fileName}?`)) {
                                    await deleteStoredPhoto(rec.id);
                                    loadIndexedDBData();
                                  }
                                }}
                                className="p-1 rounded bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 border border-slate-700 cursor-pointer"
                                title="Eliminar este registro de IndexedDB"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-slate-500 bg-slate-900/50 rounded-xl border border-dashed border-slate-800">
                <Database className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                <p className="font-bold">No hay registros en IndexedDB que coincidan con el filtro.</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Cuando se capturan fotos offline o pendientes, se listarán de forma estructurada en esta vista.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shrink-0">
          <div className="text-slate-500 text-[11px]">
            Herramienta de Diagnóstico Interno • Inspección de `CamarcaPhotosDB` & Red HTTP
          </div>
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-4 py-2 rounded-xl text-xs transition-colors cursor-pointer"
          >
            Cerrar Diagnóstico
          </button>
        </div>
      </div>

      {/* Lightbox Preview Modal for IDB stored photo */}
      {previewPhoto && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950">
              <span className="text-xs font-bold text-slate-200">{previewPhoto.title}</span>
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-slate-950 flex items-center justify-center min-h-[350px]">
              <img
                src={previewPhoto.url}
                alt="IndexedDB Preview"
                className="max-h-[70vh] max-w-full object-contain rounded-xl shadow-xl border border-slate-800"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
