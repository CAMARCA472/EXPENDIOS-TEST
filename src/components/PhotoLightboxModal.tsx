import React, { useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw, Download, MapPin, User, Building, FileText } from 'lucide-react';

interface PhotoLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  title: string;
  subtitle?: string;
  metadata?: {
    encargado?: string;
    cedula?: string;
    municipio?: string;
    direccion?: string;
    telefono?: string;
    fecha?: string;
  };
}

export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  title,
  subtitle,
  metadata,
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);

  if (!isOpen || !imageUrl) return null;

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => {
    setZoom(1);
    setRotation(0);
  };
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = imageUrl;
    const cleanTitle = (title || 'foto_expendio').toLowerCase().replace(/[^a-z0-9]/gi, '_');
    link.download = `${cleanTitle}_${new Date().toISOString().split('T')[0]}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-hidden animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-5xl w-full max-h-[95vh] flex flex-col shadow-2xl overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="p-4 bg-slate-950/90 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
              <FileText className="w-4 h-4" />
              <span>Visor de Evidencia Fotográfica Oficial</span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-100 mt-0.5">
              {title}
            </h3>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          </div>

          {/* Controls Bar */}
          <div className="flex items-center space-x-1.5 self-end sm:self-auto">
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors cursor-pointer"
              title="Aumentar Zoom"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors cursor-pointer"
              title="Disminuir Zoom"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleRotate}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors cursor-pointer"
              title="Rotar 90°"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              title="Restablecer"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer shadow"
              title="Descargar Foto"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Descargar</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 bg-slate-800 hover:bg-rose-900 text-slate-400 hover:text-rose-200 rounded-xl transition-colors cursor-pointer ml-1"
              title="Cerrar (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Center Image Canvas */}
        <div className="flex-1 bg-slate-950 flex items-center justify-center p-4 min-h-[360px] max-h-[65vh] overflow-auto select-none">
          <div
            className="transition-transform duration-200 flex items-center justify-center"
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
            }}
          >
            <img
              src={imageUrl}
              alt={title}
              className="max-h-[60vh] max-w-full object-contain rounded-lg shadow-2xl border border-slate-800"
              crossOrigin="anonymous"
            />
          </div>
        </div>

        {/* Footer Metadata */}
        {metadata && (
          <div className="p-3 bg-slate-950/95 border-t border-slate-800 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {metadata.encargado && (
                <div className="flex items-center space-x-1.5">
                  <User className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    Encargado: <strong className="text-slate-100">{metadata.encargado}</strong>
                    {metadata.cedula ? ` (C.C. ${metadata.cedula})` : ''}
                  </span>
                </div>
              )}
              {metadata.municipio && (
                <div className="flex items-center space-x-1.5">
                  <Building className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Municipio: {metadata.municipio}</span>
                </div>
              )}
              {metadata.direccion && (
                <div className="flex items-center space-x-1.5">
                  <MapPin className="w-3.5 h-3.5 text-sky-400" />
                  <span>Dir: {metadata.direccion}</span>
                </div>
              )}
            </div>
            <div className="text-[11px] text-slate-500 font-mono">
              CAMARCA SAS | Operador Postal 4-72
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
