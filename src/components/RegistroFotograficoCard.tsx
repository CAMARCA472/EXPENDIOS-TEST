import React, { useState, useEffect } from 'react';
import { ExpendioData } from '../types';
import { Camera, Download, Upload, CheckCircle2, Image as ImageIcon, Trash2, ShieldCheck, RefreshCw, MapPin, Sparkles, Eye, Maximize2 } from 'lucide-react';
import { generateReporteFotograficoSinglePDF } from '../utils/pdfGenerator';
import { CameraGpsCaptureModal } from './CameraGpsCaptureModal';
import { PhotoLightboxModal } from './PhotoLightboxModal';
import { getCurrentGpsLocation, stampPhotoWithWatermarkAndGps, GeoCoordinates } from '../utils/photoWatermarkGps';

interface RegistroFotograficoCardProps {
  expendio: ExpendioData;
  onUpdatePhotos?: (updated: ExpendioData) => void;
}

interface PhotoSlotDef {
  key: keyof ExpendioData;
  number: number;
  label: string;
  sublabel: string;
  defaultPlaceholder: string;
}

const PHOTO_SLOTS: PhotoSlotDef[] = [
  {
    key: 'fotoAvisoUrl',
    number: 1,
    label: '1. FOTO AVISO',
    sublabel: 'Aviso publicitario oficial',
    defaultPlaceholder: 'https://images.unsplash.com/photo-1577495508048-b635879837f1?w=600&auto=format&fit=crop&q=80',
  },
  {
    key: 'fotoPanoramicaUrl',
    number: 2,
    label: '2. FOTO PANORÁMICA',
    sublabel: 'Fachada y aviso de 4-72 visible',
    defaultPlaceholder: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=600&auto=format&fit=crop&q=80',
  },
  {
    key: 'fotoMataselloUrl',
    number: 3,
    label: '3. FOTO MATASELLO',
    sublabel: 'Matasello de correspondencia',
    defaultPlaceholder: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=600&auto=format&fit=crop&q=80',
  },
  {
    key: 'fotoBasculaUrl',
    number: 4,
    label: '4. FOTO BÁSCULA',
    sublabel: 'Báscula calibrada del punto',
    defaultPlaceholder: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80',
  },
  {
    key: 'fotoContratistaUrl',
    number: 5,
    label: '5. FOTO DEL CONTRATISTA',
    sublabel: 'Encargado responsable en el punto',
    defaultPlaceholder: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=600&auto=format&fit=crop&q=80',
  },
  {
    key: 'fotoHorarioUrl',
    number: 6,
    label: '6. FOTO HORARIO',
    sublabel: 'Horario de atención visible',
    defaultPlaceholder: 'https://images.unsplash.com/photo-1508873696983-2df5293cb395?w=600&auto=format&fit=crop&q=80',
  },
  {
    key: 'fotoTarifasUrl',
    number: 7,
    label: '7. FOTO TARIFAS',
    sublabel: 'Tarifario vigente publicado',
    defaultPlaceholder: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?w=600&auto=format&fit=crop&q=80',
  },
];

