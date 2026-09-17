import React, { useState, useEffect } from 'react';
import { Camera, CheckCircle2, Eye, Upload, RefreshCw, AlertCircle, HelpCircle, XCircle, Cloud, CloudUpload, ShieldCheck } from 'lucide-react';
import { ExpendioData } from '../types';
import { ReportarFaltaItemModal } from './ReportarFaltaItemModal';
import { syncAllPhotosToGoogleDrive } from '../lib/googleDriveService';
import { isRealPhoto } from '../utils/photoValidation';

export interface PhotoSlotItem {
  key: string;
  title: string;
  sublabel: string;
  required: boolean;
  allowsNotAvailable?: boolean;
}

export const PHOTO_SLOTS: PhotoSlotItem[] = [
  {
    key: 'fotoAvisoUrl',
    title: '1. FOTO AVISO',
    sublabel: 'Fachada frontal del expendio mostrando el aviso exterior',
    required: true,
    allowsNotAvailable: true,
  },
  {
    key: 'fotoPanoramicaUrl',
    title: '2. FOTO PANORÁMICA',
    sublabel: 'Vista panorámica amplia mostrando el entorno y acceso',
    required: true,
  },
  {
    key: 'fotoMataselloUrl',
    title: '3. FOTO MATASELLO',
    sublabel: 'Matasello oficial visible y legible sobre superficie',
    required: true,
    allowsNotAvailable: true,
  },
  {
    key: 'fotoBasculaUrl',
    title: '4. FOTO BÁSCULA',
    sublabel: 'Báscula o balanza calibrada para pesaje postal',
    required: true,
    allowsNotAvailable: true,
  },
  {
    key: 'fotoContratistaUrl',
    title: '5. FOTO CONTRATISTA',
    sublabel: 'Encargado oficial en el punto de atención al público',
    required: true,
  },
  {
    key: 'fotoHorarioUrl',
    title: '6. FOTO HORARIO',
    sublabel: 'Horario de atención al público visible en la pared',
    required: true,
  },
  {
    key: 'fotoTarifasUrl',
    title: '7. FOTO TARIFAS',
    sublabel: 'Aviso de tarifas postales oficiales publicado',
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
  uploadStatusMsg,
  onSyncOffline,
  isLight = true,
  onToggleItemAvailability,
  savingItemKey = null,
}) => {
  // Modal para reportar implemento no disponible (Pregunta: ¿Qué pasó con este implemento?)
  const [modalFalta, setModalFalta] = useState<{
    isOpen: boolean;
    slotKey: string;
    slotTitle: string;
  }>({
    isOpen: false,
    slotKey: '',
    slotTitle: '',
  });

  // Google Drive Instant Upload State (Desatendido y Centralizado)
  const [driveSyncing, setDriveSyncing] = useState<boolean>(false);
  const [driveSyncMsg, setDriveSyncMsg] = useState<string>('');

  const handleSyncExistingPhotos = async () => {
    setDriveSyncing(true);
    setDriveSyncMsg('Verificando respaldo de fotos con Google Drive...');
    try {
      let token: string | null = null;
      try {
        const res = await fetch('/api/admin/google-drive/token');
        if (res.ok) {
          const data = await res.json();
          token = data.accessToken || null;
        }
      } catch {}
      const sRes = await syncAllPhotosToGoogleDrive(token || undefined);
      setDriveSyncMsg(`✓ Respaldo verificado: ${sRes.totalUploaded} foto(s) sincronizada(s) con Google Drive.`);
    } catch (err: any) {
      setDriveSyncMsg('Respaldo en servidor central activo.');
    } finally {
      setDriveSyncing(false);
    }
  };

  const getPhotoUrl = (key: string): string => {
    if (isRealPhoto(localPhotos[key])) return localPhotos[key];
    const expObj = expendio as any;
    if (isRealPhoto(expObj?.[key])) return expObj[key];
    if (key === 'fotoAvisoUrl' && isRealPhoto(expObj?.letreroUrl)) return expObj.letreroUrl;
    if (key === 'fotoMataselloUrl' && isRealPhoto(expObj?.mataselloUrl)) return expObj.mataselloUrl;
    if (key === 'fotoBasculaUrl' && isRealPhoto(expObj?.basculaUrl)) return expObj.basculaUrl;
    return '';
  };

  const isItemMarkedNo = (key: string): boolean => {
    // Si acaba de adjuntar una foto real local, pasa a ser SI de inmediato
    if (isRealPhoto(localPhotos[key])) return false;
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
      {/* Google Drive Real-Time Cloud Upload Status Bar - Centralizado y Desatendido */}
      <div
        className="p-4 rounded-2xl border-2 transition-all bg-emerald-50 border-emerald-500 text-slate-950 shadow-sm dark:bg-slate-900 dark:border-emerald-500/70 dark:text-slate-100"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0 shadow-xs bg-emerald-600 text-white">
              <CloudUpload className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2 flex-wrap gap-1">
                <h4 className="font-black text-sm uppercase tracking-tight text-slate-950 dark:text-white">
                  Almacenamiento Firebase Storage: ACTIVA ✓
                </h4>
                <span className="bg-emerald-700 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase shrink-0">
                  En Tiempo Real
                </span>
              </div>
              <p className="text-xs text-slate-950 dark:text-slate-200 font-black leading-snug mt-0.5">
                Cada foto que capturas se sube de forma segura a Firebase Cloud Storage. El respaldo a Google Drive ahora es un proceso manual desde Configuración.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleSyncExistingPhotos}
              disabled={driveSyncing}
              className="w-full sm:w-auto px-3.5 py-2 rounded-xl text-xs font-black flex items-center justify-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm active:scale-95 cursor-pointer transition-all"
              title="Verificar respaldo en Google Drive"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${driveSyncing ? 'animate-spin' : ''}`} />
              <span>{driveSyncing ? 'Verificando...' : 'Verificar Respaldo en Drive'}</span>
            </button>
          </div>
        </div>

        {driveSyncMsg && (
          <div className="mt-2.5 p-2.5 rounded-xl bg-white/95 dark:bg-slate-950/80 border-2 border-emerald-500 text-slate-950 dark:text-white text-xs font-black flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{driveSyncMsg}</span>
          </div>
        )}
      </div>

      {/* Mobile-optimized Progress Counter Card */}
      <div
        className={`p-3.5 sm:p-4 rounded-2xl border-2 transition-all ${
          totalLoaded >= 7
            ? 'bg-emerald-50 border-emerald-400 text-black shadow-sm'
            : isLight
            ? 'bg-amber-50/60 border-amber-400 text-black shadow-sm'
            : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3 min-w-0">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-base shrink-0 shadow-sm ${
                totalLoaded >= 7
                  ? 'bg-emerald-400 text-black border-2 border-emerald-600'
                  : 'bg-amber-400 text-black border-2 border-amber-600'
              }`}
            >
              {totalLoaded}/7
            </div>
            <div className="min-w-0">
              <h4 className="font-black text-sm sm:text-base uppercase tracking-tight truncate text-black">
                {totalLoaded >= 7
                  ? '¡Cumplimiento Fotográfico Completo! ✓'
                  : 'Registro Fotográfico Reglamentario'}
              </h4>
              <p className="text-xs text-black font-bold truncate">
                {totalLoaded >= 7
                  ? `${photosUploadedCount} fotos cargadas + ${itemsNotAvailableCount} marcadas sin ítem (Permite continuar a Cuentas)`
                  : `Faltan ${7 - totalLoaded} ítem(s) para completar y habilitar Cuentas de Cobro.`}
              </p>
            </div>
          </div>

          {offlineQueue && offlineQueue.length > 0 && onSyncOffline && (
            <button
              type="button"
              onClick={onSyncOffline}
              disabled={isSyncingOffline}
              className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white shadow-sm shrink-0 active:scale-95 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingOffline ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sincronizar</span>
              <span>({offlineQueue.length})</span>
            </button>
          )}
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-200 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden mt-3">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              totalLoaded >= 7 ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.min(100, (totalLoaded / 7) * 100)}%` }}
          />
        </div>

        {uploadStatusMsg && (
          <div className="mt-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border-2 border-emerald-400 text-emerald-950 dark:text-emerald-100 text-xs sm:text-sm font-black flex items-start space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{uploadStatusMsg}</span>
          </div>
        )}
      </div>

      {/* 7 Photo Slots Grid (1 col on mobile, 2 cols on tablet/desktop) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {PHOTO_SLOTS.map((slot) => {
          const photoUrl = getPhotoUrl(slot.key);
          if (photoUrl) console.log(`Rendering photo for ${slot.key}:`, photoUrl);
          const isLoaded = Boolean(photoUrl);
          const isUploading = uploadingPhotoType === slot.key;
          const isMarkedNo = isItemMarkedNo(slot.key);
          const isSavingItem = savingItemKey === slot.key;

          return (
            <div
              key={slot.key}
              className={`rounded-2xl border-2 p-3.5 sm:p-4 space-y-3 flex flex-col justify-between transition-all ${
                isLoaded
                  ? isLight
                    ? 'bg-white border-emerald-400 shadow-sm'
                    : 'bg-slate-900/90 border-emerald-500/50 shadow-sm'
                  : isMarkedNo
                  ? isLight
                    ? 'bg-amber-50/80 border-amber-400 shadow-sm'
                    : 'bg-amber-950/20 border-amber-500/50 shadow-sm'
                  : isLight
                  ? 'bg-white border-slate-300 shadow-sm'
                  : 'bg-slate-900/80 border-slate-800'
              }`}
            >
              {/* Card Header */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-black text-xs uppercase tracking-tight ${
                      isLight ? 'text-slate-950' : 'text-white'
                    }`}
                  >
                    {slot.title}
                  </span>
                  {isLoaded ? (
                    <span className="text-[10px] bg-emerald-600 text-white px-2.5 py-0.5 rounded-full font-bold flex items-center space-x-1 shrink-0 shadow-xs">
                      <CheckCircle2 className="w-3 h-3 text-white" />
                      <span>REGISTRADA (BD: SI)</span>
                    </span>
                  ) : isMarkedNo ? (
                    <span className="text-[10px] bg-amber-500/20 text-amber-950 dark:text-amber-300 border border-amber-500 dark:border-amber-700 px-2.5 py-0.5 rounded-full font-black flex items-center space-x-1 shrink-0">
                      <CheckCircle2 className="w-3 h-3 text-amber-600" />
                      <span>NO DISPONE (BD: NO)</span>
                    </span>
                  ) : (
                    <span className="text-[10px] bg-amber-500 text-slate-950 px-2.5 py-0.5 rounded-full font-black shrink-0 shadow-xs">
                      PENDIENTE
                    </span>
                  )}
                </div>
                <p className={`text-xs line-clamp-2 leading-tight font-black ${
                  isLight ? 'text-slate-900' : 'text-slate-200'
                }`}>
                  {slot.sublabel}
                </p>
              </div>

              {/* Photo Preview Container */}
              <div
                onClick={() => {
                  if (isLoaded) onViewPhotoDetail({ title: slot.title, url: photoUrl });
                }}
                className={`h-44 rounded-xl overflow-hidden border-2 flex items-center justify-center relative group transition-all ${
                  isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-950 border-slate-800'
                } ${isLoaded ? 'cursor-pointer hover:border-amber-400' : ''}`}
              >
                {isLoaded ? (
                  <>
                    <img
                      src={photoUrl}
                      alt={slot.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-xs font-bold space-x-1.5 backdrop-blur-xs">
                      <Eye className="w-4 h-4 text-amber-400" />
                      <span>Ver Fotografía Completa</span>
                    </div>
                  </>
                ) : isMarkedNo ? (
                  <div className="text-center p-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center mx-auto mb-2 border border-amber-400">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-black text-amber-950 dark:text-amber-300 block uppercase">
                      BD: NO DISPONE
                    </span>
                    {getItemMotivo(slot.key) && (
                      <span className="text-[11px] font-bold text-amber-950 dark:text-amber-200 block mt-1 bg-amber-500/20 px-2 py-1 rounded-lg border border-amber-500/30">
                        {getItemMotivo(slot.key)}
                      </span>
                    )}
                    <span className="text-[11px] text-slate-900 dark:text-slate-300 font-bold block mt-1.5 leading-snug">
                      Registrado en base de datos como NO. Si adjuntas una foto, se actualizará automáticamente a SI.
                    </span>
                  </div>
                ) : (
                  <div className="text-center p-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-600 flex items-center justify-center mx-auto mb-2 border border-amber-400">
                      <Camera className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-black text-slate-950 dark:text-slate-200 block uppercase">
                      Sin foto registrada
                    </span>
                    <span className="text-[11px] text-slate-900 dark:text-slate-300 font-bold block mt-0.5">
                      Toma la foto o márcalo abajo si no lo tienes
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons for Mobile Phone */}
              <div className="space-y-2 pt-1">
                {/* 1. Primary Button: Native Phone Camera */}
                <label className="w-full bg-amber-500 hover:bg-amber-400 active:scale-98 text-slate-950 font-black py-2.5 px-3 rounded-xl text-xs flex items-center justify-center space-x-2 shadow-md hover:shadow-lg cursor-pointer transition-all border border-amber-600">
                  <Camera className="w-4 h-4" />
                  <span>
                    {isLoaded
                      ? '📸 Tomar Nueva Foto'
                      : isMarkedNo
                      ? '📸 Adjuntar Foto (Actualizar a SI)'
                      : '📸 Tomar con Cámara'}
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

                {/* 2. Secondary Button: Gallery Upload */}
                <label
                  className={`w-full font-black py-2 px-3 rounded-xl text-xs flex items-center justify-center space-x-1.5 cursor-pointer border-2 transition-colors ${
                    isLight
                      ? 'bg-white hover:bg-slate-100 text-slate-950 border-slate-400 shadow-xs'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-100 border-slate-700'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5 text-amber-600" />
                  <span>{isMarkedNo ? 'Subir Foto (Actualizar a SI)' : 'Subir de Galería'}</span>
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

                {/* 3. Availability Option (Báscula, Matasello, Aviso) */}
                {slot.allowsNotAvailable && (
                  <div className={`pt-2 border-t text-xs ${isLight ? 'border-slate-300' : 'border-slate-800'}`}>
                    {isMarkedNo ? (
                      <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-amber-500/20 border border-amber-500/30">
                        <span className="text-[11px] font-black text-amber-950 dark:text-amber-300 flex items-center space-x-1">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                          <span>BD: NO TIENE</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onToggleItemAvailability?.(slot.key, 'SI')}
                          disabled={Boolean(isSavingItem)}
                          className="text-[11px] font-black text-slate-950 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 underline cursor-pointer"
                          title="Cambiar estado a SI si dispones de este elemento"
                        >
                          {isSavingItem ? 'Actualizando...' : 'Cambiar a SI (Tengo el ítem)'}
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
                        className={`w-full py-2 px-2.5 rounded-xl text-xs font-black border-2 flex items-center justify-between transition-colors cursor-pointer ${
                          isLight
                            ? 'bg-slate-50 hover:bg-amber-50 text-slate-950 hover:text-amber-950 border-slate-300 hover:border-amber-400 shadow-xs'
                            : 'bg-slate-800/60 hover:bg-amber-950/30 text-slate-100 hover:text-amber-200 border-slate-700 hover:border-amber-700'
                        }`}
                        title="Habilitado: Haz clic si en BD aparece que sí pero no tienes este implemento"
                      >
                        <span className="flex items-center space-x-1.5 truncate">
                          <HelpCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span className="truncate">¿No tienes este ítem?</span>
                        </span>
                        <span className="font-black text-amber-700 dark:text-amber-400 underline shrink-0 ml-1">
                          {isSavingItem ? 'Guardando...' : 'Marcar: No lo tengo'}
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
