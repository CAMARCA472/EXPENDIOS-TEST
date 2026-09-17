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
  UserCheck
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Extract unique sorted list of municipios for dropdowns
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
        setSelectedFiles([]);
        setFeedbackMsg({
          type: 'success',
          text: `✓ Análisis completado: ${data.data.length} cuenta(s) analizada(s) con Inteligencia Artificial.`,
        });
      } else {
        setFeedbackMsg({
          type: 'error',
          text: data.message || 'Error durante el análisis inteligente del documento.',
        });
      }
    } catch (err: any) {
      console.error('Error al analizar archivos con IA:', err);
      setFeedbackMsg({
        type: 'error',
        text: 'Error de comunicación con el servidor al procesar los documentos con IA.',
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
          text: `✓ ¡Cuenta de ${item.municipio} (${item.periodo}) cancelada y finalizada con soporte de pago!`,
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
          text: `✓ ¡Éxito! ${listToApprove.length} cuentas de cobro han sido aprobadas y marcadas en estado CANCELADO con su soporte.`,
        });
        onSuccessReconciliation();
      } else {
        setFeedbackMsg({
          type: 'error',
          text: data.message || 'Error al aprobar el lote de cuentas.',
        });
      }
    } catch (err) {
      console.error('Error aprobando lote:', err);
      setFeedbackMsg({
        type: 'error',
        text: 'Error de red al procesar la aprobación masiva.',
      });
    } finally {
      setSavingBatch(false);
    }
  };

  const readyToApproveCount = resultados.filter(
    (r) => r.estadoConciliacion !== 'Cancelado' && r.municipio.trim() !== ''
  ).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden my-8 max-h-[92vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <span>Auditoría & Conciliación IA de Cuentas de Cobro</span>
                <span className="bg-amber-400/10 text-amber-400 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-amber-400/20">
                  Gemini Flash 3.7
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Sube cuentas de cobro escaneadas (PDF o imagen). La IA verificará el municipio, mes y la tirilla de pago adjunta para pasarlas a estado <strong className="text-emerald-400">Cancelado</strong>.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-2 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          
          {/* Feedback message banner */}
          {feedbackMsg && (
            <div
              className={`p-3.5 rounded-xl text-xs font-medium flex items-center space-x-2.5 border ${
                feedbackMsg.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                  : 'bg-red-950/60 border-red-800 text-red-300'
              }`}
            >
              {feedbackMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{feedbackMsg.text}</span>
            </div>
          )}

          {/* Upload Area */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="border-2 border-dashed border-slate-700 hover:border-amber-400/60 bg-slate-950/50 p-6 rounded-2xl text-center transition-all cursor-pointer group"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 text-amber-400 mx-auto flex items-center justify-center mb-3 group-hover:scale-105 group-hover:border-amber-400/40 transition-all">
              <Upload className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-200">
              Arrastra o haz clic para subir tus Cuentas de Cobro escaneadas
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-lg mx-auto">
              Soporta documentos en formato <strong>PDF</strong> o imágenes (<strong>JPG, PNG</strong>) con la cuenta de cobro y el comprobante / tirilla bancaria adherida.
            </p>
          </div>

          {/* Selected Files Queue */}
          {selectedFiles.length > 0 && (
            <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-300 font-semibold">
                <span>{selectedFiles.length} archivo(s) listo(s) para procesar</span>
                <button
                  type="button"
                  onClick={() => setSelectedFiles([])}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                >
                  Limpiar lista
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {selectedFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between bg-slate-900 border border-slate-800 p-2.5 rounded-lg text-xs"
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="truncate text-slate-300 font-mono text-[11px]">{file.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile(idx);
                      }}
                      className="text-slate-500 hover:text-red-400 ml-1.5 p-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={handleStartAIAnalysis}
                disabled={isAnalyzing}
                className="w-full bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-bold py-3 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-70 mt-2"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Analizando documentos con Inteligencia Artificial...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-slate-950" />
                    <span>Iniciar Análisis Inteligente de Soportes</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* AI Analysis Results Section */}
          {resultados.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                    <FileCheck className="w-4 h-4 text-emerald-400" />
                    <span>Resultados del Análisis IA ({resultados.length})</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Revisa las cuentas detectadas. Si alguna requiere verificar el municipio, puedes seleccionarlo en el menú desplegable.
                  </p>
                </div>

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

              {/* Cards Grid */}
              <div className="space-y-3.5">
                {resultados.map((item) => {
                  const isCancelled = item.estadoConciliacion === 'Cancelado';

                  return (
                    <div
                      key={item.id}
                      className={`p-4 rounded-xl border transition-all ${
                        isCancelled
                          ? 'bg-emerald-950/20 border-emerald-800/60 opacity-80'
                          : item.tieneSoportePago && item.municipio
                          ? 'bg-slate-900 border-slate-700/80 hover:border-amber-500/50'
                          : 'bg-amber-950/20 border-amber-800/60'
                      }`}
                    >
                      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                        
                        {/* File preview thumbnail & primary info */}
                        <div className="flex items-start space-x-3.5 flex-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => setActivePreviewUrl(item.archivoUrl)}
                            className="w-14 h-16 bg-slate-950 border border-slate-800 rounded-lg overflow-hidden shrink-0 flex flex-col items-center justify-center hover:border-amber-400 transition-colors group relative cursor-pointer"
                            title="Ver documento completo"
                          >
                            {item.mimeType?.includes('pdf') ? (
                              <FileText className="w-6 h-6 text-red-400" />
                            ) : (
                              <img
                                src={item.archivoUrl}
                                alt="Miniatura"
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              />
                            )}
                            <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Eye className="w-4 h-4 text-white" />
                            </div>
                          </button>

                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                              {/* Status Badge & Page Indicator */}
                              {item.hojaNumero && item.totalHojas && item.totalHojas > 1 && (
                                <span className="inline-flex items-center text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-md">
                                  <FileText className="w-3 h-3 mr-1 text-sky-400" />
                                  Hoja {item.hojaNumero} de {item.totalHojas}
                                </span>
                              )}

                              {isCancelled ? (
                                <span className="inline-flex items-center text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-md">
                                  <Check className="w-3 h-3 mr-1" /> CANCELADO / PAGADO
                                </span>
                              ) : item.tieneSoportePago ? (
                                <span className="inline-flex items-center text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                                  <Receipt className="w-3 h-3 mr-1" /> SOPORTE DE PAGO VÁLIDO
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-md">
                                  <AlertTriangle className="w-3 h-3 mr-1" /> SIN SOPORTE VISIBLE
                                </span>
                              )}

                              <span className="text-xs font-bold text-slate-100 truncate">
                                {item.encargado || 'CONTRATISTA'}
                              </span>
                              {item.cedula && (
                                <span className="text-[11px] text-slate-400 font-mono">
                                  (C.C. {item.cedula})
                                </span>
                              )}
                            </div>

                            {/* Municipality & Month identification with editable selector */}
                            <div className="flex items-center space-x-3 flex-wrap gap-y-1 text-xs text-slate-300">
                              <div className="flex items-center space-x-1">
                                <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span className="font-semibold text-slate-400">Municipio:</span>
                                {item.requiereRevisionMunicipio || !item.municipio ? (
                                  <select
                                    value={item.municipio}
                                    onChange={(e) => handleUpdateMunicipio(item.id, e.target.value)}
                                    className="bg-amber-950/80 border border-amber-600 text-amber-200 text-xs rounded-lg px-2 py-0.5 font-bold focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
                                  >
                                    <option value="">-- Selecciona Municipio --</option>
                                    {municipiosOptions.map((mun) => (
                                      <option key={mun} value={mun} className="bg-slate-900 text-slate-100">
                                        {mun}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="flex items-center space-x-1">
                                    <span className="font-bold text-amber-400">{item.municipio}</span>
                                    <select
                                      value={item.municipio}
                                      onChange={(e) => handleUpdateMunicipio(item.id, e.target.value)}
                                      className="bg-transparent text-slate-500 hover:text-slate-300 text-[10px] border-b border-dashed border-slate-600 cursor-pointer"
                                    >
                                      {municipiosOptions.map((mun) => (
                                        <option key={mun} value={mun} className="bg-slate-900 text-slate-100">
                                          {mun}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center space-x-1">
                                <Calendar className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                <span className="font-semibold text-slate-400">Mes:</span>
                                <select
                                  value={item.mes || 'ENERO'}
                                  onChange={(e) => handleUpdateMes(item.id, e.target.value)}
                                  className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-md px-1.5 py-0.5 font-semibold cursor-pointer"
                                >
                                  {mesesOptions.map((m) => (
                                    <option key={m} value={m} className="bg-slate-900 text-slate-100">
                                      {m}
                                    </option>
                                  ))}
                                </select>
                                <span className="font-mono text-slate-400 text-[11px]">{item.anio || '2026'}</span>
                              </div>

                              {item.valorCobro > 0 && (
                                <div className="flex items-center space-x-1">
                                  <DollarSign className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                  <span className="font-semibold text-slate-400">Valor:</span>
                                  <span className="font-mono font-bold text-emerald-400">
                                    {formatPesos(item.valorCobro)}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Payment details extracted by IA */}
                            {item.datosSoporte && item.datosSoporte.entidad && (
                              <div className="text-[11px] text-slate-400 bg-slate-950/60 px-2.5 py-1 rounded-md border border-slate-800/80 flex items-center space-x-2 flex-wrap">
                                <span className="text-emerald-400 font-semibold">Tirilla detectada:</span>
                                <span>{item.datosSoporte.entidad}</span>
                                {item.datosSoporte.valorPagado && (
                                  <span>• Pagado: {formatPesos(item.datosSoporte.valorPagado)}</span>
                                )}
                                {item.datosSoporte.numeroAprobacion && (
                                  <span>• Aprobación: {item.datosSoporte.numeroAprobacion}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center space-x-2 shrink-0 self-end lg:self-center">
                          <button
                            type="button"
                            onClick={() => setActivePreviewUrl(item.archivoUrl)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
                            title="Ver documento completo"
                          >
                            <Eye className="w-4 h-4" />
                            <span className="hidden sm:inline">Ver Soporte</span>
                          </button>

                          {!isCancelled ? (
                            <button
                              type="button"
                              onClick={() => handleApproveSingle(item)}
                              disabled={savingId === item.id || !item.municipio}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow transition-all cursor-pointer disabled:opacity-50"
                            >
                              {savingId === item.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Check className="w-4 h-4" />
                              )}
                              <span>Marcar como CANCELADO</span>
                            </button>
                          ) : (
                            <div className="flex items-center text-emerald-400 text-xs font-bold space-x-1 bg-emerald-950/40 border border-emerald-800/60 px-3 py-2 rounded-xl">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              <span>Proceso Finalizado</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Inteligencia Artificial aplicada para conciliación y control documental CAMARCA SAS & 4-72
          </span>
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
          >
            Cerrar Ventana
          </button>
        </div>
      </div>

      {/* Embedded Document Preview Modal */}
      {activePreviewUrl && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950">
              <span className="text-xs font-bold text-slate-200">
                Visualización de Cuenta de Cobro y Soporte de Pago
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
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
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
                  className="w-full h-[70vh] rounded-xl border border-slate-800"
                />
              ) : (
                <img
                  src={activePreviewUrl}
                  alt="Soporte Escaneado"
                  className="max-h-[75vh] max-w-full object-contain rounded-xl shadow-2xl border border-slate-800"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
