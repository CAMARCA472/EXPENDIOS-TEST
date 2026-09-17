import React from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Camera,
  Lock,
  Unlock,
  FileText,
  FileCheck2,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

interface ExpendioStepProgressProps {
  isDatosActualizados: boolean;
  fotosCargadasCount: number;
  isRegistroFotograficoCompleto: boolean;
  isModuloCuentasHabilitado: boolean;
  activeAccordion: { modulo1: boolean; modulo2: boolean; modulo3: boolean; modulo4?: boolean };
  onOpenStep: (step: 'modulo1' | 'modulo2' | 'modulo3' | 'modulo4') => void;
  isLight?: boolean;
}

export const ExpendioStepProgress: React.FC<ExpendioStepProgressProps> = ({
  isDatosActualizados,
  fotosCargadasCount,
  isRegistroFotograficoCompleto,
  isModuloCuentasHabilitado,
  activeAccordion,
  onOpenStep,
  isLight = true,
}) => {
  // Calculate completed steps
  let completedCount = 0;
  if (isDatosActualizados) completedCount++;
  if (isRegistroFotograficoCompleto) completedCount++;
  if (isModuloCuentasHabilitado) completedCount++;
  // Step 4 (Documentación) is always ready to access
  const totalSteps = 4;
  const progressPercent = Math.round((completedCount / 3) * 100);

  return (
    <div
      id="expendio-step-progress"
      className={`rounded-2xl border-2 p-4 sm:p-5 transition-all shadow-sm ${
        isLight
          ? 'bg-gradient-to-b from-white via-slate-50/50 to-white border-slate-200'
          : 'bg-slate-900 border-slate-800'
      }`}
    >
      {/* HEADER DE TRAZABILIDAD Y PROGRESO GENERAL */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3.5 border-b border-slate-300 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2 flex-wrap gap-1">
            <span className="text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-300 text-black border border-amber-500 shadow-xs">
              Ruta del Expendio
            </span>
            <span className="text-xs font-black text-black">
              {completedCount} de 3 requisitos completados ({progressPercent}%)
            </span>
          </div>
          <h3 className="text-sm sm:text-base font-black text-black mt-1">
            Flujo Guiado de Habilitación y Operación
          </h3>
          <p className="text-xs text-black font-bold mt-0.5">
            Sigue cada módulo en orden numérico para mantener tu punto al día y descargar tus documentos.
          </p>
        </div>

        {/* BADGE GLOBAL DE ESTADO */}
        <div className="shrink-0 flex items-center space-x-2">
          {isModuloCuentasHabilitado ? (
            <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-400 text-black border-2 border-emerald-700 shadow-sm">
              <CheckCircle2 className="w-4 h-4 text-black" />
              <span className="text-black font-black">Punto Habilitado para Cobro</span>
            </span>
          ) : (
            <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-black bg-amber-400 text-black border-2 border-amber-700 shadow-sm">
              <Lock className="w-4 h-4 text-black" />
              <span className="text-black font-black">Pendiente Completar Pasos 1 y 2</span>
            </span>
          )}
        </div>
      </div>

      {/* BARRA DE PROGRESO VISUAL */}
      <div className="w-full bg-slate-200 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden mb-4 border border-slate-300">
        <div
          className={`h-full transition-all duration-500 rounded-full ${
            progressPercent === 100
              ? 'bg-emerald-500'
              : progressPercent > 33
              ? 'bg-blue-600'
              : 'bg-amber-500'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* 4 INTERACTIVE STEP CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* PASO 1 */}
        <button
          type="button"
          onClick={() => onOpenStep('modulo1')}
          className={`p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
            activeAccordion.modulo1
              ? 'border-blue-600 ring-2 ring-blue-500/20 shadow-md bg-blue-50/70'
              : isLight
              ? 'bg-white border-slate-300 hover:border-slate-400 hover:bg-slate-50'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <div className="flex items-center space-x-2">
                <span
                  className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs ${
                    isDatosActualizados
                      ? 'bg-emerald-400 text-black border border-emerald-600'
                      : 'bg-amber-400 text-black border border-amber-600'
                  }`}
                >
                  1
                </span>
                <span className="font-black text-xs uppercase tracking-tight text-black">
                  Actualizar Datos
                </span>
              </div>
              {isDatosActualizados ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
            </div>
            <p className="text-[11px] text-black font-bold line-clamp-2">
              Datos personales, banco para pago y contrato.
            </p>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-300">
            {isDatosActualizados ? (
              <span className="text-[11px] font-black text-black bg-emerald-100 border border-emerald-400 px-2 py-0.5 rounded-md inline-flex items-center space-x-1">
                <span>✓ Al día y verificado</span>
              </span>
            ) : (
              <span className="text-[11px] font-black text-black bg-amber-200 border border-amber-500 px-2 py-0.5 rounded-md inline-flex items-center space-x-1">
                <span>⚠️ Requisito obligatorio</span>
              </span>
            )}
          </div>
        </button>

        {/* PASO 2 */}
        <button
          type="button"
          onClick={() => onOpenStep('modulo2')}
          className={`p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
            activeAccordion.modulo2
              ? 'border-amber-600 ring-2 ring-amber-500/20 shadow-md bg-amber-50/70'
              : isLight
              ? 'bg-white border-slate-300 hover:border-slate-400 hover:bg-slate-50'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <div className="flex items-center space-x-2">
                <span
                  className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs ${
                    isRegistroFotograficoCompleto
                      ? 'bg-emerald-400 text-black border border-emerald-600'
                      : 'bg-amber-400 text-black border border-amber-600'
                  }`}
                >
                  2
                </span>
                <span className="font-black text-xs uppercase tracking-tight text-black">
                  Fotos del Punto
                </span>
              </div>
              {isRegistroFotograficoCompleto ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              ) : (
                <Camera className="w-4 h-4 text-amber-600 shrink-0" />
              )}
            </div>
            <p className="text-[11px] text-black font-bold line-clamp-2">
              7 ángulos obligatorios de fachada y mostrador.
            </p>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-300">
            {isRegistroFotograficoCompleto ? (
              <span className="text-[11px] font-black text-black bg-emerald-100 border border-emerald-400 px-2 py-0.5 rounded-md inline-flex">
                ✓ 7 de 7 Fotos listas
              </span>
            ) : (
              <span className="text-[11px] font-black text-black bg-amber-200 border border-amber-500 px-2 py-0.5 rounded-md inline-flex">
                📷 {fotosCargadasCount} de 7 subidas
              </span>
            )}
          </div>
        </button>

        {/* PASO 3 */}
        <button
          type="button"
          onClick={() => onOpenStep('modulo3')}
          className={`p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
            activeAccordion.modulo3
              ? 'border-emerald-600 ring-2 ring-emerald-500/20 shadow-md bg-emerald-50/70'
              : isLight
              ? 'bg-white border-slate-300 hover:border-slate-400 hover:bg-slate-50'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <div className="flex items-center space-x-2">
                <span
                  className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs ${
                    isModuloCuentasHabilitado
                      ? 'bg-emerald-400 text-black border border-emerald-600'
                      : 'bg-slate-300 text-black font-black border border-slate-500'
                  }`}
                >
                  3
                </span>
                <span className="font-black text-xs uppercase tracking-tight text-black">
                  Cuentas & Pago
                </span>
              </div>
              {isModuloCuentasHabilitado ? (
                <Unlock className="w-4 h-4 text-emerald-700 shrink-0" />
              ) : (
                <Lock className="w-4 h-4 text-slate-700 shrink-0" />
              )}
            </div>
            <p className="text-[11px] text-black font-bold line-clamp-2">
              Descarga, firma y radicación mensual.
            </p>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-300">
            {isModuloCuentasHabilitado ? (
              <span className="text-[11px] font-black text-black bg-emerald-100 border border-emerald-400 px-2 py-0.5 rounded-md inline-flex">
                🔓 Habilitado para radicación
              </span>
            ) : (
              <span className="text-[11px] font-black text-black bg-slate-200 border border-slate-400 px-2 py-0.5 rounded-md inline-flex">
                🔒 Requiere Pasos 1 y 2
              </span>
            )}
          </div>
        </button>

        {/* PASO 4 (DOCUMENTACIÓN INSTITUCIONAL OFICIAL) */}
        <button
          type="button"
          onClick={() => onOpenStep('modulo4')}
          className={`p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
            activeAccordion.modulo4
              ? 'border-indigo-600 ring-2 ring-indigo-500/20 shadow-md bg-indigo-50/70'
              : isLight
              ? 'bg-white border-slate-300 hover:border-slate-400 hover:bg-slate-50'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <div className="flex items-center space-x-2">
                <span className="w-6 h-6 rounded-lg bg-indigo-300 text-black border border-indigo-600 flex items-center justify-center font-black text-xs">
                  4
                </span>
                <span className="font-black text-xs uppercase tracking-tight text-black">
                  Documentación 4-72
                </span>
              </div>
              <Sparkles className="w-4 h-4 text-indigo-700 shrink-0" />
            </div>
            <p className="text-[11px] text-black font-bold line-clamp-2">
              Horario oficial, contrato 13 págs y avisos.
            </p>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-300">
            <span className="text-[11px] font-black text-black bg-indigo-100 border border-indigo-400 px-2 py-0.5 rounded-md inline-flex items-center space-x-1">
              <span>📄 Descargas activas</span>
            </span>
          </div>
        </button>
      </div>
    </div>
  );
};
