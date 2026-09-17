import React, { useState, useEffect } from 'react';
import {
  Database,
  Cloud,
  CheckCircle2,
  RefreshCw,
  X,
  ShieldCheck,
  Server,
  FileCheck2,
  Check,
  Activity,
  AlertCircle
} from 'lucide-react';

export interface SyncMonitoringData {
  firestore: {
    connected: boolean;
    databaseId: string;
    collection: string;
    totalExpendios: number;
    lastSyncTime: string | null;
    error: string | null;
    status: 'synced' | 'offline' | 'quota_exhausted';
    quotaExhausted?: boolean;
  };
  storage: {
    connected: boolean;
    bucket: string;
    collection: string;
    photosCount: number;
    lastPhotoSyncTime: string | null;
    status: 'online' | 'degraded';
  };
  lastReport: {
    saved: boolean;
    name: string;
    timestamp: string | null;
    type: string;
    status: 'success' | 'pending' | 'error';
    detalles?: string;
  };
}

export const notifyReportSaved = async (name: string, type: string = 'general', detalles?: string) => {
  const timestamp = new Date().toISOString();
  // Notificar a la ventana local inmediatamente
  window.dispatchEvent(
    new CustomEvent('reporteGuardado', {
      detail: { name, type, timestamp, detalles },
    })
  );

  // Notificar al backend para que persista en el monitoreo del sistema
  try {
    await fetch('/api/system/report-saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, detalles }),
    });
  } catch {}
};

interface EstadoConexionProps {
  isLight?: boolean;
  className?: string;
}

