import React, { useState, useEffect } from 'react';
import { ExpendioData, ThemeMode } from '../types';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet,
  Download,
  Search,
  Building2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Eye,
  Sun,
  Moon
} from 'lucide-react';
import { PhotoLightboxModal } from './PhotoLightboxModal';

interface ClientePanelProps {
  theme?: ThemeMode;
  onToggleTheme?: () => void;
}

export const ClientePanel: React.FC<ClientePanelProps> = ({ theme = 'light', onToggleTheme }) => {
  const [expendios, setExpendios] = useState<ExpendioData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedPhotoModal, setSelectedPhotoModal] = useState<{
    title: string;
    subtitle?: string;
    url: string;
    metadata?: {
      encargado?: string;
      cedula?: string;
      municipio?: string;
      direccion?: string;
      telefono?: string;
    };
  } | null>(null);

  const isLight = theme === 'light';

  const fetchExpendios = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/expendios');
      const data = await res.json();
      if (data.success) {
        setExpendios(data.data);
      }
    } catch (err) {
      console.error('Error cargando data cliente 4-72:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpendios();
  }, []);

  // Filter list by search term
  const filteredExpendios = expendios.filter((e) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (e.centroOperativo || '').toLowerCase().includes(term) ||
      (e.centroAcopio || '').toLowerCase().includes(term) ||
      (e.localidad || '').toLowerCase().includes(term) ||
      (e.encargado || '').toLowerCase().includes(term) ||
      (e.cedula || '').includes(term) ||
      (e.direccionPunto || '').toLowerCase().includes(term) ||
      (e.municipio || '').toLowerCase().includes(term)
    );
  });

  // Client-side or Server-side Excel Download trigger
  const handleExportExcel = () => {
    window.open('/api/cliente/export-excel', '_blank');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner */}
      <div className={`border rounded-2xl p-6 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-colors ${
        isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-800 text-slate-100 shadow-xl'
      }`}>
        <div>
          <div className="flex items-center space-x-2 text-sky-600 dark:text-sky-400 font-semibold text-xs tracking-wider uppercase mb-1">
            <Building2 className="w-4 h-4" />
            <span>CLIENTE OFICIAL 4-72 | NIT 900062917</span>
          </div>
          <h2 className={`text-2xl font-black tracking-tight ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
            Consolidado Nacional de Expendios 4-72
          </h2>
          <p className={`text-sm mt-1 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
            Vista oficial con las 16 columnas reglamentarias de puntos de atención y exportación directa a Excel.
          </p>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3 flex-wrap">
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              className={`text-xs font-bold py-2.5 px-3 rounded-xl border flex items-center space-x-1.5 cursor-pointer transition-colors shadow-sm ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
              }`}
            >
              {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
              <span>{isLight ? 'Tema Negro' : 'Tema Blanco'}</span>
            </button>
          )}

          <button
            onClick={fetchExpendios}
            className={`text-xs font-semibold py-2.5 px-3.5 rounded-xl border flex items-center space-x-2 cursor-pointer transition-colors ${
              isLight
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>

          <button
            onClick={handleExportExcel}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-2.5 px-4 rounded-xl text-xs flex items-center space-x-2 shadow-md cursor-pointer transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Descargar Excel (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* Search & Statistics Bar */}
      <div className={`border rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors ${
        isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800 shadow-xl'
      }`}>
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por Localidad, Encargado o Cédula..."
            className={`w-full border rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 ${
              isLight
                ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400'
                : 'bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-500'
            }`}
          />
        </div>

        <div className={`flex items-center space-x-4 text-xs ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
          <div>
            Total Registros: <strong className={`font-mono font-bold ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>{filteredExpendios.length}</strong>
          </div>
          <div className={`h-4 w-px ${isLight ? 'bg-slate-300' : 'bg-slate-800'}`} />
          <div className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
            <span className="font-semibold">Base de Datos Actualizada</span>
          </div>
        </div>
      </div>

      {/* STRICT 16-COLUMN TABLE */}
      <div className={`border rounded-2xl shadow-sm overflow-hidden transition-colors ${
        isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800 shadow-xl'
      }`}>
        <div className={`p-4 border-b flex items-center justify-between ${
          isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
        }`}>
          <div className="flex items-center space-x-2 text-xs font-bold text-slate-700 dark:text-slate-300">
            <FileSpreadsheet className="w-4 h-4 text-sky-500" />
            <span>Estructura Oficial de 16 Columnas en Orden Estricto</span>
          </div>
          <span className={`text-[11px] font-mono ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>Pestaña: Expendios</span>
        </div>

        <div className="overflow-x-auto max-w-full">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className={`font-bold uppercase tracking-wider text-[10px] border-b ${
              isLight
                ? 'bg-slate-100 text-slate-700 border-slate-200'
                : 'bg-slate-950 text-slate-300 border-slate-800'
            }`}>
              <tr>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200 text-slate-500' : 'border-slate-800/80 text-slate-400'}`}>#</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>1. CENTRO OPERATIVO</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>2. CENTRO DE ACOPIO</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>3. LOCALIDAD</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>4. ENCARGADO</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>5. CEDULA</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>6. DIRECCION PUNTO</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>7. TELEFONO PUNTO</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>8. LETRERO</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>9. BASCULA</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>10. MATASELLO</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>11. USUARIO DE SIPOST</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>12. COMPUTADOR</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>13. INTERNET</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>14. NIT</th>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>15. Correo Electronico</th>
                <th className="py-3 px-3.5">16. OBSERVACION</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isLight ? 'divide-slate-200 text-slate-800' : 'divide-slate-800 text-slate-200'}`}>
              {filteredExpendios.length > 0 ? (
                filteredExpendios.map((exp, idx) => (
                  <tr
                    key={exp.id}
                    className={`transition-colors ${isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/60'}`}
                  >
                    <td className={`py-3 px-3.5 font-mono border-r text-[10px] ${isLight ? 'border-slate-200 text-slate-500' : 'border-slate-800/80 text-slate-500'}`}>
                      {idx + 1}
                    </td>
                    <td className={`py-3 px-3.5 font-medium border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>{exp.centroOperativo}</td>
                    <td className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200 text-slate-600' : 'border-slate-800/80 text-slate-300'}`}>{exp.centroAcopio}</td>
                    <td className={`py-3 px-3.5 font-bold border-r ${isLight ? 'border-slate-200 text-sky-700' : 'border-slate-800/80 text-sky-300'}`}>{exp.localidad}</td>
                    <td className={`py-3 px-3.5 font-semibold border-r ${isLight ? 'border-slate-200 text-slate-900' : 'border-slate-800/80 text-slate-100'}`}>{exp.encargado}</td>
                    <td className={`py-3 px-3.5 font-mono font-bold border-r ${isLight ? 'border-slate-200 text-amber-700' : 'border-slate-800/80 text-amber-300'}`}>{exp.cedula}</td>
                    <td className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200 text-slate-600' : 'border-slate-800/80 text-slate-300'}`}>{exp.direccionPunto}</td>
                    <td className={`py-3 px-3.5 font-mono border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>{exp.telefonoPunto}</td>

                    {/* Letrero */}
                    <td className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                      {exp.letreroUrl ? (
                        <button
                          onClick={() => setSelectedPhotoModal({
                            title: `Letrero Oficial - ${exp.localidad}`,
                            subtitle: `Municipio: ${exp.municipio} | Operador Postal 4-72`,
                            url: exp.letreroUrl!,
                            metadata: {
                              encargado: exp.encargado,
                              cedula: exp.cedula,
                              municipio: exp.municipio,
                              direccion: exp.direccionPunto,
                              telefono: exp.telefonoPunto,
                            }
                          })}
                          className={`inline-flex items-center space-x-1 text-[11px] font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                            isLight
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300'
                              : 'bg-emerald-950/80 text-emerald-300 hover:bg-emerald-900 border border-emerald-800'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>CARGADO</span>
                        </button>
                      ) : (
                        <span className={`inline-flex items-center space-x-1 text-[11px] px-2 py-0.5 rounded ${
                          isLight
                            ? 'bg-slate-100 text-slate-400 border border-slate-200'
                            : 'bg-slate-950 text-slate-500 border border-slate-800'
                        }`}>
                          <XCircle className="w-3 h-3 text-slate-400" />
                          <span>PENDIENTE</span>
                        </span>
                      )}
                    </td>

                    {/* Báscula */}
                    <td className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                      {exp.basculaUrl ? (
                        <button
                          onClick={() => setSelectedPhotoModal({
                            title: `Báscula Calibrada - ${exp.localidad}`,
                            subtitle: `Municipio: ${exp.municipio} | Operador Postal 4-72`,
                            url: exp.basculaUrl!,
                            metadata: {
                              encargado: exp.encargado,
                              cedula: exp.cedula,
                              municipio: exp.municipio,
                              direccion: exp.direccionPunto,
                              telefono: exp.telefonoPunto,
                            }
                          })}
                          className={`inline-flex items-center space-x-1 text-[11px] font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                            isLight
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300'
                              : 'bg-emerald-950/80 text-emerald-300 hover:bg-emerald-900 border border-emerald-800'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>CARGADO</span>
                        </button>
                      ) : (
                        <span className={`inline-flex items-center space-x-1 text-[11px] px-2 py-0.5 rounded ${
                          isLight
                            ? 'bg-slate-100 text-slate-400 border border-slate-200'
                            : 'bg-slate-950 text-slate-500 border border-slate-800'
                        }`}>
                          <XCircle className="w-3 h-3 text-slate-400" />
                          <span>PENDIENTE</span>
                        </span>
                      )}
                    </td>

                    {/* Matasello */}
                    <td className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                      {exp.mataselloUrl ? (
                        <button
                          onClick={() => setSelectedPhotoModal({
                            title: `Matasello Postal - ${exp.localidad}`,
                            subtitle: `Municipio: ${exp.municipio} | Operador Postal 4-72`,
                            url: exp.mataselloUrl!,
                            metadata: {
                              encargado: exp.encargado,
                              cedula: exp.cedula,
                              municipio: exp.municipio,
                              direccion: exp.direccionPunto,
                              telefono: exp.telefonoPunto,
                            }
                          })}
                          className={`inline-flex items-center space-x-1 text-[11px] font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                            isLight
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300'
                              : 'bg-emerald-950/80 text-emerald-300 hover:bg-emerald-900 border border-emerald-800'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>CARGADO</span>
                        </button>
                      ) : (
                        <span className={`inline-flex items-center space-x-1 text-[11px] px-2 py-0.5 rounded ${
                          isLight
                            ? 'bg-slate-100 text-slate-400 border border-slate-200'
                            : 'bg-slate-950 text-slate-500 border border-slate-800'
                        }`}>
                          <XCircle className="w-3 h-3 text-slate-400" />
                          <span>PENDIENTE</span>
                        </span>
                      )}
                    </td>

                    <td className={`py-3 px-3.5 font-mono border-r ${isLight ? 'border-slate-200 text-slate-700' : 'border-slate-800/80 text-slate-300'}`}>{exp.usuarioSipost}</td>

                    {/* Computador */}
                    <td className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                      {exp.computadorUrl ? (
                        <button
                          onClick={() => setSelectedPhotoModal({
                            title: `Computador / Equipamiento - ${exp.localidad}`,
                            subtitle: `Municipio: ${exp.municipio} | Operador Postal 4-72`,
                            url: exp.computadorUrl!,
                            metadata: {
                              encargado: exp.encargado,
                              cedula: exp.cedula,
                              municipio: exp.municipio,
                              direccion: exp.direccionPunto,
                              telefono: exp.telefonoPunto,
                            }
                          })}
                          className={`inline-flex items-center space-x-1 text-[11px] font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                            isLight
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300'
                              : 'bg-emerald-950/80 text-emerald-300 hover:bg-emerald-900 border border-emerald-800'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>CARGADO</span>
                        </button>
                      ) : (
                        <span className={`inline-flex items-center space-x-1 text-[11px] px-2 py-0.5 rounded ${
                          isLight
                            ? 'bg-slate-100 text-slate-400 border border-slate-200'
                            : 'bg-slate-950 text-slate-500 border border-slate-800'
                        }`}>
                          <XCircle className="w-3 h-3 text-slate-400" />
                          <span>PENDIENTE</span>
                        </span>
                      )}
                    </td>

                    <td className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200 text-slate-600' : 'border-slate-800/80 text-slate-300'}`}>{exp.internet}</td>
                    <td className={`py-3 px-3.5 font-mono border-r ${isLight ? 'border-slate-200 text-slate-700' : 'border-slate-800/80 text-slate-200'}`}>{exp.nit}</td>
                    <td className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200 text-slate-600' : 'border-slate-800/80 text-slate-300'}`}>{exp.correoElectronico}</td>
                    <td className={`py-3 px-3.5 text-[11px] max-w-xs truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{exp.observacion}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={17} className={`py-12 text-center ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                    No se encontraron registros de expendios que coincidan con la búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lightbox Modal for Photo Inspection in Cliente */}
      {selectedPhotoModal && (
        <PhotoLightboxModal
          isOpen={!!selectedPhotoModal}
          onClose={() => setSelectedPhotoModal(null)}
          imageUrl={selectedPhotoModal.url}
          title={selectedPhotoModal.title}
          subtitle={selectedPhotoModal.subtitle}
          metadata={selectedPhotoModal.metadata}
        />
      )}
    </div>
  );
};
