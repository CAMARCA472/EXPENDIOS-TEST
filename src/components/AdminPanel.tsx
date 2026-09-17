import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { ExpendioData, HistorialItem, CuentaCobroParams, CuentaCobroResult, ResumenFinancieroCuentas, SystemConfig } from '../types';
import { generateCuentasCobroPDF, generateReporteFotograficoPDF, generateReporteFotograficoZip } from '../utils/pdfGenerator';
import { formatPesos, formatNumberWithDots } from '../utils/formatters';
import { numeroALetras } from '../utils/numeroALetras';
import { CuentaCobroDocument } from './CuentaCobroDocument';
import { ExpendioEditorModal } from './ExpendioEditorModal';
import { RegistroFotograficoCard } from './RegistroFotograficoCard';
import { PhotoLightboxModal } from './PhotoLightboxModal';
import { ExcelImportModal } from './ExcelImportModal';
import { TrazabilidadExpendiosPanel } from './TrazabilidadExpendiosPanel';
import { ReporteFotograficoMunicipiosView } from './ReporteFotograficoMunicipiosView';
import { RelacionPagosPanel } from './RelacionPagosPanel';
import { PeriodoDescargaConfigCard } from './PeriodoDescargaConfigCard';
import { HistorialDashboard } from './HistorialDashboard';
import { CargarGenerarModal, CargarGenerarConfig } from './CargarGenerarModal';
import { DiscrepanciasEncargadoModal } from './DiscrepanciasEncargadoModal';
import { ConfirmarBorradoModal } from './ConfirmarBorradoModal';
import { ConciliacionCuentasAIModal } from './ConciliacionCuentasAIModal';
import { CopiaSeguridadModal } from './CopiaSeguridadModal';
import { ErrorBoundary } from './ErrorBoundary';
import { EliminarBaseDatosModal } from './EliminarBaseDatosModal';
import { AdminMetricasView } from './AdminMetricasView';
import { AdminDocumentosExpendiosPanel } from './AdminDocumentosExpendiosPanel';
import { GoogleSheetsDatabaseManager } from './GoogleSheetsDatabaseManager';
import { EstadoConexion, notifyReportSaved } from './EstadoConexion';
import { useAutoBackupGoogleDrive } from '../hooks/useAutoBackupGoogleDrive';
import { DiscrepanciaEncargadoItem, ResolucionDiscrepanciasModo } from '../types';
import {
  Activity,
  FileCheck2,
  History,
  Camera,
  Download,
  Filter,
  CheckCircle2,
  Calendar,
  Building2,
  FileSpreadsheet,
  FolderDown,
  RefreshCw,
  Search,
  Sparkles,
  Layers,
  ArrowUpRight,
  Upload,
  Printer,
  FileUp,
  AlertCircle,
  AlertTriangle,
  Edit3,
  Trash2,
  Plus,
  Store,
  Check,
  Image,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  CheckSquare,
  Square,
  ShieldCheck,
  BookOpen,
  DollarSign,
  Wallet,
  FileText,
  TrendingUp,
  Database,
  Receipt,
  FileArchive,
  Cloud,
} from 'lucide-react';

import { FirebaseHealthCheck } from './FirebaseHealthCheck';

// Meses y Años estándar para el sistema
const MESES_SISTEMA = [
  { value: 'ENERO', num: '01', label: 'Enero', dias: 31 },
  { value: 'FEBRERO', num: '02', label: 'Febrero', dias: 28 },
  { value: 'MARZO', num: '03', label: 'Marzo', dias: 31 },
  { value: 'ABRIL', num: '04', label: 'Abril', dias: 30 },
  { value: 'MAYO', num: '05', label: 'Mayo', dias: 31 },
  { value: 'JUNIO', num: '06', label: 'Junio', dias: 30 },
  { value: 'JULIO', num: '07', label: 'Julio', dias: 31 },
  { value: 'AGOSTO', num: '08', label: 'Agosto', dias: 31 },
  { value: 'SEPTIEMBRE', num: '09', label: 'Septiembre', dias: 30 },
  { value: 'OCTUBRE', num: '10', label: 'Octubre', dias: 31 },
  { value: 'NOVIEMBRE', num: '11', label: 'Noviembre', dias: 30 },
  { value: 'DICIEMBRE', num: '12', label: 'Diciembre', dias: 31 },
];

const ANIOS_SISTEMA = [
  '2024', '2025', '2026', '2027', '2028', '2029', '2030',
  '2031', '2032', '2033', '2034', '2035', '2036', '2037', '2038', '2039', '2040'
];

