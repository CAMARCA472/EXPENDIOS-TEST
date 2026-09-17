import React, { useState } from 'react';
import { CuentaCobroResult } from '../types';
import { Printer, Download, Building2, FileArchive, CheckCircle2, FileText } from 'lucide-react';
import { CamarcaLogo } from './CamarcaLogo';
import { numeroALetras } from '../utils/numeroALetras';
import {
  generateCuentasCobroPDF,
  generateCuentasCobroConsolidadoPDF,
  drawCuentaCobroPageVector,
  getCamarcaLogoDataUrl
} from '../utils/pdfGenerator';
import jsPDF from 'jspdf';

interface CuentaCobroDocumentProps {
  cuentas?: CuentaCobroResult[];
  cuenta?: CuentaCobroResult;
  onClose?: () => void;
  allowDownload?: boolean;
  downloadRestrictionMsg?: string;
  isExpendioRole?: boolean;
}

export const CuentaCobroDocument: React.FC<CuentaCobroDocumentProps> = ({
  cuentas = [],
  cuenta,
  onClose,
  allowDownload = true,
  downloadRestrictionMsg,
  isExpendioRole,
}) => {
  const [downloading, setDownloading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');

  const listaCuentas: CuentaCobroResult[] = (cuentas && cuentas.length > 0)
    ? cuentas
    : (cuenta ? [cuenta] : []);

  const isSingle = isExpendioRole || listaCuentas.length <= 1;

  const handlePrint = () => {
    if (!allowDownload) {
      alert(downloadRestrictionMsg || 'La descarga o impresión de este periodo está restringida por el Administrador.');
      return;
    }
    window.print();
  };

  const formatCurrency = (val?: number) => {
    const num = Math.round(Number(val) || 0);
    return `$ ${num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
  };

  const extractMesAno = (periodoStr: string) => {
    const clean = (periodoStr || '').toUpperCase();
    let mes = 'ENERO';
    let ano = '2026';
    const meses = [
      'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
      'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
    ];
    for (const m of meses) {
      if (clean.includes(m)) {
        mes = m;
        break;
      }
    }
    const matchAno = clean.match(/20\d\d/);
    if (matchAno) {
      ano = matchAno[0];
    }
    return { mes, ano };
  };

  const handleDownloadSinglePDF = async () => {
    if (listaCuentas.length === 0) return;
    setDownloading(true);
    setProgressMsg('Generando PDF...');

    try {
      const item = listaCuentas[0];
      const { mes } = extractMesAno(item.periodo || '');
      const municipioClean = (item.municipio || item.expendio || 'MUNICIPIO')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '_')
        .replace(/_+/g, '_');

      const fileName = `${municipioClean}_${mes}.pdf`;
      const logoDataUrl = await getCamarcaLogoDataUrl();

      const pdf = new jsPDF('p', 'mm', 'letter');
      drawCuentaCobroPageVector(pdf, item, 0, 1, item.periodo, logoDataUrl);
      pdf.save(fileName);
      setProgressMsg('¡PDF descargado con éxito!');
    } catch (err) {
      console.error('Error al generar PDF de cuenta de cobro:', err);
      alert('Ocurrió un error al generar el archivo PDF.');
    } finally {
      setTimeout(() => {
        setDownloading(false);
        setProgressMsg('');
      }, 1000);
    }
  };

  const handleDownloadConsolidado = async () => {
    if (listaCuentas.length === 0) return;
    setDownloading(true);
    setProgressMsg('Generando PDF consolidado...');

    try {
      await generateCuentasCobroConsolidadoPDF(listaCuentas, listaCuentas[0]?.periodo || 'MARZO 2026');
      setProgressMsg('¡PDF consolidado descargado!');
    } catch (err) {
      console.error('Error al generar PDF consolidado:', err);
      alert('Ocurrió un error al generar el PDF consolidado.');
    } finally {
      setTimeout(() => {
        setDownloading(false);
        setProgressMsg('');
      }, 1000);
    }
  };

  const handleDownloadZIP = async () => {
    if (listaCuentas.length === 0) return;
    setDownloading(true);
    setProgressMsg('Iniciando empaquetado de Cuentas de Cobro...');

    try {
      await generateCuentasCobroPDF(listaCuentas, listaCuentas[0]?.periodo || 'MARZO 2026', (msg) => {
        setProgressMsg(msg);
      });
      setProgressMsg('¡Descarga completada!');
    } catch (err) {
      console.error('Error al generar ZIP de cuentas de cobro:', err);
      alert('Ocurrió un error al empaquetar los archivos PDF en ZIP.');
    } finally {
      setTimeout(() => {
        setDownloading(false);
        setProgressMsg('');
      }, 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm overflow-y-auto p-2 sm:p-6 print:p-0 print:bg-white print:fixed print:inset-0 print:z-50 print:overflow-visible">
      {/* Top Action Bar (Hidden when printing) */}
      <div className="max-w-4xl mx-auto mb-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xl print:hidden">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              {isSingle ? 'Cuenta de Cobro Oficial' : `Cuentas de Cobro Oficiales (${listaCuentas.length} Documentos)`}
            </h3>
            <p className="text-xs text-slate-400">
              Formato Carta con Logo CAMARCA, concepto SPU oficial y desglose detallado.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {allowDownload ? (
            <>
              {isSingle ? (
                <button
                  onClick={handleDownloadSinglePDF}
                  disabled={downloading}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-bold text-xs py-2 px-4 rounded-xl shadow-lg flex items-center space-x-2 transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{downloading ? progressMsg || 'Descargando...' : 'Descargar'}</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={handleDownloadZIP}
                    disabled={downloading}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-bold text-xs py-2 px-4 rounded-xl shadow-lg flex items-center space-x-2 transition-all cursor-pointer"
                  >
                    <FileArchive className="w-4 h-4" />
                    <span>{downloading ? progressMsg || 'Empaquetando ZIP...' : 'Descargar ZIP (MUNICIPIO_MES.pdf)'}</span>
                  </button>

                  <button
                    onClick={handleDownloadConsolidado}
                    disabled={downloading}
                    className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 text-white font-bold text-xs py-2 px-4 rounded-xl shadow-lg flex items-center space-x-2 transition-all cursor-pointer"
                  >
                    <FileText className="w-4 h-4" />
                    <span>Descargar PDF Consolidado</span>
                  </button>
                </>
              )}

              <button
                onClick={handlePrint}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs py-2 px-4 rounded-xl shadow-lg flex items-center space-x-2 transition-all cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir / Guardar PDF</span>
              </button>
            </>
          ) : (
            <div className="bg-amber-950/60 border border-amber-800 text-amber-300 text-xs px-3 py-1.5 rounded-xl font-medium flex items-center space-x-1.5">
              <span>🔒 Descarga no habilitada para este periodo (Solo Visualización)</span>
            </div>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs py-2 px-3 rounded-xl border border-slate-700 transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>

      {/* Document Container */}
      <div className="max-w-4xl mx-auto space-y-8 print:space-y-0 print:max-w-none">
        {listaCuentas.map((item, idx) => {
          const municipioUpper = (item.municipio || item.expendio || 'CRAVO NORTE').toUpperCase();
          const centroOpUpper = (item.centroOperativo || 'PO.ARAUCA').toUpperCase();
          const regionalUpper = (item.regional || 'ORIENTE').toUpperCase();
          const encargadoUpper = (item.encargado || 'POR ASIGNAR').toUpperCase();
          
          const { mes, ano } = extractMesAno(item.periodo || '');
          const fechaEmisionUpper = (item.periodo || `MES DE ${mes} DEL AÑO ${ano}`).toUpperCase();

          const cargoBasico = item.cargoBasico ?? item.valorBase ?? 0;
          const subsidioInternet = item.admisionSipost ?? 0;
          const variableGestion = item.valorVariable ?? 0;
          const isGrossUp = !!item.grossUpAplicado;
          const pRet = item.porcentajeRetencion || 1;
          const retef1 = isGrossUp ? 0 : (item.retef1 ?? item.retencionValor ?? Math.round((cargoBasico + subsidioInternet + variableGestion) * (pRet / 100)));
          const neto = isGrossUp ? (cargoBasico + subsidioInternet + variableGestion) : (item.valorNeto ?? (cargoBasico + subsidioInternet + variableGestion - retef1));

          const pageNum = item.numeroConsecutivo || (idx + 1);
          const totalPages = item.totalPaginas || listaCuentas.length;
          const pageLabel = totalPages > 1 ? `PÁG. ${pageNum} / ${totalPages}` : `PÁG. ${pageNum}`;

          return (
            <div
              key={item.id || idx}
              id={`cuenta-doc-${item.id || idx}`}
              className="bg-white text-black p-8 sm:p-12 border border-slate-300 rounded-2xl shadow-xl print:shadow-none print:border-none print:rounded-none print:p-0 print:m-0 font-sans print:h-screen print:max-h-screen print:flex print:flex-col print:justify-between page-break-after-always"
              style={{
                width: '100%',
                maxWidth: '210mm',
                minHeight: '270mm',
                margin: '0 auto',
                boxSizing: 'border-box',
                backgroundColor: '#ffffff'
              }}
            >
              {/* DATE AND MUNICIPALITY TOP HEADER WITH PAGE NUMBER AT TOP-RIGHT */}
              <div className="flex justify-between items-center text-xs font-bold tracking-wide border-b-2 border-black pb-1.5 mb-6 uppercase text-slate-900">
                <span>{municipioUpper} {fechaEmisionUpper}</span>
                <span className="font-extrabold text-slate-900 tracking-normal">{pageLabel}</span>
              </div>

              {/* LOGO & COMPANY HEADER */}
              <div className="text-center space-y-1 mb-6">
                <div className="flex justify-center items-center mb-3">
                  <CamarcaLogo height={56} />
                </div>

                <h1 className="text-base font-black tracking-widest text-slate-900 uppercase">
                  CUENTA DE COBRO
                </h1>
                <div className="text-xs font-bold text-slate-800">CAMARCA SAS</div>
                <div className="text-xs font-semibold text-slate-700">NIT 900.504.241-7</div>
              </div>

              {/* DEBE A SECTION */}
              <div className="text-center space-y-1 mb-6 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">DEBE A:</div>
                <div className="text-base font-black text-slate-900 uppercase tracking-wide">
                  {encargadoUpper}
                </div>
                <div className="text-xs font-bold text-slate-800">
                  C.C {item.cedula}
                </div>
              </div>

              {/* CONCEPTO TEXT PARAGRAPH (EXACT USER REQUEST) */}
              <div className="text-justify text-xs leading-relaxed text-slate-900 font-normal mb-6 p-3.5 border-l-4 border-black bg-slate-50/70 rounded-r-md">
                POR CONCEPTO DE PRESTACION DE SERVICIOS DEL SPU, PUBLICACION DE LISTAS DE CORREO, ADMISION SIPOST Y DISTRIBUCION DE PIEZAS POSTALES EN EL EXPENDIO DE 4-72 UBICADO EN EL MUNICIPIO DE <strong className="font-bold">{municipioUpper}</strong> DEL CENTRO OPERATIVO <strong className="font-bold">{centroOpUpper}</strong> EL CUAL PERTENECE A LA REGIONAL <strong className="font-bold">{regionalUpper}</strong> DURANTE EL MES DE <strong className="font-bold">{mes}</strong> DEL AÑO <strong className="font-bold">{ano}</strong>
              </div>

              {/* BREAKDOWN TABLE WITH BLACK BORDER GRID (MATCHING IMAGE 1 & 2 EXACTLY) */}
              <div className="mb-8">
                <table className="w-full border-collapse border border-black text-xs">
                  <tbody>
                    <tr className="border-b border-black">
                      <td className="p-2.5 font-semibold text-slate-900 border-r border-black uppercase">
                        VALOR CARGO BASICO
                      </td>
                      <td className="p-2.5 font-mono font-bold text-slate-900 text-right w-44">
                        {formatCurrency(cargoBasico)}
                      </td>
                    </tr>
                    <tr className="border-b border-black">
                      <td className="p-2.5 font-semibold text-slate-900 border-r border-black uppercase">
                        SUBSIDIO DE INTERNET USO DE SIPOST - SI APLICA
                      </td>
                      <td className="p-2.5 font-mono font-bold text-slate-900 text-right">
                        {subsidioInternet > 0 ? formatCurrency(subsidioInternet) : '$ '}
                      </td>
                    </tr>
                    <tr className="border-b border-black">
                      <td className="p-2.5 font-semibold text-slate-900 border-r border-black uppercase">
                        VARIABLE GESTION DE PIEZAS POSTALES, LISTAS DE CORREO, ADMISION CREDITO- SI APLICA
                      </td>
                      <td className="p-2.5 font-mono font-bold text-slate-900 text-right">
                        {formatCurrency(variableGestion)}
                      </td>
                    </tr>
                    <tr className="border-b border-black">
                      <td className="p-2.5 font-semibold text-slate-900 border-r border-black uppercase">
                        RETENCION {item.porcentajeRetencion || 1}%
                      </td>
                      <td className="p-2.5 font-mono font-bold text-red-600 text-right">
                        {formatCurrency(retef1)}
                      </td>
                    </tr>
                    <tr className="font-bold bg-slate-50/30">
                      <td className="p-3 font-bold text-slate-900 border-r border-black uppercase align-top">
                        <div className="text-xs font-black tracking-wide">NETO A PAGAR</div>
                        <div className="text-[10px] font-semibold text-slate-700 mt-1 uppercase tracking-tight leading-snug">
                          ( {numeroALetras(neto)} )
                        </div>
                      </td>
                      <td className="p-3 font-mono font-black text-slate-900 text-right text-sm align-middle">
                        {formatCurrency(neto)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* BANK DETAILS & SIGNATURE FOOTER */}
              <div className="space-y-6 text-xs mt-auto">
                <div className="space-y-2 font-medium">
                  <div>CUENTA BANCARIA__________________________</div>
                  <div>BANCO___________________________________</div>
                </div>

                <div className="pt-6 space-y-1">
                  <div className="w-72 border-b border-black mb-1"></div>
                  <div className="font-bold text-sm uppercase text-slate-900">{encargadoUpper}</div>
                  <div className="font-semibold text-slate-800">C.C {item.cedula}</div>
                </div>

                <div className="pt-2">
                  <div className="w-full border-b border-black mb-1"></div>
                  <div className="flex justify-between items-center text-slate-800">
                    <div className="font-semibold uppercase text-[11px]">
                      DIRECCION: {item.direccion || 'SEDE PRINCIPAL EXPENDIO'} {item.telefono ? `| TEL: ${item.telefono}` : ''}
                    </div>
                    <div className="font-bold text-slate-900 text-xs">
                      {pageLabel}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Global CSS for Print Media Letter sizing */}
      <style>{`
        @media print {
          @page {
            size: letter portrait;
            margin: 10mm;
          }
          body {
            background-color: white !important;
            color: black !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .page-break-after-always {
            page-break-after: always;
            break-after: page;
          }
        }
      `}</style>
    </div>
  );
};
