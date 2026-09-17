import React from 'react';
import {
  Calendar,
  RefreshCw,
  ArrowRight,
  FileX2,
  AlertCircle,
  CheckCircle2,
  Lock,
  Unlock,
  Printer,
  Sparkles,
  Camera,
  FileText,
  Upload,
  Eye,
  CreditCard,
  Building2,
  UserCheck,
} from 'lucide-react';
import { ExpendioData, CuentaCobroResult, SystemConfig, CuentaCargadaExpendio } from '../types';
import { formatPesos } from '../utils/formatters';

const MESES_SISTEMA = [
  { value: 'ENERO', num: '01', label: 'Enero' },
  { value: 'FEBRERO', num: '02', label: 'Febrero' },
  { value: 'MARZO', num: '03', label: 'Marzo' },
  { value: 'ABRIL', num: '04', label: 'Abril' },
  { value: 'MAYO', num: '05', label: 'Mayo' },
  { value: 'JUNIO', num: '06', label: 'Junio' },
  { value: 'JULIO', num: '07', label: 'Julio' },
  { value: 'AGOSTO', num: '08', label: 'Agosto' },
  { value: 'SEPTIEMBRE', num: '09', label: 'Septiembre' },
  { value: 'OCTUBRE', num: '10', label: 'Octubre' },
  { value: 'NOVIEMBRE', num: '11', label: 'Noviembre' },
  { value: 'DICIEMBRE', num: '12', label: 'Diciembre' },
];

const ANIOS_SISTEMA = Array.from({ length: 17 }, (_, i) => String(2024 + i));

interface ExpendioAccountsModuleProps {
  expendio: ExpendioData;
  isDatosActualizados: boolean;
  fotosCargadasCount: number;
  isRegistroFotograficoCompleto: boolean;
  isModuloCuentasHabilitado: boolean;
  onOpenStep: (step: 'modulo1' | 'modulo2') => void;
  systemConfig: SystemConfig | null;
  mesPeriodo: string;
  setMesPeriodo: (val: string) => void;
  anioPeriodo: string;
  setAnioPeriodo: (val: string) => void;
  checkingCuenta: boolean;
  checkCuentaCobroPeriodo: () => void;
  cuentaGenerada: {
    checked: boolean;
    generada: boolean;
    data?: CuentaCobroResult;
    message?: string;
  };
  periodoHabilitadoStr: string;
  selectedPeriodStr: string;
  isPeriodoHabilitadoParaDescarga: boolean;
  handleIrAlMesActivo: () => void;
  onOpenDocModal: () => void;
  onOpenScannerModal: () => void;
  cuentasCargadas: CuentaCargadaExpendio[];
  onViewScannedPhoto: (url: string) => void;
  isLight?: boolean;
}