export const AdminPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'expendios' | 'cobros' | 'pagos' | 'historial' | 'fotos' | 'trazabilidad' | 'metricas' | 'documentos' | 'sheets'
  >('expendios');
  const [expendios, setExpendios] = useState<ExpendioData[]>([]);
  const [selectedFotoExpendioId, setSelectedFotoExpendioId] = useState<string>('');
  const [historial, setHistorial] = useState<HistorialItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Modal editor de expendios & Sync Feedback
  const [showEditorModal, setShowEditorModal] = useState<boolean>(false);
  const [showExcelModal, setShowExcelModal] = useState<boolean>(false);
  const [showAIConciliacionModal, setShowAIConciliacionModal] = useState<boolean>(false);
  const [showCopiaSeguridadModal, setShowCopiaSeguridadModal] = useState<boolean>(false);
  const [copiaSeguridadInitialTab, setCopiaSeguridadInitialTab] = useState<'cloudFirestore' | 'googleSheets' | 'export' | 'import' | 'snapshots' | 'googleDrive' | 'ambienteSync'>('googleSheets');
  const [showEliminarBaseDatosModal, setShowEliminarBaseDatosModal] = useState<boolean>(false);

  // Auto Backup Google Drive (Cada 10 minutos)
  const {
    isAuthenticated: isGoogleDriveConnected,
    tiempoRestanteStr: driveTiempoRestante,
    autoBackupActivo: driveAutoActivo,
    user: googleDriveUser,
    accessToken: driveAccessToken,
    signIn: handleGoogleSignIn,
  } = useAutoBackupGoogleDrive();

  useEffect(() => {
    const handleDriveBackupDone = (e: any) => {
      const record = e.detail;
      if (record) {
        setSyncStatusMsg(`✓ Copia de seguridad automática en Google Drive completada exitosamente: ${record.name}`);
        setTimeout(() => setSyncStatusMsg(''), 8000);
      }
    };
    window.addEventListener('googleDriveBackupCompleted', handleDriveBackupDone);
    return () => window.removeEventListener('googleDriveBackupCompleted', handleDriveBackupDone);
  }, []);
  const [editingExpendio, setEditingExpendio] = useState<ExpendioData | null>(null);
  const [deletingExpendio, setDeletingExpendio] = useState<ExpendioData | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('');
  const [searchExpendioTerm, setSearchExpendioTerm] = useState<string>('');
  const [searchFotoExpendioTerm, setSearchFotoExpendioTerm] = useState<string>('');
  const [generandoPDFTodos, setGenerandoPDFTodos] = useState<boolean>(false);
  const [generandoZipTodos, setGenerandoZipTodos] = useState<boolean>(false);
  const [previewPhotoModal, setPreviewPhotoModal] = useState<{
    url: string;
    title: string;
    subtitle?: string;
    metadata?: {
      encargado?: string;
      cedula?: string;
      municipio?: string;
      direccion?: string;
      telefono?: string;
    };
  } | null>(null);

  // Scrollbar synchronization for table (Top scrollbar & arrow controls)
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState<number>(0);
  const isSyncingScroll = useRef<boolean>(false);

  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    let rAF: number | null = null;
    const updateWidth = () => {
      if (!container) return;
      if (rAF) cancelAnimationFrame(rAF);
      rAF = requestAnimationFrame(() => {
        const w = container.scrollWidth;
        setTableScrollWidth((prev) => (Math.abs(prev - w) < 2 ? prev : w));
      });
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);

    return () => {
      if (rAF) cancelAnimationFrame(rAF);
      observer.disconnect();
    };
  }, [expendios?.length, searchExpendioTerm, activeTab]);

  const handleTopScroll = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (tableContainerRef.current && topScrollRef.current) {
      tableContainerRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
    isSyncingScroll.current = false;
  };

  const handleTableScroll = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (tableContainerRef.current && topScrollRef.current) {
      topScrollRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
    }
    isSyncingScroll.current = false;
  };

  const scrollTable = (direction: 'left' | 'right') => {
    if (tableContainerRef.current) {
      const amount = direction === 'left' ? -380 : 380;
      tableContainerRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  // Funcionalidad 1: Cuentas de cobro params & Excel upload
  const [aplicarGrossUp, setAplicarGrossUp] = useState<boolean>(false);
  const [modificarValorInicialRetencion, setModificarValorInicialRetencion] = useState<number>(0);
  const [porcentajeRetencion, setPorcentajeRetencion] = useState<number>(1);
  const [periodoMes, setPeriodoMes] = useState<string>('MARZO');
  const [periodoAnio, setPeriodoAnio] = useState<string>('2026');
  const periodo = `${periodoMes} ${periodoAnio}`;
  const [cuentasGeneradas, setCuentasGeneradas] = useState<CuentaCobroResult[]>([]);
  const [selectedCuentasKeys, setSelectedCuentasKeys] = useState<string[]>([]);
  const [searchCuentasTerm, setSearchCuentasTerm] = useState<string>('');
  const [generandoPDF, setGenerandoPDF] = useState<boolean>(false);
  const [mensajeCobros, setMensajeCobros] = useState<string>('');

  // Edit modal period dropdown state
  const [editMes, setEditMes] = useState<string>('MARZO');
  const [editAnio, setEditAnio] = useState<string>('2026');

  // Excel upload state & Contabilidad sync
  const [fileExcel, setFileExcel] = useState<File | null>(null);
  const [subiendoExcel, setSubiendoExcel] = useState<boolean>(false);
  const [errorExcel, setErrorExcel] = useState<string>('');
  const [alertasExcel, setAlertasExcel] = useState<string[]>([]);
  const [cargarAContabilidadAuto, setCargarAContabilidadAuto] = useState<boolean>(true);
  const [cargandoAContabilidad, setCargandoAContabilidad] = useState<boolean>(false);
  const [resumenFinanciero, setResumenFinanciero] = useState<ResumenFinancieroCuentas | null>(null);

  // Helper to calculate financial summary of accounts
  const computeResumen = (cuentas: CuentaCobroResult[], periodoStr: string): ResumenFinancieroCuentas => {
    const totalCargoBasico = cuentas.reduce((acc, c) => acc + (c.cargoBasico ?? c.valorBase ?? 0), 0);
    const totalSubsidioSipost = cuentas.reduce((acc, c) => acc + (c.admisionSipost ?? 0), 0);
    const totalVariable = cuentas.reduce((acc, c) => acc + (c.valorVariable ?? 0), 0);
    const totalPagoTotal = cuentas.reduce((acc, c) => acc + (c.valorBruto ?? (c.cargoBasico || 0) + (c.admisionSipost || 0) + (c.valorVariable || 0)), 0);
    const totalRetencion = cuentas.reduce((acc, c) => acc + (c.retencionValor ?? 0), 0);
    const totalNeto = cuentas.reduce((acc, c) => acc + (c.valorNeto ?? 0), 0);

    const clean = (periodoStr || '').toUpperCase();
    let mes = 'MARZO';
    let ano = '2026';
    const meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
    for (const m of meses) {
      if (clean.includes(m)) {
        mes = m;
        break;
      }
    }
    const matchAno = clean.match(/20\d\d/);
    if (matchAno) ano = matchAno[0];

    return {
      totalCuentas: cuentas.length,
      totalCargoBasico,
      totalSubsidioSipost,
      totalVariable,
      totalPagoTotal,
      totalRetencion,
      totalNeto,
      mes,
      ano,
      periodo: periodoStr,
    };
  };

  // Print Document Modal state
  const [showDocumentModal, setShowDocumentModal] = useState<boolean>(false);
  const [modalCuentas, setModalCuentas] = useState<CuentaCobroResult[]>([]);

  // Funcionalidad 2: Historial filters & selection
  const [filtroMes, setFiltroMes] = useState<string>('');
  const [filtroAnio, setFiltroAnio] = useState<string>('');
  const [filtroTipo, setFiltroTipo] = useState<string>('');
  const [filtroSearch, setFiltroSearch] = useState<string>('');
  const [selectedHistorialIds, setSelectedHistorialIds] = useState<string[]>([]);
  const [editingCuentaItem, setEditingCuentaItem] = useState<{
    source: 'generated' | 'historial';
    generatedKey?: string;
    historialId?: string;
    item: CuentaCobroResult | HistorialItem;
  } | null>(null);
  const [editForm, setEditForm] = useState({
    encargado: '',
    cedula: '',
    municipio: '',
    centroOperativo: 'PO.ARAUCA',
    regional: 'ORIENTE',
    periodo: 'MARZO 2026',
    cargoBasico: 0,
    admisionSipost: 0,
    valorVariable: 0,
    porcentajeRetencion: 1,
    grossUpAplicado: false,
  });
  const [guardandoEdit, setGuardandoEdit] = useState<boolean>(false);

  // Recalcular automáticamente el resumen financiero cada vez que cambien o se modifiquen las cuentas generadas
  useEffect(() => {
    if (cuentasGeneradas.length > 0) {
      const periodoCalculo = cuentasGeneradas[0]?.periodo || `${periodoMes} ${periodoAnio}`;
      setResumenFinanciero(computeResumen(cuentasGeneradas, periodoCalculo));
    } else {
      setResumenFinanciero(null);
    }
  }, [cuentasGeneradas, periodoMes, periodoAnio]);

  // Delete confirmation modal state
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    type: 'single' | 'batch' | 'all' | 'single-generated' | 'batch-generated' | 'all-generated';
    id?: string;
    label?: string;
    count?: number;
    cuentaKey?: string;
  } | null>(null);
  const [procesandoEliminacion, setProcesandoEliminacion] = useState<boolean>(false);

  // Modal de Cargar y Generar Cuentas de Cobro (Selección de Periodo, Confirmación de Sobrescritura y Auto-archivo)
  const [showCargarGenerarModal, setShowCargarGenerarModal] = useState<boolean>(false);
  const [cargarGenerarMode, setCargarGenerarMode] = useState<'auto' | 'excel'>('auto');
  const [procesandoCargarGenerar, setProcesandoCargarGenerar] = useState<boolean>(false);
  const [relacionPagosData, setRelacionPagosData] = useState<any[]>([]);

  // Discrepancias modal state & resolution handler
  const [discrepanciasModal, setDiscrepanciasModal] = useState<{
    isOpen: boolean;
    discrepancias: DiscrepanciaEncargadoItem[];
    periodo: string;
    config: CargarGenerarConfig;
    file: File;
  } | null>(null);
  const [resolviendoDiscrepancias, setResolviendoDiscrepancias] = useState<boolean>(false);

  // Modal de Borrado Seguro con Contraseña Maestra (Camarca.2023*)
  const [borradoModalConfig, setBorradoModalConfig] = useState<{
    isOpen: boolean;
    tipo: 'expendios' | 'historial';
    titulo: string;
    mensajeAdvertencia: string;
    detallesExtra?: string;
    textoBoton?: string;
  } | null>(null);
  const [isBorradoProcessing, setIsBorradoProcessing] = useState<boolean>(false);

  // Configuración del sistema (Periodo Oficial de Descarga para Expendios)
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [guardandoPeriodoDescarga, setGuardandoPeriodoDescarga] = useState<boolean>(false);

  // Load initial data
  const fetchData = async () => {
    setLoading(true);
    try {
      const [resExp, resHist, resPagos, resConfig, resMonitoring] = await Promise.all([
        fetch(`/api/expendios?_t=${Date.now()}`, { cache: 'no-store' }),
        fetch(`/api/admin/historial?_t=${Date.now()}`, { cache: 'no-store' }),
        fetch(`/api/admin/relacion-pagos?_t=${Date.now()}`, { cache: 'no-store' }),
        fetch(`/api/config?_t=${Date.now()}`, { cache: 'no-store' }),
        fetch(`/api/system/sync-monitoring?_t=${Date.now()}`, { cache: 'no-store' })
      ]);
      const dataExp = await resExp.json();
      const dataHist = await resHist.json();
      const dataPagos = await resPagos.json();
      const dataConfig = await resConfig.json();
      const dataMonitoring = await resMonitoring.json();

      let finalExpendios = dataExp.success ? dataExp.data : [];
      let finalHistorial = dataHist.success ? dataHist.data : [];

      // Lógica de verificación contra la base de datos central
      if (dataMonitoring.success && dataMonitoring.firestore) {
         const cloudCount = dataMonitoring.firestore.totalExpendiosCloud || 0;
         const localCount = finalExpendios.length;
         const localDbSizeBytes = dataMonitoring.firestore.localDbSizeBytes || 0;
         
         // Validar el tamaño del archivo almacenado: 
         // El archivo base (congelado) con 170 expendios pesa menos de 1 MB (~954 KB).
         // Solo forzamos el re-fetch si detectamos que estamos en esa versión base "dormida"
         // para no bloquear la restauración manual de snapshots que puedan tener un tamaño válido (> 1 MB) pero un conteo distinto.
         if (cloudCount > 0 && cloudCount !== localCount && localDbSizeBytes < 1000000) {
            console.warn(`[Verificación] Desajuste detectado y tamaño de archivo sospechoso (${localDbSizeBytes} bytes). Local: ${localCount}, Nube: ${cloudCount}. Forzando re-fetch (restore)...`);
            try {
               const restoreRes = await fetch('/api/admin/cloud-restore-now', { method: 'POST' });
               const restoreData = await restoreRes.json();
               if (restoreData.success) {
                  // Fetch again to get the restored data
                  const [newExp, newHist] = await Promise.all([
                     fetch(`/api/expendios?_t=${Date.now()}`, { cache: 'no-store' }),
                     fetch(`/api/admin/historial?_t=${Date.now()}`, { cache: 'no-store' })
                  ]);
                  const newDataExp = await newExp.json();
                  const newDataHist = await newHist.json();
                  if (newDataExp.success) finalExpendios = newDataExp.data;
                  if (newDataHist.success) finalHistorial = newDataHist.data;
                  
                  setSyncStatusMsg(`Verificación automática: Base de datos sincronizada correctamente desde la nube (${cloudCount} expendios).`);
                  setTimeout(() => setSyncStatusMsg(''), 6000);
               }
            } catch (e) {
               console.error('Error durante el re-fetch forzado:', e);
            }
         }
      }

      setExpendios(finalExpendios);
      setHistorial(finalHistorial);
      if (dataPagos.success) setRelacionPagosData(dataPagos.data);
      if (dataConfig.success && dataConfig.data) {
        setSystemConfig(dataConfig.data);
        if (dataConfig.data.periodoHabilitadoDescarga) {
          const parts = dataConfig.data.periodoHabilitadoDescarga.trim().split(/\s+/);
          if (parts.length >= 2) {
            setPeriodoMes(parts[0].toUpperCase());
            setPeriodoAnio(parts[1]);
          }
        }
      }
    } catch (err) {
      console.error('Error cargando datos de admin:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleActivarPeriodoDescarga = async (nuevoPeriodo: string, habilitada: boolean = true) => {
    setGuardandoPeriodoDescarga(true);
    try {
      const res = await fetch('/api/admin/config/periodo-descarga', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodoHabilitadoDescarga: nuevoPeriodo.trim().toUpperCase(),
          descargaHabilitada: habilitada,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setSystemConfig(data.data);
        const parts = data.data.periodoHabilitadoDescarga.trim().split(/\s+/);
        if (parts.length >= 2) {
          setPeriodoMes(parts[0].toUpperCase());
          setPeriodoAnio(parts[1]);
        }
        setMensajeCobros(
          `✓ Periodo "${data.data.periodoHabilitadoDescarga}" guardado como periodo oficial de expendios (${
            data.data.descargaHabilitada ? 'DESCARGA HABILITADA' : 'DESCARGA BLOQUEADA'
          }).`
        );
        window.dispatchEvent(new CustomEvent('configUpdated', { detail: data.data }));
      }
    } catch (err) {
      console.error('Error actualizando periodo de descarga:', err);
      alert('Error de conexión al guardar el periodo de descarga.');
    } finally {
      setGuardandoPeriodoDescarga(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Modal opener for Generation or Excel Upload
  const handleOpenCargarGenerarModal = (mode: 'auto' | 'excel') => {
    if (mode === 'excel' && !fileExcel) {
      setErrorExcel('Por favor selecciona un archivo Excel (.xlsx / .csv) antes de continuar.');
      return;
    }
    setErrorExcel('');
    setCargarGenerarMode(mode);
    setShowCargarGenerarModal(true);
  };

  // Execution handler from CargarGenerarModal
  const handleConfirmCargarGenerar = async (config: CargarGenerarConfig) => {
    setProcesandoCargarGenerar(true);
    setMensajeCobros('');
    setErrorExcel('');
    setAlertasExcel([]);

    // Update current period state
    setPeriodoMes(config.mes);
    setPeriodoAnio(config.anio);
    setAplicarGrossUp(config.aplicarGrossUp);
    setPorcentajeRetencion(config.porcentajeRetencion);
    setModificarValorInicialRetencion(config.modificarValorInicialRetencion);

    try {
      if (cargarGenerarMode === 'auto') {
        const res = await fetch('/api/admin/cuentas-cobro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aplicarGrossUp: config.aplicarGrossUp,
            modificarValorInicialRetencion: Number(config.modificarValorInicialRetencion),
            porcentajeRetencion: Number(config.porcentajeRetencion),
            periodo: config.periodo,
            sobrescribir: config.sobrescribir,
            cargarAContabilidad: config.archivarAutomaticamente,
          }),
        });

        const data = await res.json();
        if (data.success) {
          // Always refresh history
          const resHist = await fetch('/api/admin/historial');
          const dataHist = await resHist.json();
          if (dataHist.success) setHistorial(dataHist.data);

          if (config.habilitarComoPeriodoDescarga) {
            await handleActivarPeriodoDescarga(config.periodo, true);
          }

          if (config.archivarAutomaticamente) {
            // Clear staging accounts
            setCuentasGeneradas([]);
            setResumenFinanciero(null);
            setSelectedCuentasKeys([]);
            setMensajeCobros(
              `✅ ¡Proceso completado! Se generaron y archivaron ${data.data.length} cuentas de cobro para ${config.periodo} en el Historial de Cobros y en la Relación de Pagos. Periodo habilitado para expendios. El módulo de Cuentas Masivas ha quedado libre para cargar otro periodo.`
            );
          } else {
            // Keep in staging for manual review
            setCuentasGeneradas(data.data);
            setResumenFinanciero(computeResumen(data.data, config.periodo));
            setMensajeCobros(`${data.message}. Periodo "${config.periodo}" habilitado para descarga de expendios.`);
          }
          setShowCargarGenerarModal(false);
        } else {
          alert(data.message || 'Error al generar las cuentas de cobro.');
        }
      } else {
        // Excel Upload Mode
        if (!fileExcel) {
          setErrorExcel('Por favor selecciona un archivo Excel');
          return;
        }

        const formData = new FormData();
        formData.append('excelFile', fileExcel);
        formData.append('porcentajeRetencion', String(config.porcentajeRetencion));
        formData.append('aplicarGrossUp', String(config.aplicarGrossUp));
        formData.append('periodo', config.periodo);
        formData.append('sobrescribir', String(config.sobrescribir));
        formData.append('cargarAContabilidad', String(config.archivarAutomaticamente));

        const res = await fetch('/api/admin/upload-cuentas-cobro-excel', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();

        // Check if discrepancy resolution between Excel and registered database is needed
        if (data.requiereResolucion) {
          setDiscrepanciasModal({
            isOpen: true,
            discrepancias: data.discrepancias || [],
            periodo: config.periodo,
            config,
            file: fileExcel,
          });
          setShowCargarGenerarModal(false);
          return;
        }

        if (data.success) {
          // Refresh history
          const resHist = await fetch('/api/admin/historial');
          const dataHist = await resHist.json();
          if (dataHist.success) setHistorial(dataHist.data);

          if (config.habilitarComoPeriodoDescarga) {
            await handleActivarPeriodoDescarga(config.periodo, true);
          }

          if (config.archivarAutomaticamente) {
            // Clear staging accounts
            setCuentasGeneradas([]);
            setResumenFinanciero(null);
            setSelectedCuentasKeys([]);
            setFileExcel(null);
            setMensajeCobros(
              `✅ ¡Cargue de Excel exitoso! Se procesaron y archivaron ${data.data.length} cuentas para ${config.periodo} en el Historial de Cobros y en la Relación de Pagos. Periodo habilitado para expendios. El módulo de Cuentas Masivas ha quedado libre para un nuevo cargue.`
            );
          } else {
            // Keep in staging for manual review
            setCuentasGeneradas(data.data);
            if (data.resumenFinanciero) {
              setResumenFinanciero(data.resumenFinanciero);
            } else {
              setResumenFinanciero(computeResumen(data.data, config.periodo));
            }
            setMensajeCobros(`${data.message}. Periodo "${config.periodo}" habilitado para descarga de expendios.`);
            if (data.alertas && Array.isArray(data.alertas)) {
              setAlertasExcel(data.alertas);
            }
            setFileExcel(null);
          }
          setShowCargarGenerarModal(false);
        } else {
          setErrorExcel(data.message || 'Error en el cargue de la plantilla Excel.');
        }
      }
    } catch (err) {
      console.error('Error procesando cuentas:', err);
      alert('Ocurrió un error al procesar las cuentas de cobro.');
    } finally {
      setProcesandoCargarGenerar(false);
    }
  };

  // Handler for user's chosen discrepancy resolution mode
  const handleResolverDiscrepanciasExcel = async (modo: ResolucionDiscrepanciasModo) => {
    if (!discrepanciasModal) return;
    setResolviendoDiscrepancias(true);
    try {
      const formData = new FormData();
      formData.append('excelFile', discrepanciasModal.file);
      formData.append('porcentajeRetencion', String(discrepanciasModal.config.porcentajeRetencion));
      formData.append('aplicarGrossUp', String(discrepanciasModal.config.aplicarGrossUp));
      formData.append('periodo', discrepanciasModal.config.periodo);
      formData.append('sobrescribir', String(discrepanciasModal.config.sobrescribir));
      formData.append('cargarAContabilidad', String(discrepanciasModal.config.archivarAutomaticamente));
      formData.append('resolucionDiscrepancias', modo);

      const res = await fetch('/api/admin/upload-cuentas-cobro-excel', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        // Refresh master expendios list if database was updated
        if (modo === 'actualizar_bd') {
          const resExp = await fetch('/api/expendios');
          const dataExp = await resExp.json();
          if (dataExp.success) setExpendios(dataExp.data);
        }

        // Refresh history
        const resHist = await fetch('/api/admin/historial');
        const dataHist = await resHist.json();
        if (dataHist.success) setHistorial(dataHist.data);

        if (discrepanciasModal.config.archivarAutomaticamente) {
          setCuentasGeneradas([]);
          setResumenFinanciero(null);
          setSelectedCuentasKeys([]);
          setFileExcel(null);
          setMensajeCobros(
            `✅ ¡Cargue y resolución completados! Se procesaron y archivaron ${data.data.length} cuentas para ${discrepanciasModal.config.periodo} (${modo === 'actualizar_bd' ? 'Base de Datos de Expendios Actualizada' : 'Datos tomados de la Base Registrada'}).`
          );
        } else {
          setCuentasGeneradas(data.data);
          if (data.resumenFinanciero) {
            setResumenFinanciero(data.resumenFinanciero);
          } else {
            setResumenFinanciero(computeResumen(data.data, discrepanciasModal.config.periodo));
          }
          setMensajeCobros(
            `✅ ¡Cargue procesado con éxito! Se aplicó la resolución seleccionada (${modo === 'actualizar_bd' ? '1: Base de Datos Actualizada' : '2: Datos de Archivo Actualizados desde BD'}).`
          );
          if (data.alertas && Array.isArray(data.alertas)) {
            setAlertasExcel(data.alertas);
          }
          setFileExcel(null);
        }
        setDiscrepanciasModal(null);
      } else {
        alert(data.message || 'Error al procesar la resolución de discrepancias.');
      }
    } catch (err) {
      console.error('Error resolviendo discrepancias:', err);
      alert('Error de conexión con el servidor al resolver las discrepancias.');
    } finally {
      setResolviendoDiscrepancias(false);
    }
  };

  // Handler to sync generated accounts to Accounting / Relación de Pagos & Archive
  const handleCargarCuentasAContabilidad = async () => {
    if (cuentasGeneradas.length === 0) {
      alert('No hay cuentas de cobro generadas para sincronizar en contabilidad.');
      return;
    }
    setCargandoAContabilidad(true);
    try {
      const activePeriod = cuentasGeneradas[0]?.periodo || periodo;
      const res = await fetch('/api/admin/relacion-pagos/sync-from-cuentas-cobro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuentas: cuentasGeneradas,
          periodo: activePeriod,
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Refresh history
        const resHist = await fetch('/api/admin/historial');
        const dataHist = await resHist.json();
        if (dataHist.success) setHistorial(dataHist.data);

        // Clear staging as requested: "se borren del modulo de cuentas masivas para cargar otras cuentas"
        setCuentasGeneradas([]);
        setResumenFinanciero(null);
        setSelectedCuentasKeys([]);
        setFileExcel(null);

        setMensajeCobros(
          `✅ Cuentas archivadas con éxito en el Historial de Cobros y sincronizadas con la Relación de Pagos para ${activePeriod}. Módulo de Cuentas Masivas liberado para un nuevo cargue.`
        );
      } else {
        alert(data.message || 'Error al sincronizar con contabilidad.');
      }
    } catch (err) {
      console.error('Error cargando cuentas a contabilidad:', err);
      alert('Error de conexión al sincronizar con contabilidad.');
    } finally {
      setCargandoAContabilidad(false);
    }
  };

  const handleDescargarPlantillaExcel = () => {
    const sampleData = [
      {
        'N°': 1,
        'CENTRO OPERATIVO': 'PO.BUCARAMANGA',
        'CENTRO DE ACOPIO': 'SIMITI',
        'MUNICIPIO': 'SIMITI',
        'FUNCION': 'EXPENDIO 4-72',
        'CARGO BASICO': 0,
        'ADMISION SIPOST': 0,
        'VALOR VARIABLE': 0,
        'PAGO TOTAL': 0,
        'RETEF 1%': 0,
        'NETO A PAGAR': 0,
        'ENCARGADO': 'MARIO DE JESUS TORRES MEJIA',
        'CEDULA': '3983162',
        'DIRECCION': 'CALLE PRINCIPAL SIMITI',
        'TELEFONO': '3101234567',
      },
      {
        'N°': 2,
        'CENTRO OPERATIVO': 'PO.BUCARAMANGA',
        'CENTRO DE ACOPIO': 'GIRON',
        'MUNICIPIO': 'GIRON',
        'FUNCION': 'EXPENDIO 4-72',
        'CARGO BASICO': 1350000,
        'ADMISION SIPOST': 50000,
        'VALOR VARIABLE': 12500,
        'PAGO TOTAL': 1412500,
        'RETEF 1%': 14125,
        'NETO A PAGAR': 1398375,
        'ENCARGADO': 'CARLOS ALBERTO GOMEZ',
        'CEDULA': '1094883412',
        'DIRECCION': 'CARRERA 15 # 22-10 GIRON',
        'TELEFONO': '3128899001',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla Cuentas de Cobro');
    XLSX.writeFile(workbook, 'Plantilla_Cuentas_Cobro_CAMARCA.xlsx');
  };

  // Helper to get unique key for a generated cuenta
  const getCuentaKey = (item: CuentaCobroResult, index: number) => {
    return item.id || `cc-${item.cedula}-${item.municipio || item.expendio}-${index}`;
  };

  // Filter generated cuentas
  const cuentasGeneradasFiltradas = React.useMemo(() => {
    if (!searchCuentasTerm.trim()) return cuentasGeneradas;
    const term = searchCuentasTerm.toLowerCase();
    return cuentasGeneradas.filter(
      (c) =>
        (c.encargado || '').toLowerCase().includes(term) ||
        (c.cedula || '').toLowerCase().includes(term) ||
        (c.municipio || '').toLowerCase().includes(term) ||
        (c.expendio || '').toLowerCase().includes(term) ||
        (c.centroOperativo || '').toLowerCase().includes(term)
    );
  }, [cuentasGeneradas, searchCuentasTerm]);

  // Selection handlers for generated cuentas
  const toggleSelectCuenta = (key: string) => {
    setSelectedCuentasKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const toggleSelectAllCuentas = () => {
    const currentKeys = cuentasGeneradasFiltradas.map((c, idx) => getCuentaKey(c, idx));
    const allSelected =
      currentKeys.length > 0 && currentKeys.every((k) => selectedCuentasKeys.includes(k));
    if (allSelected) {
      setSelectedCuentasKeys((prev) => prev.filter((k) => !currentKeys.includes(k)));
    } else {
      setSelectedCuentasKeys((prev) => Array.from(new Set([...prev, ...currentKeys])));
    }
  };

  const handleOpenModalAll = () => {
    setModalCuentas(cuentasGeneradas);
    setShowDocumentModal(true);
  };

  const handleOpenModalSingle = (item: CuentaCobroResult) => {
    setModalCuentas([item]);
    setShowDocumentModal(true);
  };

  const handlePrintSelectedCuentas = () => {
    const selectedList = cuentasGeneradas.filter((c, idx) =>
      selectedCuentasKeys.includes(getCuentaKey(c, idx))
    );
    if (selectedList.length === 0) return;
    setModalCuentas(selectedList);
    setShowDocumentModal(true);
  };

  const handleDownloadPDFConsolidado = async () => {
    if (cuentasGeneradas.length === 0) return;
    setGenerandoPDF(true);
    try {
      await generateCuentasCobroPDF(cuentasGeneradas, periodo);
      notifyReportSaved(
        `PDF Consolidado Cuentas (${periodo})`,
        'cuentas',
        `${cuentasGeneradas.length} cuentas de cobro generadas y exportadas con éxito`
      );
    } catch (err) {
      console.error('Error al generar PDF de cuentas de cobro:', err);
    } finally {
      setGenerandoPDF(false);
    }
  };

  const handleDownloadSelectedCuentasZip = async () => {
    const selectedList = cuentasGeneradas.filter((c, idx) =>
      selectedCuentasKeys.includes(getCuentaKey(c, idx))
    );
    if (selectedList.length === 0) return;
    setGenerandoPDF(true);
    try {
      const activeP = selectedList[0]?.periodo || periodo || 'MARZO 2026';
      await generateCuentasCobroPDF(selectedList, activeP);
      notifyReportSaved(
        `Cuentas de Cobro Seleccionadas (${selectedList.length})`,
        'cuentas',
        `Exportación de ${selectedList.length} cuentas procesada exitosamente`
      );
    } catch (err) {
      console.error('Error descargando ZIP de seleccionadas:', err);
      alert('Hubo un error al generar el archivo ZIP de las cuentas seleccionadas.');
    } finally {
      setGenerandoPDF(false);
    }
  };

  const handleDeleteSelectedCuentas = () => {
    if (selectedCuentasKeys.length === 0) return;
    setDeleteConfirmModal({
      isOpen: true,
      type: 'batch-generated',
      count: selectedCuentasKeys.length,
    });
  };

  const handleDeleteSingleGeneratedCuenta = (item: CuentaCobroResult, index: number) => {
    const key = getCuentaKey(item, index);
    setDeleteConfirmModal({
      isOpen: true,
      type: 'single-generated',
      id: item.id,
      label: `${item.encargado} (${item.municipio || item.expendio})`,
      cuentaKey: key,
    });
  };

  const handleDeleteAllGeneratedCuentas = () => {
    if (cuentasGeneradas.length === 0) return;
    setDeleteConfirmModal({
      isOpen: true,
      type: 'all-generated',
      count: cuentasGeneradas.length,
    });
  };

  // Helper to convert HistorialItem to CuentaCobroResult for PDF and Preview
  const getCuentaFromHistorialItem = (item: HistorialItem): CuentaCobroResult => {
    if (item.cuentaData) return item.cuentaData;
    const cargoBasico = item.monto || 0;
    const isGrossUp = !!aplicarGrossUp;
    const retef1 = isGrossUp ? 0 : Math.round(cargoBasico * (porcentajeRetencion / 100));
    const neto = isGrossUp ? cargoBasico : cargoBasico - retef1;
    return {
      id: item.id,
      cedula: item.cedula,
      encargado: item.encargado,
      expendio: item.expendio,
      municipio: item.expendio,
      centroOperativo: 'PO.ARAUCA',
      centroAcopio: item.expendio,
      regional: 'ORIENTE',
      funcion: 'EXPENDIO 4-72',
      cargoBasico,
      admisionSipost: 0,
      valorVariable: 0,
      pagoTotal: isGrossUp ? neto : cargoBasico,
      retef1,
      retencionValor: retef1,
      valorNeto: neto,
      grossUpAplicado: isGrossUp,
      periodo: item.periodo || 'ENERO 2026',
      nitCamarca: '900504241-7',
      empresaCamarca: 'CAMARCA SAS',
      fechaEmision: item.fecha,
    };
  };

  // Historial Selection Handlers
  const toggleSelectHistorial = (id: string) => {
    setSelectedHistorialIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAllHistorial = () => {
    if (selectedHistorialIds.length === historialFiltrado.length && historialFiltrado.length > 0) {
      setSelectedHistorialIds([]);
    } else {
      setSelectedHistorialIds(historialFiltrado.map((h) => h.id));
    }
  };

  const handleViewSelectedHistorial = () => {
    const selectedItems = historial.filter((h) => selectedHistorialIds.includes(h.id));
    const cuentas = selectedItems.map(getCuentaFromHistorialItem);
    if (cuentas.length === 0) return;
    setModalCuentas(cuentas);
    setShowDocumentModal(true);
  };

  const handleDownloadZipSelectedHistorial = async () => {
    const selectedItems = historial.filter((h) => selectedHistorialIds.includes(h.id));
    const cuentas = selectedItems.map(getCuentaFromHistorialItem);
    if (cuentas.length === 0) return;
    setGenerandoPDF(true);
    try {
      await generateCuentasCobroPDF(cuentas, cuentas[0]?.periodo || 'ENERO 2026');
    } catch (e) {
      console.error('Error generando ZIP masivo:', e);
    } finally {
      setGenerandoPDF(false);
    }
  };

  const handleConfirmDelete = (type: 'single' | 'batch' | 'all', id?: string, label?: string) => {
    if (type === 'all') {
      setBorradoModalConfig({
        isOpen: true,
        tipo: 'historial',
        titulo: 'Vaciar Todo el Historial de Cuentas',
        mensajeAdvertencia: '¿Estás seguro de que deseas ELIMINAR COMPLETAMENTE todo el historial de cuentas de cobro generadas y archivadas?',
        detallesExtra: `Se eliminarán ${historial.length} cuentas de cobro del historial.`,
        textoBoton: 'Confirmar y Vaciar Historial',
      });
      return;
    }
    let count = 1;
    if (type === 'batch') count = selectedHistorialIds.length;
    setDeleteConfirmModal({ isOpen: true, type, id, label, count });
  };

  const handleEjecutarBorradoSeguro = async (password: string) => {
    if (!borradoModalConfig) return;
    setIsBorradoProcessing(true);
    try {
      if (borradoModalConfig.tipo === 'expendios') {
        const res = await fetch('/api/admin/clear-database', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (data.success) {
          setSyncStatusMsg(data.message || '✓ Base de datos de expendios vaciada completamente.');
          setExpendios([]);
          fetchData();
          setBorradoModalConfig(null);
          setTimeout(() => setSyncStatusMsg(''), 7000);
        } else {
          alert(data.message || 'Error al borrar la base de datos.');
        }
      } else if (borradoModalConfig.tipo === 'historial') {
        const res = await fetch('/api/admin/historial-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (data.success) {
          setSyncStatusMsg(data.message || '✓ Todo el historial ha sido vaciado.');
          setHistorial([]);
          setSelectedHistorialIds([]);
          fetchData();
          setBorradoModalConfig(null);
          setTimeout(() => setSyncStatusMsg(''), 7000);
        } else {
          alert(data.message || 'Error al vaciar el historial.');
        }
      }
    } catch (err: any) {
      console.error('Error al ejecutar borrado seguro:', err);
      alert('Error de conexión al procesar el borrado.');
    } finally {
      setIsBorradoProcessing(false);
    }
  };

  const handleExecuteDelete = async () => {
    if (!deleteConfirmModal) return;
    setProcesandoEliminacion(true);
    try {
      if (deleteConfirmModal.type === 'batch-generated') {
        const itemsToDelete = cuentasGeneradas.filter((c, idx) =>
          selectedCuentasKeys.includes(getCuentaKey(c, idx))
        );
        setCuentasGeneradas((prev) =>
          prev.filter((c, idx) => !selectedCuentasKeys.includes(getCuentaKey(c, idx)))
        );
        setSelectedCuentasKeys([]);

        const ids = itemsToDelete.map((i) => i.id).filter((id): id is string => Boolean(id));
        if (ids.length > 0) {
          await fetch('/api/admin/historial/delete-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
          });
        }
      } else if (deleteConfirmModal.type === 'all-generated') {
        const ids = cuentasGeneradas.map((c) => c.id).filter((id): id is string => Boolean(id));
        setCuentasGeneradas([]);
        setSelectedCuentasKeys([]);

        if (ids.length > 0) {
          await fetch('/api/admin/historial/delete-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
          });
        }
      } else if (deleteConfirmModal.type === 'single-generated') {
        if (deleteConfirmModal.cuentaKey) {
          setCuentasGeneradas((prev) =>
            prev.filter((c, idx) => getCuentaKey(c, idx) !== deleteConfirmModal.cuentaKey)
          );
          setSelectedCuentasKeys((prev) =>
            prev.filter((k) => k !== deleteConfirmModal.cuentaKey)
          );
        }
        if (deleteConfirmModal.id) {
          await fetch(`/api/admin/historial/${encodeURIComponent(deleteConfirmModal.id)}`, { method: 'DELETE' });
        }
      } else if (deleteConfirmModal.type === 'single' && deleteConfirmModal.id) {
        const res = await fetch(`/api/admin/historial/${deleteConfirmModal.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          setSelectedHistorialIds((prev) => prev.filter((i) => i !== deleteConfirmModal.id));
        }
      } else if (deleteConfirmModal.type === 'batch') {
        const res = await fetch('/api/admin/historial/delete-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: selectedHistorialIds }),
        });
        const data = await res.json();
        if (data.success) {
          setSelectedHistorialIds([]);
        }
      }

      // Re-fetch updated historial
      const resHist = await fetch('/api/admin/historial');
      const dataHist = await resHist.json();
      if (dataHist.success) {
        setHistorial(dataHist.data);
      }
    } catch (err) {
      console.error('Error al eliminar:', err);
    } finally {
      setProcesandoEliminacion(false);
      setDeleteConfirmModal(null);
    }
  };

  const handleStartEditGeneratedCuenta = (item: CuentaCobroResult, index: number) => {
    const rawPeriodo = item.periodo || `${periodoMes} ${periodoAnio}`;
    const clean = rawPeriodo.toUpperCase();
    let m = periodoMes;
    let y = periodoAnio;
    for (const mesItem of MESES_SISTEMA) {
      if (clean.includes(mesItem.value)) {
        m = mesItem.value;
        break;
      }
    }
    const matchYear = clean.match(/20\d\d/);
    if (matchYear && ANIOS_SISTEMA.includes(matchYear[0])) {
      y = matchYear[0];
    }
    const validMes = MESES_SISTEMA.some((x) => x.value === m) ? m : 'MARZO';
    const validAnio = ANIOS_SISTEMA.includes(y) ? y : '2026';

    setEditMes(validMes);
    setEditAnio(validAnio);

    const cargo = item.cargoBasico ?? item.valorBase ?? 0;
    const sipost = item.admisionSipost ?? 0;
    const variable = item.valorVariable ?? 0;

    setEditingCuentaItem({
      source: 'generated',
      generatedKey: getCuentaKey(item, index),
      item,
    });

    setEditForm({
      encargado: item.encargado || '',
      cedula: item.cedula || '',
      municipio: item.municipio || item.expendio || '',
      centroOperativo: item.centroOperativo || 'PO.ARAUCA',
      regional: item.regional || 'ORIENTE',
      periodo: `${validMes} ${validAnio}`,
      cargoBasico: cargo,
      admisionSipost: sipost,
      valorVariable: variable,
      porcentajeRetencion: item.porcentajeRetencion || porcentajeRetencion || 1,
      grossUpAplicado: !!item.grossUpAplicado,
    });
  };

  const handleStartEditHistorial = (item: HistorialItem) => {
    const cData = getCuentaFromHistorialItem(item);
    const rawPeriodo = cData.periodo || item.periodo || 'MARZO 2026';
    const clean = rawPeriodo.toUpperCase();
    let m = 'MARZO';
    let y = '2026';
    for (const mesItem of MESES_SISTEMA) {
      if (clean.includes(mesItem.value)) {
        m = mesItem.value;
        break;
      }
    }
    const matchYear = clean.match(/20\d\d/);
    if (matchYear && ANIOS_SISTEMA.includes(matchYear[0])) {
      y = matchYear[0];
    }
    const validMes = MESES_SISTEMA.some((x) => x.value === m) ? m : 'MARZO';
    const validAnio = ANIOS_SISTEMA.includes(y) ? y : '2026';

    setEditMes(validMes);
    setEditAnio(validAnio);

    setEditingCuentaItem({
      source: 'historial',
      historialId: item.id,
      item,
    });

    setEditForm({
      encargado: cData.encargado || item.encargado,
      cedula: cData.cedula || item.cedula,
      municipio: cData.municipio || item.expendio,
      centroOperativo: cData.centroOperativo || 'PO.ARAUCA',
      regional: cData.regional || 'ORIENTE',
      periodo: `${validMes} ${validAnio}`,
      cargoBasico: cData.cargoBasico ?? item.monto ?? 0,
      admisionSipost: cData.admisionSipost ?? 0,
      valorVariable: cData.valorVariable ?? 0,
      porcentajeRetencion: cData.porcentajeRetencion || porcentajeRetencion || 1,
      grossUpAplicado: !!cData.grossUpAplicado,
    });
  };

  const handleSaveEditCuenta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCuentaItem) return;
    setGuardandoEdit(true);

    try {
      const cargo = Number(editForm.cargoBasico) || 0;
      const sipost = Number(editForm.admisionSipost) || 0;
      const variable = Number(editForm.valorVariable) || 0;
      const pRet = Number(editForm.porcentajeRetencion) || 1;
      const isGrossUp = !!editForm.grossUpAplicado;

      const pagoTotal = cargo + sipost + variable;
      const retef1 = isGrossUp ? 0 : Math.round(pagoTotal * (pRet / 100));
      const valorNeto = isGrossUp ? pagoTotal : pagoTotal - retef1;

      if (editingCuentaItem.source === 'generated' && editingCuentaItem.generatedKey) {
        setCuentasGeneradas((prev) => {
          const updated = prev.map((c, idx) => {
            if (getCuentaKey(c, idx) === editingCuentaItem.generatedKey) {
              return {
                ...c,
                encargado: editForm.encargado.toUpperCase(),
                cedula: editForm.cedula,
                municipio: editForm.municipio.toUpperCase(),
                expendio: editForm.municipio.toUpperCase(),
                centroOperativo: editForm.centroOperativo.toUpperCase(),
                regional: editForm.regional.toUpperCase(),
                periodo: editForm.periodo.toUpperCase(),
                cargoBasico: cargo,
                admisionSipost: sipost,
                valorVariable: variable,
                pagoTotal: isGrossUp ? valorNeto : pagoTotal,
                retef1,
                retencionValor: retef1,
                valorNeto,
                grossUpAplicado: isGrossUp,
                porcentajeRetencion: pRet,
                valorEnLetras: numeroALetras(valorNeto),
              };
            }
            return c;
          });
          return updated;
        });

        // If it also had a persistent ID in database, update server
        const targetId = (editingCuentaItem.item as CuentaCobroResult).id;
        if (targetId) {
          await fetch(`/api/admin/historial/${encodeURIComponent(targetId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...editForm,
              cargoBasico: cargo,
              admisionSipost: sipost,
              valorVariable: variable,
              porcentajeRetencion: pRet,
              grossUpAplicado: isGrossUp,
            }),
          });
        }
      } else if (editingCuentaItem.source === 'historial' && editingCuentaItem.historialId) {
        const res = await fetch(`/api/admin/historial/${editingCuentaItem.historialId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...editForm,
            cargoBasico: cargo,
            admisionSipost: sipost,
            valorVariable: variable,
            porcentajeRetencion: pRet,
            grossUpAplicado: isGrossUp,
          }),
        });
        const data = await res.json();
        if (data.success) {
          const resHist = await fetch('/api/admin/historial');
          const dataHist = await resHist.json();
          if (dataHist.success) setHistorial(dataHist.data);
        }
      }

      setEditingCuentaItem(null);
    } catch (err) {
      console.error('Error guardando edición de cuenta:', err);
    } finally {
      setGuardandoEdit(false);
    }
  };

  // Handler Funcionalidad 4: Reporte Fotográfico PDF
  const handleGenerarReporteFotografico = async () => {
    setGenerandoPDF(true);
    try {
      await generateReporteFotograficoPDF(expendios);
      notifyReportSaved(
        `Reporte Fotográfico PDF (${expendios.length} Expendios)`,
        'fotos',
        'Generado y respaldado en Google Cloud Firestore y Storage'
      );
    } catch (err) {
      console.error('Error generando reporte fotográfico:', err);
    } finally {
      setGenerandoPDF(false);
    }
  };

  // Handlers para Gestión e Inspección de Expendios
  const handleOpenNewExpendioModal = () => {
    setEditingExpendio(null);
    setShowEditorModal(true);
  };

  const handleEditExpendio = (exp: ExpendioData) => {
    setEditingExpendio(exp);
    setShowEditorModal(true);
  };

  const handleDeleteExpendio = (exp: ExpendioData) => {
    setDeletingExpendio(exp);
  };

  const confirmDeleteExpendio = async () => {
    if (!deletingExpendio) return;
    setIsDeleting(true);
    try {
      const targetId = deletingExpendio.id || deletingExpendio.cedula || deletingExpendio.localidad;
      const res = await fetch(`/api/admin/expendios/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setSyncStatusMsg(data.message || `✓ Expendio ${deletingExpendio.localidad} eliminado correctamente.`);
        fetchData();
        setDeletingExpendio(null);
        setTimeout(() => setSyncStatusMsg(''), 7000);
      } else {
        alert(data.message || 'Error al eliminar el expendio.');
      }
    } catch (err) {
      console.error('Error eliminando expendio:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveExpendioSuccess = (updatedOrNewItem: ExpendioData, isNew: boolean) => {
    setSyncStatusMsg(
      `✓ ${isNew ? 'Nuevo expendio' : 'Expendio'} "${updatedOrNewItem.localidad}" ${
        isNew ? 'registrado' : 'actualizado'
      } con éxito en el sistema.`
    );
    fetchData();
    setTimeout(() => setSyncStatusMsg(''), 7000);
  };

  const handleClearDatabase = () => {
    setBorradoModalConfig({
      isOpen: true,
      tipo: 'expendios',
      titulo: 'Borrar Base de Datos de Expendios',
      mensajeAdvertencia: '¿Estás seguro de que deseas BORRAR COMPLETAMENTE la base de datos de expendios? Esta acción eliminará TODOS los registros. Podrás volver a cargar tu censo desde un archivo Excel.',
      detallesExtra: `Actualmente hay ${expendios.length} expendios registrados en el sistema.`,
      textoBoton: 'Confirmar y Borrar Base de Datos',
    });
  };

  // Filtered Expendios for Expendio Tab
  const expendiosFiltrados = expendios.filter((e) => {
    if (!searchExpendioTerm) return true;
    const term = searchExpendioTerm.toLowerCase();
    return (
      (e.localidad || '').toLowerCase().includes(term) ||
      (e.municipio || '').toLowerCase().includes(term) ||
      (e.encargado || '').toLowerCase().includes(term) ||
      (e.cedula || '').includes(term) ||
      (e.direccionPunto || '').toLowerCase().includes(term) ||
      (e.usuarioSipost || '').toLowerCase().includes(term) ||
      (e.centroOperativo || '').toLowerCase().includes(term)
    );
  });

  // Months configuration for filtering
  const MESES_OPCIONES = [
    { value: '', label: 'Todos los Meses' },
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

  // Dynamic extraction of available years from historial
  const aniosDisponibles = React.useMemo(() => {
    const yearsSet = new Set<string>();
    const yearRegex = /\b(20\d{2})\b/g;
    historial.forEach((item) => {
      const text = `${item.periodo || ''} ${item.fecha || ''} ${item.cuentaData?.periodo || ''} ${item.cuentaData?.fechaEmision || ''}`;
      const matches = text.match(yearRegex);
      if (matches) {
        matches.forEach((y) => yearsSet.add(y));
      }
    });
    // Ensure standard baseline years up to 2040
    Array.from({ length: 17 }, (_, i) => String(2024 + i)).forEach((y) => yearsSet.add(y));
    return Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
  }, [historial]);

  // Dynamic extraction of record types from historial
  const tiposDisponibles = React.useMemo(() => {
    const typesSet = new Set<string>();
    historial.forEach((item) => {
      if (item.tipo) typesSet.add(item.tipo);
    });
    return Array.from(typesSet);
  }, [historial]);

  // Filtered Historial with robust Month, Year, Type, and Search query matching
  const historialFiltrado = React.useMemo(() => {
    return historial.filter((item) => {
      const tipo = (item.tipo || '').trim();
      // Excluir registros que no son cuentas de cobro (actualizaciones de perfil o archivos escaneados)
      if (
        tipo === 'Actualización' ||
        tipo === 'Actualización Maestro' ||
        tipo === 'Cuenta de Cobro Firmada' ||
        tipo === 'Actualización de Perfil'
      ) {
        return false;
      }

      const fullText = `${item.periodo || ''} ${item.fecha || ''} ${item.cuentaData?.periodo || ''} ${item.cuentaData?.fechaEmision || ''}`.toUpperCase();

      // Month matching
      if (filtroMes) {
        const selectedMesObj = MESES_OPCIONES.find((m) => m.value === filtroMes);
        const mesName = filtroMes.toUpperCase();
        const mesNum = selectedMesObj?.num;

        const hasMesName = fullText.includes(mesName);
        const hasMesNum = mesNum && (
          fullText.includes(`-${mesNum}-`) ||
          fullText.includes(`/${mesNum}/`) ||
          fullText.includes(`-${mesNum}`) ||
          fullText.includes(`/${mesNum}`) ||
          (item.fecha && item.fecha.split('-')[1] === mesNum)
        );

        if (!hasMesName && !hasMesNum) return false;
      }

      // Year matching
      if (filtroAnio) {
        if (!fullText.includes(filtroAnio)) {
          return false;
        }
      }

      // Record Type matching
      if (filtroTipo) {
        if ((item.tipo || '').toLowerCase() !== filtroTipo.toLowerCase()) {
          return false;
        }
      }

      // Search term matching
      if (filtroSearch.trim()) {
        const term = filtroSearch.toLowerCase();
        const matchSearch =
          (item.encargado || '').toLowerCase().includes(term) ||
          (item.expendio || '').toLowerCase().includes(term) ||
          (item.cedula || '').includes(term) ||
          (item.periodo || '').toLowerCase().includes(term) ||
          (item.tipo || '').toLowerCase().includes(term) ||
          (item.detalles || '').toLowerCase().includes(term) ||
          (item.cuentaData?.municipio || '').toLowerCase().includes(term) ||
          (item.cuentaData?.centroOperativo || '').toLowerCase().includes(term);

        if (!matchSearch) return false;
      }

      return true;
    });
  }, [historial, filtroMes, filtroAnio, filtroTipo, filtroSearch]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-amber-400 font-semibold text-xs tracking-wider uppercase mb-1">
            <Building2 className="w-4 h-4" />
            <span>CAMARCA S.A.S. | NIT 900504241-7</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-100">Panel de Control Administrador</h2>
          <p className="text-sm text-slate-400 mt-1">
            Gestión centralizada de cuentas de cobro, historial y control fotográfico por municipios.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Componente de Verificación de Salud de Firebase */}
          <FirebaseHealthCheck />

          {/* Componente de Estado de Conexión en Tiempo Real (Firestore & Storage) */}
          <EstadoConexion isLight={false} />

          <button
            onClick={() => {
              setCopiaSeguridadInitialTab('googleDrive');
              setShowCopiaSeguridadModal(true);
            }}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs py-2 px-3.5 rounded-xl flex items-center space-x-2 cursor-pointer transition-all shadow-md active:scale-95"
            title="Ajustes de Almacenamiento, Migración y Respaldos"
          >
            <Cloud className="w-4 h-4 text-white" />
            <span>Configuración y Respaldos</span>
          </button>
        </div>
      </div>

      {/* Sync Status Banner */}
      {syncStatusMsg && (
        <div className="p-4 bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 rounded-2xl shadow-xl text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center space-x-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="font-medium">{syncStatusMsg}</span>
          </div>
          <button
            onClick={() => setSyncStatusMsg('')}
            className="text-emerald-400 hover:text-emerald-200 text-xs font-bold underline cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Tabs Bar */}
      <div className="flex overflow-x-auto space-x-2 p-1.5 bg-slate-900 border border-slate-800 rounded-2xl text-xs font-medium no-scrollbar">
        <button
          onClick={() => setActiveTab('expendios')}
          className={`py-2.5 px-4 rounded-xl flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'expendios'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Store className="w-4 h-4" />
          <span>1. Gestión de Expendios</span>
        </button>

        <button
          onClick={() => setActiveTab('cobros')}
          className={`py-2.5 px-4 rounded-xl flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'cobros'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <FileCheck2 className="w-4 h-4" />
          <span>2. Cuentas de Cobro Masivas</span>
        </button>

        <button
          onClick={() => setActiveTab('pagos')}
          className={`py-2.5 px-4 rounded-xl flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'pagos'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>3. Relación de Pagos & Excel</span>
        </button>

        <button
          onClick={() => setActiveTab('historial')}
          className={`py-2.5 px-4 rounded-xl flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'historial'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <History className="w-4 h-4" />
          <span>4. Historial de Cobros</span>
        </button>

        <button
          onClick={() => setActiveTab('fotos')}
          className={`py-2.5 px-4 rounded-xl flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'fotos'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Camera className="w-4 h-4" />
          <span>5. Reportes Fotográficos</span>
        </button>

        <button
          onClick={() => setActiveTab('trazabilidad')}
          className={`py-2.5 px-4 rounded-xl flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'trazabilidad'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>6. Trazabilidad de Expendios</span>
        </button>

        <button
          onClick={() => setActiveTab('metricas')}
          className={`py-2.5 px-4 rounded-xl flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'metricas'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>7. Métricas de Acceso</span>
        </button>

        <button
          onClick={() => setActiveTab('documentos')}
          className={`py-2.5 px-4 rounded-xl flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'documentos'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <FolderDown className="w-4 h-4" />
          <span>8. Documentación Expendios</span>
        </button>

        <button
          onClick={() => setActiveTab('sheets')}
          className={`py-2.5 px-4 rounded-xl flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'sheets'
              ? 'bg-emerald-500 text-slate-950 font-black shadow-lg'
              : 'text-emerald-400 hover:text-emerald-200 hover:bg-emerald-950/40 border border-emerald-800/60'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>9. Google Sheets DB</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
        </button>
      </div>

      {/* --- TAB 1: CUENTAS DE COBRO MASIVAS --- */}
      {activeTab === 'cobros' && (
        <div className="space-y-6">
          {/* Card Destacado: Control de Periodo Oficial Habilitado para Descarga de Expendios */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center space-x-3.5">
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-bold text-slate-100 flex flex-wrap items-center gap-2">
                  <span>Periodo Oficial Habilitado para Expendios:</span>
                  <span className="font-mono text-amber-400 bg-amber-400/10 px-2.5 py-0.5 rounded-lg border border-amber-400/30 text-xs font-bold">
                    {systemConfig?.periodoHabilitadoDescarga || `${periodoMes} ${periodoAnio}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleActivarPeriodoDescarga(systemConfig?.periodoHabilitadoDescarga || `${periodoMes} ${periodoAnio}`, !systemConfig?.descargaHabilitada)}
                    className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border transition-colors cursor-pointer ${
                      systemConfig?.descargaHabilitada !== false
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-700 hover:bg-emerald-900'
                        : 'bg-rose-950 text-rose-300 border-rose-700 hover:bg-rose-900'
                    }`}
                  >
                    {systemConfig?.descargaHabilitada !== false ? '✓ DESCARGA HABILITADA' : '🔒 DESCARGA BLOQUEADA'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Este es el mes que los expendios tienen disponible para consultar y descargar su cuenta de cobro oficial en PDF.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
              {systemConfig?.periodoHabilitadoDescarga !== `${periodoMes} ${periodoAnio}` && (
                <button
                  type="button"
                  disabled={guardandoPeriodoDescarga}
                  onClick={() => handleActivarPeriodoDescarga(`${periodoMes} ${periodoAnio}`, true)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-md disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{guardandoPeriodoDescarga ? 'Guardando...' : `Habilitar ${periodoMes} ${periodoAnio} para Expendios`}</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Form Side 1: Auto Generator */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5 lg:col-span-1">
              <div>
                <h3 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                  <FileCheck2 className="w-5 h-5 text-amber-400" />
                  <span>Generador Automático CAMARCA</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Genera cuentas de cobro para todos los expendios según parámetros configurables.
                </p>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleOpenCargarGenerarModal('auto'); }} className="space-y-4">
                {/* Periodo de Cobro Robusto (Seleccionable y no modificable manualmente) */}
                <div className="space-y-2.5 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-amber-300 flex items-center space-x-1.5">
                      <Calendar className="w-4 h-4 text-amber-400" />
                      <span>Periodo de Cobro</span>
                    </label>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center space-x-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Periodo Válido</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    {/* Selector de Mes */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">Mes:</label>
                      <select
                        value={periodoMes}
                        onChange={(e) => setPeriodoMes(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-100 font-semibold rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer shadow-inner"
                      >
                        {MESES_SISTEMA.map((m) => (
                          <option key={m.value} value={m.value} className="bg-slate-900 text-slate-100">
                            {m.label} ({m.num})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Selector de Año */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">Año:</label>
                      <select
                        value={periodoAnio}
                        onChange={(e) => setPeriodoAnio(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-100 font-semibold rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer shadow-inner"
                      >
                        {ANIOS_SISTEMA.map((y) => (
                          <option key={y} value={y} className="bg-slate-900 text-slate-100">
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Resumen Periodo Oficial Calculado */}
                  {(() => {
                    const curMes = MESES_SISTEMA.find((m) => m.value === periodoMes) || MESES_SISTEMA[2];
                    const numAnio = Number(periodoAnio);
                    const isBisiesto = (numAnio % 4 === 0 && numAnio % 100 !== 0) || numAnio % 400 === 0;
                    const ultimoDia = periodoMes === 'FEBRERO' && isBisiesto ? 29 : curMes.dias;
                    return (
                      <div className="space-y-1.5">
                        <div className="bg-slate-900/90 rounded-lg p-2.5 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]">
                          <div>
                            <span className="text-slate-400">Periodo Oficial:</span>{' '}
                            <strong className="text-amber-400 font-mono font-bold text-xs">{periodo}</strong>
                          </div>
                          <div className="text-[10.5px] font-mono text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                            📅 01/{curMes.num}/{periodoAnio} al {ultimoDia}/{curMes.num}/{periodoAnio}
                          </div>
                        </div>

                        {systemConfig?.periodoHabilitadoDescarga === periodo ? (
                          <div className="text-[10.5px] text-emerald-400 font-semibold flex items-center space-x-1 px-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>Este periodo ya está habilitado para descarga de expendios</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5 text-[10.5px]">
                            <span className="text-amber-300">Periodo activo actual: <strong>{systemConfig?.periodoHabilitadoDescarga || 'No definido'}</strong></span>
                            <button
                              type="button"
                              onClick={() => handleActivarPeriodoDescarga(periodo, true)}
                              className="text-amber-400 hover:text-amber-300 font-bold underline cursor-pointer"
                            >
                              Habilitar {periodo} ahora
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Gross Up Checkbox */}
                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div>
                    <label htmlFor="grossup" className="text-xs font-bold text-slate-200 cursor-pointer block">
                      Aplicar Gross up
                    </label>
                    <p className="text-[11px] text-slate-400 leading-tight">
                      Ajusta el valor bruto para absorber el porcentaje de retención.
                    </p>
                  </div>
                  <input
                    id="grossup"
                    type="checkbox"
                    checked={aplicarGrossUp}
                    onChange={(e) => setAplicarGrossUp(e.target.checked)}
                    className="w-4 h-4 text-amber-500 rounded border-slate-700 bg-slate-900 focus:ring-amber-400 cursor-pointer"
                  />
                </div>

                {/* Modificar Valor Inicial Retención */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Modificar valor inicial retención ($ COP)
                  </label>
                  <input
                    type="number"
                    value={modificarValorInicialRetencion}
                    onChange={(e) => setModificarValorInicialRetencion(Number(e.target.value))}
                    placeholder="0"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono"
                  />
                </div>

                {/* Porcentaje de Retención */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Porcentaje de Retención (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={porcentajeRetencion}
                    onChange={(e) => setPorcentajeRetencion(Number(e.target.value))}
                    placeholder="11"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono"
                  />
                </div>

                <button
                  type="submit"
                  disabled={generandoPDF}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-4 rounded-xl shadow-lg transition-all text-xs flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Calcular Cuentas de Cobro</span>
                </button>
              </form>

              {mensajeCobros && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-800 text-emerald-300 rounded-xl text-xs flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{mensajeCobros}</span>
                </div>
              )}
            </div>

            {/* Form Side 2: Excel Mass Upload */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4 lg:col-span-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                    <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                    <span>Regeneración de Cuentas de Cobro desde Excel</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Carga un archivo Excel (.xlsx) con los cobros para procesar cuentas de cobro masivas.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleDescargarPlantillaExcel}
                  className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold py-2 px-3 rounded-xl border border-emerald-500/30 flex items-center space-x-1.5 transition-colors shrink-0 w-fit cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Descargar Plantilla Excel</span>
                </button>
              </div>

              {/* Mandatory Columns Banner */}
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-1.5">
                <div className="font-semibold text-slate-300 flex items-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  <span>Columnas obligatorias en el archivo Excel:</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[11px] font-bold">MUNICIPIO</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[11px] font-bold">CARGO BASICO</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[11px] font-bold">ADMISION SIPOST</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[11px] font-bold">VALOR VARIABLE</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[11px] font-bold">PAGO TOTAL</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[11px] font-bold">RETEF 1%</span>
                </div>
                <div className="text-[11px] text-slate-500 pt-0.5">
                  Opcionales: N°, CENTRO OPERATIVO, CENTRO DE ACOPIO, FUNCION, NETO A PAGAR, ENCARGADO, CEDULA, DIRECCION, TELEFONO.
                </div>
              </div>

              {/* Upload Form */}
              <form onSubmit={(e) => { e.preventDefault(); handleOpenCargarGenerarModal('excel'); }} className="space-y-3">
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => setFileExcel(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-slate-400 file:mr-4 file:py-2 px-3 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 bg-slate-950 border border-slate-800 rounded-xl cursor-pointer"
                  />
                  <button
                    type="submit"
                    disabled={subiendoExcel || !fileExcel}
                    className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold py-2 px-5 rounded-xl text-xs flex items-center justify-center space-x-2 transition-all shrink-0 cursor-pointer shadow-lg"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{subiendoExcel ? 'Procesando Excel...' : 'Cargar y Regenerar'}</span>
                  </button>
                </div>

                <div className="pt-0.5">
                  <label className="flex items-start space-x-2.5 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 cursor-pointer hover:border-emerald-500/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={cargarAContabilidadAuto}
                      onChange={(e) => setCargarAContabilidadAuto(e.target.checked)}
                      className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-900 cursor-pointer"
                    />
                    <div className="text-xs">
                      <span className="font-bold text-emerald-400 flex items-center space-x-1.5">
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Cargar automáticamente cuentas a la contabilidad (Relación de Pagos)</span>
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Garantiza que las cuentas cargadas correspondan al período contable activo ({periodo}) y se reflejen en la pestaña de Contabilidad.
                      </p>
                    </div>
                  </label>
                </div>

                {errorExcel && (
                  <div className="p-2.5 rounded-xl bg-red-950/50 border border-red-800 text-red-300 text-xs flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{errorExcel}</span>
                  </div>
                )}

                {alertasExcel.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-amber-950/80 border border-amber-600/60 text-amber-200 text-xs space-y-2 shadow-lg">
                    <div className="font-bold flex items-center space-x-2 text-amber-300 text-sm">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Se detectaron {alertasExcel.length} discrepancias de valores en la plantilla Excel cargada:</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 font-mono text-[11px] max-h-40 overflow-y-auto pl-1 text-amber-200">
                      {alertasExcel.map((alt, idx) => (
                        <li key={idx}>{alt}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </form>
            </div>
          </div>

          {/* Calculated Output Table Preview Side */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                  <Printer className="w-5 h-5 text-amber-400" />
                  <span>Documentos de Cuentas de Cobro Generadas</span>
                </h3>
                <p className="text-xs text-slate-400">
                  {cuentasGeneradas.length > 0
                    ? selectedCuentasKeys.length > 0
                      ? `${selectedCuentasKeys.length} de ${cuentasGeneradas.length} cuentas de cobro seleccionadas.`
                      : `${cuentasGeneradas.length} cuentas de cobro listas para impresión ajustada a 1 hoja Carta.`
                    : 'Aún no se han generado cuentas de cobro.'}
                </p>
              </div>

              {cuentasGeneradas.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleCargarCuentasAContabilidad}
                    disabled={cargandoAContabilidad}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-2 px-3.5 rounded-xl text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-colors"
                    title="Cargar y sincronizar todas las cuentas generadas a la Contabilidad (Relación de Pagos)"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>{cargandoAContabilidad ? 'Cargando a Contabilidad...' : 'Cargar a Contabilidad'}</span>
                  </button>

                  {selectedCuentasKeys.length > 0 ? (
                    <>
                      <div className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-3 py-1.5 rounded-xl font-bold text-xs flex items-center space-x-1.5 shadow-sm">
                        <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
                        <span>{selectedCuentasKeys.length} seleccionada(s)</span>
                      </div>

                      <button
                        onClick={handlePrintSelectedCuentas}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 px-3.5 rounded-xl text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-colors"
                        title="Imprimir solo las cuentas de cobro seleccionadas"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Imprimir Seleccionadas ({selectedCuentasKeys.length})</span>
                      </button>

                      <button
                        onClick={handleDownloadSelectedCuentasZip}
                        disabled={generandoPDF}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold py-2 px-3.5 rounded-xl text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-colors disabled:opacity-50"
                        title="Descargar ZIP con los PDFs de las cuentas seleccionadas"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{generandoPDF ? 'Generando...' : `Descargar ZIP (${selectedCuentasKeys.length})`}</span>
                      </button>

                      <button
                        onClick={handleDeleteSelectedCuentas}
                        className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-bold py-2 px-3.5 rounded-xl text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-colors"
                        title="Eliminar las cuentas seleccionadas"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Eliminar Seleccionadas ({selectedCuentasKeys.length})</span>
                      </button>

                      <button
                        onClick={() => setSelectedCuentasKeys([])}
                        className="text-slate-400 hover:text-slate-200 text-xs underline px-2 py-1 cursor-pointer transition-colors"
                      >
                        Deseleccionar
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleOpenModalAll}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 px-3.5 rounded-xl text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-colors"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Imprimir Todo (Formato Carta)</span>
                      </button>

                      <button
                        onClick={handleDownloadPDFConsolidado}
                        disabled={generandoPDF}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold py-2 px-3.5 rounded-xl text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-colors disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{generandoPDF ? 'Generando...' : 'Descargar ZIP (MUNICIPIO_MES.pdf)'}</span>
                      </button>

                      <button
                        onClick={handleDeleteAllGeneratedCuentas}
                        className="bg-slate-800 hover:bg-red-500/10 text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500/30 font-bold py-2 px-3 rounded-xl text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-colors"
                        title="Eliminar todas las cuentas generadas"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Eliminar Todo</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Financial Summary for the Period */}
            {resumenFinanciero && cuentasGeneradas.length > 0 && (
              <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-slate-800 shadow-xl space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                        <span>Resumen Financiero del Período Aplicado:</span>
                        <span className="px-2.5 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 font-mono text-xs border border-amber-500/30">
                          {resumenFinanciero.periodo || periodo}
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Consolidado oficial de valores calculados para las {resumenFinanciero.totalCuentas} cuentas generadas.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] text-slate-400">
                      Total Cuentas: <strong className="text-slate-200">{resumenFinanciero.totalCuentas}</strong>
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 space-y-0.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Cuentas</span>
                    <p className="text-sm font-black text-slate-100 font-mono">{resumenFinanciero.totalCuentas} docs</p>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 space-y-0.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Cargo Básico</span>
                    <p className="text-sm font-black text-slate-200 font-mono">{formatPesos(resumenFinanciero.totalCargoBasico)}</p>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 space-y-0.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Subsidio Sipost</span>
                    <p className="text-sm font-black text-slate-200 font-mono">{formatPesos(resumenFinanciero.totalSubsidioSipost)}</p>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 space-y-0.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Variable Gestión</span>
                    <p className="text-sm font-black text-slate-200 font-mono">{formatPesos(resumenFinanciero.totalVariable)}</p>
                  </div>

                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 space-y-0.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Retención 1%</span>
                    <p className="text-sm font-black text-rose-400 font-mono">-{formatPesos(resumenFinanciero.totalRetencion)}</p>
                  </div>

                  <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-xl p-2.5 space-y-0.5 sm:col-span-1 lg:col-span-1">
                    <span className="text-[10px] uppercase font-bold text-emerald-400">Gran Total Neto</span>
                    <p className="text-sm font-black text-emerald-300 font-mono">{formatPesos(resumenFinanciero.totalNeto)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Search filter for generated accounts */}
            {cuentasGeneradas.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchCuentasTerm}
                    onChange={(e) => setSearchCuentasTerm(e.target.value)}
                    placeholder="Filtrar por encargado, cédula, municipio o centro operativo..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                  />
                  {searchCuentasTerm && (
                    <button
                      onClick={() => setSearchCuentasTerm('')}
                      className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {searchCuentasTerm && (
                  <div className="text-[11px] text-slate-400 shrink-0">
                    Mostrando <strong className="text-amber-400">{cuentasGeneradasFiltradas.length}</strong> de {cuentasGeneradas.length} cuentas
                  </div>
                )}
              </div>
            )}

            {cuentasGeneradas.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3 text-center w-10">
                        <input
                          type="checkbox"
                          checked={
                            cuentasGeneradasFiltradas.length > 0 &&
                            cuentasGeneradasFiltradas.every((c, idx) => selectedCuentasKeys.includes(getCuentaKey(c, idx)))
                          }
                          onChange={toggleSelectAllCuentas}
                          className="w-4 h-4 text-amber-500 rounded border-slate-700 bg-slate-900 focus:ring-amber-400 cursor-pointer accent-amber-500"
                          title="Seleccionar / Deseleccionar todas"
                        />
                      </th>
                      <th className="py-2.5 px-3">Encargado / Cédula</th>
                      <th className="py-2.5 px-3">Municipio / C. Operativo</th>
                      <th className="py-2.5 px-3 text-right">Cargo Básico</th>
                      <th className="py-2.5 px-3 text-right">Adm. Sipost</th>
                      <th className="py-2.5 px-3 text-right">Variable</th>
                      <th className="py-2.5 px-3 text-right">Retención {porcentajeRetencion}%</th>
                      <th className="py-2.5 px-3 text-right">Neto a Pagar</th>
                      <th className="py-2.5 px-3 text-center sticky right-0 z-20 bg-slate-950 shadow-[-4px_0_12px_rgba(0,0,0,0.5)] border-l border-slate-800">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {cuentasGeneradasFiltradas.map((item, index) => {
                      const itemKey = getCuentaKey(item, index);
                      const isSelected = selectedCuentasKeys.includes(itemKey);
                      const cargo = item.cargoBasico ?? item.valorBase ?? 0;
                      const sipost = item.admisionSipost ?? 0;
                      const variable = item.valorVariable ?? 0;
                      const isGrossUp = !!item.grossUpAplicado;
                      const pRet = item.porcentajeRetencion || 1;
                      const retef = isGrossUp ? 0 : (item.retef1 ?? item.retencionValor ?? Math.round((cargo + sipost + variable) * (pRet / 100)));
                      const neto = isGrossUp ? (cargo + sipost + variable) : (item.valorNeto ?? (cargo + sipost + variable - retef));

                      return (
                        <tr
                          key={itemKey}
                          className={isSelected ? 'bg-amber-500/10 hover:bg-amber-500/15 transition-colors' : 'hover:bg-slate-800/50 transition-colors'}
                        >
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectCuenta(itemKey)}
                              className="w-4 h-4 text-amber-500 rounded border-slate-700 bg-slate-900 focus:ring-amber-400 cursor-pointer accent-amber-500"
                              title={`Seleccionar cuenta de ${item.encargado}`}
                            />
                          </td>
                          <td className="py-2.5 px-3 font-medium">
                            <div className="text-slate-100 font-semibold">{item.encargado}</div>
                            <div className="text-[10px] text-slate-400 font-mono">C.C. {item.cedula}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="text-slate-200 font-medium">{item.municipio || item.expendio}</div>
                            <div className="text-[10px] text-slate-500">{item.centroOperativo || 'REGIONAL ORIENTE'}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">{formatPesos(cargo)}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-300">{formatPesos(sipost)}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-amber-300">{formatPesos(variable)}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-red-400">
                            {isGrossUp ? (
                              <span className="text-xs text-amber-400 font-normal">$ 0 (Gross Up)</span>
                            ) : (
                              `-${formatPesos(retef)}`
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">{formatPesos(neto)}</td>
                          <td className="py-2.5 px-3 text-center sticky right-0 z-10 bg-slate-900/95 backdrop-blur-xs shadow-[-4px_0_12px_rgba(0,0,0,0.5)] border-l border-slate-800">
                            <div className="flex items-center justify-center space-x-1.5">
                              <button
                                onClick={() => handleOpenModalSingle(item)}
                                className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer inline-flex items-center space-x-1"
                                title="Ver e imprimir carta individual"
                              >
                                <Printer className="w-3 h-3" />
                                <span>Ver Carta</span>
                              </button>
                              <button
                                onClick={() => handleStartEditGeneratedCuenta(item, index)}
                                className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer inline-flex items-center space-x-1"
                                title="Modificar o actualizar datos y valores de esta cuenta"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>Modificar</span>
                              </button>
                              <button
                                onClick={() => handleDeleteSingleGeneratedCuenta(item, index)}
                                className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-red-500/20"
                                title="Eliminar esta cuenta de cobro"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center text-slate-500 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
                <FileCheck2 className="w-10 h-10 mx-auto text-slate-600 mb-2" />
                <p className="text-xs font-medium">No se han generado cuentas de cobro para el periodo seleccionado.</p>
                <p className="text-[11px] text-slate-600 mt-1">Carga el Excel a la izquierda o utiliza el Generador Automático.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- TAB: HISTORIAL DE COBROS, PERIODO HABILITADO & DASHBOARD --- */}
      {activeTab === 'historial' && (
        <div className="space-y-6">
          {/* 1. Módulo de Control de Periodo Habilitado de Descarga para Expendios */}
          <PeriodoDescargaConfigCard
            onConfigUpdated={(newCfg) => {
              setSystemConfig(newCfg);
              if (newCfg.periodoHabilitadoDescarga) {
                const parts = newCfg.periodoHabilitadoDescarga.trim().split(/\s+/);
                if (parts.length >= 2) {
                  setPeriodoMes(parts[0].toUpperCase());
                  setPeriodoAnio(parts[1]);
                }
              }
              fetchData();
            }}
          />

          {/* 2. Dashboard Analítico de Pagos & Cobros */}
          <HistorialDashboard
            historialItems={historialFiltrado}
            totalHistorialCount={historial.length}
            filtroMes={filtroMes}
            filtroAnio={filtroAnio}
            filtroTipo={filtroTipo}
            filtroSearch={filtroSearch}
            getCuentaFromItem={getCuentaFromHistorialItem}
          />

          {/* 3. Tabla y Búsqueda de Historial de Cuentas */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                  <History className="w-5 h-5 text-amber-400" />
                  <span>Historial de Cuentas de Cobro y Registros</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Búsqueda, filtrado avanzado por meses y años, gestión, visualización y descarga de cobros históricos.
                </p>
              </div>

              <div className="flex items-center space-x-2 self-start lg:self-center flex-wrap gap-y-2">
                <button
                  type="button"
                  onClick={() => setShowAIConciliacionModal(true)}
                  className="bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-bold px-3.5 py-1.5 rounded-xl text-xs flex items-center space-x-1.5 shadow transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-slate-950" />
                  <span>Auditoría & Conciliación IA (PDF / Escáner)</span>
                </button>
              </div>
            </div>

          {/* Advanced Search & Filter Bar by Month, Year, Search and Type */}
          <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-center">
              {/* Text Search */}
              <div className="relative sm:col-span-2 lg:col-span-4">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  value={filtroSearch}
                  onChange={(e) => setFiltroSearch(e.target.value)}
                  placeholder="Buscar por encargado, C.C., municipio..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-8 pr-7 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                />
                {filtroSearch && (
                  <button
                    onClick={() => setFiltroSearch('')}
                    className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Month Selector */}
              <div className="relative sm:col-span-1 lg:col-span-3">
                <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200">
                  <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-[11px] text-slate-400 font-semibold shrink-0">Mes:</span>
                  <select
                    value={filtroMes}
                    onChange={(e) => setFiltroMes(e.target.value)}
                    className="w-full bg-transparent text-xs text-slate-100 font-medium focus:outline-none cursor-pointer"
                  >
                    {MESES_OPCIONES.map((m) => (
                      <option key={m.value} value={m.value} className="bg-slate-900 text-slate-100">
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Year Selector */}
              <div className="relative sm:col-span-1 lg:col-span-2">
                <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200">
                  <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-[11px] text-slate-400 font-semibold shrink-0">Año:</span>
                  <select
                    value={filtroAnio}
                    onChange={(e) => setFiltroAnio(e.target.value)}
                    className="w-full bg-transparent text-xs text-slate-100 font-medium focus:outline-none cursor-pointer"
                  >
                    <option value="" className="bg-slate-900 text-slate-100">Todos los Años</option>
                    {aniosDisponibles.map((y) => (
                      <option key={y} value={y} className="bg-slate-900 text-slate-100">
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Type Selector (if multiple types available) */}
              <div className="relative sm:col-span-1 lg:col-span-2">
                <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200">
                  <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <select
                    value={filtroTipo}
                    onChange={(e) => setFiltroTipo(e.target.value)}
                    className="w-full bg-transparent text-xs text-slate-100 font-medium focus:outline-none cursor-pointer"
                  >
                    <option value="" className="bg-slate-900 text-slate-100">Todos los Tipos</option>
                    {tiposDisponibles.map((t) => (
                      <option key={t} value={t} className="bg-slate-900 text-slate-100">
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Reset Filters button */}
              <div className="sm:col-span-1 lg:col-span-1 flex justify-end">
                {(filtroSearch || filtroMes || filtroAnio || filtroTipo) && (
                  <button
                    onClick={() => {
                      setFiltroSearch('');
                      setFiltroMes('');
                      setFiltroAnio('');
                      setFiltroTipo('');
                    }}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 font-semibold py-1.5 px-2 rounded-xl text-[11px] flex items-center justify-center space-x-1 transition-colors cursor-pointer"
                    title="Limpiar todos los filtros"
                  >
                    <X className="w-3 h-3" />
                    <span>Limpiar</span>
                  </button>
                )}
              </div>
            </div>

            {/* Quick Metrics & Active Filter Tags */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-[11px]">
              <div className="text-slate-400">
                Mostrando <strong className="text-amber-400 font-bold">{historialFiltrado.length}</strong> de <span className="text-slate-300 font-semibold">{historial.length}</span> registros en el historial
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {filtroMes && (
                  <span className="inline-flex items-center space-x-1 bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-lg">
                    <span>Mes: {MESES_OPCIONES.find((m) => m.value === filtroMes)?.label || filtroMes}</span>
                    <button onClick={() => setFiltroMes('')} className="hover:text-amber-100">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}
                {filtroAnio && (
                  <span className="inline-flex items-center space-x-1 bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-lg">
                    <span>Año: {filtroAnio}</span>
                    <button onClick={() => setFiltroAnio('')} className="hover:text-amber-100">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}
                {filtroTipo && (
                  <span className="inline-flex items-center space-x-1 bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-lg">
                    <span>Tipo: {filtroTipo}</span>
                    <button onClick={() => setFiltroTipo('')} className="hover:text-slate-100">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}
                {filtroSearch && (
                  <span className="inline-flex items-center space-x-1 bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-lg">
                    <span>Texto: "{filtroSearch}"</span>
                    <button onClick={() => setFiltroSearch('')} className="hover:text-slate-100">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Bulk Action Bar for Selected Historial Items */}
          {selectedHistorialIds.length > 0 && (
            <div className="bg-amber-950/40 border border-amber-800/60 p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 animate-fadeIn">
              <div className="text-xs text-amber-200 font-medium flex items-center space-x-2">
                <CheckSquare className="w-4 h-4 text-amber-400" />
                <span>{selectedHistorialIds.length} cuenta(s) de cobro seleccionada(s)</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleViewSelectedHistorial}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-1.5 px-3 rounded-lg text-xs flex items-center space-x-1.5 shadow transition-colors cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Ver Seleccionadas ({selectedHistorialIds.length})</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadZipSelectedHistorial}
                  disabled={generandoPDF}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-1.5 px-3 rounded-lg text-xs flex items-center space-x-1.5 shadow transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar ZIP ({selectedHistorialIds.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleConfirmDelete('batch')}
                  className="bg-red-600 hover:bg-red-500 text-white font-bold py-1.5 px-3 rounded-lg text-xs flex items-center space-x-1.5 shadow transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar Seleccionadas ({selectedHistorialIds.length})</span>
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-3 text-center w-10">
                    <input
                      type="checkbox"
                      checked={selectedHistorialIds.length === historialFiltrado.length && historialFiltrado.length > 0}
                      onChange={toggleSelectAllHistorial}
                      className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-400 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3">Periodo / Fecha</th>
                  <th className="py-2.5 px-3">Tipo</th>
                  <th className="py-2.5 px-3">Encargado (Cédula)</th>
                  <th className="py-2.5 px-3">Expendio / Municipio</th>
                  <th className="py-2.5 px-3 text-right">Monto Neto</th>
                  <th className="py-2.5 px-3">Estado</th>
                  <th className="py-2.5 px-3 text-center sticky right-0 z-20 bg-slate-950 shadow-[-4px_0_12px_rgba(0,0,0,0.5)] border-l border-slate-800">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {historialFiltrado.length > 0 ? (
                  historialFiltrado.map((item) => {
                    const isSelected = selectedHistorialIds.includes(item.id);
                    return (
                      <tr
                        key={item.id}
                        className={`hover:bg-slate-800/50 transition-colors ${
                          isSelected ? 'bg-amber-950/20' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectHistorial(item.id)}
                            className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-400 cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-medium">
                          <div className="text-slate-100 font-semibold">{item.periodo}</div>
                          <div className="text-[10px] text-slate-500">{item.fecha}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                              item.tipo === 'Cuenta de Cobro'
                                ? 'bg-amber-400/10 text-amber-300 border border-amber-400/20'
                                : item.tipo === 'Liquidacion'
                                ? 'bg-sky-400/10 text-sky-300 border border-sky-400/20'
                                : 'bg-emerald-400/10 text-emerald-300 border border-emerald-400/20'
                            }`}
                          >
                            {item.tipo}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-200">{item.encargado}</div>
                          <div className="text-[10px] text-slate-400 font-mono">C.C. {item.cedula}</div>
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-200">{item.expendio}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                          {formatPesos(item.monto)}
                        </td>
                        <td className="py-2.5 px-3">
                          {item.estado === 'Cancelado' ? (
                            <div className="inline-flex items-center space-x-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded text-[10px] font-bold">
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span>Cancelado</span>
                            </div>
                          ) : (
                            <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded">
                              {item.estado}
                            </span>
                          )}
                          {item.soporteUrl && (
                            <a
                              href={item.soporteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block mt-1 text-[10px] text-amber-400 hover:underline font-semibold"
                            >
                              📎 Ver Soporte Pago
                            </a>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center sticky right-0 z-10 bg-slate-900/95 backdrop-blur-xs shadow-[-4px_0_12px_rgba(0,0,0,0.5)] border-l border-slate-800">
                          <div className="flex items-center justify-center space-x-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const c = getCuentaFromHistorialItem(item);
                                handleOpenModalSingle(c);
                              }}
                              className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer inline-flex items-center space-x-1"
                              title="Visualizar Modelo de Carta Oficial"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Ver Modelo</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleStartEditHistorial(item)}
                              className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer inline-flex items-center space-x-1"
                              title="Editar Cuenta de Cobro"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>Editar</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleConfirmDelete('single', item.id, item.encargado)}
                              className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-bold px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer inline-flex items-center"
                              title="Eliminar Registro"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <History className="w-8 h-8 text-slate-600" />
                        <p className="text-xs font-semibold text-slate-300">
                          No se encontraron registros en el historial con los filtros aplicados.
                        </p>
                        <p className="text-[11px] text-slate-500 max-w-sm">
                          Prueba seleccionando otro mes o año, o limpiando los criterios de búsqueda.
                        </p>
                        {(filtroSearch || filtroMes || filtroAnio || filtroTipo) && (
                          <button
                            type="button"
                            onClick={() => {
                              setFiltroSearch('');
                              setFiltroMes('');
                              setFiltroAnio('');
                              setFiltroTipo('');
                            }}
                            className="mt-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                          >
                            Restablecer todos los filtros
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {/* --- TAB 4: REPORTE FOTOGRÁFICO POR MUNICIPIO CON 7 FOTOS --- */}
      {activeTab === 'fotos' && (
        <ReporteFotograficoMunicipiosView
          expendios={expendios}
          onUpdateExpendio={(updatedExp) => {
            setExpendios((prev) => prev.map((item) => (item.id === updatedExp.id ? updatedExp : item)));
          }}
          onRefreshExpendios={fetchData}
        />
      )}

      {/* --- GESTIÓN DE EXPENDIOS --- */}
      {activeTab === 'expendios' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          {/* Section Header */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center space-x-2 text-emerald-400 font-semibold text-xs tracking-wider uppercase mb-1">
                <Store className="w-4 h-4" />
                <span>Base de Datos del Sistema | Módulo "Expendios"</span>
              </div>
              <h3 className="text-xl font-bold text-slate-100">
                Visualización y Modificación de Datos de Expendios
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Edita o registra cualquier dato de un expendio. Cada modificación se actualiza y guarda en tiempo real en el sistema.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setShowExcelModal(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center space-x-1.5 shadow-lg cursor-pointer transition-colors"
                title="Cargar y reemplazar base de datos desde un archivo Excel (.xlsx / .xls)"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>📊 Cargar desde Excel (.xlsx)</span>
              </button>

              <button
                onClick={handleOpenNewExpendioModal}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center space-x-1.5 shadow-lg cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>+ Registrar Nuevo Expendio</span>
              </button>

              <a
                href="/api/cliente/export-excel"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold py-2.5 px-3.5 rounded-xl text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Exportar Excel (.xlsx)</span>
              </a>
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Total Expendios</div>
              <div className="text-xl font-bold text-slate-100 font-mono mt-0.5">{expendios.length}</div>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Con Internet</div>
              <div className="text-xl font-bold text-emerald-400 font-mono mt-0.5">
                {expendios.filter((e) => e.internet === 'SI').length}
              </div>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Usuario SIPOST</div>
              <div className="text-xl font-bold text-sky-400 font-mono mt-0.5">
                {expendios.filter((e) => e.usuarioSipost && e.usuarioSipost !== 'NO ASIGNADO').length}
              </div>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Con Fotos Cargadas</div>
              <div className="text-xl font-bold text-amber-400 font-mono mt-0.5">
                {expendios.filter((e) => e.letreroUrl || e.basculaUrl).length}
              </div>
            </div>
          </div>

          {/* Search Bar & Scroll Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative max-w-md w-full">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={searchExpendioTerm}
                onChange={(e) => setSearchExpendioTerm(e.target.value)}
                placeholder="Buscar por Localidad, Municipio, Encargado, Cédula o Dirección..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Desplazamiento Horizontal Controls */}
            <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-400">
              <span className="flex items-center space-x-1.5 font-semibold text-amber-400 text-[11px]">
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Desplazar Tabla:</span>
              </span>
              <button
                type="button"
                onClick={() => scrollTable('left')}
                className="bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 px-2.5 py-1 rounded-lg border border-slate-700 text-[11px] flex items-center space-x-1 cursor-pointer transition-colors"
                title="Desplazar tabla a la izquierda"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Izq</span>
              </button>
              <button
                type="button"
                onClick={() => scrollTable('right')}
                className="bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 px-2.5 py-1 rounded-lg border border-slate-700 text-[11px] flex items-center space-x-1 cursor-pointer transition-colors"
                title="Desplazar tabla a la derecha"
              >
                <span>Der</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* BARRA DE DESPLAZAMIENTO SUPERIOR */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold px-1">
              <span className="text-amber-400/90 flex items-center space-x-1">
                <span>↔️ Barra de navegación horizontal superior</span>
              </span>
              <span className="text-slate-500 text-[10px] hidden sm:inline">Arrastra la barra o usa la rueda del ratón/trackpad</span>
            </div>
            
            <div
              ref={topScrollRef}
              onScroll={handleTopScroll}
              className="overflow-x-auto h-3.5 bg-slate-900 rounded-t-xl border border-slate-800 border-b-0"
              style={{ scrollbarWidth: 'thin' }}
            >
              <div style={{ width: `${tableScrollWidth || 2000}px`, height: '1px' }} />
            </div>

            {/* Interactive Expendios Data Table Container */}
            <div
              ref={tableContainerRef}
              onScroll={handleTableScroll}
              className="overflow-x-auto rounded-b-xl border border-slate-800"
            >
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-900 text-slate-100 font-bold uppercase tracking-wider text-[11px] border-b-2 border-slate-700 shadow-md">
                  <tr>
                    <th className="py-3 px-3.5 text-slate-200">CENTRO OPERATIVO</th>
                    <th className="py-3 px-3.5 text-slate-200">CENTRO DE ACOPIO</th>
                    <th className="py-2.5 px-3.5 text-amber-300 leading-tight">
                      <div>LOCALIDAD</div>
                      <div className="text-[9.5px] text-amber-400/80 font-normal tracking-normal normal-case">(Municipio Corregimiento Inspección)</div>
                    </th>
                    <th className="py-3 px-3.5 text-slate-200">ENCARGADO</th>
                    <th className="py-3 px-3.5 text-slate-200">CEDULA</th>
                    <th className="py-3 px-3.5 text-slate-200">DIRECCION PUNTO</th>
                    <th className="py-3 px-3.5 text-slate-200">TELEFONO PUNTO</th>
                    <th className="py-3 px-3 text-center text-slate-200">LETRERO</th>
                    <th className="py-3 px-3 text-center text-slate-200">BASCULA</th>
                    <th className="py-3 px-3 text-center text-slate-200">MATASELLO</th>
                    <th className="py-3 px-3.5 text-emerald-300">USUARIO DE SIPOST</th>
                    <th className="py-3 px-3 text-center text-slate-200">COMPUTADOR</th>
                    <th className="py-3 px-3 text-center text-slate-200">INTERNET</th>
                    <th className="py-3 px-3.5 text-slate-200">NIT</th>
                    <th className="py-3 px-3.5 text-emerald-300 font-bold">CUENTA BANCARIA</th>
                    <th className="py-3 px-3.5 text-slate-200">Correo Electronico</th>
                    <th className="py-3 px-3.5 text-slate-200">OBSERVACION</th>
                    <th className="py-3 px-4 text-center text-slate-200 border-l border-slate-700 sticky right-0 z-20 bg-slate-900 shadow-[-4px_0_12px_rgba(0,0,0,0.5)]">ACCIONES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  {expendiosFiltrados.length > 0 ? (
                    expendiosFiltrados.map((exp) => (
                      <tr key={exp.id} className="hover:bg-slate-800/50 transition-colors group">
                        <td className="py-2.5 px-3 font-medium text-slate-300">{exp.centroOperativo || '-'}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-200">{exp.centroAcopio || '-'}</td>
                        <td className="py-2.5 px-3 font-bold text-amber-300">{exp.localidad || '-'}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-100">{exp.encargado}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">{exp.cedula}</td>
                      <td className="py-2.5 px-3 text-slate-300 max-w-[220px] truncate">{exp.direccionPunto || 'SEDE PRINCIPAL'}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-400">{exp.telefonoPunto || 'Sin Tel.'}</td>
                      
                      {/* Letrero */}
                      <td className="py-2.5 px-3 text-center">
                        {exp.letreroUrl || exp.fotoAvisoUrl ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewPhotoModal({
                                url: exp.fotoAvisoUrl || exp.letreroUrl || '',
                                title: `FOTO LETRERO / AVISO - ${exp.localidad}`,
                                subtitle: `${exp.municipio} | Encargado: ${exp.encargado} (C.C. ${exp.cedula})`,
                                metadata: {
                                  encargado: exp.encargado,
                                  cedula: exp.cedula,
                                  municipio: exp.municipio || exp.localidad,
                                  direccion: exp.direccionPunto,
                                  telefono: exp.telefonoPunto,
                                },
                              })
                            }
                            className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 transition-colors cursor-pointer inline-flex items-center space-x-1"
                            title="Click para ver la foto de Letrero"
                          >
                            <Eye className="w-3 h-3 text-emerald-400" />
                            <span>VER</span>
                          </button>
                        ) : exp.tieneAviso === 'NO' ? (
                          <span
                            className="px-2 py-0.5 rounded font-bold text-[10px] bg-amber-950 text-amber-300 border border-amber-800"
                            title={exp.motivoFaltaAviso ? `Falta justificada: ${exp.motivoFaltaAviso}` : 'Reportado como NO'}
                          >
                            NO{exp.motivoFaltaAviso ? ' ⚠️' : ''}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-950 text-emerald-500 border border-emerald-900">
                            SI
                          </span>
                        )}
                      </td>

                      {/* Báscula */}
                      <td className="py-2.5 px-3 text-center">
                        {exp.basculaUrl || exp.fotoBasculaUrl ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewPhotoModal({
                                url: exp.fotoBasculaUrl || exp.basculaUrl || '',
                                title: `FOTO BÁSCULA - ${exp.localidad}`,
                                subtitle: `${exp.municipio} | Encargado: ${exp.encargado} (C.C. ${exp.cedula})`,
                                metadata: {
                                  encargado: exp.encargado,
                                  cedula: exp.cedula,
                                  municipio: exp.municipio || exp.localidad,
                                  direccion: exp.direccionPunto,
                                  telefono: exp.telefonoPunto,
                                },
                              })
                            }
                            className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 transition-colors cursor-pointer inline-flex items-center space-x-1"
                            title="Click para ver la foto de Báscula"
                          >
                            <Eye className="w-3 h-3 text-emerald-400" />
                            <span>VER</span>
                          </button>
                        ) : exp.tieneBascula === 'NO' ? (
                          <span
                            className="px-2 py-0.5 rounded font-bold text-[10px] bg-amber-950 text-amber-300 border border-amber-800"
                            title={exp.motivoFaltaBascula ? `Falta justificada: ${exp.motivoFaltaBascula}` : 'Reportado como NO'}
                          >
                            NO{exp.motivoFaltaBascula ? ' ⚠️' : ''}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-950 text-emerald-500 border border-emerald-900">
                            SI
                          </span>
                        )}
                      </td>

                      {/* Matasello */}
                      <td className="py-2.5 px-3 text-center">
                        {exp.mataselloUrl || exp.fotoMataselloUrl ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewPhotoModal({
                                url: exp.fotoMataselloUrl || exp.mataselloUrl || '',
                                title: `FOTO MATASELLO - ${exp.localidad}`,
                                subtitle: `${exp.municipio} | Encargado: ${exp.encargado} (C.C. ${exp.cedula})`,
                                metadata: {
                                  encargado: exp.encargado,
                                  cedula: exp.cedula,
                                  municipio: exp.municipio || exp.localidad,
                                  direccion: exp.direccionPunto,
                                  telefono: exp.telefonoPunto,
                                },
                              })
                            }
                            className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 transition-colors cursor-pointer inline-flex items-center space-x-1"
                            title="Click para ver la foto de Matasello"
                          >
                            <Eye className="w-3 h-3 text-emerald-400" />
                            <span>VER</span>
                          </button>
                        ) : exp.tieneMatasello === 'NO' ? (
                          <span
                            className="px-2 py-0.5 rounded font-bold text-[10px] bg-amber-950 text-amber-300 border border-amber-800"
                            title={exp.motivoFaltaMatasello ? `Falta justificada: ${exp.motivoFaltaMatasello}` : 'Reportado como NO'}
                          >
                            NO{exp.motivoFaltaMatasello ? ' ⚠️' : ''}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-950 text-emerald-500 border border-emerald-900">
                            SI
                          </span>
                        )}
                      </td>

                      {/* Usuario Sipost */}
                      <td className="py-2.5 px-3 font-mono text-emerald-400 font-bold">{exp.usuarioSipost}</td>

                      {/* Computador */}
                      <td className="py-2.5 px-3 text-center">
                        {exp.computadorUrl ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewPhotoModal({
                                url: exp.computadorUrl || '',
                                title: `FOTO COMPUTADOR - ${exp.localidad}`,
                                subtitle: `${exp.municipio} | Encargado: ${exp.encargado} (C.C. ${exp.cedula})`,
                                metadata: {
                                  encargado: exp.encargado,
                                  cedula: exp.cedula,
                                  municipio: exp.municipio || exp.localidad,
                                  direccion: exp.direccionPunto,
                                  telefono: exp.telefonoPunto,
                                },
                              })
                            }
                            className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 transition-colors cursor-pointer inline-flex items-center space-x-1"
                            title="Click para ver la foto de Computador"
                          >
                            <Eye className="w-3 h-3 text-emerald-400" />
                            <span>VER</span>
                          </button>
                        ) : exp.tieneComputador === 'NO' ? (
                          <span
                            className="px-2 py-0.5 rounded font-bold text-[10px] bg-amber-950 text-amber-300 border border-amber-800"
                            title={exp.motivoFaltaComputador ? `Falta justificada: ${exp.motivoFaltaComputador}` : 'Reportado como NO'}
                          >
                            NO{exp.motivoFaltaComputador ? ' ⚠️' : ''}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-950 text-emerald-500 border border-emerald-900">
                            SI
                          </span>
                        )}
                      </td>

                      {/* Internet */}
                      <td className="py-2.5 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${exp.internet === 'SI' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-400'}`}>
                          {exp.internet || 'SI'}
                        </span>
                      </td>

                      {/* Nit */}
                      <td className="py-2.5 px-3 font-mono text-slate-400">{exp.nit || '900062917'}</td>

                      {/* Cuenta Bancaria */}
                      <td className="py-2.5 px-3">
                        {exp.cuentaBancaria ? (
                          <div className="flex items-center space-x-1.5 font-mono text-emerald-400 font-bold text-[11px]">
                            <span>{exp.cuentaBancaria}</span>
                            <span className="text-[9.5px] bg-slate-800 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-800/60 font-sans uppercase">
                              {exp.banco || 'NEQUI'}
                            </span>
                          </div>
                        ) : exp.telefonoPunto ? (
                          <div className="flex items-center space-x-1.5 font-mono text-slate-300 text-[11px]">
                            <span>{exp.telefonoPunto}</span>
                            <span className="text-[9.5px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700 font-sans">
                              NEQUI
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">Sin registrar</span>
                        )}
                      </td>

                      {/* Correo Electronico */}
                      <td className="py-2.5 px-3 text-slate-300 lowercase">{exp.correoElectronico || '-'}</td>

                      {/* Observacion */}
                      <td className="py-2.5 px-3 text-slate-400 max-w-[250px] whitespace-normal">
                        {exp.observacion ? <div className="mb-1">{exp.observacion}</div> : null}
                        {exp.tieneAviso === 'NO' && <div className="text-amber-400 text-[10px] leading-tight">⚠️ Sin letrero{exp.motivoFaltaAviso ? `: ${exp.motivoFaltaAviso}` : ''}</div>}
                        {exp.tieneBascula === 'NO' && <div className="text-amber-400 text-[10px] leading-tight">⚠️ Sin báscula{exp.motivoFaltaBascula ? `: ${exp.motivoFaltaBascula}` : ''}</div>}
                        {exp.tieneMatasello === 'NO' && <div className="text-amber-400 text-[10px] leading-tight">⚠️ Sin matasello{exp.motivoFaltaMatasello ? `: ${exp.motivoFaltaMatasello}` : ''}</div>}
                        {exp.tieneComputador === 'NO' && <div className="text-amber-400 text-[10px] leading-tight">⚠️ Sin computador{exp.motivoFaltaComputador ? `: ${exp.motivoFaltaComputador}` : ''}</div>}
                        {(!exp.observacion && exp.tieneAviso !== 'NO' && exp.tieneBascula !== 'NO' && exp.tieneMatasello !== 'NO' && exp.tieneComputador !== 'NO') && '-'}
                      </td>

                      {/* Acciones */}
                      <td className="py-2.5 px-4 text-center border-l border-slate-700 sticky right-0 z-10 bg-slate-900/95 backdrop-blur-xs shadow-[-4px_0_12px_rgba(0,0,0,0.5)]">
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            onClick={() => {
                              setSelectedFotoExpendioId(exp.id);
                              setActiveTab('fotos');
                            }}
                            className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer inline-flex items-center space-x-1"
                            title="Ver / Generar Registro Fotográfico Oficial Agrupado"
                          >
                            <Camera className="w-3 h-3" />
                            <span>Fotos</span>
                          </button>

                          <button
                            onClick={() => handleEditExpendio(exp)}
                            className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold px-2.5 py-1 rounded-lg text-[11px] transition-colors cursor-pointer inline-flex items-center space-x-1"
                            title="Editar Expendio"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Editar</span>
                          </button>

                          <button
                            onClick={() => handleDeleteExpendio(exp)}
                            className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-bold px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer inline-flex items-center"
                            title="Eliminar Expendio"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={18} className="py-8 text-center text-slate-500">
                      No se encontraron expendios registrados con el término de búsqueda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

          {/* Sección de Generación de Registro Fotográfico Oficial al final del módulo */}
          <div className="border-t border-slate-800 pt-8 mt-8 space-y-6">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-slate-950 p-5 rounded-2xl border border-slate-800">
              <div className="max-w-xl">
                <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs tracking-wider uppercase mb-1">
                  <Camera className="w-4 h-4" />
                  <span>Generación de Registro Fotográfico Oficial</span>
                </div>
                <h4 className="text-lg font-bold text-slate-100">
                  Documento de Registro Fotográfico por Expendio y Reporte Consolidado
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Busca cualquier expendio por nombre o genera el reporte PDF completo consolidando todos los expendios ({expendios.length} registrados).
                </p>
              </div>

              {/* Botones de Acción Global para Todos los Expendios */}
              <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
                <button
                  type="button"
                  onClick={async () => {
                    if (expendios.length === 0) return;
                    setGenerandoPDFTodos(true);
                    try {
                      await generateReporteFotograficoPDF(expendios);
                    } catch (e) {
                      console.error('Error generando PDF consolidado:', e);
                      alert('Error al generar el documento PDF consolidado de todos los expendios.');
                    } finally {
                      setGenerandoPDFTodos(false);
                    }
                  }}
                  disabled={generandoPDFTodos || expendios.length === 0}
                  className="flex-1 lg:flex-none bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black py-2.5 px-4 rounded-xl shadow-lg text-xs flex items-center justify-center space-x-2 cursor-pointer transition-all active:scale-95"
                  title="Generar y descargar documento PDF oficial con el registro fotográfico de TODOS los expendios"
                >
                  {generandoPDFTodos ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                      <span>Compilando Reporte Total...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Generar Todo el Reporte ({expendios.length} Expendios)</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (expendios.length === 0) return;
                    setGenerandoZipTodos(true);
                    try {
                      await generateReporteFotograficoZip(expendios);
                    } catch (e) {
                      console.error('Error generando ZIP:', e);
                      alert('Error al comprimir el archivo ZIP.');
                    } finally {
                      setGenerandoZipTodos(false);
                    }
                  }}
                  disabled={generandoZipTodos || expendios.length === 0}
                  className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-emerald-400 border border-emerald-800/60 font-bold py-2.5 px-3.5 rounded-xl shadow text-xs flex items-center justify-center space-x-1.5 cursor-pointer transition-colors"
                  title="Descargar paquete ZIP con fichas PDF individuales de cada expendio"
                >
                  {generandoZipTodos ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Comprimiendo ZIP...</span>
                    </>
                  ) : (
                    <>
                      <FileArchive className="w-4 h-4 text-emerald-400" />
                      <span>Descargar ZIP (Todos)</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('fotos')}
                  className="bg-slate-900 hover:bg-slate-800 text-sky-400 border border-sky-800/60 font-bold py-2.5 px-3.5 rounded-xl text-xs flex items-center justify-center space-x-1.5 cursor-pointer transition-colors"
                  title="Ver vista avanzada agrupada por Municipios"
                >
                  <Eye className="w-4 h-4" />
                  <span>Control por Municipios</span>
                </button>
              </div>
            </div>

            {/* Barra de Búsqueda de Expendio por Nombre / Encargado / Municipio */}
            <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                {/* Campo de búsqueda con icono */}
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchFotoExpendioTerm}
                    onChange={(e) => setSearchFotoExpendioTerm(e.target.value)}
                    placeholder="🔍 Buscar expendio por nombre, encargado, municipio, cédula o SIPOST..."
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 rounded-xl pl-10 pr-9 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {searchFotoExpendioTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchFotoExpendioTerm('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                      title="Limpiar búsqueda"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Selector Dropdown */}
                {(() => {
                  const filteredExpFoto = expendios.filter((exp) => {
                    if (!searchFotoExpendioTerm.trim()) return true;
                    const term = searchFotoExpendioTerm.toLowerCase();
                    return (
                      (exp.localidad || '').toLowerCase().includes(term) ||
                      (exp.municipio || '').toLowerCase().includes(term) ||
                      (exp.encargado || '').toLowerCase().includes(term) ||
                      (exp.cedula || '').toLowerCase().includes(term) ||
                      (exp.usuarioSipost || '').toLowerCase().includes(term) ||
                      (exp.direccionPunto || '').toLowerCase().includes(term)
                    );
                  });

                  return (
                    <div className="flex items-center space-x-2 min-w-[280px] sm:w-auto">
                      <select
                        value={
                          filteredExpFoto.some((e) => e.id === selectedFotoExpendioId)
                            ? selectedFotoExpendioId
                            : filteredExpFoto[0]?.id || ''
                        }
                        onChange={(e) => setSelectedFotoExpendioId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 text-amber-300 font-semibold rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                      >
                        {filteredExpFoto.map((exp) => (
                          <option key={exp.id} value={exp.id}>
                            {exp.localidad} - {exp.encargado} ({exp.municipio || 'Expendio'})
                          </option>
                        ))}
                        {filteredExpFoto.length === 0 && (
                          <option value="">Sin resultados</option>
                        )}
                      </select>
                    </div>
                  );
                })()}
              </div>

              {/* Badges de acceso rápido para los resultados filtrados */}
              {(() => {
                const filteredExpFoto = expendios.filter((exp) => {
                  if (!searchFotoExpendioTerm.trim()) return false;
                  const term = searchFotoExpendioTerm.toLowerCase();
                  return (
                    (exp.localidad || '').toLowerCase().includes(term) ||
                    (exp.municipio || '').toLowerCase().includes(term) ||
                    (exp.encargado || '').toLowerCase().includes(term) ||
                    (exp.cedula || '').toLowerCase().includes(term) ||
                    (exp.usuarioSipost || '').toLowerCase().includes(term)
                  );
                });

                if (filteredExpFoto.length > 0 && searchFotoExpendioTerm.trim()) {
                  return (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[10px] text-slate-400 font-medium mr-1">
                        Coincidencias ({filteredExpFoto.length}):
                      </span>
                      {filteredExpFoto.slice(0, 8).map((exp) => (
                        <button
                          key={exp.id}
                          type="button"
                          onClick={() => setSelectedFotoExpendioId(exp.id)}
                          className={`text-[10.5px] px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer flex items-center space-x-1 ${
                            selectedFotoExpendioId === exp.id
                              ? 'bg-amber-500 text-slate-950 font-bold shadow'
                              : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          <span>{exp.localidad}</span>
                          <span className="opacity-70 text-[9.5px]">({exp.encargado})</span>
                        </button>
                      ))}
                      {filteredExpFoto.length > 8 && (
                        <span className="text-[10px] text-slate-500">
                          +{filteredExpFoto.length - 8} más en el selector
                        </span>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Selected RegistroFotograficoCard */}
            {(() => {
              const currentExp =
                expendios.find((e) => e.id === selectedFotoExpendioId) ||
                expendios.find((exp) => {
                  if (!searchFotoExpendioTerm.trim()) return true;
                  const term = searchFotoExpendioTerm.toLowerCase();
                  return (
                    (exp.localidad || '').toLowerCase().includes(term) ||
                    (exp.municipio || '').toLowerCase().includes(term) ||
                    (exp.encargado || '').toLowerCase().includes(term) ||
                    (exp.cedula || '').toLowerCase().includes(term)
                  );
                }) ||
                expendios[0];

              if (!currentExp) {
                return (
                  <div className="p-8 text-center text-slate-500 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
                    No hay expendios disponibles para generar el registro fotográfico.
                  </div>
                );
              }
              return (
                <RegistroFotograficoCard
                  key={currentExp.id}
                  expendio={currentExp}
                  onUpdatePhotos={(updatedExp) => {
                    setExpendios((prev) => prev.map((item) => (item.id === updatedExp.id ? updatedExp : item)));
                  }}
                />
              );
            })()}
          </div>
        </div>
      )}

      {/* --- TAB: RELACIÓN DE PAGOS & EXCEL --- */}
      {activeTab === 'pagos' && <RelacionPagosPanel />}

      {/* --- TAB: TRAZABILIDAD DE EXPENDIOS POR MUNICIPIO --- */}
      {activeTab === 'trazabilidad' && (
        <TrazabilidadExpendiosPanel onUpdate={fetchData} />
      )}

      {/* --- TAB: MÉTRICAS DE ACCESO (SOLO ADMINISTRADOR) --- */}
      {activeTab === 'metricas' && (
        <AdminMetricasView onGoToExpendios={() => setActiveTab('expendios')} />
      )}

      {/* --- TAB: DOCUMENTACIÓN PARA EXPENDIOS (ADMINISTRADOR) --- */}
      {activeTab === 'documentos' && (
        <AdminDocumentosExpendiosPanel isLight={false} expendios={expendios} />
      )}

      {/* --- TAB 9: BASE DE DATOS GOOGLE SHEETS EN VIVO --- */}
      {activeTab === 'sheets' && (
        <div className="space-y-6">
          <GoogleSheetsDatabaseManager
            accessToken={driveAccessToken}
            isAuthenticated={isGoogleDriveConnected}
            onSignIn={handleGoogleSignIn}
            theme="dark"
            onDataImported={() => {
              fetchData();
              setSyncStatusMsg('✓ Base de datos sincronizada exitosamente con Google Sheets.');
              setTimeout(() => setSyncStatusMsg(''), 8000);
            }}
          />
        </div>
      )}

      {/* Modal para Editar Cuenta de Cobro */}
      {editingCuentaItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-amber-400 font-bold text-base">
                <Edit3 className="w-5 h-5" />
                <span>
                  {editingCuentaItem.source === 'generated'
                    ? 'Modificar Cuenta de Cobro Generada'
                    : 'Editar Cuenta de Cobro'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEditingCuentaItem(null)}
                className="text-slate-400 hover:text-slate-200 transition-colors p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditCuenta} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Encargado (Nombre Completo)</label>
                  <input
                    type="text"
                    required
                    value={editForm.encargado}
                    onChange={(e) => setEditForm((p) => ({ ...p, encargado: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 uppercase"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Cédula / NIT</label>
                  <input
                    type="text"
                    required
                    value={editForm.cedula}
                    onChange={(e) => setEditForm((p) => ({ ...p, cedula: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Municipio / Expendio</label>
                  <input
                    type="text"
                    required
                    value={editForm.municipio}
                    onChange={(e) => setEditForm((p) => ({ ...p, municipio: e.target.value }))}
                    className="w-full bg-slate-950 border border-amber-500/50 rounded-xl px-3 py-2 text-amber-300 font-medium uppercase"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Centro Operativo</label>
                  <input
                    type="text"
                    value={editForm.centroOperativo}
                    onChange={(e) => setEditForm((p) => ({ ...p, centroOperativo: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 uppercase"
                  />
                </div>

                <div className="sm:col-span-2 bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
                  <label className="block text-slate-200 font-semibold text-xs flex items-center space-x-1.5">
                    <Calendar className="w-4 h-4 text-amber-400" />
                    <span>Periodo de Cobro</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Mes:</label>
                      <select
                        value={editMes}
                        onChange={(e) => {
                          const nuevoMes = e.target.value;
                          setEditMes(nuevoMes);
                          setEditForm((p) => ({ ...p, periodo: `${nuevoMes} ${editAnio}` }));
                        }}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-100 font-semibold rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                      >
                        {MESES_SISTEMA.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label} ({m.num})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Año:</label>
                      <select
                        value={editAnio}
                        onChange={(e) => {
                          const nuevoAnio = e.target.value;
                          setEditAnio(nuevoAnio);
                          setEditForm((p) => ({ ...p, periodo: `${editMes} ${nuevoAnio}` }));
                        }}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-100 font-semibold rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                      >
                        {ANIOS_SISTEMA.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-[11px] flex items-center justify-between text-slate-300">
                    <div>
                      <span className="text-slate-400">Periodo guardado:</span>{' '}
                      <strong className="text-amber-400 font-mono">{editMes} {editAnio}</strong>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Cargo Básico ($ COP)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={editForm.cargoBasico}
                    onChange={(e) => setEditForm((p) => ({ ...p, cargoBasico: Number(e.target.value) }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Admisión SIPOST ($ COP)</label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.admisionSipost}
                    onChange={(e) => setEditForm((p) => ({ ...p, admisionSipost: Number(e.target.value) }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-slate-300 font-semibold mb-1">Valor Variable ($ COP)</label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.valorVariable}
                    onChange={(e) => setEditForm((p) => ({ ...p, valorVariable: Number(e.target.value) }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
              </div>

              {/* Calculations Summary */}
              {(() => {
                const cargo = Number(editForm.cargoBasico) || 0;
                const sipost = Number(editForm.admisionSipost) || 0;
                const variable = Number(editForm.valorVariable) || 0;
                const pagoTotal = cargo + sipost + variable;
                const isGrossUp = !!editForm.grossUpAplicado;
                const pRet = Number(editForm.porcentajeRetencion) || 1;
                const retef1 = isGrossUp ? 0 : Math.round(pagoTotal * (pRet / 100));
                const valorNeto = isGrossUp ? pagoTotal : pagoTotal - retef1;

                return (
                  <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl space-y-2">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cálculo Financiero Automático</div>
                    <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
                      <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[10px]">PAGO TOTAL</div>
                        <div className="text-slate-100 font-bold mt-0.5">{formatPesos(pagoTotal)}</div>
                      </div>
                      <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                        <div className="text-red-400 text-[10px]">RETEFUENTE ({isGrossUp ? '0%' : `${pRet}%`})</div>
                        <div className="text-red-400 font-bold mt-0.5">-{formatPesos(retef1)}</div>
                      </div>
                      <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                        <div className="text-emerald-400 text-[10px]">NETO A PAGAR</div>
                        <div className="text-emerald-400 font-bold mt-0.5">{formatPesos(valorNeto)}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingCuentaItem(null)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2 px-4 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={guardandoEdit}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 px-5 rounded-xl text-xs flex items-center space-x-2 shadow-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{guardandoEdit ? 'Guardando...' : 'Guardar Cambios'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Render Cuenta Cobro Document Modal for Letter Size Printing */}
      {showDocumentModal && (
        <CuentaCobroDocument
          cuentas={modalCuentas}
          onClose={() => setShowDocumentModal(false)}
        />
      )}

      {/* Render Expendio Editor Modal for Live Editing */}
      {showEditorModal && (
        <ExpendioEditorModal
          expendio={editingExpendio}
          onClose={() => setShowEditorModal(false)}
          onSaveSuccess={handleSaveExpendioSuccess}
        />
      )}

      {/* Render Excel Import Modal */}
      {showExcelModal && (
        <ExcelImportModal
          onClose={() => setShowExcelModal(false)}
          onImportSuccess={(msg) => {
            setSyncStatusMsg(msg);
            fetchData();
            setTimeout(() => setSyncStatusMsg(''), 7000);
          }}
        />
      )}

      {/* Render Custom Delete Confirmation Modal for Historial */}
      {deleteConfirmModal?.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-900/50 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fadeIn">
            <div className="flex items-center space-x-3 text-red-400">
              <div className="p-3 bg-red-950 border border-red-800/60 rounded-xl">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Confirmar Eliminación</h3>
                <p className="text-xs text-slate-400">Esta acción eliminará el registro permanentemente.</p>
              </div>
            </div>

            <div className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
              {(deleteConfirmModal.type === 'single' || deleteConfirmModal.type === 'single-generated') && (
                <p>
                  ¿Estás seguro de que deseas eliminar la cuenta de cobro de{' '}
                  <strong className="text-amber-400">{deleteConfirmModal.label || 'este registro'}</strong>?
                </p>
              )}
              {(deleteConfirmModal.type === 'batch' || deleteConfirmModal.type === 'batch-generated') && (
                <p>
                  ¿Estás seguro de que deseas eliminar permanentemente las{' '}
                  <strong className="text-amber-400">{deleteConfirmModal.count} cuentas de cobro</strong> seleccionadas?
                </p>
              )}
              {(deleteConfirmModal.type === 'all' || deleteConfirmModal.type === 'all-generated') && (
                <p>
                  ¿Estás seguro de que deseas <strong className="text-red-400 font-bold">ELIMINAR TODAS</strong> las ({deleteConfirmModal.count}) cuentas de cobro?
                </p>
              )}
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setDeleteConfirmModal(null)}
                disabled={procesandoEliminacion}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2 px-4 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={procesandoEliminacion}
                onClick={handleExecuteDelete}
                className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-5 rounded-xl text-xs flex items-center space-x-2 shadow-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                <span>{procesandoEliminacion ? 'Eliminando...' : 'Sí, Eliminar Ahora'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Render Cargar y Generar Cuentas de Cobro Modal */}
      {showCargarGenerarModal && (
        <CargarGenerarModal
          isOpen={showCargarGenerarModal}
          mode={cargarGenerarMode}
          onClose={() => setShowCargarGenerarModal(false)}
          onConfirm={handleConfirmCargarGenerar}
          defaultPeriodo={{ mes: periodoMes, anio: periodoAnio }}
          defaultGrossUp={aplicarGrossUp}
          defaultPorcentajeRetencion={porcentajeRetencion}
          defaultModificarValorInicialRetencion={modificarValorInicialRetencion}
          defaultArchivarAutomaticamente={cargarAContabilidadAuto}
          historial={historial}
          relacionPagos={relacionPagosData}
          existingPeriodsInHistorial={Array.from(
            new Set([
              ...historial.map((h) => (h.periodo || '').trim().toUpperCase()).filter(Boolean),
              ...relacionPagosData.map((r) => (r.periodo || '').trim().toUpperCase()).filter(Boolean),
            ])
          )}
          isLoading={procesandoCargarGenerar}
          fileExcelName={fileExcel?.name}
        />
      )}

      {/* Render Discrepancias Encargado Modal */}
      {discrepanciasModal && (
        <DiscrepanciasEncargadoModal
          isOpen={discrepanciasModal.isOpen}
          discrepancias={discrepanciasModal.discrepancias}
          contexto="cuentas"
          periodo={discrepanciasModal.periodo}
          isProcessing={resolviendoDiscrepancias}
          onResolver={handleResolverDiscrepanciasExcel}
          onClose={() => setDiscrepanciasModal(null)}
        />
      )}

      {/* Render Modal de Borrado Seguro con Contraseña Maestra (Camarca.2023*) */}
      {borradoModalConfig && (
        <ConfirmarBorradoModal
          isOpen={borradoModalConfig.isOpen}
          titulo={borradoModalConfig.titulo}
          mensajeAdvertencia={borradoModalConfig.mensajeAdvertencia}
          detallesExtra={borradoModalConfig.detallesExtra}
          textoBotonConfirmar={borradoModalConfig.textoBoton}
          isProcessing={isBorradoProcessing}
          onConfirm={handleEjecutarBorradoSeguro}
          onClose={() => setBorradoModalConfig(null)}
        />
      )}

      {/* Render Custom Delete Confirmation Modal */}
      {deletingExpendio && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-red-400">
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Confirmar Eliminación</h3>
                <p className="text-xs text-slate-400">Eliminación de la base de datos</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-3 rounded-xl border border-slate-800">
              ¿Estás seguro de que deseas eliminar el expendio <strong className="text-amber-400">{deletingExpendio.localidad}</strong> (Encargado: {deletingExpendio.encargado})?
              <br /><br />
              Esta acción actualizará y eliminará el registro inmediatamente de la base de datos del sistema.
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingExpendio(null)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2 px-4 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={isDeleting}
                onClick={confirmDeleteExpendio}
                className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-xl text-xs flex items-center space-x-2 shadow-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                <span>{isDeleting ? 'Eliminando...' : 'Sí, Eliminar de Sheet'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Scanned Document & Payment Support Reconciliation Modal */}
      <ConciliacionCuentasAIModal
        isOpen={showAIConciliacionModal}
        onClose={() => setShowAIConciliacionModal(false)}
        expendiosList={expendios}
        onSuccessReconciliation={() => {
          fetchData();
          setSyncStatusMsg('✓ Cuentas de cobro conciliadas y marcadas en estado CANCELADO exitosamente.');
        }}
      />

      {/* Database Backup & Restore Modal */}
      <ErrorBoundary fallbackTitle="Panel de Copia de Seguridad" onClose={() => setShowCopiaSeguridadModal(false)}>
        <CopiaSeguridadModal
          isOpen={showCopiaSeguridadModal}
          initialTab={copiaSeguridadInitialTab}
          onClose={() => setShowCopiaSeguridadModal(false)}
          onSuccessRestore={() => {
            fetchData();
            setSyncStatusMsg('✓ Base de datos restaurada y sincronizada completamente.');
          }}
        />
      </ErrorBoundary>

      {/* Unified Delete Database Modal */}
      <EliminarBaseDatosModal
        isOpen={showEliminarBaseDatosModal}
        onClose={() => setShowEliminarBaseDatosModal(false)}
        expendiosCount={expendios.length}
        relacionPagosCount={relacionPagosData.length}
        historialCount={historial.length}
        onSuccessDelete={(msg) => {
          fetchData();
          setSyncStatusMsg(msg);
          setTimeout(() => setSyncStatusMsg(''), 7000);
        }}
      />

      {/* Lightbox Modal for Photo Inspection in Admin */}
      {previewPhotoModal && (
        <PhotoLightboxModal
          isOpen={!!previewPhotoModal}
          onClose={() => setPreviewPhotoModal(null)}
          imageUrl={previewPhotoModal.url}
          title={previewPhotoModal.title}
          subtitle={previewPhotoModal.subtitle}
          metadata={previewPhotoModal.metadata}
        />
      )}
    </div>
  );
};
