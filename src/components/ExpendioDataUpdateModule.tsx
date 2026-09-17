import React from 'react';
import { User, Hash, Phone, MapPin, CreditCard, Mail, CheckCircle2, FileText, Upload, Download, ExternalLink } from 'lucide-react';
import { ExpendioData } from '../types';

interface ExpendioDataUpdateModuleProps {
  expendio: ExpendioData;
  encargado: string;
  setEncargado: (val: string) => void;
  cedulaInput: string;
  setCedulaInput: (val: string) => void;
  telefonoPunto: string;
  setTelefonoPunto: (val: string) => void;
  direccionPunto: string;
  setDireccionPunto: (val: string) => void;
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
  savingForm1: boolean;
  msgForm1: string;
  onSaveContact: (e: React.FormEvent) => void;
  onContractUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadingContract: boolean;
  msgForm3: string;
  isLight?: boolean;
}

export const ExpendioDataUpdateModule: React.FC<ExpendioDataUpdateModuleProps> = ({
  expendio,
  encargado,
  setEncargado,
  cedulaInput,
  setCedulaInput,
  telefonoPunto,
  setTelefonoPunto,
  direccionPunto,
  setDireccionPunto,
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
  savingForm1,
  msgForm1,
  onSaveContact,
  onContractUpload,
  uploadingContract,
  msgForm3,
  isLight = true,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Contact Form */}
      <div className={`p-5 rounded-2xl border-2 space-y-4 ${
        isLight ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-900 border-slate-800'
      }`}>
        <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
          <h4 className={`font-black text-sm flex items-center space-x-2 ${
            isLight ? 'text-slate-950' : 'text-slate-100'
          }`}>
            <User className="w-4 h-4 text-amber-500" />
            <span>Actualizar Datos Oficiales de Contacto & Liquidación</span>
          </h4>
          <p className={`text-xs font-bold mt-0.5 ${
            isLight ? 'text-slate-800' : 'text-slate-300'
          }`}>
            Ingresa los datos en mayúsculas. Al guardar se sincronizarán en tu registro contractual.
          </p>
        </div>

        <form onSubmit={onSaveContact} className="space-y-3.5 text-xs">
          <div>
            <label className={`block font-black mb-1 uppercase tracking-wider ${
              isLight ? 'text-slate-950' : 'text-slate-200'
            }`}>
              NOMBRE COMPLETO (ENCARGADO)
            </label>
            <input
              type="text"
              value={encargado}
              onChange={(e) => setEncargado(e.target.value.toUpperCase())}
              className={`w-full border-2 rounded-xl px-3.5 py-2 uppercase font-bold focus:outline-none ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                  : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-amber-500'
              }`}
              placeholder="NOMBRE Y APELLIDOS..."
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={`block font-black mb-1 uppercase tracking-wider ${
                isLight ? 'text-slate-950' : 'text-slate-200'
              }`}>
                CÉDULA DE CIUDADANÍA
              </label>
              <input
                type="text"
                value={cedulaInput}
                onChange={(e) => setCedulaInput(e.target.value.toUpperCase())}
                className={`w-full border-2 rounded-xl px-3.5 py-2 font-mono font-black uppercase focus:outline-none ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                    : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-amber-500'
                }`}
                placeholder="NÚMERO DE CÉDULA..."
                required
              />
            </div>

            <div>
              <label className={`block font-black mb-1 uppercase tracking-wider ${
                isLight ? 'text-slate-950' : 'text-slate-200'
              }`}>
                CELULAR / TELÉFONO
              </label>
              <input
                type="text"
                value={telefonoPunto}
                onChange={(e) => setTelefonoPunto(e.target.value.toUpperCase())}
                className={`w-full border-2 rounded-xl px-3.5 py-2 font-mono font-black uppercase focus:outline-none ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                    : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-amber-500'
                }`}
                placeholder="NÚMERO CELULAR..."
                required
              />
            </div>
          </div>

          <div>
            <label className={`block font-black mb-1 uppercase tracking-wider ${
              isLight ? 'text-slate-950' : 'text-slate-200'
            }`}>
              DIRECCIÓN DEL PUNTO (EXPENDIO)
            </label>
            <input
              type="text"
              value={direccionPunto}
              onChange={(e) => setDireccionPunto(e.target.value.toUpperCase())}
              className={`w-full border-2 rounded-xl px-3.5 py-2 uppercase font-bold focus:outline-none ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                  : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-amber-500'
              }`}
              placeholder="DIRECCIÓN FÍSICA EXACTA..."
              required
            />
          </div>

          {/* CUENTA BANCARIA & ENTIDAD BANCARIA */}
          <div className={`space-y-3 p-3.5 rounded-xl border-2 ${
            isLight ? 'bg-slate-100/80 border-slate-300' : 'bg-slate-950/60 border-slate-800'
          }`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={`block text-[11px] font-black mb-1 tracking-wider uppercase ${
                  isLight ? 'text-slate-950' : 'text-slate-200'
                }`}>
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
                  className={`w-full border-2 rounded-xl px-3 py-2 font-black uppercase focus:outline-none cursor-pointer text-xs ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                      : 'bg-slate-900 border-slate-700 text-slate-100 focus:border-amber-500'
                  }`}
                >
                  <option value="NEQUI">NEQUI (PREDETERMINADA)</option>
                  <option value="AHORROS BANCOLOMBIA">AHORROS BANCOLOMBIA</option>
                  <option value="CUENTA CORRIENTE BANCOLOMBIA">CUENTA CORRIENTE BANCOLOMBIA</option>
                  <option value="DAVIPLATA">DAVIPLATA</option>
                  <option value="OTROS">OTROS (ESCRIBIR BANCO)</option>
                </select>
              </div>

              <div>
                <label className={`block text-[11px] font-black mb-1 tracking-wider uppercase ${
                  isLight ? 'text-slate-950' : 'text-slate-200'
                }`}>
                  NÚMERO DE CUENTA / CELULAR <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={cuentaBancaria}
                  onChange={(e) => setCuentaBancaria(e.target.value.toUpperCase())}
                  className={`w-full border-2 rounded-xl px-3 py-2 font-mono font-black uppercase focus:outline-none text-xs ${
                    isLight
                      ? 'bg-white border-slate-300 text-emerald-800 focus:border-amber-500'
                      : 'bg-slate-900 border-slate-700 text-emerald-400 focus:border-amber-500'
                  }`}
                  placeholder="NÚMERO DE CUENTA..."
                  required
                />
              </div>
            </div>

            {tipoBanco === 'OTROS' && (
              <div>
                <label className={`block text-[11px] font-black mb-1 tracking-wider uppercase ${
                  isLight ? 'text-amber-950' : 'text-amber-300'
                }`}>
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
                  className={`w-full border-2 rounded-xl px-3 py-2 font-black uppercase focus:outline-none text-xs ${
                    isLight
                      ? 'bg-white border-amber-400 text-slate-950 focus:border-amber-500'
                      : 'bg-slate-900 border-amber-500/60 text-slate-100 focus:border-amber-500'
                  }`}
                  placeholder="EJ: BANCO DE BOGOTÁ, BANCO AGRARIO..."
                  required={tipoBanco === 'OTROS'}
                />
              </div>
            )}
          </div>

          <div>
            <label className={`block font-black mb-1 uppercase tracking-wider ${
              isLight ? 'text-slate-950' : 'text-slate-200'
            }`}>
              CORREO ELECTRÓNICO OFICIAL
            </label>
            <input
              type="email"
              value={correoElectronico}
              onChange={(e) => setCorreoElectronico(e.target.value.toUpperCase())}
              className={`w-full border-2 rounded-xl px-3.5 py-2 uppercase font-bold focus:outline-none ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                  : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-amber-500'
              }`}
              placeholder="CORREO@EJEMPLO.COM"
              required
            />
          </div>

          <div>
            <label className={`block font-black mb-1 uppercase tracking-wider flex items-center justify-between ${
              isLight ? 'text-slate-950' : 'text-slate-200'
            }`}>
              <span>OBSERVACIONES, COMENTARIOS O SUGERENCIAS</span>
              <span className={`text-[10px] font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>OPCIONAL</span>
            </label>
            <textarea
              rows={3}
              value={observaciones}
              onChange={(e) => setObservaciones && setObservaciones(e.target.value.toUpperCase())}
              className={`w-full border-2 rounded-xl p-3 uppercase font-semibold text-xs focus:outline-none transition-colors ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                  : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-amber-500'
              }`}
              placeholder="ESCRIBA AQUÍ SUS OBSERVACIONES SOBRE EL EXPENDIO, NOVEDADES DE ATENCIÓN, COMENTARIOS O SUGERENCIAS PARA 4-72 Y CAMARCA SAS..."
            />
            <p className={`text-[11px] font-semibold mt-1 ${
              isLight ? 'text-slate-700' : 'text-slate-400'
            }`}>
              Este campo se guardará directamente en la base de datos oficial para conocimiento y seguimiento administrativo.
            </p>
          </div>

          <button
            type="submit"
            disabled={savingForm1}
            className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-2.5 px-4 rounded-xl shadow-md text-xs flex items-center justify-center space-x-2 cursor-pointer transition-all active:scale-98"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{savingForm1 ? 'Guardando Cambios...' : 'Guardar y Confirmar Datos (En Mayúsculas)'}</span>
          </button>
        </form>

        {msgForm1 && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl text-xs flex items-center space-x-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{msgForm1}</span>
          </div>
        )}
      </div>

      {/* Contract and Documents Card */}
      <div className={`p-5 rounded-2xl border-2 space-y-4 flex flex-col justify-between ${
        isLight ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-900 border-slate-800'
      }`}>
        <div className="space-y-4">
          <div className="border-b border-slate-300 dark:border-slate-800 pb-3">
            <h4 className={`font-black text-sm flex items-center space-x-2 ${
              isLight ? 'text-slate-950' : 'text-slate-100'
            }`}>
              <FileText className="w-4 h-4 text-amber-500" />
              <span>Contrato & Documentos Contractuales</span>
            </h4>
            <p className={`text-xs font-bold mt-0.5 ${
              isLight ? 'text-slate-900' : 'text-slate-300'
            }`}>
              Copia del contrato de expendio firmado con 4-72 y soportes legales.
            </p>
          </div>

          <div className={`p-4 rounded-xl border-2 space-y-3 ${
            isLight ? 'bg-slate-50 border-slate-300' : 'bg-slate-950/60 border-slate-800'
          }`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-black uppercase ${
                isLight ? 'text-slate-950' : 'text-slate-200'
              }`}>
                Estado del Contrato:
              </span>
              {expendio.contratoPdfUrl ? (
                <span className="text-xs px-2.5 py-0.5 rounded-full font-black bg-emerald-100 text-emerald-950 border border-emerald-400 flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>PDF Cargado</span>
                </span>
              ) : (
                <span className="text-xs px-2.5 py-0.5 rounded-full font-black bg-amber-200 text-amber-950 border border-amber-500">
                  Sin Contrato Adjunto
                </span>
              )}
            </div>

            {expendio.contratoPdfUrl ? (
              <a
                href={expendio.contratoPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 px-4 rounded-xl text-xs font-black bg-slate-950 hover:bg-slate-800 text-white flex items-center justify-center space-x-2 transition-colors cursor-pointer shadow-sm"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Visualizar / Descargar Contrato Actual</span>
              </a>
            ) : (
              <p className={`text-xs font-bold ${
                isLight ? 'text-slate-900' : 'text-slate-300'
              }`}>
                Puedes adjuntar el PDF de tu contrato firmado para tenerlo siempre disponible en tu expediente.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t border-slate-300 dark:border-slate-800">
          <label className="block w-full text-center bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-2.5 px-4 rounded-xl text-xs cursor-pointer shadow-md transition-all border border-amber-600">
            {uploadingContract ? 'Subiendo Contrato...' : '📄 Subir / Actualizar Contrato (PDF)'}
            <input
              type="file"
              accept="application/pdf"
              onChange={onContractUpload}
              disabled={uploadingContract}
              className="hidden"
            />
          </label>

          {msgForm3 && (
            <p className="text-xs text-center font-black text-emerald-800 dark:text-emerald-300">
              {msgForm3}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
