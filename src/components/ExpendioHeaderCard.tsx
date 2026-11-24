import React from 'react';
import { ExpendioData } from '../types';
import {
  Store,
  User,
  Hash,
  MapPin,
  Phone,
  CreditCard,
  Building2,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  BookOpen,
} from 'lucide-react';
import { formatCuentaBancaria } from '../utils/formatters';

interface ExpendioHeaderCardProps {
  expendio: ExpendioData;
  isLight?: boolean;
  onOpenCapacitacion?: () => void;
  isTodoAlDia?: boolean;
}

function cleanRealObservation(raw?: string | null): string {
  if (!raw) return '';
  const str = String(raw).trim();
  if (!str) return '';
  const upper = str.toUpperCase();
  if (
    upper.startsWith('CARGADO DESDE EXCEL') ||
    upper.startsWith('ACTUALIZADO POR APROBACI') ||
    upper.startsWith('[NO TIENE')
  ) {
    return '';
  }
  return str;
}

export const ExpendioHeaderCard: React.FC<ExpendioHeaderCardProps> = ({
  expendio,
  isLight = true,
  onOpenCapacitacion,
  isTodoAlDia = false,
}) => {
  const bankingFormatted = formatCuentaBancaria(
    expendio.cuentaBancaria || expendio.telefonoPunto,
    expendio.banco || 'NEQUI'
  );

  const realObservacion =
    cleanRealObservation(expendio.observaciones) ||
    cleanRealObservation(expendio.observacion);

  const realSipost =
    expendio.usuarioSipost &&
    expendio.usuarioSipost.trim() !== '' &&
    expendio.usuarioSipost.trim().toLowerCase() !== 'ex.sipost'
      ? expendio.usuarioSipost.trim()
      : '';

  return (
    <div
      className={`rounded-2xl border-2 shadow-sm overflow-hidden transition-colors duration-200 ${
        isLight ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-800'
      }`}
    >
      {/* Header Summary Section */}
      <div
        className={`px-4 py-3.5 sm:px-6 sm:py-4 ${
          isLight ? 'bg-white text-slate-950' : 'bg-slate-950 text-slate-100'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="inline-flex items-center space-x-1.5 text-xs font-black uppercase tracking-wide text-amber-800 dark:text-amber-400">
            <Store className="w-4 h-4 shrink-0" />
            <span>Punto de Atención 4-72</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">C.C. {expendio.cedula}</span>
          </div>

          {onOpenCapacitacion && (
            <button
              type="button"
              onClick={onOpenCapacitacion}
              className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-black bg-sky-100 hover:bg-sky-200 text-slate-950 border-2 border-sky-400 inline-flex items-center space-x-1.5 cursor-pointer transition-colors shadow-xs active:scale-98"
              title="Ver guía paso a paso de cómo usar la plataforma"
            >
              <BookOpen className="w-4 h-4 text-sky-800 shrink-0" />
              <span>Ver Guía de Ayuda</span>
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-slate-950 dark:text-white leading-tight">
              EXPENDIO {expendio.localidad || expendio.municipio}
            </h2>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-0.5 flex items-center space-x-1.5">
              <User className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="truncate">{expendio.encargado || 'SIN ENCARGADO REGISTRADO'}</span>
            </p>
          </div>

          <div className="shrink-0 flex items-center space-x-2 pt-0.5 sm:pt-0">
            {isTodoAlDia ? (
              <span className="inline-flex items-center space-x-1.5 text-xs sm:text-sm font-black text-emerald-900 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Punto al día</span>
              </span>
            ) : (
              <span className="inline-flex items-center space-x-1.5 text-xs sm:text-sm font-black text-amber-900 dark:text-amber-300">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Actualización en curso</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Full Details Table (Always Expanded) */}
      <div
        className={`border-t-2 divide-y text-sm ${
          isLight ? 'border-slate-300 divide-slate-200' : 'border-slate-800 divide-slate-800'
        }`}
      >
        {/* Row 1: Nombre Encargado */}
        <div className="grid grid-cols-1 sm:grid-cols-3">
          <div
            className={`px-4 py-2 font-black uppercase tracking-wider text-xs flex items-center space-x-2 ${
              isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950/60 text-slate-300'
            }`}
          >
            <User className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Nombre Encargado</span>
          </div>
          <div
            className={`px-4 py-2 sm:col-span-2 font-bold flex items-center ${
              isLight ? 'text-slate-950' : 'text-slate-100'
            }`}
          >
            {expendio.encargado || 'SIN ENCARGADO REGISTRADO'}
          </div>
        </div>

        {/* Row 2: Cédula */}
        <div className="grid grid-cols-1 sm:grid-cols-3">
          <div
            className={`px-4 py-2 font-black uppercase tracking-wider text-xs flex items-center space-x-2 ${
              isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950/60 text-slate-300'
            }`}
          >
            <Hash className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Cédula de Ciudadanía</span>
          </div>
          <div
            className={`px-4 py-2 sm:col-span-2 font-mono tabular-nums font-black text-base flex items-center ${
              isLight ? 'text-slate-950' : 'text-slate-100'
            }`}
          >
            {expendio.cedula}
          </div>
        </div>

        {/* Row 3: Dirección */}
        <div className="grid grid-cols-1 sm:grid-cols-3">
          <div
            className={`px-4 py-2 font-black uppercase tracking-wider text-xs flex items-center space-x-2 ${
              isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950/60 text-slate-300'
            }`}
          >
            <MapPin className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Dirección del Expendio</span>
          </div>
          <div
            className={`px-4 py-2 sm:col-span-2 font-bold flex items-center ${
              isLight ? 'text-slate-950' : 'text-slate-200'
            }`}
          >
            {expendio.direccionPunto || 'Dirección no registrada'}
          </div>
        </div>

        {/* Row 4: Teléfono */}
        <div className="grid grid-cols-1 sm:grid-cols-3">
          <div
            className={`px-4 py-2 font-black uppercase tracking-wider text-xs flex items-center space-x-2 ${
              isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950/60 text-slate-300'
            }`}
          >
            <Phone className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Celular / Contacto</span>
          </div>
          <div
            className={`px-4 py-2 sm:col-span-2 font-mono tabular-nums font-black text-base flex items-center ${
              isLight ? 'text-slate-950' : 'text-slate-200'
            }`}
          >
            {expendio.telefonoPunto || 'Teléfono no registrado'}
          </div>
        </div>

        {/* Row 5: Cuenta Bancaria */}
        <div className="grid grid-cols-1 sm:grid-cols-3">
          <div
            className={`px-4 py-2 font-black uppercase tracking-wider text-xs flex items-center space-x-2 ${
              isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950/60 text-slate-300'
            }`}
          >
            <CreditCard className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>Cuenta para Pago</span>
          </div>
          <div className="px-4 py-2 sm:col-span-2 font-mono tabular-nums font-black flex items-center flex-wrap gap-2">
            <span className={isLight ? 'text-slate-950 text-base' : 'text-emerald-400 text-base'}>
              {bankingFormatted.cuenta}
            </span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span className="text-xs font-black uppercase text-emerald-800 dark:text-emerald-300">
              {bankingFormatted.banco}
            </span>
          </div>
        </div>

        {/* Row 6: Centro Operativo & Municipio */}
        <div className="grid grid-cols-1 sm:grid-cols-3">
          <div
            className={`px-4 py-2 font-black uppercase tracking-wider text-xs flex items-center space-x-2 ${
              isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950/60 text-slate-300'
            }`}
          >
            <Building2 className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Regional y Municipio</span>
          </div>
          <div
            className={`px-4 py-2 sm:col-span-2 flex items-center flex-wrap gap-2 text-xs sm:text-sm ${
              isLight ? 'text-slate-950' : 'text-slate-200'
            }`}
          >
            <span className="font-black">{expendio.centroOperativo || 'PO.BUCARAMANGA'}</span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span className="font-semibold">
              Municipio: <strong>{expendio.municipio}</strong>
            </span>
            {realSipost && (
              <>
                <span aria-hidden="true" className="text-slate-400">·</span>
                <span className="font-mono font-black text-emerald-800 dark:text-emerald-300">
                  SIPOST: {realSipost}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Row 7: Observaciones (Solo lo que está registrado en la observación real) */}
        <div className="grid grid-cols-1 sm:grid-cols-3">
          <div
            className={`px-4 py-2 font-black uppercase tracking-wider text-xs flex items-center space-x-2 ${
              isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950/60 text-slate-300'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Observaciones</span>
          </div>
          <div
            className={`px-4 py-2 sm:col-span-2 font-bold text-xs sm:text-sm leading-relaxed ${
              realObservacion
                ? isLight
                  ? 'text-slate-900'
                  : 'text-slate-200'
                : 'text-slate-400 dark:text-slate-500 italic font-medium'
            }`}
          >
            {realObservacion || 'Sin observaciones registradas'}
          </div>
        </div>
      </div>
    </div>
  );
};
