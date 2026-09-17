import React, { useState } from 'react';
import {
  AlertTriangle,
  Database,
  FileSpreadsheet,
  CheckCircle2,
  X,
  Search,
  UserCheck,
  Phone,
  MapPin,
  CreditCard,
  ArrowRight,
  ShieldAlert,
  HelpCircle,
} from 'lucide-react';
import { DiscrepanciaEncargadoItem, ResolucionDiscrepanciasModo } from '../types';

interface DiscrepanciasEncargadoModalProps {
  isOpen: boolean;
  discrepancias: DiscrepanciaEncargadoItem[];
  contexto: 'cuentas' | 'relacion_pagos';
  periodo?: string;
  isProcessing?: boolean;
  onResolver: (modo: ResolucionDiscrepanciasModo) => void;
  onClose: () => void;
}

export const DiscrepanciasEncargadoModal: React.FC<DiscrepanciasEncargadoModalProps> = ({
  isOpen,
  discrepancias,
  contexto,
  periodo,
  isProcessing = false,
  onResolver,
  onClose,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [campoFiltro, setCampoFiltro] = useState<string>('todos');

  if (!isOpen || !discrepancias || discrepancias.length === 0) return null;

  const filteredDiscrepancias = discrepancias.filter((item) => {
    const matchesSearch =
      searchTerm === '' ||
      item.municipio.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.valorBD.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.valorArchivo.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCampo = campoFiltro === 'todos' || item.campo === campoFiltro;
    return matchesSearch && matchesCampo;
  });

  const getFieldIcon = (campo: string) => {
    switch (campo) {
      case 'nombre':
        return <UserCheck className="w-3.5 h-3.5 text-blue-400" />;
      case 'cedula':
        return <CreditCard className="w-3.5 h-3.5 text-amber-400" />;
      case 'celular':
        return <Phone className="w-3.5 h-3.5 text-emerald-400" />;
      case 'direccion':
        return <MapPin className="w-3.5 h-3.5 text-purple-400" />;
      default:
        return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
    }
  };

  // Group discrepancies by municipality for scannable overview
  const municipiosAfectados = Array.from(new Set(discrepancias.map((d) => d.municipio)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn"
      id="modal-discrepancias-encargado"
    >
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-slate-900 border border-amber-500/50 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-amber-950/40">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400">
              <ShieldAlert className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-black text-amber-300 tracking-tight flex items-center gap-2">
                <span>Alerta de Validación: Datos del Encargado</span>
                <span className="px-2 py-0.5 text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full">
                  {discrepancias.length} {discrepancias.length === 1 ? 'diferencia' : 'diferencias'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Se detectaron diferencias exclusivamente en{' '}
                <strong className="text-slate-300 font-semibold">Nombre, Cédula, Celular o Dirección</strong> para{' '}
                <strong className="text-amber-300">{municipiosAfectados.length} expendios</strong>
                {periodo ? ` en ${periodo}` : ''}.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            title="Cerrar y cancelar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Decision Banner */}
        <div className="p-5 bg-slate-950/60 border-b border-slate-800 space-y-3">
          <div className="flex items-center space-x-2 text-xs font-bold text-slate-300">
            <HelpCircle className="w-4 h-4 text-amber-400" />
            <span>Selecciona cómo deseas aplicar la actualización para continuar:</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Opción 1 */}
            <button
              type="button"
              onClick={() => onResolver('actualizar_bd')}
              disabled={isProcessing}
              className="group relative p-4 rounded-xl border-2 border-emerald-500/40 hover:border-emerald-400 bg-emerald-950/30 hover:bg-emerald-950/60 text-left transition-all duration-150 cursor-pointer shadow-lg hover:shadow-emerald-950/50 disabled:opacity-50"
              id="btn-opcion-1-actualizar-bd"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 group-hover:scale-105 transition-transform">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold tracking-wider uppercase text-emerald-400">
                      Opción 1 (Recomendada si hubo cambios)
                    </span>
                    <h3 className="text-sm font-black text-emerald-200 group-hover:text-emerald-100">
                      Actualizar Base de Datos de Expendios
                    </h3>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-xs text-slate-300 mt-2.5 leading-relaxed">
                Actualiza los datos de la base de datos de expendios de acuerdo a los valores cargados en el archivo de pagos.
              </p>
            </button>

            {/* Opción 2 */}
            <button
              type="button"
              onClick={() => onResolver('actualizar_archivo')}
              disabled={isProcessing}
              className="group relative p-4 rounded-xl border-2 border-sky-500/40 hover:border-sky-400 bg-sky-950/30 hover:bg-sky-950/60 text-left transition-all duration-150 cursor-pointer shadow-lg hover:shadow-sky-950/50 disabled:opacity-50"
              id="btn-opcion-2-actualizar-archivo"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 rounded-lg bg-sky-500/20 text-sky-300 border border-sky-500/30 group-hover:scale-105 transition-transform">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold tracking-wider uppercase text-sky-400">
                      Opción 2 (Mantener base maestra)
                    </span>
                    <h3 className="text-sm font-black text-sky-200 group-hover:text-sky-100">
                      Actualizar Cuentas / Archivo desde BD
                    </h3>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-xs text-slate-300 mt-2.5 leading-relaxed">
                Actualiza el archivo de pagos de acuerdo con la base de datos de expendios registrada (conserva la base maestra intacta).
              </p>
            </button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="px-6 py-3 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por municipio, valor BD o valor archivo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
            />
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-medium">Filtrar campo:</span>
            <select
              value={campoFiltro}
              onChange={(e) => setCampoFiltro(e.target.value)}
              className="bg-slate-950 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500/60 cursor-pointer"
            >
              <option value="todos">Todos los campos ({discrepancias.length})</option>
              <option value="nombre">Solo Nombre</option>
              <option value="cedula">Solo Cédula</option>
              <option value="celular">Solo Celular</option>
              <option value="direccion">Solo Dirección</option>
            </select>
          </div>
        </div>

        {/* Discrepancies Table / Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3 max-h-[44vh]">
          {filteredDiscrepancias.length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800">
              <p className="text-xs">No se encontraron diferencias con el criterio de búsqueda aplicado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
                    <th className="py-2.5 px-3.5 w-10 text-center">#</th>
                    <th className="py-2.5 px-3.5 min-w-[140px]">Municipio</th>
                    <th className="py-2.5 px-3 min-w-[130px]">Campo</th>
                    <th className="py-2.5 px-3.5 min-w-[200px] bg-slate-900/60 text-sky-300">
                      Valor en Base de Datos
                    </th>
                    <th className="py-2.5 px-3.5 min-w-[200px] bg-slate-900/60 text-amber-300">
                      Valor en Archivo Cargado
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredDiscrepancias.map((disc, idx) => (
                    <tr
                      key={disc.id || `${disc.municipio}-${disc.campo}-${idx}`}
                      className="hover:bg-slate-800/40 transition-colors font-mono"
                    >
                      <td className="py-2.5 px-3 text-center text-slate-500 text-[11px] font-sans">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-3.5 font-bold text-slate-200 font-sans">
                        {disc.municipio}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[11px] font-sans font-medium">
                          {getFieldIcon(disc.campo)}
                          <span>{disc.campoEtiqueta}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5 text-sky-200/90 bg-sky-950/10 font-medium">
                        {disc.valorBD || <span className="text-slate-500 italic font-sans">(Vacío)</span>}
                      </td>
                      <td className="py-2.5 px-3.5 text-amber-200/95 bg-amber-950/10 font-bold">
                        {disc.valorArchivo || (
                          <span className="text-slate-500 italic font-sans">(Vacío)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-800 bg-slate-950/80 text-xs">
          <span className="text-slate-400">
            {isProcessing ? (
              <span className="flex items-center space-x-2 text-amber-400 font-semibold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span>Aplicando actualización seleccionada...</span>
              </span>
            ) : (
              <span>
                Mostrando <strong>{filteredDiscrepancias.length}</strong> de <strong>{discrepancias.length}</strong> diferencias detectadas
              </span>
            )}
          </span>

          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-1.5 px-4 rounded-xl border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar Cargue
          </button>
        </div>
      </div>
    </div>
  );
};
