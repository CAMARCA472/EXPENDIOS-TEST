import React from 'react';
import {
  User,
  CheckCircle2,
  FileText,
  ExternalLink,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
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
  lastLocalSaveTime?: string;
  hasPendingOfflineData?: boolean;
}

export const ExpendioDataUpdateModule: React.FC<ExpendioDataUpdateModuleProps> = ({
  expendio,
  encargado,
  setEncargado,
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
  lastLocalSaveTime,
  hasPendingOfflineData = false,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Formulario Principal de Datos (Letra Grande y Botones Táctiles de 48px+) */}
      <div
        className={`p-4 sm:p-6 rounded-2xl border-2 space-y-5 ${
          isLight ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-900 border-slate-800'
        }`}
      >
        <div className="border-b border-slate-200 dark:border-slate-800 pb-3.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4
              className={`font-black text-base sm:text-lg flex items-center space-x-2 ${
                isLight ? 'text-slate-950' : 'text-slate-100'
              }`}
            >
              <User className="w-5 h-5 text-amber-500 shrink-0" />
              <span>Mis Datos de Contacto y Cuenta de Pago</span>
            </h4>
          </div>

          <div
            className={`text-xs sm:text-sm font-bold flex items-center space-x-1.5 ${
              hasPendingOfflineData
                ? 'text-amber-800 dark:text-amber-300'
                : 'text-emerald-800 dark:text-emerald-300'
            }`}
          >
            {hasPendingOfflineData ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span>
              {hasPendingOfflineData
                ? 'Guardado en tu celular (Se enviará apenas regrese el internet)'
                : lastLocalSaveTime
                ? `Autoguardado activo en tu teléfono (${lastLocalSaveTime})`
                : 'Todo lo que escribas se guarda automáticamente en tu teléfono'}
            </span>
          </div>

          <p
            className={`text-xs sm:text-sm font-semibold leading-relaxed ${
              isLight ? 'text-slate-700' : 'text-slate-300'
            }`}
          >
            Revisa que tu nombre, celular, dirección y cuenta de banco estén correctos para el pago de tu cuenta de cobro.
          </p>
        </div>

        <form onSubmit={onSaveContact} className="space-y-4">
          {/* Nombre Completo */}
          <div>
            <label
              className={`block text-sm font-black mb-1.5 ${
                isLight ? 'text-slate-950' : 'text-slate-200'
              }`}
            >
              1. Nombre Completo del Encargado:
            </label>
            <input
              type="text"
              value={encargado}
              onChange={(e) => setEncargado(e.target.value.toUpperCase())}
              className={`w-full min-h-[48px] text-base border-2 rounded-xl px-4 py-2.5 uppercase font-bold focus:outline-none ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                  : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-amber-500'
              }`}
              placeholder="ESCRIBE TU NOMBRE Y APELLIDOS..."
              required
            />
          </div>

          {/* Cédula y Celular */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                className={`block text-sm font-black mb-1.5 ${
                  isLight ? 'text-slate-950' : 'text-slate-200'
                }`}
              >
                2. Número de Cédula (Fijo):
              </label>
              <div
                className={`w-full min-h-[48px] text-base border-2 rounded-xl px-4 py-2.5 font-mono tabular-nums font-black uppercase flex items-center justify-between ${
                  isLight
                    ? 'bg-slate-100 border-slate-300 text-slate-800 select-none'
                    : 'bg-slate-900 border-slate-800 text-slate-300 select-none'
                }`}
              >
                <span>{expendio.cedula || 'NO ASIGNADA'}</span>
                <span className="text-xs font-bold text-slate-500">Verificada</span>
              </div>
            </div>

            <div>
              <label
                className={`block text-sm font-black mb-1.5 ${
                  isLight ? 'text-slate-950' : 'text-slate-200'
                }`}
              >
                3. Número de Celular:
              </label>
              <input
                type="tel"
                value={telefonoPunto}
                onChange={(e) => setTelefonoPunto(e.target.value.toUpperCase())}
                className={`w-full min-h-[48px] text-base border-2 rounded-xl px-4 py-2.5 font-mono tabular-nums font-black uppercase focus:outline-none ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                    : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-amber-500'
                }`}
                placeholder="EJ: 3174780634"
                required
              />
            </div>
          </div>

          {/* Dirección del Expendio */}
          <div>
            <label
              className={`block text-sm font-black mb-1.5 ${
                isLight ? 'text-slate-950' : 'text-slate-200'
              }`}
            >
              4. Dirección del Expendio en el Municipio:
            </label>
            <input
              type="text"
              value={direccionPunto}
              onChange={(e) => setDireccionPunto(e.target.value.toUpperCase())}
              className={`w-full min-h-[48px] text-base border-2 rounded-xl px-4 py-2.5 uppercase font-bold focus:outline-none ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                  : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-amber-500'
              }`}
              placeholder="EJ: CALLE 5 # 4-12 BARRIO CENTRO"
              required
            />
          </div>

          {/* Cuenta Bancaria y Entidad */}
          <div
            className={`space-y-4 p-4 rounded-2xl border-2 ${
              isLight ? 'bg-amber-50/50 border-amber-300' : 'bg-slate-950/60 border-slate-800'
            }`}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  className={`block text-sm font-black mb-1.5 ${
                    isLight ? 'text-slate-950' : 'text-slate-200'
                  }`}
                >
                  5. ¿Por dónde recibes tu pago? <span className="text-red-600">*</span>
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
                  className={`w-full min-h-[48px] text-base border-2 rounded-xl px-3.5 py-2.5 font-black uppercase focus:outline-none cursor-pointer ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                      : 'bg-slate-900 border-slate-700 text-slate-100 focus:border-amber-500'
                  }`}
                >
                  <option value="NEQUI">NEQUI</option>
                  <option value="AHORROS BANCOLOMBIA">AHORROS BANCOLOMBIA</option>
                  <option value="CUENTA CORRIENTE BANCOLOMBIA">CORRIENTE BANCOLOMBIA</option>
                  <option value="DAVIPLATA">DAVIPLATA</option>
                  <option value="OTROS">OTRO BANCO (ESCRIBIR CUAL)</option>
                </select>
              </div>

              <div>
                <label
                  className={`block text-sm font-black mb-1.5 ${
                    isLight ? 'text-slate-950' : 'text-slate-200'
                  }`}
                >
                  6. Número de Cuenta o Nequi <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={cuentaBancaria}
                  onChange={(e) => setCuentaBancaria(e.target.value.toUpperCase())}
                  className={`w-full min-h-[48px] text-base border-2 rounded-xl px-4 py-2.5 font-mono tabular-nums font-black uppercase focus:outline-none ${
                    isLight
                      ? 'bg-white border-slate-300 text-emerald-900 focus:border-amber-500'
                      : 'bg-slate-900 border-slate-700 text-emerald-400 focus:border-amber-500'
                  }`}
                  placeholder="NÚMERO DE CUENTA O CELULAR..."
                  required
                />
              </div>
            </div>

            {tipoBanco === 'OTROS' && (
              <div>
                <label
                  className={`block text-sm font-black mb-1.5 ${
                    isLight ? 'text-amber-950' : 'text-amber-300'
                  }`}
                >
                  Escribe el nombre de tu Banco: <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={otroBanco}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setOtroBanco(val);
                    setBanco(val);
                  }}
                  className={`w-full min-h-[48px] text-base border-2 rounded-xl px-4 py-2.5 font-black uppercase focus:outline-none ${
                    isLight
                      ? 'bg-white border-amber-400 text-slate-950 focus:border-amber-500'
                      : 'bg-slate-900 border-amber-500/60 text-slate-100 focus:border-amber-500'
                  }`}
                  placeholder="EJ: BANCO AGRARIO, BANCO DE BOGOTÁ..."
                  required={tipoBanco === 'OTROS'}
                />
              </div>
            )}
          </div>

          {/* Correo Electrónico */}
          <div>
            <label
              className={`block text-sm font-black mb-1.5 ${
                isLight ? 'text-slate-950' : 'text-slate-200'
              }`}
            >
              7. Correo Electrónico:
            </label>
            <input
              type="text"
              value={correoElectronico}
              onChange={(e) => setCorreoElectronico(e.target.value.trim().toUpperCase())}
              className={`w-full min-h-[48px] text-base border-2 rounded-xl px-4 py-2.5 uppercase font-bold focus:outline-none ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                  : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-amber-500'
              }`}
              placeholder="CORREO@EJEMPLO.COM"
              required
            />
          </div>

          {/* Observaciones */}
          <div>
            <label
              className={`block text-sm font-black mb-1.5 flex items-center justify-between ${
                isLight ? 'text-slate-950' : 'text-slate-200'
              }`}
            >
              <span>8. Comentarios o Novedades del Punto:</span>
              <span className={`text-xs font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                Opcional
              </span>
            </label>
            <textarea
              rows={3}
              value={observaciones}
              onChange={(e) => setObservaciones && setObservaciones(e.target.value.toUpperCase())}
              className={`w-full text-base border-2 rounded-xl p-3.5 uppercase font-semibold focus:outline-none transition-colors ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-500'
                  : 'bg-slate-950 border-slate-700 text-slate-100 focus:border-amber-500'
              }`}
              placeholder="Si tienes alguna novedad o mensaje para la oficina, escríbelo aquí..."
            />
          </div>

          {/* Botón Principal Grande para Guardar */}
          <button
            type="submit"
            disabled={savingForm1}
            className="w-full min-h-[54px] bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-3.5 px-5 rounded-xl border-2 border-amber-700 shadow-md text-sm sm:text-base flex items-center justify-center space-x-2.5 cursor-pointer transition-all active:scale-98"
          >
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>
              {savingForm1
                ? 'Guardando tus datos...'
                : 'Guardar Mis Datos y Continuar a Fotos'}
            </span>
            <ArrowRight className="w-5 h-5 shrink-0" />
          </button>
        </form>

        {msgForm1 && (
          <div className="p-4 bg-emerald-50 border-2 border-emerald-400 text-emerald-950 rounded-xl text-sm flex items-start space-x-2.5 font-bold">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <span>{msgForm1}</span>
          </div>
        )}
      </div>

      {/* Tarjeta de Contrato Digital (Opcional / Soportes) */}
      <div
        className={`p-4 sm:p-6 rounded-2xl border-2 space-y-4 flex flex-col justify-between ${
          isLight ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-900 border-slate-800'
        }`}
      >
        <div className="space-y-4">
          <div className="border-b border-slate-300 dark:border-slate-800 pb-3.5">
            <h4
              className={`font-black text-base sm:text-lg flex items-center space-x-2 ${
                isLight ? 'text-slate-950' : 'text-slate-100'
              }`}
            >
              <FileText className="w-5 h-5 text-amber-500 shrink-0" />
              <span>Copia de Mi Contrato (Opcional)</span>
            </h4>
            <p
              className={`text-xs sm:text-sm font-semibold mt-1 ${
                isLight ? 'text-slate-700' : 'text-slate-300'
              }`}
            >
              Aquí puedes ver o guardar el archivo PDF de tu contrato firmado con 4-72.
            </p>
          </div>

          <div
            className={`p-4 rounded-xl border-2 space-y-3 ${
              isLight ? 'bg-slate-50 border-slate-300' : 'bg-slate-950/60 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-sm font-black ${
                  isLight ? 'text-slate-950' : 'text-slate-200'
                }`}
              >
                Estado del archivo:
              </span>
              {expendio.contratoPdfUrl ? (
                <span className="text-sm font-black text-emerald-800 dark:text-emerald-300 flex items-center space-x-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Contrato Cargado</span>
                </span>
              ) : (
                <span className="text-sm font-black text-amber-800 dark:text-amber-300">
                  Aún no subido
                </span>
              )}
            </div>

            {expendio.contratoPdfUrl ? (
              <a
                href={expendio.contratoPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full min-h-[48px] py-3 px-4 rounded-xl text-sm font-black bg-slate-950 hover:bg-slate-800 text-white flex items-center justify-center space-x-2 transition-colors cursor-pointer shadow-sm"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Ver o Descargar Mi Contrato</span>
              </a>
            ) : (
              <p
                className={`text-xs sm:text-sm font-semibold leading-relaxed ${
                  isLight ? 'text-slate-800' : 'text-slate-300'
                }`}
              >
                Si ya tienes el PDF de tu contrato firmado en el celular, puedes subirlo con el botón de abajo.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 pt-3 border-t border-slate-300 dark:border-slate-800">
          <label className="min-h-[50px] flex items-center justify-center w-full text-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-950 dark:text-white font-black py-3 px-4 rounded-xl text-sm cursor-pointer border-2 border-slate-400 dark:border-slate-600 transition-all">
            <span>{uploadingContract ? 'Subiendo archivo PDF...' : '📄 Subir Contrato en PDF'}</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={onContractUpload}
              disabled={uploadingContract}
              className="hidden"
            />
          </label>

          {msgForm3 && (
            <p className="text-sm text-center font-black text-emerald-800 dark:text-emerald-300">
              {msgForm3}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
