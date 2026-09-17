import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  Upload,
  CheckCircle2,
  X,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
  Smartphone,
  MapPin,
  RotateCcw,
} from 'lucide-react';
import {
  getCurrentGpsLocation,
  stampPhotoWithWatermarkAndGps,
  GeoCoordinates,
} from '../utils/photoWatermarkGps';
import { ExpendioData } from '../types';

interface CameraGpsCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  slotKey: string;
  slotTitle: string;
  expendio?: ExpendioData;
  expendioNombre?: string;
  municipio?: string;
  encargado?: string;
  cedula?: string;
  initialFile?: File | null;
  onPhotoCaptured?: (file: File, dataUrl: string) => Promise<void> | void;
  onCaptureConfirmed?: (slotKey: string, file: File, dataUrl: string) => Promise<void> | void;
}

export const CameraGpsCaptureModal: React.FC<CameraGpsCaptureModalProps> = ({
  isOpen,
  onClose,
  slotKey,
  slotTitle,
  expendio,
  expendioNombre,
  municipio,
  encargado,
  cedula,
  initialFile = null,
  onPhotoCaptured,
  onCaptureConfirmed,
}) => {
  // Resolve real metadata from props or expendio object
  const realExpendioNombre = expendioNombre || expendio?.localidad || expendio?.municipio || 'EXPENDIO';
  const realMunicipio = municipio || expendio?.municipio || expendio?.localidad || '';
  const realEncargado = encargado || expendio?.encargado || '';
  const realCedula = cedula || expendio?.cedula || '';

  // GPS state (silently queried in background)
  const [coords, setCoords] = useState<GeoCoordinates | null>(null);

  // Stamped preview state
  const [stampedDataUrl, setStampedDataUrl] = useState<string | null>(null);
  const [stampedFile, setStampedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  // Silent background GPS fetch
  const fetchGpsSilently = async () => {
    try {
      const position = await getCurrentGpsLocation(5000);
      setCoords(position);
      return position;
    } catch {
      return null;
    }
  };

  // Process and stamp the captured photo
  const processAndStamp = async (sourceFile: File) => {
    setIsProcessing(true);
    setErrorMessage('');
    try {
      // Get GPS if not yet fetched
      let currentCoords = coords;
      if (!currentCoords) {
        currentCoords = await fetchGpsSilently();
      }

      const stamped = await stampPhotoWithWatermarkAndGps(sourceFile, {
        expendioNombre: realExpendioNombre,
        municipio: realMunicipio,
        encargado: realEncargado,
        cedula: realCedula,
        tituloSlot: slotTitle,
        coords: currentCoords,
        timestamp: new Date(),
        marcaAguaPrincipal: 'EXPENDIO CAMARCA SAS',
      });

      setStampedDataUrl(stamped.dataUrl);
      setStampedFile(stamped.file);
    } catch (err: any) {
      console.error('Error al estampar fotografía:', err);
      setErrorMessage(err.message || 'Error procesando la imagen. Intenta nuevamente.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle file from native camera or gallery
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processAndStamp(file);
    // Reset the input value so the same file or a retake can be selected again
    e.target.value = '';
  };

  // Initialize on open
  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
      setStampedDataUrl(null);
      setStampedFile(null);
      fetchGpsSilently();

      if (initialFile) {
        processAndStamp(initialFile);
      }
    }
  }, [isOpen, initialFile]);

  // Confirm and Save photo
  const handleConfirmSave = async () => {
    if (!stampedFile || !stampedDataUrl) return;
    setIsSaving(true);
    setErrorMessage('');

    try {
      // Support both prop signatures
      if (onCaptureConfirmed) {
        await onCaptureConfirmed(slotKey, stampedFile, stampedDataUrl);
      } else if (onPhotoCaptured) {
        await onPhotoCaptured(stampedFile, stampedDataUrl);
      } else {
        throw new Error('No se encontró el controlador de guardado.');
      }
      onClose();
    } catch (err: any) {
      console.error('Error guardando foto:', err);
      setErrorMessage(err.message || 'Error al guardar la foto. Verifica tu conexión.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden text-slate-100">
        
        {/* Modal Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900 shrink-0">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-sm sm:text-base text-slate-100 truncate">
                {slotTitle}
              </h3>
              <p className="text-[11px] text-amber-400 font-semibold truncate">
                {realExpendioNombre} • {realMunicipio}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-2 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer shrink-0 ml-2"
            title="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hidden inputs for Native Camera & Gallery */}
        <input
          ref={nativeCameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
          id="native-camera-input"
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
          id="gallery-camera-input"
        />

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {errorMessage && (
            <div className="p-3 bg-red-950/80 border border-red-800 text-red-200 rounded-xl text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {isProcessing ? (
            /* Processing / Stamping spinner */
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-100">
                  Estampando fotografía con datos oficiales...
                </p>
                <p className="text-xs text-slate-400">
                  Aplicando marca de agua, fecha, expendio y coordenadas satelitales
                </p>
              </div>
            </div>
          ) : stampedDataUrl ? (
            /* Preview Stamped Photo */
            <div className="space-y-3.5 animate-in fade-in zoom-in-95 duration-150">
              <div className="bg-slate-950 p-2 rounded-2xl border border-emerald-500/50 shadow-inner flex flex-col items-center">
                <div className="relative max-h-[300px] sm:max-h-[360px] w-full overflow-hidden rounded-xl flex items-center justify-center bg-black">
                  <img
                    src={stampedDataUrl}
                    alt="Foto Estampada Oficial"
                    className="max-h-[300px] sm:max-h-[360px] w-auto object-contain rounded-lg"
                  />
                  <div className="absolute top-2 left-2 bg-emerald-950/90 text-emerald-300 border border-emerald-700 px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center space-x-1 backdrop-blur">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Marca de Agua Oficial Lista</span>
                  </div>
                </div>
              </div>

              {/* Stamped details summary */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] space-y-1">
                <div className="flex items-center space-x-2 text-slate-200 font-bold border-b border-slate-800 pb-1 mb-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Metadatos Estampados:</span>
                </div>
                <p className="text-amber-400 font-bold">★ EXPENDIO CAMARCA SAS</p>
                <p className="text-slate-300 truncate">
                  {realExpendioNombre} ({realMunicipio}) • {realEncargado}
                </p>
                <p className="text-emerald-400 font-mono text-[10px]">
                  📅 {new Date().toLocaleString('es-CO')}
                </p>
                {coords && (
                  <p className="text-sky-400 font-mono text-[10px] flex items-center space-x-1">
                    <MapPin className="w-3 h-3 text-sky-400 inline" />
                    <span>GPS: {coords.latitude.toFixed(5)}°, {coords.longitude.toFixed(5)}°</span>
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-1">
                {/* Main Confirm & Save Button */}
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleConfirmSave}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-98 disabled:opacity-50 text-slate-950 font-black py-3.5 px-4 rounded-xl shadow-lg text-xs sm:text-sm flex items-center justify-center space-x-2 cursor-pointer transition-all"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Guardando en Servidor...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Confirmar y Guardar Foto</span>
                    </>
                  )}
                </button>

                {/* Retake buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => nativeCameraInputRef.current?.click()}
                    className="bg-slate-800 hover:bg-slate-700 active:scale-98 text-amber-300 font-bold py-2.5 px-3 rounded-xl border border-slate-700 text-xs flex items-center justify-center space-x-1.5 cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Repetir Foto</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => galleryInputRef.current?.click()}
                    className="bg-slate-800 hover:bg-slate-700 active:scale-98 text-slate-300 font-bold py-2.5 px-3 rounded-xl border border-slate-700 text-xs flex items-center justify-center space-x-1.5 cursor-pointer transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>De Galería</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Initial View: Take photo with Native Camera */
            <div className="space-y-4 text-center py-4">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto shadow-inner">
                <Smartphone className="w-8 h-8" />
              </div>

              <div className="space-y-1 px-2">
                <h4 className="font-extrabold text-base text-slate-100 uppercase tracking-wide">
                  Captura de {slotTitle}
                </h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  La foto se tomará con la cámara nativa de tu celular para obtener la máxima calidad y resolución.
                </p>
              </div>

              {/* Primary Native Camera Trigger */}
              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => nativeCameraInputRef.current?.click()}
                  className="w-full bg-amber-500 hover:bg-amber-400 active:scale-98 text-slate-950 font-black py-4 px-4 rounded-2xl shadow-xl flex items-center justify-center space-x-2.5 text-sm cursor-pointer transition-all"
                >
                  <Camera className="w-5 h-5" />
                  <span>Abrir Cámara del Celular</span>
                </button>

                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-full bg-slate-800 hover:bg-slate-700 active:scale-98 text-slate-200 font-bold py-3 px-4 rounded-xl border border-slate-700 flex items-center justify-center space-x-2 text-xs cursor-pointer transition-colors"
                >
                  <Upload className="w-4 h-4 text-amber-400" />
                  <span>O Seleccionar de la Galería</span>
                </button>
              </div>

              <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/80 text-[11px] text-slate-400 space-y-1 text-left">
                <p className="font-semibold text-slate-300 flex items-center space-x-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Estampado oficial automático</span>
                </p>
                <p className="text-[10px] text-slate-500">
                  Al capturar la foto, el sistema estampará en la base: razón social, municipio, encargado, fecha exacta y coordenadas satelitales para la auditoría contractual de 4-72.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
