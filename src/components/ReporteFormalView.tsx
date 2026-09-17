import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { PagoRelacionItem } from '../types';
import { formatNumberWithDots, formatCuentaBancaria } from '../utils/formatters';
import {
  FileSpreadsheet,
  Printer,
  Download,
  DollarSign,
  Building2,
  Calendar,
  CheckCircle2,
  Edit2,
  Check,
  X,
  ShieldCheck,
  HelpCircle,
  TrendingDown,
  Sparkles,
  CreditCard,
  SlidersHorizontal,
} from 'lucide-react';

export const BANCOS_DISPONIBLES = [
  'NEQUI',
  'AHORROS BANCOLOMBIA',
  'CUENTA CORRIENTE BANCOLOMBIA',
  'DAVIPLATA',
  'BANCO AGRARIO',
  'DAVIVIENDA',
  'BANCO DE BOGOTA',
  'BBVA',
  'BANCO DE OCCIDENTE',
  'BANCO POPULAR',
  'BANCO AV VILLAS',
  'SCOTIABANK COLPATRIA',
  'OTROS',
];

interface ReporteFormalViewProps {
  items: PagoRelacionItem[];
  mes: string;
  anio: string;
  onUpdateItemStatus?: (item: PagoRelacionItem, nuevoEstado: string) => void;
  onUpdateItemCuentaBanco?: (item: PagoRelacionItem, nuevaCuenta: string, nuevoBanco: string) => Promise<void> | void;
}