export const RegistroFotograficoCard: React.FC<RegistroFotograficoCardProps> = ({
  expendio,
  onUpdatePhotos,
}) => {
  const [photoState, setPhotoState] = useState<Record<string, string>>({
    fotoAvisoUrl: expendio.fotoAvisoUrl || expendio.letreroUrl || '',
    fotoPanoramicaUrl: expendio.fotoPanoramicaUrl || '',
    fotoMataselloUrl: expendio.fotoMataselloUrl || expendio.mataselloUrl || '',
    fotoBasculaUrl: expendio.fotoBasculaUrl || expendio.basculaUrl || '',
    fotoContratistaUrl: expendio.fotoContratistaUrl || '',
    fotoHorarioUrl: expendio.fotoHorarioUrl || '',
    fotoTarifasUrl: expendio.fotoTarifasUrl || '',
  });

  // Keep state synchronized with expendio prop changes without re-rendering loops
  useEffect(() => {
    if (!expendio) return;

    setPhotoState((prev) => {
      const nextAviso = expendio.fotoAvisoUrl || expendio.letreroUrl || '';
      const nextPano = expendio.fotoPanoramicaUrl || '';
      const nextMata = expendio.fotoMataselloUrl || expendio.mataselloUrl || '';
      const nextBasc = expendio.fotoBasculaUrl || expendio.basculaUrl || '';
      const nextCont = expendio.fotoContratistaUrl || '';
      const nextHora = expendio.fotoHorarioUrl || '';
      const nextTari = expendio.fotoTarifasUrl || '';

      if (
        prev.fotoAvisoUrl === nextAviso &&
        prev.fotoPanoramicaUrl === nextPano &&
        prev.fotoMataselloUrl === nextMata &&
        prev.fotoBasculaUrl === nextBasc &&
        prev.fotoContratistaUrl === nextCont &&
        prev.fotoHorarioUrl === nextHora &&
        prev.fotoTarifasUrl === nextTari
      ) {
        return prev;
      }

      return {
        fotoAvisoUrl: nextAviso,
        fotoPanoramicaUrl: nextPano,
        fotoMataselloUrl: nextMata,
        fotoBasculaUrl: nextBasc,
        fotoContratistaUrl: nextCont,
        fotoHorarioUrl: nextHora,
        fotoTarifasUrl: nextTari,
      };
    });
  }, [
    expendio?.id,
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
  ]);

  const [downloading, setDownloading] = useState<boolean>(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [gpsCaptureModal, setGpsCaptureModal] = useState<{ slotKey: string; slotTitle: string } | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<{ url: string; title: string; subtitle: string } | null>(null);
  const [globalCoords, setGlobalCoords] = useState<GeoCoordinates | null>(null);
  const [isRequestingGps, setIsRequestingGps] = useState<boolean>(false);

  // Count uploaded photos
  const uploadedCount = PHOTO_SLOTS.filter((s) => Boolean(photoState[s.key])).length;
  const progressPercent = Math.round((uploadedCount / PHOTO_SLOTS.length) * 100);

  const requestGps = async () => {
    setIsRequestingGps(true);
    try {
      const coords = await getCurrentGpsLocation(10000);
      setGlobalCoords(coords);
    } catch (e) {
      console.warn('GPS query error:', e);
    } finally {
      setIsRequestingGps(false);
    }
  };

  const handleFileUpload = async (key: string, slotTitle: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSavingKey(key);
    try {
      let coords = globalCoords;
      if (!coords) {
        try {
          coords = await getCurrentGpsLocation(3500);
          setGlobalCoords(coords);
        } catch {
          // ignore
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

      setPhotoState((prev) => ({ ...prev, [key]: stamped.dataUrl }));
      await savePhotoToBackend(key, stamped.dataUrl);
    } catch (err) {
      console.error('Error procesando foto con GPS:', err);
    } finally {
      setSavingKey(null);
    }
  };

  const handleRemovePhoto = (key: string) => {
    setPhotoState((prev) => ({ ...prev, [key]: '' }));
    savePhotoToBackend(key, '');
  };

  const savePhotoToBackend = async (key: string, value: string) => {
    setSavingKey(key);
    try {
      const payload: Record<string, string> = { [key]: value };
      // Also map backward compatible keys if applicable
      if (key === 'fotoAvisoUrl') payload.letreroUrl = value;
      if (key === 'fotoBasculaUrl') payload.basculaUrl = value;
      if (key === 'fotoMataselloUrl') payload.mataselloUrl = value;

      const targetId = expendio.id || expendio.cedula || expendio.localidad;
      const res = await fetch(`/api/admin/expendios/${encodeURIComponent(targetId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success && onUpdatePhotos) {
        onUpdatePhotos(data.data);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Error guardando imagen:', err);
    } finally {
      setSavingKey(null);
    }
  };

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      // Generate clean vector PDF adhering strictly to 1 letter page without audit box
      await generateReporteFotograficoSinglePDF({
        ...expendio,
        ...photoState,
      });
    } catch (err) {
      console.error('Error generando PDF fotográfico:', err);
      alert('Error generando PDF. Por favor intenta de nuevo.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center space-x-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
            <Camera className="w-4 h-4" />
            <span>Módulo de Control Fotográfico Oficial (7 Registros Obligatorios)</span>
          </div>
          <h3 className="text-xl font-bold text-slate-100">
            {expendio.localidad} ({expendio.municipio})
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Encargado / Contratista: <span className="text-slate-200 font-semibold">{expendio.encargado}</span> | C.C. {expendio.cedula}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {saveSuccess && (
            <span className="text-xs text-emerald-400 font-bold flex items-center space-x-1 animate-pulse bg-emerald-950/60 px-3 py-1.5 rounded-xl border border-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Guardado en Servidor</span>
            </span>
          )}

          <button
            onClick={handleDownloadPDF}
            disabled={downloading}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-2.5 px-4 rounded-xl shadow-lg text-xs flex items-center space-x-2 cursor-pointer transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>{downloading ? 'Generando Documento...' : 'Descargar PDF de 7 Fotos'}</span>
          </button>
        </div>
      </div>

      {/* Progress & Completeness Bar */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 font-bold text-slate-200">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Estado de Cumplimiento de Fotografías:</span>
            <span className={uploadedCount === 7 ? 'text-emerald-400 font-black' : 'text-amber-400 font-black'}>
              {uploadedCount} de 7 fotos registradas ({progressPercent}%)
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            {uploadedCount === 7 ? '✓ Registro completo' : `Faltan ${7 - uploadedCount} foto(s)`}
          </span>
        </div>
        <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
          <div
            className={`h-full transition-all duration-500 ${
              uploadedCount === 7 ? 'bg-emerald-500' : uploadedCount >= 4 ? 'bg-amber-500' : 'bg-rose-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* GPS Live Status Indicator */}
        <div className="flex items-center justify-between pt-1 text-xs border-t border-slate-800/80">
          <div className="flex items-center space-x-2">
            <MapPin className={`w-3.5 h-3.5 ${globalCoords ? 'text-emerald-400' : 'text-amber-400'}`} />
            {globalCoords ? (
              <span className="text-emerald-400 font-mono text-[11px] font-bold">
                GPS Activo: Lat {globalCoords.latitude.toFixed(5)}°, Lng {globalCoords.longitude.toFixed(5)}°
              </span>
            ) : (
              <span className="text-slate-400 text-[11px]">
                Marca de agua: "EXPENDIO CAMARCA SAS" + GPS oficial
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={requestGps}
            disabled={isRequestingGps}
            className="text-[11px] text-amber-300 hover:text-amber-200 underline font-semibold cursor-pointer"
          >
            {isRequestingGps ? 'Buscando satélites...' : globalCoords ? 'Actualizar GPS' : 'Verificar Señal GPS'}
          </button>
        </div>
      </div>

      {/* Interactive 7 Photos Upload Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PHOTO_SLOTS.map((slot) => {
          const currentUrl = photoState[slot.key];
          const isSaving = savingKey === slot.key;

          return (
            <div
              key={slot.key}
              className={`bg-slate-950 rounded-xl border p-3.5 flex flex-col justify-between transition-all ${
                currentUrl ? 'border-emerald-800/80 bg-slate-950/80' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-black text-amber-400 uppercase tracking-tight">
                    {slot.label}
                  </span>
                  {currentUrl ? (
                    <span className="text-[9px] bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded font-bold border border-emerald-800">
                      ✓ Cargada
                    </span>
                  ) : (
                    <span className="text-[9px] bg-rose-950/80 text-rose-300 px-2 py-0.5 rounded font-bold border border-rose-800/60">
                      ✗ Pendiente
                    </span>
                  )}
                </div>

                <div className="text-[10px] text-slate-400 mb-2 truncate" title={slot.sublabel}>
                  {slot.sublabel}
                </div>

                {/* Image Preview Box */}
                <div className="relative aspect-4/3 w-full bg-slate-900 rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center group">
                  {currentUrl ? (
                    <>
                      <img
                        src={currentUrl}
                        alt={slot.label}
                        className="w-full h-full object-cover cursor-pointer group-hover:scale-105 transition-transform"
                        crossOrigin="anonymous"
                        onClick={() =>
                          setLightboxPhoto({
                            url: currentUrl,
                            title: `${slot.label} - ${slot.sublabel}`,
                            subtitle: `${expendio.localidad} (${expendio.municipio}) | Encargado: ${expendio.encargado}`,
                          })
                        }
                      />
                      {/* Hover Overlay Button to open Lightbox */}
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxPhoto({
                            url: currentUrl,
                            title: `${slot.label} - ${slot.sublabel}`,
                            subtitle: `${expendio.localidad} (${expendio.municipio}) | Encargado: ${expendio.encargado}`,
                          })
                        }
                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center space-x-1.5 text-white transition-opacity cursor-pointer z-10"
                        title="Ver foto en tamaño completo"
                      >
                        <Maximize2 className="w-4 h-4 text-amber-400" />
                        <span className="text-[10px] font-bold text-slate-100">Ver Foto</span>
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-3 text-center text-slate-600">
                      <ImageIcon className="w-8 h-8 mb-1 text-slate-700" />
                      <span className="text-[10px] font-medium text-slate-500">Sin foto cargada</span>
                    </div>
                  )}

                  {isSaving && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-xs font-bold text-amber-400 z-20">
                      <RefreshCw className="w-5 h-5 animate-spin mr-1" />
                      Estampando y guardando...
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons: Camera & Gallery */}
              <div className="mt-3 space-y-1.5">
                {currentUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      setLightboxPhoto({
                        url: currentUrl,
                        title: `${slot.label} - ${slot.sublabel}`,
                        subtitle: `${expendio.localidad} (${expendio.municipio}) | Encargado: ${expendio.encargado}`,
                      })
                    }
                    className="w-full bg-slate-900 hover:bg-slate-800 text-sky-300 font-bold text-[10px] py-1 px-2 rounded-lg border border-slate-700 flex items-center justify-center space-x-1 cursor-pointer transition-colors"
                  >
                    <Eye className="w-3 h-3 text-sky-400" />
                    <span>Visualizar Imagen</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setGpsCaptureModal({ slotKey: slot.key, slotTitle: slot.label })}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] py-1.5 px-2 rounded-lg flex items-center justify-center space-x-1 cursor-pointer transition-all shadow"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Tomar con Cámara</span>
                </button>

                <div className="flex items-center space-x-1.5">
                  <label className="flex-1 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-[10px] py-1.5 px-2 rounded-lg border border-slate-800 flex items-center justify-center space-x-1 cursor-pointer transition-colors text-center">
                    <Upload className="w-3 h-3 text-slate-400" />
                    <span>{currentUrl ? 'Reemplazar' : 'De Galería'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleFileUpload(slot.key, slot.label, e)}
                      className="hidden"
                    />
                  </label>

                  {currentUrl && (
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(slot.key)}
                      className="p-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-lg transition-colors cursor-pointer"
                      title="Eliminar foto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lightbox Modal for Full Image Inspection */}
      {lightboxPhoto && (
        <PhotoLightboxModal
          isOpen={!!lightboxPhoto}
          onClose={() => setLightboxPhoto(null)}
          imageUrl={lightboxPhoto.url}
          title={lightboxPhoto.title}
          subtitle={lightboxPhoto.subtitle}
          metadata={{
            encargado: expendio.encargado,
            cedula: expendio.cedula,
            municipio: expendio.municipio || expendio.localidad,
            direccion: expendio.direccionPunto,
            telefono: expendio.telefonoPunto,
          }}
        />
      )}

      {/* Camera GPS Capture Modal */}
      {gpsCaptureModal && (
        <CameraGpsCaptureModal
          isOpen={!!gpsCaptureModal}
          onClose={() => setGpsCaptureModal(null)}
          slotKey={gpsCaptureModal.slotKey}
          slotTitle={gpsCaptureModal.slotTitle}
          expendioNombre={expendio.localidad || expendio.municipio || 'EXPENDIO'}
          municipio={expendio.municipio || expendio.localidad || ''}
          encargado={expendio.encargado || ''}
          cedula={expendio.cedula || ''}
          onPhotoCaptured={async (_file, dataUrl) => {
            setPhotoState((prev) => ({ ...prev, [gpsCaptureModal.slotKey]: dataUrl }));
            await savePhotoToBackend(gpsCaptureModal.slotKey, dataUrl);
            setGpsCaptureModal(null);
          }}
        />
      )}

      {/* Printable Sheet View - Document for High-DPI Export */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 overflow-x-auto flex justify-center">
        <div
          id={`registro-foto-document-${expendio.id}`}
          className="bg-white text-black p-6 rounded shadow-2xl w-full max-w-[800px] font-sans border-2 border-black space-y-0"
          style={{ minWidth: '700px' }}
        >
          {/* Header Table Box with black grid */}
          <div className="border-2 border-black divide-y-2 divide-black text-xs font-bold">
            <div className="p-2 text-center text-sm font-black tracking-wide border-b-2 border-black uppercase bg-gray-100">
              REGISTRO FOTOGRÁFICO OFICIAL DE EXPENDIO 4-72
              <br />
              <span className="text-base text-blue-900 font-black">
                {(expendio.municipio || expendio.localidad).toUpperCase()}
              </span>
            </div>

            <div className="grid grid-cols-2 divide-x-2 divide-black">
              <div className="p-1.5 px-3 uppercase text-[11px]">
                <span className="font-extrabold">CONTRATISTA/ENCARGADO:</span> {expendio.encargado.toUpperCase()}
              </div>
              <div className="p-1.5 px-3 uppercase text-[11px]">
                <span className="font-extrabold">CÉDULA:</span> {expendio.cedula}
              </div>
            </div>

            <div className="grid grid-cols-2 divide-x-2 divide-black">
              <div className="p-1.5 px-3 uppercase text-[11px]">
                <span className="font-extrabold">DIRECCIÓN:</span> {expendio.direccionPunto?.toUpperCase() || 'SEDE PRINCIPAL'}
              </div>
              <div className="p-1.5 px-3 uppercase text-[11px]">
                <span className="font-extrabold">TELÉFONO:</span> {expendio.telefonoPunto || 'NO REGISTRADO'}
              </div>
            </div>
          </div>

          {/* 7 Photos Grid in Printable Document: Row 1: Foto Aviso centered, Row 2: 3 photos, Row 3: 3 photos */}
          <div className="border-2 border-t-0 border-black p-3 bg-slate-50 space-y-3">
            {/* Row 1: Photo 1 (Foto Aviso) Centered */}
            <div className="flex justify-center">
              {PHOTO_SLOTS.slice(0, 1).map((slot) => {
                const url = photoState[slot.key] || slot.defaultPlaceholder;
                return (
                  <div key={slot.key} className="w-1/2 border border-slate-300 rounded bg-white p-2 flex flex-col items-center">
                    <img
                      src={url}
                      alt={slot.label}
                      className="w-full h-36 object-cover rounded border border-gray-200"
                      crossOrigin="anonymous"
                    />
                    <div className="mt-1.5 text-[9px] font-black text-gray-800 uppercase text-center">
                      {slot.label}
                    </div>
                    <div className="text-[8px] text-gray-500 uppercase text-center">
                      {slot.sublabel}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Row 2: Photos 2, 3, 4 (Panorámica, Matasello, Báscula) */}
            <div className="grid grid-cols-3 gap-3">
              {PHOTO_SLOTS.slice(1, 4).map((slot) => {
                const url = photoState[slot.key] || slot.defaultPlaceholder;
                return (
                  <div key={slot.key} className="border border-slate-300 rounded bg-white p-2 flex flex-col items-center">
                    <img
                      src={url}
                      alt={slot.label}
                      className="w-full h-36 object-cover rounded border border-gray-200"
                      crossOrigin="anonymous"
                    />
                    <div className="mt-1.5 text-[9px] font-black text-gray-800 uppercase text-center">
                      {slot.label}
                    </div>
                    <div className="text-[8px] text-gray-500 uppercase text-center">
                      {slot.sublabel}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Row 3: Photos 5, 6, 7 (Contratista, Horario, Tarifas) */}
            <div className="grid grid-cols-3 gap-3">
              {PHOTO_SLOTS.slice(4, 7).map((slot) => {
                const url = photoState[slot.key] || slot.defaultPlaceholder;
                return (
                  <div key={slot.key} className="border border-slate-300 rounded bg-white p-2 flex flex-col items-center">
                    <img
                      src={url}
                      alt={slot.label}
                      className="w-full h-36 object-cover rounded border border-gray-200"
                      crossOrigin="anonymous"
                    />
                    <div className="mt-1.5 text-[9px] font-black text-gray-800 uppercase text-center">
                      {slot.label}
                    </div>
                    <div className="text-[8px] text-gray-500 uppercase text-center">
                      {slot.sublabel}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Document Footer */}
          <div className="border-2 border-t-0 border-black p-2 bg-gray-50 text-[10px] flex items-center justify-between text-gray-700">
            <span>CAMARCA SAS - NIT 900.504.241-7 | Operador SPU 4-72</span>
            <span>Fecha de Emisión: {new Date().toLocaleDateString('es-CO')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
