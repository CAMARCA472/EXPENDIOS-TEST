import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  Upload,
  RotateCw,
  Sliders,
  Sparkles,
  CheckCircle2,
  X,
  RefreshCw,
  FileText,
  AlertCircle,
  Eye,
  Calendar,
} from 'lucide-react';
import { ScanFilterType, processImageWithMagicFilter } from '../utils/camScannerFilter';

interface ScannerCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  cedula: string;
  encargado: string;
  expendio: string;
  municipio: string;
  periodoDefault?: string;
  onUploadSuccess: (nuevaCuenta: any) => void;
}

const MESES_SISTEMA = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
];

export const ScannerCameraModal: React.FC<ScannerCameraModalProps> = ({
  isOpen,
  onClose,
  cedula,
  encargado,
  expendio,
  municipio,
  periodoDefault = 'FEBRERO 2026',
  onUploadSuccess,
}) => {
  const [mode, setMode] = useState<'camera' | 'upload' | 'preview'>('camera');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Captured raw image source
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);

  // Filter and enhancement settings
  const [selectedFilter, setSelectedFilter] = useState<ScanFilterType>('magic_bw');
  const [brightness, setBrightness] = useState<number>(0);
  const [contrast, setContrast] = useState<number>(20);
  const [rotation, setRotation] = useState<number>(0);

  // Period assignment
  const [mes, setMes] = useState<string>(() => {
    const parts = (periodoDefault || '').split(' ');
    return parts[0] || 'FEBRERO';
  });
  const [anio, setAnio] = useState<string>(() => {
    const parts = (periodoDefault || '').split(' ');
    return parts[1] || '2026';
  });

  const [saving, setSaving] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewImgRef = useRef<HTMLImageElement | null>(null);

  // Start / Stop camera stream
  const startCamera = async () => {
    setCameraError('');
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err: any) {
      console.warn('Camera access denied or unavailable:', err);
      setCameraActive(false);
      setCameraError('No se pudo acceder a la cámara. Puedes subir una foto desde tu galería o dispositivo.');
      setMode('upload');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (isOpen && mode === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, mode, facingMode]);

  // Capture snapshot from video stream
  const handleCaptureSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

    stopCamera();
    setRawImageSrc(dataUrl);
    setRotation(0);
    setMode('preview');
  };

  // Handle local file upload
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setRawImageSrc(event.target.result as string);
        setRotation(0);
        setMode('preview');
      }
    };
    reader.readAsDataURL(file);
  };

  // Re-run filter on canvas whenever adjustments change
  useEffect(() => {
    if (mode !== 'preview' || !rawImageSrc || !canvasRef.current) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const processed = processImageWithMagicFilter(img, {
        filter: selectedFilter,
        brightness,
        contrast,
        rotation,
      });

      const targetCanvas = canvasRef.current;
      if (!targetCanvas) return;
      targetCanvas.width = processed.width;
      targetCanvas.height = processed.height;
      const ctx = targetCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        ctx.drawImage(processed, 0, 0);
      }
    };
    img.src = rawImageSrc;
  }, [mode, rawImageSrc, selectedFilter, brightness, contrast, rotation]);

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleSaveScannedAccount = async () => {
    if (!canvasRef.current) return;
    setSaving(true);
    setSuccessMsg('');

    try {
      const processedDataUrl = canvasRef.current.toDataURL('image/jpeg', 0.92);
      const periodoFinal = `${mes} ${anio}`.toUpperCase();

      const payload = {
        cedula,
        encargado,
        expendio,
        municipio,
        periodo: periodoFinal,
        fotoBase64: processedDataUrl,
      };

      const res = await fetch('/api/expendio/cargar-cuenta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        if (data.data?.analisisIA?.hayNovedad) {
          setSuccessMsg(`⚠️ Documento procesado con IA: Se detectaron novedades (${data.data.analisisIA.novedades.length}) en la cuenta/información. La administración revisará las novedades.`);
        } else {
          setSuccessMsg(`✓ Cuenta de Cobro analizada con IA: Verificada y sincronizada con éxito en la base de datos.`);
        }
        onUploadSuccess(data.data);
        setTimeout(() => {
          onClose();
        }, 2200);
      } else {
        alert(data.message || 'Error al guardar la cuenta de cobro.');
      }
    } catch (err: any) {
      console.error('Error al subir cuenta escaneada:', err);
      alert('Error de conexión al guardar la cuenta.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden text-slate-100">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-100 flex items-center space-x-2">
                <span>Cargar Cuenta de Cobro Firmada</span>
                <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded font-mono">
                  Magia Pro B&N
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {expendio} ({municipio}) • C.C. {cedula}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Mode Selector Tabs (when not in preview) */}
          {mode !== 'preview' && (
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => {
                  setMode('camera');
                  startCamera();
                }}
                className={`flex-1 py-2 px-3 rounded-lg font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer ${
                  mode === 'camera'
                    ? 'bg-emerald-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Camera className="w-4 h-4" />
                <span>Modo Cámara Scanner</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setMode('upload');
                }}
                className={`flex-1 py-2 px-3 rounded-lg font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer ${
                  mode === 'upload'
                    ? 'bg-emerald-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Upload className="w-4 h-4" />
                <span>Subir Foto de Archivo</span>
              </button>
            </div>
          )}

          {/* 1. CAMERA MODE */}
          {mode === 'camera' && (
            <div className="space-y-3">
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3] sm:aspect-[16/10] border border-slate-800 flex items-center justify-center shadow-inner">
                <video
                  ref={videoRef}
                  playsInline
                  autoPlay
                  muted
                  className="w-full h-full object-cover"
                />

                {/* Viewfinder Overlay Guide */}
                <div className="absolute inset-4 sm:inset-6 pointer-events-none border-2 border-dashed border-emerald-400/80 rounded-xl flex flex-col justify-between p-3">
                  <div className="flex justify-between items-center text-[10px] text-emerald-300 font-mono bg-slate-950/70 px-2.5 py-1 rounded backdrop-blur self-start">
                    <span>Encuadra la Cuenta de Cobro Firmada</span>
                  </div>
                  <div className="flex justify-between items-center text-[9px] text-slate-400 bg-slate-950/70 px-2 py-0.5 rounded self-end">
                    <span>Filtro CamScanner Pro se aplicará automáticamente</span>
                  </div>
                </div>

                {/* Switch Camera Button */}
                <button
                  type="button"
                  onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
                  className="absolute top-3 right-3 bg-slate-900/80 hover:bg-slate-800 text-slate-200 p-2 rounded-xl backdrop-blur border border-slate-700 text-xs flex items-center space-x-1 cursor-pointer"
                  title="Cambiar Cámara"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {cameraError && (
                <div className="p-3 bg-amber-950/50 border border-amber-800 text-amber-300 rounded-xl text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{cameraError}</span>
                </div>
              )}

              <div className="flex items-center justify-center pt-1">
                <button
                  type="button"
                  onClick={handleCaptureSnapshot}
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-3 px-8 rounded-2xl shadow-xl flex items-center space-x-2 text-sm cursor-pointer transition-all hover:scale-105 active:scale-95"
                >
                  <Camera className="w-5 h-5" />
                  <span>Tomar Foto y Escanear</span>
                </button>
              </div>
            </div>
          )}

          {/* 2. UPLOAD FILE MODE */}
          {mode === 'upload' && (
            <div className="space-y-4">
              <label className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-2xl p-8 text-center space-y-3 transition-colors bg-slate-950/50 block cursor-pointer">
                <Upload className="w-10 h-10 mx-auto text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-slate-200">
                    Selecciona o arrastra una foto de la Cuenta de Cobro Firmada
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Formatos: JPG, PNG, WEBP (Se procesará con el filtro Magia Pro B&N)
                  </p>
                </div>
                <div className="inline-block bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold py-2 px-5 rounded-xl text-xs border border-slate-700">
                  Examinar Galería / Archivos
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>
          )}

          {/* 3. PREVIEW & SCANNER ENHANCEMENT MODE */}
          {mode === 'preview' && (
            <div className="space-y-4">
              {/* Processed Canvas Display */}
              <div className="relative bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 p-2 flex items-center justify-center min-h-[260px] max-h-[380px]">
                <canvas
                  ref={canvasRef}
                  className="max-w-full max-h-[360px] object-contain rounded-lg shadow-lg border border-slate-800 bg-white"
                />

                {/* Floating Rotate Button */}
                <button
                  type="button"
                  onClick={handleRotate}
                  className="absolute bottom-4 right-4 bg-slate-900/90 hover:bg-slate-800 text-amber-400 p-2.5 rounded-xl border border-slate-700 shadow-xl text-xs flex items-center space-x-1.5 cursor-pointer backdrop-blur"
                  title="Girar 90°"
                >
                  <RotateCw className="w-4 h-4" />
                  <span className="font-semibold text-[11px]">Girar</span>
                </button>
              </div>

              {/* Filter Type Options */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Filtro de Escaneo (Estilo CamScanner):</span>
                </label>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelectedFilter('magic_bw')}
                    className={`py-2 px-2.5 rounded-xl font-bold border transition-all cursor-pointer text-center ${
                      selectedFilter === 'magic_bw'
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    🪄 Magia Pro B&N
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFilter('magic_gray')}
                    className={`py-2 px-2.5 rounded-xl font-bold border transition-all cursor-pointer text-center ${
                      selectedFilter === 'magic_gray'
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    📄 Escala de Grises
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFilter('original')}
                    className={`py-2 px-2.5 rounded-xl font-bold border transition-all cursor-pointer text-center ${
                      selectedFilter === 'original'
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    🎨 Original a Color
                  </button>
                </div>
              </div>

              {/* Fine Tuning Sliders */}
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="flex justify-between text-slate-400 mb-1">
                    <span>Contraste de Texto:</span>
                    <span className="font-mono text-slate-200">{contrast}</span>
                  </div>
                  <input
                    type="range"
                    min="-20"
                    max="50"
                    value={contrast}
                    onChange={(e) => setContrast(Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-slate-400 mb-1">
                    <span>Brillo / Fondo Blanco:</span>
                    <span className="font-mono text-slate-200">{brightness}</span>
                  </div>
                  <input
                    type="range"
                    min="-40"
                    max="40"
                    value={brightness}
                    onChange={(e) => setBrightness(Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Assign Month / Period */}
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center space-x-2 text-slate-300 font-semibold">
                  <Calendar className="w-4 h-4 text-amber-400" />
                  <span>Mes Asignado a esta Cuenta:</span>
                </div>
                <div className="flex items-center space-x-2">
                  <select
                    value={mes}
                    onChange={(e) => setMes(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-slate-100 font-bold rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {MESES_SISTEMA.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={anio}
                    onChange={(e) => setAnio(e.target.value)}
                    className="w-16 bg-slate-900 border border-slate-700 text-slate-100 font-bold rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Success Notification */}
              {successMsg && (
                <div className="p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-300 rounded-xl text-xs flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode('camera');
                    startCamera();
                  }}
                  className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2.5 px-4 rounded-xl text-xs cursor-pointer border border-slate-700"
                >
                  Volver a Tomar Foto
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveScannedAccount}
                  className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-2.5 px-6 rounded-xl shadow-xl text-xs flex items-center justify-center space-x-2 cursor-pointer transition-all hover:scale-105"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{saving ? 'Guardando en Base de Datos...' : 'Confirmar y Guardar Cuenta'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