export const ReporteFormalView: React.FC<ReporteFormalViewProps> = ({
  items,
  mes,
  anio,
  onUpdateItemStatus,
  onUpdateItemCuentaBanco,
}) => {
  const [anticipoCustom, setAnticipoCustom] = useState<number | null>(null);
  const [isEditingAnticipo, setIsEditingAnticipo] = useState<boolean>(false);
  const [tempAnticipo, setTempAnticipo] = useState<string>('');
  const [showPrintPreview, setShowPrintPreview] = useState<boolean>(false);
  const [printOrientation, setPrintOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [printScale, setPrintScale] = useState<'normal' | 'compact' | 'ultra'>('normal');

  // Inline edit state for Account Number & Bank
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [tempRowCuenta, setTempRowCuenta] = useState<string>('');
  const [tempRowBanco, setTempRowBanco] = useState<string>('');
  const [customBancoInput, setCustomBancoInput] = useState<string>('');
  const [showCustomBancoModal, setShowCustomBancoModal] = useState<boolean>(false);
  const [savedRowIndicator, setSavedRowIndicator] = useState<string | null>(null);

  // Totals calculations
  const totalValor = items.reduce((acc, curr) => acc + (Number(curr.valorCancelar) || 0), 0);
  const anticipoValor = anticipoCustom !== null ? anticipoCustom : totalValor;
  const saldoValor = totalValor - anticipoValor;

  const handleStartEditAnticipo = () => {
    setTempAnticipo(String(anticipoValor));
    setIsEditingAnticipo(true);
  };

  const handleSaveAnticipo = () => {
    const parsed = Number(tempAnticipo.replace(/[^0-9]/g, ''));
    if (!isNaN(parsed) && parsed >= 0) {
      setAnticipoCustom(parsed);
    }
    setIsEditingAnticipo(false);
  };

  const handleResetAnticipoToTotal = () => {
    setAnticipoCustom(totalValor);
    setIsEditingAnticipo(false);
  };

  // Quick save inline account number
  const handleSaveInlineCuenta = async (item: PagoRelacionItem, nuevaCuentaStr: string) => {
    const cleanCuenta = nuevaCuentaStr.trim();
    if (!cleanCuenta && cleanCuenta === item.cuenta) return;
    
    if (onUpdateItemCuentaBanco) {
      await onUpdateItemCuentaBanco(item, cleanCuenta || item.cuenta, item.banco || 'NEQUI');
    } else {
      // Direct server fallback
      try {
        await fetch(`/api/admin/relacion-pagos/${item.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cuenta: cleanCuenta }),
        });
      } catch (err) {
        console.error('Error actualizando cuenta:', err);
      }
    }

    setSavedRowIndicator(item.id);
    setTimeout(() => setSavedRowIndicator(null), 2500);
  };

  // Quick save inline bank
  const handleSaveInlineBanco = async (item: PagoRelacionItem, nuevoBancoStr: string) => {
    const cleanBanco = nuevoBancoStr.trim().toUpperCase();
    if (!cleanBanco && cleanBanco === (item.banco || '').toUpperCase()) return;

    if (onUpdateItemCuentaBanco) {
      await onUpdateItemCuentaBanco(item, item.cuenta, cleanBanco);
    } else {
      // Direct server fallback
      try {
        await fetch(`/api/admin/relacion-pagos/${item.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ banco: cleanBanco }),
        });
      } catch (err) {
        console.error('Error actualizando banco:', err);
      }
    }

    setSavedRowIndicator(item.id);
    setTimeout(() => setSavedRowIndicator(null), 2500);
  };

  // Exportar Excel Formal Oficial matching the required columns and summary
  const handleExportExcelFormal = () => {
    if (items.length === 0) {
      alert('No hay registros de pagos para exportar en este periodo.');
      return;
    }

    const titleRow = [`RELACION DE PAGOS EXPENDIOS MES ${mes.toUpperCase()} ${anio}`];
    const emptyRow: any[] = [];
    const headerRow = [
      'N°',
      'CENTRO OPERATIVO',
      'MUNICIPIO',
      'CONCEPTO',
      'NOMBRE DEL ENCARGADO',
      'Cedula',
      'CUENTA',
      `VALOR A CANCELAR ${mes.toUpperCase()}`,
      'BANCO',
      'ESTADO',
    ];

    const dataRows = items.map((item, index) => [
      item.consecutivo || index + 1,
      item.centroOperativo || 'PO. CUCUTA',
      item.municipio || '',
      item.concepto || `PAGO MES ${mes.toUpperCase()} EXPENDIO ${item.municipio}`,
      (item.nombreEncargado || '').toUpperCase(),
      item.cedula || '',
      item.cuenta || '',
      item.valorCancelar || 0,
      (item.banco || 'NEQUI').toUpperCase(),
      item.estado || 'Pendiente',
    ]);

    const totalRow = [
      '',
      '',
      '',
      '',
      '',
      '',
      'VALOR TOTAL PAGO',
      totalValor,
      '',
      '',
    ];

    const anticipoRow = [
      '',
      '',
      '',
      '',
      '',
      '',
      'ANTICIPO',
      anticipoValor,
      '',
      '',
    ];

    const saldoRow = [
      '',
      '',
      '',
      '',
      '',
      '',
      'SALDO',
      saldoValor <= 0 ? 0 : saldoValor,
      '',
      '',
    ];

    const wsData = [
      titleRow,
      emptyRow,
      headerRow,
      ...dataRows,
      emptyRow,
      totalRow,
      anticipoRow,
      saldoRow,
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(wsData);

    // Merge title row
    worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];

    // Column widths
    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 22 },
      { wch: 24 },
      { wch: 38 },
      { wch: 34 },
      { wch: 18 },
      { wch: 26 },
      { wch: 22 },
      { wch: 20 },
      { wch: 18 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `PAGOS_${mes}_${anio}`);
    XLSX.writeFile(workbook, `RELACION_DE_PAGOS_${mes.toUpperCase()}_${anio}.xlsx`);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* CSS específico para impresión: SOLO imprime el informe formal blanco (el segundo) */}
      <style>{`
        @media print {
          @page {
            size: ${printOrientation === 'landscape' ? 'landscape' : 'portrait'};
            margin: 6mm 4mm 6mm 4mm;
          }
          html, body {
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* Ocultar completamente la UI de la pantalla, headers, botones y tablas oscuras */
          header, nav, aside, button, input, select, .print-hide, .no-print, .screen-only-view {
            display: none !important;
          }
          .print-modal-container {
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            overflow: visible !important;
            box-shadow: none !important;
            border: none !important;
            display: block !important;
          }
          .print-document-sheet {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: #ffffff !important;
            color: #000000 !important;
            overflow: visible !important;
          }
          .print-table-wrapper {
            width: 100% !important;
            overflow: visible !important;
          }
          .print-table-fixed {
            width: 100% !important;
            table-layout: fixed !important;
            border-collapse: collapse !important;
            font-size: ${printScale === 'ultra' ? '6.5pt' : printScale === 'compact' ? '7pt' : '7.5pt'} !important;
          }
          .print-table-fixed th, .print-table-fixed td {
            word-wrap: break-word !important;
            word-break: break-word !important;
            white-space: normal !important;
            overflow: visible !important;
            padding: 2.5px 2px !important;
            border: 1px solid #475569 !important;
            line-height: 1.15 !important;
          }
          .print-banner-blue {
            background-color: #1070b8 !important;
            color: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      {/* Action Header Banner (Oculto en Impresión) */}
      <div className="screen-only-view print:hidden flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-600/20 border border-blue-500/40 rounded-xl text-blue-400">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
              <span>Reporte Formal Institucional de Pagos</span>
              <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-mono uppercase">
                {mes} {anio}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Plantilla formal con edición directa de <strong>Número de Cuenta</strong> y <strong>Tipo de Banco</strong> sobre el texto.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 w-full sm:w-auto justify-end">
          <button
            onClick={handleExportExcelFormal}
            disabled={items.length === 0}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2 px-3.5 rounded-xl flex items-center space-x-1.5 shadow-md cursor-pointer transition-all disabled:opacity-50"
            title="Descargar archivo Excel con formato y resumen formal"
          >
            <Download className="w-4 h-4" />
            <span>Exportar Excel Oficial (.xlsx)</span>
          </button>

          <button
            onClick={() => setShowPrintPreview(true)}
            disabled={items.length === 0}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-2 px-3.5 rounded-xl flex items-center space-x-1.5 shadow-md cursor-pointer transition-all disabled:opacity-50"
            title="Abrir vista de impresión optimizada sin recorte de casillas"
          >
            <Printer className="w-4 h-4" />
            <span>Imprimir / PDF Formal</span>
          </button>
        </div>
      </div>

      {/* Main Formal Document Sheet (Pantalla interactiva, OCULTO EN IMPRESIÓN para que solo salga el segundo reporte limpio) */}
      <div className="screen-only-view print:hidden bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        {/* Banner Institucional Superior */}
        <div className="bg-[#1070b8] text-white py-3.5 px-6 text-center font-black tracking-wider uppercase text-base sm:text-lg border-b border-blue-400/30 shadow-md">
          RELACION DE PAGOS EXPENDIOS MES {mes.toUpperCase()} {anio}
        </div>

        {/* Tabla Formal de Pagos */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-sans">
            <thead>
              <tr className="bg-slate-950 text-slate-300 border-b border-slate-800 uppercase font-black text-[11px] tracking-wide">
                <th className="py-3 px-2 text-center w-10 border-r border-slate-800/80">N°</th>
                <th className="py-3 px-3 border-r border-slate-800/80">CENTRO OPERATIVO</th>
                <th className="py-3 px-3 border-r border-slate-800/80">MUNICIPIO</th>
                <th className="py-3 px-3 border-r border-slate-800/80">CONCEPTO</th>
                <th className="py-3 px-3 border-r border-slate-800/80">NOMBRE DEL ENCARGADO</th>
                <th className="py-3 px-3 font-mono border-r border-slate-800/80">Cedula</th>
                <th className="py-3 px-3 font-mono border-r border-slate-800/80 min-w-[170px]">
                  <div className="flex items-center justify-between">
                    <span>CUENTA (Clic para editar)</span>
                    <Edit2 className="w-3 h-3 text-emerald-400" />
                  </div>
                </th>
                <th className="py-3 px-3 text-right font-mono border-r border-slate-800/80">
                  VALOR A CANCELAR {mes.toUpperCase()}
                </th>
                <th className="py-3 px-3 border-r border-slate-800/80 text-center min-w-[150px]">
                  <div className="flex items-center justify-center space-x-1">
                    <span>BANCO</span>
                    <Edit2 className="w-3 h-3 text-blue-400" />
                  </div>
                </th>
                <th className="py-3 px-3 text-center">ESTADO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-200">
              {items.length > 0 ? (
                items.map((item, index) => {
                  const valor = Number(item.valorCancelar) || 0;
                  const isPagado = item.estado?.toUpperCase().includes('PAGADO');
                  const isSavedJustNow = savedRowIndicator === item.id;

                  // Normalize current bank
                  const currentBancoUpper = (item.banco || 'NEQUI').trim().toUpperCase();
                  const isStandardBank = BANCOS_DISPONIBLES.includes(currentBancoUpper);
                  const displayBancoSelect = isStandardBank ? currentBancoUpper : 'OTROS';

                  return (
                    <tr
                      key={item.id || index}
                      className="hover:bg-slate-800/50 transition-colors odd:bg-slate-900/40 even:bg-slate-950/40"
                    >
                      <td className="py-2.5 px-2 text-center font-mono text-slate-400 font-bold border-r border-slate-800/60">
                        {item.consecutivo || index + 1}
                      </td>

                      <td className="py-2.5 px-3 font-medium text-slate-200 border-r border-slate-800/60 whitespace-nowrap">
                        {item.centroOperativo || 'PO. CUCUTA'}
                      </td>

                      <td className="py-2.5 px-3 font-bold text-amber-300 border-r border-slate-800/60 uppercase whitespace-nowrap">
                        {item.municipio}
                      </td>

                      <td className="py-2.5 px-3 text-slate-300 border-r border-slate-800/60 text-[11px]">
                        {item.concepto || `PAGO MES ${mes.toUpperCase()} EXPENDIO ${item.municipio}`}
                      </td>

                      <td className="py-2.5 px-3 font-bold text-slate-100 uppercase border-r border-slate-800/60 whitespace-nowrap">
                        {item.nombreEncargado}
                      </td>

                      <td className="py-2.5 px-3 font-mono text-slate-300 border-r border-slate-800/60 whitespace-nowrap">
                        {item.cedula}
                      </td>

                      {/* 1. EDICIÓN DIRECTA DE NÚMERO DE CUENTA SOBRE EL TEXTO */}
                      <td className="py-2 px-2.5 font-mono border-r border-slate-800/60 min-w-[170px]">
                        <div className="relative flex items-center group">
                          <input
                            type="text"
                            defaultValue={item.cuenta || ''}
                            onBlur={(e) => handleSaveInlineCuenta(item, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            placeholder="Escribir N° cuenta..."
                            className="w-full bg-slate-950/70 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/80 hover:border-emerald-500/80 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-emerald-400 placeholder:text-slate-600 transition-all outline-none"
                            title="Haz clic aquí para escribir o modificar directamente el número de cuenta"
                          />
                          {isSavedJustNow && (
                            <span className="absolute right-2 text-emerald-400 flex items-center space-x-0.5 bg-emerald-950 px-1 py-0.5 rounded text-[9px] font-sans font-bold animate-fade-in shadow">
                              <Check className="w-3 h-3" />
                              <span>Listo</span>
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-black text-slate-100 border-r border-slate-800/60 whitespace-nowrap">
                        $ {formatNumberWithDots(valor)}
                      </td>

                      {/* 2. EDICIÓN DIRECTA DE TIPO DE BANCO CON DESPLEGABLE */}
                      <td className="py-2 px-2 text-center border-r border-slate-800/60 min-w-[150px]">
                        <div className="flex flex-col space-y-1">
                          <select
                            value={displayBancoSelect}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === 'OTROS') {
                                const custom = prompt('Ingrese el nombre de la otra entidad bancaria:', item.banco || '');
                                if (custom !== null && custom.trim()) {
                                  handleSaveInlineBanco(item, custom.trim().toUpperCase());
                                }
                              } else {
                                handleSaveInlineBanco(item, val);
                              }
                            }}
                            className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-700 hover:border-blue-500 text-slate-200 font-mono font-bold text-[10px] rounded-lg px-2 py-1 focus:outline-none focus:border-blue-400 cursor-pointer uppercase transition-all"
                            title="Seleccionar tipo de banco o cuenta"
                          >
                            {BANCOS_DISPONIBLES.map((b) => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                          </select>
                          {!isStandardBank && item.banco && (
                            <span className="text-[9px] text-amber-300 font-mono font-semibold truncate px-1">
                              {item.banco}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {onUpdateItemStatus ? (
                          <select
                            value={item.estado || 'Pendiente'}
                            onChange={(e) => onUpdateItemStatus(item, e.target.value)}
                            className={`text-[11px] font-bold rounded-lg px-2 py-1 border focus:outline-none cursor-pointer ${
                              isPagado
                                ? 'bg-blue-950 text-blue-300 border-blue-700'
                                : 'bg-slate-950 text-slate-300 border-slate-700'
                            }`}
                          >
                            <option value="Pendiente">Pendiente</option>
                            <option value="Cuenta Firmada Cargada">Cuenta Firmada Cargada</option>
                            <option value="Listo para Pago">Listo para Pago</option>
                            <option value="Pagado">Pagado</option>
                          </select>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              isPagado
                                ? 'bg-blue-950 text-blue-300 border border-blue-800'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            {item.estado || 'Pendiente'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500">
                    <p className="text-sm font-semibold text-slate-400">
                      No hay registros disponibles para el periodo {mes} {anio}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* PIE DE LIQUIDACIÓN FORMAL */}
        <div className="border-t-2 border-slate-700 bg-slate-950/90 p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            {/* Información y Aclaración */}
            <div className="text-xs text-slate-400 space-y-1.5 max-w-md">
              <div className="flex items-center space-x-2 text-slate-200 font-bold text-xs uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Liquidación Oficial y Cierre Financiero</span>
              </div>
              <p>
                Este reporte formal consolida la totalidad de los valores a cancelar correspondientes al mes de{' '}
                <strong className="text-amber-400">{mes} {anio}</strong>.
              </p>
              <div className="flex items-center space-x-2 pt-1">
                <span className="text-[11px] text-slate-400">Anticipo configurable:</span>
                <button
                  onClick={handleResetAnticipoToTotal}
                  className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-0.5 rounded border border-slate-700 cursor-pointer"
                >
                  Igualar a Total
                </button>
                <button
                  onClick={handleStartEditAnticipo}
                  className="text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-2 py-0.5 rounded border border-amber-500/40 cursor-pointer flex items-center space-x-1"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>Modificar Anticipo</span>
                </button>
              </div>
            </div>

            {/* TABLA DE RESUMEN FINAL: VALOR TOTAL PAGO, ANTICIPO, SALDO */}
            <div className="w-full lg:w-96 bg-slate-900 border-2 border-slate-700 rounded-xl overflow-hidden shadow-xl">
              <div className="divide-y divide-slate-800 text-xs">
                {/* 1. VALOR TOTAL PAGO */}
                <div className="flex items-center justify-between px-4 py-3 bg-slate-900">
                  <span className="font-extrabold text-slate-200 uppercase tracking-wider text-xs">
                    VALOR TOTAL PAGO
                  </span>
                  <span className="font-mono font-black text-base text-amber-400">
                    $ {formatNumberWithDots(totalValor)}
                  </span>
                </div>

                {/* 2. ANTICIPO */}
                <div className="flex items-center justify-between px-4 py-3 bg-slate-950/60">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-extrabold text-slate-300 uppercase tracking-wider text-xs">
                      ANTICIPO
                    </span>
                    {anticipoCustom !== null && anticipoCustom !== totalValor && (
                      <span className="text-[9px] bg-blue-950 text-blue-300 border border-blue-800 px-1.5 py-0.2 rounded font-mono">
                        Personalizado
                      </span>
                    )}
                  </div>

                  {isEditingAnticipo ? (
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="text"
                        value={tempAnticipo}
                        onChange={(e) => setTempAnticipo(e.target.value)}
                        className="w-28 bg-slate-950 border border-amber-500 text-right font-mono font-bold text-amber-300 px-2 py-1 rounded text-xs focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveAnticipo}
                        className="p-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded cursor-pointer"
                        title="Guardar anticipo"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setIsEditingAnticipo(false)}
                        className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded cursor-pointer"
                        title="Cancelar"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-black text-base text-slate-100">
                        $ {formatNumberWithDots(anticipoValor)}
                      </span>
                      <button
                        onClick={handleStartEditAnticipo}
                        className="text-slate-400 hover:text-amber-400 p-1 cursor-pointer transition-colors"
                        title="Editar monto de anticipo"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* 3. SALDO */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#1070b8]/15 border-t border-blue-500/30">
                  <span className="font-black text-blue-300 uppercase tracking-wider text-xs">
                    SALDO
                  </span>
                  <span
                    className={`font-mono font-black text-base ${
                      saldoValor <= 0 ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {saldoValor <= 0 ? '$ -' : `$ ${formatNumberWithDots(saldoValor)}`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Impresión / Guardar PDF Formal (En pantalla como modal, y en impresión como único documento visible) */}
      <div
        className={
          showPrintPreview
            ? 'print-modal-container fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-start p-4 overflow-y-auto print:p-0 print:bg-white print:overflow-visible'
            : 'hidden print:block print-modal-container'
        }
      >
        {/* Top Bar for Print Actions (Oculto en Impresión) */}
        {showPrintPreview && (
          <div className="print-hide w-full max-w-6xl flex flex-col md:flex-row items-start md:items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-2xl mb-4 shadow-xl gap-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30">
                <Printer className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-slate-100 text-sm">
                  Configuración de Impresión / Exportación PDF
                </h4>
                <p className="text-xs text-slate-400">
                  Las casillas se han dimensionado para que <strong>quepan todas las 10 columnas al 100%</strong> sin recortes.
                </p>
              </div>
            </div>

            {/* Controles de Orientación y Escala */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 flex items-center space-x-2 text-xs">
                <span className="text-slate-400 font-semibold">Orientación:</span>
                <button
                  type="button"
                  onClick={() => setPrintOrientation('landscape')}
                  className={`px-2.5 py-1 rounded-lg font-bold text-xs cursor-pointer transition-all ${
                    printOrientation === 'landscape'
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Horizontal (Recomendado)
                </button>
                <button
                  type="button"
                  onClick={() => setPrintOrientation('portrait')}
                  className={`px-2.5 py-1 rounded-lg font-bold text-xs cursor-pointer transition-all ${
                    printOrientation === 'portrait'
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Vertical
                </button>
              </div>

              <div className="bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 flex items-center space-x-2 text-xs">
                <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-slate-400 font-semibold">Ajuste:</span>
                <select
                  value={printScale}
                  onChange={(e: any) => setPrintScale(e.target.value)}
                  className="bg-slate-900 text-slate-200 text-xs rounded-lg px-2 py-1 border border-slate-700 cursor-pointer focus:outline-none"
                >
                  <option value="normal">Normal (100%)</option>
                  <option value="compact">Compacto (90%)</option>
                  <option value="ultra">Ultra Ajustado (80%)</option>
                </select>
              </div>

              <button
                onClick={handlePrint}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center space-x-1.5 shadow-lg cursor-pointer transition-colors"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir / Guardar PDF</span>
              </button>

              <button
                onClick={() => setShowPrintPreview(false)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold py-2 px-4 rounded-xl cursor-pointer transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Printable Document Container (Styled for print & screen - Este es el ÚNICO informe que se imprime) */}
        <div className="print-document-sheet w-full max-w-6xl bg-white text-slate-900 p-6 sm:p-8 rounded-2xl shadow-2xl border border-slate-300 print:border-none print:shadow-none print:p-0 print:max-w-none">
          {/* Header Institucional */}
          <div className="border-b-2 border-slate-800 pb-3 mb-3 flex items-center justify-between">
            <div>
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-slate-900 uppercase">
                CAMARCA S.A.S.
              </h1>
              <p className="text-[11px] font-bold text-slate-600">
                NIT: 900504241-7 | OPERACIÓN DE RED POSTAL Y EXPENDIOS
              </p>
            </div>
            <div className="text-right text-[10px] sm:text-xs">
              <div className="font-bold text-slate-800">DOCUMENTO OFICIAL DE LIQUIDACIÓN</div>
              <div className="text-slate-500 font-mono">
                Fecha de Generación: {new Date().toLocaleDateString('es-CO')}
              </div>
            </div>
          </div>

          {/* Banner Azul Formal */}
          <div className="print-banner-blue bg-[#1070b8] text-white py-2 px-4 text-center font-black tracking-wider uppercase text-xs sm:text-sm mb-3">
            RELACION DE PAGOS EXPENDIOS MES {mes.toUpperCase()} {anio}
          </div>

          {/* Tabla de Impresión con Distribución Porcentual Fija (100% de Ancho) */}
          <div className="print-table-wrapper w-full overflow-x-auto print:overflow-visible">
            <table className="print-table-fixed w-full text-left border-collapse border border-slate-500 text-[10px] font-sans">
              <thead>
                <tr className="bg-slate-100 text-slate-900 font-extrabold uppercase border-b border-slate-500">
                  <th style={{ width: '3.5%' }} className="py-1.5 px-1 text-center border-r border-slate-400">N°</th>
                  <th style={{ width: '10.5%' }} className="py-1.5 px-1.5 border-r border-slate-400">CENTRO OPERATIVO</th>
                  <th style={{ width: '11%' }} className="py-1.5 px-1.5 border-r border-slate-400">MUNICIPIO</th>
                  <th style={{ width: '15.5%' }} className="py-1.5 px-1.5 border-r border-slate-400">CONCEPTO</th>
                  <th style={{ width: '17%' }} className="py-1.5 px-1.5 border-r border-slate-400">NOMBRE DEL ENCARGADO</th>
                  <th style={{ width: '9.5%' }} className="py-1.5 px-1 font-mono border-r border-slate-400">Cedula</th>
                  <th style={{ width: '13.5%' }} className="py-1.5 px-1 font-mono border-r border-slate-400">CUENTA</th>
                  <th style={{ width: '9%' }} className="py-1.5 px-1 text-right font-mono border-r border-slate-400">
                    VALOR CANCELAR
                  </th>
                  <th style={{ width: '5.5%' }} className="py-1.5 px-1 text-center border-r border-slate-400">BANCO</th>
                  <th style={{ width: '5%' }} className="py-1.5 px-1 text-center">ESTADO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300">
                {items.map((item, index) => (
                  <tr key={index} className="even:bg-slate-50/80">
                    <td className="py-1 px-1 text-center font-mono border-r border-slate-300 font-semibold">
                      {item.consecutivo || index + 1}
                    </td>
                    <td className="py-1 px-1.5 border-r border-slate-300 break-words font-medium">
                      {item.centroOperativo || 'PO. CUCUTA'}
                    </td>
                    <td className="py-1 px-1.5 font-bold border-r border-slate-300 uppercase break-words">
                      {item.municipio}
                    </td>
                    <td className="py-1 px-1.5 border-r border-slate-300 text-[9px] break-words">
                      {item.concepto || `PAGO MES ${mes.toUpperCase()} EXPENDIO ${item.municipio}`}
                    </td>
                    <td className="py-1 px-1.5 font-bold uppercase border-r border-slate-300 break-words">
                      {item.nombreEncargado}
                    </td>
                    <td className="py-1 px-1 font-mono border-r border-slate-300 whitespace-nowrap">
                      {item.cedula}
                    </td>
                    <td className="py-1 px-1 font-mono font-bold text-slate-900 border-r border-slate-300 break-all">
                      {item.cuenta || ''}
                    </td>
                    <td className="py-1 px-1 text-right font-mono font-bold border-r border-slate-300 whitespace-nowrap">
                      ${formatNumberWithDots(item.valorCancelar || 0)}
                    </td>
                    <td className="py-1 px-1 text-center border-r border-slate-300 uppercase font-bold text-[8.5px] break-words">
                      {item.banco || 'NEQUI'}
                    </td>
                    <td className="py-1 px-1 text-center font-semibold text-[8.5px] break-words">
                      {item.estado || 'Pendiente'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer Summary Box on Print View */}
          <div className="mt-4 flex justify-end">
            <div className="w-72 border-2 border-slate-800 rounded-lg overflow-hidden text-xs">
              <div className="flex justify-between px-3 py-1.5 bg-slate-100 border-b border-slate-300 font-bold">
                <span>VALOR TOTAL PAGO:</span>
                <span className="font-mono font-black">$ {formatNumberWithDots(totalValor)}</span>
              </div>
              <div className="flex justify-between px-3 py-1.5 bg-white border-b border-slate-300 font-bold">
                <span>ANTICIPO:</span>
                <span className="font-mono font-black">$ {formatNumberWithDots(anticipoValor)}</span>
              </div>
              <div className="flex justify-between px-3 py-1.5 bg-[#1070b8]/10 font-black text-slate-900">
                <span>SALDO:</span>
                <span className="font-mono font-black">
                  {saldoValor <= 0 ? '$ -' : `$ ${formatNumberWithDots(saldoValor)}`}
                </span>
              </div>
            </div>
          </div>

          {/* Firmas de Control */}
          <div className="mt-8 pt-4 border-t border-slate-400 grid grid-cols-2 gap-8 text-center text-xs">
            <div>
              <div className="border-b border-slate-800 pb-6 mb-1.5"></div>
              <p className="font-bold text-slate-800">ELABORADO POR: TESORERÍA / PAGOS</p>
              <p className="text-[10px] text-slate-500">CAMARCA S.A.S.</p>
            </div>
            <div>
              <div className="border-b border-slate-800 pb-6 mb-1.5"></div>
              <p className="font-bold text-slate-800">APROBADO POR: GERENCIA GENERAL</p>
              <p className="text-[10px] text-slate-500">CAMARCA S.A.S.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

