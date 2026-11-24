import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ExpendioData,
  UserSession,
  CuentaCobroResult,
  SystemConfig,
  CuentaCargadaExpendio,
  ThemeMode,
  OfflinePhotoItem,
} from '../types';
import { CuentaCobroDocument } from './CuentaCobroDocument';
import { ScannerCameraModal } from './ScannerCameraModal';
import { CameraGpsCaptureModal } from './CameraGpsCaptureModal';
import { getCurrentGpsLocation, stampPhotoWithWatermarkAndGps, GeoCoordinates } from '../utils/photoWatermarkGps';
import { formatPesos, formatCuentaBancaria } from '../utils/formatters';
import { isRealPhoto } from '../utils/photoValidation';
import { isPhotoConsistentWithExpendio } from '../lib/photoCacheHandler';
import { getAccessToken } from '../lib/googleAuth';
import { uploadPhotoToGoogleDrive } from '../lib/googleDriveService';
import {
  savePhotoToIndexedDB,
  getStoredPhotosByCedula,
  updatePhotoRecord,
  purgeCacheAndRedownloadPhotoFromServer,
} from '../lib/photoStorageDB';
import { reportPlatformError } from '../utils/errorLogger';
import { StoredPhotoRecord } from '../types';
import {
  addPhotoToOfflineQueue,
  getOfflinePhotoQueue,
  syncOfflinePhotos,
  clearSyncedPhotosFromQueue,
} from '../utils/offlinePhotoQueue';
import {
  Store,
  User,
  Phone,
  MapPin,
  Mail,
  Camera,
  FileText,
  Upload,
  CheckCircle2,
  AlertCircle,
  Download,
  Building2,
  ShieldCheck,
  RefreshCw,
  Printer,
  Calendar,
  Sparkles,
  Lock,
  Eye,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Hash,
  Clock,
  ArrowRight,
  ExternalLink,
  HelpCircle,
  FileX2,
  UserCheck,
  X,
} from 'lucide-react';

import { ExpendioHeaderCard } from './ExpendioHeaderCard';
import { ExpendioStepProgress } from './ExpendioStepProgress';
import { ExpendioDataUpdateModule } from './ExpendioDataUpdateModule';
import { ExpendioPhotosGrid } from './ExpendioPhotosGrid';
import { ExpendioAccountsModule } from './ExpendioAccountsModule';
import { ExpendioDocumentosDownloadModule } from './ExpendioDocumentosDownloadModule';
import { ExpendioFirstLoginModal } from './ExpendioFirstLoginModal';
import { ExpendioBienvenidaCapacitacionModal } from './ExpendioBienvenidaCapacitacionModal';
import { PhotoLightboxModal } from './PhotoLightboxModal';

interface ExpendioPanelProps {
  session: UserSession;
  onUpdateSessionData: (updatedExpendio: ExpendioData) => void;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
}

// Default empty expendio object to maintain stable reference across renders
const EMPTY_EXPENDIO: ExpendioData = {} as ExpendioData;

