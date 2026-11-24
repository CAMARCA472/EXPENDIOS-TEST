import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Search,
  Filter,
  Download,
  Trash2,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  BookOpen,
  Activity,
  Terminal,
  MapPin,
  User,
  Clock,
  Layers,
  HelpCircle,
  HardDrive,
  CloudUpload,
} from 'lucide-react';
import { ErrorCategory, ErrorSeverity, PlatformErrorCatalogItem, PlatformErrorLog } from '../../server/errorLogService';
import {
  ClientStoredErrorRecord,
  getClientStoredErrors,
  clearClientStoredErrors,
  deleteClientStoredError,
  syncPendingErrorsToServer,
} from '../lib/clientErrorStorageDB';

interface AdminErrorCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshParent?: () => void;
}

export const AdminErrorCenterModal: React.FC<AdminErrorCenterModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'logs' | 'client-db'>('catalog');
  const [catalog, setCatalog] = useState<PlatformErrorCatalogItem[]>([]);
  const [logs, setLogs] = useState<PlatformErrorLog[]>([]);
  const [clientLogs, setClientLogs] = useState<ClientStoredErrorRecord[]>([]);
  const [stats, setStats] = useState<{ total: number; resolved: number; pending: number; critical: number; high: number }>({
    total: 0,
    resolved: 0,
    pending: 0,
    critical: 0,
    high: 0,
  });
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(false);
  const [loadingClientLogs, setLoadingClientLogs] = useState<boolean>(false);
  const [isSyncingClientLogs, setIsSyncingClientLogs] = useState<boolean>(false);

  // Filters
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [catalogCategory, setCatalogCategory] = useState<string>('ALL');
  const [catalogSeverity, setCatalogSeverity] = useState<string>('ALL');

  const [logSearch, setLogSearch] = useState<string>('');
  const [logSeverity, setLogSeverity] = useState<string>('ALL');
  const [logStatus, setLogStatus] = useState<string>('ALL');

  const [clientSearch, setClientSearch] = useState<string>('');
  const [clientSeverity, setClientSeverity] = useState<string>('ALL');

  // Expanded log items for technical details
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [expandedClientLogId, setExpandedClientLogId] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      fetchCatalog();
      fetchLogs();
      fetchClientLogs();

      const onClientErrorLogged = () => {
        fetchClientLogs();
      };
      window.addEventListener('camarca_client_error_logged', onClientErrorLogged);
      return () => {
        window.removeEventListener('camarca_client_error_logged', onClientErrorLogged);
      };
    }
  }, [isOpen]);

  const fetchClientLogs = async () => {
    try {
      setLoadingClientLogs(true);
      const records = await getClientStoredErrors(200);
      setClientLogs(records);
    } catch (e) {
      console.error('Error cargando logs de IndexedDB:', e);
    } finally {
      setLoadingClientLogs(false);
    }
  };

  const handleSyncClientLogs = async () => {
    try {
      setIsSyncingClientLogs(true);
      const res = await syncPendingErrorsToServer();
      await fetchClientLogs();
      await fetchLogs();
      setActionSuccessMsg(`✓ Sincronización completa: ${res.synced} de ${res.total} errores sincronizados al servidor.`);
      setTimeout(() => setActionSuccessMsg(''), 4000);
    } catch (e: any) {
      console.error('Error sincronizando a servidor:', e);
    } finally {
      setIsSyncingClientLogs(false);
    }
  };

  const handleClearClientLogs = async () => {
    if (!window.confirm('¿Deseas vaciar todos los registros de errores almacenados en la base de datos IndexedDB local de este navegador?')) return;
    try {
      await clearClientStoredErrors();
      setClientLogs([]);
      setActionSuccessMsg('✓ Base de datos IndexedDB de errores locales vaciada.');
      setTimeout(() => setActionSuccessMsg(''), 4000);
    } catch (e: any) {
      console.error('Error vaciando IndexedDB:', e);
    }
  };

  const handleDeleteClientLog = async (id?: number) => {
    if (!id) return;
    try {
      await deleteClientStoredError(id);
      setClientLogs((prev) => prev.filter((item) => item.id !== id));
      setActionSuccessMsg(`✓ Registro local #${id} eliminado.`);
      setTimeout(() => setActionSuccessMsg(''), 3000);
    } catch (e: any) {
      console.error('Error eliminando registro local:', e);
    }
  };

  const fetchCatalog = async () => {
    try {
      setLoadingCatalog(true);
      const res = await fetch('/api/admin/error-catalog');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.catalog)) {
          setCatalog(data.catalog);
        }
      }
    } catch (e) {
      console.error('Error cargando catálogo de errores:', e);
    } finally {
      setLoadingCatalog(false);
    }
  };

  const fetchLogs = async () => {
    try {
      setLoadingLogs(true);
      const res = await fetch('/api/admin/error-logs');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.logs)) {
          setLogs(data.logs);
          if (data.stats) setStats(data.stats);
        }
      }
    } catch (e) {
      console.error('Error cargando logs de errores:', e);
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleResolve = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/error-logs/${encodeURIComponent(id)}/resolve`, {
        method: 'PUT',
      });
      if (res.ok) {
        setLogs((prev) =>
          prev.map((l) => (l.id === id ? { ...l, resolved: true, resolvedAt: new Date().toISOString(), resolvedBy: 'Admin' } : l))
        );
        setStats((prev) => ({
          ...prev,
          resolved: prev.resolved + 1,
          pending: Math.max(0, prev.pending - 1),
        }));
        setActionSuccessMsg(`✓ Incidencia ${id} marcada como resuelta.`);
        setTimeout(() => setActionSuccessMsg(''), 4000);
      }
    } catch (e: any) {
      console.error('Error resolviendo log:', e);
    }
  };

  const handleClearLogs = async () => {
    if (!window.confirm('¿Deseas vaciar el historial de errores registrados?')) return;
    try {
      const res = await fetch('/api/admin/error-logs', { method: 'DELETE' });
      if (res.ok) {
        setLogs([]);
        setStats({ total: 0, resolved: 0, pending: 0, critical: 0, high: 0 });
        setActionSuccessMsg('✓ Historial de errores vaciado.');
        setTimeout(() => setActionSuccessMsg(''), 4000);
      }
    } catch (e: any) {
      console.error('Error vaciando logs:', e);
    }
  };

  const handleDownloadLogsJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute('href', dataStr);
    dlAnchorElem.setAttribute('download', `camarca_error_logs_${new Date().toISOString().split('T')[0]}.json`);
    dlAnchorElem.click();
  };

  // Filtered Catalog
  const filteredCatalog = useMemo(() => {
    return catalog.filter((item) => {
      if (catalogCategory !== 'ALL' && item.category !== catalogCategory) return false;
      if (catalogSeverity !== 'ALL' && item.severity !== catalogSeverity) return false;
      if (!catalogSearch.trim()) return true;
      const term = catalogSearch.toLowerCase();
      return (
        item.code.toLowerCase().includes(term) ||
        item.name.toLowerCase().includes(term) ||
        item.userFriendlyMessage.toLowerCase().includes(term) ||
        item.technicalCause.toLowerCase().includes(term)
      );
    });
  }, [catalog, catalogSearch, catalogCategory, catalogSeverity]);

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (logSeverity !== 'ALL' && log.severity !== logSeverity) return false;
      if (logStatus === 'PENDING' && log.resolved) return false;
      if (logStatus === 'RESOLVED' && !log.resolved) return false;
      if (!logSearch.trim()) return true;
      const term = logSearch.toLowerCase();
      return (
        log.errorCode.toLowerCase().includes(term) ||
        log.errorName.toLowerCase().includes(term) ||
        (log.municipio && log.municipio.toLowerCase().includes(term)) ||
        (log.cedula && log.cedula.includes(term)) ||
        (log.expendioId && log.expendioId.toLowerCase().includes(term)) ||
        log.userMessage.toLowerCase().includes(term) ||
        log.technicalDetails.toLowerCase().includes(term)
      );
    });
  }, [logs, logSearch, logSeverity, logStatus]);

  // Filtered Client Logs (IndexedDB)
  const filteredClientLogs = useMemo(() => {
    return clientLogs.filter((log) => {
      if (clientSeverity !== 'ALL' && log.severity !== clientSeverity) return false;
      if (!clientSearch.trim()) return true;
      const term = clientSearch.toLowerCase();
      return (
        log.errorCode.toLowerCase().includes(term) ||
        (log.errorName && log.errorName.toLowerCase().includes(term)) ||
        (log.municipio && log.municipio.toLowerCase().includes(term)) ||
        (log.cedula && log.cedula.includes(term)) ||
        (log.expendioId && log.expendioId.toLowerCase().includes(term)) ||
        log.userMessage.toLowerCase().includes(term) ||
        log.technicalDetails.toLowerCase().includes(term) ||
        log.source.toLowerCase().includes(term)
      );
    });
  }, [clientLogs, clientSearch, clientSeverity]);

  if (!isOpen) return null;

  const getSeverityBadge = (severity: ErrorSeverity) => {
    switch (severity) {
      case 'CRITICO':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-red-500/20 text-red-400 border border-red-500/30">
            <ShieldAlert className="w-3 h-3" /> Crítico
          </span>
        );
      case 'ALTO':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3" /> Alto
          </span>
        );
      case 'MEDIO':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-400 border border-sky-500/30">
            <AlertCircle className="w-3 h-3" /> Medio
          </span>
        );
      case 'INFORMATIVO':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-slate-500/20 text-slate-300 border border-slate-500/30">
            <Info className="w-3 h-3" /> Informativo
          </span>
        );
    }
  };

  const getCategoryBadge = (category: ErrorCategory | string) => {
    const labels: Record<string, { label: string; color: string }> = {
      FOTOS_S3: { label: 'Fotos AWS S3', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
      CUENTAS_COBRO: { label: 'Cuentas de Cobro', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
      AUTENTICACION: { label: 'Autenticación / Sesión', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
      CAMARA_GPS: { label: 'Cámara y GPS', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
      OFFLINE_SYNC: { label: 'Sincronización Offline', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
      BASE_DATOS: { label: 'Base de Datos', color: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
      RENDER_CRASH: { label: 'Renderizado React', color: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
      UNHANDLED_EXCEPTION: { label: 'Excepción Asíncrona', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
      GENERAL: { label: 'General / Conectividad', color: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
    };
    const c = labels[category] || { label: category, color: 'bg-slate-700 text-slate-200 border-slate-600' };
    return (
      <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-md border ${c.color}`}>
        {c.label}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950/60">
          <div className="flex items-start space-x-3.5">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base sm:text-lg font-black text-slate-100">
                  Centro de Errores y Diagnóstico de la Plataforma
                </h3>
                <span className="text-[11px] bg-slate-800 text-amber-400 px-2 py-0.5 rounded-full font-mono border border-slate-700">
                  Auditoría Oficial
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Catálogo de referencia de posibles errores de la plataforma y registro en vivo de incidencias reportadas.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-end sm:self-center">
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
              title="Cerrar ventana"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action success feedback */}
        {actionSuccessMsg && (
          <div className="bg-emerald-500/20 border-b border-emerald-500/30 px-6 py-2.5 text-xs text-emerald-300 font-bold flex items-center space-x-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
        )}

        {/* Sub-header / Metrics / Navigation Tabs */}
        <div className="px-4 sm:px-6 pt-4 border-b border-slate-800 bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-2 overflow-x-auto pb-2 sm:pb-0">
            <button
              type="button"
              onClick={() => setActiveTab('catalog')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 flex items-center space-x-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'catalog'
                  ? 'border-amber-400 text-amber-400 font-black'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>1. Catálogo Oficial ({catalog.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 flex items-center space-x-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'logs'
                  ? 'border-amber-400 text-amber-400 font-black'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>2. Incidencias Servidor ({logs.length})</span>
              {stats.pending > 0 && (
                <span className="text-[10px] bg-red-500 text-white font-black px-1.5 py-0.2 rounded-full">
                  {stats.pending}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('client-db')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 flex items-center space-x-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'client-db'
                  ? 'border-cyan-400 text-cyan-400 font-black'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <HardDrive className="w-4 h-4" />
              <span>3. Cliente IndexedDB ({clientLogs.length})</span>
              {clientLogs.some((l) => !l.syncedToServer) && (
                <span className="text-[10px] bg-amber-500 text-slate-950 font-black px-1.5 py-0.2 rounded-full" title="Pendientes de sincronizar">
                  {clientLogs.filter((l) => !l.syncedToServer).length}
                </span>
              )}
            </button>
          </div>

          {/* Quick Metrics Bar */}
          <div className="pb-3 flex flex-wrap items-center gap-2 text-xs font-mono">
            <div className="bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-slate-300 flex items-center gap-1.5">
              <span className="text-slate-500">Servidor:</span>
              <span className="font-bold text-white">{stats.total}</span>
            </div>
            <div className="bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-cyan-300 flex items-center gap-1.5">
              <span className="text-slate-500">IndexedDB:</span>
              <span className="font-bold text-cyan-400">{clientLogs.length}</span>
            </div>
            {stats.critical > 0 && (
              <div className="bg-red-950/40 px-2.5 py-1 rounded-lg border border-red-500/30 text-red-300 font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                <span>{stats.critical} Críticos</span>
              </div>
            )}
            <div className="bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-500/30 text-emerald-300 flex items-center gap-1.5">
              <span>{stats.resolved} Resueltos</span>
            </div>
          </div>
        </div>

        {/* TAB 1: CATÁLOGO OFICIAL DE ERRORES */}
        {activeTab === 'catalog' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {/* Filter Bar */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar error por código (ej: PHOTO_S3), nombre, causa o mensaje..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center space-x-1.5 text-xs text-slate-400">
                  <Filter className="w-3.5 h-3.5" />
                  <span>Categoría:</span>
                  <select
                    value={catalogCategory}
                    onChange={(e) => setCatalogCategory(e.target.value)}
                    className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="ALL">Todas las categorías</option>
                    <option value="FOTOS_S3">Fotos AWS S3</option>
                    <option value="CUENTAS_COBRO">Cuentas de Cobro</option>
                    <option value="AUTENTICACION">Autenticación</option>
                    <option value="CAMARA_GPS">Cámara y GPS</option>
                    <option value="OFFLINE_SYNC">Sincronización Offline</option>
                    <option value="BASE_DATOS">Base de Datos</option>
                    <option value="GENERAL">General</option>
                  </select>
                </div>

                <div className="flex items-center space-x-1.5 text-xs text-slate-400">
                  <span>Severidad:</span>
                  <select
                    value={catalogSeverity}
                    onChange={(e) => setCatalogSeverity(e.target.value)}
                    className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="ALL">Todas</option>
                    <option value="CRITICO">Crítico</option>
                    <option value="ALTO">Alto</option>
                    <option value="MEDIO">Medio</option>
                    <option value="INFORMATIVO">Informativo</option>
                  </select>
                </div>
              </div>
            </div>

            {loadingCatalog ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-400" />
                <p className="text-xs">Cargando catálogo oficial de errores...</p>
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="p-12 text-center text-slate-500 space-y-2 bg-slate-950/40 rounded-xl border border-slate-800/60">
                <HelpCircle className="w-8 h-8 mx-auto text-slate-600" />
                <p className="text-xs font-semibold">No se encontraron errores que coincidan con la búsqueda.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3.5">
                {filteredCatalog.map((item) => (
                  <div
                    key={item.code}
                    className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4 sm:p-5 space-y-3 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                      <div className="flex items-center space-x-2.5 flex-wrap">
                        <code className="text-xs font-black font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          {item.code}
                        </code>
                        <span className="text-sm font-bold text-slate-100">{item.name}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        {getCategoryBadge(item.category)}
                        {getSeverityBadge(item.severity)}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {/* Qué ve el expendio */}
                      <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800 space-y-1">
                        <div className="text-[11px] font-bold text-emerald-400 flex items-center space-x-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Mensaje que ve el expendio (Humano y comprensible):</span>
                        </div>
                        <p className="text-slate-300 italic leading-relaxed">
                          "{item.userFriendlyMessage}"
                        </p>
                      </div>

                      {/* Causa técnica real */}
                      <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800 space-y-1">
                        <div className="text-[11px] font-bold text-sky-400 flex items-center space-x-1">
                          <Terminal className="w-3.5 h-3.5" />
                          <span>Causa técnica interna:</span>
                        </div>
                        <p className="text-slate-400 leading-relaxed font-mono text-[11px]">
                          {item.technicalCause}
                        </p>
                      </div>
                    </div>

                    {/* Pasos de resolución para Administrador */}
                    <div className="bg-amber-950/20 p-3 rounded-lg border border-amber-900/40 text-xs space-y-1.5">
                      <div className="font-bold text-amber-300 text-[11px] flex items-center space-x-1.5">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                        <span>Protocolo de Solución para Administrador / Soporte Técnico:</span>
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-slate-300 pl-1">
                        {item.resolutionSteps.map((step, idx) => (
                          <li key={idx} className="leading-relaxed">
                            {step}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: REGISTRO EN VIVO DE INCIDENCIAS */}
        {activeTab === 'logs' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {/* Filter and Action Bar */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filtrar por municipio, cédula, código de error o detalle..."
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={logSeverity}
                  onChange={(e) => setLogSeverity(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="ALL">Todas las severidades</option>
                  <option value="CRITICO">Crítico</option>
                  <option value="ALTO">Alto</option>
                  <option value="MEDIO">Medio</option>
                  <option value="INFORMATIVO">Informativo</option>
                </select>

                <select
                  value={logStatus}
                  onChange={(e) => setLogStatus(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="ALL">Todos los estados</option>
                  <option value="PENDING">Pendientes</option>
                  <option value="RESOLVED">Resueltos</option>
                </select>

                <button
                  type="button"
                  onClick={fetchLogs}
                  disabled={loadingLogs}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                  title="Recargar logs"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingLogs ? 'animate-spin' : ''}`} />
                </button>

                <button
                  type="button"
                  onClick={handleDownloadLogsJson}
                  disabled={logs.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-50"
                  title="Descargar logs en formato JSON"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Exportar</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearLogs}
                  disabled={logs.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/80 text-red-300 font-semibold text-xs flex items-center space-x-1 border border-red-800/60 transition-colors cursor-pointer disabled:opacity-50"
                  title="Limpiar registro de logs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Vaciar</span>
                </button>
              </div>
            </div>

            {loadingLogs ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-400" />
                <p className="text-xs">Cargando incidencias registradas...</p>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="p-12 text-center text-slate-500 space-y-2 bg-slate-950/40 rounded-xl border border-slate-800/60">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
                <p className="text-sm font-bold text-slate-300">¡Sin incidencias activas!</p>
                <p className="text-xs text-slate-500">No se registran errores recientes en la plataforma.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <div
                      key={log.id}
                      className={`rounded-xl border transition-all ${
                        log.resolved
                          ? 'bg-slate-950/40 border-slate-800/60 opacity-80'
                          : log.severity === 'CRITICO'
                          ? 'bg-red-950/20 border-red-500/40 shadow-sm'
                          : log.severity === 'ALTO'
                          ? 'bg-amber-950/20 border-amber-500/40'
                          : 'bg-slate-950 border-slate-800'
                      }`}
                    >
                      <div className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex items-center space-x-2 flex-wrap">
                            <span className="font-mono text-[11px] text-slate-400">
                              {new Date(log.timestamp).toLocaleString('es-CO')}
                            </span>
                            <span className="text-slate-600">·</span>
                            <code className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                              {log.errorCode}
                            </code>
                            <span className="text-xs font-bold text-slate-100">{log.errorName}</span>
                            {getCategoryBadge(log.category)}
                            {getSeverityBadge(log.severity)}
                            {log.resolved && (
                              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.2 rounded">
                                Resuelto
                              </span>
                            )}
                          </div>

                          <div className="flex items-center space-x-3 text-xs text-slate-400 flex-wrap">
                            {log.municipio && (
                              <span className="flex items-center space-x-1">
                                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                                <strong className="text-slate-200">{log.municipio}</strong>
                              </span>
                            )}
                            {log.cedula && (
                              <span className="flex items-center space-x-1 font-mono text-[11px]">
                                <User className="w-3 h-3 text-slate-500" />
                                <span>C.C. {log.cedula}</span>
                              </span>
                            )}
                            {log.source && (
                              <span className="text-[11px] text-slate-500">
                                Origen: <span className="font-mono text-slate-300">{log.source}</span>
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-slate-300 bg-slate-900/60 p-2 rounded border border-slate-800/80">
                            <span className="text-slate-500 font-semibold mr-1">Mensaje usuario:</span>
                            {log.userMessage}
                          </p>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                          {!log.resolved && (
                            <button
                              type="button"
                              onClick={() => handleResolve(log.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center space-x-1 transition-colors cursor-pointer shadow-xs"
                              title="Marcar como resuelto"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Resolver</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs flex items-center space-x-1 transition-colors cursor-pointer"
                          >
                            <span>Detalle Técnico</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Technical Details Accordion */}
                      {isExpanded && (
                        <div className="p-3.5 border-t border-slate-800 bg-black/60 rounded-b-xl space-y-2 animate-fadeIn text-xs">
                          <div className="flex items-center justify-between text-slate-400 font-mono text-[11px]">
                            <span>ID Log: {log.id}</span>
                            {log.resolvedAt && (
                              <span>
                                Resuelto el {new Date(log.resolvedAt).toLocaleString('es-CO')} por {log.resolvedBy}
                              </span>
                            )}
                          </div>
                          <pre className="font-mono text-[11px] text-amber-200/90 whitespace-pre-wrap break-all bg-slate-950 p-2.5 rounded border border-slate-800 overflow-x-auto">
                            {log.technicalDetails}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: EXCEPCIONES LOCALES CLIENTE INDEXEDDB */}
        {activeTab === 'client-db' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {/* Filter and Action Bar */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar en IndexedDB por código, mensaje, municipio o causa..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={clientSeverity}
                  onChange={(e) => setClientSeverity(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-cyan-500 cursor-pointer"
                >
                  <option value="ALL">Todas las severidades</option>
                  <option value="CRITICO">Crítico</option>
                  <option value="ALTO">Alto</option>
                  <option value="MEDIO">Medio</option>
                  <option value="INFORMATIVO">Informativo</option>
                </select>

                <button
                  type="button"
                  onClick={fetchClientLogs}
                  disabled={loadingClientLogs}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                  title="Recargar logs de IndexedDB"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingClientLogs ? 'animate-spin' : ''}`} />
                </button>

                <button
                  type="button"
                  onClick={handleSyncClientLogs}
                  disabled={isSyncingClientLogs || clientLogs.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
                  title="Sincronizar excepciones pendientes al servidor central"
                >
                  <CloudUpload className={`w-3.5 h-3.5 ${isSyncingClientLogs ? 'animate-bounce' : ''}`} />
                  <span>{isSyncingClientLogs ? 'Sincronizando...' : 'Sincronizar a Servidor'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearClientLogs}
                  disabled={clientLogs.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/80 text-red-300 font-semibold text-xs flex items-center space-x-1 border border-red-800/60 transition-colors cursor-pointer disabled:opacity-50"
                  title="Vaciar IndexedDB de errores locales"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Vaciar DB</span>
                </button>
              </div>
            </div>

            {loadingClientLogs ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-cyan-400" />
                <p className="text-xs">Consultando base de datos IndexedDB local...</p>
              </div>
            ) : filteredClientLogs.length === 0 ? (
              <div className="p-12 text-center text-slate-500 space-y-2 bg-slate-950/40 rounded-xl border border-slate-800/60">
                <HardDrive className="w-8 h-8 mx-auto text-cyan-500/60" />
                <p className="text-sm font-bold text-slate-300">¡IndexedDB Limpia!</p>
                <p className="text-xs text-slate-500">
                  No se registran excepciones críticas almacenadas localmente en este navegador.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredClientLogs.map((item) => {
                  const isExpanded = expandedClientLogId === item.uuid;
                  return (
                    <div
                      key={item.uuid}
                      className={`rounded-xl border transition-all ${
                        item.severity === 'CRITICO'
                          ? 'bg-rose-950/20 border-rose-500/40 shadow-sm'
                          : 'bg-slate-950 border-slate-800'
                      }`}
                    >
                      <div className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex items-center space-x-2 flex-wrap">
                            <span className="font-mono text-[11px] text-slate-400">
                              {new Date(item.timestamp).toLocaleString('es-CO')}
                            </span>
                            <span className="text-slate-600">·</span>
                            <code className="text-xs font-mono font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                              {item.errorCode}
                            </code>
                            {item.errorName && (
                              <span className="text-xs font-bold text-slate-200">{item.errorName}</span>
                            )}
                            {getCategoryBadge(item.category)}
                            {getSeverityBadge(item.severity)}

                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              {item.source}
                            </span>

                            {item.syncedToServer ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.2 rounded">
                                <CheckCircle2 className="w-3 h-3" /> Sincronizado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.2 rounded">
                                <Clock className="w-3 h-3" /> Solo Local
                              </span>
                            )}
                          </div>

                          <div className="flex items-center space-x-3 text-xs text-slate-400 flex-wrap">
                            {item.municipio && (
                              <span className="flex items-center space-x-1">
                                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                                <strong className="text-slate-200">{item.municipio}</strong>
                              </span>
                            )}
                            {item.cedula && (
                              <span className="flex items-center space-x-1 font-mono text-[11px]">
                                <User className="w-3 h-3 text-slate-500" />
                                <span>C.C. {item.cedula}</span>
                              </span>
                            )}
                            {item.url && (
                              <span className="text-[11px] text-slate-500 truncate max-w-xs" title={item.url}>
                                Ruta: <span className="font-mono text-slate-400">{item.url.replace(window.location.origin, '')}</span>
                              </span>
                            )}
                          </div>

                          <div className="bg-slate-900/70 p-2.5 rounded-lg border border-slate-800 text-xs">
                            <span className="text-emerald-400 font-bold block text-[11px] mb-0.5">
                              Mensaje presentado al usuario (Sin jerga técnica):
                            </span>
                            <p className="text-slate-300 italic">"{item.userMessage}"</p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                          {item.id && (
                            <button
                              type="button"
                              onClick={() => handleDeleteClientLog(item.id)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition-colors cursor-pointer"
                              title="Eliminar de IndexedDB"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setExpandedClientLogId(isExpanded ? null : item.uuid)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs flex items-center space-x-1 transition-colors cursor-pointer"
                          >
                            <span>Detalle Técnico</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Technical Details Accordion */}
                      {isExpanded && (
                        <div className="p-3.5 border-t border-slate-800 bg-black/60 rounded-b-xl space-y-2.5 animate-fadeIn text-xs">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400 font-mono">
                            <div>UUID: <span className="text-slate-200">{item.uuid}</span></div>
                            <div>Navegador: <span className="text-slate-300 truncate block">{item.userAgent}</span></div>
                          </div>

                          <div>
                            <span className="text-slate-400 font-mono text-[11px] block mb-1">Causa Técnica / Detalles:</span>
                            <pre className="font-mono text-[11px] text-cyan-200/90 whitespace-pre-wrap break-all bg-slate-950 p-2.5 rounded border border-slate-800 overflow-x-auto max-h-48">
                              {item.technicalDetails}
                            </pre>
                          </div>

                          {item.stackTrace && (
                            <div>
                              <span className="text-slate-400 font-mono text-[11px] block mb-1">Stack Trace:</span>
                              <pre className="font-mono text-[10px] text-red-300/80 whitespace-pre-wrap break-all bg-slate-950 p-2 rounded border border-slate-800 overflow-x-auto max-h-40">
                                {item.stackTrace}
                              </pre>
                            </div>
                          )}

                          {item.componentStack && (
                            <div>
                              <span className="text-slate-400 font-mono text-[11px] block mb-1">React Component Stack:</span>
                              <pre className="font-mono text-[10px] text-amber-300/80 whitespace-pre-wrap break-all bg-slate-950 p-2 rounded border border-slate-800 overflow-x-auto max-h-40">
                                {item.componentStack}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Los errores del panel del expendio se anonimizan y se registran automáticamente aquí.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition-colors cursor-pointer"
          >
            Cerrar Diagnóstico
          </button>
        </div>
      </div>
    </div>
  );
};
