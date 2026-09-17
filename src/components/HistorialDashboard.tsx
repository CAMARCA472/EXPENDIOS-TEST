import React, { useMemo } from 'react';
import { HistorialItem, CuentaCobroResult } from '../types';
import { formatPesos, formatNumberWithDots } from '../utils/formatters';
import { 
  TrendingUp, 
  DollarSign, 
  FileText, 
  Percent, 
  Building2, 
  MapPin, 
  PieChart, 
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  BarChart3
} from 'lucide-react';

interface HistorialDashboardProps {
  historialItems: HistorialItem[];
  totalHistorialCount: number;
  filtroMes: string;
  filtroAnio: string;
  filtroTipo: string;
  filtroSearch: string;
  getCuentaFromItem: (item: HistorialItem) => CuentaCobroResult;
}

const MESES_NOMBRES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

export const HistorialDashboard: React.FC<HistorialDashboardProps> = ({
  historialItems,
  totalHistorialCount,
  filtroMes,
  filtroAnio,
  filtroTipo,
  filtroSearch,
  getCuentaFromItem,
}) => {
  const [expanded, setExpanded] = React.useState<boolean>(true);
  const [activeView, setActiveView] = React.useState<'resumen' | 'meses' | 'operativos'>('resumen');

  // Compute comprehensive analytics for the currently filtered items
  const stats = useMemo(() => {
    let totalNeto = 0;
    let totalCargoBasico = 0;
    let totalAdmisionSipost = 0;
    let totalValorVariable = 0;
    let totalRetefuente = 0;
    let totalPagoBruto = 0;

    const porMes: Record<string, { totalNeto: number; count: number; basico: number; variable: number; retencion: number }> = {};
    const porOperativo: Record<string, { totalNeto: number; count: number }> = {};
    const porMunicipio: Record<string, { totalNeto: number; count: number }> = {};

    // Filtrar estrictamente cuentas de cobro reales para la contabilidad (excluir actualizaciones de perfil)
    const cuentasContables = historialItems.filter((item) => {
      const tipo = (item.tipo || '').trim();
      return (
        tipo !== 'Actualización' &&
        tipo !== 'Actualización Maestro' &&
        tipo !== 'Cuenta de Cobro Firmada' &&
        tipo !== 'Actualización de Perfil'
      );
    });

    cuentasContables.forEach((item) => {
      const c = getCuentaFromItem(item);
      const basico = Number(c.cargoBasico ?? c.valorBase ?? item.monto) || 0;
      const sipost = Number(c.admisionSipost) || 0;
      const variable = Number(c.valorVariable) || 0;
      const bruto = basico + sipost + variable;
      const isGrossUp = !!c.grossUpAplicado;
      const pRet = Number(c.porcentajeRetencion) || 1;
      const rete = isGrossUp ? 0 : Number(c.retef1 ?? c.retencionValor ?? Math.round(bruto * (pRet / 100))) || 0;
      const neto = isGrossUp ? bruto : Number(c.valorNeto ?? (bruto - rete)) || Number(item.monto) || 0;

      totalNeto += neto;
      totalCargoBasico += basico;
      totalAdmisionSipost += sipost;
      totalValorVariable += variable;
      totalRetefuente += rete;
      totalPagoBruto += bruto;

      // Mes aggregation
      const rawPeriodo = (c.periodo || item.periodo || '').toUpperCase();
      let detectedMes = 'SIN MES';
      for (const m of MESES_NOMBRES) {
        if (rawPeriodo.includes(m)) {
          detectedMes = m;
          break;
        }
      }
      if (!porMes[detectedMes]) {
        porMes[detectedMes] = { totalNeto: 0, count: 0, basico: 0, variable: 0, retencion: 0 };
      }
      porMes[detectedMes].totalNeto += neto;
      porMes[detectedMes].count += 1;
      porMes[detectedMes].basico += basico;
      porMes[detectedMes].variable += variable + sipost;
      porMes[detectedMes].retencion += rete;

      // Centro Operativo aggregation
      const op = (c.centroOperativo || 'PO.ARAUCA').toUpperCase().trim();
      if (!porOperativo[op]) {
        porOperativo[op] = { totalNeto: 0, count: 0 };
      }
      porOperativo[op].totalNeto += neto;
      porOperativo[op].count += 1;

      // Municipio aggregation
      const mun = (c.municipio || item.expendio || 'SIN MUNICIPIO').toUpperCase().trim();
      if (!porMunicipio[mun]) {
        porMunicipio[mun] = { totalNeto: 0, count: 0 };
      }
      porMunicipio[mun].totalNeto += neto;
      porMunicipio[mun].count += 1;
    });

    const count = historialItems.length;
    const promedioNeto = count > 0 ? Math.round(totalNeto / count) : 0;

    const basicoPct = totalPagoBruto > 0 ? Math.round((totalCargoBasico / totalPagoBruto) * 100) : 0;
    const sipostPct = totalPagoBruto > 0 ? Math.round((totalAdmisionSipost / totalPagoBruto) * 100) : 0;
    const variablePct = totalPagoBruto > 0 ? Math.round((totalValorVariable / totalPagoBruto) * 100) : 0;
    const retePct = totalPagoBruto > 0 ? Math.round((totalRetefuente / totalPagoBruto) * 100) : 0;

    const topMunicipios = Object.entries(porMunicipio)
      .map(([municipio, data]) => ({ municipio, ...data }))
      .sort((a, b) => b.totalNeto - a.totalNeto)
      .slice(0, 5);

    const operativosList = Object.entries(porOperativo)
      .map(([operativo, data]) => ({ operativo, ...data }))
      .sort((a, b) => b.totalNeto - a.totalNeto);

    const mesesList = Object.entries(porMes)
      .map(([mes, data]) => ({ mes, ...data }))
      .sort((a, b) => {
        const idxA = MESES_NOMBRES.indexOf(a.mes);
        const idxB = MESES_NOMBRES.indexOf(b.mes);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        return a.mes.localeCompare(b.mes);
      });

    return {
      count,
      totalNeto,
      totalCargoBasico,
      totalAdmisionSipost,
      totalValorVariable,
      totalRetefuente,
      totalPagoBruto,
      promedioNeto,
      basicoPct,
      sipostPct,
      variablePct,
      retePct,
      topMunicipios,
      operativosList,
      mesesList,
    };
  }, [historialItems, getCuentaFromItem]);

  const periodoContexto = useMemo(() => {
    if (filtroMes && filtroAnio) return `${filtroMes} ${filtroAnio}`;
    if (filtroMes) return `Mes de ${filtroMes} (Todos los años)`;
    if (filtroAnio) return `Año ${filtroAnio} (Todos los meses)`;
    return 'Historial Consolidado (Todos los Periodos)';
  }, [filtroMes, filtroAnio]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      {/* Header with Title and Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm sm:text-base font-bold text-slate-100">
                Dashboard Analítico de Pagos & Cobros
              </h3>
              <span className="bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {periodoContexto}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Métricas financieras consolidadas, distribución de rubros y análisis por periodo y centro operativo.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-end sm:self-center">
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center space-x-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveView('resumen')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeView === 'resumen'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Resumen
            </button>
            <button
              type="button"
              onClick={() => setActiveView('meses')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeView === 'meses'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Meses ({stats.mesesList.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveView('operativos')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeView === 'operativos'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Operativos
            </button>
          </div>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors cursor-pointer border border-slate-700"
            title={expanded ? 'Minimizar Dashboard' : 'Expandir Dashboard'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 animate-fadeIn">
          {/* Main KPI Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Total Neto */}
            <div className="bg-slate-950/80 border border-emerald-500/30 p-3 rounded-xl space-y-1">
              <div className="flex items-center justify-between text-slate-400 text-[10px] font-semibold">
                <span>TOTAL NETO A PAGAR</span>
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="text-base sm:text-lg font-extrabold text-emerald-400 font-mono truncate">
                {formatPesos(stats.totalNeto)}
              </div>
              <div className="text-[10px] text-slate-400">
                {stats.count} cuenta(s) en selección
              </div>
            </div>

            {/* Total Cargo Básico */}
            <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-xl space-y-1">
              <div className="flex items-center justify-between text-slate-400 text-[10px] font-semibold">
                <span>CARGO BÁSICO</span>
                <Building2 className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-sm sm:text-base font-bold text-slate-100 font-mono truncate">
                {formatPesos(stats.totalCargoBasico)}
              </div>
              <div className="text-[10px] text-amber-400/80">
                {stats.basicoPct}% del pago total
              </div>
            </div>

            {/* Admisión SIPOST */}
            <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-xl space-y-1">
              <div className="flex items-center justify-between text-slate-400 text-[10px] font-semibold">
                <span>ADMISIÓN SIPOST</span>
                <Layers className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <div className="text-sm sm:text-base font-bold text-slate-100 font-mono truncate">
                {formatPesos(stats.totalAdmisionSipost)}
              </div>
              <div className="text-[10px] text-sky-400/80">
                {stats.sipostPct}% del pago total
              </div>
            </div>

            {/* Variable / Listas */}
            <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-xl space-y-1">
              <div className="flex items-center justify-between text-slate-400 text-[10px] font-semibold">
                <span>TOTAL VARIABLE</span>
                <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div className="text-sm sm:text-base font-bold text-slate-100 font-mono truncate">
                {formatPesos(stats.totalValorVariable)}
              </div>
              <div className="text-[10px] text-indigo-400/80">
                {stats.variablePct}% del pago total
              </div>
            </div>

            {/* Retención en la Fuente */}
            <div className="bg-slate-950/80 border border-red-500/20 p-3 rounded-xl space-y-1">
              <div className="flex items-center justify-between text-slate-400 text-[10px] font-semibold">
                <span>RETEFUENTE 1%</span>
                <Percent className="w-3.5 h-3.5 text-red-400" />
              </div>
              <div className="text-sm sm:text-base font-bold text-red-400 font-mono truncate">
                -{formatPesos(stats.totalRetefuente)}
              </div>
              <div className="text-[10px] text-red-400/80">
                Retención fiscal deducida
              </div>
            </div>

            {/* Promedio por Cuenta */}
            <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-xl space-y-1">
              <div className="flex items-center justify-between text-slate-400 text-[10px] font-semibold">
                <span>PROMEDIO NETO</span>
                <PieChart className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-sm sm:text-base font-bold text-amber-300 font-mono truncate">
                {formatPesos(stats.promedioNeto)}
              </div>
              <div className="text-[10px] text-slate-400">
                Por cuenta liquidada
              </div>
            </div>
          </div>

          {/* Sub-view: Resumen & Concept Bar */}
          {activeView === 'resumen' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Concept distribution progress bar */}
              <div className="lg:col-span-7 bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">Composición Financiera de la Liquidación</span>
                  <span className="font-mono text-slate-400 text-[11px]">
                    Bruto: {formatPesos(stats.totalPagoBruto)}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden flex">
                  <div
                    style={{ width: `${Math.max(stats.basicoPct, 2)}%` }}
                    className="bg-amber-500 h-full transition-all"
                    title={`Básico: ${formatPesos(stats.totalCargoBasico)} (${stats.basicoPct}%)`}
                  />
                  <div
                    style={{ width: `${Math.max(stats.sipostPct, 0)}%` }}
                    className="bg-sky-500 h-full transition-all"
                    title={`SIPOST: ${formatPesos(stats.totalAdmisionSipost)} (${stats.sipostPct}%)`}
                  />
                  <div
                    style={{ width: `${Math.max(stats.variablePct, 0)}%` }}
                    className="bg-indigo-500 h-full transition-all"
                    title={`Variable: ${formatPesos(stats.totalValorVariable)} (${stats.variablePct}%)`}
                  />
                </div>

                {/* Legend */}
                <div className="grid grid-cols-3 gap-2 text-[11px] pt-1">
                  <div className="flex items-center space-x-1.5 text-slate-300">
                    <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 shrink-0" />
                    <span>Básico ({stats.basicoPct}%)</span>
                  </div>
                  <div className="flex items-center space-x-1.5 text-slate-300">
                    <span className="w-2.5 h-2.5 rounded-sm bg-sky-500 shrink-0" />
                    <span>SIPOST ({stats.sipostPct}%)</span>
                  </div>
                  <div className="flex items-center space-x-1.5 text-slate-300">
                    <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 shrink-0" />
                    <span>Variable ({stats.variablePct}%)</span>
                  </div>
                </div>
              </div>

              {/* Top Municipios / Expendios */}
              <div className="lg:col-span-5 bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200 flex items-center space-x-1.5">
                    <MapPin className="w-3.5 h-3.5 text-amber-400" />
                    <span>Top Municipios por Desembolso</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Top 5</span>
                </div>

                <div className="space-y-1.5 text-xs">
                  {stats.topMunicipios.length > 0 ? (
                    stats.topMunicipios.map((m, idx) => (
                      <div
                        key={m.municipio}
                        className="flex items-center justify-between py-1 px-2 rounded-lg bg-slate-900/80 border border-slate-800/80 text-[11px]"
                      >
                        <span className="text-slate-200 font-medium truncate max-w-[150px]">
                          {idx + 1}. {m.municipio}
                        </span>
                        <div className="flex items-center space-x-2 font-mono">
                          <span className="text-slate-400 text-[10px]">{m.count} cta</span>
                          <span className="text-emerald-400 font-bold">{formatPesos(m.totalNeto)}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-500 text-center py-2">
                      Sin registros en este periodo
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Sub-view: Detalle por Meses */}
          {activeView === 'meses' && (
            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3">
              <div className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                <span>Desglose Consolidado por Mes de Ejecución</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Mes</th>
                      <th className="py-2 px-3 text-center">Cuentas</th>
                      <th className="py-2 px-3 text-right">Cargo Básico</th>
                      <th className="py-2 px-3 text-right">Variable + SIPOST</th>
                      <th className="py-2 px-3 text-right">Retención 1%</th>
                      <th className="py-2 px-3 text-right font-bold text-emerald-400">Total Neto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300 font-mono">
                    {stats.mesesList.map((m) => (
                      <tr key={m.mes} className="hover:bg-slate-900/40 transition-colors">
                        <td className="py-2 px-3 font-sans font-bold text-amber-400">{m.mes}</td>
                        <td className="py-2 px-3 text-center text-slate-200">{m.count}</td>
                        <td className="py-2 px-3 text-right text-slate-200">{formatPesos(m.basico)}</td>
                        <td className="py-2 px-3 text-right text-slate-200">{formatPesos(m.variable)}</td>
                        <td className="py-2 px-3 text-right text-red-400">-{formatPesos(m.retencion)}</td>
                        <td className="py-2 px-3 text-right font-bold text-emerald-400">{formatPesos(m.totalNeto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sub-view: Detalle por Centros Operativos */}
          {activeView === 'operativos' && (
            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3">
              <div className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                <Building2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Desglose por Centro Operativo & Regional</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {stats.operativosList.map((op) => (
                  <div
                    key={op.operativo}
                    className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-100">{op.operativo}</span>
                      <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
                        {op.count} cta(s)
                      </span>
                    </div>
                    <div className="text-sm font-extrabold text-emerald-400 font-mono">
                      {formatPesos(op.totalNeto)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
