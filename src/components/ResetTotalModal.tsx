import React, { useState } from 'react';
import {
  Trash2,
  AlertTriangle,
  ShieldAlert,
  Loader2,
  X,
  Database,
  Camera,
  Receipt,
  Store,
  History,
  CheckCircle2,
  Lock,
} from 'lucide-react';

interface ResetTotalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccessReset: (message: string) => void;
  expendiosCount: number;
  relacionPagosCount: number;
  historialCount: number;
}

export const ResetTotalModal: React.FC<ResetTotalModalProps> = ({
  isOpen,
  onClose,
  onSuccessReset,
  expendiosCount,
  relacionPagosCount,
  historialCount,
}) => {
  const [confirmationText, setConfirmationText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [resetSuccessData, setResetSuccessData] = useState<any | null>(null);

  if (!isOpen) return null;

  const isConfirmed = confirmationText.trim() === 'RESET TOTAL';

  const handleExecuteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmed) {
      setErrorMsg('Debe escribir exactamente "RESET TOTAL" para confirmar.');
      return;
    }

    setErrorMsg('');
    setIsProcessing(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (typeof window !== 'undefined') {
        const token =
          sessionStorage.getItem('camarca_token') || localStorage.getItem('camarca_token');
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
          headers['x-session-token'] = token;
        }
      }

      const res = await fetch('/api/admin/reset-total', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          confirmation: 'RESET TOTAL',
        }),
      });

      const data = await res.json();
      if (data.success) {
        setResetSuccessData(data.data || {});
        setTimeout(() => {
          onSuccessReset(data.message || '✓ RESET TOTAL EJECUTADO CON ÉXITO: Datos operativos en cero.');
          onClose();
        }, 2000);
      } else {
        setErrorMsg(data.message || 'Error al ejecutar RESET TOTAL en el servidor.');
      }
    } catch (err: any) {
      console.error('Error en Reset Total:', err);
      setErrorMsg('Error de conexión con el servidor al ejecutar RESET TOTAL.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-slate-900 border-2 border-red-600/80 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden text-slate-100 transform transition-all">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-950 via-slate-900 to-red-950 p-5 border-b border-red-800/60 flex items-start justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="p-2.5 bg-red-600/20 border border-red-500/50 rounded-xl text-red-400 shrink-0">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-100 uppercase tracking-wide flex items-center gap-2">
                <span>RESET TOTAL DE DATOS</span>
                <span className="text-[10px] uppercase font-bold bg-red-500/20 text-red-300 border border-red-500/40 px-2 py-0.5 rounded-full">
                  Acción Crítica
                </span>
              </h3>
              <p className="text-xs text-red-300 font-semibold mt-0.5">
                Vaciado absoluto de datos operativos y fotografías en PostgreSQL
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

        {/* Success View */}
        {resetSuccessData ? (
          <div className="p-6 space-y-4 text-center">
            <div className="w-16 h-16 bg-emerald-500/20 border border-emerald-500/40 rounded-full flex items-center justify-center mx-auto text-emerald-400 animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-lg font-bold text-emerald-300">¡RESET TOTAL COMPLETADO CON ÉXITO!</h4>
            <p className="text-xs text-slate-300 max-w-md mx-auto">
              Todos los datos operativos (expendios, relación de pagos, historial de cobros, trazabilidad y fotografías)
              han sido eliminados en PostgreSQL y disco. La estructura de tablas y credenciales se mantienen intactas.
            </p>
          </div>
        ) : (
          /* Form View */
          <form onSubmit={handleExecuteReset} className="p-6 space-y-5">
            {/* Warning Message Box */}
            <div className="p-4 bg-red-950/40 border border-red-600/40 rounded-xl text-xs space-y-2 text-red-200">
              <div className="flex items-center space-x-2 font-bold text-red-300 text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0 text-red-400" />
                <span>ADVERTENCIA DE SEGURIDAD OPERATIVA</span>
              </div>
              <p className="leading-relaxed">
                Esta acción ejecutará una <strong>transacción atómica destructiva</strong> en PostgreSQL que eliminará
                de forma irreversible:
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px] pt-1 font-medium">
                <li>
                  <strong>Base de Expendios:</strong> ({expendiosCount} registros)
                </li>
                <li>
                  <strong>Relación de Pagos:</strong> ({relacionPagosCount} registros)
                </li>
                <li>
                  <strong>Historial de Cuentas de Cobro:</strong> ({historialCount} registros)
                </li>
                <li>
                  <strong>Trazabilidad y Cuentas Cargadas</strong>
                </li>
                <li>
                  <strong>Fotografías Físicas y Metadatos en PostgreSQL</strong>
                </li>
              </ul>
              <div className="p-2 bg-slate-950/60 rounded-lg border border-slate-800 text-[11px] text-slate-400 mt-2">
                🔒 <em>La estructura de tablas, credenciales de inicio de sesión y usuarios administradores NO serán eliminados.</em>
              </div>
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-xs text-red-300 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Confirmation Input */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-300">
                Para autorizar esta operación, escribe exactamente{' '}
                <span className="text-red-400 font-mono font-black bg-red-950/60 px-2 py-0.5 rounded border border-red-800">
                  RESET TOTAL
                </span>
                :
              </label>
              <input
                type="text"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                placeholder="Escribe RESET TOTAL"
                autoComplete="off"
                disabled={isProcessing}
                className="w-full bg-slate-950 border-2 border-red-700/60 focus:border-red-500 rounded-xl px-4 py-2.5 text-sm font-mono text-red-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2.5 px-4 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={!isConfirmed || isProcessing}
                className="bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-black py-2.5 px-6 rounded-xl text-xs flex items-center space-x-2 shadow-lg shadow-red-950/50 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Ejecutando Reset Total...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>EJECUTAR RESET TOTAL</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
