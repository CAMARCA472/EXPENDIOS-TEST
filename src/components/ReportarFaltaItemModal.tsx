import React, { useState } from 'react';
import { AlertCircle, HelpCircle, X, Check, Wrench, ShieldAlert, PackageX, Settings } from 'lucide-react';
import { ExpendioData } from '../types';

interface ReportarFaltaItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  slotKey: string;
  slotTitle: string;
  expendio: ExpendioData;
  onConfirm: (slotKey: string, motivo: string) => Promise<void> | void;
  isLight?: boolean;
}

const MOTIVOS_PREDEFINIDOS = [
  { id: 'dañado', label: 'Dañado / Averiado', icon: Wrench },
  { id: 'no_entregado', label: 'Nunca entregado al punto', icon: PackageX },
  { id: 'hurtado', label: 'Hurtado / Extraviado', icon: ShieldAlert },
  { id: 'mantenimiento', label: 'En calibración o mantenimiento', icon: Settings },
  { id: 'otro', label: 'Otro motivo', icon: HelpCircle },
];

export const ReportarFaltaItemModal: React.FC<ReportarFaltaItemModalProps> = ({
  isOpen,
  onClose,
  slotKey,
  slotTitle,
  expendio,
  onConfirm,
  isLight = true,
}) => {
  const [motivoSeleccionado, setMotivoSeleccionado] = useState<string>('Dañado / Averiado');
  const [motivoDetalle, setMotivoDetalle] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const finalMotivo = motivoDetalle.trim()
        ? `${motivoSeleccionado}: ${motivoDetalle.trim()}`
        : motivoSeleccionado;
      await onConfirm(slotKey, finalMotivo);
      onClose();
    } catch (err) {
      console.error('Error guardando reporte de falta:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`w-full max-w-lg rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[92vh] ${
          isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between ${
            isLight ? 'bg-amber-500/10 border-slate-200' : 'bg-slate-950 border-slate-800'
          }`}
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black uppercase tracking-tight text-amber-600 dark:text-amber-400">
                ¿Qué pasó con este implemento?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {slotTitle} · {expendio.localidad || expendio.municipio}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          <div
            className={`p-3.5 rounded-xl border text-xs leading-relaxed ${
              isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-slate-950/60 border-slate-800 text-slate-300'
            }`}
          >
            <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">
              ℹ️ Estado actual en Base de Datos: <span className="text-emerald-600 dark:text-emerald-400 font-bold">DISPONIBLE (SI)</span>
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Si tu expendio no cuenta actualmente con este elemento, indícanos qué ocurrió para actualizar el registro a <span className="font-bold text-amber-600 dark:text-amber-400">NO DISPONIBLE (NO)</span>. Si más adelante lo recibes, con solo adjuntar su foto el sistema lo cambiará de nuevo a <span className="font-bold text-emerald-600 dark:text-emerald-400">SI</span>.
            </p>
          </div>

          {/* Selector de Motivo */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Selecciona el motivo principal:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MOTIVOS_PREDEFINIDOS.map((motivo) => {
                const Icon = motivo.icon;
                const isSelected = motivoSeleccionado === motivo.label;
                return (
                  <button
                    key={motivo.id}
                    type="button"
                    onClick={() => setMotivoSeleccionado(motivo.label)}
                    className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center space-x-2.5 transition-all text-left cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-sm font-bold'
                        : isLight
                        ? 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                        : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-slate-950' : 'text-amber-500'}`} />
                    <span className="truncate">{motivo.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Casilla de Explicación Detallada */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              ¿Qué pasó con este implemento? (Detalle o justificación):
            </label>
            <textarea
              value={motivoDetalle}
              onChange={(e) => setMotivoDetalle(e.target.value)}
              placeholder="Ej: La báscula se descalibró el mes pasado y está en revisión técnica / El aviso fue retirado por reparaciones en fachada..."
              rows={3}
              className={`w-full text-xs rounded-xl p-3 border transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
                  : 'bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-500'
              }`}
            />
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              Esta información quedará guardada en las observaciones del expendio para soporte ante el supervisor de 4-72.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`px-5 py-3.5 border-t flex flex-col-reverse sm:flex-row items-center justify-end gap-2 ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={`w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              isLight
                ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
          >
            Cancelar (Conserva SI)
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-black bg-amber-500 hover:bg-amber-400 active:scale-98 text-slate-950 flex items-center justify-center space-x-1.5 shadow-md cursor-pointer transition-all disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            <span>{submitting ? 'Actualizando BD...' : 'Confirmar: No lo tengo (Marcar NO)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
