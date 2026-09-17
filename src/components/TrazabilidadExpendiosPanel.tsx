import React, { useState, useEffect } from 'react';
import { ExpendioData, TrazabilidadExpendio } from '../types';
import { ConfirmarBorradoModal } from './ConfirmarBorradoModal';
import {
  History,
  UserCheck,
  UserX,
  UserPlus,
  AlertTriangle,
  Search,
  Filter,
  Plus,
  Calendar,
  Building2,
  CheckCircle2,
  Trash2,
  FileSpreadsheet,
  ArrowRight,
  ShieldAlert,
  Store,
  RefreshCw,
  Lock
} from 'lucide-react';

interface TrazabilidadExpendiosPanelProps {
  expendios?: ExpendioData[];
  onRefreshExpendios?: () => void;
  onUpdate?: () => void;
}

export const TrazabilidadExpendiosPanel: React.FC<TrazabilidadExpendiosPanelProps> = ({
  expendios: propExpendios,
  onRefreshExpendios,
  onUpdate,
}) => {
  const [internalExpendios, setInternalExpendios] = useState<ExpendioData[]>([]);
  const expendios = propExpendios || internalExpendios;

  const [trazabilidadList, setTrazabilidadList] = useState<TrazabilidadExpendio[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filtroMes, setFiltroMes] = useState<string>('');
  const [filtroAnio, setFiltroAnio] = useState<string>('');
  const [filtroTipo, setFiltroTipo] = useState<string>('TODOS');
  const [filtroMunicipio, setFiltroMunicipio] = useState<string>('TODOS');
  
  // Modal State
  const [showModal, setShowModal] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [mensajeExito, setMensajeExito] = useState<string>('');

  // Form state
  const [municipioSel, setMunicipioSel] = useState<string>('');
  const [tipoMovimiento, setTipoMovimiento] = useState<'CAMBIO_ENCARGADO' | 'RETIRO_INHABILITACION' | 'INGRESO_NUEVO' | 'REACTIVACION'>('CAMBIO_ENCARGADO');
  
  const [encargadoAnterior, setEncargadoAnterior] = useState<string>('');
  const [cedulaAnterior, setCedulaAnterior] = useState<string>('');
  const [fechaRetiro, setFechaRetiro] = useState<string>('2026-07-15');

  const [encargadoNuevo, setEncargadoNuevo] = useState<string>('');
  const [cedulaNuevo, setCedulaNuevo] = useState<string>('');
  const [telefonoNuevo, setTelefonoNuevo] = useState<string>('');
  const [fechaIngreso, setFechaIngreso] = useState<string>('2026-07-16');

  const [estadoPunto, setEstadoPunto] = useState<'Activo' | 'Inhabilitado' | 'Cambiado' | 'En Transición'>('Cambiado');
  const [motivo, setMotivo] = useState<string>('');
  const [observaciones, setObservaciones] = useState<string>('');

  // Delete Modals State
  const [deletingItem, setDeletingItem] = useState<TrazabilidadExpendio | null>(null);
  const [isDeletingSingle, setIsDeletingSingle] = useState<boolean>(false);
  const [showClearAllModal, setShowClearAllModal] = useState<boolean>(false);
  const [isClearingAll, setIsClearingAll] = useState<boolean>(false);

  const fetchInternalExpendios = async () => {
    try {
      const res = await fetch('/api/expendios');
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setInternalExpendios(data.data);
      }
    } catch (err) {
      console.error('Error fetching expendios in trazabilidad:', err);
    }
  };

  // Fetch traceability records
  const fetchTrazabilidad = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/trazabilidad');
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setTrazabilidadList(data.data);
      }
    } catch (err) {
      console.error('Error cargando trazabilidad:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrazabilidad();
    if (!propExpendios || propExpendios.length === 0) {
      fetchInternalExpendios();
    }
  }, [propExpendios]);

  // When selecting a municipality in form, auto-fill existing encargado
  const handleMunicipioChange = (munName: string) => {
    setMunicipioSel(munName);
    const exp = expendios.find(
      (e) => (e.municipio || '').toLowerCase() === munName.toLowerCase() || (e.localidad || '').toLowerCase() === munName.toLowerCase()
    );
    if (exp) {
      setEncargadoAnterior(exp.encargado || '');
      setCedulaAnterior(exp.cedula || '');
    }
  };

  // Submit new movement
  const handleRegistrarMovimiento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!municipioSel) {
      alert('Por favor selecciona el municipio.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Partial<TrazabilidadExpendio> = {
        municipio: municipioSel,
        localidad: municipioSel,
        tipoMovimiento,
        encargadoAnterior,
        cedulaAnterior,
        fechaRetiro: tipoMovimiento === 'INGRESO_NUEVO' ? undefined : fechaRetiro,
        encargadoNuevo: tipoMovimiento === 'RETIRO_INHABILITACION' ? undefined : encargadoNuevo,
        cedulaNuevo: tipoMovimiento === 'RETIRO_INHABILITACION' ? undefined : cedulaNuevo,
        telefonoNuevo,
        fechaIngreso: tipoMovimiento === 'RETIRO_INHABILITACION' ? undefined : fechaIngreso,
        estadoPunto,
        motivo,
        observaciones,
        fechaRegistro: new Date().toISOString(),
      };

      const res = await fetch('/api/admin/trazabilidad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setMensajeExito(`✓ Novedad de trazabilidad registrada con éxito para ${municipioSel}.`);
        fetchTrazabilidad();
        if (onRefreshExpendios) onRefreshExpendios();
        if (onUpdate) onUpdate();
        setShowModal(false);
        // Reset form
        setMotivo('');
        setObservaciones('');
        setEncargadoNuevo('');
        setCedulaNuevo('');
        setTimeout(() => setMensajeExito(''), 6000);
      } else {
        alert(data.message || 'Error registrando trazabilidad.');
      }
    } catch (err) {
      console.error('Error enviando novedad:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDeleteSingle = async () => {
    if (!deletingItem) return;
    setIsDeletingSingle(true);
    try {
      const res = await fetch(`/api/admin/trazabilidad/${encodeURIComponent(deletingItem.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setMensajeExito(`✓ Registro de trazabilidad para ${deletingItem.municipio} eliminado con éxito.`);
        setDeletingItem(null);
        fetchTrazabilidad();
        setTimeout(() => setMensajeExito(''), 5000);
      } else {
        alert(data.message || 'Error eliminando registro de trazabilidad.');
      }
    } catch (err) {
      console.error('Error eliminando trazabilidad:', err);
      alert('Error de conexión al eliminar trazabilidad.');
    } finally {
      setIsDeletingSingle(false);
    }
  };

  const handleConfirmClearAll = async (password: string) => {
    setIsClearingAll(true);
    try {
      const res = await fetch('/api/admin/trazabilidad-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.success) {
        setMensajeExito(data.message || '✓ Todos los registros de trazabilidad han sido eliminados.');
        setShowClearAllModal(false);
        setTrazabilidadList([]);
        fetchTrazabilidad();
        setTimeout(() => setMensajeExito(''), 7000);
      } else {
        alert(data.message || 'Error al vaciar la trazabilidad.');
      }
    } catch (err) {
      console.error('Error al vaciar la trazabilidad:', err);
      alert('Error de conexión al vaciar trazabilidad.');
    } finally {
      setIsClearingAll(false);
    }
  };

  // Months list for filtering
  const MESES_OPCIONES = [
    { value: '', label: 'Todos los Meses' },
    { value: '01', label: 'Enero' },
    { value: '02', label: 'Febrero' },
    { value: '03', label: 'Marzo' },
    { value: '04', label: 'Abril' },
    { value: '05', label: 'Mayo' },
    { value: '06', label: 'Junio' },
    { value: '07', label: 'Julio' },
    { value: '08', label: 'Agosto' },
    { value: '09', label: 'Septiembre' },
    { value: '10', label: 'Octubre' },
    { value: '11', label: 'Noviembre' },
    { value: '12', label: 'Diciembre' },
  ];

  // Dynamic extraction of years in trazabilidad
  const aniosDisponibles = React.useMemo(() => {
    const years = new Set<string>();
    const yearRegex = /\b(20\d{2})\b/g;
    trazabilidadList.forEach((item) => {
      const dates = `${item.fechaRegistro || ''} ${item.fechaRetiro || ''} ${item.fechaIngreso || ''}`;
      const matches = dates.match(yearRegex);
      if (matches) matches.forEach((y) => years.add(y));
    });
    Array.from({ length: 17 }, (_, i) => String(2024 + i)).forEach((y) => years.add(y));
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [trazabilidadList]);

  // Get unique municipalities list
  const municipiosUnicos = Array.from(
    new Set(expendios.map((e) => (e.municipio || e.localidad || '').trim()).filter(Boolean))
  ).sort();

  // Filtered List
  const filteredList = trazabilidadList.filter((item) => {
    const datesStr = `${item.fechaRegistro || ''} ${item.fechaRetiro || ''} ${item.fechaIngreso || ''}`;

    // Month filter
    if (filtroMes) {
      const hasMonth = datesStr.includes(`-${filtroMes}-`) || datesStr.includes(`/${filtroMes}/`) || datesStr.includes(`-${filtroMes}`) || datesStr.includes(`/${filtroMes}`);
      if (!hasMonth) return false;
    }

    // Year filter
    if (filtroAnio) {
      if (!datesStr.includes(filtroAnio)) return false;
    }

    const matchSearch =
      (item.municipio || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.encargadoAnterior || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.encargadoNuevo || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.cedulaAnterior || '').includes(searchTerm) ||
      (item.cedulaNuevo || '').includes(searchTerm) ||
      (item.motivo || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchTipo = filtroTipo === 'TODOS' || item.tipoMovimiento === filtroTipo;
    const matchMun = filtroMunicipio === 'TODOS' || (item.municipio || '').toLowerCase() === filtroMunicipio.toLowerCase();

    return matchSearch && matchTipo && matchMun;
  });

  // Quick stats
  const totalCambiados = trazabilidadList.filter((t) => t.tipoMovimiento === 'CAMBIO_ENCARGADO').length;
  const totalInhabilitados = trazabilidadList.filter((t) => t.tipoMovimiento === 'RETIRO_INHABILITACION' || t.estadoPunto === 'Inhabilitado').length;
  const totalIngresos = trazabilidadList.filter((t) => t.tipoMovimiento === 'INGRESO_NUEVO').length;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center space-x-2 text-amber-400 font-semibold text-xs tracking-wider uppercase mb-1">
            <History className="w-4 h-4" />
            <span>Trazabilidad Histórica por Municipio</span>
          </div>
          <h3 className="text-xl font-bold text-slate-100">
            Control de Expendios Cambiados, Inhabilitados e Ingresos
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Registro cronológico detallado de relevos de contratistas, fechas de retiro, inicios y estado del punto por municipio.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowModal(true)}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center space-x-1.5 shadow-lg cursor-pointer transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>+ Registrar Novedad / Relevo</span>
          </button>

          {trazabilidadList.length > 0 && (
            <button
              onClick={() => setShowClearAllModal(true)}
              className="bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/80 font-semibold py-2.5 px-3 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
              title="Vaciar todos los registros de trazabilidad con contraseña maestra"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Vaciar Trazabilidad ({trazabilidadList.length})</span>
            </button>
          )}

          <button
            onClick={fetchTrazabilidad}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold py-2.5 px-3 rounded-xl text-xs flex items-center space-x-1 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {mensajeExito && (
        <div className="p-3 bg-emerald-950/70 border border-emerald-800 text-emerald-300 rounded-xl text-xs flex items-center space-x-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{mensajeExito}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
          <div className="text-[10px] text-slate-400 font-semibold uppercase">Total Movimientos</div>
          <div className="text-xl font-bold text-slate-100 font-mono mt-0.5">{trazabilidadList.length}</div>
        </div>

        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
          <div className="text-[10px] text-amber-400 font-semibold uppercase">Cambios de Encargado</div>
          <div className="text-xl font-bold text-amber-400 font-mono mt-0.5">{totalCambiados}</div>
        </div>

        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
          <div className="text-[10px] text-rose-400 font-semibold uppercase">Inhabilitados / Retirados</div>
          <div className="text-xl font-bold text-rose-400 font-mono mt-0.5">{totalInhabilitados}</div>
        </div>

        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
          <div className="text-[10px] text-emerald-400 font-semibold uppercase">Nuevos Ingresos</div>
          <div className="text-xl font-bold text-emerald-400 font-mono mt-0.5">{totalIngresos}</div>
        </div>
      </div>

      {/* Search & Filters with Month and Year */}
      <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-center">
          {/* Text Search */}
          <div className="relative sm:col-span-2 lg:col-span-4">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por Municipio, Encargado, Cédula o Motivo..."
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Month Selector */}
          <div className="relative sm:col-span-1 lg:col-span-2">
            <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200">
              <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-[11px] text-slate-400 font-semibold shrink-0">Mes:</span>
              <select
                value={filtroMes}
                onChange={(e) => setFiltroMes(e.target.value)}
                className="w-full bg-transparent text-xs text-slate-100 font-medium focus:outline-none cursor-pointer"
              >
                {MESES_OPCIONES.map((m) => (
                  <option key={m.value} value={m.value} className="bg-slate-900 text-slate-100">
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Year Selector */}
          <div className="relative sm:col-span-1 lg:col-span-2">
            <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200">
              <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-[11px] text-slate-400 font-semibold shrink-0">Año:</span>
              <select
                value={filtroAnio}
                onChange={(e) => setFiltroAnio(e.target.value)}
                className="w-full bg-transparent text-xs text-slate-100 font-medium focus:outline-none cursor-pointer"
              >
                <option value="" className="bg-slate-900 text-slate-100">Todos los Años</option>
                {aniosDisponibles.map((y) => (
                  <option key={y} value={y} className="bg-slate-900 text-slate-100">
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Type Selector */}
          <div className="relative sm:col-span-1 lg:col-span-2">
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="TODOS">Todos los Tipos</option>
              <option value="CAMBIO_ENCARGADO">🔄 Cambios de Encargado</option>
              <option value="RETIRO_INHABILITACION">⛔ Inhabilitados / Retirados</option>
              <option value="INGRESO_NUEVO">✨ Nuevos Ingresos</option>
              <option value="REACTIVACION">⚡ Reactivaciones</option>
            </select>
          </div>

          {/* Municipality Selector */}
          <div className="relative sm:col-span-1 lg:col-span-2">
            <select
              value={filtroMunicipio}
              onChange={(e) => setFiltroMunicipio(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="TODOS">Todos los Municipios</option>
              {municipiosUnicos.map((mun) => (
                <option key={mun} value={mun}>
                  {mun}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-[11px]">
          <div className="text-slate-400">
            Mostrando <strong className="text-amber-400 font-bold">{filteredList.length}</strong> de <span className="text-slate-300 font-semibold">{trazabilidadList.length}</span> registros de trazabilidad
          </div>

          {(searchTerm || filtroMes || filtroAnio || filtroTipo !== 'TODOS' || filtroMunicipio !== 'TODOS') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setFiltroMes('');
                setFiltroAnio('');
                setFiltroTipo('TODOS');
                setFiltroMunicipio('TODOS');
              }}
              className="text-amber-400 hover:text-amber-300 text-xs font-semibold underline cursor-pointer"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Traceability List / Cards */}
      <div className="space-y-3">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-xs">Cargando registros de trazabilidad...</div>
        ) : filteredList.length === 0 ? (
          <div className="p-12 text-center bg-slate-950 rounded-xl border border-dashed border-slate-800 text-slate-500 space-y-2">
            <History className="w-8 h-8 mx-auto text-slate-600" />
            <p className="text-xs font-semibold text-slate-400">No se encontraron movimientos registrados con los filtros actuales.</p>
            <p className="text-[11px] text-slate-500">Haz clic en "+ Registrar Novedad / Relevo" para agregar el primer registro histórico.</p>
          </div>
        ) : (
          filteredList.map((item) => {
            const isCambio = item.tipoMovimiento === 'CAMBIO_ENCARGADO';
            const isInhabilitado = item.tipoMovimiento === 'RETIRO_INHABILITACION' || item.estadoPunto === 'Inhabilitado';
            const isIngreso = item.tipoMovimiento === 'INGRESO_NUEVO';

            return (
              <div
                key={item.id}
                className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all shadow-md space-y-3"
              >
                {/* Top Row: Municipality & Badge */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                  <div className="flex items-center space-x-2.5">
                    <span className="p-2 bg-amber-500/10 text-amber-400 rounded-lg border border-amber-500/20">
                      <Building2 className="w-4 h-4" />
                    </span>
                    <div>
                      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">
                        MUNICIPIO BASE
                      </span>
                      <h4 className="font-bold text-slate-100 text-sm">
                        {item.municipio.toUpperCase()}
                      </h4>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {isCambio && (
                      <span className="px-2.5 py-1 bg-amber-950/60 border border-amber-800 text-amber-300 text-[10px] font-bold rounded-lg flex items-center space-x-1">
                        <UserCheck className="w-3 h-3" />
                        <span>Relevo de Encargado</span>
                      </span>
                    )}
                    {isInhabilitado && (
                      <span className="px-2.5 py-1 bg-rose-950/60 border border-rose-800 text-rose-300 text-[10px] font-bold rounded-lg flex items-center space-x-1">
                        <UserX className="w-3 h-3" />
                        <span>Punto Inhabilitado / Retirado</span>
                      </span>
                    )}
                    {isIngreso && (
                      <span className="px-2.5 py-1 bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-[10px] font-bold rounded-lg flex items-center space-x-1">
                        <UserPlus className="w-3 h-3" />
                        <span>Nuevo Ingreso / Apertura</span>
                      </span>
                    )}

                    <span className="text-[10px] text-slate-400 font-mono bg-slate-900 px-2 py-1 rounded border border-slate-800">
                      {item.fechaRegistro ? new Date(item.fechaRegistro).toLocaleDateString('es-CO') : ''}
                    </span>

                    <button
                      onClick={() => setDeletingItem(item)}
                      className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                      title="Eliminar registro de trazabilidad"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Transition Flow Grid (Saliente -> Entrante) */}
                <div className="grid grid-cols-1 md:grid-cols-11 gap-3 items-center">
                  {/* Encargado Saliente */}
                  <div className="md:col-span-5 bg-slate-900/90 rounded-xl p-3 border border-slate-800/80 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">
                        Encargado Saliente / Anterior
                      </span>
                      {item.fechaRetiro && (
                        <span className="text-[10px] text-slate-300 font-mono bg-rose-950/50 px-1.5 py-0.5 rounded border border-rose-900/50">
                          Hasta: {item.fechaRetiro}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-bold text-slate-200">
                      {item.encargadoAnterior || 'No registrado'}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      C.C. {item.cedulaAnterior || 'N/A'}
                    </div>
                  </div>

                  {/* Transition Arrow */}
                  <div className="md:col-span-1 flex justify-center text-amber-400">
                    <ArrowRight className="w-5 h-5 hidden md:block" />
                    <span className="md:hidden text-[10px] text-amber-400 font-bold uppercase">↓ RELEVO ↓</span>
                  </div>

                  {/* Encargado Entrante */}
                  <div className="md:col-span-5 bg-slate-900/90 rounded-xl p-3 border border-slate-800/80 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                        Encargado Entrante / Nuevo
                      </span>
                      {item.fechaIngreso && (
                        <span className="text-[10px] text-slate-300 font-mono bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-900/50">
                          Desde: {item.fechaIngreso}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-bold text-slate-200">
                      {item.encargadoNuevo || (isInhabilitado ? '(Punto cerrado / sin encargado)' : 'Por definir')}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      C.C. {item.cedulaNuevo || 'N/A'} {item.telefonoNuevo ? `| Tel: ${item.telefonoNuevo}` : ''}
                    </div>
                  </div>
                </div>

                {/* Motivo and Observations */}
                {(item.motivo || item.observaciones) && (
                  <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-800/50 text-xs text-slate-300 space-y-0.5">
                    {item.motivo && (
                      <div className="text-[11px] font-semibold text-slate-200">
                        <span className="text-amber-400 font-bold">Motivo:</span> {item.motivo}
                      </div>
                    )}
                    {item.observaciones && (
                      <div className="text-[11px] text-slate-400">
                        <span className="text-slate-500 font-medium">Observaciones:</span> {item.observaciones}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Registrar Novedad / Relevo */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <History className="w-5 h-5 text-amber-400" />
                <h3 className="text-lg font-bold text-slate-100">Registrar Novedad de Expendio</h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRegistrarMovimiento} className="space-y-4">
              {/* Municipio & Movement Type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Municipio Base *
                  </label>
                  <select
                    value={municipioSel}
                    onChange={(e) => handleMunicipioChange(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                  >
                    <option value="">-- Seleccionar Municipio --</option>
                    {municipiosUnicos.map((mun) => (
                      <option key={mun} value={mun}>
                        {mun}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Tipo de Movimiento *
                  </label>
                  <select
                    value={tipoMovimiento}
                    onChange={(e) => setTipoMovimiento(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                  >
                    <option value="CAMBIO_ENCARGADO">🔄 Cambio de Encargado (Relevo)</option>
                    <option value="RETIRO_INHABILITACION">⛔ Retiro / Inhabilitación de Punto</option>
                    <option value="INGRESO_NUEVO">✨ Nuevo Ingreso / Apertura</option>
                    <option value="REACTIVACION">⚡ Reactivación de Expendio</option>
                  </select>
                </div>
              </div>

              {/* Saliente Section */}
              {tipoMovimiento !== 'INGRESO_NUEVO' && (
                <div className="p-3 bg-slate-950 rounded-xl border border-rose-900/40 space-y-2">
                  <div className="text-[11px] font-bold text-rose-400 uppercase tracking-wider flex items-center justify-between">
                    <span>1. Encargado Saliente / Anterior</span>
                    <span>Fecha Retiro</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={encargadoAnterior}
                      onChange={(e) => setEncargadoAnterior(e.target.value)}
                      placeholder="Nombre saliente (ej: Pedro Perez)"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 sm:col-span-1"
                    />
                    <input
                      type="text"
                      value={cedulaAnterior}
                      onChange={(e) => setCedulaAnterior(e.target.value)}
                      placeholder="Cédula saliente"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono"
                    />
                    <input
                      type="date"
                      value={fechaRetiro}
                      onChange={(e) => setFechaRetiro(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Entrante Section */}
              {tipoMovimiento !== 'RETIRO_INHABILITACION' && (
                <div className="p-3 bg-slate-950 rounded-xl border border-emerald-900/40 space-y-2">
                  <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center justify-between">
                    <span>2. Encargado Entrante / Nuevo</span>
                    <span>Fecha Inicio</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={encargadoNuevo}
                      onChange={(e) => setEncargadoNuevo(e.target.value)}
                      placeholder="Nombre nuevo encargado"
                      required={tipoMovimiento === 'CAMBIO_ENCARGADO' || tipoMovimiento === 'INGRESO_NUEVO'}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 sm:col-span-1"
                    />
                    <input
                      type="text"
                      value={cedulaNuevo}
                      onChange={(e) => setCedulaNuevo(e.target.value)}
                      placeholder="Cédula nuevo encargado"
                      required={tipoMovimiento === 'CAMBIO_ENCARGADO' || tipoMovimiento === 'INGRESO_NUEVO'}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono"
                    />
                    <input
                      type="date"
                      value={fechaIngreso}
                      onChange={(e) => setFechaIngreso(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono"
                    />
                  </div>

                  <input
                    type="text"
                    value={telefonoNuevo}
                    onChange={(e) => setTelefonoNuevo(e.target.value)}
                    placeholder="Teléfono nuevo encargado (Opcional)"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                </div>
              )}

              {/* Status and Motive */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Estado del Punto</label>
                  <select
                    value={estadoPunto}
                    onChange={(e) => setEstadoPunto(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                  >
                    <option value="Activo">🟢 Activo</option>
                    <option value="Cambiado">🔄 Cambiado</option>
                    <option value="Inhabilitado">⛔ Inhabilitado</option>
                    <option value="En Transición">🟡 En Transición</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Motivo Principal</label>
                  <input
                    type="text"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ej: Renuncia voluntaria, cambio de local, relevo de personal..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Observaciones</label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  rows={2}
                  placeholder="Detalles adicionales del proceso de empalme o entrega de equipos/matasellos..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl text-xs flex items-center space-x-2 shadow-lg cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{submitting ? 'Guardando...' : 'Guardar Novedad y Actualizar'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Borrado Seguro con Contraseña Maestra (Camarca.2023*) para Vaciar Toda la Trazabilidad */}
      {showClearAllModal && (
        <ConfirmarBorradoModal
          isOpen={showClearAllModal}
          titulo="Vaciar Todo el Historial de Trazabilidad"
          mensajeAdvertencia="¿Estás seguro de que deseas ELIMINAR COMPLETAMENTE todos los registros históricos de novedades y relevos de trazabilidad?"
          detallesExtra={`Se eliminarán ${trazabilidadList.length} registros de trazabilidad de forma permanente.`}
          textoBotonConfirmar="Confirmar y Vaciar Trazabilidad"
          isProcessing={isClearingAll}
          onConfirm={handleConfirmClearAll}
          onClose={() => setShowClearAllModal(false)}
        />
      )}

      {/* Modal de Confirmación de Borrado Individual de Registro de Trazabilidad */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 max-w-md w-full rounded-2xl p-6 shadow-2xl space-y-4 animate-scaleUp">
            <div className="flex items-center space-x-3 text-rose-400">
              <div className="p-3 bg-rose-950/80 rounded-xl border border-rose-800/80">
                <Trash2 className="w-6 h-6 text-rose-400" />
              </div>
              <div>
                <h4 className="text-base font-bold text-slate-100">Eliminar Registro de Trazabilidad</h4>
                <p className="text-xs text-slate-400">Acción irreversible</p>
              </div>
            </div>

            <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
              <p>
                ¿Deseas eliminar el registro histórico del municipio <strong className="text-amber-400 font-bold">{deletingItem.municipio.toUpperCase()}</strong>?
              </p>
              <p className="text-[11px] text-slate-400">
                • <strong>Movimiento:</strong> {deletingItem.tipoMovimiento}<br />
                • <strong>Encargado:</strong> {deletingItem.encargadoNuevo || deletingItem.encargadoAnterior || 'N/A'}<br />
                • <strong>Motivo:</strong> {deletingItem.motivo || 'Sin motivo detallado'}
              </p>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                disabled={isDeletingSingle}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSingle}
                disabled={isDeletingSingle}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 shadow-lg shadow-rose-950/50 cursor-pointer transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingSingle ? 'Eliminando...' : 'Sí, Eliminar Registro'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
