import React, { useState } from 'react';
import { AlertTriangle, Lock, Eye, EyeOff, Trash2, X, ShieldAlert } from 'lucide-react';

export const ADMIN_SECURITY_PASSWORD = 'Camarca.2023*';

interface ConfirmarBorradoModalProps {
  isOpen: boolean;
  titulo: string;
  mensajeAdvertencia: string;
  detallesExtra?: string;
  textoBotonConfirmar?: string;
  isProcessing?: boolean;
  onConfirm: (password: string) => Promise<void> | void;
  onClose: () => void;
}

export const ConfirmarBorradoModal: React.FC<ConfirmarBorradoModalProps> = ({
  isOpen,
  titulo,
  mensajeAdvertencia,
  detallesExtra,
  textoBotonConfirmar = 'Confirmar y Borrar Base de Datos',
  isProcessing = false,
  onConfirm,
  onClose,
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setErrorMsg('Debe ingresar la contraseña de seguridad para continuar.');
      return;
    }

    if (password !== ADMIN_SECURITY_PASSWORD) {
      setErrorMsg('Contraseña de seguridad incorrecta. Operación cancelada.');
      return;
    }

    setErrorMsg('');
    onConfirm(password);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-slate-900 border-2 border-red-500/70 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden text-slate-100 transform transition-all animate-scaleUp">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-red-950 via-slate-900 to-red-950/80 p-5 border-b border-red-800/60 flex items-start justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="p-2.5 bg-red-600/20 border border-red-500/50 rounded-xl text-red-400 shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>{titulo}</span>
              </h3>
              <p className="text-xs text-red-300/90 font-medium mt-0.5">
                Acción crítica de administración y seguridad
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

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Warning Message Box */}
          <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs text-red-200 leading-relaxed space-y-1">
              <p className="font-semibold">{mensajeAdvertencia}</p>
              {detallesExtra && (
                <p className="text-slate-300 text-[11px] opacity-90">{detallesExtra}</p>
              )}
            </div>
          </div>

          {/* Password Authorization Box */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>Ingrese la Contraseña Maestra de Autorización:</span>
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
                placeholder="Escriba la contraseña de seguridad..."
                className="w-full bg-slate-950 border border-slate-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 text-slate-100 placeholder-slate-500 text-sm rounded-xl py-2.5 pl-3.5 pr-10 outline-none transition-all font-mono"
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
              <p className="text-xs text-red-400 font-medium flex items-center gap-1 pt-1 animate-shake">
                <span>⚠️</span> {errorMsg}
              </p>
            ) : (
              <p className="text-[11px] text-slate-400 flex items-center gap-1 pt-0.5">
                <span>🔒</span> Esta acción requiere la clave de seguridad autorizada para evitar eliminaciones accidentales.
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
              disabled={isProcessing || !password.trim()}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-red-950/60 cursor-pointer flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              <span>{isProcessing ? 'Procesando eliminación...' : textoBotonConfirmar}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