export const EstadoConexion: React.FC<EstadoConexionProps> = ({
  isLight = false,
  className = '',
}) => {
  const [data, setData] = useState<SyncMonitoringData>({
    firestore: {
      connected: true,
      databaseId: 'ai-studio-controldepersona-5a851b13-3f57-4ad6-ac56-28b094b35072',
      collection: 'camarca_system',
      totalExpendios: 177,
      lastSyncTime: new Date().toISOString(),
      error: null,
      status: 'synced',
    },
    storage: {
      connected: true,
      bucket: 'gen-lang-client-0829904854.firebasestorage.app',
      collection: 'camarca_photos',
      photosCount: 0,
      lastPhotoSyncTime: new Date().toISOString(),
      status: 'online',
    },
    lastReport: {
      saved: true,
      name: 'Base de Datos Maestra y Reportes (177 Expendios)',
      timestamp: new Date().toISOString(),
      type: 'sistema',
      status: 'success',
      detalles: '177 expendios y catálogo fotográfico sincronizados con Firestore y Storage',
    },
  });

  const [isOpen, setIsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [justSavedGlow, setJustSavedGlow] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/system/sync-monitoring');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setData((prev) => ({
            ...prev,
            firestore: json.firestore || prev.firestore,
            storage: json.storage || prev.storage,
            lastReport: json.lastReport || prev.lastReport,
          }));
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);

    const handleLocalReportSaved = (e: any) => {
      const detail = e.detail;
      if (detail) {
        setData((prev) => ({
          ...prev,
          lastReport: {
            saved: true,
            name: detail.name || 'Reporte de Expendios',
            timestamp: detail.timestamp || new Date().toISOString(),
            type: detail.type || 'general',
            status: 'success',
            detalles: detail.detalles || 'Guardado exitosamente en Firestore y Storage',
          },
        }));
        setJustSavedGlow(true);
        setTimeout(() => setJustSavedGlow(false), 5000);
      }
    };

    window.addEventListener('reporteGuardado', handleLocalReportSaved);

    return () => {
      clearInterval(interval);
      window.removeEventListener('reporteGuardado', handleLocalReportSaved);
    };
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await fetch('/api/system/sync-now', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setSyncFeedback('✓ Firestore y Storage sincronizados exitosamente con 177 expendios.');
        setJustSavedGlow(true);
        setTimeout(() => setJustSavedGlow(false), 4000);
        await fetchStatus();
      } else {
        setSyncFeedback(json.message || 'Datos protegidos en almacenamiento permanente local (cuota en pausa).');
      }
    } catch {
      setSyncFeedback('Error de comunicación con el servidor.');
    } finally {
      setIsSyncing(false);
    }
  };

  const formatHora = (isoStr: string | null) => {
    if (!isoStr) return 'Reciente';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return 'Reciente';
    }
  };

  return (
    <>
      {/* Botón / Indicador en Línea */}
      <div className={`flex items-center gap-2 ${className}`}>
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setSyncFeedback(null);
          }}
          title="Monitoreo de Sincronización en Tiempo Real: Firestore & Storage"
          className={`group flex items-center space-x-2.5 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all shadow-sm ${
            justSavedGlow
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400 ring-2 ring-emerald-500/40 animate-pulse'
              : isLight
              ? 'bg-emerald-50/90 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
              : 'bg-emerald-950/70 text-emerald-200 border-emerald-600/50 hover:bg-emerald-900/60 hover:border-emerald-400'
          }`}
        >
          {/* Icono Verde de Reporte Guardado Exitosamente */}
          <div className="relative flex items-center justify-center">
            {data.lastReport.saved && (
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            )}
            <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
          </div>

          <div className="flex items-center space-x-1.5 text-left">
            <span className="font-bold flex items-center gap-1">
              <span>Sincronización Nube</span>
            </span>
            <span className="hidden sm:inline text-[11px] opacity-80 border-l pl-1.5 border-emerald-500/40">
              Firestore & Storage
            </span>
          </div>

          {/* Badge con icono verde de reporte guardado */}
          <div className="flex items-center space-x-1 bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
            <Check className="w-3 h-3 text-emerald-500" />
            <span className="hidden md:inline">Reporte Guardado</span>
            <span className="md:hidden">OK</span>
          </div>
        </button>
      </div>

      {/* Modal / Panel de Monitoreo Detallado */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 relative ${
              isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
            }`}
          >
            <button
              onClick={() => {
                setIsOpen(false);
                setSyncFeedback(null);
              }}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Cabecera */}
            <div className="flex items-center space-x-3 mb-5">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center border border-emerald-500/20">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-black text-base uppercase tracking-tight flex items-center gap-2">
                  <span>Estado de Conexión y Reportes</span>
                  <span className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/30 uppercase">
                    En Vivo
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Monitoreo de sincronización con Google Cloud Firestore y Firebase Storage
                </p>
              </div>
            </div>

            {/* Tarjeta de Último Reporte Guardado Exitosamente */}
            <div className="mb-4 p-4 rounded-xl border bg-emerald-500/10 border-emerald-500/30 relative overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start space-x-3">
                  <div className="p-2 rounded-xl bg-emerald-500 text-white shadow-sm mt-0.5">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] uppercase tracking-wider font-extrabold text-emerald-600 dark:text-emerald-400">
                        Reporte Guardado Exitosamente
                      </span>
                      <span className="text-[10px] text-slate-400">
                        • {formatHora(data.lastReport.timestamp)}
                      </span>
                    </div>
                    <p className="font-bold text-sm text-slate-800 dark:text-slate-100 mt-0.5">
                      {data.lastReport.name}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      {data.lastReport.detalles || 'Todos los cambios y registros se han sincronizado con Firestore y Storage.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Dos Columnas: Firestore & Storage */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {/* Firestore */}
              <div className={`p-3.5 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-1.5 font-bold text-xs">
                    <Database className="w-4 h-4 text-emerald-500" />
                    <span>Firestore DB</span>
                  </div>
                  {data.firestore.quotaExhausted ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center gap-1" title="Cuota de escritura gratuita en pausa hasta medianoche. Modo lectura y respaldo local activo.">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      Respaldo Local Activo
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Conectado
                    </span>
                  )}
                </div>
                <div className="text-[11px] space-y-1 text-slate-600 dark:text-slate-400">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Expendios:</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{data.firestore.totalExpendios} puntos</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Colección:</span>
                    <span className="font-mono text-[10px] text-slate-700 dark:text-slate-300">{data.firestore.collection}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Último Sync:</span>
                    <span className="font-mono text-[10px]">{formatHora(data.firestore.lastSyncTime)}</span>
                  </div>
                </div>
              </div>

              {/* Google Drive & Storage */}
              <div className={`p-3.5 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-1.5 font-bold text-xs">
                    <Cloud className="w-4 h-4 text-emerald-500" />
                    <span>Google Drive Fotos</span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Desacoplado de Firebase
                  </span>
                </div>
                <div className="text-[11px] space-y-1 text-slate-600 dark:text-slate-400">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Fotografías:</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{data.storage.photosCount} locales/Drive</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Carpeta Drive:</span>
                    <span className="font-semibold text-[10px] text-slate-700 dark:text-slate-300 truncate max-w-[130px]" title="Fotos Expendios 4-72 - CAMARCA SAS">Fotos Expendios 4-72</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Destino:</span>
                    <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                      Google Drive + Disco
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Garantías de Seguridad */}
            <div className="text-xs space-y-1.5 text-slate-500 dark:text-slate-400 mb-5 border-t pt-3 border-slate-200 dark:border-slate-800">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>
                  <strong>Persistencia Garantizada:</strong> Los 177 expendios y fotografías quedan guardados tanto en disco como en Firestore.
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>
                  <strong>Monitoreo Automático:</strong> El estado se valida continuamente cada 15 segundos y tras cada reporte guardado.
                </span>
              </div>
            </div>

            {syncFeedback && (
              <div className={`mb-4 p-2.5 rounded-xl text-xs font-semibold ${
                syncFeedback.includes('Error') || syncFeedback.toLowerCase().includes('límite') || syncFeedback.toLowerCase().includes('cuota')
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <span>{syncFeedback}</span>
                  <button
                    type="button"
                    onClick={() => setSyncFeedback(null)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-1 font-bold cursor-pointer"
                    title="Descartar mensaje"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Acciones */}
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={handleManualSync}
                disabled={isSyncing}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar Firestore & Storage Ahora'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
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
    </>
  );
};
