import React, { useState, useRef } from 'react';
import { ResultadoConciliacionAI, ExpendioData } from '../types';
import { formatPesos } from '../utils/formatters';
import { 
  Sparkles, 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Loader2, 
  MapPin, 
  Calendar, 
  DollarSign, 
  Check, 
  Eye, 
  ExternalLink,
  Receipt,
  FileCheck,
  AlertTriangle,
  RefreshCw,
  Building2,
  UserCheck,
  Columns,
  Maximize2,
  ZoomIn,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface ConciliacionCuentasAIModalProps {
  isOpen: boolean;
  onClose: () => void;
  expendiosList: ExpendioData[];
  onSuccessReconciliation: () => void;
}

export const ConciliacionCuentasAIModal: React.FC<ConciliacionCuentasAIModalProps> = ({
  isOpen,
  onClose,
  expendiosList,
  onSuccessReconciliation,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [resultados, setResultados] = useState<ResultadoConciliacionAI[]>([]);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingBatch, setSavingBatch] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Estados para vista previa y modo Split View
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [splitViewMode, setSplitViewMode] = useState<boolean>(true);
  const [previewQueueFile, setPreviewQueueFile] = useState<{ file: File; url: string } | null>(null);
  const [expandedCardPreviewId, setExpandedCardPreviewId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Extraer lista única ordenada de municipios para desplegables
  const municipiosOptions = Array.from(
    new Set<string>(
      expendiosList
        .map((e) => (e.municipio || e.localidad || '').trim().toUpperCase())
        .filter((mun): mun is string => Boolean(mun))
    )
  ).sort((a, b) => a.localeCompare(b));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArr = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...filesArr]);
      setFeedbackMsg(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArr = Array.from(e.dataTransfer.files);
      setSelectedFiles((prev) => [...prev, ...filesArr]);
      setFeedbackMsg(null);
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    if (previewQueueFile && previewQueueFile.file === selectedFiles[index]) {
      URL.revokeObjectURL(previewQueueFile.url);
      setPreviewQueueFile(null);
    }
  };

  const handleStartAIAnalysis = async () => {
    if (selectedFiles.length === 0) return;

    setIsAnalyzing(true);
    setFeedbackMsg(null);

    const formData = new FormData();
    selectedFiles.forEach((file) => {
      formData.append('archivos', file);
    });

    try {
      const res = await fetch('/api/admin/conciliar-soporte-ai', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.success && Array.isArray(data.data)) {
        setResultados(data.data);
        if (data.data.length > 0) {
          setSelectedResultId(data.data[0].id);
        }
        setSelectedFiles([]);
        setFeedbackMsg({
          type: 'success',
          text: `✓ Análisis completado: ${data.data.length} cuenta(s) procesada(s) por OCR y listas para conciliar con vista previa.`,
        });
      } else {
        setFeedbackMsg({
          type: 'error',
          text: data.message || 'Error durante el análisis inteligente del documento.',
        });
      }
    } catch (err: any) {
      console.error('Error al analizar archivos:', err);
      setFeedbackMsg({
        type: 'error',
        text: 'Error de comunicación con el servidor al procesar los documentos.',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUpdateMunicipio = (id: string, newMun: string) => {
    setResultados((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            municipio: newMun.toUpperCase(),
            requiereRevisionMunicipio: false,
            municipioConfianza: 'Alta',
            estadoConciliacion: item.tieneSoportePago ? 'Listo' : 'RevisionManual',
          };
        }
        return item;
      })
    );
  };

  const mesesOptions = [
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
  ];

  const handleUpdateMes = (id: string, newMes: string) => {
    setResultados((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const newPeriodo = `${newMes.toUpperCase()} ${item.anio || '2026'}`;
          return {
            ...item,
            mes: newMes.toUpperCase(),
            periodo: newPeriodo,
          };
        }
        return item;
      })
    );
  };

  const handleApproveSingle = async (item: ResultadoConciliacionAI) => {
    if (!item.municipio) {
      setFeedbackMsg({
        type: 'error',
        text: 'Por favor indica o selecciona el municipio antes de aprobar la cuenta.',
      });
      return;
    }

    setSavingId(item.id);
    setFeedbackMsg(null);

    try {
      const res = await fetch('/api/admin/aprobar-conciliacion-cuenta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...item,
          soporteUrl: item.archivoUrl,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setResultados((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, estadoConciliacion: 'Cancelado' } : r))
        );
        setFeedbackMsg({
          type: 'success',
          text: `✓ ¡Cuenta de ${item.municipio} (${item.periodo}) cancelada y conciliada exitosamente!`,
        });
        onSuccessReconciliation();
      } else {
        setFeedbackMsg({
          type: 'error',
          text: data.message || 'Error al aprobar y cancelar la cuenta.',
        });
      }
    } catch (err) {
      console.error('Error al aprobar conciliación individual:', err);
      setFeedbackMsg({
        type: 'error',
        text: 'Error de conexión al procesar la aprobación.',
      });
    } finally {
      setSavingId(null);
    }
  };

  const handleApproveBatch = async () => {
    const listToApprove = resultados.filter(
      (r) => r.estadoConciliacion !== 'Cancelado' && r.municipio.trim() !== ''
    );

    if (listToApprove.length === 0) {
      setFeedbackMsg({
        type: 'error',
        text: 'No hay cuentas con municipio verificado listas para aprobar.',
      });
      return;
    }

    setSavingBatch(true);
    setFeedbackMsg(null);

    try {
      const res = await fetch('/api/admin/aprobar-conciliacion-lote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuentas: listToApprove }),
      });

      const data = await res.json();

      if (data.success) {
        setResultados((prev) =>
          prev.map((r) =>
            listToApprove.some((item) => item.id === r.id)
              ? { ...r, estadoConciliacion: 'Cancelado' }
              : r
          )
        );
        setFeedbackMsg({
          type: 'success',
          text: `✓ ¡Lote de ${listToApprove.length} cuenta(s) conciliadas y marcadas en CANCELADO!`,
        });
        onSuccessReconciliation();
      } else {
        setFeedbackMsg({
          type: 'error',
          text: data.message || 'Error al aprobar lote de cuentas.',
        });
      }
    } catch (err) {
      console.error('Error al aprobar lote de conciliación:', err);
      setFeedbackMsg({
        type: 'error',
        text: 'Error de conexión durante el procesamiento en lote.',
      });
    } finally {
      setSavingBatch(false);
    }
  };

  const readyToApproveCount = resultados.filter(
    (r) => r.estadoConciliacion !== 'Cancelado' && Boolean(r.municipio)
  ).length;

  const activeSelectedItem =
    resultados.find((r) => r.id === selectedResultId) || resultados[0] || null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-7xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-gradient-to-tr from-amber-500 to-amber-400 text-slate-950 rounded-xl shadow-md">
              <FileCheck className="w-5 h-5 fill-slate-950" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base sm:text-lg font-black text-slate-100 tracking-tight">
                  Carga & Conciliación de Cuentas de Cobro
                </h3>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  Con Vista Previa
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Carga documentos escaneados (PDF/Imagen), visualiza la cuenta antes de conciliar y aprueba con soporte verificado.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {resultados.length > 0 && (
              <button
                type="button"
                onClick={() => setSplitViewMode(!splitViewMode)}
                className={`hidden md:flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  splitViewMode
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
                title="Alternar entre vista dividida con visor y vista de lista"
              >
                <Columns className="w-3.5 h-3.5" />
                <span>{splitViewMode ? 'Visor Lateral Activo' : 'Activar Visor Lateral'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Feedback Msg */}
          {feedbackMsg && (
            <div
              className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center space-x-2 ${
                feedbackMsg.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-300'
                  : 'bg-red-950/60 border-red-800/50 text-red-300'
              }`}
            >
              {feedbackMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              )}
              <span>{feedbackMsg.text}</span>
            </div>
          )}

          {/* Upload Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-700 hover:border-amber-400/70 bg-slate-950/50 hover:bg-slate-950/80 rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all duration-200 group"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              accept=".pdf, .png, .jpg, .jpeg"
              className="hidden"
            />
            <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
              <Upload className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-200">
              Arrastra o haz clic para subir las Cuentas de Cobro escaneadas
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-lg mx-auto">
              Soporta documentos en formato <strong>PDF</strong> o imágenes (<strong>JPG, PNG</strong>) con la cuenta de cobro y el comprobante o tirilla bancaria adherida.
            </p>
          </div>

          {/* Selected Files Queue with Instant Previews */}
          {selectedFiles.length > 0 && (
            <div className="bg-slate-950/80 p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-300 font-semibold">
                <span className="flex items-center space-x-2">
                  <span className="font-bold text-amber-400">{selectedFiles.length}</span>
                  <span>documento(s) listos para análisis y conciliación</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedFiles([])}
                  className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                >
                  Limpiar lista
                </button>
              </div>

              {/* Grid of Queued Files with Previews */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {selectedFiles.map((file, idx) => {
                  const isPdf = file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between bg-slate-900 border border-slate-800 hover:border-slate-700 p-2.5 rounded-xl text-xs group transition-colors"
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <FileText className={`w-4 h-4 shrink-0 ${isPdf ? 'text-red-400' : 'text-amber-400'}`} />
                        <div className="truncate">
                          <span className="truncate text-slate-200 font-mono text-[11px] block">{file.name}</span>
                          <span className="text-[10px] text-slate-500">{(file.size / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const url = URL.createObjectURL(file);
                            setPreviewQueueFile({ file, url });
                          }}
                          className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 cursor-pointer transition-colors"
                          title="Previsualizar documento cargado"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFile(idx);
                          }}
                          className="p-1 rounded-lg text-slate-500 hover:text-red-400 cursor-pointer transition-colors"
                          title="Quitar de la lista"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleStartAIAnalysis}
                disabled={isAnalyzing}
                className="w-full bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black py-3 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-70 mt-2"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Extrayendo datos OCR y preparando conciliación...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-slate-950" />
                    <span>Iniciar Extracción OCR y Conciliación</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Results Section with Split-View Preview */}
          {resultados.length > 0 && (
            <div className="space-y-4 pt-2">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                    <FileCheck className="w-4 h-4 text-emerald-400" />
                    <span>Cuentas Listas para Conciliar ({resultados.length})</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Selecciona cualquier cuenta para ver su <strong>preview físico</strong> a la derecha y autorizar la conciliación con un solo clic.
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  {readyToApproveCount > 0 && (
                    <button
                      type="button"
                      onClick={handleApproveBatch}
                      disabled={savingBatch}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center space-x-2 shadow-lg transition-all cursor-pointer disabled:opacity-60"
                    >
                      {savingBatch ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Aprobar y Cancelar Todas ({readyToApproveCount})</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Main Split Layout: Left List + Right Preview Panel */}
              <div className={`grid gap-5 ${splitViewMode ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1'}`}>
                
                {/* Left Column: Account Cards */}
                <div className={`${splitViewMode ? 'lg:col-span-6 xl:col-span-5' : 'w-full'} space-y-3.5`}>
                  {resultados.map((item) => {
                    const isCancelled = item.estadoConciliacion === 'Cancelado';
                    const isSelected = item.id === selectedResultId;

                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedResultId(item.id)}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'ring-2 ring-amber-400 bg-slate-900 shadow-xl border-amber-500/50'
                            : isCancelled
                            ? 'bg-emerald-950/20 border-emerald-800/60 opacity-80 hover:border-emerald-600'
                            : item.tieneSoportePago && item.municipio
                            ? 'bg-slate-900 border-slate-700/80 hover:border-slate-600'
                            : 'bg-amber-950/20 border-amber-800/60'
                        }`}
                      >
                        <div className="space-y-3">
                          {/* Header row of card */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                              {/* Page indicator */}
                              {item.hojaNumero && item.totalHojas && item.totalHojas > 1 && (
                                <span className="inline-flex items-center text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-md">
                                  <FileText className="w-3 h-3 mr-1 text-sky-400" />
                                  Hoja {item.hojaNumero} de {item.totalHojas}
                                </span>
                              )}

                              {/* Deterministic matching badge */}
                              {item.estadoDeterminista === 'MATCH_EXACTO' ? (
                                <span className="inline-flex items-center text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-md">
                                  <Check className="w-3 h-3 mr-1 text-emerald-400" /> MATCH EXACTO
                                </span>
                              ) : item.estadoDeterminista === 'DUPLICADO_EXACTO' ? (
                                <span className="inline-flex items-center text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded-md">
                                  <AlertCircle className="w-3 h-3 mr-1 text-purple-400" /> DUPLICADO (SHA-256)
                                </span>
                              ) : item.estadoDeterminista === 'AMBIGUA' ? (
                                <span className="inline-flex items-center text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-md">
                                  <AlertTriangle className="w-3 h-3 mr-1 text-amber-400" /> AMBIGUA
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 px-2 py-0.5 rounded-md">
                                  <AlertCircle className="w-3 h-3 mr-1 text-rose-400" /> SIN COINCIDENCIA
                                </span>
                              )}

                              {isCancelled ? (
                                <span className="inline-flex items-center text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-md">
                                  <Check className="w-3 h-3 mr-1" /> CANCELADO
                                </span>
                              ) : item.tieneSoportePago ? (
                                <span className="inline-flex items-center text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                                  <Receipt className="w-3 h-3 mr-1" /> SOPORTE BANCARIO
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-md">
                                  <AlertTriangle className="w-3 h-3 mr-1" /> SIN SOPORTE
                                </span>
                              )}
                            </div>

                            <span className="text-xs font-mono font-black text-amber-400 shrink-0">
                              {formatPesos(item.valorCobro || 0)}
                            </span>
                          </div>

                          {/* Encargado & Cédula */}
                          <div>
                            <div className="text-xs font-bold text-slate-100">
                              {item.encargado || 'CONTRATISTA'}
                            </div>
                            {item.cedula && (
                              <div className="text-[11px] text-slate-400 font-mono">
                                Cédula / NIT: <strong className="text-slate-300">{item.cedula}</strong>
                              </div>
                            )}
                          </div>

                          {/* Municipio & Periodo Selectors */}
                          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                            <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                              <span className="text-[10px] text-slate-400 font-bold block mb-1">Municipio:</span>
                              <select
                                value={item.municipio}
                                onChange={(e) => handleUpdateMunicipio(item.id, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full bg-slate-900 border border-slate-700 text-amber-300 font-bold text-xs rounded-lg px-2 py-1 focus:outline-none"
                              >
                                <option value="">-- Seleccionar --</option>
                                {municipiosOptions.map((mun) => (
                                  <option key={mun} value={mun}>
                                    {mun}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                              <span className="text-[10px] text-slate-400 font-bold block mb-1">Mes y Periodo:</span>
                              <select
                                value={item.mes || 'ENERO'}
                                onChange={(e) => handleUpdateMes(item.id, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full bg-slate-900 border border-slate-700 text-slate-200 font-semibold text-xs rounded-lg px-2 py-1 focus:outline-none"
                              >
                                {mesesOptions.map((m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Action Buttons Row */}
                          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedResultId(item.id);
                                if (!splitViewMode) {
                                  setExpandedCardPreviewId(expandedCardPreviewId === item.id ? null : item.id);
                                }
                              }}
                              className="text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center space-x-1 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>{isSelected && splitViewMode ? '✓ En Visor Lateral' : '👁️ Ver Preview de Cuenta'}</span>
                            </button>

                            {!isCancelled ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleApproveSingle(item);
                                }}
                                disabled={savingId === item.id || !item.municipio}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1 shadow transition-all cursor-pointer disabled:opacity-50"
                              >
                                {savingId === item.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Check className="w-3.5 h-3.5" />
                                )}
                                <span>Conciliar</span>
                              </button>
                            ) : (
                              <span className="text-emerald-400 text-xs font-bold flex items-center space-x-1">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Cancelado</span>
                              </span>
                            )}
                          </div>

                          {/* Inline Accordion Preview when Split-View is closed */}
                          {!splitViewMode && expandedCardPreviewId === item.id && (
                            <div className="mt-3 p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2 animate-fadeIn">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-slate-300">Documento Escaneado Físico</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActivePreviewUrl(item.archivoUrl);
                                  }}
                                  className="text-amber-400 hover:underline flex items-center space-x-1"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>Pantalla Completa</span>
                                </button>
                              </div>
                              {item.mimeType?.includes('pdf') || item.archivoUrl.toLowerCase().endsWith('.pdf') ? (
                                <iframe
                                  src={item.archivoUrl}
                                  title="Documento PDF"
                                  className="w-full h-80 rounded-lg border border-slate-800"
                                />
                              ) : (
                                <img
                                  src={item.archivoUrl}
                                  alt="Preview"
                                  className="w-full max-h-80 object-contain mx-auto rounded-lg border border-slate-800 bg-black/40"
                                />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right Column: PREVIEW PANEL DE LA CUENTA A CONCILIAR (Split-View Workspace) */}
                {splitViewMode && activeSelectedItem && (
                  <div className="hidden lg:block lg:col-span-6 xl:col-span-7 sticky top-0 space-y-4">
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
                      {/* Preview Header */}
                      <div className="flex items-start justify-between border-b border-slate-800 pb-3 gap-3">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              Preview de la Cuenta a Conciliar
                            </span>
                            <span className="text-xs font-bold text-slate-200">
                              {activeSelectedItem.municipio} • {activeSelectedItem.periodo}
                            </span>
                          </div>
                          <h4 className="text-sm font-black text-slate-100 mt-1">
                            {activeSelectedItem.encargado} (C.C. {activeSelectedItem.cedula})
                          </h4>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() => setActivePreviewUrl(activeSelectedItem.archivoUrl)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1 cursor-pointer"
                            title="Pantalla Completa"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                            <span>Ampliar</span>
                          </button>

                          <a
                            href={activeSelectedItem.archivoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-semibold flex items-center space-x-1 cursor-pointer"
                            title="Abrir en nueva pestaña"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Pestaña</span>
                          </a>
                        </div>
                      </div>

                      {/* Main Document Viewer */}
                      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden min-h-[460px] flex items-center justify-center p-2 relative shadow-inner">
                        {activeSelectedItem.mimeType?.includes('pdf') || activeSelectedItem.archivoUrl.toLowerCase().endsWith('.pdf') ? (
                          <iframe
                            src={activeSelectedItem.archivoUrl}
                            title="Documento PDF de Cuenta"
                            className="w-full h-[520px] rounded-lg border border-slate-800 bg-slate-950"
                          />
                        ) : (
                          <img
                            src={activeSelectedItem.archivoUrl}
                            alt="Vista previa de cuenta de cobro física"
                            className="max-h-[520px] max-w-full object-contain mx-auto rounded-lg shadow-lg"
                          />
                        )}
                      </div>

                      {/* OCR Data Extraction Breakdown */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                        <div>
                          <span className="text-[10px] text-slate-500 font-semibold block uppercase">Valor OCR:</span>
                          <span className="font-mono font-bold text-amber-400 text-sm">
                            {formatPesos(activeSelectedItem.valorCobro || 0)}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-500 font-semibold block uppercase">Soporte Pago:</span>
                          <span className={`font-bold ${activeSelectedItem.tieneSoportePago ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {activeSelectedItem.tieneSoportePago ? '✓ Detectado' : 'Sin Soporte'}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-500 font-semibold block uppercase">Estado Determinístico:</span>
                          <span className="font-bold text-slate-200">
                            {activeSelectedItem.estadoDeterminista}
                          </span>
                        </div>

                        {activeSelectedItem.datosSoporte?.entidad && (
                          <div className="col-span-full pt-1 border-t border-slate-800 text-[11px] text-slate-400">
                            Entidad Bancaria: <strong className="text-slate-200">{activeSelectedItem.datosSoporte.entidad}</strong> • Aprobación:{' '}
                            <strong className="text-slate-200 font-mono">{activeSelectedItem.datosSoporte.numeroAprobacion || 'N/D'}</strong> • Pagado:{' '}
                            <strong className="text-emerald-400 font-mono">{formatPesos(activeSelectedItem.datosSoporte.valorPagado || 0)}</strong>
                          </div>
                        )}
                      </div>

                      {/* Action Button inside Preview Panel */}
                      <div className="pt-2">
                        {activeSelectedItem.estadoConciliacion !== 'Cancelado' ? (
                          <button
                            type="button"
                            onClick={() => handleApproveSingle(activeSelectedItem)}
                            disabled={savingId === activeSelectedItem.id || !activeSelectedItem.municipio}
                            className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-black py-3 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 shadow-xl cursor-pointer disabled:opacity-50 transition-all transform active:scale-98"
                          >
                            {savingId === activeSelectedItem.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-white" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-white" />
                            )}
                            <span>✓ Aprobar y Conciliar Esta Cuenta ({activeSelectedItem.municipio})</span>
                          </button>
                        ) : (
                          <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-600/50 text-emerald-300 font-bold text-xs text-center flex items-center justify-center space-x-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <span>Esta cuenta ya ha sido conciliada y marcada como CANCELADO</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/70 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shrink-0">
          <span className="text-slate-500">
            Conciliación 100% Determinística (OCR de archivo + PostgreSQL) CAMARCA S.A.S. & 4-72
          </span>
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
          >
            Cerrar Ventana
          </button>
        </div>
      </div>

      {/* Fullscreen Document Preview Modal */}
      {activePreviewUrl && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950">
              <span className="text-xs font-bold text-slate-200">
                Visualización de Cuenta de Cobro Físico y Soporte de Pago
              </span>
              <div className="flex items-center space-x-2">
                <a
                  href={activePreviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-amber-400 hover:underline flex items-center space-x-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Abrir en nueva pestaña</span>
                </a>
                <button
                  type="button"
                  onClick={() => setActivePreviewUrl(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 bg-slate-950 flex items-center justify-center">
              {activePreviewUrl.toLowerCase().endsWith('.pdf') ? (
                <iframe
                  src={activePreviewUrl}
                  title="Documento PDF"
                  className="w-full h-[75vh] rounded-xl border border-slate-800"
                />
              ) : (
                <img
                  src={activePreviewUrl}
                  alt="Soporte Escaneado"
                  className="max-h-[80vh] max-w-full object-contain rounded-xl shadow-2xl border border-slate-800"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Queue File Preview Modal */}
      {previewQueueFile && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-slate-200">
                  Preview de Archivo en Cola: {previewQueueFile.file.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(previewQueueFile.url);
                  setPreviewQueueFile(null);
                }}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 bg-slate-950 flex items-center justify-center">
              {previewQueueFile.file.type.includes('pdf') || previewQueueFile.file.name.toLowerCase().endsWith('.pdf') ? (
                <iframe
                  src={previewQueueFile.url}
                  title="Documento PDF"
                  className="w-full h-[65vh] rounded-xl border border-slate-800"
                />
              ) : (
                <img
                  src={previewQueueFile.url}
                  alt="Preview Archivo"
                  className="max-h-[70vh] max-w-full object-contain rounded-xl shadow-2xl border border-slate-800"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
