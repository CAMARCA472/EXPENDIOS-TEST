import React, { useState, useMemo } from 'react';
import { PagoRelacionItem } from '../types';
import { formatNumberWithDots } from '../utils/formatters';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Building2,
  Calendar,
  Layers,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Filter,
  PieChart as PieChartIcon,
} from 'lucide-react';

interface DashboardRelacionPagosProps {
  items: PagoRelacionItem[];
  mesActual: string;
  anioActual: string;
}

export const DashboardRelacionPagos: React.FC<DashboardRelacionPagosProps> = ({
  items,
  mesActual,
  anioActual,
}) => {
  const [selectedCo, setSelectedCo] = useState<string>('TODOS');

  // Group metrics by Centro Operativo
  const centrosOperativosData = useMemo(() => {
    const map: {
      [co: string]: {
        centroOperativo: string;
        totalFacturado: number;
        cantidadPuntos: number;
        pagados: number;
        pendientes: number;
        municipios: string[];
      };
    } = {};

    items.forEach((item) => {
      const co = (item.centroOperativo || 'PO. BUCARAMANGA').trim().toUpperCase();
      if (!map[co]) {
        map[co] = {
          centroOperativo: co,
          totalFacturado: 0,
          cantidadPuntos: 0,
          pagados: 0,
          pendientes: 0,
          municipios: [],
        };
      }

      const val = Number(item.valorCancelar) || 0;
      map[co].totalFacturado += val;
      map[co].cantidadPuntos += 1;
      if (item.municipio && !map[co].municipios.includes(item.municipio)) {
        map[co].municipios.push(item.municipio);
      }

      if (item.estado?.toUpperCase().includes('PAGADO')) {
        map[co].pagados += 1;
      } else {
        map[co].pendientes += 1;
      }
    });

    return Object.values(map).sort((a, b) => b.totalFacturado - a.totalFacturado);
  }, [items]);

  const totalFacturadoMes = useMemo(() => {
    return items.reduce((acc, curr) => acc + (Number(curr.valorCancelar) || 0), 0);
  }, [items]);

  const totalPuntos = items.length;
  const totalPagados = items.filter((i) => i.estado?.toUpperCase().includes('PAGADO')).length;
  const totalPendientes = totalPuntos - totalPagados;
  const porcentajePagado = totalPuntos > 0 ? Math.round((totalPagados / totalPuntos) * 100) : 0;

  const filteredItems = useMemo(() => {
    if (selectedCo === 'TODOS') return items;
    return items.filter(
      (it) => (it.centroOperativo || '').toUpperCase() === selectedCo.toUpperCase()
    );
  }, [items, selectedCo]);

  const totalFilteredFacturado = useMemo(() => {
    return filteredItems.reduce((acc, curr) => acc + (Number(curr.valorCancelar) || 0), 0);
  }, [filteredItems]);

  return (
    <div className="space-y-6">
      {/* Top Global KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Facturado Mes */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Total Facturado Mes
            </span>
            <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-amber-400 font-mono tracking-tight">
              {formatNumberWithDots(totalFacturadoMes)}
            </div>
            <div className="flex items-center space-x-1.5 text-xs text-slate-400 mt-1">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>Periodo: <strong className="text-slate-200">{mesActual} {anioActual}</strong></span>
            </div>
          </div>
          <div className="absolute right-0 bottom-0 w-24 h-24 bg-amber-500/5 rounded-tl-full pointer-events-none" />
        </div>

        {/* Centros Operativos Activos */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Centros Operativos
            </span>
            <div className="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20 text-blue-400">
              <Building2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-100 tracking-tight">
              {centrosOperativosData.length} <span className="text-xs font-normal text-slate-400">regionales</span>
            </div>
            <div className="flex items-center space-x-1.5 text-xs text-slate-400 mt-1">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>{totalPuntos} municipios / puntos</span>
            </div>
          </div>
        </div>

        {/* Pagos Realizados */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Pagados / Procesados
            </span>
            <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-emerald-400 tracking-tight">
              {totalPagados} <span className="text-xs font-normal text-slate-400">/ {totalPuntos}</span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-400 mt-1">
              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${porcentajePagado}%` }}
                />
              </div>
              <span className="font-bold text-emerald-400 shrink-0">{porcentajePagado}%</span>
            </div>
          </div>
        </div>

        {/* Pendientes por Tramitar */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Pendientes de Pago
            </span>
            <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-amber-300 tracking-tight">
              {totalPendientes} <span className="text-xs font-normal text-slate-400">puntos</span>
            </div>
            <div className="flex items-center space-x-1.5 text-xs text-slate-400 mt-1">
              <span>{100 - porcentajePagado}% en trámite</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Dashboard Split: Bar Visuals by Centro Operativo & Breakdown Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Facturación por Centro Operativo (Graphic Cards & Bars) */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <BarChart3 className="w-5 h-5 text-amber-400" />
                <span>Facturación Consolidada por Centro Operativo</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Distribución del monto total facturado en el mes de {mesActual} {anioActual} por cada Centro Operativo.
              </p>
            </div>
            <span className="text-xs bg-slate-800 text-slate-300 px-3 py-1 rounded-lg border border-slate-700 font-semibold self-start sm:self-auto">
              Total Mes: <strong className="text-amber-400 font-mono">{formatNumberWithDots(totalFacturadoMes)}</strong>
            </span>
          </div>

          {/* Ranking & Progress Bars by Centro Operativo */}
          <div className="space-y-4">
            {centrosOperativosData.map((coItem, index) => {
              const share = totalFacturadoMes > 0 ? (coItem.totalFacturado / totalFacturadoMes) * 100 : 0;
              const isSelected = selectedCo === coItem.centroOperativo;

              return (
                <div
                  key={coItem.centroOperativo}
                  onClick={() => setSelectedCo(isSelected ? 'TODOS' : coItem.centroOperativo)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-amber-950/30 border-amber-500 shadow-md shadow-amber-950/40 ring-1 ring-amber-500'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <div className="flex items-center space-x-3">
                      <span className="w-6 h-6 rounded-full bg-slate-800 text-amber-400 border border-slate-700 text-xs font-bold flex items-center justify-center shrink-0">
                        {index + 1}
                      </span>
                      <div>
                        <div className="font-bold text-sm text-slate-100 flex items-center space-x-2">
                          <span>{coItem.centroOperativo}</span>
                          <span className="text-[11px] font-normal text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md">
                            {coItem.cantidadPuntos} municipios
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate max-w-md">
                          {coItem.municipios.slice(0, 5).join(', ')}{coItem.municipios.length > 5 ? ` +${coItem.municipios.length - 5} más` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="text-left sm:text-right">
                      <div className="text-base font-black text-amber-400 font-mono">
                        {formatNumberWithDots(coItem.totalFacturado)}
                      </div>
                      <div className="text-xs text-slate-400 font-semibold">
                        {share.toFixed(1)}% del total
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar Visual */}
                  <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
                    <div
                      className="bg-gradient-to-r from-amber-500 to-amber-400 h-2.5 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(share, 4)}%` }}
                    />
                  </div>

                  {/* Micro stats footer */}
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2.5 pt-2 border-t border-slate-800/60">
                    <div className="flex items-center space-x-3">
                      <span className="flex items-center space-x-1 text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{coItem.pagados} Pagados</span>
                      </span>
                      <span className="text-slate-600">|</span>
                      <span className="flex items-center space-x-1 text-amber-400">
                        <Clock className="w-3 h-3" />
                        <span>{coItem.pendientes} Pendientes</span>
                      </span>
                    </div>
                    <span className="text-amber-400 text-xs font-semibold hover:underline flex items-center space-x-1">
                      <span>{isSelected ? 'Ver Todos' : 'Filtrar detalle'}</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 1 Col: Summary Card & Detail Filter */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div className="border-b border-slate-800 pb-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
              <PieChartIcon className="w-5 h-5 text-emerald-400" />
              <span>Resumen Ejecutivo</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Filtro seleccionado: <strong className="text-amber-400">{selectedCo}</strong>
            </p>
          </div>

          {/* Breakdown Box */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="text-xs text-slate-400 uppercase font-semibold">Total en Selección:</div>
            <div className="text-2xl font-black text-amber-400 font-mono">
              {formatNumberWithDots(totalFilteredFacturado)}
            </div>
            <div className="text-xs text-slate-400">
              Registros correspondientes: <strong className="text-slate-200">{filteredItems.length} expendios</strong>
            </div>
          </div>

          {/* Quick Centro Operativo Filter Buttons */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase">Filtrar C.O.:</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedCo('TODOS')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  selectedCo === 'TODOS'
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Todos ({items.length})
              </button>
              {centrosOperativosData.map((co) => (
                <button
                  key={co.centroOperativo}
                  onClick={() => setSelectedCo(co.centroOperativo)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedCo === co.centroOperativo
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {co.centroOperativo.replace('PO. ', '')} ({co.cantidadPuntos})
                </button>
              ))}
            </div>
          </div>

          {/* Mini Table of Expendios in Selected C.O. */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold">
              <span>Municipios ({filteredItems.length})</span>
              <span>Monto Facturado</span>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
              {filteredItems.slice(0, 15).map((it) => (
                <div
                  key={it.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs"
                >
                  <div className="truncate pr-2">
                    <div className="font-bold text-slate-200 truncate">{it.municipio}</div>
                    <div className="text-[10px] text-slate-400 truncate">{it.nombreEncargado}</div>
                  </div>
                  <div className="font-mono font-bold text-amber-400 shrink-0">
                    {formatNumberWithDots(it.valorCancelar)}
                  </div>
                </div>
              ))}
              {filteredItems.length > 15 && (
                <div className="text-center text-[11px] text-slate-500 pt-1">
                  + {filteredItems.length - 15} municipios adicionales
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
