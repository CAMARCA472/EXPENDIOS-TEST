import React, { useState, useEffect } from 'react';
import {
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Upload,
  BookOpen,
  X,
  FileSpreadsheet,
  Layers,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { HistorialItem, PagoRelacionItem } from '../types';

export interface CargarGenerarConfig {
  mes: string;
  anio: string;
  periodo: string;
  sobrescribir: boolean;
  archivarAutomaticamente: boolean;
  aplicarGrossUp: boolean;
  porcentajeRetencion: number;
  modificarValorInicialRetencion: number;
  habilitarComoPeriodoDescarga?: boolean;
}

interface CargarGenerarModalProps {
  isOpen: boolean;
  mode: 'auto' | 'excel';
  fileExcelName?: string;
  initialMes?: string;
  initialAnio?: string;
  initialGrossUp?: boolean;
  initialPorcentajeRet?: number;
  initialModRet?: number;
  defaultPeriodo?: { mes: string; anio: string };
  defaultGrossUp?: boolean;
  defaultPorcentajeRetencion?: number;
  defaultModificarValorInicialRetencion?: number;
  defaultArchivarAutomaticamente?: boolean;
  historial?: HistorialItem[];
  relacionPagos?: PagoRelacionItem[];
  existingPeriodsInHistorial?: string[];
  isProcessing?: boolean;
  isLoading?: boolean;
  onConfirm: (config: CargarGenerarConfig) => Promise<void>;
  onClose: () => void;
}

export const MESES_SISTEMA = [
  { value: 'ENERO', num: '01', label: 'Enero', dias: 31 },
  { value: 'FEBRERO', num: '02', label: 'Febrero', dias: 28 },
  { value: 'MARZO', num: '03', label: 'Marzo', dias: 31 },
  { value: 'ABRIL', num: '04', label: 'Abril', dias: 30 },
  { value: 'MAYO', num: '05', label: 'Mayo', dias: 31 },
  { value: 'JUNIO', num: '06', label: 'Junio', dias: 30 },
  { value: 'JULIO', num: '07', label: 'Julio', dias: 31 },
  { value: 'AGOSTO', num: '08', label: 'Agosto', dias: 31 },
  { value: 'SEPTIEMBRE', num: '09', label: 'Septiembre', dias: 30 },
  { value: 'OCTUBRE', num: '10', label: 'Octubre', dias: 31 },
  { value: 'NOVIEMBRE', num: '11', label: 'Noviembre', dias: 30 },
  { value: 'DICIEMBRE', num: '12', label: 'Diciembre', dias: 31 },
];

export const ANIOS_SISTEMA = ['2024', '2025', '2026', '2027', '2028', '2029', '2030'];

export const CargarGenerarModal: React.FC<CargarGenerarModalProps> = ({
  isOpen,
  mode,
  fileExcelName,
  initialMes,
  initialAnio,
  initialGrossUp,
  initialPorcentajeRet,
  initialModRet,
  defaultPeriodo,
  defaultGrossUp,
  defaultPorcentajeRetencion,
  defaultModificarValorInicialRetencion,
  defaultArchivarAutomaticamente = true,
  historial = [],
  relacionPagos = [],
  existingPeriodsInHistorial,
  isProcessing,
  isLoading,
  onConfirm,
  onClose,
}) => {
  const startMes = defaultPeriodo?.mes || initialMes || 'MARZO';
  const startAnio = defaultPeriodo?.anio || initialAnio || '2026';
  const startGrossUp = defaultGrossUp !== undefined ? defaultGrossUp : (initialGrossUp !== undefined ? initialGrossUp : true);
  const startPorcentajeRet = defaultPorcentajeRetencion !== undefined ? defaultPorcentajeRetencion : (initialPorcentajeRet !== undefined ? initialPorcentajeRet : 1);
  const startModRet = defaultModificarValorInicialRetencion !== undefined ? defaultModificarValorInicialRetencion : (initialModRet !== undefined ? initialModRet : 0);

  const [mes, setMes] = useState<string>(startMes);
  const [anio, setAnio] = useState<string>(startAnio);
  const [aplicarGrossUp, setAplicarGrossUp] = useState<boolean>(startGrossUp);
  const [porcentajeRetencion, setPorcentajeRetencion] = useState<number>(startPorcentajeRet);
  const [modificarValorInicialRetencion, setModificarValorInicialRetencion] = useState<number>(startModRet);

  // Auto-archive toggle: default true as requested
  const [archivarAutomaticamente, setArchivarAutomaticamente] = useState<boolean>(defaultArchivarAutomaticamente);

  // Habilitar inmediatamente como periodo oficial de descarga para expendios
  const [habilitarComoPeriodoDescarga, setHabilitarComoPeriodoDescarga] = useState<boolean>(true);

  // Overwrite confirmation
  const [confirmaSobrescribir, setConfirmaSobrescribir] = useState<boolean>(false);

  const processingState = Boolean(isProcessing || isLoading);

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      setMes(startMes);
      setAnio(startAnio);
      setAplicarGrossUp(startGrossUp);
      setPorcentajeRetencion(startPorcentajeRet);
      setModificarValorInicialRetencion(startModRet);
      setArchivarAutomaticamente(defaultArchivarAutomaticamente);
      setHabilitarComoPeriodoDescarga(true);
      setConfirmaSobrescribir(false);
    }
  }, [isOpen, startMes, startAnio, startGrossUp, startPorcentajeRet, startModRet, defaultArchivarAutomaticamente]);

  if (!isOpen) return null;

  const periodoCalculado = `${mes} ${anio}`;

  // Check if month already generated in historial or relacionPagos
  const mesUpper = (mes || '').toUpperCase();
  const anioStr = String(anio || '2026');

  const safeHistorial = Array.isArray(historial) ? historial : [];
  const safePagos = Array.isArray(relacionPagos) ? relacionPagos : [];

  const registrosHistorialExistentes = safeHistorial.filter((item) => {
    const p = (item?.periodo || '').toUpperCase();
    const cDataPeriodo = (item?.cuentaData?.periodo || '').toUpperCase();
    const text = `${p} ${cDataPeriodo} ${item?.fecha || ''}`;
    return text.includes(mesUpper) && text.includes(anioStr);
  });

  const registrosPagosExistentes = safePagos.filter((pago) => {
    return (
      (pago?.mes || '').toUpperCase() === mesUpper &&
      String(pago?.anio || '2026') === anioStr
    );
  });

  const matchesExplicitPeriods = Array.isArray(existingPeriodsInHistorial)
    ? existingPeriodsInHistorial.some((pStr) => {
        const u = (pStr || '').toUpperCase();
        return u.includes(mesUpper) && u.includes(anioStr);
      })
    : false;

  const totalRegistrosPrevios = Math.max(
    registrosHistorialExistentes.length,
    registrosPagosExistentes.length,
    matchesExplicitPeriods ? 1 : 0
  );
  const existePeriodoPrevio = totalRegistrosPrevios > 0;

  // Validation
  const puedeProcesar = !existePeriodoPrevio || confirmaSobrescribir;

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!puedeProcesar || processingState) return;

    await onConfirm({
      mes,
      anio,
      periodo: periodoCalculado,
      sobrescribir: existePeriodoPrevio && confirmaSobrescribir,
      archivarAutomaticamente,
      aplicarGrossUp,
      porcentajeRetencion,
      modificarValorInicialRetencion,
      habilitarComoPeriodoDescarga,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className={`p-2.5 rounded-xl border ${
                mode === 'excel'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              }`}
            >
              {mode === 'excel' ? (
                <FileSpreadsheet className="w-5 h-5" />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <span>
                  {mode === 'excel'
                    ? 'Cargar y Regenerar Cuentas desde Excel'
                    : 'Calcular Cuentas de Cobro Masivas'}
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {mode === 'excel'
                  ? `Archivo seleccionado: ${fileExcelName || 'Plantilla Excel'}`
                  : 'Generador automatizado según censo y parámetros de expendios'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isProcessing}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleExecute} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Period Selector Card */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-amber-300 flex items-center space-x-1.5">
                <Calendar className="w-4 h-4 text-amber-400" />
                <span>1. Selecciona el Periodo de Cobro (Mes y Año)</span>
              </label>
              <span className="text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded">
                PERIODO: {periodoCalculado}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Mes a Cargar:
                </label>
                <select
                  value={mes}
                  onChange={(e) => {
                    setMes(e.target.value);
                    setConfirmaSobrescribir(false);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 font-semibold rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer shadow-inner"
                >
                  {MESES_SISTEMA.map((m) => (
                    <option key={m.value} value={m.value} className="bg-slate-900 text-slate-100">
                      {m.label} ({m.num})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Año:
                </label>
                <select
                  value={anio}
                  onChange={(e) => {
                    setAnio(e.target.value);
                    setConfirmaSobrescribir(false);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 font-semibold rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer shadow-inner"
                >
                  {ANIOS_SISTEMA.map((y) => (
                    <option key={y} value={y} className="bg-slate-900 text-slate-100">
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Conflict Detection Banner / Status */}
          {existePeriodoPrevio ? (
            <div className="bg-amber-950/60 border border-amber-500/50 rounded-xl p-3.5 space-y-2.5 shadow-lg">
              <div className="flex items-start space-x-2.5">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-amber-200">
                    ¡El periodo {periodoCalculado} ya cuenta con cuentas registradas!
                  </h4>
                  <p className="text-[11px] text-amber-300/90 mt-0.5 leading-relaxed">
                    Se encontraron {totalRegistrosPrevios} registros de cuentas de cobro generadas previamente para este mes. Para evitar duplicidad accidental, debes confirmar si deseas sobrescribir los datos.
                  </p>
                </div>
              </div>

              <label className="flex items-start space-x-2.5 p-2.5 rounded-lg bg-amber-950/90 border border-amber-500/60 cursor-pointer hover:bg-amber-900/60 transition-colors">
                <input
                  type="checkbox"
                  checked={confirmaSobrescribir}
                  onChange={(e) => setConfirmaSobrescribir(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-amber-500 text-amber-500 focus:ring-amber-400 bg-slate-900 cursor-pointer"
                />
                <span className="text-xs font-bold text-amber-100">
                  Confirmo que deseo sobrescribir y actualizar los registros existentes del periodo {periodoCalculado}.
                </span>
              </label>
            </div>
          ) : (
            <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-3 flex items-center space-x-2.5 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs">
                <strong>Periodo Nuevo:</strong> No existen registros previos para <strong>{periodoCalculado}</strong>. Se creará un nuevo bloque de cobro limpio.
              </span>
            </div>
          )}

          {/* Auto-archive to Accounting & Relación de Pagos Checkbox */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
            <label className="flex items-start space-x-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={archivarAutomaticamente}
                onChange={(e) => setArchivarAutomaticamente(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-900 cursor-pointer"
              />
              <div>
                <span className="text-xs font-bold text-emerald-400 flex items-center space-x-1.5">
                  <BookOpen className="w-4 h-4" />
                  <span>Archivar automáticamente en Historial de Cobros y Relación de Pagos</span>
                </span>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Si marcas esta casilla, las cuentas se archivarán directamente en el módulo de <strong>Historial de Cobros</strong> y en la <strong>Relación de Pagos</strong> de {periodoCalculado}, y <strong>se borrarán del módulo de cuentas masivas</strong> para que quede listo y libre para cargar el siguiente periodo.
                </p>
              </div>
            </label>
          </div>

          {/* Habilitar Periodo de Descarga Oficial para Expendios */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-amber-500/30 space-y-2">
            <label className="flex items-start space-x-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={habilitarComoPeriodoDescarga}
                onChange={(e) => setHabilitarComoPeriodoDescarga(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-amber-500 text-amber-500 focus:ring-amber-500 bg-slate-900 cursor-pointer"
              />
              <div>
                <span className="text-xs font-bold text-amber-400 flex items-center space-x-1.5">
                  <Sparkles className="w-4 h-4" />
                  <span>Habilitar inmediatamente {periodoCalculado} para consulta y descarga de expendios</span>
                </span>
                <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                  Al confirmar, {periodoCalculado} quedará activado como el periodo oficial autorizado para que todos los expendios puedan consultar y descargar su cuenta de cobro en PDF al ingresar.
                </p>
              </div>
            </label>
          </div>

          {/* Financial Calculation Parameters */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-slate-300 flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Parámetros Financieros y Retenciones</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Gross Up */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                <div>
                  <span className="text-[11px] font-bold text-slate-200 block">Aplicar Gross Up</span>
                  <span className="text-[10px] text-slate-400">Absorbe la retención 1%</span>
                </div>
                <input
                  type="checkbox"
                  checked={aplicarGrossUp}
                  onChange={(e) => setAplicarGrossUp(e.target.checked)}
                  className="w-4 h-4 text-amber-500 rounded border-slate-700 bg-slate-900 focus:ring-amber-400 cursor-pointer"
                />
              </div>

              {/* Porcentaje Retencion */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  % Retención en la Fuente:
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={porcentajeRetencion}
                  onChange={(e) => setPorcentajeRetencion(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono"
                />
              </div>
            </div>
          </div>
        </form>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleExecute}
            disabled={!puedeProcesar || isProcessing}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all cursor-pointer shadow-lg ${
              !puedeProcesar || isProcessing
                ? 'opacity-50 cursor-not-allowed bg-slate-800 text-slate-400'
                : mode === 'excel'
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
            }`}
          >
            {isProcessing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                <span>Procesando {periodoCalculado}...</span>
              </>
            ) : (
              <>
                <span>
                  {mode === 'excel'
                    ? `Cargar y Generar Excel (${periodoCalculado})`
                    : `Calcular y Generar (${periodoCalculado})`}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
