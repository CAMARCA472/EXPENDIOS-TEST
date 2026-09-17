import React from 'react';
import { User, ShieldCheck, AlertCircle, CheckCircle2, CreditCard, X, Sparkles, ArrowRight } from 'lucide-react';

interface ExpendioFirstLoginModalProps {
  isOpen: boolean;
  encargado: string;
  setEncargado: (val: string) => void;
  cedulaInput: string;
  setCedulaInput: (val: string) => void;
  direccionPunto: string;
  setDireccionPunto: (val: string) => void;
  telefonoPunto: string;
  setTelefonoPunto: (val: string) => void;
  cuentaBancaria: string;
  setCuentaBancaria: (val: string) => void;
  tipoBanco: string;
  setTipoBanco: (val: string) => void;
  otroBanco: string;
  setOtroBanco: (val: string) => void;
  setBanco: (val: string) => void;
  correoElectronico: string;
  setCorreoElectronico: (val: string) => void;
  observaciones?: string;
  setObservaciones?: (val: string) => void;
  savingFirstLogin: boolean;
  msgFirstLogin: string;
  onSubmit: (e: React.FormEvent) => void;
  onClose?: () => void;
  onDismiss?: () => void;
  onAutoFillTest?: () => void;
}

export const ExpendioFirstLoginModal: React.FC<ExpendioFirstLoginModalProps> = ({
  isOpen,
  encargado,
  setEncargado,
  cedulaInput,
  setCedulaInput,
  direccionPunto,
  setDireccionPunto,
  telefonoPunto,
  setTelefonoPunto,
  cuentaBancaria,
  setCuentaBancaria,
  tipoBanco,
  setTipoBanco,
  otroBanco,
  setOtroBanco,
  setBanco,
  correoElectronico,
  setCorreoElectronico,
  observaciones = '',
  setObservaciones,
  savingFirstLogin,
  msgFirstLogin,
  onSubmit,
  onClose,
  onDismiss,
  onAutoFillTest,
}) => {
  if (!isOpen) return null;

  const handleClose = () => {
    if (onDismiss) onDismiss();
    else if (onClose) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-300 max-w-2xl w-full max-h-[95vh] flex flex-col text-slate-900 animate-in fade-in zoom-in-95 duration-200 relative">
        
        {/* Sticky Header with Close Button */}
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-slate-200 bg-white/95 backdrop-blur rounded-t-3xl">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0 border border-amber-300">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300 mb-0.5">
                Paso 1 Obligatorio
              </div>
              <h3 className="text-sm sm:text-base font-black text-slate-900 uppercase tracking-tight leading-none">
                Actualización de Datos
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            title="Cerrar ventana / Continuar al módulo"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">

          <div className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
            Por disposición de seguridad y control contractual, debes confirmar y actualizar tus datos en <strong className="text-slate-900 font-bold">MAYÚSCULAS</strong>.
          </div>

        {/* Quick Test Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs">
          <span className="text-slate-600 font-medium flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-500" />
            ¿Estás en entorno de pruebas?
          </span>
          <div className="flex items-center gap-2">
            {onAutoFillTest && (
              <button
                type="button"
                onClick={onAutoFillTest}
                className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold rounded-lg transition-colors text-[11px] cursor-pointer"
              >
                Autocompletar Prueba
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-lg transition-colors text-[11px] cursor-pointer flex items-center gap-1"
            >
              <span>Omitir por Ahora</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="space-y-3 text-[11px]">
          <div>
            <label className="block font-bold text-slate-700 mb-1 tracking-wider uppercase">
              NOMBRE COMPLETO DEL ENCARGADO <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={encargado}
              onChange={(e) => setEncargado(e.target.value.toUpperCase())}
              className="w-full bg-slate-50 border-2 border-slate-300 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-slate-900 font-semibold uppercase focus:outline-none focus:bg-white"
              placeholder="NOMBRE Y APELLIDOS..."
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block font-bold text-slate-700 mb-1 tracking-wider uppercase">
                CÉDULA DE CIUDADANÍA <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={cedulaInput}
                onChange={(e) => setCedulaInput(e.target.value.toUpperCase())}
                className="w-full bg-slate-50 border-2 border-slate-300 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-slate-900 font-mono font-bold uppercase focus:outline-none focus:bg-white"
                placeholder="NÚMERO DE CÉDULA..."
                required
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1 tracking-wider uppercase">
                CELULAR / TELÉFONO DE CONTACTO <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={telefonoPunto}
                onChange={(e) => setTelefonoPunto(e.target.value.toUpperCase())}
                className="w-full bg-slate-50 border-2 border-slate-300 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-slate-900 font-mono font-bold uppercase focus:outline-none focus:bg-white"
                placeholder="NÚMERO CELULAR..."
                required
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1 tracking-wider uppercase">
              DIRECCIÓN EXACTA DEL PUNTO (EXPENDIO) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={direccionPunto}
              onChange={(e) => setDireccionPunto(e.target.value.toUpperCase())}
              className="w-full bg-slate-50 border-2 border-slate-300 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-slate-900 font-semibold uppercase focus:outline-none focus:bg-white"
              placeholder="DIRECCIÓN FÍSICA COMPLETA..."
              required
            />
          </div>

          {/* Banking details box */}
          <div className="bg-slate-50 p-4 rounded-2xl border-2 border-slate-200 space-y-3">
            <div className="flex items-center space-x-2 text-slate-800 font-bold uppercase text-xs">
              <CreditCard className="w-4 h-4 text-emerald-600" />
              <span>Información Bancaria para Liquidación</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1 uppercase text-[11px]">
                  ENTIDAD BANCARIA / BILLETERA <span className="text-red-500">*</span>
                </label>
                <select
                  value={tipoBanco}
                  onChange={(e) => {
                    const val = e.target.value;
                    setTipoBanco(val);
                    if (val !== 'OTROS') {
                      setBanco(val);
                    } else {
                      setBanco(otroBanco || '');
                    }
                  }}
                  className="w-full bg-white border-2 border-slate-300 focus:border-amber-500 rounded-xl px-3 py-2 text-slate-900 font-bold uppercase focus:outline-none cursor-pointer"
                >
                  <option value="NEQUI">NEQUI (PREDETERMINADA)</option>
                  <option value="AHORROS BANCOLOMBIA">AHORROS BANCOLOMBIA</option>
                  <option value="CUENTA CORRIENTE BANCOLOMBIA">CUENTA CORRIENTE BANCOLOMBIA</option>
                  <option value="DAVIPLATA">DAVIPLATA</option>
                  <option value="OTROS">OTROS (ESCRIBIR BANCO)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1 uppercase text-[11px]">
                  NÚMERO DE CUENTA / CELULAR <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={cuentaBancaria}
                  onChange={(e) => setCuentaBancaria(e.target.value.toUpperCase())}
                  className="w-full bg-white border-2 border-slate-300 focus:border-amber-500 rounded-xl px-3 py-2 text-emerald-700 font-mono font-bold uppercase focus:outline-none"
                  placeholder="NÚMERO DE CUENTA..."
                  required
                />
              </div>
            </div>

            {tipoBanco === 'OTROS' && (
              <div>
                <label className="block font-bold text-amber-800 mb-1 uppercase text-[11px]">
                  ESPECIFIQUE EL NOMBRE DEL BANCO / ENTIDAD <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={otroBanco}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setOtroBanco(val);
                    setBanco(val);
                  }}
                  className="w-full bg-white border-2 border-amber-400 rounded-xl px-3 py-2 text-slate-900 font-bold uppercase focus:outline-none focus:ring-1 focus:ring-amber-500"
                  placeholder="EJ: BANCO DE BOGOTÁ, BANCO AGRARIO..."
                  required={tipoBanco === 'OTROS'}
                />
              </div>
            )}
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1 tracking-wider uppercase">
              CORREO ELECTRÓNICO OFICIAL <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={correoElectronico}
              onChange={(e) => setCorreoElectronico(e.target.value.toUpperCase())}
              className="w-full bg-slate-50 border-2 border-slate-300 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-slate-900 font-semibold uppercase focus:outline-none focus:bg-white"
              placeholder="CORREO@EJEMPLO.COM"
              required
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1 tracking-wider uppercase flex items-center justify-between">
              <span>OBSERVACIONES, COMENTARIOS O SUGERENCIAS</span>
              <span className="text-[10px] text-slate-400 font-normal">OPCIONAL</span>
            </label>
            <textarea
              rows={2}
              value={observaciones}
              onChange={(e) => setObservaciones && setObservaciones(e.target.value.toUpperCase())}
              className="w-full bg-slate-50 border-2 border-slate-300 focus:border-amber-500 rounded-xl px-3.5 py-2 text-slate-900 font-medium uppercase text-xs focus:outline-none focus:bg-white"
              placeholder="OBSERVACIONES O COMENTARIOS DEL EXPENDIO PARA LA ADMINISTRACIÓN..."
            />
          </div>

          {msgFirstLogin && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl font-medium flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{msgFirstLogin}</span>
            </div>
          )}

          <div className="pt-2 space-y-2">
            <button
              type="submit"
              disabled={savingFirstLogin}
              className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-3.5 px-5 rounded-2xl shadow-lg hover:shadow-xl text-sm flex items-center justify-center space-x-2 cursor-pointer transition-all transform active:scale-98"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>
                {savingFirstLogin ? 'Guardando y Verificando...' : 'CONFIRMAR Y GUARDAR DATOS OFICIALES'}
              </span>
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="w-full py-2 px-4 text-xs font-bold text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer text-center"
            >
              Omitir actualización por ahora y entrar directamente al módulo de expendio
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
};
