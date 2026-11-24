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
  FileSpreadsheet,
} from 'lucide-react';
import { MetricasAccesoResumen, RegistroAcceso, ResumenExpendioAcceso, UsuarioActivoEnLinea } from '../types';
import { downloadAuthenticatedFile } from '../utils/downloadHelper';

interface AdminMetricasViewProps {
  onGoToExpendios?: () => void;
}

export const AdminMetricasView: React.FC<AdminMetricasViewProps> = ({ onGoToExpendios }) => {
  const [metricas, setMetricas] = useState<MetricasAccesoResumen | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filtroRol, setFiltroRol] = useState<string>('todos');
  const [subTab, setSubTab] = useState<'activos' | 'ultimos' | 'ingresaron' | 'pendientes'>('activos');
  const [modalLimpiar, setModalLimpiar] = useState<boolean>(false);
  const [passwordLimpiar, setPasswordLimpiar] = useState<string>('');
  const [errorLimpiar, setErrorLimpiar] = useState<string>('');
  const [procesandoLimpiar, setProcesandoLimpiar] = useState<boolean>(false);

  // Estado para el asistente de envío masivo de WhatsApp a pendientes
  const [modalMasivoWA, setModalMasivoWA] = useState<boolean>(false);
  const [modoMasivoWA, setModoMasivoWA] = useState<'sin_ingreso' | 'sin_actualizar'>('sin_ingreso');
  const [indiceActualWA, setIndiceActualWA] = useState<number>(0);
  const [copiadoExito, setCopiadoExito] = useState<boolean>(false);
  const [enviadosWA, setEnviadosWA] = useState<Record<string, boolean>>(() => {
    try {
      const todayKey = `camarca_wa_enviados_${new Date().toISOString().split('T')[0]}`;
      const saved = localStorage.getItem(todayKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const marcarComoEnviadoWA = (cedula: string) => {
    setEnviadosWA((prev) => {
      const next = { ...prev, [cedula]: true };
      try {
        const todayKey = `camarca_wa_enviados_${new Date().toISOString().split('T')[0]}`;
        localStorage.setItem(todayKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const limpiarEnviadosWA = () => {
    setEnviadosWA({});
    setIndiceActualWA(0);
    try {
      const todayKey = `camarca_wa_enviados_${new Date().toISOString().split('T')[0]}`;
      localStorage.removeItem(todayKey);
    } catch {}
  };

  const construirMensajeWhatsApp = (exp: { encargado?: string; cedula?: string; municipio?: string }) =>
    `Hola ${exp.encargado}, te saludamos de CAMARCA SAS. Recuerda ingresar a la plataforma con tu cédula ${exp.cedula} para registrar la información de tu expendio en ${exp.municipio}\n\ningresa a traves de https://expendios-camarca.ai.studio/`;

  const construirUrlWhatsApp = (exp: { encargado?: string; cedula?: string; municipio?: string; telefonoPunto?: string }) => {
    const cleanPhone = (exp.telefonoPunto || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) return null;
    const phoneTen = cleanPhone.length > 10 && cleanPhone.startsWith('57') ? cleanPhone.slice(2) : cleanPhone;
    return `https://wa.me/57${phoneTen}?text=${encodeURIComponent(construirMensajeWhatsApp(exp))}`;
  };

  const fetchMetricas = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/admin/metrics/accesos');
      const data = await res.json();
      if (data.success && data.data) {
        setMetricas(data.data);
      }
    } catch (err) {
      console.error('Error cargando métricas de acceso:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetricas(false);
    // Auto-actualizar métricas en tiempo real cada 6 segundos
    const timer = setInterval(() => {
      fetchMetricas(true);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const handleExportarCSV = async () => {
    await downloadAuthenticatedFile('/api/admin/metrics/exportar-csv', `Reporte_Accesos_CAMARCA_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const anioEnCursoActual = Math.max(2026, new Date().getFullYear());
  const [informeAnio, setInformeAnio] = useState<string>(String(anioEnCursoActual));
  const [informeMes, setInformeMes] = useState<string>('TODOS');
  const [informeCentroOp, setInformeCentroOp] = useState<string>('TODOS');
  const [showInformeSelector, setShowInformeSelector] = useState<boolean>(false);

  const handleDescargarInformeExcel = async () => {
    const endpoint = `/api/admin/export-informe-consolidado-excel?anio=${encodeURIComponent(informeAnio)}&mes=${encodeURIComponent(informeMes)}&centroOperativo=${encodeURIComponent(informeCentroOp)}`;
    const filename = `Informe_Consolidado_Expendios_${informeAnio}_${informeMes}_${informeCentroOp}.xlsx`;
    await downloadAuthenticatedFile(endpoint, filename);
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: passwordLimpiar.trim() }),
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

  // Filtrado de usuarios activos en línea
  const usuariosEnLineaFiltrados = (metricas?.listaUsuariosEnLinea || []).filter(
    (u: UsuarioActivoEnLinea) => {
      if (filtroRol !== 'todos' && u.rol !== filtroRol) return false;
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        (u.usuario || '').toLowerCase().includes(term) ||
        (u.cedula || '').includes(term) ||
        (u.municipio || '').toLowerCase().includes(term) ||
        (u.ip || '').includes(term) ||
        (u.dispositivo || '').toLowerCase().includes(term) ||
        (u.path || '').toLowerCase().includes(term)
      );
    }
  );

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
            type="button"
            onClick={() => {
              setSubTab('pendientes');
              setIndiceActualWA(0);
              setModalMasivoWA(true);
            }}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl flex items-center space-x-2 cursor-pointer transition-colors shadow-lg border border-emerald-500/40"
            title="Abrir asistente para enviar recordatorio por WhatsApp a todos los expendios pendientes por ingresar y actualizar datos"
          >
            <Phone className="w-4 h-4 text-white" />
            <span>
              Enviar Mensaje a Pendientes ({metricas?.expendiosPendientesPorIngresar.length ?? 0})
            </span>
          </button>

          <button
            onClick={() => fetchMetricas()}
            disabled={loading}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2.5 px-4 rounded-xl border border-slate-700 flex items-center space-x-2 cursor-pointer transition-colors shadow"
          >
            <RefreshCw className={`w-4 h-4 text-amber-400 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar Métricas</span>
          </button>

          <div className="flex items-center bg-sky-500/15 border border-sky-500/40 rounded-xl p-0.5 shadow-lg">
            <button
              type="button"
              onClick={handleDescargarInformeExcel}
              className="bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold py-2 px-3.5 rounded-lg flex items-center space-x-1.5 cursor-pointer transition-colors"
              title={`Descargar Informe Consolidado en Excel (.xlsx): Municipio, Contratista, Cédula, Celular, Dirección, Última Actualización, Estado Fotos (7/7, 3/4, etc.) y Valor de Pagos (${informeAnio === 'COMPARAR_2026_2027' ? '2026 vs 2027' : informeAnio})`}
            >
              <FileSpreadsheet className="w-4 h-4 text-slate-950" />
              <span>
                Descargar Informe Excel (
                {informeAnio === 'COMPARAR_2026_2027'
                  ? '2026 vs 2027'
                  : `${informeMes !== 'TODOS' ? informeMes.slice(0, 3) + ' ' : ''}${informeAnio}`}
                {informeCentroOp !== 'TODOS' ? ` • ${informeCentroOp}` : ''})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowInformeSelector((prev) => !prev)}
              className={`px-2.5 py-2 rounded-lg text-xs font-bold flex items-center space-x-1 transition-colors cursor-pointer ml-0.5 ${
                showInformeSelector
                  ? 'bg-sky-400 text-slate-950'
                  : 'text-sky-300 hover:bg-sky-500/20 hover:text-white'
              }`}
              title="Elegir Año (2026 / 2027 / Comparar), Mes o Centro Operativo"
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Año / Mes / C.Op</span>
            </button>
          </div>

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

      {/* Selector Desplegable para el Informe Consolidado en Excel */}
      {showInformeSelector && (
        <div className="bg-slate-900 border border-sky-500/40 rounded-2xl p-4 shadow-xl space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <FileSpreadsheet className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-extrabold text-sky-300 uppercase tracking-wider">
                Configurar Informe Consolidado de Excel (Año, Mes, Centro Operativo y Comparativo 2026 vs 2027)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowInformeSelector(false)}
              className="text-slate-400 hover:text-slate-200 text-xs font-bold cursor-pointer"
            >
              Cerrar ✕
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                1. Año o Comparativo:
              </label>
              <select
                value={informeAnio}
                onChange={(e) => setInformeAnio(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-sky-400 rounded-xl px-3 py-2 text-xs text-slate-100 font-bold cursor-pointer"
              >
                <option value="2026">Año 2026 (Vigencia 2026)</option>
                <option value="2027">Año 2027 (Vigencia 2027)</option>
                <option value="COMPARAR_2026_2027">📊 Comparar Años (2026 vs 2027)</option>
                <option value="2028">Año 2028</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                2. Mes de Consulta:
              </label>
              <select
                value={informeMes}
                onChange={(e) => setInformeMes(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-sky-400 rounded-xl px-3 py-2 text-xs text-slate-100 font-bold cursor-pointer"
              >
                <option value="TODOS">Todos los Meses (Consolidado Anual)</option>
                {[
                  'ENERO',
                  'FEBRERO',
                  'MARZO',
                  'ABRIL',
                  'MAYO',
                  'JUNIO',
                  'JULIO',
                  'AGOSTO',
                  'SEPTIEMBRE',
                  'OCTUBRE',
                  'NOVIEMBRE',
                  'DICIEMBRE',
                ].map((m) => (
                  <option key={m} value={m}>
                    Solo {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                3. Filtrar por Centro Operativo:
              </label>
              <select
                value={informeCentroOp}
                onChange={(e) => setInformeCentroOp(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-sky-400 rounded-xl px-3 py-2 text-xs text-slate-100 font-bold cursor-pointer"
              >
                <option value="TODOS">Todos los Centros Operativos</option>
                <option value="PO.ARAUCA">PO.ARAUCA</option>
                <option value="PO.BUCARAMANGA">PO.BUCARAMANGA</option>
                <option value="PO.CUCUTA">PO.CUCUTA</option>
                <option value="PO.ORIENTE">PO.ORIENTE</option>
                <option value="PO.TUNJA">PO.TUNJA</option>
                <option value="PO.VALLEDUPAR">PO.VALLEDUPAR</option>
              </select>
            </div>

            <div>
              <button
                type="button"
                onClick={handleDescargarInformeExcel}
                className="w-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-black py-2 px-4 rounded-xl text-xs flex items-center justify-center space-x-1.5 shadow-lg cursor-pointer transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Descargar Informe Filtrado</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tarjetas KPI de Métricas Principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* KPI Live: Usuarios Activos en el Enlace */}
        <div
          onClick={() => setSubTab('activos')}
          className="bg-emerald-950/40 border border-emerald-500/50 p-5 rounded-2xl shadow-xl relative overflow-hidden cursor-pointer hover:border-emerald-400 transition-all group"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center space-x-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
              </span>
              <span>Activos en Línea</span>
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300">
              <Globe className="w-5 h-5 animate-pulse" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-emerald-400">
              {metricas?.usuariosEnLineaCount ?? 0}
            </span>
            <span className="text-xs font-bold text-emerald-300">navegando ahora</span>
          </div>
          <p className="mt-2 text-[11px] text-emerald-200/80 flex items-center justify-between">
            <span>Expendios: <strong>{metricas?.desgloseEnLinea?.expendio ?? 0}</strong> • Admins: <strong>{metricas?.desgloseEnLinea?.admin ?? 0}</strong></span>
            <span className="text-emerald-400 font-bold group-hover:underline">Ver →</span>
          </p>
        </div>

        {/* KPI 1: Personas Únicas */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Personas Registradas
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
              Total Ingresos
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
              Cobertura
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
              de {metricas?.expendiosRegistradosTotales ?? 0}
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
            cobertura expendios
          </p>
        </div>

        {/* KPI 4: Expendios Pendientes */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Pendientes
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
            Pendientes por ingresar a la plataforma
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
          <div className="flex flex-wrap items-center gap-2 bg-slate-800/80 p-1 rounded-xl">
            <button
              onClick={() => setSubTab('activos')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                subTab === 'activos'
                  ? 'bg-emerald-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
              </span>
              <span>En Línea Ahora ({metricas?.usuariosEnLineaCount ?? 0})</span>
            </button>

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
            {(subTab === 'ultimos' || subTab === 'activos') && (
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

        {/* CONTENIDO 0: Usuarios Activos en el Enlace (En Línea Ahora) */}
        {subTab === 'activos' && (
          <div className="overflow-x-auto space-y-3 animate-fadeIn">
            <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-xs text-emerald-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
                </span>
                <span>
                  <strong>Monitoreo en Tiempo Real:</strong> Usuarios navegando en el enlace en los últimos 90 segundos. Se actualiza cada 6s.
                </span>
              </div>
              <span className="font-extrabold text-emerald-400 whitespace-nowrap">
                🟢 {usuariosEnLineaFiltrados.length} usuario(s) activo(s) en línea
              </span>
            </div>

            {usuariosEnLineaFiltrados.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs bg-slate-800/20 rounded-xl border border-slate-800">
                No hay usuarios navegando activamente en este instante (o no coinciden con la búsqueda).
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px] font-semibold bg-slate-800/40">
                    <th className="py-3 px-3">Estado</th>
                    <th className="py-3 px-3">Usuario / Encargado</th>
                    <th className="py-3 px-3">Rol</th>
                    <th className="py-3 px-3">Municipio / Punto</th>
                    <th className="py-3 px-3">Ruta Activa</th>
                    <th className="py-3 px-3">Dirección IP</th>
                    <th className="py-3 px-3">Dispositivo</th>
                    <th className="py-3 px-3">Último Pulso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {usuariosEnLineaFiltrados.map((item, idx) => (
                    <tr key={`${item.key || 'act'}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
                          En línea
                        </span>
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-100">
                        {item.usuario}
                        <div className="text-[10px] text-slate-400 font-mono">CC: {item.cedula}</div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.rol === 'admin'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : item.rol === 'expendio'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          {item.rol?.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-200 font-medium">
                        {item.municipio || 'N/A'}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-amber-400 font-semibold">
                        {item.path || '/'}
                      </td>
                      <td className="py-3 px-3 font-mono text-emerald-400 text-[11px]">
                        {item.ip || '127.0.0.1'}
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
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                        Hace {item.haceCuantoSegundos} seg
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

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
                  {accesosFiltrados.map((item, idx) => (
                    <tr key={`${item.id || 'acc'}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
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
                  {expendiosIngresaronFiltrados.map((exp, idx) => (
                    <tr key={`${exp.cedula || 'exp'}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
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
            <div className="p-3.5 bg-rose-950/40 border border-rose-800/50 rounded-xl text-xs text-rose-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>
                  Hay <strong>{expendiosPendientesFiltrados.length} expendios</strong> que aún no han
                  iniciado sesión en el sistema ni han cargado sus fotos fotográficas.
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {Object.keys(enviadosWA).length > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-[11px]">
                    ✓ {Object.keys(enviadosWA).length} recordatorios enviados hoy
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIndiceActualWA(0);
                    setModalMasivoWA(true);
                  }}
                  className="inline-flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow-lg transition-colors cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Enviar Mensaje a Todos los Pendientes ({expendiosPendientesFiltrados.length})</span>
                </button>
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
                    {expendiosPendientesFiltrados.map((exp, idx) => {
                      const waUrl = construirUrlWhatsApp(exp);
                      const yaEnviado = Boolean(enviadosWA[exp.cedula]);

                      return (
                        <tr
                          key={`${exp.cedula || 'pend'}-${idx}`}
                          className={`hover:bg-slate-800/30 transition-colors ${yaEnviado ? 'bg-emerald-950/15' : ''}`}
                        >
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
                                onClick={() => marcarComoEnviadoWA(exp.cedula)}
                                className={`inline-flex items-center space-x-1 text-[11px] font-bold py-1 px-2.5 rounded-lg transition-colors ${
                                  yaEnviado
                                    ? 'bg-slate-800 hover:bg-emerald-700 text-emerald-400 hover:text-white border border-emerald-600/40'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                }`}
                              >
                                <Phone className="w-3 h-3" />
                                <span>{yaEnviado ? '✓ Enviado (Reenviar)' : 'Recordar WhatsApp'}</span>
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

      {/* Modal Asistente de Envío Masivo / Secuencial por WhatsApp a Pendientes */}
      {modalMasivoWA && (() => {
        const pendientesIngreso = metricas?.expendiosPendientesPorIngresar || [];
        const ingresaronSinFotos = (metricas?.expendiosQueHanIngresado || [])
          .filter((e) => !e.tieneFotos)
          .map((e) => ({
            cedula: e.cedula,
            encargado: e.encargado,
            municipio: e.municipio,
            telefonoPunto: e.telefonoPunto,
          }));

        const listaBase =
          modoMasivoWA === 'sin_ingreso'
            ? pendientesIngreso
            : [...pendientesIngreso, ...ingresaronSinFotos];

        const listaConTelefono = listaBase.filter((e) => Boolean(construirUrlWhatsApp(e)));
        const totalEnviadosEnLista = listaConTelefono.filter((e) => enviadosWA[e.cedula]).length;
        const idxSeguro = Math.min(Math.max(0, indiceActualWA), Math.max(0, listaConTelefono.length - 1));
        const actualExp = listaConTelefono[idxSeguro] || null;
        const actualWaUrl = actualExp ? construirUrlWhatsApp(actualExp) : null;

        const avanzarSiguientePendiente = (actualCedula?: string) => {
          if (actualCedula) {
            marcarComoEnviadoWA(actualCedula);
          }
          // Buscar el siguiente que no haya sido enviado aún
          for (let offset = 1; offset <= listaConTelefono.length; offset++) {
            const candidateIdx = (idxSeguro + offset) % listaConTelefono.length;
            const candidate = listaConTelefono[candidateIdx];
            if (candidate && candidate.cedula !== actualCedula && !enviadosWA[candidate.cedula]) {
              setIndiceActualWA(candidateIdx);
              return;
            }
          }
          if (idxSeguro + 1 < listaConTelefono.length) {
            setIndiceActualWA(idxSeguro + 1);
          }
        };

        const handleCopiarTodos = async () => {
          const texto = listaConTelefono
            .map(
              (e, i) =>
                `${i + 1}. ${e.municipio} - ${e.encargado} (CC: ${e.cedula}) - Tel: ${e.telefonoPunto}\nMensaje:\n${construirMensajeWhatsApp(e)}\nEnlace directo: ${construirUrlWhatsApp(e)}`
            )
            .join('\n\n----------------------------------------\n\n');
          try {
            await navigator.clipboard.writeText(texto);
            setCopiadoExito(true);
            setTimeout(() => setCopiadoExito(false), 3000);
          } catch {}
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] flex flex-col">
              {/* Cabecera */}
              <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-100 text-lg">
                      Envío Rápido de Mensajes a Expendios Pendientes
                    </h4>
                    <p className="text-xs text-slate-400">
                      Envía el recordatorio oficial con el enlace de la aplicación de forma continua con 1 clic por expendio.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalMasivoWA(false)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
                >
                  Cerrar ✕
                </button>
              </div>

              {/* Selector de Grupo y Progreso */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setModoMasivoWA('sin_ingreso');
                      setIndiceActualWA(0);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      modoMasivoWA === 'sin_ingreso'
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Sin Ingresar ({pendientesIngreso.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setModoMasivoWA('sin_actualizar');
                      setIndiceActualWA(0);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      modoMasivoWA === 'sin_actualizar'
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Sin Ingresar + Sin Actualizar Fotos ({pendientesIngreso.length + ingresaronSinFotos.length})
                  </button>
                </div>

                <div className="flex items-center space-x-3 text-xs">
                  <span className="font-bold text-emerald-400">
                    Enviados hoy: {totalEnviadosEnLista} de {listaConTelefono.length}
                  </span>
                  {totalEnviadosEnLista > 0 && (
                    <button
                      type="button"
                      onClick={limpiarEnviadosWA}
                      className="text-[11px] text-slate-400 hover:text-rose-400 underline cursor-pointer"
                    >
                      Reiniciar conteo
                    </button>
                  )}
                </div>
              </div>

              {/* Tarjeta Principal de Envío 1-Clic (Siguiente Automático) */}
              {actualExp && actualWaUrl ? (
                <div className="bg-slate-800/70 border border-emerald-500/40 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Expendio #{idxSeguro + 1} de {listaConTelefono.length}
                      </span>
                      <h5 className="text-base font-extrabold text-white mt-1">
                        {actualExp.municipio} — <span className="text-amber-400">{actualExp.encargado}</span>
                      </h5>
                      <p className="text-xs text-slate-300 font-mono">
                        Cédula: <strong>{actualExp.cedula}</strong> • WhatsApp: <strong>{actualExp.telefonoPunto}</strong>
                      </p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        disabled={idxSeguro === 0}
                        onClick={() => setIndiceActualWA(Math.max(0, idxSeguro - 1))}
                        className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        ← Anterior
                      </button>
                      <button
                        type="button"
                        onClick={() => avanzarSiguientePendiente()}
                        className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Saltar →
                      </button>
                    </div>
                  </div>

                  {/* Vista previa del mensaje exacto */}
                  <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono whitespace-pre-line leading-relaxed">
                    {construirMensajeWhatsApp(actualExp)}
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
                    <a
                      href={actualWaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => avanzarSiguientePendiente(actualExp.cedula)}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm py-3 px-5 rounded-xl shadow-lg flex items-center justify-center space-x-2 transition-all cursor-pointer"
                    >
                      <Phone className="w-4 h-4" />
                      <span>
                        Enviar WhatsApp a {actualExp.municipio} y Pasar al Siguiente ({idxSeguro + 1}/{listaConTelefono.length})
                      </span>
                    </a>

                    <button
                      type="button"
                      onClick={handleCopiarTodos}
                      className="px-4 py-3 bg-slate-900 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-colors whitespace-nowrap"
                    >
                      {copiadoExito ? '✓ ¡Lista Copiada!' : 'Copiar Todos los Mensajes'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-slate-400 text-xs bg-slate-800/40 rounded-xl">
                  No hay expendios pendientes con número de teléfono válido en esta categoría.
                </div>
              )}

              {/* Lista completa desplazable para envío directo o selección */}
              <div className="flex-1 overflow-y-auto border border-slate-800 rounded-xl divide-y divide-slate-800/70 bg-slate-950/50 max-h-60">
                {listaConTelefono.map((item, i) => {
                  const url = construirUrlWhatsApp(item);
                  const enviado = Boolean(enviadosWA[item.cedula]);
                  const esActual = i === idxSeguro;
                  return (
                    <div
                      key={`${item.cedula}-${i}`}
                      onClick={() => setIndiceActualWA(i)}
                      className={`px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors ${
                        esActual
                          ? 'bg-emerald-950/40 border-l-4 border-l-emerald-400'
                          : enviado
                          ? 'bg-slate-900/40 opacity-75'
                          : 'hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="truncate">
                        <span className="font-mono text-slate-500 mr-2">#{i + 1}</span>
                        <span className="font-bold text-rose-300">{item.municipio}</span>
                        <span className="text-slate-300 mx-1.5">•</span>
                        <span className="font-semibold text-slate-100">{item.encargado}</span>
                        <span className="text-slate-400 font-mono ml-2">(CC: {item.cedula} - Tel: {item.telefonoPunto})</span>
                      </div>

                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setIndiceActualWA(i);
                            avanzarSiguientePendiente(item.cedula);
                          }}
                          className={`px-2.5 py-1 rounded-lg font-bold text-[11px] shrink-0 transition-colors ${
                            enviado
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-700/50'
                              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          }`}
                        >
                          {enviado ? '✓ Enviado' : 'Enviar WA'}
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

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
                  Contraseña Maestra de Seguridad
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
