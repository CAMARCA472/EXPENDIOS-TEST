import React, { useState, useEffect } from 'react';
import { SystemConfig } from '../types';
import { Calendar, ShieldCheck, Lock, Unlock, CheckCircle2, AlertCircle, Save, Clock } from 'lucide-react';

const MESES = [
  { value: 'ENERO', num: '01', label: 'Enero' },
  { value: 'FEBRERO', num: '02', label: 'Febrero' },
  { value: 'MARZO', num: '03', label: 'Marzo' },
  { value: 'ABRIL', num: '04', label: 'Abril' },
  { value: 'MAYO', num: '05', label: 'Mayo' },
  { value: 'JUNIO', num: '06', label: 'Junio' },
  { value: 'JULIO', num: '07', label: 'Julio' },
  { value: 'AGOSTO', num: '08', label: 'Agosto' },
  { value: 'SEPTIEMBRE', num: '09', label: 'Septiembre' },
  { value: 'OCTUBRE', num: '10', label: 'Octubre' },
  { value: 'NOVIEMBRE', num: '11', label: 'Noviembre' },
  { value: 'DICIEMBRE', num: '12', label: 'Diciembre' },
];

const ANIOS = [
  '2024', '2025', '2026', '2027', '2028', '2029', '2030',
  '2031', '2032', '2033', '2034', '2035', '2036', '2037', '2038', '2039', '2040'
];

interface PeriodoDescargaConfigCardProps {
  onConfigUpdated?: (config: SystemConfig) => void;
}

export const PeriodoDescargaConfigCard: React.FC<PeriodoDescargaConfigCardProps> = ({ onConfigUpdated }) => {
  const [config, setConfig] = useState<SystemConfig>({
    periodoHabilitadoDescarga: 'FEBRERO 2026',
    descargaHabilitada: true,
  });

  const [mes, setMes] = useState<string>('FEBRERO');
  const [anio, setAnio] = useState<string>('2026');
  const [descargaHabilitada, setDescargaHabilitada] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Load config on mount
  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/config?_t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success && data.data) {
        setConfig(data.data);
        setDescargaHabilitada(data.data.descargaHabilitada ?? true);

        const parts = (data.data.periodoHabilitadoDescarga || 'FEBRERO 2026').split(' ');
        if (parts.length >= 2) {
          setMes(parts[0].toUpperCase());
          setAnio(parts[1]);
        }
      }
    } catch (err) {
      console.error('Error cargando configuración:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    setStatusMsg(null);

    const nuevoPeriodo = `${mes} ${anio}`.toUpperCase();

    try {
      const res = await fetch('/api/admin/config/periodo-descarga', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodoHabilitadoDescarga: nuevoPeriodo,
          descargaHabilitada,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setConfig(data.data);
        setStatusMsg({
          text: `✓ Periodo "${nuevoPeriodo}" guardado. Descarga para expendios: ${
            descargaHabilitada ? 'HABILITADA' : 'BLOQUEADA'
          }.`,
          type: 'success',
        });
        window.dispatchEvent(new CustomEvent('configUpdated', { detail: data.data }));
        if (onConfigUpdated) onConfigUpdated(data.data);
        setTimeout(() => setStatusMsg(null), 6000);
      } else {
        setStatusMsg({ text: data.message || 'Error al guardar configuración', type: 'error' });
      }
    } catch (err) {
      console.error('Error guardando config:', err);
      setStatusMsg({ text: 'Error de conexión con el servidor', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
              <span>Control de Periodo Habilitado de Descarga</span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold border ${
                  config.descargaHabilitada
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                    : 'bg-rose-950 text-rose-300 border-rose-700'
                }`}
              >
                {config.descargaHabilitada ? 'DESCARGA ACTIVA' : 'DESCARGA INACTIVA'}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Habilita el mes en el cual los expendios tienen autorización de <strong>descargar e imprimir</strong> sus cuentas de cobro oficiales.
            </p>
          </div>
        </div>

        <div className="bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs text-right">
          <div className="text-slate-400 text-[10px]">Periodo Activo Actual:</div>
          <div className="font-mono font-bold text-amber-400 text-sm">{config.periodoHabilitadoDescarga}</div>
        </div>
      </div>

      <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Selector de Mes */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center space-x-1.5">
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>Mes Autorizado:</span>
          </label>
          <select
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
          >
            {MESES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label} ({m.value})
              </option>
            ))}
          </select>
        </div>

        {/* Selector de Año */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Año:</label>
          <select
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
          >
            {ANIOS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {/* Switch Estado de Descarga */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Estado de la Descarga:</label>
          <button
            type="button"
            onClick={() => setDescargaHabilitada(!descargaHabilitada)}
            className={`w-full py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center space-x-2 transition-colors cursor-pointer ${
              descargaHabilitada
                ? 'bg-emerald-950/60 border-emerald-600 text-emerald-300 hover:bg-emerald-900/60'
                : 'bg-rose-950/60 border-rose-600 text-rose-300 hover:bg-rose-900/60'
            }`}
          >
            {descargaHabilitada ? (
              <>
                <Unlock className="w-4 h-4 text-emerald-400" />
                <span>Habilitada para Expendios</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4 text-rose-400" />
                <span>Bloqueada (Solo Visualización)</span>
              </>
            )}
          </button>
        </div>

        <div className="sm:col-span-3 flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="text-xs text-slate-400 flex items-center space-x-2">
            <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>
              Los expendios pueden <strong>visualizar cualquier mes histórico</strong>, pero solo podrán <strong>descargar en PDF</strong> el periodo habilitado ({mes} {anio}).
            </span>
          </div>

          <button
            type="submit"
            disabled={saving || loading}
            className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-6 rounded-xl shadow-lg text-xs flex items-center justify-center space-x-2 cursor-pointer transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Guardando...' : 'Guardar Periodo Habilitado'}</span>
          </button>
        </div>
      </form>

      {statusMsg && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center space-x-2 animate-fadeIn ${
            statusMsg.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
              : 'bg-rose-950/80 border-rose-600 text-rose-300'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}
    </div>
  );
};
