import React, { useState, useEffect } from 'react';
import {
  FileText,
  Clock,
  Store,
  FileCheck,
  Upload,
  Download,
  CheckCircle2,
  XCircle,
  Edit2,
  Save,
  RefreshCw,
  Eye,
  AlertCircle,
  FileSpreadsheet,
  ToggleLeft,
  ToggleRight,
  ShieldCheck,
  Globe,
  Users,
  CheckCheck,
  Ban,
  HelpCircle,
  Sparkles,
  DollarSign,
} from 'lucide-react';
import { DocumentoExpendioConfig, ExpendioData } from '../types';
import {
  generateHorarioAtencionPDF,
  generateAviso472PDF,
  generateContratoServiciosPDF,
} from '../utils/documentosExpendiosGenerator';

interface AdminDocumentosExpendiosPanelProps {
  isLight: boolean;
  expendios: ExpendioData[];
}

export const AdminDocumentosExpendiosPanel: React.FC<AdminDocumentosExpendiosPanelProps> = ({
  isLight,
  expendios,
}) => {
  const [documentos, setDocumentos] = useState<DocumentoExpendioConfig[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState<boolean>(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState<string>('');
  const [editDescripcion, setEditDescripcion] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal / selector para pruebas de descarga
  const [testModalDoc, setTestModalDoc] = useState<DocumentoExpendioConfig | null>(null);
  const [selectedExpendioDemo, setSelectedExpendioDemo] = useState<string>(
    expendios.length > 0 ? expendios[0].id : ''
  );
  const [isGeneratingDemo, setIsGeneratingDemo] = useState<boolean>(false);

  const totalExpendios = expendios.length > 0 ? expendios.length : 177;

  // Fetch documentos config
  const fetchDocumentos = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/documentos-expendios');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setDocumentos(json.data);
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: 'Error cargando documentos: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocumentos();
  }, []);

  // Show status message with auto-dismiss
  const showNotification = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage(null);
    }, 5000);
  };

  // Toggle habilitado para CADA documento individualmente (PERO PARA TODOS LOS EXPENDIOS)
  const handleToggleHabilitado = async (doc: DocumentoExpendioConfig) => {
    setSavingId(doc.id);
    const nuevoEstado = !doc.habilitado;
    try {
      const res = await fetch('/api/admin/documentos-expendios/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: doc.id,
          habilitar: nuevoEstado,
        }),
      });
      const json = await res.json();
      if (json.success && json.all) {
        setDocumentos(json.all);
        showNotification(
          'success',
          `✓ El documento "${doc.nombre}" ha sido ${
            nuevoEstado ? 'HABILITADO' : 'DESHABILITADO'
          } para TODOS los ${totalExpendios} expendios.`
        );
      } else {
        // Fallback a ruta standard
        const res2 = await fetch('/api/admin/documentos-expendios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: doc.id,
            habilitado: nuevoEstado,
          }),
        });
        const json2 = await res2.json();
        if (json2.success) {
          setDocumentos((prev) =>
            prev.map((d) => (d.id === doc.id ? { ...d, habilitado: nuevoEstado } : d))
          );
          showNotification(
            'success',
            `✓ El documento "${doc.nombre}" ha sido ${
              nuevoEstado ? 'HABILITADO' : 'DESHABILITADO'
            } para TODOS los ${totalExpendios} expendios.`
          );
        } else {
          showNotification('error', json2.message || 'Error actualizando estado.');
        }
      }
    } catch (err: any) {
      showNotification('error', 'Error al cambiar estado: ' + err.message);
    } finally {
      setSavingId(null);
    }
  };

  // Habilitar TODOS los documentos para TODOS los expendios
  const handleEnableAll = async () => {
    if (
      !window.confirm(
        `¿Deseas HABILITAR los ${documentos.length} documentos para TODOS los ${totalExpendios} expendios registrados?`
      )
    ) {
      return;
    }
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/admin/documentos-expendios/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enable_all' }),
      });
      const json = await res.json();
      if (json.success && json.all) {
        setDocumentos(json.all);
        showNotification(
          'success',
          `✓ ÉXITO: TODOS los documentos (${documentos.length}) han sido HABILITADOS para los ${totalExpendios} expendios.`
        );
      } else {
        showNotification('error', json.message || 'Error en acción masiva.');
      }
    } catch (err: any) {
      showNotification('error', 'Error al habilitar todos los documentos: ' + err.message);
    } finally {
      setBulkProcessing(false);
    }
  };

  // Deshabilitar TODOS los documentos para TODOS los expendios
  const handleDisableAll = async () => {
    if (
      !window.confirm(
        `¿Deseas DESHABILITAR los ${documentos.length} documentos para TODOS los ${totalExpendios} expendios? Ningún punto podrá descargarlos hasta que los vuelvas a habilitar.`
      )
    ) {
      return;
    }
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/admin/documentos-expendios/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable_all' }),
      });
      const json = await res.json();
      if (json.success && json.all) {
        setDocumentos(json.all);
        showNotification(
          'success',
          `✓ AVISO: TODOS los documentos han sido DESHABILITADOS para los ${totalExpendios} expendios.`
        );
      } else {
        showNotification('error', json.message || 'Error en acción masiva.');
      }
    } catch (err: any) {
      showNotification('error', 'Error al deshabilitar todos los documentos: ' + err.message);
    } finally {
      setBulkProcessing(false);
    }
  };

  // Start editing name and description
  const handleStartEdit = (doc: DocumentoExpendioConfig) => {
    setEditingId(doc.id);
    setEditNombre(doc.nombre);
    setEditDescripcion(doc.descripcion);
  };

  // Save edited name and description
  const handleSaveEdit = async (id: string) => {
    if (!editNombre.trim()) {
      showNotification('error', 'El nombre del documento no puede estar vacío.');
      return;
    }
    setSavingId(id);
    try {
      const res = await fetch('/api/admin/documentos-expendios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          nombre: editNombre.trim(),
          descripcion: editDescripcion.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setDocumentos((prev) =>
          prev.map((d) =>
            d.id === id ? { ...d, nombre: editNombre.trim(), descripcion: editDescripcion.trim() } : d
          )
        );
        setEditingId(null);
        showNotification('success', '✓ Nombre y descripción actualizados con éxito.');
      } else {
        showNotification('error', json.message || 'Error guardando cambios.');
      }
    } catch (err: any) {
      showNotification('error', 'Error guardando cambios: ' + err.message);
    } finally {
      setSavingId(null);
    }
  };

  // Handle file upload
  const handleFileUpload = async (id: string, file: File) => {
    setUploadingId(id);
    const formData = new FormData();
    formData.append('id', id);
    formData.append('archivoDoc', file);

    try {
      const res = await fetch('/api/admin/documentos-expendios/upload', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (json.success && json.data) {
        setDocumentos((prev) =>
          prev.map((d) => (d.id === id ? { ...d, ...json.data } : d))
        );
        showNotification(
          'success',
          `✓ Archivo "${file.name}" cargado exitosamente. Ahora estará disponible para todos los expendios.`
        );
      } else {
        showNotification('error', json.message || 'Error cargando archivo.');
      }
    } catch (err: any) {
      showNotification('error', 'Error de red subiendo archivo: ' + err.message);
    } finally {
      setUploadingId(null);
    }
  };

  // Descargar archivo original exacto sin modificaciones
  const handleDownloadOriginalFile = (doc: DocumentoExpendioConfig) => {
    if (doc.archivoUrl) {
      const downloadUrl = `/api/documentos-expendios/download/${doc.id}`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = doc.archivoNombreOriginal || `${doc.nombre}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showNotification(
        'success',
        `✓ Descargando archivo original exacto: "${doc.archivoNombreOriginal || doc.nombre}" (sin modificaciones).`
      );
    } else {
      showNotification(
        'error',
        'Aún no se ha cargado el archivo oficial de tarifas. Por favor utiliza el botón "Cargar Archivo".'
      );
    }
  };

  // Demo download of dynamic documents using chosen sample expendio
  const handleExecuteDemoDownload = async (targetExpId?: string) => {
    if (!testModalDoc) return;
    
    // Si es tarifario o un archivo directo, descargar tal cual sin modificar
    if (testModalDoc.id === 'tarifario' || testModalDoc.tipo === 'tarifario' || testModalDoc.tipo === 'archivo') {
      if (testModalDoc.archivoUrl) {
        handleDownloadOriginalFile(testModalDoc);
      } else {
        showNotification(
          'error',
          'Aún no se ha cargado el archivo original de tarifas. Por favor sube el archivo oficial primero.'
        );
      }
      setTestModalDoc(null);
      return;
    }

    const expId = targetExpId || selectedExpendioDemo;
    const demoExp = (expendios.find((e) => e.id === expId) || expendios[0] || {
      id: 'demo-1',
      municipio: 'ARAUCA',
      encargado: 'JORGE ANDRES LOPEZ PATIÑO',
      cedula: '88.123.456',
      telefonoPunto: '3151234567',
      direccionPunto: 'Carrera 20 # 18 - 45 Centro',
      localidad: 'ARAUCA',
      centroOperativo: 'ARAUCA',
    }) as ExpendioData;

    setIsGeneratingDemo(true);
    try {
      if (testModalDoc.tipo === 'horario') {
        await generateHorarioAtencionPDF(demoExp);
        showNotification('success', `✓ PDF de Horario 4-72 generado de muestra para "${demoExp.municipio}".`);
      } else if (testModalDoc.tipo === 'contrato') {
        await generateContratoServiciosPDF(demoExp);
        showNotification(
          'success',
          `✓ Contrato (13 páginas) generado de muestra con datos de "${demoExp.encargado}".`
        );
      } else if (testModalDoc.tipo === 'aviso') {
        await generateAviso472PDF(demoExp);
        showNotification('success', `✓ Aviso de Fachada generado de muestra para "${demoExp.municipio}".`);
      } else if (testModalDoc.archivoUrl) {
        window.open(testModalDoc.archivoUrl, '_blank');
      } else {
        showNotification('error', 'No hay archivo disponible para descargar.');
      }
      setTestModalDoc(null);
    } catch (err: any) {
      showNotification('error', 'Error generando documento: ' + err.message);
    } finally {
      setIsGeneratingDemo(false);
    }
  };

  const getIcon = (tipo: string) => {
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

  const habilitadosCount = documentos.filter((d) => d.habilitado).length;

  return (
    <div
      id="admin-documentos-expendios-panel"
      className={`rounded-2xl border-2 p-4 sm:p-6 transition-all ${
        isLight ? 'bg-white border-slate-200 shadow-sm' : 'bg-slate-900 border-slate-800 text-slate-100'
      }`}
    >
      {/* HEADER PRINCIPAL */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-start space-x-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-indigo-800 text-white flex items-center justify-center shadow-md shrink-0">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-blue-100 text-blue-800 dark:bg-blue-900/70 dark:text-blue-200 flex items-center space-x-1">
                <Globe className="w-3.5 h-3.5" />
                <span>Control Global Nacional</span>
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 flex items-center space-x-1">
                <Users className="w-3.5 h-3.5" />
                <span>{totalExpendios} Expendios Registrados</span>
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-black tracking-tight mt-1">
              Documentación Oficial para Expendios
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Habilita o deshabilita cada documento para que aparezca o se oculte en <strong>TODOS</strong> los expendios del país.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-start md:self-center">
          <button
            type="button"
            onClick={fetchDocumentos}
            disabled={loading}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
            title="Recargar configuración de documentos"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* NOTIFICACIONES */}
      {statusMessage && (
        <div
          className={`mt-4 p-4 rounded-xl border flex items-center space-x-3 text-xs sm:text-sm font-bold animate-fadeIn ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-950/50 dark:border-emerald-700 dark:text-emerald-200'
              : 'bg-red-50 border-red-300 text-red-900 dark:bg-red-950/50 dark:border-red-700 dark:text-red-200'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* BANNER CLAVE: EXPLICACIÓN DE APLICACIÓN A TODOS LOS EXPENDIOS */}
      <div
        className={`mt-4 p-4 rounded-2xl border transition-all ${
          isLight
            ? 'bg-gradient-to-r from-blue-50/90 via-indigo-50/70 to-slate-50 border-blue-200'
            : 'bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-slate-900 border-blue-900/60'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs sm:text-sm font-black text-blue-950 dark:text-blue-200">
                Alcance Global Inmediato (Aplica a los {totalExpendios} expendios)
              </h4>
              <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                Cada botón a continuación activa o desactiva la descarga simultáneamente para la totalidad de expendios. Actualmente{' '}
                <strong className="text-blue-700 dark:text-blue-400">
                  {habilitadosCount} de {documentos.length} documentos
                </strong>{' '}
                están habilitados para descarga por los puntos de atención.
              </p>
            </div>
          </div>

          {/* BOTONES MAESTROS: HABILITAR TODOS / DESHABILITAR TODOS */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleEnableAll}
              disabled={bulkProcessing || loading}
              className="px-3.5 py-2 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white flex items-center space-x-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              title="Habilitar todos los documentos para todos los expendios"
            >
              <CheckCheck className="w-4 h-4" />
              <span>Habilitar TODOS los Documentos</span>
            </button>

            <button
              type="button"
              onClick={handleDisableAll}
              disabled={bulkProcessing || loading}
              className="px-3.5 py-2 rounded-xl text-xs font-black bg-slate-700 hover:bg-red-700 text-white flex items-center space-x-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              title="Deshabilitar todos los documentos para todos los expendios"
            >
              <Ban className="w-4 h-4" />
              <span>Deshabilitar TODOS</span>
            </button>
          </div>
        </div>
      </div>

      {/* GRID DE DOCUMENTOS INDIVIDUALES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 mt-5">
        {documentos.map((doc, idx) => {
          const isEditing = editingId === doc.id;
          const isSaving = savingId === doc.id;
          const isUploading = uploadingId === doc.id;

          return (
            <div
              key={doc.id}
              className={`rounded-2xl border-2 p-4 sm:p-5 flex flex-col justify-between transition-all ${
                doc.habilitado
                  ? isLight
                    ? 'bg-white border-emerald-300 shadow-sm'
                    : 'bg-slate-800/80 border-emerald-600/70 shadow-sm'
                  : isLight
                  ? 'bg-slate-50/80 border-slate-300 opacity-90'
                  : 'bg-slate-900/80 border-slate-700 opacity-80'
              }`}
            >
              {/* FILA SUPERIOR: ICONO + IDENTIFICADOR + BADGE DE ESTADO GLOBAL */}
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 shadow-xs border border-slate-200 dark:border-slate-700">
                      {getIcon(doc.tipo)}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] uppercase font-black tracking-wider px-2 py-0.5 rounded-md bg-blue-100 text-blue-900 dark:bg-blue-900/60 dark:text-blue-200">
                          {doc.badge || `Documento ${idx + 1}`}
                        </span>
                        {doc.tipo !== 'archivo' && doc.id !== 'tarifario' && (
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                            Auto-personalizado
                          </span>
                        )}
                        {(doc.id === 'tarifario' || doc.tipo === 'tarifario') && (
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                            Archivo Original (Sin Modificaciones)
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 font-medium">
                        Identificador: {doc.id}
                      </span>
                    </div>
                  </div>

                  {/* BADGE GLOBAL DE ESTADO */}
                  <div>
                    {doc.habilitado ? (
                      <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>Activo para todos</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-black bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                        <XCircle className="w-3.5 h-3.5 text-slate-500" />
                        <span>Inactivo para todos</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* BOTÓN PROMINENTE Y EXCLUSIVO: HABILITAR O DESHABILITAR PARA TODOS LOS EXPENDIOS */}
                <div className="my-3">
                  <button
                    type="button"
                    onClick={() => handleToggleHabilitado(doc)}
                    disabled={isSaving}
                    className={`w-full py-3 px-4 rounded-xl text-xs sm:text-sm font-black flex items-center justify-between transition-all cursor-pointer shadow-sm border ${
                      doc.habilitado
                        ? 'bg-emerald-500 hover:bg-red-600 text-slate-950 hover:text-white border-emerald-400 hover:border-red-700'
                        : 'bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white border-slate-700 hover:border-emerald-500'
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      {doc.habilitado ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-900" />
                          <span className="truncate">
                            HABILITADO PARA TODOS ({totalExpendios} expendios)
                          </span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 shrink-0 text-slate-400" />
                          <span className="truncate">
                            DESHABILITADO PARA TODOS LOS EXPENDIOS
                          </span>
                        </>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center space-x-1 ml-2 text-[11px] uppercase tracking-wider font-extrabold underline">
                      {doc.habilitado ? 'Clic para Deshabilitar' : 'Clic para Habilitar'}
                    </div>
                  </button>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 text-center">
                    {doc.habilitado
                      ? `✓ Los ${totalExpendios} expendios pueden ver y descargar este documento actualmente.`
                      : `⛔ Este documento está oculto para todos los ${totalExpendios} expendios.`}
                  </p>
                </div>

                {/* NOMBRE Y DESCRIPCIÓN (EDITABLE) */}
                {isEditing ? (
                  <div className="space-y-2.5 my-3 p-3 rounded-xl bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 shadow-inner">
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
                        Nombre oficial del documento para los expendios:
                      </label>
                      <input
                        type="text"
                        value={editNombre}
                        onChange={(e) => setEditNombre(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs sm:text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                        placeholder="Ej. Horario de Atención Oficial 4-72"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
                        Descripción o instrucciones visibles en el expendio:
                      </label>
                      <textarea
                        value={editDescripcion}
                        onChange={(e) => setEditDescripcion(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                        placeholder="Instrucciones para el punto de atención..."
                      />
                    </div>
                    <div className="flex justify-end space-x-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(doc.id)}
                        disabled={isSaving}
                        className="px-3.5 py-1 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white flex items-center space-x-1 cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Guardar Cambios</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="my-2.5">
                    <div className="flex items-center justify-between group">
                      <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">
                        {doc.nombre}
                      </h3>
                      <button
                        type="button"
                        onClick={() => handleStartEdit(doc)}
                        className="p-1 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-xs flex items-center space-x-1 cursor-pointer"
                        title="Editar nombre y descripción"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span className="text-[11px] font-semibold hidden sm:inline">Editar</span>
                      </button>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                      {doc.descripcion}
                    </p>
                  </div>
                )}

                {/* ARCHIVO ADJUNTO INFO */}
                {doc.archivoNombreOriginal && (
                  <div className="my-2 p-2.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-xs flex items-center justify-between">
                    <div className="flex items-center space-x-2 truncate">
                      <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="truncate font-bold text-blue-950 dark:text-blue-200">
                        {doc.archivoNombreOriginal}
                      </span>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-500 shrink-0">
                      Archivo emitido
                    </span>
                  </div>
                )}

                {/* CAJA ESPECIAL PARA TARIFAS: CARGA DIRECTA Y DESCARGA TAL CUAL */}
                {(doc.id === 'tarifario' || doc.tipo === 'tarifario') && (
                  <div
                    className={`my-2 p-3 rounded-xl border ${
                      doc.archivoUrl
                        ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-emerald-950 dark:text-emerald-200'
                        : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200'
                    }`}
                  >
                    <div className="flex items-start space-x-2.5">
                      <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <div className="text-xs space-y-1">
                        <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center space-x-1.5">
                          <span>Documento Oficial de Tarifas</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded-sm bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100 font-extrabold">
                            Sin modificaciones
                          </span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                          {doc.archivoUrl
                            ? 'Los expendios descargarán TAL CUAL este mismo archivo original sin modificaciones ni alteraciones en el documento.'
                            : 'No se ha cargado el archivo de tarifas. Por favor carga el documento oficial (PDF) para que los expendios puedan descargarlo tal cual.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ACCIONES SECUNDARIAS: CARGAR ARCHIVO Y PROBAR DESCARGA */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 mt-2">
                {/* CARGAR ARCHIVO REEMPLAZO O ADJUNTO */}
                <label className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer shadow-xs transition-colors">
                  <Upload className="w-3.5 h-3.5 text-slate-500" />
                  <span>{doc.archivoUrl ? 'Cambiar Archivo' : 'Cargar Archivo'}</span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.jpg,.png"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(doc.id, e.target.files[0]);
                      }
                    }}
                    disabled={isUploading}
                  />
                </label>

                {/* BOTÓN PROBAR DESCARGA DE MUESTRA O DESCARGA TAL CUAL SI ES TARIFARIO */}
                {doc.id === 'tarifario' || doc.tipo === 'tarifario' ? (
                  <button
                    type="button"
                    onClick={() => handleDownloadOriginalFile(doc)}
                    disabled={!doc.archivoUrl}
                    className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      doc.archivoUrl
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-300 dark:border-slate-700 opacity-60 cursor-not-allowed'
                    }`}
                    title={
                      doc.archivoUrl
                        ? 'Descargar el archivo tal cual fue cargado, sin modificaciones'
                        : 'Cargue un archivo oficial primero para habilitar la descarga'
                    }
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar Archivo Tal Cual</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTestModalDoc(doc)}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-xs font-bold transition-all cursor-pointer"
                    title="Generar PDF de muestra para verificar cómo lo ve el expendio"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Probar Descarga</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL PARA PROBAR DESCARGA CON SELECCIÓN CLARA DE EXPENDIO DE MUESTRA */}
      {testModalDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-2xl border-2 p-5 shadow-2xl ${
              isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                <Eye className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-base text-slate-900 dark:text-slate-100">
                  Probar Descarga de Muestra
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {testModalDoc.nombre}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1 mb-4">
              <p className="font-bold flex items-center space-x-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Simulador de Generación de Documento</span>
              </p>
              <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                Esta función generará un PDF de prueba con los datos del expendio que selecciones, para que confirmes que las plantillas y datos se generan perfectamente.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Selecciona el expendio para el ejemplo:
                </label>
                <select
                  value={selectedExpendioDemo}
                  onChange={(e) => setSelectedExpendioDemo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border text-xs font-bold bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                >
                  {expendios.map((exp) => (
                    <option key={exp.id} value={exp.id}>
                      {exp.municipio || exp.localidad} - {exp.encargado || 'Titular'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2.5 mt-5 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setTestModalDoc(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => handleExecuteDemoDownload()}
                disabled={isGeneratingDemo}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white flex items-center space-x-1.5 cursor-pointer shadow-xs"
              >
                {isGeneratingDemo ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Generando PDF...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar PDF de Prueba</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GUÍA TÉCNICA Y DE SOPORTE */}
      <div className="mt-6 p-4.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs leading-relaxed space-y-2">
        <h4 className="font-black text-sm text-slate-900 dark:text-slate-100 flex items-center space-x-2">
          <HelpCircle className="w-4 h-4 text-blue-600" />
          <span>Información sobre la habilitación para expendios:</span>
        </h4>
        <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-300">
          <li>
            <strong>Habilitar / Deshabilitar:</strong> Si un documento está deshabilitado, desaparecerá automáticamente del panel de los {totalExpendios} expendios en tiempo real.
          </li>
          <li>
            <strong>Horario Oficial 4-72:</strong> Al ser descargado por un expendio, el sistema lee automáticamente su municipio registrado y lo inserta en el encabezado oficial de la plantilla.
          </li>
          <li>
            <strong>Contrato (13 Páginas):</strong> Llena automáticamente los datos del titular contratista (Cédula, Nombres, Celular, Dirección y Municipio) manteniendo el texto legal de las 27 cláusulas contractuales.
          </li>
        </ul>
      </div>
    </div>
  );
};
