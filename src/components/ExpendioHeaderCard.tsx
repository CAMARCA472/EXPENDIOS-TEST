import React from 'react';
import { ExpendioData } from '../types';
import { Store, User, Hash, MapPin, Phone, CreditCard, Building2, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import { formatCuentaBancaria } from '../utils/formatters';

interface ExpendioHeaderCardProps {
  expendio: ExpendioData;
  isLight?: boolean;
  onOpenCapacitacion?: () => void;
}

export const ExpendioHeaderCard: React.FC<ExpendioHeaderCardProps> = ({
  expendio,
  isLight = true,
  onOpenCapacitacion,
}) => {
  const bankingFormatted = formatCuentaBancaria(
    expendio.cuentaBancaria || expendio.telefonoPunto,
    expendio.banco || 'NEQUI'
  );

  return (
    <div className={`rounded-2xl border shadow-sm overflow-hidden transition-colors duration-200 ${
      isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
    }`}>
      {/* Top Banner */}
      <div className={`px-6 py-5 border-b text-center relative ${
        isLight ? 'bg-white border-slate-300' : 'bg-slate-950 border-slate-800'
      }`}>
        <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-amber-400 text-black border border-amber-600">
            <Store className="w-3.5 h-3.5" />
            <span>Módulo de Consulta & Gestión de Expendio</span>
          </div>

          {onOpenCapacitacion && (
            <button
              type="button"
              onClick={onOpenCapacitacion}
              className="inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-sky-100 hover:bg-sky-200 text-black border border-sky-400 cursor-pointer transition-colors"
              title="Ver guía y capacitación de los módulos"
            >
              <span>📘 Ver Capacitación</span>
            </button>
          )}
        </div>
        <h2 className="text-xl sm:text-2xl font-black uppercase tracking-wide text-black">
          EXPENDIO {expendio.localidad || expendio.municipio}
        </h2>
      </div>

      {/* Structured Information Table */}
      <div className={`divide-y text-xs sm:text-sm ${
        isLight ? 'divide-slate-300' : 'divide-slate-800'
      }`}>
        {/* Row 1: Nombre Encargado */}
        <div className={`grid grid-cols-1 sm:grid-cols-3 transition-colors ${
          isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
        }`}>
          <div className={`px-5 py-3 font-black uppercase tracking-wider flex items-center space-x-2 border-b sm:border-b-0 sm:border-r ${
            isLight ? 'bg-slate-100 text-black border-slate-300' : 'bg-slate-950/60 text-slate-300 border-slate-800'
          }`}>
            <User className="w-4 h-4 text-amber-600 shrink-0" />
            <span>NOMBRE ENCARGADO</span>
          </div>
          <div className={`px-5 py-3 sm:col-span-2 font-bold flex items-center ${
            isLight ? 'text-black' : 'text-slate-100'
          }`}>
            {expendio.encargado || 'SIN ENCARGADO REGISTRADO'}
          </div>
        </div>

        {/* Row 2: Cédula */}
        <div className={`grid grid-cols-1 sm:grid-cols-3 transition-colors ${
          isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
        }`}>
          <div className={`px-5 py-3 font-black uppercase tracking-wider flex items-center space-x-2 border-b sm:border-b-0 sm:border-r ${
            isLight ? 'bg-slate-100 text-black border-slate-300' : 'bg-slate-950/60 text-slate-300 border-slate-800'
          }`}>
            <Hash className="w-4 h-4 text-amber-600 shrink-0" />
            <span>CÉDULA DE CIUDADANÍA</span>
          </div>
          <div className={`px-5 py-3 sm:col-span-2 font-mono font-black text-sm flex items-center ${
            isLight ? 'text-black' : 'text-slate-100'
          }`}>
            {expendio.cedula}
          </div>
        </div>

        {/* Row 3: Dirección */}
        <div className={`grid grid-cols-1 sm:grid-cols-3 transition-colors ${
          isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
        }`}>
          <div className={`px-5 py-3 font-black uppercase tracking-wider flex items-center space-x-2 border-b sm:border-b-0 sm:border-r ${
            isLight ? 'bg-slate-100 text-black border-slate-300' : 'bg-slate-950/60 text-slate-300 border-slate-800'
          }`}>
            <MapPin className="w-4 h-4 text-amber-600 shrink-0" />
            <span>DIRECCIÓN DEL EXPENDIO</span>
          </div>
          <div className={`px-5 py-3 sm:col-span-2 font-bold flex items-center ${
            isLight ? 'text-black' : 'text-slate-200'
          }`}>
            {expendio.direccionPunto || 'Dirección no registrada'}
          </div>
        </div>

        {/* Row 4: Teléfono */}
        <div className={`grid grid-cols-1 sm:grid-cols-3 transition-colors ${
          isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
        }`}>
          <div className={`px-5 py-3 font-black uppercase tracking-wider flex items-center space-x-2 border-b sm:border-b-0 sm:border-r ${
            isLight ? 'bg-slate-100 text-black border-slate-300' : 'bg-slate-950/60 text-slate-300 border-slate-800'
          }`}>
            <Phone className="w-4 h-4 text-amber-600 shrink-0" />
            <span>CELULAR / CONTACTO</span>
          </div>
          <div className={`px-5 py-3 sm:col-span-2 font-mono font-black flex items-center ${
            isLight ? 'text-black' : 'text-slate-200'
          }`}>
            {expendio.telefonoPunto || 'Teléfono no registrado'}
          </div>
        </div>

        {/* Row 5: Cuenta Bancaria */}
        <div className={`grid grid-cols-1 sm:grid-cols-3 transition-colors ${
          isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
        }`}>
          <div className={`px-5 py-3 font-black uppercase tracking-wider flex items-center space-x-2 border-b sm:border-b-0 sm:border-r ${
            isLight ? 'bg-slate-100 text-black border-slate-300' : 'bg-slate-950/60 text-slate-300 border-slate-800'
          }`}>
            <CreditCard className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>CUENTA BANCARIA</span>
          </div>
          <div className="px-5 py-3 sm:col-span-2 font-mono font-black flex items-center flex-wrap gap-2">
            <span className={isLight ? 'text-black text-sm' : 'text-emerald-400 text-sm'}>
              {bankingFormatted.cuenta}
            </span>
            <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-black uppercase border ${
              isLight ? 'bg-emerald-100 text-black border-emerald-400' : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}>
              {bankingFormatted.banco}
            </span>
          </div>
        </div>

        {/* Row 6: Centro Operativo */}
        <div className={`grid grid-cols-1 sm:grid-cols-3 transition-colors ${
          isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
        }`}>
          <div className={`px-5 py-3 font-black uppercase tracking-wider flex items-center space-x-2 border-b sm:border-b-0 sm:border-r ${
            isLight ? 'bg-slate-100 text-black border-slate-300' : 'bg-slate-950/60 text-slate-300 border-slate-800'
          }`}>
            <Building2 className="w-4 h-4 text-amber-600 shrink-0" />
            <span>CENTRO OPERATIVO</span>
          </div>
          <div className={`px-5 py-3 sm:col-span-2 flex items-center space-x-3 ${
            isLight ? 'text-black' : 'text-slate-300'
          }`}>
            <span className={`font-black ${isLight ? 'text-black' : 'text-slate-100'}`}>
              {expendio.centroOperativo || 'PO.BUCARAMANGA'}
            </span>
            <span className="text-slate-400 dark:text-slate-600">•</span>
            <span className={isLight ? 'text-black font-semibold' : 'text-slate-400'}>
              Municipio: <strong className={isLight ? 'text-black font-black' : 'text-slate-100'}>{expendio.municipio}</strong>
            </span>
          </div>
        </div>

        {/* Row 7: Usuario SIPOST */}
        <div className={`grid grid-cols-1 sm:grid-cols-3 transition-colors ${
          isLight ? 'hover:bg-slate-50/60' : 'hover:bg-slate-800/40'
        }`}>
          <div className={`px-5 py-3 font-black uppercase tracking-wider flex items-center space-x-2 border-b sm:border-b-0 sm:border-r ${
            isLight ? 'bg-slate-100 text-black border-slate-300' : 'bg-slate-950/60 text-slate-300 border-slate-800'
          }`}>
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className={isLight ? 'text-black font-black' : 'text-slate-300'}>USUARIO SIPOST</span>
          </div>
          <div className={`px-5 py-3 sm:col-span-2 font-mono font-black flex items-center ${
            isLight ? 'text-black' : 'text-emerald-300'
          }`}>
            {expendio.usuarioSipost || 'ex.sipost'}
          </div>
        </div>

        {/* Row 8: Observaciones o Comentarios */}
        {(expendio.observaciones || expendio.observacion) && (
          <div className={`grid grid-cols-1 sm:grid-cols-3 transition-colors ${
            isLight ? 'hover:bg-slate-50/60' : 'hover:bg-slate-800/40'
          }`}>
            <div className={`px-5 py-3 font-black uppercase tracking-wider flex items-center space-x-2 border-b sm:border-b-0 sm:border-r ${
              isLight ? 'bg-slate-100 text-black border-slate-300' : 'bg-slate-950/60 text-slate-300 border-slate-800'
            }`}>
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className={isLight ? 'text-black font-black' : 'text-slate-300'}>OBSERVACIONES REGISTRADAS</span>
            </div>
            <div className={`px-5 py-3 sm:col-span-2 font-bold flex items-center text-xs leading-relaxed ${
              isLight ? 'text-black' : 'text-slate-200'
            }`}>
              {expendio.observaciones || expendio.observacion}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
