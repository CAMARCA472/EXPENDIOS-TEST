import React, { useState, useEffect } from 'react';
import {
  Users,
  UserCheck,
  UserX,
  Activity,
  Smartphone,
  Laptop,
  Tablet,
  Clock,
  Calendar,
  ShieldCheck,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Building2,
  Trash2,
  Phone,
  ArrowUpRight,
  Filter,
  Globe,
  MapPin,
  Wifi,
} from 'lucide-react';
import { MetricasAccesoResumen, RegistroAcceso, ResumenExpendioAcceso } from '../types';

interface AdminMetricasViewProps {
  onGoToExpendios?: () => void;
}

export const AdminMetricasView: React.FC<AdminMetricasViewProps> = ({ onGoToExpendios }) => {
  const [metricas, setMetricas] = useState<MetricasAccesoResumen | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filtroRol, setFiltroRol] = useState<string>('todos');
  const [subTab, setSubTab] = useState<'ultimos' | 'ingresaron' | 'pendientes'>('ultimos');
  const [modalLimpiar, setModalLimpiar] = useState<boolean>(false);
  const [passwordLimpiar, setPasswordLimpiar] = useState<string>('');
  const [errorLimpiar, setErrorLimpiar] = useState<string>('');
  const [procesandoLimpiar, setProcesandoLimpiar] = useState<boolean>(false);

  const fetchMetricas = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/metrics/accesos');
      const data = await res.json();
      if (data.success && data.data) {
        setMetricas(data.data);
      }
    } catch (err) {
      console.error('Error cargando métricas de acceso:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetricas();
  }, []);

  const handleExportarCSV = () => {
    window.location.href = '/api/admin/metrics/exportar-csv';
  };

  const handleConfirmarLimpiar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordLimpiar.trim()) {
      setErrorLimpiar('Ingresa la contraseña maestra para continuar.');
      return;
    }

    setProcesandoLimpiar(true);
    setErrorLimpiar('');

    try {
      const res = await fetch('/api/admin/metrics/limpiar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordLimpiar }),
      });
      const data = await res.json();
      if (data.success) {
        setModalLimpiar(false);
        setPasswordLimpiar('');
        fetchMetricas();
      } else {
        setErrorLimpiar(data.message || 'Contraseña incorrecta.');
      }
    } catch (err) {
      setErrorLimpiar('Error al procesar la solicitud.');
    } finally {
      setProcesandoLimpiar(false);
    }
  };

  // Filtrado de últimos accesos
  const accesosFiltrados = (metricas?.ultimosAccesos || []).filter((item: RegistroAcceso) => {
    if (filtroRol !== 'todos' && item.rol !== filtroRol) return false;
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (item.usuario || '').toLowerCase().includes(term) ||
      (item.cedulaOrNit || '').includes(term) ||
      (item.municipio || '').toLowerCase().includes(term) ||
      (item.dispositivo || '').toLowerCase().includes(term) ||
      (item.ip || '').includes(term) ||
      (item.ubicacionIp || '').toLowerCase().includes(term) ||
      (item.isp || '').toLowerCase().includes(term)
    );
  });

  // Filtrado de expendios que ingresaron
  const expendiosIngresaronFiltrados = (metricas?.expendiosQueHanIngresado || []).filter(
    (exp: ResumenExpendioAcceso) => {
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        (exp.encargado || '').toLowerCase().includes(term) ||
        (exp.cedula || '').includes(term) ||
        (exp.municipio || '').toLowerCase().includes(term) ||
        (exp.telefonoPunto || '').includes(term) ||
        (exp.ultimaIp || '').includes(term) ||
        (exp.ultimaUbicacion || '').toLowerCase().includes(term) ||
        (exp.isp || '').toLowerCase().includes(term)
      );
    }
  );

  // Filtrado de expendios pendientes
  const expendiosPendientesFiltrados = (metricas?.expendiosPendientesPorIngresar || []).filter(
    (exp) => {
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        (exp.encargado || '').toLowerCase().includes(term) ||
        (exp.cedula || '').includes(term) ||
        (exp.municipio || '').toLowerCase().includes(term) ||
        (exp.telefonoPunto || '').includes(term)
      );
    }
  );

  return (
    <div className="space-y-6">
      {/* Encabezado Superior */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-amber-400 font-semibold text-xs tracking-wider uppercase mb-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-emerald-400">Acceso Restringido • Solo Administrador</span>
          </div>
          <h3 className="text-2xl font-bold text-slate-100 flex items-center space-x-2">
            <Activity className="w-6 h-6 text-amber-400" />
            <span>Métricas de Acceso a la Aplicación</span>
          </h3>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Conteo en tiempo real de cuántas personas han ingresado a la plataforma, desglose por
            expendios y registro detallado de accesos por dispositivo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={fetchMetricas}
            disabled={loading}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2.5 px-4 rounded-xl border border-slate-700 flex items-center space-x-2 cursor-pointer transition-colors shadow"
          >
            <RefreshCw className={`w-4 h-4 text-amber-400 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar Métricas</span>
          </button>

          <button
            onClick={handleExportarCSV}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold py-2.5 px-4 rounded-xl flex items-center space-x-2 cursor-pointer transition-colors shadow-lg"
            title="Descargar registro de accesos en formato CSV / Excel"
          >
            <Download className="w-4 h-4 text-slate-950" />
            <span>Exportar CSV</span>
          </button>

          <button
            onClick={() => setModalLimpiar(true)}
            className="bg-slate-800/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-700/80 hover:border-rose-800/70 text-xs font-medium py-2.5 px-3 rounded-xl flex items-center space-x-1.5 cursor-pointer transition-colors"
            title="Reiniciar historial de accesos"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reiniciar</span>
          </button>
        </div>
      </div>

      {/* Tarjetas KPI de Métricas Principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Personas Únicas */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Personas que Han Ingresado
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-slate-100">
              {metricas?.totalUsuariosUnicos ?? 0}
            </span>
            <span className="text-xs font-medium text-amber-400">usuarios únicos</span>
          </div>
          <p className="mt-2 text-xs text-slate-400 flex items-center space-x-1">
            <span>Cédulas o identidades distintas registradas</span>
          </p>
        </div>

        {/* KPI 2: Total Ingresos / Sesiones */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Total Ingresos Realizados
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-emerald-400">
              {metricas?.totalIngresos ?? 0}
            </span>
            <span className="text-xs text-slate-400">inicios de sesión</span>
          </div>
          <p className="mt-2 text-xs text-slate-400 flex items-center space-x-1">
            <span className="text-emerald-400 font-semibold">{metricas?.ingresosHoy ?? 0} hoy</span>
            <span>• {metricas?.ingresosUltimos7Dias ?? 0} últimos 7 días</span>
          </p>
        </div>

        {/* KPI 3: Cobertura de Expendios */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Cobertura de Expendios
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <UserCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-blue-400">
              {metricas?.expendiosQueHanIngresadoCount ?? 0}
            </span>
            <span className="text-xs text-slate-400">
              de {metricas?.expendiosRegistradosTotales ?? 0} expendios
            </span>
          </div>
          {/* Barra de progreso */}
          <div className="mt-3 w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(metricas?.porcentajeCoberturaExpendios ?? 0, 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            <strong className="text-blue-400">{metricas?.porcentajeCoberturaExpendios ?? 0}%</strong>{' '}
            de los expendios han ingresado
          </p>
        </div>

        {/* KPI 4: Expendios Pendientes */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Pendientes por Ingresar
            </span>
            <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <UserX className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-rose-400">
              {metricas?.expendiosPendientesPorIngresar.length ?? 0}
            </span>
            <span className="text-xs text-slate-400">expendios sin acceso</span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Pendientes por ingresar a la plataforma o tomar fotos
          </p>
        </div>
      </div>

      {/* Fila con Desglose por Rol & Desglose por Dispositivo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Desglose por Rol */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
          <h4 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
            <Users className="w-4 h-4 text-amber-400" />
            <span>Ingresos por Tipo de Usuario / Rol</span>
          </h4>

          <div className="space-y-3">
            {/* Expendio */}
            <div className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs">
                  EXP
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-200">Encargados de Expendios</div>
                  <div className="text-[11px] text-slate-400">
                    Ingresos con cédula de los puntos postales
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-base font-extrabold text-amber-400">
                  {metricas?.desglosePorRol.expendio ?? 0}
                </span>
                <span className="text-xs text-slate-400 ml-1">ingresos</span>
              </div>
            </div>

            {/* Administrador */}
            <div className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold text-xs">
                  ADM
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-200">Administrador / Operaciones</div>
                  <div className="text-[11px] text-slate-400">
                    Ingresos con credenciales administrativas
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-base font-extrabold text-purple-400">
                  {metricas?.desglosePorRol.admin ?? 0}
                </span>
                <span className="text-xs text-slate-400 ml-1">ingresos</span>
              </div>
            </div>

            {/* Cliente 4-72 */}
            <div className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                  472
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-200">Cliente 4-72 (Servicios Postales)</div>
                  <div className="text-[11px] text-slate-400">
                    Consultas con NIT 900062917
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-base font-extrabold text-emerald-400">
                  {metricas?.desglosePorRol.cliente ?? 0}
                </span>
                <span className="text-xs text-slate-400 ml-1">ingresos</span>
              </div>
            </div>
          </div>
        </div>

        {/* Desglose por Dispositivo */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
          <h4 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
            <Smartphone className="w-4 h-4 text-emerald-400" />
            <span>Dispositivo Utilizado para Ingresar</span>
          </h4>

          <div className="grid grid-cols-3 gap-3">
            {/* Móvil */}
            <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl flex flex-col items-center justify-center text-center">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-2">
                <Smartphone className="w-5 h-5" />
              </div>
              <span className="text-xl font-extrabold text-emerald-400">
                {metricas?.desgloseDispositivo.movil ?? 0}
              </span>
              <span className="text-xs font-semibold text-slate-200 mt-0.5">Celular / Móvil</span>
              <span className="text-[11px] text-slate-400 mt-0.5">Android / iPhone</span>
            </div>

            {/* Computador */}
            <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl flex flex-col items-center justify-center text-center">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-2">
                <Laptop className="w-5 h-5" />
              </div>
              <span className="text-xl font-extrabold text-blue-400">
                {metricas?.desgloseDispositivo.escritorio ?? 0}
              </span>
              <span className="text-xs font-semibold text-slate-200 mt-0.5">Computador</span>
              <span className="text-[11px] text-slate-400 mt-0.5">Escritorio / Laptop</span>
            </div>

            {/* Tablet */}
            <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl flex flex-col items-center justify-center text-center">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center mb-2">
                <Tablet className="w-5 h-5" />
              </div>
              <span className="text-xl font-extrabold text-purple-400">
                {metricas?.desgloseDispositivo.tablet ?? 0}
              </span>
              <span className="text-xs font-semibold text-slate-200 mt-0.5">Tablet / iPad</span>
              <span className="text-[11px] text-slate-400 mt-0.5">Pantalla mediana</span>
            </div>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300">
            <strong>Dato de Operación:</strong> La mayoría de encargados de expendio acceden desde
            sus teléfonos móviles para tomar y cargar fotografías directamente con la cámara del punto.
          </div>
        </div>
      </div>

      {/* Sub-Pestañas de Detalle */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2 bg-slate-800/80 p-1 rounded-xl">
            <button
              onClick={() => setSubTab('ultimos')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                subTab === 'ultimos'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Últimos Ingresos ({accesosFiltrados.length})
            </button>

            <button
              onClick={() => setSubTab('ingresaron')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                subTab === 'ingresaron'
                  ? 'bg-blue-500 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Expendios que ya Ingresaron ({metricas?.expendiosQueHanIngresadoCount ?? 0})
            </button>

            <button
              onClick={() => setSubTab('pendientes')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                subTab === 'pendientes'
                  ? 'bg-rose-500 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Expendios Pendientes ({metricas?.expendiosPendientesPorIngresar.length ?? 0})
            </button>
          </div>

          {/* Buscador y filtro de rol */}
          <div className="flex items-center space-x-2 w-full sm:w-auto">
            {subTab === 'ultimos' && (
              <select
                value={filtroRol}
                onChange={(e) => setFiltroRol(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-2.5 py-2 cursor-pointer focus:outline-none focus:border-amber-400"
              >
                <option value="todos">Todos los Roles</option>
                <option value="expendio">Expendios</option>
                <option value="admin">Administrador</option>
                <option value="cliente">Cliente 4-72</option>
              </select>
            )}

            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nombre, cédula o municipio..."
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl pl-9 pr-3 py-2 placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>
        </div>

        {/* CONTENIDO 1: Últimos Ingresos */}
        {subTab === 'ultimos' && (
          <div className="overflow-x-auto">
            {accesosFiltrados.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                No se encontraron registros de ingresos que coincidan con la búsqueda.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px] font-semibold bg-slate-800/40">
                    <th className="py-3 px-3">Fecha y Hora</th>
                    <th className="py-3 px-3">Usuario / Encargado</th>
                    <th className="py-3 px-3">Cédula / NIT</th>
                    <th className="py-3 px-3">Rol</th>
                    <th className="py-3 px-3">Municipio / Punto</th>
                    <th className="py-3 px-3">Dirección IP y Ubicación</th>
                    <th className="py-3 px-3">Dispositivo / Navegador</th>
                    <th className="py-3 px-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {accesosFiltrados.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-3 whitespace-nowrap text-slate-300 font-mono text-[11px]">
                        {item.fechaFormateada || item.timestamp}
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-100">
                        {item.usuario || 'Usuario'}
                      </td>
                      <td className="py-3 px-3 font-mono text-amber-400/90 whitespace-nowrap">
                        {item.cedulaOrNit}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.rol === 'admin'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : item.rol === 'expendio'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : item.rol === 'cliente'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          {item.rol?.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {item.municipio ? (
                          <span className="font-medium text-slate-200">{item.municipio}</span>
                        ) : (
                          <span className="text-slate-500 italic">No especificado</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        <div className="flex items-center space-x-1.5 font-mono text-emerald-400 font-semibold text-[11px]">
                          <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>{item.ip || '127.0.0.1'}</span>
                        </div>
                        <div className="text-[11px] text-slate-300 flex items-center space-x-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-amber-400 shrink-0" />
                          <span className="truncate max-w-[190px]">{item.ubicacionIp || (item.municipio ? `${item.municipio}, Colombia` : 'Colombia')}</span>
                        </div>
                        {item.isp && (
                          <div className="text-[10px] text-slate-400 flex items-center space-x-1 mt-0.5">
                            <Wifi className="w-2.5 h-2.5 text-sky-400 shrink-0" />
                            <span className="truncate max-w-[190px]">{item.isp}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        <div className="flex items-center space-x-1.5">
                          {item.dispositivo?.includes('Móvil') || item.dispositivo?.includes('iPhone') ? (
                            <Smartphone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <Laptop className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          )}
                          <span className="text-slate-200">{item.dispositivo}</span>
                        </div>
                        <div className="text-[10px] text-slate-500">{item.navegador}</div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {item.exitoso ? (
                          <span className="inline-flex items-center text-emerald-400 text-[11px] font-semibold space-x-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Exitoso</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-rose-400 text-[11px] font-semibold space-x-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Fallido</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* CONTENIDO 2: Expendios que ya ingresaron */}
        {subTab === 'ingresaron' && (
          <div className="overflow-x-auto">
            {expendiosIngresaronFiltrados.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                No hay expendios que coincidan con la búsqueda.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px] font-semibold bg-slate-800/40">
                    <th className="py-3 px-3">Municipio</th>
                    <th className="py-3 px-3">Encargado</th>
                    <th className="py-3 px-3">Cédula</th>
                    <th className="py-3 px-3">Teléfono</th>
                    <th className="py-3 px-3">Última IP y Ubicación</th>
                    <th className="py-3 px-3 text-center">N° Ingresos</th>
                    <th className="py-3 px-3">Último Acceso</th>
                    <th className="py-3 px-3 text-center">Fotos Registradas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {expendiosIngresaronFiltrados.map((exp) => (
                    <tr key={exp.cedula} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-3 font-bold text-amber-400">{exp.municipio}</td>
                      <td className="py-3 px-3 font-semibold text-slate-100">{exp.encargado}</td>
                      <td className="py-3 px-3 font-mono text-slate-300">{exp.cedula}</td>
                      <td className="py-3 px-3 text-slate-300">{exp.telefonoPunto || 'Sin registrar'}</td>
                      <td className="py-3 px-3">
                        <div className="font-mono text-emerald-400 text-[11px] flex items-center space-x-1 font-semibold">
                          <Globe className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span>{exp.ultimaIp || '127.0.0.1'}</span>
                        </div>
                        <div className="text-[11px] text-slate-300 flex items-center space-x-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-amber-400 shrink-0" />
                          <span className="truncate max-w-[170px]">{exp.ultimaUbicacion || (exp.municipio ? `${exp.municipio}, Colombia` : 'Colombia')}</span>
                        </div>
                        {exp.isp && (
                          <div className="text-[10px] text-slate-400 flex items-center space-x-1 mt-0.5">
                            <Wifi className="w-2.5 h-2.5 text-sky-400 shrink-0" />
                            <span className="truncate max-w-[170px]">{exp.isp}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-block px-2.5 py-1 bg-amber-500/20 text-amber-400 font-bold rounded-lg text-xs">
                          {exp.totalIngresos} {exp.totalIngresos === 1 ? 'vez' : 'veces'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">
                        {exp.ultimoIngreso}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {exp.tieneFotos ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            ✓ Con Fotos
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            Pendiente Fotos
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* CONTENIDO 3: Expendios pendientes por ingresar */}
        {subTab === 'pendientes' && (
          <div className="space-y-4">
            <div className="p-3 bg-rose-950/40 border border-rose-800/50 rounded-xl text-xs text-rose-300 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>
                  Hay <strong>{expendiosPendientesFiltrados.length} expendios</strong> que aún no han
                  iniciado sesión en el sistema ni han cargado sus fotos fotográficas.
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              {expendiosPendientesFiltrados.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">
                  ¡Excelente! Todos los expendios registrados ya han ingresado a la aplicación.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px] font-semibold bg-slate-800/40">
                      <th className="py-3 px-3">Municipio</th>
                      <th className="py-3 px-3">Encargado</th>
                      <th className="py-3 px-3">Cédula</th>
                      <th className="py-3 px-3">Teléfono / Celular</th>
                      <th className="py-3 px-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {expendiosPendientesFiltrados.map((exp) => {
                      const cleanPhone = (exp.telefonoPunto || '').replace(/[^0-9]/g, '');
                      const waUrl =
                        cleanPhone.length >= 10
                          ? `https://wa.me/57${cleanPhone}?text=${encodeURIComponent(
                              `Hola ${exp.encargado}, te saludamos de CAMARCA SAS. Recuerda ingresar a la plataforma con tu cédula ${exp.cedula} para registrar la información de tu expendio en ${exp.municipio}.`
                            )}`
                          : null;

                      return (
                        <tr key={exp.cedula} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 px-3 font-bold text-rose-300">{exp.municipio}</td>
                          <td className="py-3 px-3 font-semibold text-slate-100">{exp.encargado}</td>
                          <td className="py-3 px-3 font-mono text-slate-300">{exp.cedula}</td>
                          <td className="py-3 px-3 text-slate-300">
                            {exp.telefonoPunto || (
                              <span className="text-slate-500 italic">Sin teléfono</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            {waUrl ? (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center space-x-1 text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-1 px-2.5 rounded-lg transition-colors"
                              >
                                <Phone className="w-3 h-3" />
                                <span>Recordar WhatsApp</span>
                              </a>
                            ) : (
                              <span className="text-slate-500 text-[11px]">Sin WhatsApp</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal de Reinicio de Métricas con Contraseña Maestra */}
      {modalLimpiar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-100 text-base">Reiniciar Registro de Métricas</h4>
                <p className="text-xs text-slate-400">Acción protegida para Administrador</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Esta acción pondrá en cero el contador de ingresos y el registro de accesos. Para
              confirmar, ingresa la contraseña autorizada:
            </p>

            <form onSubmit={handleConfirmarLimpiar} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Contraseña Maestra (Camarca.2023*)
                </label>
                <input
                  type="password"
                  value={passwordLimpiar}
                  onChange={(e) => setPasswordLimpiar(e.target.value)}
                  placeholder="Ingresa la contraseña..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                  autoFocus
                />
              </div>

              {errorLimpiar && (
                <div className="p-2.5 bg-rose-950/80 border border-rose-800/80 text-rose-300 rounded-xl text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorLimpiar}</span>
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalLimpiar(false);
                    setPasswordLimpiar('');
                    setErrorLimpiar('');
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={procesandoLimpiar}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl cursor-pointer shadow-lg disabled:opacity-50"
                >
                  {procesandoLimpiar ? 'Reiniciando...' : 'Confirmar y Reiniciar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
