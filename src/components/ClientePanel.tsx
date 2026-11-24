import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ExpendioData, ThemeMode, UserSession } from '../types';
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
  Moon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  X,
  RotateCcw,
  Loader2
} from 'lucide-react';
import { PhotoLightboxModal } from './PhotoLightboxModal';
import { normalizeCentroAcopio, normalizeCentroOperativo } from '../utils/centroOperativoAcopioHelper';
import { downloadAuthenticatedFile } from '../utils/downloadHelper';

interface ClientePanelProps {
  session?: UserSession | null;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
}

type SortField =
  | 'centroOperativo'
  | 'centroAcopio'
  | 'localidad'
  | 'encargado'
  | 'cedula'
  | 'direccionPunto'
  | 'telefonoPunto'
  | 'letrero'
  | 'bascula'
  | 'matasello'
  | 'usuarioSipost'
  | 'computador'
  | 'internet'
  | 'nit'
  | 'correoElectronico'
  | 'observacion'
  | 'fechaUltimaActualizacion'
  | null;
type SortDirection = 'asc' | 'desc' | null;

export const ClientePanel: React.FC<ClientePanelProps> = ({ session, theme = 'light', onToggleTheme }) => {
  const [expendios, setExpendios] = useState<ExpendioData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  // Excel-like Sorting & Filtering state
  const [sortField, setSortField] = useState<SortField>('encargado');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [filterCentroOperativo, setFilterCentroOperativo] = useState<string>('TODOS');
  const [filterCentroAcopio, setFilterCentroAcopio] = useState<string>('TODOS');
  const [filterLocalidad, setFilterLocalidad] = useState<string>('TODOS');
  const [openFilterDropdown, setOpenFilterDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenFilterDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchExpendios = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cliente/expendios');
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setExpendios(data.data);
      } else if (data.success && data.expendio) {
        setExpendios([data.expendio]);
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

  // Extract unique filter lists
  const uniqueCentrosOperativos = useMemo(() => {
    const set = new Set<string>();
    expendios.forEach((e) => {
      if (e.centroOperativo && e.centroOperativo.trim()) {
        set.add(e.centroOperativo.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [expendios]);

  const uniqueCentrosAcopio = useMemo(() => {
    const set = new Set<string>();
    expendios.forEach((e) => {
      if (e.centroAcopio && e.centroAcopio.trim()) {
        set.add(e.centroAcopio.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [expendios]);

  const uniqueLocalidades = useMemo(() => {
    const set = new Set<string>();
    expendios.forEach((e) => {
      if (e.localidad && e.localidad.trim()) {
        set.add(e.localidad.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [expendios]);

  // Handle header sort toggle (Excel-like: toggle ASC <-> DESC)
  const handleSort = (field: SortField) => {
    if (!field) return;
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const resetAllFilters = () => {
    setSearchTerm('');
    setFilterCentroOperativo('TODOS');
    setFilterCentroAcopio('TODOS');
    setFilterLocalidad('TODOS');
    setSortField('encargado');
    setSortDirection('asc');
    setOpenFilterDropdown(null);
    setCurrentPage(1);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterCentroOperativo, filterCentroAcopio, filterLocalidad, sortField, sortDirection]);

  // Filter & Sort list
  const filteredAndSortedExpendios = useMemo(() => {
    let list = expendios.filter((e) => {
      // Search term filter
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesSearch =
          (e.centroOperativo || '').toLowerCase().includes(term) ||
          (e.centroAcopio || '').toLowerCase().includes(term) ||
          (e.localidad || '').toLowerCase().includes(term) ||
          (e.encargado || '').toLowerCase().includes(term) ||
          (e.cedula || '').includes(term) ||
          (e.direccionPunto || '').toLowerCase().includes(term) ||
          (e.telefonoPunto || '').includes(term) ||
          (e.municipio || '').toLowerCase().includes(term) ||
          (e.usuarioSipost || '').toLowerCase().includes(term) ||
          (e.nit || '').includes(term) ||
          (e.correoElectronico || '').toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }

      // Column filters
      if (filterCentroOperativo !== 'TODOS' && (e.centroOperativo || '').trim() !== filterCentroOperativo) {
        return false;
      }
      if (filterCentroAcopio !== 'TODOS' && (e.centroAcopio || '').trim() !== filterCentroAcopio) {
        return false;
      }
      if (filterLocalidad !== 'TODOS' && (e.localidad || '').trim() !== filterLocalidad) {
        return false;
      }

      return true;
    });

    // Excel-like Sorting
    if (sortField && sortDirection) {
      const dir = sortDirection;
      list = [...list].sort((a, b) => {
        let valA: any = '';
        let valB: any = '';

        switch (sortField) {
          case 'centroOperativo':
            valA = a.centroOperativo || normalizeCentroOperativo(a.centroOperativo, a.localidad) || '';
            valB = b.centroOperativo || normalizeCentroOperativo(b.centroOperativo, b.localidad) || '';
            break;
          case 'centroAcopio':
            valA = a.centroAcopio || normalizeCentroAcopio(a.centroAcopio, a.localidad) || '';
            valB = b.centroAcopio || normalizeCentroAcopio(b.centroAcopio, b.localidad) || '';
            break;
          case 'localidad':
            valA = a.localidad || '';
            valB = b.localidad || '';
            break;
          case 'encargado':
            valA = a.encargado || '';
            valB = b.encargado || '';
            break;
          case 'cedula':
            valA = a.cedula || '';
            valB = b.cedula || '';
            break;
          case 'direccionPunto':
            valA = a.direccionPunto || '';
            valB = b.direccionPunto || '';
            break;
          case 'telefonoPunto':
            valA = a.telefonoPunto || '';
            valB = b.telefonoPunto || '';
            break;
          case 'letrero':
            valA = (a.letreroUrl || a.fotoAvisoUrl) ? 'CARGADO' : 'PENDIENTE';
            valB = (b.letreroUrl || b.fotoAvisoUrl) ? 'CARGADO' : 'PENDIENTE';
            break;
          case 'bascula':
            valA = (a.basculaUrl || a.fotoBasculaUrl) ? 'CARGADO' : 'PENDIENTE';
            valB = (b.basculaUrl || b.fotoBasculaUrl) ? 'CARGADO' : 'PENDIENTE';
            break;
          case 'matasello':
            valA = (a.mataselloUrl || a.fotoMataselloUrl) ? 'CARGADO' : 'PENDIENTE';
            valB = (b.mataselloUrl || b.fotoMataselloUrl) ? 'CARGADO' : 'PENDIENTE';
            break;
          case 'usuarioSipost':
            valA = a.usuarioSipost || '';
            valB = b.usuarioSipost || '';
            break;
          case 'computador':
            valA = a.tieneComputador || (a.computadorUrl ? 'SI' : 'NO');
            valB = b.tieneComputador || (b.computadorUrl ? 'SI' : 'NO');
            break;
          case 'internet':
            valA = a.internet || '';
            valB = b.internet || '';
            break;
          case 'nit':
            valA = a.nit || '';
            valB = b.nit || '';
            break;
          case 'correoElectronico':
            valA = a.correoElectronico || '';
            valB = b.correoElectronico || '';
            break;
          case 'observacion':
            valA = a.observacion || '';
            valB = b.observacion || '';
            break;
          case 'fechaUltimaActualizacion':
            valA = a.fechaUltimaActualizacion || '';
            valB = b.fechaUltimaActualizacion || '';
            break;
          default:
            valA = (a as any)[sortField] || '';
            valB = (b as any)[sortField] || '';
            break;
        }

        // Put blank values at the bottom
        const strA = String(valA).trim();
        const strB = String(valB).trim();
        if (!strA && strB) return 1;
        if (strA && !strB) return -1;
        if (!strA && !strB) return 0;

        // Try numeric sorting if both are purely numeric (e.g. Cédula, Teléfono, NIT)
        const digitsA = strA.replace(/\D/g, '');
        const digitsB = strB.replace(/\D/g, '');
        if (digitsA && digitsB && digitsA.length === strA.length && digitsB.length === strB.length) {
          const numA = Number(digitsA);
          const numB = Number(digitsB);
          if (!isNaN(numA) && !isNaN(numB)) {
            return dir === 'asc' ? numA - numB : numB - numA;
          }
        }

        const comp = strA.localeCompare(strB, 'es', { numeric: true, sensitivity: 'base' });
        return dir === 'asc' ? comp : -comp;
      });
    }

    return list;
  }, [expendios, searchTerm, filterCentroOperativo, filterCentroAcopio, filterLocalidad, sortField, sortDirection]);

  const totalPages = useMemo(() => {
    if (pageSize <= 0) return 1;
    return Math.max(1, Math.ceil(filteredAndSortedExpendios.length / pageSize));
  }, [filteredAndSortedExpendios.length, pageSize]);

  const paginatedExpendios = useMemo(() => {
    if (pageSize <= 0) return filteredAndSortedExpendios;
    const safePage = Math.min(Math.max(1, currentPage), totalPages);
    const startIdx = (safePage - 1) * pageSize;
    return filteredAndSortedExpendios.slice(startIdx, startIdx + pageSize);
  }, [filteredAndSortedExpendios, currentPage, pageSize, totalPages]);

  const [descargandoExcel, setDescargandoExcel] = useState<boolean>(false);

  // Client-side or Server-side Excel Download trigger
  const handleExportExcel = async () => {
    await downloadAuthenticatedFile('/api/cliente/export-excel', 'Consolidado_Expendios_472.xlsx', {
      onStart: () => setDescargandoExcel(true),
      onSuccess: () => setDescargandoExcel(false),
      onError: () => setDescargandoExcel(false),
    });
  };

  const hasActiveFilters = searchTerm || filterCentroOperativo !== 'TODOS' || filterCentroAcopio !== 'TODOS' || filterLocalidad !== 'TODOS' || sortField !== 'encargado' || sortDirection !== 'asc';

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
            Consolidado Regional de Expendios 4-72
          </h2>
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
            disabled={descargandoExcel}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black py-2.5 px-4 rounded-xl text-xs flex items-center space-x-2 shadow-md cursor-pointer transition-colors"
          >
            {descargandoExcel ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{descargandoExcel ? 'Descargando...' : 'Descargar Excel (.xlsx)'}</span>
          </button>
        </div>
      </div>

      {/* Excel Filter & Control Bar */}
      <div className={`border rounded-2xl p-4 shadow-sm space-y-3 transition-colors ${
        isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800 shadow-xl'
      }`}>
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por Localidad, Encargado, Cédula o Dirección..."
              className={`w-full border rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                isLight
                  ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400'
                  : 'bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-500'
              }`}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Selectors tipo Excel */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Casilla Centro Operativo */}
            <div className="flex items-center space-x-1.5">
              <span className={`text-[11px] font-semibold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                C. Operativo:
              </span>
              <select
                value={filterCentroOperativo}
                onChange={(e) => setFilterCentroOperativo(e.target.value)}
                className={`border rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  filterCentroOperativo !== 'TODOS'
                    ? isLight
                      ? 'bg-sky-50 border-sky-300 text-sky-900 font-bold'
                      : 'bg-sky-950/80 border-sky-700 text-sky-300 font-bold'
                    : isLight
                    ? 'bg-slate-50 border-slate-300 text-slate-800'
                    : 'bg-slate-950 border-slate-700 text-slate-200'
                }`}
              >
                <option value="TODOS">Todos ({uniqueCentrosOperativos.length})</option>
                {uniqueCentrosOperativos.map((co) => (
                  <option key={co} value={co}>{co}</option>
                ))}
              </select>
            </div>

            {/* Casilla Centro de Acopio */}
            <div className="flex items-center space-x-1.5">
              <span className={`text-[11px] font-semibold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                C. Acopio:
              </span>
              <select
                value={filterCentroAcopio}
                onChange={(e) => setFilterCentroAcopio(e.target.value)}
                className={`border rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  filterCentroAcopio !== 'TODOS'
                    ? isLight
                      ? 'bg-sky-50 border-sky-300 text-sky-900 font-bold'
                      : 'bg-sky-950/80 border-sky-700 text-sky-300 font-bold'
                    : isLight
                    ? 'bg-slate-50 border-slate-300 text-slate-800'
                    : 'bg-slate-950 border-slate-700 text-slate-200'
                }`}
              >
                <option value="TODOS">Todos ({uniqueCentrosAcopio.length})</option>
                {uniqueCentrosAcopio.map((ca) => (
                  <option key={ca} value={ca}>{ca}</option>
                ))}
              </select>
            </div>

            {/* Casilla Localidad */}
            <div className="flex items-center space-x-1.5">
              <span className={`text-[11px] font-semibold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                Localidad:
              </span>
              <select
                value={filterLocalidad}
                onChange={(e) => setFilterLocalidad(e.target.value)}
                className={`border rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  filterLocalidad !== 'TODOS'
                    ? isLight
                      ? 'bg-sky-50 border-sky-300 text-sky-900 font-bold'
                      : 'bg-sky-950/80 border-sky-700 text-sky-300 font-bold'
                    : isLight
                    ? 'bg-slate-50 border-slate-300 text-slate-800'
                    : 'bg-slate-950 border-slate-700 text-slate-200'
                }`}
              >
                <option value="TODOS">Todas ({uniqueLocalidades.length})</option>
                {uniqueLocalidades.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>

            {/* Selector Rápido de Ordenamiento */}
            <div className="flex items-center space-x-1.5">
              <span className={`text-[11px] font-semibold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                Ordenar:
              </span>
              <select
                value={sortField || ''}
                onChange={(e) => setSortField((e.target.value || null) as SortField)}
                className={`border rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-800' : 'bg-slate-950 border-slate-700 text-slate-200'
                }`}
              >
                <option value="centroOperativo">1. Centro Operativo</option>
                <option value="centroAcopio">2. Centro de Acopio</option>
                <option value="localidad">3. Localidad</option>
                <option value="encargado">4. Nombre / Encargado</option>
                <option value="cedula">5. Cédula</option>
                <option value="direccionPunto">6. Dirección Punto</option>
                <option value="telefonoPunto">7. Teléfono Punto</option>
                <option value="letrero">8. Letrero</option>
                <option value="bascula">9. Báscula</option>
                <option value="matasello">10. Matasello</option>
                <option value="usuarioSipost">11. Usuario Sipost</option>
                <option value="computador">12. Computador</option>
                <option value="internet">13. Internet</option>
                <option value="nit">14. NIT</option>
                <option value="correoElectronico">15. Correo Electrónico</option>
                <option value="observacion">16. Observación</option>
                <option value="fechaUltimaActualizacion">17. Última Actualización</option>
              </select>

              <button
                type="button"
                onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                className={`p-1.5 rounded-lg border flex items-center justify-center cursor-pointer transition-colors ${
                  isLight
                    ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                }`}
                title={`Cambiar orden: ${sortDirection === 'asc' ? 'Ascendente (A-Z)' : 'Descendente (Z-A)'}`}
              >
                {sortDirection === 'asc' ? (
                  <span className="flex items-center text-[11px] font-bold text-sky-600 dark:text-sky-400">
                    A→Z <ArrowUp className="w-3 h-3 ml-0.5" />
                  </span>
                ) : (
                  <span className="flex items-center text-[11px] font-bold text-sky-600 dark:text-sky-400">
                    Z→A <ArrowDown className="w-3 h-3 ml-0.5" />
                  </span>
                )}
              </button>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className={`text-[11px] font-bold py-1.5 px-2.5 rounded-lg border flex items-center space-x-1 cursor-pointer transition-colors ${
                  isLight
                    ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-amber-950/60 hover:bg-amber-900 text-amber-300 border-amber-800'
                }`}
                title="Restablecer todos los filtros y orden"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Limpiar</span>
              </button>
            )}
          </div>
        </div>

        {/* Counter, Pagination and Status Bar */}
        <div className={`flex flex-wrap items-center justify-between text-xs pt-2 border-t gap-2 ${
          isLight ? 'border-slate-100 text-slate-600' : 'border-slate-800/80 text-slate-400'
        }`}>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              Mostrando:{' '}
              <strong className={`font-mono font-bold ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                {paginatedExpendios.length}
              </strong>{' '}
              de <span className="font-mono font-bold">{filteredAndSortedExpendios.length}</span> filtrados (Total: {expendios.length})
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="text-[11px]">Filas por página:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className={`border rounded-lg px-2 py-0.5 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-800' : 'bg-slate-950 border-slate-700 text-slate-200'
                }`}
              >
                <option value={25}>25 (Óptimo RAM)</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={0}>Todos ({filteredAndSortedExpendios.length})</option>
              </select>
            </div>
            {sortField && (
              <div className="flex items-center space-x-1 text-[11px] text-sky-600 dark:text-sky-400 font-semibold bg-sky-50 dark:bg-sky-950/60 px-2 py-0.5 rounded-md border border-sky-200 dark:border-sky-800">
                <span>Ordenado por: {
                  sortField === 'encargado' ? 'Encargado / Nombre' :
                  sortField === 'localidad' ? 'Localidad' :
                  sortField === 'centroOperativo' ? 'Centro Operativo' :
                  sortField === 'centroAcopio' ? 'Centro de Acopio' :
                  sortField === 'cedula' ? 'Cédula' :
                  sortField === 'fechaUltimaActualizacion' ? 'Última Actualización' : sortField
                } ({sortDirection === 'asc' ? 'A→Z' : 'Z→A'})</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {pageSize > 0 && totalPages > 1 && (
              <div className="flex items-center space-x-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className={`px-2 py-0.5 rounded border font-bold cursor-pointer disabled:opacity-40 ${
                    isLight ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                  }`}
                >
                  Anterior
                </button>
                <span className="font-mono px-1">
                  Pág. <strong>{currentPage}</strong> / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className={`px-2 py-0.5 rounded border font-bold cursor-pointer disabled:opacity-40 ${
                    isLight ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                  }`}
                >
                  Siguiente
                </button>
              </div>
            )}

            <div className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Base de Datos Oficial 4-72</span>
            </div>
          </div>
        </div>
      </div>

      {/* STRICT 16-COLUMN TABLE WITH EXCEL HEADERS */}
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

        <div className="overflow-x-auto max-w-full" ref={dropdownRef}>
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className={`font-bold uppercase tracking-wider text-[10px] border-b select-none ${
              isLight
                ? 'bg-slate-100 text-slate-700 border-slate-200'
                : 'bg-slate-950 text-slate-300 border-slate-800'
            }`}>
              <tr>
                <th className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200 text-slate-500' : 'border-slate-800/80 text-slate-400'}`}>#</th>
                
                {/* 1. CENTRO OPERATIVO */}
                <th className={`py-2 px-3 border-r relative ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSort('centroOperativo')}
                      className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                      title="Click para ordenar por Centro Operativo"
                    >
                      <span>1. CENTRO OPERATIVO</span>
                      {sortField === 'centroOperativo' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenFilterDropdown(openFilterDropdown === 'centroOperativo' ? null : 'centroOperativo')}
                      className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors ${
                        filterCentroOperativo !== 'TODOS' ? 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-950' : 'text-slate-400'
                      }`}
                      title="Filtro tipo Excel"
                    >
                      <Filter className="w-3 h-3" />
                    </button>
                  </div>
                  {/* Excel Dropdown Filter */}
                  {openFilterDropdown === 'centroOperativo' && (
                    <div className={`absolute left-0 top-full mt-1 z-30 w-52 rounded-xl border shadow-xl p-2.5 text-xs font-normal normal-case ${
                      isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
                    }`}>
                      <div className="font-bold text-[11px] mb-2 pb-1 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                        <span>Filtro Centro Operativo</span>
                        <button onClick={() => setOpenFilterDropdown(null)}><X className="w-3 h-3 text-slate-400" /></button>
                      </div>
                      <div className="space-y-1 mb-2">
                        <button
                          onClick={() => { setSortField('centroOperativo'); setSortDirection('asc'); setOpenFilterDropdown(null); }}
                          className="w-full text-left px-2 py-1 rounded hover:bg-sky-50 dark:hover:bg-sky-950/60 flex items-center space-x-1.5 text-xs"
                        >
                          <ArrowUp className="w-3 h-3 text-sky-600" />
                          <span>Ordenar A a Z</span>
                        </button>
                        <button
                          onClick={() => { setSortField('centroOperativo'); setSortDirection('desc'); setOpenFilterDropdown(null); }}
                          className="w-full text-left px-2 py-1 rounded hover:bg-sky-50 dark:hover:bg-sky-950/60 flex items-center space-x-1.5 text-xs"
                        >
                          <ArrowDown className="w-3 h-3 text-sky-600" />
                          <span>Ordenar Z a A</span>
                        </button>
                      </div>
                      <div className="border-t border-slate-200 dark:border-slate-700 pt-1.5 max-h-40 overflow-y-auto space-y-1">
                        <div
                          onClick={() => { setFilterCentroOperativo('TODOS'); setOpenFilterDropdown(null); }}
                          className={`px-2 py-1 rounded cursor-pointer text-[11px] font-semibold flex items-center justify-between ${
                            filterCentroOperativo === 'TODOS' ? 'bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span>(Todos)</span>
                          {filterCentroOperativo === 'TODOS' && <CheckCircle2 className="w-3 h-3 text-sky-600" />}
                        </div>
                        {uniqueCentrosOperativos.map((co) => (
                          <div
                            key={co}
                            onClick={() => { setFilterCentroOperativo(co); setOpenFilterDropdown(null); }}
                            className={`px-2 py-1 rounded cursor-pointer text-[11px] flex items-center justify-between ${
                              filterCentroOperativo === co ? 'bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200 font-bold' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span className="truncate">{co}</span>
                            {filterCentroOperativo === co && <CheckCircle2 className="w-3 h-3 text-sky-600" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </th>

                {/* 2. CENTRO DE ACOPIO */}
                <th className={`py-2 px-3 border-r relative ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSort('centroAcopio')}
                      className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                      title="Click para ordenar por Centro de Acopio"
                    >
                      <span>2. CENTRO DE ACOPIO</span>
                      {sortField === 'centroAcopio' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenFilterDropdown(openFilterDropdown === 'centroAcopio' ? null : 'centroAcopio')}
                      className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors ${
                        filterCentroAcopio !== 'TODOS' ? 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-950' : 'text-slate-400'
                      }`}
                      title="Filtro tipo Excel"
                    >
                      <Filter className="w-3 h-3" />
                    </button>
                  </div>
                  {/* Excel Dropdown Filter */}
                  {openFilterDropdown === 'centroAcopio' && (
                    <div className={`absolute left-0 top-full mt-1 z-30 w-52 rounded-xl border shadow-xl p-2.5 text-xs font-normal normal-case ${
                      isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
                    }`}>
                      <div className="font-bold text-[11px] mb-2 pb-1 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                        <span>Filtro Centro de Acopio</span>
                        <button onClick={() => setOpenFilterDropdown(null)}><X className="w-3 h-3 text-slate-400" /></button>
                      </div>
                      <div className="space-y-1 mb-2">
                        <button
                          onClick={() => { setSortField('centroAcopio'); setSortDirection('asc'); setOpenFilterDropdown(null); }}
                          className="w-full text-left px-2 py-1 rounded hover:bg-sky-50 dark:hover:bg-sky-950/60 flex items-center space-x-1.5 text-xs"
                        >
                          <ArrowUp className="w-3 h-3 text-sky-600" />
                          <span>Ordenar A a Z</span>
                        </button>
                        <button
                          onClick={() => { setSortField('centroAcopio'); setSortDirection('desc'); setOpenFilterDropdown(null); }}
                          className="w-full text-left px-2 py-1 rounded hover:bg-sky-50 dark:hover:bg-sky-950/60 flex items-center space-x-1.5 text-xs"
                        >
                          <ArrowDown className="w-3 h-3 text-sky-600" />
                          <span>Ordenar Z a A</span>
                        </button>
                      </div>
                      <div className="border-t border-slate-200 dark:border-slate-700 pt-1.5 max-h-40 overflow-y-auto space-y-1">
                        <div
                          onClick={() => { setFilterCentroAcopio('TODOS'); setOpenFilterDropdown(null); }}
                          className={`px-2 py-1 rounded cursor-pointer text-[11px] font-semibold flex items-center justify-between ${
                            filterCentroAcopio === 'TODOS' ? 'bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span>(Todos)</span>
                          {filterCentroAcopio === 'TODOS' && <CheckCircle2 className="w-3 h-3 text-sky-600" />}
                        </div>
                        {uniqueCentrosAcopio.map((ca) => (
                          <div
                            key={ca}
                            onClick={() => { setFilterCentroAcopio(ca); setOpenFilterDropdown(null); }}
                            className={`px-2 py-1 rounded cursor-pointer text-[11px] flex items-center justify-between ${
                              filterCentroAcopio === ca ? 'bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200 font-bold' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span className="truncate">{ca}</span>
                            {filterCentroAcopio === ca && <CheckCircle2 className="w-3 h-3 text-sky-600" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </th>

                {/* 3. LOCALIDAD */}
                <th className={`py-2 px-3 border-r relative ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSort('localidad')}
                      className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left text-sky-700 dark:text-sky-300"
                      title="Click para ordenar por Localidad"
                    >
                      <span>3. LOCALIDAD</span>
                      {sortField === 'localidad' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenFilterDropdown(openFilterDropdown === 'localidad' ? null : 'localidad')}
                      className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors ${
                        filterLocalidad !== 'TODOS' ? 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-950' : 'text-slate-400'
                      }`}
                      title="Filtro tipo Excel"
                    >
                      <Filter className="w-3 h-3" />
                    </button>
                  </div>
                  {/* Excel Dropdown Filter */}
                  {openFilterDropdown === 'localidad' && (
                    <div className={`absolute left-0 top-full mt-1 z-30 w-52 rounded-xl border shadow-xl p-2.5 text-xs font-normal normal-case ${
                      isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
                    }`}>
                      <div className="font-bold text-[11px] mb-2 pb-1 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                        <span>Filtro Localidad</span>
                        <button onClick={() => setOpenFilterDropdown(null)}><X className="w-3 h-3 text-slate-400" /></button>
                      </div>
                      <div className="space-y-1 mb-2">
                        <button
                          onClick={() => { setSortField('localidad'); setSortDirection('asc'); setOpenFilterDropdown(null); }}
                          className="w-full text-left px-2 py-1 rounded hover:bg-sky-50 dark:hover:bg-sky-950/60 flex items-center space-x-1.5 text-xs"
                        >
                          <ArrowUp className="w-3 h-3 text-sky-600" />
                          <span>Ordenar A a Z</span>
                        </button>
                        <button
                          onClick={() => { setSortField('localidad'); setSortDirection('desc'); setOpenFilterDropdown(null); }}
                          className="w-full text-left px-2 py-1 rounded hover:bg-sky-50 dark:hover:bg-sky-950/60 flex items-center space-x-1.5 text-xs"
                        >
                          <ArrowDown className="w-3 h-3 text-sky-600" />
                          <span>Ordenar Z a A</span>
                        </button>
                      </div>
                      <div className="border-t border-slate-200 dark:border-slate-700 pt-1.5 max-h-40 overflow-y-auto space-y-1">
                        <div
                          onClick={() => { setFilterLocalidad('TODOS'); setOpenFilterDropdown(null); }}
                          className={`px-2 py-1 rounded cursor-pointer text-[11px] font-semibold flex items-center justify-between ${
                            filterLocalidad === 'TODOS' ? 'bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span>(Todas)</span>
                          {filterLocalidad === 'TODOS' && <CheckCircle2 className="w-3 h-3 text-sky-600" />}
                        </div>
                        {uniqueLocalidades.map((loc) => (
                          <div
                            key={loc}
                            onClick={() => { setFilterLocalidad(loc); setOpenFilterDropdown(null); }}
                            className={`px-2 py-1 rounded cursor-pointer text-[11px] flex items-center justify-between ${
                              filterLocalidad === loc ? 'bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200 font-bold' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span className="truncate">{loc}</span>
                            {filterLocalidad === loc && <CheckCircle2 className="w-3 h-3 text-sky-600" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </th>

                {/* 4. ENCARGADO / NOMBRE */}
                <th className={`py-2 px-3 border-r relative ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSort('encargado')}
                      className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                      title="Click para ordenar por Nombre / Encargado"
                    >
                      <span>4. ENCARGADO (NOMBRE)</span>
                      {sortField === 'encargado' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenFilterDropdown(openFilterDropdown === 'encargado' ? null : 'encargado')}
                      className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors ${
                        sortField === 'encargado' ? 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-950' : 'text-slate-400'
                      }`}
                      title="Ordenar y filtrar por Nombre"
                    >
                      <Filter className="w-3 h-3" />
                    </button>
                  </div>
                  {/* Excel Dropdown Filter */}
                  {openFilterDropdown === 'encargado' && (
                    <div className={`absolute left-0 top-full mt-1 z-30 w-56 rounded-xl border shadow-xl p-2.5 text-xs font-normal normal-case ${
                      isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
                    }`}>
                      <div className="font-bold text-[11px] mb-2 pb-1 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                        <span>Ordenar por Nombre</span>
                        <button onClick={() => setOpenFilterDropdown(null)}><X className="w-3 h-3 text-slate-400" /></button>
                      </div>
                      <div className="space-y-1">
                        <button
                          onClick={() => { setSortField('encargado'); setSortDirection('asc'); setOpenFilterDropdown(null); }}
                          className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between text-xs ${
                            sortField === 'encargado' && sortDirection === 'asc' ? 'bg-sky-100 dark:bg-sky-900 font-bold text-sky-800 dark:text-sky-200' : 'hover:bg-sky-50 dark:hover:bg-sky-950/60'
                          }`}
                        >
                          <span className="flex items-center space-x-1.5">
                            <ArrowUp className="w-3 h-3 text-sky-600" />
                            <span>Ordenar de A a Z</span>
                          </span>
                          {sortField === 'encargado' && sortDirection === 'asc' && <CheckCircle2 className="w-3.5 h-3.5 text-sky-600" />}
                        </button>
                        <button
                          onClick={() => { setSortField('encargado'); setSortDirection('desc'); setOpenFilterDropdown(null); }}
                          className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between text-xs ${
                            sortField === 'encargado' && sortDirection === 'desc' ? 'bg-sky-100 dark:bg-sky-900 font-bold text-sky-800 dark:text-sky-200' : 'hover:bg-sky-50 dark:hover:bg-sky-950/60'
                          }`}
                        >
                          <span className="flex items-center space-x-1.5">
                            <ArrowDown className="w-3 h-3 text-sky-600" />
                            <span>Ordenar de Z a A</span>
                          </span>
                          {sortField === 'encargado' && sortDirection === 'desc' && <CheckCircle2 className="w-3.5 h-3.5 text-sky-600" />}
                        </button>
                      </div>
                    </div>
                  )}
                </th>

                {/* 5. CEDULA */}
                <th className={`py-2 px-3 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleSort('cedula')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por Cédula"
                  >
                    <span>5. CEDULA</span>
                    {sortField === 'cedula' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 6. DIRECCION PUNTO */}
                <th className={`py-2 px-3 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleSort('direccionPunto')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por Dirección"
                  >
                    <span>6. DIRECCION PUNTO</span>
                    {sortField === 'direccionPunto' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 7. TELEFONO PUNTO */}
                <th className={`py-2 px-3 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleSort('telefonoPunto')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por Teléfono"
                  >
                    <span>7. TELEFONO PUNTO</span>
                    {sortField === 'telefonoPunto' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 8. LETRERO */}
                <th className={`py-2 px-3 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleSort('letrero')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por estado de Letrero"
                  >
                    <span>8. LETRERO</span>
                    {sortField === 'letrero' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 9. BASCULA */}
                <th className={`py-2 px-3 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleSort('bascula')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por estado de Báscula"
                  >
                    <span>9. BASCULA</span>
                    {sortField === 'bascula' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 10. MATASELLO */}
                <th className={`py-2 px-3 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleSort('matasello')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por estado de Matasello"
                  >
                    <span>10. MATASELLO</span>
                    {sortField === 'matasello' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 11. USUARIO DE SIPOST */}
                <th className={`py-2 px-3 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleSort('usuarioSipost')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por Usuario Sipost"
                  >
                    <span>11. USUARIO DE SIPOST</span>
                    {sortField === 'usuarioSipost' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 12. COMPUTADOR */}
                <th className={`py-2 px-3 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleSort('computador')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por Computador"
                  >
                    <span>12. COMPUTADOR</span>
                    {sortField === 'computador' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 13. INTERNET */}
                <th className={`py-2 px-3 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleSort('internet')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por Internet"
                  >
                    <span>13. INTERNET</span>
                    {sortField === 'internet' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 14. NIT */}
                <th className={`py-2 px-3 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleSort('nit')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por NIT"
                  >
                    <span>14. NIT</span>
                    {sortField === 'nit' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 15. Correo Electronico */}
                <th className={`py-2 px-3 border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>
                  <button
                    type="button"
                    onClick={() => handleSort('correoElectronico')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por Correo Electrónico"
                  >
                    <span>15. Correo Electronico</span>
                    {sortField === 'correoElectronico' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 16. OBSERVACION */}
                <th className="py-2 px-3 border-r border-slate-700/60">
                  <button
                    type="button"
                    onClick={() => handleSort('observacion')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left"
                    title="Click para ordenar por Observación"
                  >
                    <span>16. OBSERVACION</span>
                    {sortField === 'observacion' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>

                {/* 17. ÚLTIMA ACTUALIZACIÓN */}
                <th className="py-2 px-3 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('fechaUltimaActualizacion')}
                    className="flex items-center space-x-1 hover:text-sky-600 dark:hover:text-sky-400 font-bold transition-colors cursor-pointer text-left text-emerald-600 dark:text-emerald-400"
                    title="Click para ordenar por Fecha de Última Actualización"
                  >
                    <span>17. ÚLTIMA ACTUALIZACIÓN</span>
                    {sortField === 'fechaUltimaActualizacion' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-sky-600" /> : <ArrowDown className="w-3 h-3 text-sky-600" />
                    ) : (
                      <ArrowUpDown className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                    )}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isLight ? 'divide-slate-200 text-slate-800' : 'divide-slate-800 text-slate-200'}`}>
              {paginatedExpendios.length > 0 ? (
                paginatedExpendios.map((exp, idx) => (
                  <tr
                    key={exp.id}
                    className={`transition-colors ${isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/60'}`}
                  >
                    <td className={`py-3 px-3.5 font-mono border-r text-[10px] ${isLight ? 'border-slate-200 text-slate-500' : 'border-slate-800/80 text-slate-500'}`}>
                      {pageSize > 0 ? (currentPage - 1) * pageSize + idx + 1 : idx + 1}
                    </td>
                    <td className={`py-3 px-3.5 font-medium border-r ${isLight ? 'border-slate-200' : 'border-slate-800/80'}`}>{exp.centroOperativo || normalizeCentroOperativo(exp.centroOperativo, exp.localidad)}</td>
                    <td className={`py-3 px-3.5 border-r ${isLight ? 'border-slate-200 text-slate-600' : 'border-slate-800/80 text-slate-300'}`}>{exp.centroAcopio || normalizeCentroAcopio(exp.centroAcopio, exp.localidad)}</td>
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
                    <td className={`py-3 px-3.5 text-[11px] max-w-xs truncate border-r ${isLight ? 'border-slate-200 text-slate-500' : 'border-slate-800/80 text-slate-400'}`}>{exp.observacion}</td>
                    <td className="py-3 px-3.5 whitespace-nowrap text-center">
                      {exp.fechaUltimaActualizacion && exp.fechaUltimaActualizacion !== '2026-07-31' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-500 dark:text-emerald-300 border border-emerald-500/30 font-mono font-bold text-[10.5px]">
                          {exp.fechaUltimaActualizacion}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500 italic text-[10.5px]">Sin actualizar</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={18} className={`py-12 text-center ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                    No se encontraron registros de expendios que coincidan con los filtros seleccionados.
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
