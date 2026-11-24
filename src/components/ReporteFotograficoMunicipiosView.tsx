import { AuthenticatedImage } from "./AuthenticatedImage";
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ExpendioData, StoredPhotoRecord } from '../types';
import { isRealPhoto } from '../utils/photoValidation';
import {
  Camera,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  Image as ImageIcon,
  Trash2,
  ShieldCheck,
  Search,
  Filter,
  RefreshCw,
  Eye,
  FileArchive,
  ChevronDown,
  ChevronUp,
  MapPin,
  User,
  Phone,
  Building,
  Check,
  Maximize2,
  Database,
  Cloud,
  HardDrive,
  ExternalLink,
  FolderOpen,
  X,
} from 'lucide-react';
import {
  generateReporteFotograficoPDF,
  generateReporteFotograficoSinglePDF,
  generateReporteFotograficoZip,
} from '../utils/pdfGenerator';
import { RegistroFotograficoCard } from './RegistroFotograficoCard';
import { PhotoLightboxModal } from './PhotoLightboxModal';
import { notifyReportSaved } from './EstadoConexion';
import { getAllStoredPhotos, updatePhotoRecord, PHOTO_DB_UPDATED_EVENT } from '../lib/photoStorageDB';
import { GoogleDrivePhotoBackupModule } from './GoogleDrivePhotoBackupModule';

interface ReporteFotograficoMunicipiosViewProps {
  expendios: ExpendioData[];
  isCleanAdmin?: boolean;
  onUpdateExpendio?: (updated: ExpendioData) => void;
  onRefreshExpendios?: () => void;
}

interface PhotoSlotDef {
  key: keyof ExpendioData;
  number: number;
  label: string;
  sublabel: string;
  category: string;
}

const PHOTO_SLOTS: PhotoSlotDef[] = [
  {
    key: 'fotoAvisoUrl',
    number: 1,
    label: '1. FOTO AVISO',
    sublabel: 'Aviso exterior oficial',
    category: 'Identificación',
  },
  {
    key: 'fotoPanoramicaUrl',
    number: 2,
    label: '2. FOTO PANORÁMICA',
    sublabel: 'Fachada completa y aviso 4-72 visible',
    category: 'Infraestructura',
  },
  {
    key: 'fotoMataselloUrl',
    number: 3,
    label: '3. FOTO MATASELLO',
    sublabel: 'Matasello postal de correspondencia',
    category: 'Operación',
  },
  {
    key: 'fotoBasculaUrl',
    number: 4,
    label: '4. FOTO BÁSCULA',
    sublabel: 'Báscula calibrada del punto',
    category: 'Equipamiento',
  },
  {
    key: 'fotoContratistaUrl',
    number: 5,
    label: '5. FOTO DEL CONTRATISTA',
    sublabel: 'Encargado responsable en el punto',
    category: 'Personal',
  },
  {
    key: 'fotoHorarioUrl',
    number: 6,
    label: '6. FOTO HORARIO',
    sublabel: 'Horario de atención visible al público',
    category: 'Servicio',
  },
  {
    key: 'fotoTarifasUrl',
    number: 7,
    label: '7. FOTO TARIFAS',
    sublabel: 'Tarifario oficial vigente publicado',
    category: 'Transparencia',
  },
];