export const ExpendioAccountsModule: React.FC<ExpendioAccountsModuleProps> = ({
  expendio,
  isDatosActualizados,
  fotosCargadasCount,
  isRegistroFotograficoCompleto,
  isModuloCuentasHabilitado,
  onOpenStep,
  systemConfig,
  mesPeriodo,
  setMesPeriodo,
  anioPeriodo,
  setAnioPeriodo,
  checkingCuenta,
  checkCuentaCobroPeriodo,
  cuentaGenerada,
  periodoHabilitadoStr,
  selectedPeriodStr,
  isPeriodoHabilitadoParaDescarga,
  handleIrAlMesActivo,
  onOpenDocModal,
  onOpenScannerModal,
  cuentasCargadas,
  onViewScannedPhoto,
  isLight = true,
}) => {
  // If the requirements are not met, display a high-contrast locked view
  if (!isModuloCuentasHabilitado) {
    return (
      <div className={`p-6 sm:p-8 rounded-2xl border text-center space-y-6 ${
        isLight
          ? 'bg-white border-amber-300 text-black shadow-sm'
          : 'bg-slate-900 border-amber-500/40 text-slate-100'
      }`}>
        <div className="w-16 h-16 rounded-3xl bg-amber-100 text-black border border-amber-400 flex items-center justify-center mx-auto shadow-sm">
          <Lock className="w-8 h-8 text-black" />
        </div>

        <div className="space-y-2 max-w-xl mx-auto">
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-black uppercase bg-amber-200 text-black border border-amber-500 shadow-xs">
            <span>Módulo Bloqueado Preventivamente</span>
          </div>
          <h3 className="text-xl font-black uppercase tracking-tight text-black">
            Requisitos Obligatorios Pendientes
          </h3>
          <p className="text-xs sm:text-sm text-black font-bold leading-relaxed">
            Para consultar, generar o descargar tus Cuentas de Cobro oficiales y liquidaciones mensuales, debes completar los siguientes 2 pasos previos:
          </p>
        </div>

        {/* Requirements Checklist Card */}
        <div className="max-w-md mx-auto space-y-3 text-left">
          {/* Requirement 1 */}
          <div className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
            isDatosActualizados
              ? 'bg-emerald-50 border-emerald-400 text-black'
              : 'bg-amber-50 border-amber-400 text-black'
          }`}>
            <div className="flex items-center space-x-3">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${
                isDatosActualizados ? 'bg-emerald-400 text-black border border-emerald-600' : 'bg-amber-400 text-black border border-amber-600'
              }`}>
                1
              </span>
              <div>
                <span className="font-black text-xs uppercase block text-black">Actualización de Datos Obligatoria</span>
                <span className="text-[11px] font-bold text-black">
                  {isDatosActualizados ? '✓ Completado con éxito' : '⚠️ Pendiente por confirmar'}
                </span>
              </div>
            </div>

            {!isDatosActualizados && (
              <button
                type="button"
                onClick={() => onOpenStep('modulo1')}
                className="px-3 py-1.5 rounded-lg text-xs font-black bg-amber-400 hover:bg-amber-300 text-black border border-amber-600 shadow-sm cursor-pointer transition-all"
              >
                Completar Paso 1
              </button>
            )}
            {isDatosActualizados && <CheckCircle2 className="w-5 h-5 text-emerald-700" />}
          </div>

          {/* Requirement 2 */}
          <div className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
            isRegistroFotograficoCompleto
              ? 'bg-emerald-50 border-emerald-400 text-black'
              : 'bg-amber-50 border-amber-400 text-black'
          }`}>
            <div className="flex items-center space-x-3">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${
                isRegistroFotograficoCompleto ? 'bg-emerald-400 text-black border border-emerald-600' : 'bg-amber-400 text-black border border-amber-600'
              }`}>
                2
              </span>
              <div>
                <span className="font-black text-xs uppercase block text-black">Registro Fotográfico Obligatorio</span>
                <span className="text-[11px] font-bold text-black">
                  {isRegistroFotograficoCompleto
                    ? '✓ 7 de 7 fotos registradas'
                    : `📷 ${fotosCargadasCount} de 7 fotos (${7 - fotosCargadasCount} pendientes)`}
                </span>
              </div>
            </div>

            {!isRegistroFotograficoCompleto && (
              <button
                type="button"
                onClick={() => onOpenStep('modulo2')}
                className="px-3 py-1.5 rounded-lg text-xs font-black bg-amber-400 hover:bg-amber-300 text-black border border-amber-600 shadow-sm cursor-pointer transition-all"
              >
                Cargar Fotos
              </button>
            )}
            {isRegistroFotograficoCompleto && <CheckCircle2 className="w-5 h-5 text-emerald-700" />}
          </div>
        </div>
      </div>
    );
  }

  // UNLOCKED VIEW
  return (
    <div className="space-y-6">
      {/* Search and Period Selector Bar */}
      <div className={`p-4 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
        isLight ? 'bg-white border-slate-200 shadow-sm' : 'bg-slate-900 border-slate-800'
      }`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-2 text-xs font-bold uppercase text-slate-700 dark:text-slate-300">
            <Calendar className="w-4 h-4 text-amber-500" />
            <span>Seleccionar Periodo de Consulta:</span>
          </div>

          <div className="flex items-center space-x-2">
            <select
              value={mesPeriodo}
              onChange={(e) => setMesPeriodo(e.target.value)}
              className={`border font-bold rounded-xl px-3 py-2 text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                isLight ? 'bg-slate-50 border-slate-300 text-slate-900' : 'bg-slate-950 border-slate-700 text-slate-100'
              }`}
            >
              {MESES_SISTEMA.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            <select
              value={anioPeriodo}
              onChange={(e) => setAnioPeriodo(e.target.value)}
              className={`border font-bold rounded-xl px-3 py-2 text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                isLight ? 'bg-slate-50 border-slate-300 text-slate-900' : 'bg-slate-950 border-slate-700 text-slate-100'
              }`}
            >
              {ANIOS_SISTEMA.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            <button
              onClick={checkCuentaCobroPeriodo}
              disabled={checkingCuenta}
              className={`p-2 rounded-xl border cursor-pointer transition-colors ${
                isLight ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
              title="Actualizar estado"
            >
              <RefreshCw className={`w-4 h-4 ${checkingCuenta ? 'animate-spin text-amber-500' : ''}`} />
            </button>
          </div>
        </div>

        {selectedPeriodStr !== periodoHabilitadoStr && (
          <button
            onClick={handleIrAlMesActivo}
            className="text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-xl font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <span>Ir al Periodo Activo ({periodoHabilitadoStr})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* When account not generated */}
      {!checkingCuenta && cuentaGenerada.checked && !cuentaGenerada.generada ? (
        <div className={`p-8 rounded-2xl border-2 border-dashed text-center space-y-4 ${
          isLight ? 'bg-white border-amber-400 text-black shadow-sm' : 'bg-slate-900 border-amber-600/70 text-slate-100'
        }`}>
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 text-black border border-amber-400">
            <FileX2 className="w-8 h-8 text-black" />
          </div>

          <div className="space-y-1">
            <h4 className="text-lg font-black text-black tracking-wide uppercase">
              CUENTA DE COBRO AÚN NO GENERADA
            </h4>
            <p className="text-xs sm:text-sm text-black font-bold max-w-lg mx-auto">
              La cuenta de cobro para el periodo <strong className="text-black underline font-black">{selectedPeriodStr}</strong> aún no ha sido cargada ni generada en el sistema por el administrador.
            </p>
          </div>

          <div className={`p-4 rounded-xl border max-w-md mx-auto text-xs text-left space-y-2 ${
            isLight ? 'bg-slate-50 border-slate-300 text-black' : 'bg-slate-950 border-slate-800 text-slate-400'
          }`}>
            <div className="flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span className="text-black font-bold">
                El administrador habilita mensualmente las cuentas de cobro liquidadas para cada centro operativo y municipio.
              </span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-300 dark:border-slate-800">
              <span className="text-black font-bold">Periodo activo por el administrador:</span>
              <strong className="text-black font-mono font-black">{periodoHabilitadoStr}</strong>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleIrAlMesActivo}
              className="bg-amber-400 hover:bg-amber-300 text-black border border-amber-600 font-black py-2.5 px-6 rounded-xl shadow-md text-xs inline-flex items-center space-x-2 cursor-pointer transition-all hover:scale-105"
            >
              <span className="text-black font-black">Ver Periodo Activo ({periodoHabilitadoStr})</span>
              <ArrowRight className="w-4 h-4 text-black" />
            </button>
          </div>
        </div>
      ) : (
        /* Account Generated & Available */
        <div className="space-y-6">
          {/* Download Enablement Banner */}
          <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs shadow-sm ${
            isPeriodoHabilitadoParaDescarga
              ? 'bg-emerald-50 border-emerald-400 text-black'
              : isLight
              ? 'bg-white border-slate-300 text-black'
              : 'bg-slate-900 border-slate-700 text-slate-300'
          }`}>
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-xl border ${
                isPeriodoHabilitadoParaDescarga
                  ? 'bg-emerald-200 text-black border-emerald-500'
                  : 'bg-slate-200 text-black border-slate-400'
              }`}>
                {isPeriodoHabilitadoParaDescarga ? <CheckCircle2 className="w-5 h-5 text-black" /> : <Lock className="w-5 h-5 text-black" />}
              </div>
              <div>
                <div className="font-black text-sm flex items-center space-x-2 text-black">
                  <span>
                    {isPeriodoHabilitadoParaDescarga
                      ? `✓ Periodo Habilitado para Descarga Oficial (${selectedPeriodStr})`
                      : `Cuenta Generada - Modo Lectura (${selectedPeriodStr})`}
                  </span>
                </div>
                <p className="text-xs font-bold text-black mt-0.5">
                  {isPeriodoHabilitadoParaDescarga
                    ? 'Puedes visualizar, imprimir y descargar el PDF oficial para radicación de este mes.'
                    : `La descarga oficial en PDF está configurada para el periodo activo: "${periodoHabilitadoStr}".`}
                </p>
              </div>
            </div>

            <button
              onClick={onOpenDocModal}
              className="shrink-0 font-black py-2.5 px-5 rounded-xl text-xs flex items-center space-x-2 shadow-md transition-all cursor-pointer bg-emerald-400 hover:bg-emerald-300 text-black border border-emerald-600 active:scale-98"
            >
              <Printer className="w-4 h-4 text-black" />
              <span className="text-black font-black">Ver Cuenta de Cobro & Imprimir</span>
            </button>
          </div>

          {/* Liquidated Financial Summary Cards */}
          {cuentaGenerada.data && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className={`p-4 rounded-2xl border-2 ${
                isLight ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-900 border-slate-700'
              }`}>
                <span className={`text-[11px] font-black uppercase tracking-wider block ${
                  isLight ? 'text-slate-800' : 'text-slate-300'
                }`}>
                  VALOR BRUTO
                </span>
                <p className={`text-2xl font-black mt-1 tracking-tight ${
                  isLight ? 'text-slate-950' : 'text-white'
                }`}>
                  {formatPesos(cuentaGenerada.data.valorBruto)}
                </p>
                <span className={`text-[11px] block mt-0.5 font-bold ${
                  isLight ? 'text-slate-700' : 'text-slate-400'
                }`}>
                  Liquidación base pactada
                </span>
              </div>

              <div className={`p-4 rounded-2xl border-2 ${
                isLight ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-900 border-slate-700'
              }`}>
                <span className={`text-[11px] font-black uppercase tracking-wider block ${
                  isLight ? 'text-slate-800' : 'text-slate-300'
                }`}>
                  RETEFUENTE ({cuentaGenerada.data.porcentajeRetefuente || 6}%)
                </span>
                <p className={`text-2xl font-black mt-1 tracking-tight ${
                  isLight ? 'text-red-700' : 'text-red-400'
                }`}>
                  - {formatPesos(cuentaGenerada.data.retefuente)}
                </p>
                <span className={`text-[11px] block mt-0.5 font-bold ${
                  isLight ? 'text-slate-700' : 'text-slate-400'
                }`}>
                  Retención en la fuente
                </span>
              </div>

              <div className={`p-4 rounded-2xl border-2 ${
                isLight ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-900 border-slate-700'
              }`}>
                <span className={`text-[11px] font-black uppercase tracking-wider block ${
                  isLight ? 'text-slate-800' : 'text-slate-300'
                }`}>
                  RETEICA ({cuentaGenerada.data.porcentajeReteica || 0.966}%)
                </span>
                <p className={`text-2xl font-black mt-1 tracking-tight ${
                  isLight ? 'text-red-700' : 'text-red-400'
                }`}>
                  - {formatPesos(cuentaGenerada.data.reteica)}
                </p>
                <span className={`text-[11px] block mt-0.5 font-bold ${
                  isLight ? 'text-slate-700' : 'text-slate-400'
                }`}>
                  Retención ICA municipal
                </span>
              </div>

              <div className={`p-4 rounded-2xl border-2 ${
                isLight ? 'bg-emerald-50 border-emerald-400 shadow-sm' : 'bg-emerald-950/40 border-emerald-600'
              }`}>
                <span className={`text-[11px] font-black uppercase tracking-wider block ${
                  isLight ? 'text-emerald-900' : 'text-emerald-300'
                }`}>
                  TOTAL NETO A PAGAR
                </span>
                <p className={`text-2xl font-black mt-1 tracking-tight ${
                  isLight ? 'text-emerald-950' : 'text-emerald-200'
                }`}>
                  {formatPesos(cuentaGenerada.data.netoPagar)}
                </p>
                <span className={`text-[11px] font-bold block mt-0.5 ${
                  isLight ? 'text-emerald-900' : 'text-emerald-300'
                }`}>
                  Giro a {expendio.banco || 'NEQUI'}
                </span>
              </div>
            </div>
          )}

          {/* Scanner CamScanner Upload Card */}
          <div className={`p-6 rounded-3xl border-2 space-y-4 ${
            isLight
              ? 'bg-gradient-to-br from-emerald-50 to-white border-emerald-400 shadow-sm'
              : 'bg-gradient-to-br from-emerald-950/40 to-slate-900 border-emerald-700/60'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
                    <Camera className="w-4 h-4" />
                  </div>
                  <h4 className={`text-base font-black uppercase ${
                    isLight ? 'text-slate-950' : 'text-slate-100'
                  }`}>
                    Cargar Cuenta Firmada (Cámara Magia Pro)
                  </h4>
                </div>
                <p className={`text-xs font-bold leading-relaxed ${
                  isLight ? 'text-slate-800' : 'text-slate-200'
                }`}>
                  Toma la foto de la cuenta de cobro física ya firmada. Se aplicará el filtro inteligente B/N CamScanner.
                </p>
              </div>

              <button
                type="button"
                onClick={onOpenScannerModal}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 px-5 rounded-xl shadow-md text-xs flex items-center justify-center space-x-2 cursor-pointer transition-all active:scale-98 shrink-0"
              >
                <Camera className="w-4 h-4" />
                <span>Abrir Escáner Magia Pro</span>
              </button>
            </div>

            {/* List of uploaded scanned accounts */}
            {cuentasCargadas.length > 0 && (
              <div className="pt-3 border-t border-emerald-300 dark:border-emerald-800/80 space-y-2">
                <span className={`text-xs font-black uppercase block ${
                  isLight ? 'text-slate-900' : 'text-slate-200'
                }`}>
                  Cuentas Escaneadas Guardadas ({cuentasCargadas.length})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {cuentasCargadas.map((cuenta, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                        isLight ? 'bg-white border-slate-300 shadow-xs text-slate-900' : 'bg-slate-950 border-slate-800 text-slate-100'
                      }`}
                    >
                      <div className="flex items-center space-x-2 overflow-hidden">
                        <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div className="truncate">
                          <span className={`font-black block truncate ${
                            isLight ? 'text-slate-950' : 'text-slate-100'
                          }`}>
                            {cuenta.periodo}
                          </span>
                          <span className={`text-[11px] font-semibold ${
                            isLight ? 'text-slate-700' : 'text-slate-400'
                          }`}>
                            {cuenta.fechaCargue}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onViewScannedPhoto(cuenta.imagenEscaneadaUrl)}
                        className="p-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-black flex items-center space-x-1 cursor-pointer transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Ver</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
