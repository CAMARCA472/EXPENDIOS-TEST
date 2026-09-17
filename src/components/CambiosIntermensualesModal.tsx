import React, { useState } from 'react';
import { formatCuentaBancaria } from '../utils/formatters';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Users,
  CreditCard,
  FileText,
  DollarSign,
  Search,
  Filter,
  RefreshCw,
  ShieldCheck,
  CheckCheck,
  Building,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { CambioIntermensual, DetalleCambioCampo, PagoRelacionItem } from '../types';

interface CambiosIntermensualesModalProps {
  isOpen: boolean;
  onClose: () => void;
  cambios: CambioIntermensual[];
  mesActual: string;
  anioActual: string;
  mesAnterior: string;
  anioAnterior: string;
  onAprobarIndividual: (cambio: CambioIntermensual, revertir: boolean, actualizarMaestro: boolean) => Promise<void>;
  onAprobarTodos: (cambiosAprobar: CambioIntermensual[]) => Promise<void>;
  isProcessing: boolean;
}

export const CambiosIntermensualesModal: React.FC<CambiosIntermensualesModalProps> = ({
  isOpen,
  onClose,
  cambios,
  mesActual,
  anioActual,
  mesAnterior,
  anioAnterior,
  onAprobarIndividual,
  onAprobarTodos,
  isProcessing,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filtroTipo, setFiltroTipo] = useState<string>('TODOS');
  const [filtroEstado, setFiltroEstado] = useState<string>('TODOS');
  const [actualizarMaestroMap, setActualizarMaestroMap] = useState<{ [id: string]: boolean }>({});

  if (!isOpen) return null;

  const handleToggleMaestro = (id: string) => {
    setActualizarMaestroMap((prev) => ({
      ...prev,
      [id]: prev[id] !== undefined ? !prev[id] : false, // Default is true, so first toggle makes it false
    }));
  };

  const isMaestroChecked = (id: string) => {
    return actualizarMaestroMap[id] !== undefined ? actualizarMaestroMap[id] : true;
  };

  // Filter items
  const filteredCambios = cambios.filter((c) => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      (c.municipio || '').toLowerCase().includes(term) ||
      (c.centroOperativo || '').toLowerCase().includes(term) ||
      (c.itemActual?.nombreEncargado || '').toLowerCase().includes(term) ||
      (c.itemAnterior?.nombreEncargado || '').toLowerCase().includes(term) ||
      (c.itemActual?.cedula || '').includes(term) ||
      (c.itemAnterior?.cedula || '').includes(term);

    if (!matchesSearch) return false;

    if (filtroEstado !== 'TODOS' && c.estadoAprobacion !== filtroEstado) return false;

    if (filtroTipo === 'ENCARGADO' && !c.cambios.some((ch) => ch.campo === 'encargado')) return false;
    if (filtroTipo === 'CEDULA' && !c.cambios.some((ch) => ch.campo === 'cedula')) return false;
    if (filtroTipo === 'CUENTA' && !c.cambios.some((ch) => ch.campo === 'cuenta')) return false;
    if (filtroTipo === 'VALOR' && !c.cambios.some((ch) => ch.campo === 'valor')) return false;

    return true;
  });

  const countPendientes = cambios.filter((c) => c.estadoAprobacion === 'Pendiente').length;
  const countAprobados = cambios.filter((c) => c.estadoAprobacion === 'Aprobado').length;

  const formatCurrency = (val: string | number) => {
    const num = typeof val === 'number' ? val : Number(String(val).replace(/[^0-9]/g, '')) || 0;
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(num);
  };

  const getFieldIcon = (campo: string) => {
    switch (campo) {
      case 'encargado':
        return <Users className="w-4 h-4 text-amber-400" />;
      case 'cedula':
        return <FileText className="w-4 h-4 text-sky-400" />;
      case 'cuenta':
        return <CreditCard className="w-4 h-4 text-emerald-400" />;
      case 'valor':
        return <DollarSign className="w-4 h-4 text-purple-400" />;
      default:
        return <RefreshCw className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner">
              <RefreshCw className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-slate-100">
                  Auditoría y Validación de Cambios Intermensuales
                </h2>
                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                  {cambios.length} cambios detectados
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Comparación automática entre <strong className="text-slate-200">{mesAnterior} {anioAnterior}</strong> y{' '}
                <strong className="text-amber-300">{mesActual} {anioActual}</strong>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-2 rounded-xl hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Filters and Stats Bar */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por municipio, encargado, cédula..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
            <div className="flex items-center space-x-1 text-xs">
              <span className="text-slate-400 font-medium">Filtrar por:</span>
              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="TODOS">Todos los tipos de cambio</option>
                <option value="ENCARGADO">👤 Cambio de Encargado</option>
                <option value="CEDULA">🪪 Cambio de Cédula</option>
                <option value="CUENTA">💳 Cambio de Cuenta Bancaria / Nequi</option>
                <option value="VALOR">💲 Cambio de Monto / Valor</option>
              </select>
            </div>

            {countPendientes > 0 && (
              <button
                onClick={() => onAprobarTodos(cambios.filter((c) => c.estadoAprobacion === 'Pendiente'))}
                disabled={isProcessing}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-3.5 py-1.5 rounded-xl shadow-lg shadow-emerald-900/30 flex items-center space-x-1.5 transition-all disabled:opacity-50 cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Aprobar Todos ({countPendientes})</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Body: List of Changes */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4 max-h-[60vh]">
          {filteredCambios.length === 0 ? (
            <div className="text-center py-12 text-slate-500 bg-slate-950/30 border border-slate-800/80 rounded-2xl">
              <CheckCircle2 className="w-12 h-12 text-emerald-400/60 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-300">
                {searchTerm || filtroTipo !== 'TODOS'
                  ? 'No hay cambios que coincidan con los filtros aplicados.'
                  : '✓ Todos los datos coinciden exactamente con el mes anterior. No hay discrepancias.'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Encargados, cédulas, cuentas y valores están 100% validados.
              </p>
            </div>
          ) : (
            filteredCambios.map((cambio, index) => {
              const maestroChecked = isMaestroChecked(cambio.id);
              const isApproved = cambio.estadoAprobacion === 'Aprobado';
              const isReverted = cambio.estadoAprobacion === 'Rechazado';

              return (
                <div
                  key={cambio.id || index}
                  className={`border rounded-2xl p-5 transition-all ${
                    isApproved
                      ? 'bg-emerald-950/20 border-emerald-500/40 shadow-sm'
                      : isReverted
                      ? 'bg-rose-950/20 border-rose-500/40'
                      : 'bg-slate-950/60 border-slate-800 hover:border-amber-500/50 shadow-md'
                  }`}
                >
                  {/* Card Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-xs">
                        {cambio.itemActual?.consecutivo || index + 1}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-bold text-slate-100 text-sm">
                            {cambio.municipio}
                          </h3>
                          <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md font-semibold border border-slate-700">
                            {cambio.centroOperativo}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {cambio.cambios.length} discrepancia(s) detectada(s)
                        </p>
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className="flex items-center space-x-2">
                      {isApproved ? (
                        <span className="inline-flex items-center space-x-1 text-xs font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-700/60 px-2.5 py-1 rounded-lg">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Cambio Aprobado</span>
                        </span>
                      ) : isReverted ? (
                        <span className="inline-flex items-center space-x-1 text-xs font-bold text-rose-400 bg-rose-950/60 border border-rose-700/60 px-2.5 py-1 rounded-lg">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Datos Anteriores Mantenidos</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 text-xs font-bold text-amber-400 bg-amber-950/60 border border-amber-700/60 px-2.5 py-1 rounded-lg animate-pulse">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Pendiente de Validación</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Field Diffs */}
                  <div className="mt-4 space-y-3">
                    {cambio.cambios.map((ch, chIdx) => (
                      <div
                        key={chIdx}
                        className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3"
                      >
                        <div className="flex items-center space-x-2 md:w-1/4">
                          {getFieldIcon(ch.campo)}
                          <span className="text-xs font-semibold text-slate-300">
                            {ch.label}
                          </span>
                        </div>

                        {/* Diff Box: Before -> After */}
                        <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-2">
                          {/* Previous Value */}
                          <div className="bg-rose-950/30 border border-rose-800/40 rounded-lg px-3 py-1.5 text-xs flex-1 w-full">
                            <span className="text-[10px] text-rose-400 font-semibold block uppercase">
                              Anterior ({mesAnterior}):
                            </span>
                            <span className="text-rose-200 font-medium break-all">
                              {ch.campo === 'valor'
                                ? formatCurrency(ch.valorAnterior)
                                : ch.campo === 'cuenta'
                                ? formatCuentaBancaria(String(ch.valorAnterior)).cuenta
                                : String(ch.valorAnterior || '(Vacío)')}
                            </span>
                          </div>

                          <div className="text-amber-400 flex items-center justify-center px-1">
                            <ArrowRight className="w-4 h-4 transform rotate-90 sm:rotate-0" />
                          </div>

                          {/* Current Value */}
                          <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-lg px-3 py-1.5 text-xs flex-1 w-full">
                            <span className="text-[10px] text-emerald-400 font-semibold block uppercase">
                              Nuevo ({mesActual}):
                            </span>
                            <span className="text-emerald-200 font-bold break-all">
                              {ch.campo === 'valor'
                                ? formatCurrency(ch.valorActual)
                                : ch.campo === 'cuenta'
                                ? formatCuentaBancaria(String(ch.valorActual)).cuenta
                                : String(ch.valorActual || '(Vacío)')}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Master Sync Checkbox & Actions */}
                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={maestroChecked}
                        onChange={() => handleToggleMaestro(cambio.id)}
                        className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-amber-500 h-4 w-4"
                      />
                      <span>
                        Actualizar automáticamente la <strong>Ficha Maestra del Expendio</strong> con los nuevos datos
                      </span>
                    </label>

                    <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                      <button
                        onClick={() => onAprobarIndividual(cambio, true, false)}
                        disabled={isProcessing}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                        title="Descartar el cambio y conservar los datos del mes anterior"
                      >
                        ✕ Mantener Anterior
                      </button>

                      <button
                        onClick={() => onAprobarIndividual(cambio, false, maestroChecked)}
                        disabled={isProcessing}
                        className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-4 py-1.5 rounded-xl shadow-md shadow-amber-900/30 flex items-center space-x-1.5 transition-all disabled:opacity-50 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Aprobar Cambio</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-400 flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>
              {countAprobados} de {cambios.length} cambios aprobados para {mesActual} {anioActual}.
            </span>
          </div>

          <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="w-full sm:w-auto px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Cerrar y Volver a la Relación de Pagos
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Top Alert Banner Component
interface CambiosIntermensualesBannerProps {
  cambios: CambioIntermensual[];
  mesActual: string;
  anioActual: string;
  mesAnterior: string;
  anioAnterior: string;
  onOpenModal: () => void;
  onAprobarTodos: () => void;
  isProcessing: boolean;
}

export const CambiosIntermensualesBanner: React.FC<CambiosIntermensualesBannerProps> = ({
  cambios,
  mesActual,
  anioActual,
  mesAnterior,
  anioAnterior,
  onOpenModal,
  onAprobarTodos,
  isProcessing,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const pendientes = cambios.filter((c) => c.estadoAprobacion === 'Pendiente');
  if (pendientes.length === 0) return null;

  const countEncargados = pendientes.filter((c) => c.cambios.some((ch) => ch.campo === 'encargado')).length;
  const countCedulas = pendientes.filter((c) => c.cambios.some((ch) => ch.campo === 'cedula')).length;
  const countCuentas = pendientes.filter((c) => c.cambios.some((ch) => ch.campo === 'cuenta')).length;
  const countValores = pendientes.filter((c) => c.cambios.some((ch) => ch.campo === 'valor')).length;

  // Sample example changes for preview tooltip/subtitle (e.g. Barranca Deisy -> Zulma)
  const previewSummary = pendientes
    .slice(0, 3)
    .map((c) => {
      const enc = c.cambios.find((ch) => ch.campo === 'encargado');
      if (enc) return `${c.municipio}: ${enc.valorAnterior} ➔ ${enc.valorActual}`;
      return `${c.municipio}`;
    })
    .join(' • ');

  return (
    <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-900/60 border-2 border-amber-500/60 rounded-2xl p-4 shadow-xl shadow-amber-950/20 text-slate-100 relative overflow-hidden animate-in fade-in duration-300">
      {/* Decorative background glow */}
      <div className="absolute -right-12 -top-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
        {/* Left info */}
        <div className="flex items-start space-x-3.5">
          <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 shadow-inner mt-0.5">
            <AlertTriangle className="w-6 h-6 animate-bounce" />
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-extrabold text-amber-300 flex items-center space-x-1.5">
                <span>⚠️ Auditoría de Cambios Intermensuales Detectada</span>
              </span>
              <span className="bg-amber-500/30 text-amber-200 border border-amber-500/50 text-[11px] font-bold px-2.5 py-0.5 rounded-full">
                {pendientes.length} novedades vs {mesAnterior} {anioAnterior}
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Se detectaron variaciones en los datos de pago para <strong className="text-amber-200">{mesActual} {anioActual}</strong> respecto a{' '}
              <strong className="text-slate-100">{mesAnterior} {anioAnterior}</strong>. Revise y valide las asignaciones de encargado, documento y cuenta bancaria antes de desembolsar.
            </p>

            {previewSummary && (
              <p className="text-[11px] text-amber-200/90 font-medium pt-0.5">
                🔍 Ejemplos detectados: <span className="text-slate-200">{previewSummary}</span>
                {pendientes.length > 3 && ` (+${pendientes.length - 3} más)`}
              </p>
            )}

            {/* Chips breakdown */}
            <div className="flex flex-wrap gap-2 pt-1">
              {countEncargados > 0 && (
                <span className="bg-amber-900/50 text-amber-300 border border-amber-700/60 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center space-x-1">
                  <Users className="w-3 h-3" />
                  <span>{countEncargados} cambios de Encargado</span>
                </span>
              )}
              {countCedulas > 0 && (
                <span className="bg-sky-900/50 text-sky-300 border border-sky-700/60 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center space-x-1">
                  <FileText className="w-3 h-3" />
                  <span>{countCedulas} cambios de Cédula</span>
                </span>
              )}
              {countCuentas > 0 && (
                <span className="bg-emerald-900/50 text-emerald-300 border border-emerald-700/60 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center space-x-1">
                  <CreditCard className="w-3 h-3" />
                  <span>{countCuentas} cambios de Cuenta Bancaria</span>
                </span>
              )}
              {countValores > 0 && (
                <span className="bg-purple-900/50 text-purple-300 border border-purple-700/60 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center space-x-1">
                  <DollarSign className="w-3 h-3" />
                  <span>{countValores} cambios de Monto</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right CTA Actions */}
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0 justify-end">
          <button
            onClick={onOpenModal}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-amber-950/40 flex items-center space-x-2 transition-transform transform active:scale-95 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Revisar y Validar Cambios ({pendientes.length})</span>
          </button>

          <button
            onClick={onAprobarTodos}
            disabled={isProcessing}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-2.5 rounded-xl shadow-md shadow-emerald-950/30 flex items-center space-x-1.5 transition-all disabled:opacity-50 cursor-pointer"
            title="Aprobar todos los cambios intermensuales y sincronizar con la Ficha Maestra"
          >
            <CheckCheck className="w-4 h-4" />
            <span>Aprobar Todos</span>
          </button>
        </div>
      </div>
    </div>
  );
};
