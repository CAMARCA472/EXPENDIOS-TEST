import { AuthenticatedImage } from './AuthenticatedImage';
import React, { useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Eye,
  Upload,
  RefreshCw,
  AlertCircle,
  HelpCircle,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { ExpendioData } from '../types';
import { ReportarFaltaItemModal } from './ReportarFaltaItemModal';
import { isRealPhoto } from '../utils/photoValidation';
import {
  usePhotoCacheVerification,
  isPhotoConsistentWithExpendio,
  auditAndHealExpendioPhotoConsistency,
} from '../lib/photoCacheHandler';
import { ExpendioUploadProgressPanel } from './ExpendioUploadProgressPanel';
import { reportPlatformError } from '../utils/errorLogger';

/**
 * Componente de vista previa con verificación de caché explícita y botón claro de recarga
 */
const PhotoSlotPreview: React.FC<{
  expendioId?: string;
  cedula?: string;
  slotKey: string;
  slotTitle: string;
  photoUrl: string;
  isLight: boolean;
  onViewPhotoDetail: (photo: { title: string; url: string }) => void;
}> = ({ expendioId, cedula, slotKey, slotTitle, photoUrl, onViewPhotoDetail }) => {
  const { isError, isVerifying, errorMessage, resolvedDataUrl, reloadImage } =
    usePhotoCacheVerification(cedula, slotKey, photoUrl, { expendioId });

  if (isError) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center p-4 text-center space-y-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-400 dark:border-amber-700/50 rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-11 h-11 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <span className="text-sm font-black text-amber-950 dark:text-amber-200 block">
            No se pudo mostrar la imagen
          </span>
          <span className="text-xs text-slate-700 dark:text-slate-300 font-bold block line-clamp-2 max-w-[240px]">
            {errorMessage || 'Toca el botón de abajo para volver a cargarla'}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            reloadImage();
          }}
          disabled={isVerifying}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm flex items-center space-x-2 shadow-sm active:scale-95 transition-all cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isVerifying ? 'animate-spin' : ''}`} />
          <span>{isVerifying ? 'Cargando foto...' : 'Volver a Cargar Foto'}</span>
        </button>
      </div>
    );
  }

  const displaySrc = resolvedDataUrl || photoUrl;

  return (
    <>
      <AuthenticatedImage
        src={displaySrc}
        alt={slotTitle}
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      />
      {isVerifying && (
        <div className="absolute top-2.5 right-2.5 bg-slate-950/85 text-amber-300 text-xs px-2.5 py-1 rounded-lg font-bold flex items-center space-x-1.5 shadow-sm z-10">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Verificando...</span>
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-3 flex items-center justify-center text-white text-xs sm:text-sm font-bold space-x-1.5">
        <Eye className="w-4 h-4 text-amber-400 shrink-0" />
        <span>Toca la foto para verla en pantalla grande</span>
      </div>
    </>
  );
};

export interface PhotoSlotItem {
  key: string;
  stepNumber: number;
  title: string;
  friendlyTitle: string;
  sublabel: string;
  required: boolean;
  allowsNotAvailable?: boolean;
  notAvailableQuestion?: string;
}

export const PHOTO_SLOTS: PhotoSlotItem[] = [
  {
    key: 'fotoAvisoUrl',
    stepNumber: 1,
    title: '1. FOTO AVISO',
    friendlyTitle: 'Aviso Exterior (Letrero de 4-72)',
    sublabel: 'Toma la foto desde afuera donde se vea claro el aviso o letrero del expendio.',
    required: true,
    allowsNotAvailable: true,
    notAvailableQuestion: '¿No tienes aviso exterior?',
  },
  {
    key: 'fotoPanoramicaUrl',
    stepNumber: 2,
    title: '2. FOTO PANORÁMICA',
    friendlyTitle: 'Fachada Completa del Local',
    sublabel: 'Da unos pasos atrás y toma una foto amplia donde se vea la entrada y el local.',
    required: true,
  },
  {
    key: 'fotoMataselloUrl',
    stepNumber: 3,
    title: '3. FOTO MATASELLO',
    friendlyTitle: 'Sello / Matasello Postal',
    sublabel: 'Coloca el matasello sobre el mostrador y tómale una foto de cerca.',
    required: true,
    allowsNotAvailable: true,
    notAvailableQuestion: '¿No tienes matasello en el punto?',
  },
  {
    key: 'fotoBasculaUrl',
    stepNumber: 4,
    title: '4. FOTO BÁSCULA',
    friendlyTitle: 'Báscula o Pesa para Correo',
    sublabel: 'Toma una foto donde se vea completa la báscula o balanza del expendio.',
    required: true,
    allowsNotAvailable: true,
    notAvailableQuestion: '¿No tienes báscula en el punto?',
  },
  {
    key: 'fotoContratistaUrl',
    stepNumber: 5,
    title: '5. FOTO CONTRATISTA',
    friendlyTitle: 'Foto del Encargado en el Punto',
    sublabel: 'Una foto tuya (o de quien atiende) dentro del punto de atención 4-72.',
    required: true,
  },
  {
    key: 'fotoHorarioUrl',
    stepNumber: 6,
    title: '6. FOTO HORARIO',
    friendlyTitle: 'Hoja de Horario de Atención',
    sublabel: 'Foto de la hoja del horario de atención pegada en un lugar visible al público.',
    required: true,
  },
  {
    key: 'fotoTarifasUrl',
    stepNumber: 7,
    title: '7. FOTO TARIFAS',
    friendlyTitle: 'Afiche o Tabla de Tarifas',
    sublabel: 'Foto del cuadro de tarifas oficiales de 4-72 publicado en la pared o mostrador.',
    required: true,
  },
];

interface ExpendioPhotosGridProps {
  expendio: ExpendioData;
  localPhotos: Record<string, string>;
  uploadingPhotoType: string | null;
  onOpenGpsCamera: (slotKey: string, slotTitle: string, initialFile?: File | null) => void;
  onUploadPhotoWithGps: (
    e: React.ChangeEvent<HTMLInputElement>,
    photoType: string,
    slotTitle: string
  ) => void;
  onViewPhotoDetail: (photo: { title: string; url: string }) => void;
  onRequestGpsPermission?: () => void;
  isRequestingGps?: boolean;
  gpsStatusMsg?: string;
  globalCoords?: any;
  offlineQueue?: any[];
  isSyncingOffline?: boolean;
  syncStatusMsg?: string;
  uploadStatusMsg?: string;
  onSyncOffline?: () => void;
  isLight?: boolean;
  onToggleItemAvailability?: (slotKey: string, tiene: 'SI' | 'NO', motivo?: string) => void;
  savingItemKey?: string | null;
}

export const ExpendioPhotosGrid: React.FC<ExpendioPhotosGridProps> = ({
  expendio,
  localPhotos,
  uploadingPhotoType,
  onOpenGpsCamera,
  onViewPhotoDetail,
  offlineQueue = [],
  isSyncingOffline = false,
  syncStatusMsg,
  uploadStatusMsg,
  onSyncOffline,
  isLight = true,
  onToggleItemAvailability,
  savingItemKey = null,
}) => {
  const [modalFalta, setModalFalta] = useState<{
    isOpen: boolean;
    slotKey: string;
    slotTitle: string;
  }>({
    isOpen: false,
    slotKey: '',
    slotTitle: '',
  });

  const [isAuditingConsistency, setIsAuditingConsistency] = useState(false);
  const [consistencyResult, setConsistencyResult] = useState<{
    audited: boolean;
    isConsistent: boolean;
    purgedCount: number;
    message: string;
  } | null>(null);

  const handleRunConsistencyCheck = async () => {
    if (!expendio) return;
    setIsAuditingConsistency(true);
    setConsistencyResult(null);
    try {
      const res = await auditAndHealExpendioPhotoConsistency({
        id: expendio.id,
        cedula: expendio.cedula,
        municipio: expendio.municipio,
        encargado: expendio.encargado,
      });

      // Solo notificar al usuario si hubo una discrepancia o error real
      if (res.inconsistenciesPurged > 0) {
        setConsistencyResult({
          audited: true,
          isConsistent: res.isConsistent,
          purgedCount: res.inconsistenciesPurged,
          message: 'Se actualizaron las fotografías de tu punto para asegurar que correspondan exactamente a tu municipio.',
        });
        reportPlatformError({
          errorCode: 'PHOTO_CROSS_CONTAMINATION_PREVENTED',
          expendio: { id: expendio.id, municipio: expendio.municipio, cedula: expendio.cedula },
          userMessage: 'Se actualizaron las fotografías de tu punto para asegurar que correspondan exactamente a tu municipio.',
          technicalDetails: `Se purgaron ${res.inconsistenciesPurged} archivos en caché que no correspondían al expendio ID ${expendio.id}`,
          category: 'FOTOS_S3',
          severity: 'INFORMATIVO',
        });
      } else {
        setConsistencyResult(null);
      }
    } catch (err: any) {
      setConsistencyResult({
        audited: true,
        isConsistent: false,
        purgedCount: 1, // Desencadenar aviso amigable de contingencia
        message: 'No se pudo sincronizar el estado con el servidor. Si tienes fotos pendientes, se encuentran guardadas de forma segura en tu teléfono.',
      });
      reportPlatformError({
        errorCode: 'PHOTO_S3_STORAGE_UNREACHABLE',
        expendio: { id: expendio.id, municipio: expendio.municipio, cedula: expendio.cedula },
        userMessage: 'No se pudo sincronizar con el servidor. Fotos guardadas en el teléfono.',
        technicalDetails: `Error de consistencia: ${err?.message || 'Error de conexión'}`,
        category: 'FOTOS_S3',
        severity: 'ALTO',
      });
    } finally {
      setIsAuditingConsistency(false);
    }
  };

  const getPhotoUrl = (key: string): string => {
    let url = '';
    if (isRealPhoto(localPhotos[key])) {
      url = localPhotos[key];
    } else {
      const expObj = expendio as any;
      if (isRealPhoto(expObj?.[key])) url = expObj[key];
      else if (key === 'fotoAvisoUrl' && isRealPhoto(expObj?.letreroUrl)) url = expObj.letreroUrl;
      else if (key === 'fotoMataselloUrl' && isRealPhoto(expObj?.mataselloUrl)) url = expObj.mataselloUrl;
      else if (key === 'fotoBasculaUrl' && isRealPhoto(expObj?.basculaUrl)) url = expObj.basculaUrl;
    }

    if (!url) return '';
    // Consistencia estricta: Descartar si la URL apunta a otro expendio (ej. Pamplona o Girón cuando se está en Togüí o Landázuri)
    if (!isPhotoConsistentWithExpendio(url, expendio)) {
      return '';
    }

    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return url;
    }

    const cleanUrl = url.split('?')[0];
    const rev = expendio?.revision || 1;
    return `${cleanUrl}?v=${rev}`;
  };

  const isItemMarkedNo = (key: string): boolean => {
    if (key === 'fotoAvisoUrl') return expendio?.tieneAviso === 'NO';
    if (key === 'fotoMataselloUrl') return expendio?.tieneMatasello === 'NO';
    if (key === 'fotoBasculaUrl') return expendio?.tieneBascula === 'NO';
    return false;
  };

  const getItemMotivo = (key: string): string => {
    if (key === 'fotoAvisoUrl') return expendio?.motivoFaltaAviso || '';
    if (key === 'fotoMataselloUrl') return expendio?.motivoFaltaMatasello || '';
    if (key === 'fotoBasculaUrl') return expendio?.motivoFaltaBascula || '';
    return '';
  };

  const isSlotFulfilled = (key: string): boolean => {
    return Boolean(getPhotoUrl(key)) || isItemMarkedNo(key);
  };

  const totalLoaded = PHOTO_SLOTS.filter((s) => isSlotFulfilled(s.key)).length;
  const photosUploadedCount = PHOTO_SLOTS.filter((s) => Boolean(getPhotoUrl(s.key))).length;
  const itemsNotAvailableCount = PHOTO_SLOTS.filter((s) => isItemMarkedNo(s.key)).length;

  return (
    <div className="space-y-4">
      {/* Encabezado de Progreso Fotográfico Claro y Legible */}
      <div
        className={`p-4 sm:p-5 rounded-2xl border-2 transition-all ${
          totalLoaded >= 7
            ? 'bg-emerald-50 border-emerald-500 text-slate-950 shadow-sm'
            : isLight
            ? 'bg-amber-50/70 border-amber-400 text-slate-950 shadow-sm'
            : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3.5 min-w-0">
            <div
              className={`w-14 h-14 rounded-2xl flex items-center justify-center font-mono tabular-nums font-black text-lg shrink-0 shadow-sm ${
                totalLoaded >= 7
                  ? 'bg-emerald-500 text-slate-950 border-2 border-emerald-700'
                  : 'bg-amber-400 text-slate-950 border-2 border-amber-600'
              }`}
            >
              {totalLoaded}/7
            </div>
            <div className="min-w-0">
              <h4 className="font-black text-base sm:text-lg tracking-tight text-slate-950 dark:text-white leading-snug">
                {totalLoaded >= 7
                  ? '¡Todo al día! Ya completaste tus 7/7 fotos y tus datos están actualizados'
                  : `Fotos de tu Expendio: Llevas ${totalLoaded} de 7 listas`}
              </h4>
              <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 font-bold mt-0.5">
                {totalLoaded >= 7
                  ? `${photosUploadedCount} fotos subidas${
                      itemsNotAvailableCount > 0
                        ? ` y ${itemsNotAvailableCount} reportada(s) como no disponible`
                        : ''
                    }. Ya puedes pasar a tu Cuenta de Cobro.`
                  : `Te faltan ${7 - totalLoaded} foto(s). Toca el botón amarillo grande en cada recuadro para tomarlas con tu celular.`}
              </p>
            </div>
          </div>

          <div className="shrink-0 text-xs font-black text-sky-900 dark:text-sky-300">
            Compresión automática activa (~400 KB para señal 2G/3G)
          </div>
        </div>

        {/* Barra de progreso grande */}
        <div className="w-full bg-slate-200 dark:bg-slate-800 h-3 rounded-full overflow-hidden mt-3.5 border border-slate-300 dark:border-slate-700">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              totalLoaded >= 7 ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.min(100, (totalLoaded / 7) * 100)}%` }}
          />
        </div>

        <ExpendioUploadProgressPanel
          cedula={expendio?.cedula}
          totalLoadedPhotos={photosUploadedCount}
          uploadingPhotoType={uploadingPhotoType}
          offlineQueue={offlineQueue}
          isSyncingOffline={isSyncingOffline}
          onSyncOffline={onSyncOffline}
          isLight={isLight}
        />

        {uploadStatusMsg && (
          <div className="mt-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border-2 border-emerald-500 text-emerald-950 dark:text-emerald-100 text-sm font-black flex items-start space-x-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{uploadStatusMsg}</span>
          </div>
        )}

        {syncStatusMsg && (
          <div className="mt-3 p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 border-2 border-blue-400 text-blue-950 dark:text-blue-100 text-sm font-black flex items-start space-x-2.5">
            <RefreshCw className="w-5 h-5 text-blue-600 shrink-0 mt-0.5 animate-spin" />
            <span className="leading-relaxed">{syncStatusMsg}</span>
          </div>
        )}
      </div>

      {/* Aviso amigable para el expendio ÚNICAMENTE cuando ocurre una discrepancia o error */}
      {consistencyResult && consistencyResult.purgedCount > 0 && (
        <div
          className="p-3 sm:p-3.5 rounded-xl border text-xs font-bold flex items-center space-x-2.5 bg-amber-50 dark:bg-amber-950/60 border-amber-400 text-amber-950 dark:text-amber-200 animate-fadeIn"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="leading-relaxed">{consistencyResult.message}</span>
        </div>
      )}

      {/* Lista Vertical de 1 Columna en Celular (md: 2 columnas en tablet/PC) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PHOTO_SLOTS.map((slot) => {
          const photoUrl = getPhotoUrl(slot.key);
          const isLoaded = Boolean(photoUrl);
          const isUploading = uploadingPhotoType === slot.key;
          const isMarkedNo = isItemMarkedNo(slot.key);
          const isSavingItem = savingItemKey === slot.key;

          return (
            <div
              key={slot.key}
              className={`rounded-2xl border-2 p-4 sm:p-5 space-y-3.5 flex flex-col justify-between transition-all ${
                isMarkedNo
                  ? isLight
                    ? 'bg-amber-50/90 border-amber-500 shadow-sm'
                    : 'bg-amber-950/25 border-amber-500/60 shadow-sm'
                  : isLoaded
                  ? isLight
                    ? 'bg-white border-emerald-500 shadow-sm'
                    : 'bg-slate-900 border-emerald-500/60 shadow-sm'
                  : isLight
                  ? 'bg-white border-slate-300 shadow-sm'
                  : 'bg-slate-900 border-slate-800'
              }`}
            >
              {/* Encabezado de la Tarjeta Fotográfica: Numeración Clara + Estado en Español Sencillo */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs sm:text-sm font-mono tabular-nums font-black uppercase tracking-wide text-amber-800 dark:text-amber-400">
                    FOTO {slot.stepNumber} DE 7
                  </span>

                  {isMarkedNo ? (
                    <span className="text-xs sm:text-sm font-black text-amber-900 dark:text-amber-300 flex items-center space-x-1 shrink-0">
                      <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>REPORTADO: NO LO TENGO</span>
                    </span>
                  ) : isLoaded ? (
                    <span className="text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-400 flex items-center space-x-1 shrink-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>✓ YA SUBIDA</span>
                    </span>
                  ) : (
                    <span className="text-xs sm:text-sm font-black text-amber-800 dark:text-amber-300 flex items-center space-x-1 shrink-0">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>FALTA TOMAR</span>
                    </span>
                  )}
                </div>

                <h5
                  className={`font-black text-base sm:text-lg leading-snug ${
                    isLight ? 'text-slate-950' : 'text-white'
                  }`}
                >
                  {slot.friendlyTitle}
                </h5>

                <p
                  className={`text-xs sm:text-sm leading-relaxed font-semibold ${
                    isLight ? 'text-slate-700' : 'text-slate-300'
                  }`}
                >
                  {slot.sublabel}
                </p>
              </div>

              {/* Recuadro de Vista Previa Amplio (h-52) */}
              <div
                onClick={() => {
                  if (isLoaded) onViewPhotoDetail({ title: slot.friendlyTitle, url: photoUrl });
                }}
                className={`h-52 rounded-2xl overflow-hidden border-2 flex items-center justify-center relative group transition-all ${
                  isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-950 border-slate-800'
                } ${isLoaded ? 'cursor-pointer hover:border-amber-500' : ''}`}
              >
                {isLoaded ? (
                  <PhotoSlotPreview
                    expendioId={expendio?.id}
                    cedula={expendio?.cedula}
                    slotKey={slot.key}
                    slotTitle={slot.friendlyTitle}
                    photoUrl={photoUrl}
                    isLight={isLight}
                    onViewPhotoDetail={onViewPhotoDetail}
                  />
                ) : isMarkedNo ? (
                  <div className="text-center p-5 space-y-1.5">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center mx-auto border border-amber-400">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <span className="text-sm font-black text-amber-950 dark:text-amber-200 block">
                      Reportaste que no tienes este elemento
                    </span>
                    {getItemMotivo(slot.key) && (
                      <span className="text-xs font-bold text-amber-950 dark:text-amber-200 block bg-amber-500/20 px-3 py-1 rounded-lg">
                        Motivo: {getItemMotivo(slot.key)}
                      </span>
                    )}
                    <span className="text-xs text-slate-700 dark:text-slate-300 font-semibold block">
                      Si ya te entregaron este elemento, toca el botón amarillo abajo para subir su foto.
                    </span>
                  </div>
                ) : (
                  <div className="text-center p-5 space-y-1.5">
                    <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-700 flex items-center justify-center mx-auto border-2 border-amber-400">
                      <Camera className="w-7 h-7" />
                    </div>
                    <span className="text-sm sm:text-base font-black text-slate-950 dark:text-slate-100 block">
                      Aún no has subido esta foto
                    </span>
                    <span className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 font-semibold block">
                      Toca el botón amarillo grande de abajo para abrir tu cámara
                    </span>
                  </div>
                )}
              </div>

              {/* Botones Grandes y Fáciles de Tocar para Personas Mayores */}
              <div className="space-y-2.5 pt-1">
                {/* 1. Botón Principal Grande (54px): Tomar Foto con la Cámara */}
                <label
                  className={`w-full min-h-[54px] font-black py-3 px-4 rounded-xl text-sm sm:text-base flex items-center justify-center space-x-2.5 shadow-md cursor-pointer transition-all active:scale-98 border-2 ${
                    isLoaded
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-700'
                      : 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-700'
                  }`}
                >
                  <Camera className="w-5 h-5 shrink-0" />
                  <span>
                    {isUploading
                      ? 'Subiendo foto...'
                      : isLoaded
                      ? 'Cambiar / Tomar Nueva Foto'
                      : isMarkedNo
                      ? 'Ya lo tengo: Tomar Foto Ahora'
                      : 'Tomar Foto con la Cámara'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={Boolean(isUploading)}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        onOpenGpsCamera(slot.key, slot.title, file);
                      }
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                </label>

                {/* 2. Botón Secundario Grande (48px): Elegir de la Galería */}
                <label
                  className={`w-full min-h-[48px] font-black py-2.5 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center space-x-2 cursor-pointer border-2 transition-colors ${
                    isLight
                      ? 'bg-slate-50 hover:bg-slate-100 text-slate-950 border-slate-400'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-600'
                  }`}
                >
                  <Upload className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Elegir foto guardada en mi galería</span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={Boolean(isUploading)}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        onOpenGpsCamera(slot.key, slot.title, file);
                      }
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                </label>

                {/* 3. Opción Clara si no dispone del elemento (Aviso, Matasello o Báscula) */}
                {slot.allowsNotAvailable && (
                  <div className="pt-1">
                    {isMarkedNo ? (
                      <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-amber-500/20 border-2 border-amber-500/40">
                        <span className="text-xs sm:text-sm font-black text-amber-950 dark:text-amber-200 flex items-center space-x-1.5">
                          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                          <span>Reportado como No Disponible</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onToggleItemAvailability?.(slot.key, 'SI')}
                          disabled={Boolean(isSavingItem)}
                          className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-amber-600 text-xs font-black text-slate-950 dark:text-white cursor-pointer"
                        >
                          {isSavingItem ? 'Cambiando...' : 'Sí lo tengo'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setModalFalta({
                            isOpen: true,
                            slotKey: slot.key,
                            slotTitle: slot.title,
                          })
                        }
                        disabled={Boolean(isSavingItem)}
                        className={`w-full min-h-[46px] py-2.5 px-3.5 rounded-xl text-xs sm:text-sm font-black border-2 flex items-center justify-between transition-colors cursor-pointer ${
                          isLight
                            ? 'bg-amber-50/70 hover:bg-amber-100 text-slate-950 border-amber-400'
                            : 'bg-slate-800/70 hover:bg-amber-950/40 text-slate-100 border-slate-700'
                        }`}
                      >
                        <span className="flex items-center space-x-1.5 truncate">
                          <HelpCircle className="w-4 h-4 text-amber-700 shrink-0" />
                          <span className="truncate">
                            {slot.notAvailableQuestion || '¿No tienes este elemento?'}
                          </span>
                        </span>
                        <span className="font-black text-amber-800 dark:text-amber-300 underline shrink-0 ml-2">
                          {isSavingItem ? 'Guardando...' : 'Toca aquí'}
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal para reportar implemento no disponible */}
      <ReportarFaltaItemModal
        isOpen={modalFalta.isOpen}
        onClose={() => setModalFalta({ isOpen: false, slotKey: '', slotTitle: '' })}
        slotKey={modalFalta.slotKey}
        slotTitle={modalFalta.slotTitle}
        expendio={expendio}
        onConfirm={async (slotKey, motivo) => {
          if (onToggleItemAvailability) {
            await onToggleItemAvailability(slotKey, 'NO', motivo);
          }
        }}
        isLight={isLight}
      />
    </div>
  );
};
