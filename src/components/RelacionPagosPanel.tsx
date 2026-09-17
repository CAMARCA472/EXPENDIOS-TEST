import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { PagoRelacionItem, CuentaCargadaExpendio, AnalisisIACuentaCobro, CambioIntermensual, DetalleCambioCampo, DiscrepanciaEncargadoItem, ResolucionDiscrepanciasModo } from '../types';
import { formatNumberWithDots, formatCuentaBancaria } from '../utils/formatters';
import { CambiosIntermensualesModal, CambiosIntermensualesBanner } from './CambiosIntermensualesModal';
import { DiscrepanciasEncargadoModal } from './DiscrepanciasEncargadoModal';
import { ConfirmarBorradoModal, ADMIN_SECURITY_PASSWORD } from './ConfirmarBorradoModal';
import { DashboardRelacionPagos } from './DashboardRelacionPagos';
import { ReporteFormalView } from './ReporteFormalView';
import {
  FileSpreadsheet,
  Upload,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  Eye,
  Camera,
  Filter,
  DollarSign,
  Building2,
  Calendar,
  Sparkles,
  ArrowUpDown,
  Check,
  X,
  Trash2,
  Plus,
  Edit3,
  FileText,
  ShieldCheck,
  ArrowRight,
  Bot,
  Zap,
  ArrowLeftRight,
  Users,
  CheckCheck,
  BarChart3,
  PieChart,
  RotateCcw,
  TrendingUp,
  CreditCard,
  Layers,
  Lock,
  EyeOff,
} from 'lucide-react';

const MESES = [
  { value: 'ENERO', num: '01', label: 'Enero' },
  { value: 'FEBRERO', num: '02', label: 'Febrero' },
  { value: 'MARZO', num: '03', label: 'Marzo' },
  { value: 'ABRIL', num: '04', label: 'Abril' },
  { value: 'MAYO', num: '05', label: 'Mayo' },
  { value: 'JUNIO', num: '06', label: 'Junio' },
  { value: 'JULIO', num: '07', label: 'Julio' },
  { value: 'AGOSTO', num: '08', label: 'Agosto' },
  { value: 'SEPTIEMBRE', num: '09', label: 'Septiembre' },
  { value: 'OCTUBRE', num: '10', label: 'Octubre' },
  { value: 'NOVIEMBRE', num: '11', label: 'Noviembre' },
  { value: 'DICIEMBRE', num: '12', label: 'Diciembre' },
];

const ANIOS = [
  '2024', '2025', '2026', '2027', '2028', '2029', '2030',
  '2031', '2032', '2033', '2034', '2035', '2036', '2037', '2038', '2039', '2040'
];