export const ReporteFotograficoMunicipiosView: React.FC<ReporteFotograficoMunicipiosViewProps> = ({
  expendios,
  isCleanAdmin = false,
  onUpdateExpendio,
  onRefreshExpendios,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'COMPLETE' | 'INCOMPLETE'>('ALL');
  const [selectedMunicipioFilter, setSelectedMunicipioFilter] = useState<string>('TODOS');
  const [expandedMunMap, setExpandedMunMap] = useState<Record<string, boolean>>({});
  const [generandoPDF, setGenerandoPDF] = useState<boolean>(false);
  const [generandoZip, setGenerandoZip] = useState<boolean>(false);
  const [activeExpendioForCard, setActiveExpendioForCard] = useState<ExpendioData | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<{
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
  const [uploadingState, setUploadingState] = useState<Record<string, boolean>>({});
  const [failedPhotoSlots, setFailedPhotoSlots] = useState<Record<string, boolean>>({});

  // Estado de ubicaciones de almacenamiento (Firestore, AWS S3, Google Drive y Caché Local IndexedDB)
  const [storageLocationsMap, setStorageLocationsMap] = useState<
    Record<
      string,
      {
        cedula: string;
        firestoreCount: number;
        s3Count: number;
        driveCount: number;
        firestoreFolderUrl: string;
        s3FolderUrl: string;
        driveFolderUrl: string;
        slots: Record<
          string,
          {
            inFirestore: boolean;
            inS3: boolean;
            inDrive: boolean;
            driveWebViewLink?: string;
            firestoreUrl: string;
            s3Url: string;
          }
        >;
      }
    >
  >({});
  const [globalStorageLinks, setGlobalStorageLinks] = useState<{
    firestoreConsoleUrl: string;
    s3ConsoleUrl: string;
    googleDriveFolderUrl: string;
  }>({
    firestoreConsoleUrl:
      'https://console.firebase.google.com/project/gen-lang-client-0829904854/storage/gen-lang-client-0829904854.firebasestorage.app/files/~2Fphotos',
    s3ConsoleUrl:
      'https://s3.console.aws.amazon.com/s3/buckets/camarca-expendios-photos-contingency?region=us-east-1&prefix=photos/',
    googleDriveFolderUrl:
      'https://drive.google.com/drive/u/0/search?q=Fotos%20Expendios%204-72%20-%20CAMARCA%20SAS',
  });
  const [localCacheByCedula, setLocalCacheByCedula] = useState<
    Record<string, { totalCached: number; pendingServer: number; pendingDrive: number; slots: Record<string, StoredPhotoRecord> }>
  >({});
  const [syncingExpendioMap, setSyncingExpendioMap] = useState<Record<string, boolean>>({});
  const [syncExpendioFeedback, setSyncExpendioFeedback] = useState<Record<string, string>>({});

  const normalizeCed = (c?: string) => String(c || '').replace(/\D/g, '').trim();

  const fetchStorageLocationsAndCache = useCallback(async () => {
    try {
      const locRes = await fetch(`/api/photos/storage-locations?_t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => null);

      if (locRes?.success) {
        if (locRes.byCedula) setStorageLocationsMap(locRes.byCedula);
        if (locRes.globalLinks) setGlobalStorageLinks(locRes.globalLinks);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchStorageLocationsAndCache();
    let debounceTimer: any = null;
    const handleStorageUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchStorageLocationsAndCache();
      }, 600);
    };
    window.addEventListener('photoStorageUpdated', handleStorageUpdate);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('photoStorageUpdated', handleStorageUpdate);
    };
  }, [fetchStorageLocationsAndCache]);

  const handleSyncSingleExpendio = async (exp: ExpendioData) => {
    const cleanCed = normalizeCed(exp.cedula);
    const syncKey = exp.id || cleanCed;
    setSyncingExpendioMap((prev) => ({ ...prev, [syncKey]: true }));
    setSyncExpendioFeedback((prev) => ({ ...prev, [syncKey]: '' }));

    try {
      // 1. Si hay fotos en el caché local IndexedDB para esta cédula, subirlas al servidor híbrido (Firestore + S3)
      const localEntry = localCacheByCedula[cleanCed];
      if (localEntry && Object.keys(localEntry.slots).length > 0) {
        for (const rec of Object.values(localEntry.slots)) {
          if (rec.blob) {
            try {
              const formData = new FormData();
              formData.append('foto', rec.blob, `${cleanCed}_${rec.slotKey}.jpg`);
              const upRes = await fetch(
                `/api/photos/upload-hybrid/${encodeURIComponent(cleanCed)}/${encodeURIComponent(rec.slotKey)}`,
                { method: 'POST', body: formData }
              );
              if (upRes.ok && rec.id !== undefined) {
                await updatePhotoRecord(rec.id, {
                  serverSynced: true,
                  serverSyncedAt: new Date().toISOString(),
                  status: 'synced',
                });
              }
            } catch {}
          }
        }
      }

      // 2. Sincronizar en el servidor hacia Firestore + AWS S3 + Google Drive
      const res = await fetch('/api/photos/sync-expendio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cedula: cleanCed,
          expendioId: exp.id,
          municipio: exp.municipio || exp.localidad,
        }),
      });
      const data = await res.json();

      await fetchStorageLocationsAndCache();
      if (onRefreshExpendios) onRefreshExpendios();
      window.dispatchEvent(new CustomEvent('photoStorageUpdated'));

      setSyncExpendioFeedback((prev) => ({
        ...prev,
        [syncKey]:
          data?.message ||
          '✓ Fotografías sincronizadas en Firestore, AWS S3 y Google Drive.',
      }));
    } catch (err: any) {
      setSyncExpendioFeedback((prev) => ({
        ...prev,
        [syncKey]: `Aviso al sincronizar: ${err?.message || 'Error de red'}`,
      }));
    } finally {
      setSyncingExpendioMap((prev) => ({ ...prev, [syncKey]: false }));
    }
  };

  const handlePhotoLoadError = (expId: string, slotKey: string) => {
    const k = `${expId}-${slotKey}`;
    setFailedPhotoSlots((prev) => (prev[k] ? prev : { ...prev, [k]: true }));
  };

  const handlePhotoLoadSuccess = (expId: string, slotKey: string) => {
    const k = `${expId}-${slotKey}`;
    setFailedPhotoSlots((prev) => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  // Unique list of municipalities
  const uniqueMunicipios = useMemo(() => {
    const list = Array.from(new Set(expendios.map((e) => (e.municipio || e.localidad || 'Sin Municipio').trim())));
    return list.sort();
  }, [expendios]);

  // Helper to count verified, non-failing photos for an expendio
  const countPhotos = (exp: ExpendioData) => {
    let count = 0;
    const checkSlot = (slotKey: string, url?: string | null) => {
      if (!isRealPhoto(url)) return false;
      const k = `${exp.id}-${slotKey}`;
      if (failedPhotoSlots[k]) return false;
      return true;
    };

    if (checkSlot('fotoAvisoUrl', exp.fotoAvisoUrl || exp.letreroUrl)) count++;
    if (checkSlot('fotoPanoramicaUrl', exp.fotoPanoramicaUrl)) count++;
    if (checkSlot('fotoMataselloUrl', exp.fotoMataselloUrl || exp.mataselloUrl)) count++;
    if (checkSlot('fotoBasculaUrl', exp.fotoBasculaUrl || exp.basculaUrl)) count++;
    if (checkSlot('fotoContratistaUrl', exp.fotoContratistaUrl)) count++;
    if (checkSlot('fotoHorarioUrl', exp.fotoHorarioUrl)) count++;
    if (checkSlot('fotoTarifasUrl', exp.fotoTarifasUrl)) count++;
    return count;
  };

  // Group expendios by Municipality
  const groupedByMunicipio = useMemo(() => {
    const map: Record<string, ExpendioData[]> = {};
    expendios.forEach((exp) => {
      const mun = (exp.municipio || exp.localidad || 'Sin Municipio').trim();
      if (!map[mun]) map[mun] = [];
      map[mun].push(exp);
    });
    return map;
  }, [expendios]);

  const [munCurrentPage, setMunCurrentPage] = useState<number>(1);
  const [munPageSize, setMunPageSize] = useState<number>(10);

  // Filtered municipality list
  const filteredMunicipios = useMemo(() => {
    const allMuns = Object.keys(groupedByMunicipio).sort();
    return allMuns.filter((mun) => {
      // Municipality filter
      if (selectedMunicipioFilter !== 'TODOS' && mun.toLowerCase() !== selectedMunicipioFilter.toLowerCase()) {
        return false;
      }

      const items = groupedByMunicipio[mun];
      // Search term matching municipality, localidad or encargado
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchesMun = mun.toLowerCase().includes(term);
        const matchesItem = items.some(
          (i) =>
            (i.localidad || '').toLowerCase().includes(term) ||
            (i.encargado || '').toLowerCase().includes(term) ||
            (i.cedula || '').toLowerCase().includes(term) ||
            (i.direccionPunto || '').toLowerCase().includes(term)
        );
        if (!matchesMun && !matchesItem) return false;
      }

      // Status filter (Complete = 7/7 photos)
      if (filterStatus === 'COMPLETE') {
        const allComplete = items.every((i) => countPhotos(i) === 7);
        if (!allComplete) return false;
      } else if (filterStatus === 'INCOMPLETE') {
        const hasIncomplete = items.some((i) => countPhotos(i) < 7);
        if (!hasIncomplete) return false;
      }

      return true;
    });
  }, [groupedByMunicipio, selectedMunicipioFilter, searchTerm, filterStatus]);

  useEffect(() => {
    setMunCurrentPage(1);
  }, [selectedMunicipioFilter, searchTerm, filterStatus]);

  const totalMunPages = useMemo(() => {
    if (munPageSize <= 0) return 1;
    return Math.max(1, Math.ceil(filteredMunicipios.length / munPageSize));
  }, [filteredMunicipios.length, munPageSize]);

  const paginatedMunicipios = useMemo(() => {
    if (munPageSize <= 0) return filteredMunicipios;
    const safePage = Math.min(Math.max(1, munCurrentPage), totalMunPages);
    const startIdx = (safePage - 1) * munPageSize;
    return filteredMunicipios.slice(startIdx, startIdx + munPageSize);
  }, [filteredMunicipios, munCurrentPage, munPageSize, totalMunPages]);

  const getThumbnailUrl = (url?: string | null) => {
    if (!url) return '';
    if (url.startsWith('/api/photos/')) {
      return url.includes('?') ? `${url}&thumb=1` : `${url}?thumb=1`;
    }
    return url;
  };

  // Overall Statistics
  const stats = useMemo(() => {
    const totalExpendios = expendios.length;
    let totalPhotosRegistered = 0;
    let completeExpendios = 0;

    expendios.forEach((exp) => {
      const c = countPhotos(exp);
      totalPhotosRegistered += c;
      if (c === 7) completeExpendios++;
    });

    const maxPhotos = totalExpendios * 7;
    const globalPercent = maxPhotos > 0 ? Math.round((totalPhotosRegistered / maxPhotos) * 100) : 0;

    return {
      totalExpendios,
      totalMunicipios: Object.keys(groupedByMunicipio).length,
      totalPhotosRegistered,
      maxPhotos,
      completeExpendios,
      incompleteExpendios: totalExpendios - completeExpendios,
      globalPercent,
    };
  }, [expendios, groupedByMunicipio]);

  const toggleExpandMun = (mun: string) => {
    setExpandedMunMap((prev) => {
      const currentlyOpen = isMunExpanded(mun);
      return {
        ...prev,
        [mun]: !currentlyOpen,
      };
    });
  };

  const isMunExpanded = (mun: string) => {
    if (expandedMunMap[mun] !== undefined) {
      return expandedMunMap[mun];
    }
    // Si el usuario filtró un municipio específico o buscó por texto, expandir automáticamente
    if (selectedMunicipioFilter !== 'TODOS' || searchTerm.trim().length > 0) {
      return true;
    }
    // Por defecto expandir solo los primeros 2 municipios para evitar cargar 350+ fotos simultáneamente en RAM
    const idx = filteredMunicipios.indexOf(mun);
    return idx >= 0 && idx < 2;
  };

  // Upload handler for a specific slot directly from the card
  const handleDirectUpload = async (exp: ExpendioData, slotKey: keyof ExpendioData, file: File) => {
    const uploadId = `${exp.id}-${String(slotKey)}`;
    setUploadingState((prev) => ({ ...prev, [uploadId]: true }));

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64Data = reader.result as string;
      try {
        const payload: Record<string, string> = { [slotKey]: base64Data };
        if (slotKey === 'fotoAvisoUrl') payload.letreroUrl = base64Data;
        if (slotKey === 'fotoBasculaUrl') payload.basculaUrl = base64Data;
        if (slotKey === 'fotoMataselloUrl') payload.mataselloUrl = base64Data;

        const targetId = exp.id || exp.cedula || exp.localidad;
        const res = await fetch(`/api/admin/expendios/${encodeURIComponent(targetId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.success && onUpdateExpendio) {
          onUpdateExpendio(data.data);
          if (onRefreshExpendios) onRefreshExpendios();
          fetchStorageLocationsAndCache();
          window.dispatchEvent(new CustomEvent('photoStorageUpdated'));
        }
      } catch (err) {
        console.error('Error cargando foto:', err);
      } finally {
        setUploadingState((prev) => ({ ...prev, [uploadId]: false }));
      }
    };
    reader.readAsDataURL(file);
  };

  // Delete handler for a specific photo slot
  const handleDirectDelete = async (exp: ExpendioData, slotKey: keyof ExpendioData) => {
    const uploadId = `${exp.id}-${String(slotKey)}`;
    setUploadingState((prev) => ({ ...prev, [uploadId]: true }));

    try {
      const payload: Record<string, string> = { [slotKey]: '' };
      if (slotKey === 'fotoAvisoUrl') payload.letreroUrl = '';
      if (slotKey === 'fotoBasculaUrl') payload.basculaUrl = '';
      if (slotKey === 'fotoMataselloUrl') payload.mataselloUrl = '';

      const targetId = exp.id || exp.cedula || exp.localidad;
      const res = await fetch(`/api/admin/expendios/${encodeURIComponent(targetId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success && onUpdateExpendio) {
        onUpdateExpendio(data.data);
        if (onRefreshExpendios) onRefreshExpendios();
      }
    } catch (err) {
      console.error('Error eliminando foto:', err);
    } finally {
      setUploadingState((prev) => ({ ...prev, [uploadId]: false }));
    }
  };

  // Download All Consolidated PDF
  const handleDownloadConsolidatedPDF = async () => {
    setGenerandoPDF(true);
    try {
      await generateReporteFotograficoPDF(expendios, {
        municipioFilter: selectedMunicipioFilter !== 'TODOS' ? selectedMunicipioFilter : undefined,
      });
      notifyReportSaved(
        `Reporte Fotográfico Consolidado ${selectedMunicipioFilter !== 'TODOS' ? `(${selectedMunicipioFilter})` : `(7 Fotos)`}`,
        'fotos',
        'Documento consolidado generado y respaldado en la nube'
      );
    } catch (e) {
      console.error('Error generando PDF consolidado:', e);
      alert('Hubo un error al generar el PDF consolidado. Por favor intenta de nuevo.');
    } finally {
      setGenerandoPDF(false);
    }
  };

  // Download All as ZIP
  const handleDownloadZip = async () => {
    setGenerandoZip(true);
    try {
      const listToZip =
        selectedMunicipioFilter !== 'TODOS'
          ? expendios.filter(
              (e) => (e.municipio || '').toUpperCase() === selectedMunicipioFilter.toUpperCase()
            )
          : expendios;
      await generateReporteFotograficoZip(listToZip);
      notifyReportSaved(
        `ZIP Reportes Fotográficos Municipales (${listToZip.length} Municipios)`,
        'fotos',
        'Paquete comprimido generado exitosamente'
      );
    } catch (e) {
      console.error('Error generando ZIP fotográfico:', e);
      alert('Hubo un error al generar el ZIP de reportes fotográficos.');
    } finally {
      setGenerandoZip(false);
    }
  };

  // Download Single Municipality / Expendio PDF
  const handleDownloadSinglePDF = async (exp: ExpendioData) => {
    try {
      await generateReporteFotograficoSinglePDF(exp);
    } catch (e) {
      console.error('Error generando PDF individual:', e);
      alert(`Error al generar el PDF de ${exp.municipio || exp.localidad}.`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Statistics Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs uppercase tracking-wider mb-1">
              <Camera className="w-4 h-4" />
              <span>Control y Reportes Fotográficos Oficiales (7 Evidencias Obligatorias)</span>
            </div>
            <h2 className="text-2xl font-black text-slate-100">
              Reporte Fotográfico Agrupado por Municipio
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Supervisión de las 7 fotografías oficiales requeridas por punto de expendio postal:
              <strong className="text-slate-200"> 1. Aviso, 2. Panorámica (Fachada 4-72), 3. Matasello, 4. Báscula, 5. Contratista, 6. Horario y 7. Tarifas</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleDownloadConsolidatedPDF}
              disabled={generandoPDF || expendios.length === 0}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-2.5 px-4 rounded-xl shadow-lg text-xs flex items-center space-x-2 cursor-pointer transition-all"
              title="Descargar documento PDF con todas las 7 fotos por municipio"
            >
              <Download className="w-4 h-4" />
              <span>
                {generandoPDF ? 'Generando PDF con 7 Fotos...' : 'Descargar PDF Consolidado (7 Fotos)'}
              </span>
            </button>

            <button
              onClick={handleDownloadZip}
              disabled={generandoZip || expendios.length === 0}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 font-bold py-2.5 px-4 rounded-xl shadow text-xs flex items-center space-x-2 cursor-pointer transition-all"
              title="Descargar archivo ZIP con un PDF individual por cada municipio"
            >
              <FileArchive className="w-4 h-4 text-emerald-400" />
              <span>{generandoZip ? 'Comprimiendo ZIP...' : 'Descargar ZIP por Municipios'}</span>
            </button>
          </div>
        </div>

        {/* 4 KPI Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div className="text-[11px] text-slate-400 font-semibold uppercase">Total Municipios</div>
            <div className="text-xl font-black text-slate-100 mt-0.5">{stats.totalMunicipios}</div>
            <div className="text-[10px] text-slate-500">{stats.totalExpendios} puntos de expendio</div>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div className="text-[11px] text-slate-400 font-semibold uppercase">Fotos Registradas</div>
            <div className="text-xl font-black text-amber-400 mt-0.5">
              {stats.totalPhotosRegistered}{' '}
              <span className="text-xs text-slate-500 font-normal">/ {stats.maxPhotos}</span>
            </div>
            <div className="text-[10px] text-amber-500/90 font-medium">
              {stats.globalPercent}% cumplimiento global
            </div>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div className="text-[11px] text-emerald-400 font-semibold uppercase">Puntos 100% Completos</div>
            <div className="text-xl font-black text-emerald-400 mt-0.5">{stats.completeExpendios}</div>
            <div className="text-[10px] text-emerald-500/80">Con las 7 fotos al día</div>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div className="text-[11px] text-rose-400 font-semibold uppercase">Puntos Incompletos</div>
            <div className="text-xl font-black text-rose-400 mt-0.5">{stats.incompleteExpendios}</div>
            <div className="text-[10px] text-rose-500/80">Con fotos pendientes</div>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2 text-slate-200 font-bold">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Avance de Evidencias Fotográficas Oficiales:</span>
              <span className="text-amber-400 font-extrabold">{stats.globalPercent}%</span>
            </div>
            <span className="text-[11px] text-slate-400">
              {stats.totalPhotosRegistered} de {stats.maxPhotos} fotos verificadas
            </span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
            <div
              className={`h-full transition-all duration-700 ${
                stats.globalPercent === 100
                  ? 'bg-emerald-500'
                  : stats.globalPercent >= 60
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
              style={{ width: `${stats.globalPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por municipio, contratista, cédula o localidad..."
            className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Municipio Selector */}
          <div className="flex items-center space-x-2">
            <label className="text-xs font-semibold text-slate-400 whitespace-nowrap">Municipio:</label>
            <select
              value={selectedMunicipioFilter}
              onChange={(e) => setSelectedMunicipioFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium cursor-pointer"
            >
              <option value="TODOS">Todos los Municipios ({uniqueMunicipios.length})</option>
              {uniqueMunicipios.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center space-x-2">
            <label className="text-xs font-semibold text-slate-400 whitespace-nowrap">Cumplimiento:</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium cursor-pointer"
            >
              <option value="ALL">Todos los Estados</option>
              <option value="COMPLETE">Completos (7/7 Fotos ✓)</option>
              <option value="INCOMPLETE">Incompletos (&lt; 7 Fotos ✗)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Pagination & View Controls for Municipalities */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Mostrando <strong className="text-amber-400 font-mono">{paginatedMunicipios.length}</strong> de{' '}
            <strong className="text-slate-200 font-mono">{filteredMunicipios.length}</strong> municipios filtrados
          </span>
          <div className="flex items-center space-x-1.5">
            <span className="text-[11px]">Municipios por página:</span>
            <select
              value={munPageSize}
              onChange={(e) => {
                setMunPageSize(Number(e.target.value));
                setMunCurrentPage(1);
              }}
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
            >
              <option value={10}>10 (Óptimo RAM)</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={0}>Todos ({filteredMunicipios.length})</option>
            </select>
          </div>
        </div>

        {munPageSize > 0 && totalMunPages > 1 && (
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setMunCurrentPage((p) => Math.max(1, p - 1))}
              disabled={munCurrentPage <= 1}
              className="px-3 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-40 text-slate-200 border border-slate-700 font-bold cursor-pointer transition-colors"
            >
              ‹ Anterior
            </button>
            <span className="font-mono text-slate-300">
              Pág. <strong className="text-amber-400">{munCurrentPage}</strong> / {totalMunPages}
            </span>
            <button
              type="button"
              onClick={() => setMunCurrentPage((p) => Math.min(totalMunPages, p + 1))}
              disabled={munCurrentPage >= totalMunPages}
              className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 text-amber-300 border border-amber-500/40 font-bold cursor-pointer transition-colors"
            >
              Siguiente ›
            </button>
          </div>
        )}
      </div>

      {/* Grouped List by Municipality */}
      <div className="space-y-6">
        {paginatedMunicipios.length > 0 ? (
          paginatedMunicipios.map((munName) => {
            const expList = groupedByMunicipio[munName] || [];
            const isExpanded = isMunExpanded(munName);

            // Compute summary for this municipality
            let munPhotos = 0;
            const maxMunPhotos = expList.length * 7;
            expList.forEach((e) => {
              munPhotos += countPhotos(e);
            });
            const munPercent = maxMunPhotos > 0 ? Math.round((munPhotos / maxMunPhotos) * 100) : 0;
            const isMunComplete = munPercent === 100;

            return (
              <div
                key={munName}
                className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all"
              >
                {/* Municipality Header Bar */}
                <div className="p-4 sm:p-5 bg-slate-950 border-b border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => toggleExpandMun(munName)}
                      className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                      title={isExpanded ? 'Colapsar municipio' : 'Expandir municipio'}
                    >
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>

                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-amber-400 uppercase tracking-widest flex items-center space-x-1">
                          <MapPin className="w-3.5 h-3.5" />
                          <span>MUNICIPIO:</span>
                        </span>
                        <h3 className="text-xl font-black text-slate-100 uppercase tracking-tight">
                          {munName}
                        </h3>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            isMunComplete
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                              : 'bg-amber-950/80 text-amber-300 border-amber-800'
                          }`}
                        >
                          {munPhotos}/{maxMunPhotos} Fotos ({munPercent}%)
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 mt-1">
                        <span>
                          {expList.length} punto(s) de atención postal registrado(s) en este municipio
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Municipality Quick Actions */}
                  <div className="flex flex-wrap items-center gap-2 self-end md:self-auto">
                    {!isCleanAdmin && (
                      <>
                        <a
                          href={globalStorageLinks.firestoreConsoleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold px-2.5 py-1.5 rounded-xl text-[11px] flex items-center space-x-1 transition-colors"
                          title="Abrir carpeta general de fotos en Firestore / Firebase Storage"
                        >
                          <Database className="w-3 h-3" />
                          <span>Firestore</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        <a
                          href={globalStorageLinks.s3ConsoleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold px-2.5 py-1.5 rounded-xl text-[11px] flex items-center space-x-1 transition-colors"
                          title="Abrir bucket de fotos en AWS S3"
                        >
                          <HardDrive className="w-3 h-3" />
                          <span>AWS S3</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        <a
                          href={`https://drive.google.com/drive/u/0/search?q=${encodeURIComponent(`Fotos Expendios 4-72 - CAMARCA SAS ${munName}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold px-2.5 py-1.5 rounded-xl text-[11px] flex items-center space-x-1 transition-colors"
                          title={`Abrir carpeta de ${munName} en Google Drive`}
                        >
                          <Cloud className="w-3 h-3" />
                          <span>Drive ({munName})</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (expList.length === 1) {
                          handleDownloadSinglePDF(expList[0]);
                        } else {
                          generateReporteFotograficoPDF(expList, { municipioFilter: munName });
                        }
                      }}
                      className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
                      title={`Descargar reporte fotográfico de ${munName} con las 7 fotos`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Descargar PDF ({munName})</span>
                    </button>
                  </div>
                </div>

                {/* Collapsible Content: Each Expendio inside this Municipality */}
                {isExpanded && (
                  <div className="p-4 sm:p-6 space-y-6 bg-slate-900/60 divide-y divide-slate-800/80">
                    {expList.map((exp) => {
                      const uploadedForThis = countPhotos(exp);
                      const percentThis = Math.round((uploadedForThis / 7) * 100);
                      const cleanCed = normalizeCed(exp.cedula);
                      const syncKey = exp.id || cleanCed;
                      const isSyncingThis = Boolean(syncingExpendioMap[syncKey]);
                      const feedbackThis = syncExpendioFeedback[syncKey];

                      const storageInfo = storageLocationsMap[cleanCed];
                      const cacheInfo = localCacheByCedula[cleanCed];

                      const firestoreCount = Math.max(storageInfo?.firestoreCount || 0, uploadedForThis);
                      const s3Count = Math.max(storageInfo?.s3Count || 0, uploadedForThis);
                      const driveCount = storageInfo?.driveCount || 0;
                      const cachedCount = cacheInfo?.totalCached || 0;
                      const pendingCacheCount = cacheInfo?.pendingServer || 0;

                      const firestoreFolderLink =
                        storageInfo?.firestoreFolderUrl ||
                        `https://console.firebase.google.com/project/gen-lang-client-0829904854/storage/gen-lang-client-0829904854.firebasestorage.app/files/~2Fphotos~2F${encodeURIComponent(cleanCed)}`;
                      const s3FolderLink =
                        storageInfo?.s3FolderUrl ||
                        `https://s3.console.aws.amazon.com/s3/buckets/camarca-expendios-photos-contingency?region=us-east-1&prefix=photos/${encodeURIComponent(cleanCed)}_`;
                      const driveFolderLink =
                        storageInfo?.driveFolderUrl ||
                        `https://drive.google.com/drive/u/0/search?q=${encodeURIComponent(`Fotos Expendios 4-72 - CAMARCA SAS ${exp.municipio || exp.localidad}`)}`;

                      return (
                        <div key={exp.id} className="pt-6 first:pt-0 space-y-4">
                          {/* Expendio Contractor Metadata Strip + Storage Locations & Folder Links */}
                          <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 space-y-3">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-black text-slate-200">
                                    {exp.localidad.toUpperCase()}
                                  </span>
                                  <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-2 py-0.5 rounded">
                                    SIPOST: {exp.usuarioSipost || 'N/A'}
                                  </span>
                                  <span
                                    className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                                      uploadedForThis === 7
                                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                        : 'bg-amber-950 text-amber-300 border border-amber-800'
                                    }`}
                                  >
                                    {uploadedForThis}/7 fotos ({percentThis}%)
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-slate-400">
                                  <div className="flex items-center space-x-1 truncate">
                                    <User className="w-3 h-3 text-slate-500" />
                                    <span>
                                      Encargado: <strong className="text-slate-200">{exp.encargado}</strong> (C.C. {exp.cedula})
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-1 truncate">
                                    <MapPin className="w-3 h-3 text-slate-500" />
                                    <span>Dir: {exp.direccionPunto || 'Sede Principal'}</span>
                                  </div>
                                  <div className="flex items-center space-x-1 truncate">
                                    <Phone className="w-3 h-3 text-slate-500" />
                                    <span>Tel: {exp.telefonoPunto || 'No registrado'}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {!isCleanAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => handleSyncSingleExpendio(exp)}
                                    disabled={isSyncingThis}
                                    className="bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                    title="Sincronizar fotos de este expendio en Firestore, AWS S3 y Google Drive"
                                  >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingThis ? 'animate-spin' : ''}`} />
                                    <span>
                                      {isSyncingThis
                                        ? 'Sincronizando...'
                                        : pendingCacheCount > 0 || driveCount < uploadedForThis
                                        ? 'Sincronizar (Caché / Nube)'
                                        : 'Sincronizar Backup'}
                                    </span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => setActiveExpendioForCard(exp)}
                                  className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
                                  title="Ver Ficha Oficial Imprimible y Editor Avanzado"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Ver Ficha Oficial</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDownloadSinglePDF(exp)}
                                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer shadow"
                                  title="Descargar PDF de 7 fotos para este expendio"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>PDF 7 Fotos</span>
                                </button>
                              </div>
                            </div>

                            {/* Barra de Ubicación de Almacenamiento y Enlaces Directos a Carpetas (Firestore, AWS S3, Google Drive y Caché) */}
                            {!isCleanAdmin && (
                              <div className="pt-2.5 border-t border-slate-800/90 flex flex-col xl:flex-row xl:items-center justify-between gap-2.5 text-[11px]">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] flex items-center space-x-1">
                                    <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                                    <span>Almacenado en:</span>
                                  </span>

                                  {/* 1. Firestore / Firebase Storage */}
                                  <a
                                    href={firestoreFolderLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-amber-950/60 hover:bg-amber-900/70 text-amber-300 border border-amber-700/60 font-semibold transition-colors"
                                    title="Abrir carpeta directa en Firestore / Firebase Storage"
                                  >
                                    <Database className="w-3 h-3 text-amber-400" />
                                    <span>Firestore ({firestoreCount}/{uploadedForThis})</span>
                                    <span className="text-[10px] underline ml-0.5">Ver carpeta</span>
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>

                                  {/* 2. AWS S3 */}
                                  <a
                                    href={s3FolderLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-700/60 font-semibold transition-colors"
                                    title="Abrir carpeta directa en AWS S3 Bucket"
                                  >
                                    <HardDrive className="w-3 h-3 text-emerald-400" />
                                    <span>AWS S3 ({s3Count}/{uploadedForThis})</span>
                                    <span className="text-[10px] underline ml-0.5">Ver carpeta</span>
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>

                                  {/* 3. Google Drive */}
                                  <a
                                    href={driveFolderLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg font-semibold transition-colors border ${
                                      driveCount >= uploadedForThis && uploadedForThis > 0
                                        ? 'bg-sky-950/60 hover:bg-sky-900/70 text-sky-300 border-sky-700/60'
                                        : 'bg-slate-900 hover:bg-slate-800 text-sky-300/90 border-slate-700'
                                    }`}
                                    title="Abrir carpeta del municipio en Google Drive"
                                  >
                                    <Cloud className="w-3 h-3 text-sky-400" />
                                    <span>
                                      Google Drive ({driveCount}/{uploadedForThis}{' '}
                                      {driveCount >= uploadedForThis && uploadedForThis > 0 ? 'Sincronizado' : 'Pendiente'})
                                    </span>
                                    <span className="text-[10px] underline ml-0.5">Ver carpeta</span>
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>

                                  {/* 4. Indicador de Caché Local IndexedDB */}
                                  <span
                                    className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg font-semibold border ${
                                      pendingCacheCount > 0
                                        ? 'bg-amber-950/80 text-amber-300 border-amber-700'
                                        : 'bg-slate-900/90 text-slate-400 border-slate-800'
                                    }`}
                                    title="Estado de almacenamiento en la caché local del navegador (IndexedDB)"
                                  >
                                    <span>
                                      Caché Navegador:{' '}
                                      {pendingCacheCount > 0
                                        ? `${pendingCacheCount} pendiente(s) de sincronizar`
                                        : cachedCount > 0
                                        ? `${cachedCount} en caché (Sincronizadas)`
                                        : '0 retenidas (Todo en Servidor)'}
                                    </span>
                                  </span>
                                </div>

                                {feedbackThis && (
                                  <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2.5 py-1 rounded-lg">
                                    {feedbackThis}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* 7 Interactive Photo Slots Gallery */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                            {PHOTO_SLOTS.map((slot) => {
                              let rawUrl = (exp as any)[slot.key];
                              // backward compatibility
                              if (!rawUrl && slot.key === 'fotoAvisoUrl') rawUrl = exp.letreroUrl;
                              if (!rawUrl && slot.key === 'fotoBasculaUrl') rawUrl = exp.basculaUrl;
                              if (!rawUrl && slot.key === 'fotoMataselloUrl') rawUrl = exp.mataselloUrl;

                              const uploadId = `${exp.id}-${String(slot.key)}`;
                              const isUploading = uploadingState[uploadId];
                              const isFailed = failedPhotoSlots[uploadId];
                              const currentUrl = isRealPhoto(rawUrl) && !isFailed ? rawUrl : null;
                              const slotStorage = storageInfo?.slots?.[String(slot.key)];
                              const slotCache = cacheInfo?.slots?.[String(slot.key)];

                              return (
                                <div
                                  key={slot.key}
                                  className={`bg-slate-950 rounded-xl border p-2.5 flex flex-col justify-between transition-all ${
                                    currentUrl
                                      ? 'border-emerald-800/80 bg-slate-950/90'
                                      : 'border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="text-[10px] font-black text-amber-400 uppercase tracking-tight truncate">
                                        {slot.label}
                                      </span>
                                      {currentUrl ? (
                                        <span className="text-[8px] bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded font-bold border border-emerald-800">
                                          ✓
                                        </span>
                                      ) : (
                                        <span className="text-[8px] bg-rose-950 text-rose-300 px-1.5 py-0.5 rounded font-bold border border-rose-800">
                                          ✗
                                        </span>
                                      )}
                                    </div>

                                    {/* Thumbnail Preview with Click to Zoom */}
                                    <div className="relative aspect-4/3 w-full bg-slate-900 rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center group">
                                      {isRealPhoto(rawUrl) && !isFailed ? (
                                        <>
                                          <AuthenticatedImage
                                            src={getThumbnailUrl(rawUrl)}
                                            alt={slot.label}
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                            crossOrigin="anonymous"
                                            onError={() => handlePhotoLoadError(exp.id, String(slot.key))}
                                            onLoad={() => handlePhotoLoadSuccess(exp.id, String(slot.key))}
                                          />
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setPreviewImageUrl({
                                                url: currentUrl,
                                                title: `${slot.label} - ${exp.municipio}`,
                                                subtitle: `${exp.localidad} | Encargado: ${exp.encargado}`,
                                                metadata: {
                                                  encargado: exp.encargado,
                                                  cedula: exp.cedula,
                                                  municipio: exp.municipio,
                                                  direccion: exp.direccionPunto,
                                                  telefono: exp.telefonoPunto,
                                                }
                                              })
                                            }
                                            className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity cursor-pointer"
                                            title="Ver foto en tamaño completo e inspeccionar"
                                          >
                                            <Maximize2 className="w-5 h-5 text-amber-400" />
                                          </button>
                                        </>
                                      ) : (
                                        <div className="flex flex-col items-center justify-center p-2 text-center text-slate-600">
                                          <ImageIcon className="w-6 h-6 mb-1 text-slate-700" />
                                          <span className="text-[9px] text-slate-500 font-medium leading-tight">
                                            Sin cargar
                                          </span>
                                        </div>
                                      )}

                                      {isUploading && (
                                        <div className="absolute inset-0 bg-black/80 flex items-center justify-center text-[10px] font-bold text-amber-400">
                                          <RefreshCw className="w-4 h-4 animate-spin mr-1" />
                                          Subiendo...
                                        </div>
                                      )}
                                    </div>

                                    <div className="text-[9px] text-slate-400 mt-1.5 truncate" title={slot.sublabel}>
                                      {slot.sublabel}
                                    </div>

                                    {/* Mini etiquetas de ubicación por cada foto */}
                                    {!isCleanAdmin && currentUrl && (
                                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                        <a
                                          href={slotStorage?.firestoreUrl || firestoreFolderLink}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-[8px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/70 font-bold hover:underline"
                                          title="Almacenada en Firestore / Firebase Storage (clic para abrir carpeta)"
                                        >
                                          Firestore ✓
                                        </a>
                                        <a
                                          href={slotStorage?.s3Url || s3FolderLink}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/70 font-bold hover:underline"
                                          title="Almacenada en AWS S3 (clic para abrir objeto/carpeta)"
                                        >
                                          S3 ✓
                                        </a>
                                        <a
                                          href={slotStorage?.driveWebViewLink || driveFolderLink}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`text-[8px] px-1.5 py-0.5 rounded font-bold border hover:underline ${
                                            slotStorage?.inDrive
                                              ? 'bg-sky-950/80 text-sky-300 border-sky-800/70'
                                              : 'bg-slate-900 text-slate-400 border-slate-700'
                                          }`}
                                          title={
                                            slotStorage?.inDrive
                                              ? 'Respaldada en Google Drive (clic para abrir)'
                                              : 'Pendiente de sincronizar en Google Drive'
                                          }
                                        >
                                          {slotStorage?.inDrive ? 'Drive ✓' : 'Drive ⏳'}
                                        </a>
                                        {slotCache && !slotCache.serverSynced && slotCache.status !== 'synced' && (
                                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                                            Caché
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {/* Direct Actions: Upload / Remove */}
                                  <div className="mt-2.5 flex items-center space-x-1.5">
                                    <label className="flex-1 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 font-bold text-[10px] py-1 px-1.5 rounded-lg border border-slate-700 flex items-center justify-center space-x-1 cursor-pointer transition-colors">
                                      <Upload className="w-3 h-3 text-amber-400" />
                                      <span>{currentUrl ? 'Cambiar' : 'Subir'}</span>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f) handleDirectUpload(exp, slot.key, f);
                                        }}
                                        className="hidden"
                                      />
                                    </label>

                                    {currentUrl && (
                                      <button
                                        type="button"
                                        onClick={() => handleDirectDelete(exp, slot.key)}
                                        className="p-1 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-lg transition-colors cursor-pointer"
                                        title="Eliminar foto"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-slate-600 mx-auto" />
            <h4 className="text-base font-bold text-slate-300">
              No se encontraron municipios ni expendios con los filtros seleccionados
            </h4>
            <p className="text-xs text-slate-500">
              Prueba cambiando el término de búsqueda o restableciendo los filtros de municipio y cumplimiento.
            </p>
          </div>
        )}
      </div>

      {/* Modal / Advanced Sheet View for a Single Selected Expendio */}
      {activeExpendioForCard && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-5xl w-full p-6 shadow-2xl space-y-5 my-8 animate-fadeIn max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-amber-400 font-bold text-base">
                <Camera className="w-5 h-5" />
                <span>
                  Ficha Fotográfica Oficial: {activeExpendioForCard.localidad} ({activeExpendioForCard.municipio})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveExpendioForCard(null)}
                className="text-slate-400 hover:text-slate-200 transition-colors p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <RegistroFotograficoCard
              expendio={activeExpendioForCard}
              onUpdatePhotos={(updated) => {
                if (onUpdateExpendio) onUpdateExpendio(updated);
                setActiveExpendioForCard(updated);
              }}
            />
          </div>
        </div>
      )}

      {/* Lightbox Modal for Photo Preview */}
      {previewImageUrl && (
        <PhotoLightboxModal
          isOpen={!!previewImageUrl}
          onClose={() => setPreviewImageUrl(null)}
          imageUrl={previewImageUrl.url}
          title={previewImageUrl.title}
          subtitle={previewImageUrl.subtitle}
          metadata={previewImageUrl.metadata}
        />
      )}
    </div>
  );
};
