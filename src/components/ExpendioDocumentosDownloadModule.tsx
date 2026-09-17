import React, { useState, useEffect } from 'react';
import {
  FileText,
  Clock,
  Store,
  FileCheck,
  Download,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Calendar,
  DollarSign,
} from 'lucide-react';
import { DocumentoExpendioConfig, ExpendioData } from '../types';
import {
  generateHorarioAtencionPDF,
  generateAviso472PDF,
  generateContratoServiciosPDF,
} from '../utils/documentosExpendiosGenerator';

interface ExpendioDocumentosDownloadModuleProps {
  expendio: ExpendioData;
  isLight: boolean;
}

export const ExpendioDocumentosDownloadModule: React.FC<ExpendioDocumentosDownloadModuleProps> = ({
  expendio,
  isLight,
}) => {
  const [documentos, setDocumentos] = useState<DocumentoExpendioConfig[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [downloadSuccessId, setDownloadSuccessId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchDocumentos = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/expendio/documentos');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setDocumentos(json.data);
      }
    } catch (err: any) {
      setErrorMsg('No fue posible cargar la lista de documentos disponibles.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocumentos();
  }, []);

  const handleDownload = async (doc: DocumentoExpendioConfig) => {
    setGeneratingId(doc.id);
    setErrorMsg(null);

    try {
      if (doc.id === 'tarifario' || doc.tipo === 'tarifario') {
        // EXACT UNMODIFIED FILE DOWNLOAD AS REQUESTED BY USER
        if (doc.archivoUrl) {
          const downloadUrl = `/api/documentos-expendios/download/${doc.id}`;
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = doc.archivoNombreOriginal || `${doc.nombre}.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } else {
          throw new Error('El archivo oficial de tarifas aún no ha sido cargado en el sistema por la administración central.');
        }
      } else if (doc.tipo === 'horario') {
        await generateHorarioAtencionPDF(expendio);
      } else if (doc.tipo === 'contrato') {
        await generateContratoServiciosPDF(expendio);
      } else if (doc.tipo === 'aviso') {
        await generateAviso472PDF(expendio);
      } else if (doc.archivoUrl) {
        // Direct download for any other uploaded file
        const downloadUrl = `/api/documentos-expendios/download/${doc.id}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = doc.archivoNombreOriginal || `${doc.nombre}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        throw new Error('El archivo solicitado no se encuentra disponible actualmente.');
      }

      setDownloadSuccessId(doc.id);
      setTimeout(() => {
        setDownloadSuccessId(null);
      }, 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al descargar el documento.');
    } finally {
      setGeneratingId(null);
    }
  };

  const getDocIcon = (tipo: string) => {
    switch (tipo) {
      case 'horario':
        return <Clock className="w-6 h-6 text-amber-500" />;
      case 'tarifario':
        return <DollarSign className="w-6 h-6 text-emerald-600" />;
      case 'contrato':
        return <FileText className="w-6 h-6 text-blue-500" />;
      case 'aviso':
        return <Store className="w-6 h-6 text-red-500" />;
      default:
        return <FileCheck className="w-6 h-6 text-emerald-500" />;
    }
  };

  // Filter only enabled documents
  const activeDocs = documentos.filter((d) => d.habilitado);

  if (loading) {
    return (
      <div className="py-8 flex flex-col items-center justify-center space-y-2 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        <span className="text-xs font-semibold">Cargando documentación autorizada para su punto...</span>
      </div>
    );
  }

  if (activeDocs.length === 0) {
    return (
      <div
        className={`p-6 rounded-xl border text-center ${
          isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900 border-slate-800'
        }`}
      >
        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">
          No hay documentos habilitados actualmente
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
          La administración no ha habilitado descargas de documentos institucionales en este momento. Si requiere una copia urgente de su contrato u horario, por favor contacte a su supervisor regional.
        </p>
      </div>
    );
  }

  return (
    <div id="expendio-documentos-download-module" className="space-y-4">
      {/* BANNER INFORMATIVO CON DATOS DEL EXPENDIO */}
      <div
        className={`p-3.5 sm:p-4 rounded-xl border-2 flex items-start space-x-3 transition-all ${
          isLight
            ? 'bg-amber-100/70 border-amber-400 text-black shadow-xs'
            : 'bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-slate-900 border-blue-900/60'
        }`}
      >
        <div className="w-8 h-8 rounded-lg bg-amber-400 text-black border border-amber-600 flex items-center justify-center shrink-0 shadow-xs mt-0.5">
          <Sparkles className="w-4 h-4 text-black" />
        </div>
        <div className="min-w-0">
          <h4 className="text-xs sm:text-sm font-black text-black">
            Documentación Personalizada Automáticamente
          </h4>
          <p className="text-[11px] sm:text-xs text-black font-bold mt-0.5 leading-relaxed">
            Los documentos generados a continuación incluyen automáticamente los datos de su punto de atención (
            <strong className="text-black font-black underline">
              {expendio.municipio || expendio.localidad}
            </strong>
            , Encargado:{' '}
            <strong className="text-black font-black underline">
              {expendio.encargado || 'Titular registrado'}
            </strong>
            ) con las plantillas oficiales vigentes de 4-72 y Camarca S.A.S.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-700 text-xs font-semibold flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* GRID DE DOCUMENTOS AUTORIZADOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
        {activeDocs.map((doc) => {
          const isGenerating = generatingId === doc.id;
          const isDownloaded = downloadSuccessId === doc.id;

          return (
            <div
              key={doc.id}
              className={`rounded-xl border-2 p-4 sm:p-4.5 flex flex-col justify-between transition-all hover:shadow-md ${
                isLight
                  ? 'bg-white border-slate-200 hover:border-blue-300'
                  : 'bg-slate-900 border-slate-800 hover:border-blue-800'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
                      {getDocIcon(doc.tipo)}
                    </div>
                    <div>
                      <span className={`text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md border ${
                        isLight ? 'bg-blue-100 text-blue-950 border-blue-300' : 'bg-blue-900/60 text-blue-200 border-blue-700'
                      }`}>
                        {doc.badge || 'Documento Oficial'}
                      </span>
                    </div>
                  </div>

                  {isDownloaded && (
                    <span className="text-[10px] font-black text-emerald-700 dark:text-emerald-400 flex items-center space-x-1 animate-fadeIn">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>¡Descargado!</span>
                    </span>
                  )}
                </div>

                <h3 className={`font-black text-sm sm:text-base tracking-tight ${
                  isLight ? 'text-slate-950' : 'text-white'
                }`}>
                  {doc.nombre}
                </h3>
                <p className={`text-xs mt-1 leading-relaxed font-bold ${
                  isLight ? 'text-slate-800' : 'text-slate-200'
                }`}>
                  {doc.descripcion}
                </p>

                {/* DETALLES DINÁMICOS POR TIPO */}
                <div className={`mt-3 py-2 px-3 rounded-lg border text-xs space-y-1 font-semibold ${
                  isLight ? 'bg-slate-100 border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-700 text-slate-200'
                }`}>
                  {doc.tipo === 'horario' && (
                    <div className="flex items-center space-x-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span className="truncate">
                        Municipio configurado: <strong className="font-black underline">{expendio.municipio || 'Principal'}</strong>
                      </span>
                    </div>
                  )}
                  {doc.tipo === 'contrato' && (
                    <div className="flex items-center space-x-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="truncate">
                        Minuta 13 págs · Cédula: <strong className="font-black underline">{expendio.cedula || 'Registrada'}</strong>
                      </span>
                    </div>
                  )}
                  {doc.tipo === 'aviso' && (
                    <div className="flex items-center space-x-1.5">
                      <Store className="w-3.5 h-3.5 text-red-600 shrink-0" />
                      <span className="truncate">
                        Formato para fachada: <strong className="font-black underline">{expendio.localidad || expendio.municipio}</strong>
                      </span>
                    </div>
                  )}
                  {doc.tipo === 'tarifario' && (
                    <div className="flex items-center space-x-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="truncate">
                        {doc.archivoNombreOriginal ? `Archivo Oficial: ${doc.archivoNombreOriginal}` : 'Cartelera Oficial de Tarifas (Documento Original sin Modificaciones)'}
                      </span>
                    </div>
                  )}
                  {doc.tipo === 'archivo' && (
                    <div className="flex items-center space-x-1.5">
                      <FileCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="truncate">
                        Archivo emitido por administración central
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* BOTÓN DE DESCARGA */}
              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <span className={`text-[11px] font-bold ${isLight ? 'text-slate-700' : 'text-slate-400'}`}>
                  {doc.fechaActualizacion ? `Actualizado: ${doc.fechaActualizacion}` : 'Listo para imprimir'}
                </span>

                <button
                  type="button"
                  onClick={() => handleDownload(doc)}
                  disabled={isGenerating}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer ${
                    isDownloaded
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Generando...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      <span>Descargar PDF</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
