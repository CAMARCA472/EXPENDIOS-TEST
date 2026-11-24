import React from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Camera,
  Lock,
  Unlock,
  ChevronRight,
  Sparkles,
  User,
  FileText,
} from 'lucide-react';

interface ExpendioStepProgressProps {
  isDatosActualizados: boolean;
  fotosCargadasCount: number;
  isRegistroFotograficoCompleto: boolean;
  isModuloCuentasHabilitado: boolean;
  activeAccordion: { modulo1: boolean; modulo2: boolean; modulo3: boolean; modulo4?: boolean };
  onOpenStep: (step: 'modulo1' | 'modulo2' | 'modulo3' | 'modulo4') => void;
  isLight?: boolean;
  lastLocalSaveTime?: string;
  hasPendingOfflineData?: boolean;
}

export const ExpendioStepProgress: React.FC<ExpendioStepProgressProps> = ({
  isDatosActualizados,
  fotosCargadasCount,
  isRegistroFotograficoCompleto,
  isModuloCuentasHabilitado,
  activeAccordion,
  onOpenStep,
  isLight = true,
  lastLocalSaveTime,
  hasPendingOfflineData = false,
}) => {
  let completedCount = 0;
  if (isDatosActualizados) completedCount++;
  if (isRegistroFotograficoCompleto) completedCount++;
  if (isModuloCuentasHabilitado) completedCount++;
  const progressPercent = Math.round((completedCount / 3) * 100);
  const isTodoAlDia = isDatosActualizados && isRegistroFotograficoCompleto;

  return (
    <div
      id="expendio-step-progress"
      className={`rounded-2xl border-2 p-3 sm:p-3.5 transition-all shadow-sm space-y-2.5 ${
        isTodoAlDia
          ? isLight
            ? 'bg-emerald-50/70 border-emerald-500'
            : 'bg-slate-900 border-emerald-500/70'
          : isLight
          ? 'bg-white border-slate-300'
          : 'bg-slate-900 border-slate-800'
      }`}
    >
      {/* 1. BANNER COMPACTO DE CUMPLIMIENTO */}
      {isTodoAlDia ? (
        <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500 text-slate-950 border border-emerald-700 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white text-emerald-700 border border-emerald-800 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-xs sm:text-sm font-black text-slate-950 leading-tight">
                  ¡Todo al día! 7/7 fotos listas y datos actualizados
                </h3>
                <span className="text-[11px] font-black text-emerald-950 bg-white/80 px-2 py-0.5 rounded-md border border-emerald-700/40">
                  100% ({completedCount}/3 pasos)
                </span>
              </div>
              <p className="text-[11px] sm:text-xs font-bold text-slate-900 truncate mt-0.5">
                Ya puedes consultar y descargar tu cuenta de cobro o formatos oficiales
                {lastLocalSaveTime ? ` · Guardado (${lastLocalSaveTime})` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenStep('modulo3')}
            className="w-full sm:w-auto min-h-[38px] shrink-0 bg-slate-950 hover:bg-slate-800 text-emerald-300 font-black text-xs px-3.5 py-2 rounded-lg flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer transition-all active:scale-98"
          >
            <span>Ir a Mi Cuenta de Cobro</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="px-3.5 py-2.5 rounded-xl bg-amber-100/95 dark:bg-amber-950/40 border border-amber-500 text-slate-950 dark:text-amber-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          <div className="min-w-0 space-y-0.5">
            <div className="text-[11px] font-black text-amber-950 dark:text-amber-200 flex flex-wrap items-center gap-1.5">
              <span>Avance: {completedCount}/3 pasos ({progressPercent}%)</span>
              <span aria-hidden="true">·</span>
              <span>
                Autoguardado {lastLocalSaveTime ? `(${lastLocalSaveTime})` : 'Activo'}
              </span>
            </div>

            <h3 className="text-xs sm:text-sm font-black text-slate-950 dark:text-white leading-snug">
              {!isDatosActualizados
                ? 'Paso 1: Verifica tus datos personales y tu cuenta de pago'
                : `Paso 2: Te faltan ${7 - fotosCargadasCount} foto(s) de tu expendio (Llevas ${fotosCargadasCount} de 7)`}
            </h3>

            {hasPendingOfflineData && (
              <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                Información guardada en tu teléfono esperando señal para enviarse.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => onOpenStep(!isDatosActualizados ? 'modulo1' : 'modulo2')}
            className="w-full sm:w-auto min-h-[40px] shrink-0 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs px-3.5 py-2 rounded-lg border border-amber-700 flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer transition-all active:scale-98"
          >
            <span>
              {!isDatosActualizados
                ? 'Ir al Paso 1: Mis Datos'
                : `Ir al Paso 2: Subir Fotos (${fotosCargadasCount}/7)`}
            </span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. BARRA DE AVANCE COMPACTA */}
      <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
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

      {/* 3. BOTONES DE SECCIÓN COMPACTOS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {/* PASO 1 */}
        <button
          type="button"
          onClick={() => onOpenStep('modulo1')}
          className={`min-h-[52px] px-3 py-2 rounded-xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
            activeAccordion.modulo1
              ? 'border-blue-600 ring-2 ring-blue-500/20 bg-blue-50/90 dark:bg-blue-950/40'
              : isLight
              ? 'bg-slate-50 border-slate-300 hover:bg-slate-100'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="font-black text-xs text-slate-950 dark:text-white flex items-center space-x-1.5">
              <User className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>1. Mis Datos</span>
            </span>
            {isDatosActualizados ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            )}
          </div>
          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mt-0.5">
            {isDatosActualizados ? '✓ Datos al día' : 'Falta confirmar'}
          </span>
        </button>

        {/* PASO 2 */}
        <button
          type="button"
          onClick={() => onOpenStep('modulo2')}
          className={`min-h-[52px] px-3 py-2 rounded-xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
            activeAccordion.modulo2
              ? 'border-amber-600 ring-2 ring-amber-500/20 bg-amber-50/90 dark:bg-amber-950/40'
              : isLight
              ? 'bg-slate-50 border-slate-300 hover:bg-slate-100'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="font-black text-xs text-slate-950 dark:text-white flex items-center space-x-1.5">
              <Camera className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>2. Fotos</span>
            </span>
            <span className="font-mono tabular-nums text-xs font-black text-slate-900 dark:text-amber-300">
              {fotosCargadasCount}/7
            </span>
          </div>
          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mt-0.5">
            {isRegistroFotograficoCompleto ? '✓ 7 de 7 listas' : `Faltan ${7 - fotosCargadasCount} fotos`}
          </span>
        </button>

        {/* PASO 3 */}
        <button
          type="button"
          onClick={() => onOpenStep('modulo3')}
          className={`min-h-[52px] px-3 py-2 rounded-xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
            activeAccordion.modulo3
              ? 'border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-50/90 dark:bg-emerald-950/40'
              : isLight
              ? 'bg-slate-50 border-slate-300 hover:bg-slate-100'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="font-black text-xs text-slate-950 dark:text-white flex items-center space-x-1.5">
              {isModuloCuentasHabilitado ? (
                <Unlock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              )}
              <span>3. Mi Pago</span>
            </span>
          </div>
          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mt-0.5">
            {isModuloCuentasHabilitado ? '✓ Cuenta disponible' : 'Completa pasos 1 y 2'}
          </span>
        </button>

        {/* PASO 4 */}
        <button
          type="button"
          onClick={() => onOpenStep('modulo4')}
          className={`min-h-[52px] px-3 py-2 rounded-xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
            activeAccordion.modulo4
              ? 'border-indigo-600 ring-2 ring-indigo-500/20 bg-indigo-50/90 dark:bg-indigo-950/40'
              : isLight
              ? 'bg-slate-50 border-slate-300 hover:bg-slate-100'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="font-black text-xs text-slate-950 dark:text-white flex items-center space-x-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>4. Formatos</span>
            </span>
            <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          </div>
          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mt-0.5">
            Horario y Contrato
          </span>
        </button>
      </div>
    </div>
  );
};