export const RelacionPagosPanel: React.FC = () => {
  const [mes, setMes] = useState<string>('MARZO');
  const [anio, setAnio] = useState<string>('2026');
  const [items, setItems] = useState<PagoRelacionItem[]>([]);
  const [cuentasCargadas, setCuentasCargadas] = useState<CuentaCargadaExpendio[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filtroEstado, setFiltroEstado] = useState<string>('TODOS');
  const [filtroCentroOp, setFiltroCentroOp] = useState<string>('TODOS');
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);

  // View Mode: Formal Report vs Operative Table vs Dashboard
  const [activeTab, setActiveTab] = useState<'formal' | 'tabla' | 'dashboard'>('formal');

  // Reset Modal state
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [resetModo, setResetModo] = useState<'anteriores_a_marzo' | 'mes_actual' | 'todos'>('anteriores_a_marzo');
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [resetPassword, setResetPassword] = useState<string>('');
  const [showResetPassword, setShowResetPassword] = useState<boolean>(false);
  const [resetErrorMsg, setResetErrorMsg] = useState<string>('');

  // Inter-monthly changes state
  const [cambiosIntermensuales, setCambiosIntermensuales] = useState<CambioIntermensual[]>([]);
  const [showCambiosModal, setShowCambiosModal] = useState<boolean>(false);
  const [isProcessingCambios, setIsProcessingCambios] = useState<boolean>(false);
  const [mesAnteriorInfo, setMesAnteriorInfo] = useState<{ mesAnterior: string; anioAnterior: string }>({
    mesAnterior: 'FEBRERO',
    anioAnterior: '2026',
  });

  // Scanned photo preview modal
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<{ url: string; title: string } | null>(null);

  // AI Audit Modal state
  const [auditModalData, setAuditModalData] = useState<{
    item: PagoRelacionItem;
    cuenta?: CuentaCargadaExpendio;
  } | null>(null);
  const [applyingNovedad, setApplyingNovedad] = useState<boolean>(false);
  const [reanalyzingIA, setReanalyzingIA] = useState<boolean>(false);

  // Import modal & Discrepancies resolution state
  const [uploadingExcel, setUploadingExcel] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [discrepanciasModal, setDiscrepanciasModal] = useState<{
    isOpen: boolean;
    discrepancias: DiscrepanciaEncargadoItem[];
    file: File;
  } | null>(null);
  const [resolviendoDiscrepancias, setResolviendoDiscrepancias] = useState<boolean>(false);

  // Helper: Compute previous month info
  const getPreviousMonthInfo = (currMes: string, currAnio: string) => {
    const mesIndex = MESES.findIndex((m) => m.value === currMes.toUpperCase());
    if (mesIndex > 0) {
      return { mesAnterior: MESES[mesIndex - 1].value, anioAnterior: currAnio };
    } else if (mesIndex === 0) {
      return { mesAnterior: 'DICIEMBRE', anioAnterior: String(Number(currAnio) - 1) };
    }
    return { mesAnterior: 'FEBRERO', anioAnterior: '2026' };
  };

  // Helper: Detect inter-monthly changes
  const computeInterMonthChanges = (
    currentList: PagoRelacionItem[],
    previousList: PagoRelacionItem[],
    expendiosList: any[]
  ): CambioIntermensual[] => {
    const norm = (s: any) =>
      String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim()
        .replace(/\s+/g, ' ');
    const digits = (s: any) => String(s || '').replace(/[^0-9]/g, '');

    const results: CambioIntermensual[] = [];

    for (const cur of currentList) {
      if (!cur) continue;
      const munKey = norm(cur.municipio);
      // 1. Find match in previous month
      let prev: any = (previousList || []).find(
        (p) => p && (norm(p.municipio) === munKey || (digits(p.cedula) && digits(p.cedula) === digits(cur.cedula)))
      );

      // 2. If not in previous month list, check expendios master
      if (!prev && expendiosList && expendiosList.length > 0) {
        const expMatch = expendiosList.find(
          (e) => e && (norm(e.municipio) === munKey || norm(e.localidad) === munKey)
        );
        if (expMatch) {
          prev = {
            id: expMatch.id,
            municipio: expMatch.municipio || expMatch.localidad,
            nombreEncargado: expMatch.encargado,
            cedula: expMatch.cedula,
            cuenta: formatCuentaBancaria(expMatch.telefonoPunto).cuenta,
            banco: 'NEQUI',
            valorCancelar: expMatch.valorMensual || 0,
          };
        }
      }

      if (prev) {
        const diffs: DetalleCambioCampo[] = [];

        // Compare Encargado
        const curEnc = norm(cur.nombreEncargado);
        const prevEnc = norm(prev.nombreEncargado || prev.encargado);
        if (curEnc && prevEnc && curEnc !== prevEnc) {
          diffs.push({
            campo: 'encargado',
            label: 'Nombre del Encargado',
            valorAnterior: prev.nombreEncargado || prev.encargado,
            valorActual: cur.nombreEncargado,
          });
        }

        // Compare Cédula
        const curCed = digits(cur?.cedula);
        const prevCed = digits(prev?.cedula);
        if (curCed && prevCed && curCed !== prevCed) {
          diffs.push({
            campo: 'cedula',
            label: 'Cédula de Ciudadanía',
            valorAnterior: prev.cedula || '',
            valorActual: cur.cedula || '',
          });
        }

        // Compare Cuenta (normalized via formatCuentaBancaria)
        const curCtaFormatted = formatCuentaBancaria(cur.cuenta, cur.banco).cuenta;
        const prevCtaFormatted = formatCuentaBancaria(prev.cuenta, prev.banco).cuenta;
        const curCta = norm(curCtaFormatted);
        const prevCta = norm(prevCtaFormatted);
        if (curCta && prevCta && curCta !== prevCta) {
          diffs.push({
            campo: 'cuenta',
            label: 'Cuenta Bancaria / Nequi',
            valorAnterior: prevCtaFormatted,
            valorActual: curCtaFormatted,
          });
        }

        if (diffs.length > 0) {
          results.push({
            id: cur.id,
            municipio: cur.municipio,
            centroOperativo: cur.centroOperativo || 'PO. BUCARAMANGA',
            itemActual: cur,
            itemAnterior: prev,
            cambios: diffs,
            estadoAprobacion: cur.cambioDetectado?.aprobado ? 'Aprobado' : 'Pendiente',
          });
        }
      }
    }

    return results;
  };

  // Fetch payments relationship and scanned accounts for the selected period
  const fetchPagosData = async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const periodoStr = `${mes} ${anio}`.toUpperCase();
      const prevInfo = getPreviousMonthInfo(mes, anio);
      setMesAnteriorInfo(prevInfo);

      const [resPagosRaw, resCuentasRaw, resPrevPagosRaw, resExpendiosRaw] = await Promise.all([
        fetch(`/api/admin/relacion-pagos?mes=${encodeURIComponent(mes)}&anio=${encodeURIComponent(anio)}`),
        fetch(`/api/cuentas-cargadas?periodo=${encodeURIComponent(periodoStr)}`),
        fetch(`/api/admin/relacion-pagos?mes=${encodeURIComponent(prevInfo.mesAnterior)}&anio=${encodeURIComponent(prevInfo.anioAnterior)}`),
        fetch(`/api/expendios`),
      ]);

      let currentPagos: PagoRelacionItem[] = [];
      let previousPagos: PagoRelacionItem[] = [];
      let expendiosMaster: any[] = [];

      if (resPagosRaw.ok) {
        const resPagos = await resPagosRaw.json();
        if (resPagos.success && Array.isArray(resPagos.data)) {
          currentPagos = resPagos.data;
          setItems(resPagos.data);
        }
      }
      if (resCuentasRaw.ok) {
        const resCuentas = await resCuentasRaw.json();
        if (resCuentas.success && Array.isArray(resCuentas.data)) {
          setCuentasCargadas(resCuentas.data);
        }
      }
      if (resPrevPagosRaw.ok) {
        const resPrev = await resPrevPagosRaw.json();
        if (resPrev.success && Array.isArray(resPrev.data)) {
          previousPagos = resPrev.data;
        }
      }
      if (resExpendiosRaw.ok) {
        const resExp = await resExpendiosRaw.json();
        if (resExp.success && Array.isArray(resExp.data)) {
          expendiosMaster = resExp.data;
        }
      }

      // Detect inter-monthly differences
      if (currentPagos.length > 0) {
        const detected = computeInterMonthChanges(currentPagos, previousPagos, expendiosMaster);
        setCambiosIntermensuales(detected);
      } else {
        setCambiosIntermensuales([]);
      }
    } catch (err) {
      console.error('Error cargando relación de pagos:', err);
      setStatusMsg({ text: 'Error al conectar con la base de datos de pagos', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPagosData();
  }, [mes, anio]);

  // Handler: Sincronizar / Generar automáticamente desde Expendios del sistema
  const handleAutoGenerate = async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/admin/relacion-pagos/generar-desde-expendios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mes, anio }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ message: `Error del servidor (${res.status})` }));
        throw new Error(errJson.message || `Error ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        setItems(data.data);
        setStatusMsg({
          text: `✓ Relación de pagos generada y sincronizada por Municipio con éxito para ${mes} ${anio} (${data.data.length} registros).`,
          type: 'success',
        });
        fetchPagosData();
      } else {
        setStatusMsg({ text: data.message || 'Error al generar relación', type: 'error' });
      }
    } catch (err: any) {
      console.error('Error generando relación de pagos:', err);
      setStatusMsg({ text: err.message || 'Error en el servidor al generar la relación', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Handler: Subir Excel de Relación de Pagos
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingExcel(true);
    setStatusMsg(null);

    const formData = new FormData();
    formData.append('excelFile', file);
    formData.append('excel', file);
    formData.append('mes', mes);
    formData.append('anio', anio);

    try {
      const res = await fetch('/api/admin/relacion-pagos/import-excel', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ message: `Error del servidor (${res.status})` }));
        throw new Error(errJson.message || `Error ${res.status}`);
      }

      const data = await res.json();

      // Check if discrepancy resolution between Excel and registered database is needed
      if (data.requiereResolucion) {
        setDiscrepanciasModal({
          isOpen: true,
          discrepancias: data.discrepancias || [],
          file,
        });
        return;
      }

      if (data.success) {
        setItems(data.data);
        setStatusMsg({
          text: `✓ Archivo Excel importado con éxito: ${data.data.length} expendios vinculados y sincronizados por Municipio para ${mes} ${anio}.`,
          type: 'success',
        });
        fetchPagosData();
      } else {
        setStatusMsg({ text: data.message || 'Error al importar archivo Excel', type: 'error' });
      }
    } catch (err: any) {
      console.error('Error importando Excel:', err);
      setStatusMsg({ text: err.message || 'Error procesando el archivo Excel', type: 'error' });
    } finally {
      setUploadingExcel(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handler: Resolver discrepancias en archivo de pagos (Opción 1 vs Opción 2)
  const handleResolverDiscrepanciasPagos = async (modo: ResolucionDiscrepanciasModo) => {
    if (!discrepanciasModal) return;
    setResolviendoDiscrepancias(true);
    try {
      const formData = new FormData();
      formData.append('excelFile', discrepanciasModal.file);
      formData.append('excel', discrepanciasModal.file);
      formData.append('mes', mes);
      formData.append('anio', anio);
      formData.append('resolucionDiscrepancias', modo);

      const res = await fetch('/api/admin/relacion-pagos/import-excel', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ message: `Error del servidor (${res.status})` }));
        throw new Error(errJson.message || `Error ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        setItems(data.data);
        setStatusMsg({
          text: `✓ Archivo Excel importado con resolución (${modo === 'actualizar_bd' ? '1: Base de Datos de Expendios Actualizada' : '2: Datos tomados de la Base Registrada'}): ${data.data.length} expendios vinculados para ${mes} ${anio}.`,
          type: 'success',
        });
        setDiscrepanciasModal(null);
        fetchPagosData();
      } else {
        setStatusMsg({ text: data.message || 'Error al aplicar resolución', type: 'error' });
      }
    } catch (err: any) {
      console.error('Error resolviendo discrepancias pagos:', err);
      setStatusMsg({ text: err.message || 'Error al resolver diferencias', type: 'error' });
    } finally {
      setResolviendoDiscrepancias(false);
    }
  };

  // Handler: Aprobar Cambio Intermensual Individual
  const handleAprobarCambioIndividual = async (
    cambio: CambioIntermensual,
    revertir: boolean,
    actualizarMaestro: boolean
  ) => {
    setIsProcessingCambios(true);
    try {
      const payloadItem = revertir && cambio.itemAnterior
        ? {
            id: cambio.itemActual?.id || cambio.id,
            municipio: cambio.municipio,
            nombreEncargado: cambio.itemAnterior?.nombreEncargado || '',
            cedula: cambio.itemAnterior?.cedula || '',
            cuenta: cambio.itemAnterior?.cuenta || '',
            banco: cambio.itemAnterior?.banco || 'NEQUI',
            valorCancelar: cambio.itemAnterior?.valorCancelar || 0,
            actualizarMaestro: false,
          }
        : {
            id: cambio.itemActual?.id || cambio.id,
            municipio: cambio.municipio,
            nombreEncargado: cambio.itemActual?.nombreEncargado || '',
            cedula: cambio.itemActual?.cedula || '',
            cuenta: cambio.itemActual?.cuenta || '',
            banco: cambio.itemActual?.banco || 'NEQUI',
            valorCancelar: cambio.itemActual?.valorCancelar || 0,
            actualizarMaestro,
          };

      const res = await fetch('/api/admin/relacion-pagos/aprobar-cambios-intermensuales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemsAprobados: [payloadItem],
          mes,
          anio,
        }),
      });

      const resData = await res.json();
      if (resData.success) {
        setStatusMsg({
          text: revertir
            ? `✓ Se mantuvieron los datos anteriores de ${cambio.municipio} (${mesAnteriorInfo.mesAnterior}).`
            : `✓ Cambio intermensual aprobado para ${cambio.municipio}${actualizarMaestro ? ' y ficha maestra actualizada' : ''}.`,
          type: 'success',
        });
        fetchPagosData();
      } else {
        alert(resData.message || 'Error al procesar cambio');
      }
    } catch (err: any) {
      console.error('Error aprobando cambio:', err);
      alert('Error en conexión al aprobar cambio');
    } finally {
      setIsProcessingCambios(false);
    }
  };

  // Handler: Aprobar Todos los Cambios Intermensuales
  const handleAprobarTodosCambios = async (cambiosAprobar: CambioIntermensual[]) => {
    if (cambiosAprobar.length === 0) return;
    setIsProcessingCambios(true);
    try {
      const payloadItems = cambiosAprobar.map((c) => ({
        id: c.itemActual?.id || c.id,
        municipio: c.municipio,
        nombreEncargado: c.itemActual?.nombreEncargado || '',
        cedula: c.itemActual?.cedula || '',
        cuenta: c.itemActual?.cuenta || '',
        banco: c.itemActual?.banco || 'NEQUI',
        valorCancelar: c.itemActual?.valorCancelar || 0,
        actualizarMaestro: true,
      }));

      const res = await fetch('/api/admin/relacion-pagos/aprobar-cambios-intermensuales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemsAprobados: payloadItems,
          mes,
          anio,
        }),
      });

      const resData = await res.json();
      if (resData.success) {
        setStatusMsg({
          text: `✓ Se aprobaron ${cambiosAprobar.length} cambios intermensuales y se actualizó la ficha maestra de expendios para ${mes} ${anio}.`,
          type: 'success',
        });
        setShowCambiosModal(false);
        fetchPagosData();
      } else {
        alert(resData.message || 'Error al aprobar cambios');
      }
    } catch (err: any) {
      console.error('Error aprobando todos los cambios:', err);
      alert('Error en conexión al aprobar cambios');
    } finally {
      setIsProcessingCambios(false);
    }
  };

  // Handler: Exportar a Excel
  const handleExportExcel = () => {
    if (items.length === 0) {
      alert('No hay registros de relación de pagos para exportar en este periodo.');
      return;
    }

    const exportRows = items.map((item, index) => ({
      'N°': item.consecutivo || index + 1,
      'CENTRO OPERATIVO': item.centroOperativo || '',
      'MUNICIPIO': item.municipio || '',
      'CONCEPTO': item.concepto || `PAGO MES ${mes} EXPENDIO ${item.municipio}`,
      'NOMBRE DEL ENCARGADO': item.nombreEncargado || '',
      'CEDULA': item.cedula || '',
      'CUENTA BANCARIA / NEQUI': item.cuenta || '',
      'VALOR A CANCELAR': item.valorCancelar || 0,
      'BANCO': item.banco || 'NEQUI',
      'ESTADO': item.estado || 'Pendiente',
      'AUDITORÍA IA': item.analisisIA?.hayNovedad
        ? `NOVEDAD: ${(item.analisisIA.novedades || []).map((n: any) => typeof n === 'string' ? n : n.campo).join(', ')}`
        : item.analisisIA
        ? 'VERIFICADO SIN NOVEDADES'
        : 'PENDIENTE AUDITORÍA',
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `PAGOS_${mes}_${anio}`);

    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 20 },
      { wch: 22 },
      { wch: 40 },
      { wch: 32 },
      { wch: 16 },
      { wch: 24 },
      { wch: 18 },
      { wch: 14 },
      { wch: 20 },
      { wch: 36 },
    ];

    XLSX.writeFile(workbook, `RELACION_DE_PAGOS_${mes}_${anio}.xlsx`);
  };

  // Update item payment status inline
  const handleUpdateItemStatus = async (item: PagoRelacionItem, nuevoEstado: string) => {
    try {
      const updatedList = items.map((it) => (it.id === item.id ? { ...it, estado: nuevoEstado } : it));
      setItems(updatedList);

      await fetch('/api/admin/relacion-pagos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedList),
      });
    } catch (err) {
      console.error('Error actualizando estado:', err);
    }
  };

  // Update item account number and bank inline
  const handleUpdateItemCuentaBanco = async (item: PagoRelacionItem, nuevaCuenta: string, nuevoBanco: string) => {
    try {
      const updatedList = items.map((it) =>
        it.id === item.id ? { ...it, cuenta: nuevaCuenta, banco: nuevoBanco } : it
      );
      setItems(updatedList);

      await fetch(`/api/admin/relacion-pagos/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuenta: nuevaCuenta,
          banco: nuevoBanco,
        }),
      });
    } catch (err) {
      console.error('Error actualizando cuenta y banco:', err);
    }
  };

  // Match scanned signed accounts by cedula OR by municipio
  const getScannedCuentaForPago = (item: PagoRelacionItem): CuentaCargadaExpendio | undefined => {
    const cleanCed = (item?.cedula || '').replace(/\D/g, '');
    const munKey = (item?.municipio || '').trim().toUpperCase();

    return cuentasCargadas.find(
      (c) =>
        (cleanCed && (c?.cedula || '').replace(/\D/g, '') === cleanCed) ||
        (munKey && (c?.municipio || c?.expendio || '').trim().toUpperCase() === munKey)
    );
  };

  // Check if item has detected intermonthly change
  const getCambioIntermensualForItem = (item: PagoRelacionItem): CambioIntermensual | undefined => {
    const munKey = (item?.municipio || '').trim().toUpperCase();
    return cambiosIntermensuales.find(
      (c) => c.id === item?.id || (c.municipio || '').trim().toUpperCase() === munKey
    );
  };

  // Aplicar Novedad detectada por IA a la Base de Datos
  const handleAplicarNovedadIA = async () => {
    if (!auditModalData) return;
    const { item, cuenta } = auditModalData;
    const analisis = item.analisisIA || cuenta?.analisisIA;
    if (!analisis) return;

    setApplyingNovedad(true);
    try {
      const payload = {
        pagoId: item.id,
        nuevoNumeroCuenta: analisis.extraido?.cuenta || analisis.cuentaDetectada,
        nuevoBanco: analisis.extraido?.banco || analisis.bancoDetectado,
        nuevoEncargado: analisis.extraido?.encargado || analisis.encargadoDetectado,
        nuevoValor: analisis.extraido?.valor || analisis.valorDetectado,
        municipio: item.municipio,
      };

      const res = await fetch('/api/admin/relacion-pagos/aplicar-novedad-ia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setStatusMsg({
          text: `✓ Novedad aprobada: Base de datos y registro de pago sincronizados para ${item.municipio}.`,
          type: 'success',
        });
        setAuditModalData(null);
        fetchPagosData();
      } else {
        alert(data.message || 'Error al aplicar la novedad');
      }
    } catch (err: any) {
      console.error('Error aplicando novedad IA:', err);
      alert('Error en conexión al aplicar novedad.');
    } finally {
      setApplyingNovedad(false);
    }
  };

  // Re-analizar con IA
  const handleReanalizarIA = async () => {
    if (!auditModalData?.cuenta?.id) return;
    setReanalyzingIA(true);
    try {
      const res = await fetch(`/api/admin/cuentas-cargadas/${auditModalData.cuenta.id}/re-analizar-ia`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg({
          text: `✓ Re-análisis IA completado: ${data.analisisIA?.resumen}`,
          type: 'success',
        });
        setAuditModalData((prev) =>
          prev
            ? {
                ...prev,
                item: { ...prev.item, analisisIA: data.analisisIA },
                cuenta: { ...prev.cuenta!, analisisIA: data.analisisIA },
              }
            : null
        );
        fetchPagosData();
      } else {
        alert(data.message || 'Error en re-análisis IA');
      }
    } catch (err) {
      console.error('Error re-analizando IA:', err);
      alert('Error al conectar con el motor de IA.');
    } finally {
      setReanalyzingIA(false);
    }
  };

  // Handler para Resetear la base de Relación de Pagos
  const handleConfirmReset = async () => {
    if (!resetPassword.trim()) {
      setResetErrorMsg('Debe ingresar la contraseña de seguridad para autorizar el reset.');
      return;
    }
    if (resetPassword !== ADMIN_SECURITY_PASSWORD) {
      setResetErrorMsg('Contraseña de seguridad incorrecta. Operación no autorizada.');
      return;
    }

    setResetErrorMsg('');
    setIsResetting(true);
    try {
      const res = await fetch('/api/admin/relacion-pagos/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modo: resetModo,
          mes,
          anio,
          password: resetPassword,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg({
          text: data.message || 'Base de datos de relación de pagos reseteada exitosamente.',
          type: 'success',
        });
        setShowResetModal(false);
        setResetPassword('');
        fetchPagosData();
      } else {
        setResetErrorMsg(data.message || 'Error al resetear.');
      }
    } catch (err: any) {
      console.error('Error al resetear:', err);
      setResetErrorMsg('Error de conexión al resetear base de datos.');
    } finally {
      setIsResetting(false);
    }
  };

  // Filtered items
  const filteredItems = items.filter((item) => {
    const scanned = getScannedCuentaForPago(item);
    const analisis = item.analisisIA || scanned?.analisisIA;
    const hasNovedad = Boolean(analisis?.hayNovedad);
    const hasCambio = Boolean(getCambioIntermensualForItem(item));

    const matchesSearch =
      !searchTerm ||
      (item.nombreEncargado || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.cedula || '').includes(searchTerm) ||
      (item.municipio || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.centroOperativo || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.concepto || '').toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (filtroCentroOp !== 'TODOS') {
      const co = (item.centroOperativo || '').toUpperCase();
      if (!co.includes(filtroCentroOp.toUpperCase())) return false;
    }

    if (filtroEstado === 'TODOS') return true;
    if (filtroEstado === 'CAMBIOS_INTERMENSUALES') return hasCambio;
    if (filtroEstado === 'NOVEDADES_IA') return hasNovedad;
    if (filtroEstado === 'CARGADA') return Boolean(scanned || item.estado?.includes('Cargada'));
    if (filtroEstado === 'PENDIENTE') return !scanned && (!item.estado || item.estado.includes('Pendiente'));
    if (filtroEstado === 'PAGADO') return item.estado?.toUpperCase().includes('PAGADO');

    return true;
  });

  // Calculate statistics
  const totalValor = items.reduce((acc, curr) => acc + (Number(curr.valorCancelar) || 0), 0);
  const totalConCuentaCargada = items.filter((it) => {
    const scanned = getScannedCuentaForPago(it);
    return Boolean(scanned || it.estado?.includes('Cargada'));
  }).length;
  const totalNovedadesIA = items.filter((it) => {
    const scanned = getScannedCuentaForPago(it);
    const an = it.analisisIA || scanned?.analisisIA;
    return Boolean(an?.hayNovedad);
  }).length;
  const totalPagados = items.filter((it) => it.estado?.toUpperCase().includes('PAGADO')).length;

  // Distinct Centros Operativos with count
  const centrosOpCounts = items.reduce((acc: { [key: string]: number }, it) => {
    const co = it.centroOperativo || 'PO. BUCARAMANGA';
    acc[co] = (acc[co] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center space-x-2 text-emerald-400 font-bold text-xs tracking-wider uppercase mb-1">
              <FileSpreadsheet className="w-4 h-4" />
              <span>MÓDULO DE RELACIÓN DE PAGOS MENSUALES</span>
              <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded-full text-[10px] flex items-center space-x-1">
                <Bot className="w-3 h-3" />
                <span>Auditoría IA & Comparativa Intermensual</span>
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-100">
              Relación de Pagos e Informe de Cuentas de Cobro
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Control consolidado de desembolsos, detección automática de novedades en cuentas bancarias/titulares con IA y comparativa intermensual de cambios en encargados y cuentas.
            </p>
          </div>

          {/* Period Selector */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800 flex items-center space-x-2 text-xs">
              <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-slate-400 font-semibold">Periodo:</span>
              <select
                value={mes}
                onChange={(e) => setMes(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-100 font-bold rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
              >
                {MESES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label} ({m.value})
                  </option>
                ))}
              </select>
              <select
                value={anio}
                onChange={(e) => setAnio(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-100 font-bold rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
              >
                {ANIOS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={fetchPagosData}
              disabled={loading}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2 px-3 rounded-xl border border-slate-700 flex items-center space-x-1.5 cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Actualizar</span>
            </button>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleAutoGenerate}
              disabled={loading}
              className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs py-2 px-4 rounded-xl flex items-center space-x-2 shadow-lg shadow-amber-950/40 cursor-pointer transition-all transform active:scale-95 disabled:opacity-50"
              title="Sincroniza y pobla la lista de pagos vinculando los municipios y expendios activos"
            >
              <Sparkles className="w-4 h-4" />
              <span>Sincronizar por Municipio con BD ({items.length})</span>
            </button>

            {/* Input file oculto para cargar Excel */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx, .xls"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingExcel || loading}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2 px-3.5 rounded-xl border border-slate-700 flex items-center space-x-2 cursor-pointer transition-colors"
            >
              <Upload className={`w-3.5 h-3.5 ${uploadingExcel ? 'animate-bounce' : ''}`} />
              <span>{uploadingExcel ? 'Procesando Excel...' : 'Cargar Excel de Pagos'}</span>
            </button>

            <button
              onClick={handleExportExcel}
              disabled={items.length === 0}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2 px-3.5 rounded-xl border border-slate-700 flex items-center space-x-2 cursor-pointer transition-colors disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar Excel</span>
            </button>

            {cambiosIntermensuales.length > 0 && (
              <button
                onClick={() => setShowCambiosModal(true)}
                className="bg-amber-950/80 hover:bg-amber-900 border border-amber-500/80 text-amber-300 font-bold text-xs py-2 px-3.5 rounded-xl flex items-center space-x-1.5 shadow-md shadow-amber-950/50 cursor-pointer transition-all animate-pulse"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400" />
                <span>Auditar Cambios vs {mesAnteriorInfo.mesAnterior} ({cambiosIntermensuales.length})</span>
              </button>
            )}
          </div>

          {/* Tab Selector: Reporte Formal vs Tabla vs Dashboard */}
          <div className="flex items-center space-x-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('formal')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'formal'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-950/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Reporte Formal de Pago</span>
            </button>
            <button
              onClick={() => setActiveTab('tabla')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'tabla'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Gestión & Auditoría</span>
            </button>
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Dashboard Analítico</span>
            </button>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            <span className="text-slate-400">
              Total Registros: <strong className="text-slate-200">{items.length}</strong>
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">
              Total a Desembolsar:{' '}
              <strong className="text-amber-400 font-mono text-sm">{formatNumberWithDots(totalValor)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Banner de Auditoría y Cambios Intermensuales */}
      {cambiosIntermensuales.length > 0 && (
        <CambiosIntermensualesBanner
          cambios={cambiosIntermensuales}
          mesActual={mes}
          anioActual={anio}
          mesAnterior={mesAnteriorInfo.mesAnterior}
          anioAnterior={mesAnteriorInfo.anioAnterior}
          onOpenModal={() => setShowCambiosModal(true)}
          onAprobarTodos={() => handleAprobarTodosCambios(cambiosIntermensuales)}
          isProcessing={isProcessingCambios}
        />
      )}

      {/* Status feedback message */}
      {statusMsg && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs transition-all ${
            statusMsg.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
              : statusMsg.type === 'warning'
              ? 'bg-amber-950/80 border-amber-600 text-amber-300'
              : 'bg-rose-950/80 border-rose-600 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            {statusMsg.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : statusMsg.type === 'warning' ? (
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span className="font-semibold">{statusMsg.text}</span>
          </div>
          <button
            onClick={() => setStatusMsg(null)}
            className="text-xs font-bold opacity-80 hover:opacity-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: REPORTE FORMAL INSTITUCIONAL DE PAGOS */}
      {activeTab === 'formal' && (
        <ReporteFormalView
          items={items}
          mes={mes}
          anio={anio}
          onUpdateItemStatus={handleUpdateItemStatus}
          onUpdateItemCuentaBanco={handleUpdateItemCuentaBanco}
        />
      )}

      {/* TAB 2: GESTIÓN OPERATIVA Y AUDITORÍA IA (TABLA) */}
      {activeTab === 'tabla' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3 bg-slate-950/40">
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar por municipio, encargado, cédula..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Quick Centro Operativo Filter */}
            <select
              value={filtroCentroOp}
              onChange={(e) => setFiltroCentroOp(e.target.value)}
              className="w-full sm:w-auto bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
            >
              <option value="TODOS">Todos los C.O. ({items.length})</option>
              {Object.entries(centrosOpCounts).map(([co, count]) => (
                <option key={co} value={co}>
                  {co} ({count})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center space-x-2 w-full md:w-auto justify-end">
            <span className="text-[11px] font-bold text-amber-400 bg-amber-950/50 border border-amber-800/60 px-3 py-1.5 rounded-xl">
              Mostrando {filteredItems.length} de {items.length} expendios
            </span>

            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 font-medium focus:outline-none cursor-pointer"
            >
              <option value="TODOS">Todos los Estados</option>
              {cambiosIntermensuales.length > 0 && (
                <option value="CAMBIOS_INTERMENSUALES">🔄 Con Cambios vs {mesAnteriorInfo.mesAnterior} ({cambiosIntermensuales.length})</option>
              )}
              <option value="NOVEDADES_IA">⚠️ Con Novedades IA ({totalNovedadesIA})</option>
              <option value="CARGADA">Con Cuenta Firmada ({totalConCuentaCargada})</option>
              <option value="PENDIENTE">Cuenta Pendiente</option>
              <option value="PAGADO">Desembolsos Pagados</option>
            </select>
          </div>
        </div>

        {/* Payment Relationship Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase font-bold text-[11px] tracking-wider">
                <th className="py-3.5 px-3 text-center w-10">N°</th>
                <th className="py-3.5 px-3">Centro Operativo</th>
                <th className="py-3.5 px-3">Municipio</th>
                <th className="py-3.5 px-3">Encargado</th>
                <th className="py-3.5 px-3 font-mono">Cédula</th>
                <th className="py-3.5 px-3">Cuenta Bancaria / Nequi</th>
                <th className="py-3.5 px-3 text-right">Valor a Cancelar</th>
                <th className="py-3.5 px-3 text-center">Cuenta Firmada & Auditoría IA</th>
                <th className="py-3.5 px-3 text-center">Estado de Pago</th>
                <th className="py-3.5 px-3 text-center sticky right-0 z-20 bg-slate-950 shadow-[-4px_0_12px_rgba(0,0,0,0.5)] border-l border-slate-800">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {filteredItems.length > 0 ? (
                filteredItems.map((item, index) => {
                  const scanned = getScannedCuentaForPago(item);
                  const isCargada = Boolean(scanned || item.estado?.includes('Cargada'));
                  const isPagado = item.estado?.toUpperCase().includes('PAGADO');
                  const analisis = item.analisisIA || scanned?.analisisIA;
                  const hasNovedad = Boolean(analisis?.hayNovedad);
                  const cambio = getCambioIntermensualForItem(item);

                  return (
                    <tr
                      key={item.id || index}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        cambio ? 'bg-amber-950/10 border-l-2 border-l-amber-500' : ''
                      } ${hasNovedad ? 'bg-rose-950/15' : ''}`}
                    >
                      <td className="py-3 px-3 text-center font-mono text-slate-400 font-semibold">
                        {item.consecutivo || index + 1}
                      </td>

                      {/* Centro Operativo */}
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[11px] border border-slate-700 font-bold whitespace-nowrap">
                          {item.centroOperativo || 'PO. CUCUTA'}
                        </span>
                      </td>

                      {/* Municipio - Source of truth */}
                      <td className="py-3 px-3">
                        <div className="font-black text-slate-100 text-xs flex items-center space-x-1.5 whitespace-nowrap">
                          <span>{item.municipio}</span>
                          {cambio && (
                            <button
                              onClick={() => setShowCambiosModal(true)}
                              className="text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded flex items-center space-x-0.5 hover:bg-amber-500/30 cursor-pointer"
                              title={`Cambio detectado vs ${mesAnteriorInfo.mesAnterior}: ${cambio.cambios.map(c => c.label).join(', ')}`}
                            >
                              <ArrowLeftRight className="w-2.5 h-2.5" />
                              <span>Cambio vs {mesAnteriorInfo.mesAnterior}</span>
                            </button>
                          )}
                          {hasNovedad && (
                            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                          )}
                        </div>
                      </td>

                      {/* Encargado (Columna Separada) */}
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-100 uppercase text-xs">{item.nombreEncargado}</div>
                        {cambio?.cambios.some(c => c.campo === 'encargado') && (
                          <div className="text-[10px] text-amber-400 font-medium flex items-center space-x-1 mt-0.5">
                            <span>Anterior ({mesAnteriorInfo.mesAnterior}):</span>
                            <span className="text-slate-400 line-through">
                              {cambio.cambios.find(c => c.campo === 'encargado')?.valorAnterior}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Cédula (Columna Separada) */}
                      <td className="py-3 px-3 font-mono">
                        <div className="text-slate-200 font-mono text-xs font-semibold whitespace-nowrap">
                          {item.cedula || 'Sin cédula'}
                        </div>
                        {cambio?.cambios.some(c => c.campo === 'cedula') && (
                          <div className="text-[10px] text-sky-400 font-medium mt-0.5 line-through">
                            {cambio.cambios.find(c => c.campo === 'cedula')?.valorAnterior}
                          </div>
                        )}
                      </td>

                      {/* Cuenta Bancaria / Nequi (Columna con edición rápida) */}
                      <td className="py-2.5 px-3 min-w-[170px]">
                        <input
                          type="text"
                          defaultValue={item.cuenta || ''}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val && val !== item.cuenta) {
                              handleUpdateItemCuentaBanco(item, val, item.banco || 'NEQUI');
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="w-full bg-slate-950/60 hover:bg-slate-950 focus:bg-slate-950 border border-slate-700/70 hover:border-amber-500/70 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 rounded-lg px-2 py-0.5 font-mono text-amber-300 font-bold text-xs outline-none transition-all"
                          title="Clic para modificar el número de cuenta"
                        />
                        <div className="text-[10px] text-slate-400 font-semibold uppercase mt-0.5 px-1">{item.banco || 'NEQUI'}</div>
                        {cambio?.cambios.some(c => c.campo === 'cuenta') && (
                          <div className="text-[10px] text-emerald-400 font-medium mt-0.5 line-through px-1">
                            {formatCuentaBancaria(cambio.cambios.find(c => c.campo === 'cuenta')?.valorAnterior).cuenta}
                          </div>
                        )}
                      </td>

                      {/* Valor a Cancelar */}
                      <td className="py-3 px-3 text-right">
                        <div className="font-mono font-black text-amber-400 text-sm whitespace-nowrap">
                          {formatNumberWithDots(item.valorCancelar || 0)}
                        </div>
                      </td>

                      {/* Cuenta Escaneada & Auditoria IA */}
                      <td className="py-3 px-3 text-center">
                        {hasNovedad ? (
                          <button
                            onClick={() => setAuditModalData({ item, cuenta: scanned })}
                            className="inline-flex items-center space-x-1.5 bg-rose-950/90 hover:bg-rose-900 text-rose-300 border border-rose-600 px-2.5 py-1 rounded-lg text-xs font-bold shadow-lg shadow-rose-950/50 cursor-pointer animate-pulse transition-all"
                            title="Haz clic para ver las novedades detectadas por IA"
                          >
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                            <span>Novedad IA ({analisis?.novedades?.length || 1})</span>
                          </button>
                        ) : scanned ? (
                          <div className="flex items-center justify-center space-x-1.5">
                            <button
                              onClick={() => setAuditModalData({ item, cuenta: scanned })}
                              className="group inline-flex items-center space-x-1 bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 hover:bg-emerald-900 px-2 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all shadow"
                              title="Auditoría IA completada sin novedades. Clic para ver detalles."
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
                              <span>IA Verificada</span>
                            </button>
                            <button
                              onClick={() =>
                                setPreviewPhotoUrl({
                                  url: scanned.fotoUrl,
                                  title: `Cuenta de Cobro Firmada - ${item.municipio} (${item.nombreEncargado})`,
                                })
                              }
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 cursor-pointer"
                              title="Ver imagen escaneada B&N"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : isCargada ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                            <Check className="w-3 h-3" />
                            <span>Cargada</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950/60 text-amber-400 border border-amber-800/60">
                            <Clock className="w-3 h-3" />
                            <span>Pendiente</span>
                          </span>
                        )}
                      </td>

                      {/* Estado de Pago */}
                      <td className="py-3 px-3 text-center">
                        <select
                          value={item.estado || 'Pendiente'}
                          onChange={(e) => handleUpdateItemStatus(item, e.target.value)}
                          className={`text-xs font-bold rounded-lg px-2 py-1 border focus:outline-none cursor-pointer ${
                            isPagado
                              ? 'bg-blue-950 text-blue-300 border-blue-700'
                              : hasNovedad
                              ? 'bg-rose-950 text-rose-300 border-rose-700'
                              : isCargada
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                              : 'bg-slate-950 text-slate-300 border-slate-700'
                          }`}
                        >
                          <option value="Pendiente">Pendiente</option>
                          <option value="Cuenta Firmada Cargada">Cuenta Firmada Cargada</option>
                          <option value="Listo para Pago">Listo para Pago</option>
                          <option value="Pagado">Pagado</option>
                        </select>
                      </td>

                      {/* Acciones */}
                      <td className="py-3 px-3 text-center sticky right-0 z-10 bg-slate-900/95 backdrop-blur-xs shadow-[-4px_0_12px_rgba(0,0,0,0.5)] border-l border-slate-800">
                        <div className="flex items-center justify-center space-x-1">
                          {cambio && (
                            <button
                              onClick={() => setShowCambiosModal(true)}
                              title={`Validar cambio intermensual vs ${mesAnteriorInfo.mesAnterior}`}
                              className="p-1.5 rounded-lg bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-700 cursor-pointer"
                            >
                              <ArrowLeftRight className="w-4 h-4" />
                            </button>
                          )}
                          {scanned && (
                            <button
                              onClick={() => setAuditModalData({ item, cuenta: scanned })}
                              title="Abrir Auditoría Inteligente con IA"
                              className="p-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700 cursor-pointer"
                            >
                              <Bot className="w-4 h-4" />
                            </button>
                          )}
                          {scanned && (
                            <button
                              onClick={() =>
                                setPreviewPhotoUrl({
                                  url: scanned.fotoUrl,
                                  title: `Cuenta de Cobro Firmada - ${item.municipio} (${item.nombreEncargado})`,
                                })
                              }
                              title="Ver documento escaneado B&N"
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 cursor-pointer"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500">
                    <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm font-semibold text-slate-400">
                      No hay registros de pagos para {mes} {anio}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Haz clic en "Sincronizar por Municipio con BD" o sube un archivo Excel para cargar la relación.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* TAB 2: DASHBOARD POR MES, CENTRO OPERATIVO Y TOTAL FACTURADO */}
      {activeTab === 'dashboard' && (
        <DashboardRelacionPagos
          items={items}
          mesActual={mes}
          anioActual={anio}
        />
      )}

      {/* Modal de Reset de Base de Datos para Marzo 2026 */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-rose-800/80 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="p-5 bg-gradient-to-r from-rose-950 to-slate-900 border-b border-rose-800/60 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-sm">
                    Reset en Base de Datos de Relación de Pagos
                  </h3>
                  <p className="text-xs text-rose-300">
                    Limpieza de registros anteriores para inicio en Marzo 2026
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowResetModal(false)}
                className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs text-slate-300">
              <p className="text-slate-300">
                Selecciona la opción de limpieza que deseas ejecutar para dejar la base de datos lista para operar a partir del mes de <strong>Marzo 2026</strong>:
              </p>

              <div className="space-y-2.5">
                <label
                  className={`flex items-start space-x-3 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    resetModo === 'anteriores_a_marzo'
                      ? 'bg-rose-950/40 border-rose-500 text-slate-100'
                      : 'bg-slate-950 border-slate-800 hover:bg-slate-800/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="resetModo"
                    value="anteriores_a_marzo"
                    checked={resetModo === 'anteriores_a_marzo'}
                    onChange={() => setResetModo('anteriores_a_marzo')}
                    className="mt-0.5 text-rose-500 focus:ring-rose-500"
                  />
                  <div>
                    <strong className="text-slate-100 block">
                      Eliminar todos los registros anteriores a Marzo 2026 (Recomendado)
                    </strong>
                    <span className="text-slate-400 text-[11px] block mt-0.5">
                      Borra datos de prueba de Enero y Febrero 2026 para iniciar con datos limpios en Marzo 2026 en adelante.
                    </span>
                  </div>
                </label>

                <label
                  className={`flex items-start space-x-3 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    resetModo === 'mes_actual'
                      ? 'bg-rose-950/40 border-rose-500 text-slate-100'
                      : 'bg-slate-950 border-slate-800 hover:bg-slate-800/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="resetModo"
                    value="mes_actual"
                    checked={resetModo === 'mes_actual'}
                    onChange={() => setResetModo('mes_actual')}
                    className="mt-0.5 text-rose-500 focus:ring-rose-500"
                  />
                  <div>
                    <strong className="text-slate-100 block">
                      Limpiar únicamente el periodo seleccionado ({mes} {anio})
                    </strong>
                    <span className="text-slate-400 text-[11px] block mt-0.5">
                      Elimina solo los registros cargados para el mes y año actualmente en pantalla.
                    </span>
                  </div>
                </label>

                <label
                  className={`flex items-start space-x-3 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    resetModo === 'todos'
                      ? 'bg-rose-950/40 border-rose-500 text-slate-100'
                      : 'bg-slate-950 border-slate-800 hover:bg-slate-800/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="resetModo"
                    value="todos"
                    checked={resetModo === 'todos'}
                    onChange={() => setResetModo('todos')}
                    className="mt-0.5 text-rose-500 focus:ring-rose-500"
                  />
                  <div>
                    <strong className="text-slate-100 block">
                      Reset Total (Vaciar toda la tabla de relación de pagos)
                    </strong>
                    <span className="text-slate-400 text-[11px] block mt-0.5">
                      Borra absolutamente todos los registros históricos de desembolsos.
                    </span>
                  </div>
                </label>
              </div>

              <div className="p-3 bg-amber-950/40 border border-amber-700/60 rounded-xl text-amber-300 flex items-center space-x-2 text-[11px]">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>
                  Esta acción actualizará la base de datos inmediatamente. No afectará la base maestra de expendios.
                </span>
              </div>

              {/* Password Authorization */}
              <div className="space-y-1.5 pt-1">
                <label className="block text-xs font-semibold text-slate-200 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Contraseña Maestra de Autorización:</span>
                  </span>
                  <span className="text-[10px] text-amber-400 font-mono font-medium">Requerida</span>
                </label>

                <div className="relative">
                  <input
                    type={showResetPassword ? 'text' : 'password'}
                    value={resetPassword}
                    onChange={(e) => {
                      setResetPassword(e.target.value);
                      if (resetErrorMsg) setResetErrorMsg('');
                    }}
                    placeholder="Ingrese la contraseña de seguridad..."
                    className="w-full bg-slate-950 border border-slate-700 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 text-slate-100 placeholder-slate-500 text-xs rounded-xl py-2.5 pl-3 pr-10 outline-none transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                    tabIndex={-1}
                  >
                    {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {resetErrorMsg ? (
                  <p className="text-xs text-rose-400 font-medium flex items-center gap-1 pt-0.5">
                    <span>⚠️</span> {resetErrorMsg}
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-400">
                    🔒 Ingrese la contraseña maestra del sistema para validar el reseteo.
                  </p>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-end space-x-3">
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setResetPassword('');
                  setResetErrorMsg('');
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmReset}
                disabled={isResetting || !resetPassword.trim()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center space-x-1.5 shadow-lg shadow-rose-950/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
                <span>{isResetting ? 'Reseteando...' : 'Confirmar y Ejecutar Reset'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Validación y Aprobación de Cambios Intermensuales */}
      <CambiosIntermensualesModal
        isOpen={showCambiosModal}
        onClose={() => setShowCambiosModal(false)}
        cambios={cambiosIntermensuales}
        mesActual={mes}
        anioActual={anio}
        mesAnterior={mesAnteriorInfo.mesAnterior}
        anioAnterior={mesAnteriorInfo.anioAnterior}
        onAprobarIndividual={handleAprobarCambioIndividual}
        onAprobarTodos={handleAprobarTodosCambios}
        isProcessing={isProcessingCambios}
      />

      {/* Modal de Auditoría Inteligente IA y Aprobación de Novedades */}
      {auditModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                    <span>Auditoría IA de Cuenta de Cobro</span>
                    {auditModalData.item.analisisIA?.hayNovedad ? (
                      <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                        Novedad Detectada
                      </span>
                    ) : (
                      <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                        Sin Novedades
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Municipio: <strong className="text-slate-200">{auditModalData.item?.municipio}</strong> • Encargado:{' '}
                    <strong className="text-slate-200">{auditModalData.item?.nombreEncargado}</strong> • Cédula:{' '}
                    <strong className="text-slate-200 font-mono">{auditModalData.item?.cedula}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAuditModalData(null)}
                className="text-slate-400 hover:text-slate-200 p-2 rounded-xl hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left: Scanned Document Preview */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Camera className="w-4 h-4 text-amber-400" />
                    <span>Documento Escaneado B&N (Magic Pro)</span>
                  </h4>
                  {auditModalData.cuenta?.fotoUrl ? (
                    <div className="relative border border-slate-800 rounded-xl overflow-hidden bg-slate-950 group">
                      <img
                        src={auditModalData.cuenta.fotoUrl}
                        alt="Cuenta de Cobro"
                        className="w-full max-h-[380px] object-contain mx-auto"
                      />
                      <button
                        onClick={() =>
                          setPreviewPhotoUrl({
                            url: auditModalData.cuenta!.fotoUrl,
                            title: `Cuenta de Cobro Firmada - ${auditModalData.item.municipio}`,
                          })
                        }
                        className="absolute bottom-3 right-3 bg-slate-900/90 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 shadow-lg flex items-center space-x-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Ver Pantalla Completa</span>
                      </button>
                    </div>
                  ) : (
                    <div className="h-64 border border-dashed border-slate-800 rounded-xl flex items-center justify-center text-slate-500 text-xs">
                      No hay imagen escaneada disponible
                    </div>
                  )}
                </div>

                {/* Right: AI Comparison & Novedades */}
                <div className="space-y-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-1.5">
                        <Zap className="w-4 h-4 text-emerald-400" />
                        <span>Extracción y Comparación OCR / IA</span>
                      </h4>
                      <span className="text-[10px] text-slate-400">
                        {auditModalData.item.analisisIA?.fechaAnalisis
                          ? new Date(auditModalData.item.analisisIA.fechaAnalisis).toLocaleDateString('es-CO')
                          : 'Reciente'}
                      </span>
                    </div>

                      <div className="space-y-2 text-xs">
                      {/* Titular Comparison */}
                      <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80 flex flex-col space-y-1">
                        <span className="text-slate-400 text-[10px] font-semibold uppercase">Nombre del Titular:</span>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-300">BD: <strong>{auditModalData.item.nombreEncargado}</strong></span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-emerald-400 font-bold">
                            IA: {auditModalData.item.analisisIA?.extraido?.encargado || auditModalData.item.analisisIA?.encargadoDetectado || auditModalData.item.nombreEncargado}
                          </span>
                        </div>
                      </div>

                      {/* Bank Account Comparison */}
                      <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80 flex flex-col space-y-1">
                        <span className="text-slate-400 text-[10px] font-semibold uppercase">Cuenta Bancaria / Nequi:</span>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-300 font-mono">BD: <strong>{auditModalData.item.cuenta}</strong></span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-amber-400 font-mono font-bold">
                            IA: {auditModalData.item.analisisIA?.extraido?.cuenta || auditModalData.item.analisisIA?.cuentaDetectada || auditModalData.item.cuenta} ({auditModalData.item.analisisIA?.extraido?.banco || auditModalData.item.analisisIA?.bancoDetectado || auditModalData.item.banco})
                          </span>
                        </div>
                      </div>

                      {/* Monto Comparison */}
                      <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80 flex flex-col space-y-1">
                        <span className="text-slate-400 text-[10px] font-semibold uppercase">Valor a Cancelar:</span>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-300 font-mono">BD: <strong>{formatNumberWithDots(auditModalData.item.valorCancelar)}</strong></span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-emerald-400 font-mono font-bold">
                            IA: {auditModalData.item.analisisIA?.extraido?.valor ? formatNumberWithDots(auditModalData.item.analisisIA.extraido.valor) : auditModalData.item.analisisIA?.valorDetectado ? formatNumberWithDots(auditModalData.item.analisisIA.valorDetectado) : formatNumberWithDots(auditModalData.item.valorCancelar)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Novedades Detectadas List */}
                  {auditModalData.item.analisisIA?.hayNovedad && (
                    <div className="bg-rose-950/40 border border-rose-700/60 rounded-xl p-4 space-y-2.5">
                      <div className="flex items-center space-x-2 text-rose-300 font-bold text-xs">
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                        <span>Novedades Críticas Identificadas:</span>
                      </div>
                      <div className="space-y-1.5">
                        {auditModalData.item.analisisIA.novedades?.map((nov: any, idx) => (
                          <div key={idx} className="bg-rose-900/30 p-2 rounded-lg border border-rose-800/40 text-xs text-rose-200 space-y-0.5">
                            {typeof nov === 'string' ? (
                              <div className="text-[11px]">{nov}</div>
                            ) : (
                              <>
                                <div className="font-semibold text-[11px] text-rose-300 uppercase">{nov.campo}:</div>
                                <div className="text-[11px]">{nov.descripcion}</div>
                                <div className="text-[10px] text-slate-400 font-mono">
                                  Anterior: <span className="line-through text-slate-300">{String(nov.valorAnterior || '---')}</span> ➔ Nuevo: <strong className="text-amber-300">{String(nov.valorNuevo || '---')}</strong>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions inside Modal */}
                  <div className="flex flex-col gap-2 pt-2">
                    {auditModalData.item.analisisIA?.hayNovedad && (
                      <button
                        onClick={handleAplicarNovedadIA}
                        disabled={applyingNovedad}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-950/50 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{applyingNovedad ? 'Actualizando Base de Datos...' : 'Aprobar Novedades y Actualizar Base de Datos'}</span>
                      </button>
                    )}

                    <button
                      onClick={handleReanalizarIA}
                      disabled={reanalyzingIA}
                      className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs py-2 px-4 rounded-xl border border-slate-700 flex items-center justify-center space-x-2 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${reanalyzingIA ? 'animate-spin' : ''}`} />
                      <span>{reanalyzingIA ? 'Consultando Gemini Vision IA...' : 'Re-ejecutar Auditoría IA con Gemini'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-end space-x-3">
              <button
                onClick={() => setAuditModalData(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Visor de Documento Escaneado */}
      {previewPhotoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
              <h3 className="font-bold text-slate-100 text-sm flex items-center space-x-2">
                <Camera className="w-4 h-4 text-emerald-400" />
                <span>{previewPhotoUrl.title}</span>
              </h3>
              <button
                onClick={() => setPreviewPhotoUrl(null)}
                className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-4 bg-slate-950 flex items-center justify-center max-h-[80vh] overflow-auto">
              <img
                src={previewPhotoUrl.url}
                alt="Documento Escaneado"
                className="max-h-[72vh] object-contain rounded-lg border border-slate-800 shadow-2xl"
              />
            </div>
            <div className="p-3 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end">
              <button
                onClick={() => setPreviewPhotoUrl(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Discrepancias en Datos del Encargado */}
      {discrepanciasModal && (
        <DiscrepanciasEncargadoModal
          isOpen={discrepanciasModal.isOpen}
          discrepancias={discrepanciasModal.discrepancias}
          contexto="relacion_pagos"
          periodo={`${mes} ${anio}`}
          isProcessing={resolviendoDiscrepancias}
          onResolver={handleResolverDiscrepanciasPagos}
          onClose={() => setDiscrepanciasModal(null)}
        />
      )}
    </div>
  );
};
