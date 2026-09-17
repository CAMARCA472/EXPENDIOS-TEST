import React, { useState } from 'react';
import {
  Trash2,
  ShieldAlert,
  AlertTriangle,
  Lock,
  Eye,
  EyeOff,
  Store,
  Receipt,
  History,
  Loader2,
  X,
  CheckSquare,
  Square,
} from 'lucide-react';
import { ADMIN_SECURITY_PASSWORD } from './ConfirmarBorradoModal';

interface EliminarBaseDatosModalProps {
  isOpen: boolean;
  onClose: () => void;
  expendiosCount: number;
  relacionPagosCount: number;
  historialCount: number;
  onSuccessDelete: (mensaje: string) => void;
}

export const EliminarBaseDatosModal: React.FC<EliminarBaseDatosModalProps> = ({
  isOpen,
  onClose,
  expendiosCount,
  relacionPagosCount,
  historialCount,
  onSuccessDelete,
}) => {
  const [targetExpendios, setTargetExpendios] = useState<boolean>(true);
  const [targetRelacionPagos, setTargetRelacionPagos] = useState<boolean>(true);
  const [targetHistorial, setTargetHistorial] = useState<boolean>(true);

  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  if (!isOpen) return null;

  const totalSelected = [targetExpendios, targetRelacionPagos, targetHistorial].filter(Boolean).length;
  const isAllSelected = targetExpendios && targetRelacionPagos && targetHistorial;

  const handleSelectAll = () => {
    setTargetExpendios(true);
    setTargetRelacionPagos(true);
    setTargetHistorial(true);
  };

  const handleDeselectAll = () => {
    setTargetExpendios(false);
    setTargetRelacionPagos(false);
    setTargetHistorial(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalSelected === 0) {
      setErrorMsg('Seleccione al menos una base de datos para eliminar.');
      return;
    }

    if (!password.trim()) {
      setErrorMsg('Debe ingresar la contraseña de seguridad para autorizar la eliminación.');
      return;
    }

    if (password !== ADMIN_SECURITY_PASSWORD) {
      setErrorMsg('Contraseña de seguridad incorrecta. Operación de borrado no autorizada.');
      return;
    }

    setErrorMsg('');
    setIsProcessing(true);

    try {
      const res = await fetch('/api/admin/vaciar-base-datos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          targets: {
            expendios: targetExpendios,
            relacionPagos: targetRelacionPagos,
            historial: targetHistorial,
            todo: isAllSelected,
          },
        }),
      });

      const data = await res.json();
      if (data.success) {
        onSuccessDelete(data.message || '✓ Base de datos eliminada exitosamente.');
        onClose();
      } else {
        setErrorMsg(data.message || 'Error al procesar la eliminación de la base de datos.');
      }
    } catch (err: any) {
      console.error('Error al vaciar base de datos:', err);
      setErrorMsg('Error de conexión con el servidor al procesar la eliminación.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-slate-900 border-2 border-rose-500/70 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden text-slate-100 transform transition-all animate-scaleUp">
        {/* Header */}
        <div className="bg-gradient-to-r from-rose-950 via-slate-900 to-rose-950/90 p-5 border-b border-rose-800/60 flex items-start justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="p-2.5 bg-rose-600/20 border border-rose-500/50 rounded-xl text-rose-400 shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>Eliminar Base de Datos</span>
                <span className="text-[10px] uppercase font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-full">
                  Administrador
                </span>
              </h3>
              <p className="text-xs text-rose-300/90 font-medium mt-0.5">
                Vaciado centralizado de expendios, relación de pagos e historial
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Quick Selection Helpers */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200">
              Seleccione los módulos a eliminar:
            </span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold underline cursor-pointer"
              >
                Seleccionar Todo
              </button>
              <span className="text-slate-600 text-xs">|</span>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="text-[11px] text-slate-400 hover:text-slate-200 font-medium cursor-pointer"
              >
                Deseleccionar
              </button>
            </div>
          </div>

          {/* Selection Items */}
          <div className="space-y-2.5">
            {/* 1. Base de datos de Expendios */}
            <div
              onClick={() => setTargetExpendios(!targetExpendios)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                targetExpendios
                  ? 'bg-rose-950/40 border-rose-500/80 shadow-sm'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 opacity-75'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className="text-rose-400">
                  {targetExpendios ? (
                    <CheckSquare className="w-5 h-5 text-rose-400" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-600" />
                  )}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <Store className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold text-slate-100">
                      Base de Datos de Expendios
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Elimina todos los expendios registrados en el censo maestro.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
                {expendiosCount} registros
              </span>
            </div>

            {/* 2. Relación de Pagos (Borrado Total) */}
            <div
              onClick={() => setTargetRelacionPagos(!targetRelacionPagos)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                targetRelacionPagos
                  ? 'bg-rose-950/40 border-rose-500/80 shadow-sm'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 opacity-75'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className="text-rose-400">
                  {targetRelacionPagos ? (
                    <CheckSquare className="w-5 h-5 text-rose-400" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-600" />
                  )}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <Receipt className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-slate-100">
                      Relación de Pagos (Borrado Total)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Elimina todo lo cargado desde Marzo y meses anteriores. Borrado total y definitivo.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
                {relacionPagosCount} registros
              </span>
            </div>

            {/* 3. Historial de Cobros */}
            <div
              onClick={() => setTargetHistorial(!targetHistorial)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                targetHistorial
                  ? 'bg-rose-950/40 border-rose-500/80 shadow-sm'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 opacity-75'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className="text-rose-400">
                  {targetHistorial ? (
                    <CheckSquare className="w-5 h-5 text-rose-400" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-600" />
                  )}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <History className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-bold text-slate-100">
                      Historial de Cobros
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Elimina todas las cuentas de cobro liquidadas, cargadas y archivadas.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
                {historialCount} cuentas
              </span>
            </div>
          </div>

          {/* Warning Box */}
          <div className="p-3.5 bg-rose-950/40 border border-rose-800/60 rounded-xl flex items-start space-x-3">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-200 leading-relaxed">
              <strong>Atención:</strong> Esta operación es irreversible y vaciará permanentemente los datos seleccionados. Si necesita conservarlos, descargue primero una <strong>Copia de Seguridad</strong> desde el banner superior.
            </p>
          </div>

          {/* Password Authorization */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>Contraseña Maestra de Autorización:</span>
              </span>
              <span className="text-[10px] text-amber-400 font-mono font-medium">Requerida</span>
            </label>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMsg) setErrorMsg('');
                }}
                autoFocus
                placeholder="Ingrese la clave autorizada Camarca.2023*..."
                className="w-full bg-slate-950 border border-slate-700 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 text-slate-100 placeholder-slate-500 text-sm rounded-xl py-2.5 pl-3.5 pr-10 outline-none transition-all font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {errorMsg ? (
              <p className="text-xs text-rose-400 font-medium flex items-center gap-1 pt-1 animate-shake">
                <span>⚠️</span> {errorMsg}
              </p>
            ) : (
              <p className="text-[11px] text-slate-400 flex items-center gap-1 pt-0.5">
                <span>🔒</span> Requiere clave maestra para garantizar la integridad y seguridad de la información.
              </p>
            )}
          </div>

          {/* Modal Actions */}
          <div className="pt-2 flex items-center justify-end space-x-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isProcessing || totalSelected === 0 || !password.trim()}
              className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-rose-950/60 cursor-pointer flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Eliminando datos...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  <span>
                    {isAllSelected
                      ? 'Confirmar Borrado Total del Sistema'
                      : `Confirmar y Borrar (${totalSelected} seleccionados)`}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