export const ExpendioPanel: React.FC<ExpendioPanelProps> = ({
  session,
  onUpdateSessionData,
  theme = 'light',
  onToggleTheme,
}) => {
  const expendio = session.expendioData || EMPTY_EXPENDIO;
  const isLight = theme === 'light';

  // System Configuration (Periodo Habilitado de Descarga por el Administrador)
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);

  // Periodo seleccionado para consulta de cuentas de cobro (Default al mes activo del admin)
  const [mesPeriodo, setMesPeriodo] = useState<string>('FEBRERO');
  const [anioPeriodo, setAnioPeriodo] = useState<string>('2026');

  // Estado de cuenta de cobro encontrada en el sistema para el periodo
  const [checkingCuenta, setCheckingCuenta] = useState<boolean>(false);
  const [cuentaGenerada, setCuentaGenerada] = useState<{
    checked: boolean;
    generada: boolean;
    data?: CuentaCobroResult;
    message?: string;
  }>({ checked: false, generada: false });

  // Verification flags for 3-Step sequential workflow
  const isDatosActualizados = Boolean(expendio?.primeraVezActualizado);

  // Calculate loaded photos count out of 7 mandatory slots
  const safeInitUrl = (url?: string) => {
    if (!url || !isRealPhoto(url)) return '';
    if (!isPhotoConsistentWithExpendio(url, expendio)) return '';
    return url;
  };

  const [localPhotos, setLocalPhotos] = useState<Record<string, string>>(() => ({
    fotoAvisoUrl: safeInitUrl(expendio?.fotoAvisoUrl || expendio?.letreroUrl),
    fotoPanoramicaUrl: safeInitUrl(expendio?.fotoPanoramicaUrl),
    fotoMataselloUrl: safeInitUrl(expendio?.fotoMataselloUrl || expendio?.mataselloUrl),
    fotoBasculaUrl: safeInitUrl(expendio?.fotoBasculaUrl || expendio?.basculaUrl),
    fotoContratistaUrl: safeInitUrl(expendio?.fotoContratistaUrl),
    fotoHorarioUrl: safeInitUrl(expendio?.fotoHorarioUrl),
    fotoTarifasUrl: safeInitUrl(expendio?.fotoTarifasUrl),
    fotoCedulaFrontalUrl: safeInitUrl(expendio?.fotoCedulaFrontalUrl),
    fotoCedulaPosteriorUrl: safeInitUrl(expendio?.fotoCedulaPosteriorUrl),
    fotoRutUrl: safeInitUrl(expendio?.fotoRutUrl),
  }));

  // Validar si el slot está cumplido por foto REAL o justificado en BD como "NO tiene"
  const isAvisoCumplido = Boolean(isRealPhoto(localPhotos.fotoAvisoUrl) || isRealPhoto(expendio?.fotoAvisoUrl) || isRealPhoto(expendio?.letreroUrl) || expendio?.tieneAviso === 'NO');
  const isPanoramicaCumplida = Boolean(isRealPhoto(localPhotos.fotoPanoramicaUrl) || isRealPhoto(expendio?.fotoPanoramicaUrl));
  const isMataselloCumplido = Boolean(isRealPhoto(localPhotos.fotoMataselloUrl) || isRealPhoto(expendio?.fotoMataselloUrl) || isRealPhoto(expendio?.mataselloUrl) || expendio?.tieneMatasello === 'NO');
  const isBasculaCumplida = Boolean(isRealPhoto(localPhotos.fotoBasculaUrl) || isRealPhoto(expendio?.fotoBasculaUrl) || isRealPhoto(expendio?.basculaUrl) || expendio?.tieneBascula === 'NO');
  const isContratistaCumplido = Boolean(isRealPhoto(localPhotos.fotoContratistaUrl) || isRealPhoto(expendio?.fotoContratistaUrl));
  const isHorarioCumplido = Boolean(isRealPhoto(localPhotos.fotoHorarioUrl) || isRealPhoto(expendio?.fotoHorarioUrl));
  const isTarifasCumplido = Boolean(isRealPhoto(localPhotos.fotoTarifasUrl) || isRealPhoto(expendio?.fotoTarifasUrl));

  const fotosCargadasCount = [
    isAvisoCumplido,
    isPanoramicaCumplida,
    isMataselloCumplido,
    isBasculaCumplida,
    isContratistaCumplido,
    isHorarioCumplido,
    isTarifasCumplido,
  ].filter(Boolean).length;

  const isRegistroFotograficoCompleto = fotosCargadasCount >= 7;
  const isModuloCuentasHabilitado = isDatosActualizados && isRegistroFotograficoCompleto;

  // Bienvenido / Capacitación de Módulos (Se abre automáticamente en el primer ingreso)
  const [showBienvenidaModal, setShowBienvenidaModal] = useState<boolean>(() => {
    if (expendio?.bienvenidaRealizada) return false;
    const seen = localStorage.getItem(`camarca_bienvenida_${expendio?.cedula || 'user'}`);
    return !seen;
  });

  const handleCloseBienvenidaModal = async () => {
    setShowBienvenidaModal(false);
    localStorage.setItem(`camarca_bienvenida_${expendio?.cedula || 'user'}`, 'true');
    try {
      const res = await fetch('/api/expendio/marcar-bienvenida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ cedula: expendio.cedula }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        onUpdateSessionData(data.data);
      }
    } catch (err) {
      console.warn('Error registrando bienvenida:', err);
    }
  };

  // Accordion open/close states (Intelligently open next pending step)
  const [accordionState, setAccordionState] = useState<{
    modulo1: boolean;
    modulo2: boolean;
    modulo3: boolean;
    modulo4: boolean;
  }>(() => {
    if (!isDatosActualizados) {
      return { modulo1: true, modulo2: false, modulo3: false, modulo4: false };
    }
    if (!isRegistroFotograficoCompleto) {
      return { modulo1: false, modulo2: true, modulo3: false, modulo4: false };
    }
    return { modulo1: false, modulo2: false, modulo3: true, modulo4: false };
  });

  const toggleAccordion = (section: 'modulo1' | 'modulo2' | 'modulo3' | 'modulo4') => {
    setAccordionState((prev) => {
      const willOpen = !prev[section];
      return {
        modulo1: section === 'modulo1' ? willOpen : false,
        modulo2: section === 'modulo2' ? willOpen : false,
        modulo3: section === 'modulo3' ? willOpen : false,
        modulo4: section === 'modulo4' ? willOpen : false,
      };
    });
  };

  const handleOpenStep = (step: 'modulo1' | 'modulo2' | 'modulo3' | 'modulo4') => {
    setAccordionState({
      modulo1: step === 'modulo1',
      modulo2: step === 'modulo2',
      modulo3: step === 'modulo3',
      modulo4: step === 'modulo4',
    });
    setTimeout(() => {
      const el = document.getElementById('expendio-active-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  };

  const [showDocModal, setShowDocModal] = useState<boolean>(false);
  const [showScannerModal, setShowScannerModal] = useState<boolean>(false);
  const [viewingScannedPhotoUrl, setViewingScannedPhotoUrl] = useState<string | null>(null);
  const [viewingPhotoDetail, setViewingPhotoDetail] = useState<{ title: string; url: string } | null>(null);

  // Scanned accounts uploaded by this expendio
  const [cuentasCargadas, setCuentasCargadas] = useState<CuentaCargadaExpendio[]>([]);

  // First Login Modal State (Can be dismissed or autofilled for test environments)
  const [showFirstLoginModal, setShowFirstLoginModal] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && expendio?.cedula) {
        const dismissed = sessionStorage.getItem(`camarca_dismissed_first_login_${expendio.cedula}`);
        if (dismissed === 'true') return false;
      }
    } catch {}
    return expendio?.primeraVezActualizado === false || !expendio?.primeraVezActualizado;
  });
  const [savingFirstLogin, setSavingFirstLogin] = useState<boolean>(false);
  const [msgFirstLogin, setMsgFirstLogin] = useState<string>('');

  const handleDismissFirstLogin = () => {
    setShowFirstLoginModal(false);
    try {
      if (typeof window !== 'undefined' && expendio?.cedula) {
        sessionStorage.setItem(`camarca_dismissed_first_login_${expendio.cedula}`, 'true');
      }
    } catch {}
  };

  const handleAutoFillTestData = () => {
    const testEncargado = (expendio?.encargado || 'ENCARGADO PRUEBAS CAMARCA').toUpperCase();
    const testCedula = (expendio?.cedula || '').toUpperCase();
    const testDireccion = (expendio?.direccionPunto || 'CRA 15 # 24-30 CENTRO').toUpperCase();
    const testTelefono = (expendio?.telefonoPunto || '3182822512').toUpperCase();
    const testEmail = (expendio?.correoElectronico || 'expendio.pruebas@camarca.com').toUpperCase();

    setEncargado(testEncargado);
    setCedulaInput(testCedula);
    setDireccionPunto(testDireccion);
    setTelefonoPunto(testTelefono);
    setTipoBanco('NEQUI');
    setOtroBanco('');
    setBanco('NEQUI');
    setCuentaBancaria('3182822512');
    setCorreoElectronico(testEmail);
    setObservaciones('DATOS DE PRUEBA AUTORIZADOS');
    setMsgFirstLogin('');
  };

  // Helper to parse bank state into standard selector options
  const parseBancoState = (bancoVal?: string) => {
    const upper = (bancoVal || 'NEQUI').trim().toUpperCase();
    if (['NEQUI', 'AHORROS BANCOLOMBIA', 'CUENTA CORRIENTE BANCOLOMBIA', 'DAVIPLATA'].includes(upper)) {
      return { tipo: upper, otro: '' };
    }
    if (!upper || upper === 'NEQUI') {
      return { tipo: 'NEQUI', otro: '' };
    }
    return { tipo: 'OTROS', otro: upper };
  };

  // Autoguardado local en el teléfono para proteger el registro si se cae el internet
  const localDraftKey = `camarca_local_draft_${expendio?.cedula || 'default'}`;
  const initialDraft = React.useMemo(() => {
    try {
      if (typeof window !== 'undefined' && expendio?.cedula) {
        const raw = localStorage.getItem(`camarca_local_draft_${expendio.cedula}`);
        if (raw) return JSON.parse(raw);
      }
    } catch {}
    return null;
  }, [expendio?.cedula]);

  // Form 1 State (Contact & Bank Details) - All in UPPERCASE (Restaurado desde borrador local si existe)
  const [encargado, setEncargado] = useState<string>(
    (initialDraft?.encargado || expendio?.encargado || '').toUpperCase()
  );
  const [cedulaInput, setCedulaInput] = useState<string>((expendio?.cedula || '').toUpperCase());
  const [direccionPunto, setDireccionPunto] = useState<string>(
    (initialDraft?.direccionPunto || expendio?.direccionPunto || '').toUpperCase()
  );
  const [telefonoPunto, setTelefonoPunto] = useState<string>(
    (initialDraft?.telefonoPunto || expendio?.telefonoPunto || '').toUpperCase()
  );
  const [cuentaBancaria, setCuentaBancaria] = useState<string>(
    (initialDraft?.cuentaBancaria || expendio?.cuentaBancaria || '').toUpperCase()
  );
  const initialBancoParsed = parseBancoState(initialDraft?.banco || expendio?.banco);
  const [tipoBanco, setTipoBanco] = useState<string>(initialBancoParsed.tipo);
  const [otroBanco, setOtroBanco] = useState<string>(initialBancoParsed.otro);
  const [banco, setBanco] = useState<string>(
    (initialDraft?.banco || expendio?.banco || 'NEQUI').toUpperCase()
  );
  const [correoElectronico, setCorreoElectronico] = useState<string>(
    (initialDraft?.correoElectronico || expendio?.correoElectronico || '').toUpperCase()
  );
  const [observaciones, setObservaciones] = useState<string>(
    (initialDraft?.observaciones ?? expendio?.observaciones ?? expendio?.observacion ?? '').toUpperCase()
  );
  const [savingForm1, setSavingForm1] = useState<boolean>(false);
  const [msgForm1, setMsgForm1] = useState<string>('');
  const [lastLocalSaveTime, setLastLocalSaveTime] = useState<string>(
    initialDraft?.savedAtTime || ''
  );
  const [hasPendingOfflineData, setHasPendingOfflineData] = useState<boolean>(
    Boolean(initialDraft?.pendingSync)
  );

  // Efecto de Autoguardado Local Automático en cada cambio del contratista
  useEffect(() => {
    if (!expendio?.cedula) return;
    try {
      const nowTime = new Date().toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const finalBancoDraft =
        tipoBanco === 'OTROS' ? (otroBanco.trim() || 'OTRO BANCO').toUpperCase() : tipoBanco.toUpperCase();
      const prevRaw = localStorage.getItem(localDraftKey);
      const prevParsed = prevRaw ? JSON.parse(prevRaw) : {};
      const draftPayload = {
        cedula: expendio.cedula,
        encargado: encargado.toUpperCase(),
        direccionPunto: direccionPunto.toUpperCase(),
        telefonoPunto: telefonoPunto.toUpperCase(),
        cuentaBancaria: cuentaBancaria.toUpperCase(),
        banco: finalBancoDraft,
        correoElectronico: correoElectronico.toUpperCase(),
        observaciones: (observaciones || '').toUpperCase(),
        savedAtTime: nowTime,
        pendingSync: Boolean(prevParsed?.pendingSync),
      };
      localStorage.setItem(localDraftKey, JSON.stringify(draftPayload));
      setLastLocalSaveTime(nowTime);
    } catch {}
  }, [
    expendio?.cedula,
    localDraftKey,
    encargado,
    direccionPunto,
    telefonoPunto,
    cuentaBancaria,
    tipoBanco,
    otroBanco,
    correoElectronico,
    observaciones,
  ]);

  // Availability toggle for Báscula, Matasello, Letrero
  const [savingItemKey, setSavingItemKey] = useState<string | null>(null);

  const handleToggleItemAvailability = async (slotKey: string, tiene: 'SI' | 'NO', motivo?: string) => {
    setSavingItemKey(slotKey);
    try {
      const res = await fetch('/api/expendio/marcar-disponibilidad-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cedula: expendio.cedula,
          itemKey: slotKey,
          tiene,
          motivo: motivo || '',
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        onUpdateSessionData(data.data);
        if (tiene === 'NO') {
          const generatedUrl = data.fileUrl || data.data[slotKey] || '';
          setLocalPhotos((prev) => ({
            ...prev,
            [slotKey]: generatedUrl ? `${generatedUrl.split('?')[0]}?v=${Date.now()}` : '',
          }));
          setMsgForm2(`✓ Implemento marcado como NO DISPONIBLE y soporte en blanco generado para completar las 7 imágenes.`);
        } else {
          setLocalPhotos((prev) => ({ ...prev, [slotKey]: '' }));
          setMsgForm2(`✓ Implemento actualizado a DISPONIBLE (SI) en la base de datos. Por favor adjunta la fotografía real.`);
        }
      }
    } catch (err) {
      console.error('Error actualizando disponibilidad del ítem:', err);
    } finally {
      setSavingItemKey(null);
    }
  };

  // Contract Upload State
  const [uploadingContract, setUploadingContract] = useState<boolean>(false);
  const [msgForm3, setMsgForm3] = useState<string>('');

  // Offline photo queue state
  const [offlineQueue, setOfflineQueue] = useState<OfflinePhotoItem[]>(() => getOfflinePhotoQueue());
  const [isSyncingOffline, setIsSyncingOffline] = useState<boolean>(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('');

  const [uploadingPhotoType, setUploadingPhotoType] = useState<string | null>(null);
  const [msgForm2, setMsgForm2] = useState<string>('');
  const [gpsCaptureModal, setGpsCaptureModal] = useState<{ slotKey: string; slotTitle: string; initialFile?: File | null } | null>(null);
  const [globalCoords, setGlobalCoords] = useState<GeoCoordinates | null>(null);
  const [isRequestingGps, setIsRequestingGps] = useState<boolean>(false);
  const [gpsStatusMsg, setGpsStatusMsg] = useState<string>('');

  // Sincronizar cola offline de fotos
  const refreshOfflineQueue = useCallback(() => {
    const queue = getOfflinePhotoQueue();
    setOfflineQueue(queue);
  }, []);

  const handleSyncOffline = async () => {
    setIsSyncingOffline(true);
    setSyncStatusMsg('Sincronizando fotografías almacenadas en cola offline...');
    
    // Purga selectiva de cachés del navegador y localStorage relacionado con fotos
    if (typeof (window as any).clearAppCache === 'function') {
      try {
        await (window as any).clearAppCache();
      } catch (err) {
        console.warn('[Cache-Purge] Advertencia purgando cachés:', err);
      }
    }

    try {
      const res = await syncOfflinePhotos((synced, total, current) => {
        setSyncStatusMsg(`Sincronizando foto ${synced + 1} de ${total} (${current.slotTitle})...`);
      });
      refreshOfflineQueue();
      await fetchConfigAndCuentas();

      if (expendio?.cedula) {
        try {
          const resp = await fetch(`/api/expendio/me?_t=${Date.now()}`, {
            headers: {
              ...(sessionStorage.getItem('camarca_token') ? { Authorization: `Bearer ${sessionStorage.getItem('camarca_token')}` } : {}),
            },
          });
          if (resp.ok) {
            const freshData = await resp.json();
            if (freshData && freshData.expendio) {
              onUpdateSessionData(freshData.expendio);
            }
          }
        } catch (fetchErr) {
          console.warn('[handleSyncOffline] Error refrescando datos de expendio:', fetchErr);
        }
      }

      if (res.syncedCount > 0) {
        setSyncStatusMsg(`✓ Se sincronizaron ${res.syncedCount} fotografía(s) con el servidor y se refrescó la información.`);
      } else if (res.failedCount > 0) {
        setSyncStatusMsg(`⚠️ ${res.failedCount} foto(s) no pudieron subirse aún (reintentando en segundo plano).`);
      } else {
        setSyncStatusMsg('✓ Sincronización completada. Fotografías y datos actualizados al día.');
      }
      setTimeout(() => setSyncStatusMsg(''), 4000);
    } catch (err: any) {
      console.error('Error sincronizando cola offline:', err);
      setSyncStatusMsg('Error en sincronización offline.');
    } finally {
      setIsSyncingOffline(false);
    }
  };

  // Sincronizar borrador de datos pendientes cuando regrese la señal de internet
  const syncPendingLocalDataDraft = useCallback(async () => {
    if (!expendio?.cedula) return;
    try {
      const raw = localStorage.getItem(localDraftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft?.pendingSync) return;

      const res = await fetch('/api/expendio/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cedula: expendio.cedula,
          encargado: draft.encargado,
          direccionPunto: draft.direccionPunto,
          telefonoPunto: draft.telefonoPunto,
          cuentaBancaria: draft.cuentaBancaria,
          banco: draft.banco,
          correoElectronico: draft.correoElectronico,
          observaciones: draft.observaciones || '',
          primeraVezActualizado: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem(localDraftKey, JSON.stringify({ ...draft, pendingSync: false }));
        setHasPendingOfflineData(false);
        onUpdateSessionData(data.data);
        setMsgForm1('✓ Tus datos autoguardados en el teléfono se sincronizaron automáticamente con el servidor.');
      }
    } catch {}
  }, [expendio?.cedula, localDraftKey, onUpdateSessionData]);

  // Listeners para cola offline y reconexión a internet
  useEffect(() => {
    const handleQueueUpdate = () => refreshOfflineQueue();
    const handleOnline = () => {
      console.log('Conexión reestablecida. Sincronizando cola offline y autoguardado local...');
      handleSyncOffline();
      syncPendingLocalDataDraft();
    };

    window.addEventListener('camarca_offline_queue_updated', handleQueueUpdate);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('camarca_offline_queue_updated', handleQueueUpdate);
      window.removeEventListener('online', handleOnline);
    };
  }, [syncPendingLocalDataDraft]);

  const activeExpendioKeyRef = useRef<string>(expendio?.id || expendio?.cedula || '');

  // Sincronizar fotos locales cuando expendio se actualice sin mezclar datos de otros municipios
  useEffect(() => {
    if (!expendio || !expendio.cedula) return;

    const currentKey = expendio.id || expendio.cedula || '';
    const hasExpChanged = activeExpendioKeyRef.current !== currentKey;
    if (hasExpChanged) {
      activeExpendioKeyRef.current = currentKey;
    }

    const resolveSafeSlot = (serverUrl?: string, prevUrl?: string) => {
      // 1. Si cambió de expendio, jamás heredar el prevUrl del expendio anterior (ej. Girón/Pamplona)
      if (hasExpChanged) {
        prevUrl = '';
      }
      // 2. Si hay URL en el expendio y es consistente con este municipio
      if (serverUrl && isRealPhoto(serverUrl) && isPhotoConsistentWithExpendio(serverUrl, expendio)) {
        return serverUrl;
      }
      // 3. Si hay prevUrl local (ej. foto recién tomada o dataURL en memoria), verificar consistencia
      if (prevUrl && isRealPhoto(prevUrl) && isPhotoConsistentWithExpendio(prevUrl, expendio)) {
        return prevUrl;
      }
      return '';
    };

    setLocalPhotos((prev) => {
      const targetAviso = resolveSafeSlot(expendio.fotoAvisoUrl || expendio.letreroUrl, prev.fotoAvisoUrl);
      const targetPano = resolveSafeSlot(expendio.fotoPanoramicaUrl, prev.fotoPanoramicaUrl);
      const targetMata = resolveSafeSlot(expendio.fotoMataselloUrl || expendio.mataselloUrl, prev.fotoMataselloUrl);
      const targetBasc = resolveSafeSlot(expendio.fotoBasculaUrl || expendio.basculaUrl, prev.fotoBasculaUrl);
      const targetCont = resolveSafeSlot(expendio.fotoContratistaUrl, prev.fotoContratistaUrl);
      const targetHora = resolveSafeSlot(expendio.fotoHorarioUrl, prev.fotoHorarioUrl);
      const targetTari = resolveSafeSlot(expendio.fotoTarifasUrl, prev.fotoTarifasUrl);
      const targetCedF = resolveSafeSlot(expendio.fotoCedulaFrontalUrl, prev.fotoCedulaFrontalUrl);
      const targetCedP = resolveSafeSlot(expendio.fotoCedulaPosteriorUrl, prev.fotoCedulaPosteriorUrl);
      const targetRut = resolveSafeSlot(expendio.fotoRutUrl, prev.fotoRutUrl);

      // Si todos los valores ya coinciden exactamente y no hubo cambio de expendio, no cambiar referencia
      if (
        !hasExpChanged &&
        prev.fotoAvisoUrl === targetAviso &&
        prev.fotoPanoramicaUrl === targetPano &&
        prev.fotoMataselloUrl === targetMata &&
        prev.fotoBasculaUrl === targetBasc &&
        prev.fotoContratistaUrl === targetCont &&
        prev.fotoHorarioUrl === targetHora &&
        prev.fotoTarifasUrl === targetTari &&
        prev.fotoCedulaFrontalUrl === targetCedF &&
        prev.fotoCedulaPosteriorUrl === targetCedP &&
        prev.fotoRutUrl === targetRut
      ) {
        return prev;
      }

      return {
        fotoAvisoUrl: targetAviso,
        fotoPanoramicaUrl: targetPano,
        fotoMataselloUrl: targetMata,
        fotoBasculaUrl: targetBasc,
        fotoContratistaUrl: targetCont,
        fotoHorarioUrl: targetHora,
        fotoTarifasUrl: targetTari,
        fotoCedulaFrontalUrl: targetCedF,
        fotoCedulaPosteriorUrl: targetCedP,
        fotoRutUrl: targetRut,
      };
    });

    // Restaurar fotos desde IndexedDB: solo si corresponden al expendio y no están cruzadas
    getStoredPhotosByCedula(expendio.cedula, expendio.id)
      .then((stored) => {
        if (stored && stored.length > 0) {
          setLocalPhotos((prev) => {
            const additions: Record<string, string> = {};
            for (const sp of stored) {
              if (!sp.serverSynced && sp.dataUrl && isRealPhoto(sp.dataUrl) && !prev[sp.slotKey]) {
                if (isPhotoConsistentWithExpendio(sp.dataUrl, expendio)) {
                  additions[sp.slotKey] = sp.dataUrl;
                }
              }
            }
            return Object.keys(additions).length > 0 ? { ...prev, ...additions } : prev;
          });
        }
      })
      .catch((err) => {
        console.warn('[ExpendioPanel] Error cargando fotos desde IndexedDB:', err);
      });
  }, [
    expendio?.id,
    expendio?.cedula,
    expendio?.fotoAvisoUrl,
    expendio?.letreroUrl,
    expendio?.fotoPanoramicaUrl,
    expendio?.fotoMataselloUrl,
    expendio?.mataselloUrl,
    expendio?.fotoBasculaUrl,
    expendio?.basculaUrl,
    expendio?.fotoContratistaUrl,
    expendio?.fotoHorarioUrl,
    expendio?.fotoTarifasUrl,
    expendio?.fotoCedulaFrontalUrl,
    expendio?.fotoCedulaPosteriorUrl,
    expendio?.fotoRutUrl,
    expendio?.revision,
  ]);

  // Helper to query / verify GPS permissions
  const requestGpsPermission = async () => {
    setIsRequestingGps(true);
    setGpsStatusMsg('Consultando satélites GPS...');
    try {
      const position = await getCurrentGpsLocation(10000);
      setGlobalCoords(position);
      setGpsStatusMsg(`✓ GPS Activo: Lat ${position.latitude.toFixed(5)}°, Lng ${position.longitude.toFixed(5)}°`);
    } catch (err: any) {
      console.warn('Error consultando GPS:', err);
      setGpsStatusMsg(err.message || 'No se pudo obtener la ubicación GPS.');
    } finally {
      setIsRequestingGps(false);
    }
  };

  const handleOpenGpsCamera = (slotKey: string, slotTitle: string, initialFile?: File | null) => {
    setGpsCaptureModal({ slotKey, slotTitle, initialFile });
  };

  const handlePhotoUploadWithGps = async (
    e: React.ChangeEvent<HTMLInputElement>,
    photoType: string,
    slotTitle: string
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhotoType(photoType);
    setMsgForm2(`Estampando marca de agua y GPS en ${slotTitle}...`);

    try {
      let coords = globalCoords;
      if (!coords) {
        try {
          coords = await getCurrentGpsLocation(4000);
          setGlobalCoords(coords);
        } catch {
          // Proceed without GPS
        }
      }

      const stamped = await stampPhotoWithWatermarkAndGps(file, {
        expendioNombre: expendio.localidad || expendio.municipio || 'EXPENDIO',
        municipio: expendio.municipio || expendio.localidad,
        encargado: expendio.encargado || '',
        cedula: expendio.cedula || '',
        tituloSlot: slotTitle,
        coords: coords,
        timestamp: new Date(),
        marcaAguaPrincipal: 'EXPENDIO CAMARCA SAS',
      });

      setLocalPhotos((prev) => ({ ...prev, [photoType]: stamped.dataUrl }));

      const isAvailabilitySlot = photoType === 'fotoAvisoUrl' || photoType === 'fotoBasculaUrl' || photoType === 'fotoMataselloUrl';
      if (isAvailabilitySlot) {
        onUpdateSessionData({
          ...expendio,
          ...(photoType === 'fotoAvisoUrl' ? { tieneAviso: 'SI', motivoFaltaAviso: '', fotoAvisoUrl: stamped.dataUrl, letreroUrl: stamped.dataUrl } : {}),
          ...(photoType === 'fotoBasculaUrl' ? { tieneBascula: 'SI', motivoFaltaBascula: '', fotoBasculaUrl: stamped.dataUrl, basculaUrl: stamped.dataUrl } : {}),
          ...(photoType === 'fotoMataselloUrl' ? { tieneMatasello: 'SI', motivoFaltaMatasello: '', fotoMataselloUrl: stamped.dataUrl, mataselloUrl: stamped.dataUrl } : {}),
        });
      }

      // 1. Persistencia Inmediata en IndexedDB (Protección contra cierre de navegador o desconexión)
      let storedRecord: StoredPhotoRecord | null = null;
      try {
        storedRecord = await savePhotoToIndexedDB({
          cedula: expendio.cedula,
          slotKey: photoType,
          slotTitle,
          fileOrBlob: stamped.file,
          dataUrl: stamped.dataUrl,
          expendioNombre: expendio.nombre || expendio.encargado,
          municipio: expendio.municipio || expendio.localidad || 'Giron',
          fecha: expendio.fechaUltimaActualizacion || new Date().toISOString().split('T')[0],
          coords: coords,
        });
      } catch (dbErr) {
        console.warn('[IndexedDB] Advertencia guardando copia local en IndexedDB:', dbErr);
      }

      const formData = new FormData();
      formData.append('cedula', expendio.cedula);
      formData.append('expendioId', expendio.id || '');
      formData.append('encargado', expendio.encargado || '');
      formData.append('municipio', expendio.municipio || expendio.localidad || '');
      formData.append('photoType', photoType);
      formData.append('photo', stamped.file);

      try {
        let res = await fetch('/api/expendio/upload-photo', {
          method: 'POST',
          body: formData,
        });

        let data = await res.json().catch(() => ({ success: false }));

        if (!res.ok || !data.success) {
          // Fallback 1: Subida vía JSON Base64
          const b64Res = await fetch('/api/expendio/upload-photo-base64', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cedula: expendio.cedula,
              expendioId: expendio.id || '',
              encargado: expendio.encargado || '',
              municipio: expendio.municipio || expendio.localidad || '',
              photoType,
              photoBase64: stamped.dataUrl,
            }),
          });
          const b64Data = await b64Res.json().catch(() => ({ success: false }));
          if (b64Res.ok && b64Data.success) {
            res = b64Res;
            data = b64Data;
          } else {
            // Fallback 2: Ruta híbrida directa
            const hybridForm = new FormData();
            hybridForm.append('foto', stamped.file);
            const hybRes = await fetch(
              `/api/photos/upload-hybrid/${encodeURIComponent(expendio.cedula)}/${encodeURIComponent(photoType)}`,
              {
                method: 'POST',
                body: hybridForm,
              }
            );
            const hybData = await hybRes.json().catch(() => ({ success: false }));
            if (hybRes.ok && hybData.success) {
              res = hybRes;
              data = hybData;
            }
          }
        }

        if (data.success) {
          const todayDate = new Date().toISOString().split('T')[0];
          const updatedExpendio = data.data || data.expendio;
          if (updatedExpendio) {
            onUpdateSessionData({
              ...updatedExpendio,
              fechaUltimaActualizacion: updatedExpendio.fechaUltimaActualizacion || todayDate,
            });
          } else {
            onUpdateSessionData({
              ...expendio,
              [photoType]: data.url || data.fileUrl || stamped.dataUrl,
              fechaUltimaActualizacion: data.fechaUltimaActualizacion || todayDate,
              updatedAt: data.updatedAt || new Date().toISOString(),
            });
          }

          setMsgForm2(`Borrando caché local y descargando ${slotTitle} desde el servidor para visualización...`);

          // Borrar caché local al cargarse al servidor, descargar nuevamente la imagen del servidor y guardarla en caché DESPUÉS de descargarse
          const redownloaded = await purgeCacheAndRedownloadPhotoFromServer({
            cedula: expendio.cedula,
            slotKey: photoType,
            slotTitle,
            expendioNombre: expendio.nombre || expendio.encargado,
            municipio: expendio.municipio || expendio.localidad || 'Giron',
            fecha: expendio.fechaUltimaActualizacion || new Date().toISOString().split('T')[0],
            coords,
          });

          setLocalPhotos((prev) => ({
            ...prev,
            [photoType]: redownloaded.serverUrl || data.fileUrl || data.url || prev[photoType],
          }));
          refreshOfflineQueue();

          setMsgForm2(
            `✓ Fotografía (${slotTitle}) cargada con éxito. ⚡ ${stamped.compressionSummary}`
          );
        } else {
          if (storedRecord?.id) {
            updatePhotoRecord(storedRecord.id, {
              status: 'failed',
              lastError: data.message || 'Rechazado por el servidor',
            }).catch(() => {});
          }
          setMsgForm2('✓ Fotografía guardada en tu teléfono. Se enviará al servidor cuando haya conexión.');
          reportPlatformError({
            errorCode: 'PHOTO_UPLOAD_FAILED',
            expendio: { id: expendio.id, municipio: expendio.municipio, cedula: expendio.cedula },
            userMessage: 'Fotografía guardada en tu teléfono. Se sincronizará automáticamente.',
            technicalDetails: `Respuesta servidor: ${data.message || 'Error desconocido'}`,
            category: 'FOTOS_S3',
            severity: 'ALTO',
          });
        }
      } catch (err: any) {
        if (storedRecord?.id) {
          updatePhotoRecord(storedRecord.id, {
            status: 'failed',
            lastError: err.message || 'Error de red',
          }).catch(() => {});
        }
        setMsgForm2('✓ Fotografía protegida en tu teléfono. Se sincronizará automáticamente cuando haya red.');
        reportPlatformError({
          errorCode: 'PHOTO_UPLOAD_FAILED',
          expendio: { id: expendio.id, municipio: expendio.municipio, cedula: expendio.cedula },
          userMessage: 'Fotografía guardada en tu teléfono.',
          technicalDetails: `Error de red al subir foto: ${err?.message || 'Error desconocido'}`,
          category: 'FOTOS_S3',
          severity: 'MEDIO',
        });
      }
    } catch (err: any) {
      console.error('Error subiendo foto con GPS:', err);
      setMsgForm2('No se pudo procesar la foto. Por favor intenta tomarla nuevamente.');
      reportPlatformError({
        errorCode: 'PHOTO_FORMAT_INVALID',
        expendio: { id: expendio.id, municipio: expendio.municipio, cedula: expendio.cedula },
        userMessage: 'No se pudo procesar la foto.',
        technicalDetails: `Error en compresión/estampe GPS: ${err?.message || 'Error desconocido'}`,
        category: 'CAMARA_GPS',
        severity: 'ALTO',
      });
    } finally {
      setUploadingPhotoType(null);
    }
  };

  const handlePhotoCapturedFromModal = async (slotKey: string, file: File, dataUrl: string) => {
    setUploadingPhotoType(slotKey);
    setMsgForm2('Guardando fotografía en tu dispositivo y enviando al sistema...');

    setLocalPhotos((prev) => ({ ...prev, [slotKey]: dataUrl }));

    const todayDate = new Date().toISOString().split('T')[0];
    const isAvailabilitySlot = slotKey === 'fotoAvisoUrl' || slotKey === 'fotoBasculaUrl' || slotKey === 'fotoMataselloUrl';
    onUpdateSessionData({
      ...expendio,
      [slotKey]: dataUrl,
      fechaUltimaActualizacion: todayDate,
      ...(isAvailabilitySlot && slotKey === 'fotoAvisoUrl' ? { tieneAviso: 'SI', motivoFaltaAviso: '', fotoAvisoUrl: dataUrl, letreroUrl: dataUrl } : {}),
      ...(isAvailabilitySlot && slotKey === 'fotoBasculaUrl' ? { tieneBascula: 'SI', motivoFaltaBascula: '', fotoBasculaUrl: dataUrl, basculaUrl: dataUrl } : {}),
      ...(isAvailabilitySlot && slotKey === 'fotoMataselloUrl' ? { tieneMatasello: 'SI', motivoFaltaMatasello: '', fotoMataselloUrl: dataUrl, mataselloUrl: dataUrl } : {}),
    });

    // 1. Guardar de inmediato en IndexedDB
    let storedRecord: StoredPhotoRecord | null = null;
    try {
      storedRecord = await savePhotoToIndexedDB({
        cedula: expendio.cedula,
        slotKey,
        slotTitle: slotKey,
        fileOrBlob: file,
        dataUrl,
        expendioNombre: expendio.nombre || expendio.encargado,
        municipio: expendio.municipio || expendio.localidad || 'Giron',
        fecha: expendio.fechaUltimaActualizacion || new Date().toISOString().split('T')[0],
        coords: globalCoords,
      });
    } catch (dbErr) {
      console.warn('[IndexedDB] Advertencia guardando foto modal:', dbErr);
    }

    try {
      const formData = new FormData();
      formData.append('cedula', expendio.cedula);
      formData.append('photoType', slotKey);
      formData.append('photo', file);

      let res = await fetch('/api/expendio/upload-photo', {
        method: 'POST',
        body: formData,
      });

      let data = await res.json().catch(() => ({ success: false }));

      if (!res.ok || !data.success) {
        const b64Res = await fetch('/api/expendio/upload-photo-base64', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cedula: expendio.cedula,
            photoType: slotKey,
            photoBase64: dataUrl,
          }),
        });
        const b64Data = await b64Res.json().catch(() => ({ success: false }));
        if (b64Res.ok && b64Data.success) {
          res = b64Res;
          data = b64Data;
        } else {
          const hybridForm = new FormData();
          hybridForm.append('foto', file);
          const hybRes = await fetch(
            `/api/photos/upload-hybrid/${encodeURIComponent(expendio.cedula)}/${encodeURIComponent(slotKey)}`,
            {
              method: 'POST',
              body: hybridForm,
            }
          );
          const hybData = await hybRes.json().catch(() => ({ success: false }));
          if (hybRes.ok && hybData.success) {
            res = hybRes;
            data = hybData;
          }
        }
      }

      if (data.success) {
        const updatedExpendio = data.data || data.expendio;
        if (updatedExpendio) {
          onUpdateSessionData({
            ...updatedExpendio,
            fechaUltimaActualizacion: updatedExpendio.fechaUltimaActualizacion || todayDate,
          });
        } else {
          onUpdateSessionData({
            ...expendio,
            [slotKey]: data.url || data.fileUrl || dataUrl,
            fechaUltimaActualizacion: data.fechaUltimaActualizacion || todayDate,
            updatedAt: data.updatedAt || new Date().toISOString(),
          });
        }

        setMsgForm2(`Borrando caché local y descargando foto desde el servidor para visualización...`);

        // Borrar caché local al cargarse al servidor, descargar nuevamente la imagen del servidor y guardarla en caché DESPUÉS de descargarse
        const redownloaded = await purgeCacheAndRedownloadPhotoFromServer({
          cedula: expendio.cedula,
          slotKey,
          slotTitle: slotKey,
          expendioNombre: expendio.nombre || expendio.encargado,
          municipio: expendio.municipio || expendio.localidad || 'Giron',
          fecha: expendio.fechaUltimaActualizacion || new Date().toISOString().split('T')[0],
          coords: globalCoords,
        });

        setLocalPhotos((prev) => ({
          ...prev,
          [slotKey]: redownloaded.serverUrl || data.fileUrl || data.url || prev[slotKey],
        }));
        refreshOfflineQueue();

        setMsgForm2(`✓ Fotografía cargada al servidor, descargada para visualización y almacenada en caché.`);
      } else {
        if (storedRecord?.id) {
          updatePhotoRecord(storedRecord.id, {
            status: 'failed',
            lastError: data.message || 'Rechazado por el servidor',
          }).catch(() => {});
        }
        setMsgForm2('✓ Fotografía guardada en tu teléfono. Se sincronizará con el sistema al conectarse.');
        reportPlatformError({
          errorCode: 'PHOTO_UPLOAD_FAILED',
          expendio: { id: expendio.id, municipio: expendio.municipio, cedula: expendio.cedula },
          userMessage: 'Foto guardada en el teléfono.',
          technicalDetails: `Servidor rechazó subida: ${data.message || 'Error'}`,
          category: 'FOTOS_S3',
          severity: 'ALTO',
        });
      }
    } catch (err: any) {
      console.error('Error en carga de foto:', err);
      if (storedRecord?.id) {
        updatePhotoRecord(storedRecord.id, {
          status: 'failed',
          lastError: err.message || 'Error de red',
        }).catch(() => {});
      }
      setMsgForm2('✓ Fotografía guardada de forma segura en tu teléfono. Se sincronizará cuando haya conexión.');
      reportPlatformError({
        errorCode: 'PHOTO_UPLOAD_FAILED',
        expendio: { id: expendio.id, municipio: expendio.municipio, cedula: expendio.cedula },
        userMessage: 'Fotografía guardada en el teléfono.',
        technicalDetails: `Error de red modal upload: ${err?.message || 'Error'}`,
        category: 'FOTOS_S3',
        severity: 'MEDIO',
      });
    } finally {
      setUploadingPhotoType(null);
    }
  };

  // Fetch system config and cuentas
  const fetchConfigAndCuentas = useCallback(async () => {
    try {
      // Intentar primero /api/config y fallback a /api/system/config (con cache buster)
      let dataConfig: any = null;
      try {
        const resConfig = await fetch(`/api/config?_t=${Date.now()}`, { cache: 'no-store',  });
        if (resConfig.ok) {
          dataConfig = await resConfig.json();
        }
      } catch {
        // Fallback
      }
      if (!dataConfig?.success) {
        const resConfig2 = await fetch(`/api/system/config?_t=${Date.now()}`, { cache: 'no-store',  });
        if (resConfig2.ok) {
          dataConfig = await resConfig2.json();
        }
      }

      if (dataConfig?.success && dataConfig.data) {
        setSystemConfig(dataConfig.data);
        if (dataConfig.data.periodoHabilitadoDescarga) {
          const raw = dataConfig.data.periodoHabilitadoDescarga.trim();
          let parsedMes = '';
          let parsedAnio = '';
          
          const matchYyyyMm = raw.match(/^(\d{4})-(\d{2})$/);
          if (matchYyyyMm) {
            const y = matchYyyyMm[1];
            const m = matchYyyyMm[2];
            const months = [
              'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
              'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
            ];
            const monthIdx = parseInt(m, 10) - 1;
            if (monthIdx >= 0 && monthIdx < 12) {
              parsedMes = months[monthIdx];
              parsedAnio = y;
            }
          } else {
            const parts = raw.split(/\s+/);
            if (parts.length >= 2) {
              parsedMes = parts[0].toUpperCase();
              parsedAnio = parts[1];
            } else if (parts.length === 1) {
              parsedMes = parts[0].toUpperCase();
            }
          }
          
          if (parsedMes) {
            setMesPeriodo((prev) => (prev === parsedMes ? prev : parsedMes));
          }
          if (parsedAnio) {
            setAnioPeriodo((prev) => (prev === parsedAnio ? prev : parsedAnio));
          }
        }
      }

      // Cuentas cargadas del expendio
      if (!expendio?.cedula) return;
      const resCuentasCargadas = await fetch(`/api/cuentas-cargadas?cedula=${encodeURIComponent(expendio.cedula)}&_t=${Date.now()}`, { cache: 'no-store',  });
      if (resCuentasCargadas.ok) {
        const dataCuentasCargadas = await resCuentasCargadas.json();
        if (dataCuentasCargadas.success && Array.isArray(dataCuentasCargadas.data)) {
          setCuentasCargadas(dataCuentasCargadas.data);
        }
      }
    } catch (err) {
      console.error('Error cargando configuración inicial:', err);
    }
  }, [expendio?.cedula]);

  useEffect(() => {
    fetchConfigAndCuentas();

    const handleFocus = () => {
      fetchConfigAndCuentas();
    };
    const handleConfigEvent = () => {
      fetchConfigAndCuentas();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('configUpdated', handleConfigEvent);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('configUpdated', handleConfigEvent);
    };
  }, [expendio?.cedula]);

  // Check cuenta de cobro for selected period
  const checkCuentaCobroPeriodo = useCallback(async () => {
    if (!expendio?.cedula) return;
    const periodoBusqueda = `${mesPeriodo.trim().toUpperCase()} ${anioPeriodo.trim()}`;
    setCheckingCuenta(true);
    setCuentaGenerada({ checked: false, generada: false });

    try {
      const res = await fetch(`/api/expendio/cuenta-cobro?cedula=${encodeURIComponent(expendio.cedula)}&periodo=${encodeURIComponent(periodoBusqueda)}&_t=${Date.now()}`, { cache: 'no-store',  });
      const data = await res.json();

      if (data.success && data.data && data.generada !== false) {
        setCuentaGenerada({
          checked: true,
          generada: true,
          data: data.data,
          message: data.message,
        });
      } else {
        setCuentaGenerada({
          checked: true,
          generada: false,
          message: data.message || `No se encontró cuenta de cobro generada para el periodo ${periodoBusqueda}`,
        });
      }
    } catch (err) {
      console.error('Error al consultar cuenta de cobro del periodo:', err);
      setCuentaGenerada({
        checked: true,
        generada: false,
        message: 'Error de conexión al consultar el estado de la cuenta de cobro.',
      });
    } finally {
      setCheckingCuenta(false);
    }
  }, [expendio?.cedula, mesPeriodo, anioPeriodo]);

  useEffect(() => {
    checkCuentaCobroPeriodo();
  }, [expendio?.cedula, mesPeriodo, anioPeriodo]);

  const selectedPeriodStr = `${mesPeriodo.trim().toUpperCase()} ${anioPeriodo.trim()}`;
  const periodoHabilitadoStr = systemConfig?.periodoHabilitadoDescarga?.trim().toUpperCase() || 'FEBRERO 2026';

  const normalizePeriodStr = (p: string) => {
    if (!p) return '';
    const clean = p.trim().toUpperCase();
    if (/^\d{4}-\d{2}$/.test(clean)) {
      return clean;
    }
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      const months = [
        'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
        'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
      ];
      const mIdx = months.indexOf(parts[0]);
      if (mIdx !== -1) {
        const mm = String(mIdx + 1).padStart(2, '0');
        return `${parts[1]}-${mm}`;
      }
    }
    return clean;
  };

  const isPeriodoHabilitadoParaDescarga = normalizePeriodStr(selectedPeriodStr) === normalizePeriodStr(periodoHabilitadoStr);

  // Handler Form 1: Save Contact & Bank Info
  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingForm1(true);
    setMsgForm1('');

    const finalBanco = tipoBanco === 'OTROS' ? (otroBanco.trim() || 'OTRO BANCO').toUpperCase() : tipoBanco.toUpperCase();

    try {
      const res = await fetch('/api/expendio/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({
          cedula: expendio.cedula,
          encargado: encargado.toUpperCase(),
          direccionPunto: direccionPunto.toUpperCase(),
          telefonoPunto: telefonoPunto.toUpperCase(),
          cuentaBancaria: cuentaBancaria.toUpperCase(),
          banco: finalBanco,
          correoElectronico: correoElectronico.toUpperCase(),
          observaciones: (observaciones || '').toUpperCase(),
          primeraVezActualizado: true,
        }),
      });

      const data = await res.json();
      if (data.success) {
        try {
          const prevRaw = localStorage.getItem(localDraftKey);
          const prevParsed = prevRaw ? JSON.parse(prevRaw) : {};
          localStorage.setItem(localDraftKey, JSON.stringify({ ...prevParsed, pendingSync: false }));
          setHasPendingOfflineData(false);
        } catch {}
        setMsgForm1('✓ Datos de contacto y cuenta bancaria actualizados correctamente en MAYÚSCULAS.');
        onUpdateSessionData(data.data);


        if (fotosCargadasCount < 7) {
          setAccordionState({ modulo1: false, modulo2: true, modulo3: false, modulo4: false });
        }
      } else {
        setMsgForm1(data.message || 'Error al actualizar datos.');
      }
    } catch (err) {
      console.error('Error guardando formulario 1:', err);
      // Preservar avance localmente en el teléfono para no perder lo escrito si se cayó el internet
      try {
        const nowTime = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        localStorage.setItem(
          localDraftKey,
          JSON.stringify({
            cedula: expendio.cedula,
            encargado: encargado.toUpperCase(),
            direccionPunto: direccionPunto.toUpperCase(),
            telefonoPunto: telefonoPunto.toUpperCase(),
            cuentaBancaria: cuentaBancaria.toUpperCase(),
            banco: finalBanco,
            correoElectronico: correoElectronico.toUpperCase(),
            observaciones: (observaciones || '').toUpperCase(),
            savedAtTime: nowTime,
            pendingSync: true,
          })
        );
        setHasPendingOfflineData(true);
      } catch {}
      onUpdateSessionData({
        ...expendio,
        encargado: encargado.toUpperCase(),
        direccionPunto: direccionPunto.toUpperCase(),
        telefonoPunto: telefonoPunto.toUpperCase(),
        cuentaBancaria: cuentaBancaria.toUpperCase(),
        banco: finalBanco,
        correoElectronico: correoElectronico.toUpperCase(),
        observaciones: (observaciones || '').toUpperCase(),
        primeraVezActualizado: true,
        fechaUltimaActualizacion: new Date().toISOString().split('T')[0],
      });
      setMsgForm1(
        '💾 Señal inestable: Tus datos quedaron autoguardados en tu teléfono y se sincronizarán automáticamente apenas vuelva el internet.'
      );
      if (fotosCargadasCount < 7) {
        setAccordionState({ modulo1: false, modulo2: true, modulo3: false, modulo4: false });
      }
    } finally {
      setSavingForm1(false);
    }
  };

  // Handler First Login Modal: Mandatory Initial Data Update
  const handleSaveFirstLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!encargado.trim() || !direccionPunto.trim() || !telefonoPunto.trim() || !cuentaBancaria.trim() || !correoElectronico.trim()) {
      setMsgFirstLogin('Por favor complete todos los campos requeridos.');
      return;
    }

    if (tipoBanco === 'OTROS' && !otroBanco.trim()) {
      setMsgFirstLogin('Por favor especifique el nombre de la entidad bancaria.');
      return;
    }

    setSavingFirstLogin(true);
    setMsgFirstLogin('');

    const finalBanco = tipoBanco === 'OTROS' ? otroBanco.trim().toUpperCase() : tipoBanco.toUpperCase();

    try {
      const res = await fetch('/api/expendio/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({
          cedula: expendio.cedula,
          encargado: encargado.toUpperCase(),
          direccionPunto: direccionPunto.toUpperCase(),
          telefonoPunto: telefonoPunto.toUpperCase(),
          cuentaBancaria: cuentaBancaria.toUpperCase(),
          banco: finalBanco,
          correoElectronico: correoElectronico.toUpperCase(),
          observaciones: (observaciones || '').toUpperCase(),
          primeraVezActualizado: true,
        }),
      });

      const data = await res.json();
      if (data.success) {
        try {
          const prevRaw = localStorage.getItem(localDraftKey);
          const prevParsed = prevRaw ? JSON.parse(prevRaw) : {};
          localStorage.setItem(localDraftKey, JSON.stringify({ ...prevParsed, pendingSync: false }));
          setHasPendingOfflineData(false);
        } catch {}
        onUpdateSessionData(data.data);
        setShowFirstLoginModal(false);
        try {
          if (typeof window !== 'undefined' && expendio?.cedula) {
            sessionStorage.setItem(`camarca_dismissed_first_login_${expendio.cedula}`, 'true');
          }
        } catch {}
        setMsgForm1('✓ Actualización inicial completada con éxito. Ahora procede con el Registro Fotográfico obligatorio.');
        

        setAccordionState({ modulo1: false, modulo2: true, modulo3: false, modulo4: false });
      } else {
        setMsgFirstLogin(data.message || 'Error al guardar los datos.');
      }
    } catch (err) {
      console.error('Error guardando primer inicio de sesión:', err);
      try {
        const nowTime = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        localStorage.setItem(
          localDraftKey,
          JSON.stringify({
            cedula: expendio.cedula,
            encargado: encargado.toUpperCase(),
            direccionPunto: direccionPunto.toUpperCase(),
            telefonoPunto: telefonoPunto.toUpperCase(),
            cuentaBancaria: cuentaBancaria.toUpperCase(),
            banco: finalBanco,
            correoElectronico: correoElectronico.toUpperCase(),
            observaciones: (observaciones || '').toUpperCase(),
            savedAtTime: nowTime,
            pendingSync: true,
          })
        );
        setHasPendingOfflineData(true);
      } catch {}
      onUpdateSessionData({
        ...expendio,
        encargado: encargado.toUpperCase(),
        direccionPunto: direccionPunto.toUpperCase(),
        telefonoPunto: telefonoPunto.toUpperCase(),
        cuentaBancaria: cuentaBancaria.toUpperCase(),
        banco: finalBanco,
        correoElectronico: correoElectronico.toUpperCase(),
        observaciones: (observaciones || '').toUpperCase(),
        primeraVezActualizado: true,
        fechaUltimaActualizacion: new Date().toISOString().split('T')[0],
      });
      setShowFirstLoginModal(false);
      setMsgForm1(
        '💾 Tus datos quedaron autoguardados en tu teléfono (sin conexión temporal) y se enviarán automáticamente cuando regrese la señal.'
      );
      setAccordionState({ modulo1: false, modulo2: true, modulo3: false, modulo4: false });
    } finally {
      setSavingFirstLogin(false);
    }
  };

  // Handler Contract Upload
  const handleContractUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingContract(true);
    setMsgForm3('');

    const formData = new FormData();
    formData.append('cedula', expendio.cedula);
    formData.append('contrato', file);

    try {
      const res = await fetch('/api/expendio/upload-contract', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        setMsgForm3('✓ Contrato PDF cargado con éxito.');
        onUpdateSessionData(data.data);
      } else {
        setMsgForm3(data.message || 'Error al subir contrato.');
      }
    } catch (err) {
      console.error('Error subiendo contrato:', err);
      setMsgForm3('Error al subir el contrato.');
    } finally {
      setUploadingContract(false);
    }
  };

  const handleUploadSuccessScanned = (nuevaCuenta: CuentaCargadaExpendio) => {
    setCuentasCargadas((prev) => [
      nuevaCuenta,
      ...prev.filter((c) => c.periodo.toUpperCase() !== nuevaCuenta.periodo.toUpperCase()),
    ]);
  };

  const handleIrAlMesActivo = () => {
    if (systemConfig?.periodoHabilitadoDescarga) {
      const parts = systemConfig.periodoHabilitadoDescarga.trim().split(/\s+/);
      if (parts.length >= 2) {
        setMesPeriodo(parts[0].toUpperCase());
        setAnioPeriodo(parts[1]);
      } else if (parts.length === 1) {
        setMesPeriodo(parts[0].toUpperCase());
      }
    }
  };

  // Construct dynamic CuentaCobroResult for Document modal view strictly from generated cuenta data
  const dCuenta = (cuentaGenerada.data || {}) as any;
  const baseVal = Number(dCuenta.cargoBasico ?? dCuenta.valorBase ?? 0) || 0;
  const sipostVal = Number(dCuenta.admisionSipost ?? 0) || 0;
  const varVal = Number(dCuenta.valorVariable ?? 0) || 0;
  const totalVal = Number(dCuenta.pagoTotal ?? dCuenta.valorBruto) || (baseVal + sipostVal + varVal);
  const retefVal = Number(dCuenta.retef1 ?? dCuenta.retencionValor ?? dCuenta.retefuente) || Math.round(totalVal * 0.01);
  const netoVal = Number(dCuenta.valorNeto ?? dCuenta.netoPagar) || (totalVal - retefVal);

  const docResultData: CuentaCobroResult = {
    ...(cuentaGenerada.data || {}),
    id: dCuenta.id || `preview_${expendio.id}`,
    encargado: dCuenta.encargado || expendio.encargado,
    expendio: dCuenta.expendio || expendio.municipio,
    cargoBasico: baseVal,
    valorBase: baseVal,
    admisionSipost: sipostVal,
    valorVariable: varVal,
    pagoTotal: totalVal,
    retef1: retefVal,
    retencionValor: retefVal,
    valorNeto: netoVal,
    cedula: dCuenta.cedula || expendio.cedula,
    nombre: dCuenta.nombre || dCuenta.encargado || expendio.encargado,
    municipio: dCuenta.municipio || expendio.municipio,
    centroOperativo: dCuenta.centroOperativo || expendio.centroOperativo || '',
    centroAcopio: dCuenta.centroAcopio || expendio.centroAcopio || expendio.municipio || '',
    direccion: dCuenta.direccion || expendio.direccionPunto || '',
    telefono: dCuenta.telefono || expendio.telefonoPunto || '',
    periodo: dCuenta.periodo || selectedPeriodStr,
    concepto: dCuenta.concepto || `Servicios de expendio postal 4-72 en el punto ${expendio.localidad || expendio.municipio}`,
    valorBruto: totalVal,
    porcentajeRetefuente: Number(dCuenta.porcentajeRetefuente ?? dCuenta.porcentajeRetencion ?? 1),
    retefuente: retefVal,
    porcentajeReteica: 0,
    reteica: 0,
    netoPagar: netoVal,
    banco: dCuenta.banco || expendio.banco || '',
    cuentaBancaria: dCuenta.cuentaBancaria || expendio.cuentaBancaria || '',
    fechaGeneracion: dCuenta.fechaGeneracion || dCuenta.fechaEmision || new Date().toISOString().split('T')[0],
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-2.5 sm:px-4 py-3 sm:py-5 space-y-3.5 sm:space-y-4.5">
      {/* 1. TOP EXPENDIO INFORMATION CARD */}
      <ExpendioHeaderCard
        expendio={expendio}
        isLight={isLight}
        onOpenCapacitacion={() => setShowBienvenidaModal(true)}
      />

      {/* 2. THREE-STEP PROGRESS TRACKER & ONBOARDING WORKFLOW */}
      <ExpendioStepProgress
        isDatosActualizados={isDatosActualizados}
        fotosCargadasCount={fotosCargadasCount}
        isRegistroFotograficoCompleto={isRegistroFotograficoCompleto}
        isModuloCuentasHabilitado={isModuloCuentasHabilitado}
        activeAccordion={accordionState}
        onOpenStep={handleOpenStep}
        isLight={isLight}
        lastLocalSaveTime={lastLocalSaveTime}
        hasPendingOfflineData={hasPendingOfflineData}
      />

      {/* 3. ACCORDION SECTIONS */}
      <div className="space-y-3.5 sm:space-y-4">
        {/* ========================================================================= */}
        {/* ACCORDION 1: ACTUALIZACIÓN DE DATOS (PASO 1)                              */}
        {/* ========================================================================= */}
        <div className={`rounded-2xl border-2 shadow-sm overflow-hidden transition-all ${
          accordionState.modulo1
            ? 'border-blue-600 ring-2 ring-blue-500/20 shadow-md'
            : isLight
            ? 'bg-white border-slate-300'
            : 'bg-slate-900 border-slate-800'
        }`}>
          <button
            type="button"
            onClick={() => toggleAccordion('modulo1')}
            className={`w-full px-3.5 sm:px-5 py-3.5 sm:py-4 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer border-b ${
              isLight
                ? accordionState.modulo1 ? 'bg-blue-50/70 border-blue-300' : 'bg-white hover:bg-slate-50 border-slate-300'
                : accordionState.modulo1 ? 'bg-blue-950/20 border-blue-900/60' : 'bg-slate-900 hover:bg-slate-800/60 border-slate-800'
            }`}
          >
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-amber-400 text-black border border-amber-600 font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                1
              </div>
              <div className="min-w-0">
                <h3 className="font-black text-sm sm:text-base tracking-tight flex items-center space-x-2 text-black">
                  <span className="truncate">1. ACTUALIZACIÓN DE DATOS</span>
                </h3>
                <p className="text-[11px] sm:text-xs text-black font-bold mt-0.5 leading-tight">
                  Contacto oficial, cuenta bancaria para pago y contrato digital.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              {isDatosActualizados ? (
                <span className="text-[11px] sm:text-xs font-black bg-emerald-400 text-black border border-emerald-600 px-2.5 py-1 rounded-full flex items-center space-x-1 shadow-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-black" />
                  <span className="text-black font-black">Al día</span>
                </span>
              ) : (
                <span className="text-[11px] sm:text-xs font-black bg-amber-400 text-black border border-amber-600 px-2.5 py-1 rounded-full flex items-center space-x-1 shadow-xs">
                  <AlertCircle className="w-3.5 h-3.5 text-black" />
                  <span className="text-black font-black">Pendiente</span>
                </span>
              )}
              <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-black font-bold">
                {accordionState.modulo1 ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </div>
            </div>
          </button>

          {accordionState.modulo1 && (
            <div className={`p-3.5 sm:p-5 space-y-4 ${isLight ? 'bg-slate-50/40' : 'bg-slate-950/40'}`}>
              <ExpendioDataUpdateModule
                expendio={expendio}
                encargado={encargado}
                setEncargado={setEncargado}
                cedulaInput={cedulaInput}
                setCedulaInput={setCedulaInput}
                telefonoPunto={telefonoPunto}
                setTelefonoPunto={setTelefonoPunto}
                direccionPunto={direccionPunto}
                setDireccionPunto={setDireccionPunto}
                cuentaBancaria={cuentaBancaria}
                setCuentaBancaria={setCuentaBancaria}
                tipoBanco={tipoBanco}
                setTipoBanco={setTipoBanco}
                otroBanco={otroBanco}
                setOtroBanco={setOtroBanco}
                setBanco={setBanco}
                correoElectronico={correoElectronico}
                setCorreoElectronico={setCorreoElectronico}
                observaciones={observaciones}
                setObservaciones={setObservaciones}
                savingForm1={savingForm1}
                msgForm1={msgForm1}
                onSaveContact={handleSaveContact}
                onContractUpload={handleContractUpload}
                uploadingContract={uploadingContract}
                msgForm3={msgForm3}
                isLight={isLight}
                lastLocalSaveTime={lastLocalSaveTime}
                hasPendingOfflineData={hasPendingOfflineData}
              />
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* ACCORDION 2: REGISTRO FOTOGRÁFICO DE 7 FOTOS (PASO 2)                     */}
        {/* ========================================================================= */}
        <div className={`rounded-2xl border-2 shadow-sm overflow-hidden transition-all ${
          accordionState.modulo2
            ? 'border-amber-600 ring-2 ring-amber-500/20 shadow-md'
            : isLight
            ? 'bg-white border-slate-300'
            : 'bg-slate-900 border-slate-800'
        }`}>
          <button
            type="button"
            onClick={() => toggleAccordion('modulo2')}
            className={`w-full px-3.5 sm:px-5 py-3.5 sm:py-4 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer border-b ${
              isLight
                ? accordionState.modulo2 ? 'bg-amber-50/70 border-amber-300' : 'bg-white hover:bg-slate-50 border-slate-300'
                : accordionState.modulo2 ? 'bg-amber-950/20 border-amber-900/60' : 'bg-slate-900 hover:bg-slate-800/60 border-slate-800'
            }`}
          >
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-black font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                2
              </div>
              <div className="min-w-0">
                <h3 className="font-black text-sm sm:text-base tracking-tight flex items-center space-x-2 text-black">
                  <span className="truncate">2. REGISTRO FOTOGRÁFICO (7 FOTOS)</span>
                </h3>
                <p className="text-[11px] sm:text-xs text-black font-bold mt-0.5 leading-tight">
                  7 fotos obligatorias con cámara nativa del celular y marca de agua oficial.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <span className={`text-[11px] sm:text-xs font-black px-3 py-1 rounded-full shadow-xs ${
                isRegistroFotograficoCompleto
                  ? 'bg-emerald-400 text-black border border-emerald-600'
                  : 'bg-amber-400 text-black border border-amber-600'
              }`}>
                {fotosCargadasCount}/7 Fotos
              </span>
              <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-black font-bold">
                {accordionState.modulo2 ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </div>
            </div>
          </button>

          {accordionState.modulo2 && (
            <div className={`p-3.5 sm:p-5 space-y-4 ${isLight ? 'bg-slate-50/40' : 'bg-slate-950/40'}`}>
              <ExpendioPhotosGrid
                expendio={expendio}
                localPhotos={localPhotos}
                uploadingPhotoType={uploadingPhotoType}
                onOpenGpsCamera={handleOpenGpsCamera}
                onUploadPhotoWithGps={handlePhotoUploadWithGps}
                onViewPhotoDetail={(photo) => {
                  setViewingPhotoDetail(photo);
                }}
                onRequestGpsPermission={requestGpsPermission}
                isRequestingGps={isRequestingGps}
                gpsStatusMsg={gpsStatusMsg}
                globalCoords={globalCoords}
                offlineQueue={offlineQueue}
                isSyncingOffline={isSyncingOffline}
                syncStatusMsg={syncStatusMsg}
                uploadStatusMsg={msgForm2}
                onSyncOffline={handleSyncOffline}
                onToggleItemAvailability={handleToggleItemAvailability}
                savingItemKey={savingItemKey}
                isLight={isLight}
              />
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* ACCORDION 3: CUENTAS DE COBRO (PASO 3)                                    */}
        {/* ========================================================================= */}
        <div className={`rounded-2xl border-2 shadow-sm overflow-hidden transition-all ${
          accordionState.modulo3
            ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-md'
            : isModuloCuentasHabilitado
            ? isLight
              ? 'bg-white border-emerald-300'
              : 'bg-slate-900 border-emerald-500/40'
            : isLight
            ? 'bg-white border-slate-200 opacity-95'
            : 'bg-slate-900 border-slate-800'
        }`}>
          <button
            type="button"
            onClick={() => toggleAccordion('modulo3')}
            className={`w-full px-3.5 sm:px-5 py-3.5 sm:py-4 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer border-b ${
              isLight
                ? accordionState.modulo3 ? 'bg-emerald-50/70 border-emerald-300' : 'bg-white hover:bg-slate-50 border-slate-300'
                : accordionState.modulo3 ? 'bg-emerald-950/20 border-emerald-900/60' : 'bg-slate-900 hover:bg-slate-800/60 border-slate-800'
            }`}
          >
            <div className="flex items-center space-x-3 min-w-0">
              <div className={`w-9 h-9 rounded-xl font-black text-sm flex items-center justify-center shrink-0 shadow-xs ${
                isModuloCuentasHabilitado
                  ? 'bg-emerald-400 text-black border border-emerald-600'
                  : 'bg-slate-300 text-black font-black border border-slate-500'
              }`}>
                3
              </div>
              <div className="min-w-0">
                <h3 className="font-black text-sm sm:text-base tracking-tight flex items-center space-x-2 text-black">
                  <span className="truncate">3. CUENTAS DE COBRO</span>
                  <span className="text-black text-[10px] sm:text-xs font-mono font-black bg-amber-300 border border-amber-500 px-2 py-0.5 rounded-full shrink-0">
                    {periodoHabilitadoStr}
                  </span>
                </h3>
                <p className="text-[11px] sm:text-xs text-black font-bold mt-0.5 leading-tight">
                  Liquidación oficial, descarga PDF y escaneo de cuenta firmada.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <span className={`text-[11px] sm:text-xs font-black px-3 py-1 rounded-full shadow-xs ${
                isModuloCuentasHabilitado
                  ? 'bg-emerald-400 text-black border border-emerald-600'
                  : 'bg-amber-400 text-black border border-amber-600'
              }`}>
                {isModuloCuentasHabilitado ? 'Habilitado 🔓' : 'Bloqueado 🔒'}
              </span>
              <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-black font-bold">
                {accordionState.modulo3 ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </div>
            </div>
          </button>

          {accordionState.modulo3 && (
            <div className={`p-3.5 sm:p-5 space-y-4 ${isLight ? 'bg-slate-50/40' : 'bg-slate-950/40'}`}>
              <ExpendioAccountsModule
                expendio={expendio}
                isDatosActualizados={isDatosActualizados}
                fotosCargadasCount={fotosCargadasCount}
                isRegistroFotograficoCompleto={isRegistroFotograficoCompleto}
                isModuloCuentasHabilitado={isModuloCuentasHabilitado}
                onOpenStep={handleOpenStep}
                systemConfig={systemConfig}
                mesPeriodo={mesPeriodo}
                setMesPeriodo={setMesPeriodo}
                anioPeriodo={anioPeriodo}
                setAnioPeriodo={setAnioPeriodo}
                checkingCuenta={checkingCuenta}
                checkCuentaCobroPeriodo={checkCuentaCobroPeriodo}
                cuentaGenerada={cuentaGenerada}
                periodoHabilitadoStr={periodoHabilitadoStr}
                selectedPeriodStr={selectedPeriodStr}
                isPeriodoHabilitadoParaDescarga={isPeriodoHabilitadoParaDescarga}
                handleIrAlMesActivo={handleIrAlMesActivo}
                onOpenDocModal={() => setShowDocModal(true)}
                onOpenScannerModal={() => setShowScannerModal(true)}
                cuentasCargadas={cuentasCargadas}
                onViewScannedPhoto={(url) => setViewingScannedPhotoUrl(url)}
                isLight={isLight}
              />
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* ACCORDION 4: DOCUMENTACIÓN OFICIAL 4-72 & CONTRATOS                       */}
        {/* ========================================================================= */}
        <div
          id="accordion-documentos-oficiales"
          className={`rounded-2xl border-2 shadow-sm overflow-hidden transition-all ${
            accordionState.modulo4
              ? 'border-indigo-600 ring-2 ring-indigo-500/20 shadow-md'
              : isLight
              ? 'bg-white border-slate-300 hover:border-slate-400'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <button
            type="button"
            onClick={() => toggleAccordion('modulo4')}
            className={`w-full px-3.5 sm:px-5 py-3.5 sm:py-4 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer border-b ${
              isLight
                ? accordionState.modulo4
                  ? 'bg-indigo-50/70 border-indigo-300'
                  : 'bg-white hover:bg-slate-50 border-slate-300'
                : accordionState.modulo4
                ? 'bg-indigo-950/20 border-indigo-900/60'
                : 'bg-slate-900 hover:bg-slate-800/60 border-slate-800'
            }`}
          >
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-indigo-300 text-black border border-indigo-600 font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                4
              </div>
              <div className="min-w-0">
                <h3 className="font-black text-sm sm:text-base tracking-tight flex items-center space-x-2 text-black">
                  <span className="truncate">4. DOCUMENTACIÓN INSTITUCIONAL Y CONTRATOS</span>
                </h3>
                <p className="text-[11px] sm:text-xs text-black font-bold mt-0.5 leading-tight">
                  Horario oficial de atención (4-72), Minuta de contrato (13 págs), aviso para punto y circulares.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <span className="text-[11px] sm:text-xs font-black bg-amber-300 text-black border border-amber-500 px-3 py-1 rounded-full flex items-center space-x-1 shadow-xs">
                <Sparkles className="w-3.5 h-3.5 text-black" />
                <span className="text-black font-black">Formatos Oficiales</span>
              </span>
              <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-black font-bold">
                {accordionState.modulo4 ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </div>
            </div>
          </button>

          {accordionState.modulo4 && (
            <div className={`p-3.5 sm:p-5 space-y-4 ${isLight ? 'bg-slate-50/40' : 'bg-slate-950/40'}`}>
              <ExpendioDocumentosDownloadModule expendio={expendio} isLight={isLight} />
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. MODALS (BIENVENIDA/CAPACITACIÓN, FIRST LOGIN, PHOTOS, SCANNER)         */}
      {/* ========================================================================= */}
      {/* Modal de Bienvenida Personalizada y Capacitación para primer ingreso */}
      <ExpendioBienvenidaCapacitacionModal
        isOpen={showBienvenidaModal}
        onClose={handleCloseBienvenidaModal}
        expendio={expendio}
        isLight={isLight}
      />

      <ExpendioFirstLoginModal
        isOpen={showFirstLoginModal}
        encargado={encargado}
        setEncargado={setEncargado}
        cedulaInput={cedulaInput}
        setCedulaInput={setCedulaInput}
        direccionPunto={direccionPunto}
        setDireccionPunto={setDireccionPunto}
        telefonoPunto={telefonoPunto}
        setTelefonoPunto={setTelefonoPunto}
        cuentaBancaria={cuentaBancaria}
        setCuentaBancaria={setCuentaBancaria}
        tipoBanco={tipoBanco}
        setTipoBanco={setTipoBanco}
        otroBanco={otroBanco}
        setOtroBanco={setOtroBanco}
        setBanco={setBanco}
        correoElectronico={correoElectronico}
        setCorreoElectronico={setCorreoElectronico}
        observaciones={observaciones}
        setObservaciones={setObservaciones}
        savingFirstLogin={savingFirstLogin}
        msgFirstLogin={msgFirstLogin}
        onSubmit={handleSaveFirstLogin}
        onClose={handleDismissFirstLogin}
        onDismiss={handleDismissFirstLogin}
        onAutoFillTest={handleAutoFillTestData}
      />

      {/* GPS Camera Modal */}
      {gpsCaptureModal && (
        <CameraGpsCaptureModal
          isOpen={Boolean(gpsCaptureModal)}
          slotKey={gpsCaptureModal.slotKey}
          slotTitle={gpsCaptureModal.slotTitle}
          expendio={expendio}
          initialFile={gpsCaptureModal.initialFile}
          onClose={() => setGpsCaptureModal(null)}
          onCaptureConfirmed={handlePhotoCapturedFromModal}
        />
      )}

      {/* CamScanner Camera Magia Pro Modal */}
      {showScannerModal && (
        <ScannerCameraModal
          isOpen={showScannerModal}
          cedula={expendio.cedula}
          periodoDefault={selectedPeriodStr}
          expendio={expendio.localidad || 'EXPENDIO'}
          encargado={expendio.encargado || ''}
          municipio={expendio.municipio || ''}
          onClose={() => setShowScannerModal(false)}
          onUploadSuccess={handleUploadSuccessScanned}
        />
      )}

      {/* Official Cuenta de Cobro Document Modal */}
      {showDocModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full p-6 space-y-4 my-8 max-h-[90vh] overflow-y-auto text-slate-900">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-black text-lg text-slate-900 uppercase">
                Cuenta de Cobro Oficial - {selectedPeriodStr}
              </h3>
              <button
                onClick={() => setShowDocModal(false)}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <CuentaCobroDocument
              cuentas={[docResultData]}
              cuenta={docResultData}
              allowDownload={isPeriodoHabilitadoParaDescarga}
              downloadRestrictionMsg={`La descarga oficial está configurada únicamente para el periodo activo: ${periodoHabilitadoStr}.`}
              isExpendioRole={true}
              onClose={() => setShowDocModal(false)}
            />
          </div>
        </div>
      )}

      {/* Photo Detail Zoom & Inspection Modal */}
      {viewingPhotoDetail && (
        <PhotoLightboxModal
          isOpen={!!viewingPhotoDetail}
          onClose={() => setViewingPhotoDetail(null)}
          imageUrl={viewingPhotoDetail.url}
          title={viewingPhotoDetail.title}
          subtitle={`Expendio: ${expendio.localidad} | Municipio: ${expendio.municipio}`}
          metadata={{
            encargado: expendio.encargado,
            cedula: expendio.cedula,
            municipio: expendio.municipio,
            direccion: expendio.direccionPunto,
            telefono: expendio.telefonoPunto,
          }}
        />
      )}

      {/* Scanned Account Zoom & Inspection Modal */}
      {viewingScannedPhotoUrl && (
        <PhotoLightboxModal
          isOpen={!!viewingScannedPhotoUrl}
          onClose={() => setViewingScannedPhotoUrl(null)}
          imageUrl={viewingScannedPhotoUrl}
          title="Cuenta de Cobro Escaneada (Filtro Magia Pro)"
          subtitle={`Expendio: ${expendio.localidad} | Cédula: ${expendio.cedula}`}
          metadata={{
            encargado: expendio.encargado,
            cedula: expendio.cedula,
            municipio: expendio.municipio,
            direccion: expendio.direccionPunto,
            telefono: expendio.telefonoPunto,
          }}
        />
      )}
    </div>
  );
};
