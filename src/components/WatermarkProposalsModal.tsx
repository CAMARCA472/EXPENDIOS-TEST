import React, { useState } from 'react';
import { X, Sparkles, Eye, CheckCircle2, FileText, ZoomIn } from 'lucide-react';

export type WatermarkStyleId = 'propuesta_1' | 'propuesta_2' | 'propuesta_3';

interface WatermarkProposalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedStyle?: WatermarkStyleId;
  onSelectStyle?: (style: WatermarkStyleId) => void;
}

interface ProposalItem {
  id: WatermarkStyleId;
  badge: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  highlights: string[];
  accentClass: string;
}

const PROPOSALS: ProposalItem[] = [
  {
    id: 'propuesta_1',
    badge: 'OPCIÓN 1 • RECOMENDADA (MÁXIMA VISIBILIDAD)',
    title: 'Diseño 1: HUD Telemetría Moderna & Insignia Superior',
    subtitle:
      'Insignia oficial 4-72 + CAMARCA a la izquierda, pastilla superior de evidencia georreferenciada y cajas de telemetría GPS/Hora de alto contraste.',
    imageUrl: '/assets/watermark_previews/1_propuesta_hud_telemetria.jpg',
    highlights: [
      'Sello corporativo amarillo 4-72 + CAMARCA de gran tamaño y lectura inmediata',
      'Etiqueta superior derecha grande ("4. FOTO BÁSCULA") visible incluso en miniatura PDF',
      'Píldoras independientes con iconos vectoriales para Coordenadas GPS y Fecha/Hora',
      'Tipografía forzada limpia (evita que fuentes personalizadas de celulares deformen los dos puntos)',
    ],
    accentClass: 'border-amber-500/80 bg-amber-950/20',
  },
  {
    id: 'propuesta_2',
    badge: 'OPCIÓN 2 • SEGURIDAD ANTI-FRAUDE',
    title: 'Diseño 2: Tarjeta Flotante + Sello Diagonal Transversal',
    subtitle:
      'Incluye marca de agua diagonal translúcida sobre el centro de la foto (imposible de recortar) más tarjeta flotante inferior con cabecera bicolor.',
    imageUrl: '/assets/watermark_previews/2_propuesta_tarjeta_flotante_sello.jpg',
    highlights: [
      'Sello diagonal central translúcido con nombre del municipio y cédula sobre la foto',
      'Tarjeta inferior flotante con bordes redondeados y barra superior dividida (Ámbar / Esmeralda)',
      'Separación en 2 columnas: Datos del Expendio a la izquierda y Cajas GPS/Fecha a la derecha',
    ],
    accentClass: 'border-emerald-500/80 bg-emerald-950/20',
  },
  {
    id: 'propuesta_3',
    badge: 'OPCIÓN 3 • CORPORATIVO 3 CELDAS',
    title: 'Diseño 3: Franja Institucional Doble (Grilla de 3 Bloques)',
    subtitle:
      'Cintillo superior fijo de extremo a extremo y pie de foto estructurado en 3 tarjetas independientes para Municipio, GPS y Fecha.',
    imageUrl: '/assets/watermark_previews/3_propuesta_franja_institucional.jpg',
    highlights: [
      'Cintillo superior institucional con logo 4-72 y título de la fotografía en verde',
      'Tres tarjetas inferiores separadas por color: Amarillo (Expendio), Azul (GPS), Verde (Fecha/Hora)',
      'Coordenadas Latitud y Longitud en renglones separados de gran tamaño (24px)',
    ],
    accentClass: 'border-sky-500/80 bg-sky-950/20',
  },
];

export const WatermarkProposalsModal: React.FC<WatermarkProposalsModalProps> = ({
  isOpen,
  onClose,
  selectedStyle = 'propuesta_1',
  onSelectStyle,
}) => {
  const [zoomedImage, setZoomedImage] = useState<{ title: string; url: string } | null>(null);
  const [viewMode, setViewMode] = useState<'full' | 'pdf_sim'>('full');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-6xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 bg-slate-950 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-amber-400 text-xs font-black uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              <span>Propuestas de Rediseño • Marca de Agua Oficial CAMARCA S.A.S. | 4-72</span>
            </div>
            <h2 className="text-lg sm:text-xl font-black text-white mt-0.5">
              Comparativa Visual: Nuevo Diseño Moderno y de Alta Visibilidad
            </h2>
            <p className="text-xs text-slate-400">
              Revisa cómo lucen las 3 propuestas sobre una fotografía real de Zapatoca antes de aplicar el cambio a todas las fotos publicadas.
            </p>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex items-center text-xs font-bold">
              <button
                type="button"
                onClick={() => setViewMode('full')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'full'
                    ? 'bg-amber-500 text-slate-950 font-black'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Vista Grande</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('pdf_sim')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'pdf_sim'
                    ? 'bg-amber-500 text-slate-950 font-black'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Simulación Tamaño PDF (7 Fotos)</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
              title="Cerrar vista previa"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6">
          {/* Before / Current Reference Bar */}
          <div className="bg-slate-950/90 border border-rose-900/60 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4">
            <div className="w-full md:w-64 shrink-0">
              <div
                onClick={() =>
                  setZoomedImage({
                    title: 'Diseño Anterior (Texto pequeño en PDF y fuente distorsionada)',
                    url: '/assets/watermark_previews/0_actual_bascula.jpg',
                  })
                }
                className="relative rounded-lg overflow-hidden border border-slate-800 cursor-pointer group"
              >
                <img
                  src="/assets/watermark_previews/0_actual_bascula.jpg"
                  alt="Marca de agua actual"
                  className="w-full h-36 object-cover"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <span className="bg-slate-900/90 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                    <ZoomIn className="w-3.5 h-3.5" /> Ver Antes
                  </span>
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-1.5">
              <span className="inline-block text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">
                DISEÑO ANTERIOR (PROBLEMAS DETECTADOS)
              </span>
              <h4 className="text-sm font-bold text-slate-200">
                ¿Por qué la marca de agua anterior se veía muy pequeña en el PDF de 7 fotos?
              </h4>
              <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
                <li>
                  El texto tenía entre <strong className="text-slate-200">11px y 15px</strong> sin contenedores de contraste, volviéndose diminuto al imprimir las 7 fotos en una sola hoja.
                </li>
                <li>
                  En teléfonos con fuentes personalizadas de Android, los signos <code className="text-amber-300">:</code> y paréntesis se deformaban con símbolos extraños.
                </li>
                <li>
                  En fotos tomadas verticalmente, la franja ocupaba apenas el 6% de la altura total de la foto.
                </li>
              </ul>
            </div>
          </div>

          {/* 3 Modern Proposals */}
          {viewMode === 'full' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {PROPOSALS.map((prop) => {
                const isSelected = selectedStyle === prop.id;
                return (
                  <div
                    key={prop.id}
                    className={`rounded-2xl border-2 p-4 flex flex-col justify-between transition-all ${
                      isSelected
                        ? prop.accentClass
                        : 'border-slate-800 bg-slate-950/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-md bg-slate-900 text-amber-400 border border-amber-500/40">
                          {prop.badge}
                        </span>
                        {isSelected && (
                          <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" /> Activa para pruebas
                          </span>
                        )}
                      </div>

                      <h3 className="text-base font-black text-white leading-snug">{prop.title}</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">{prop.subtitle}</p>

                      {/* Preview Image */}
                      <div
                        onClick={() => setZoomedImage({ title: prop.title, url: prop.imageUrl })}
                        className="relative rounded-xl overflow-hidden border border-slate-700 bg-slate-900 cursor-pointer group shadow-lg"
                      >
                        <img
                          src={prop.imageUrl}
                          alt={prop.title}
                          className="w-full aspect-3/2 object-cover group-hover:scale-[1.02] transition-transform duration-300"
                        />
                        <div className="absolute top-2 right-2 bg-slate-950/85 text-amber-300 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-amber-500/40 flex items-center gap-1">
                          <ZoomIn className="w-3 h-3" /> Clic para ampliar
                        </div>
                      </div>

                      <ul className="space-y-1.5 pt-1">
                        {prop.highlights.map((item, idx) => (
                          <li key={idx} className="text-[11px] text-slate-300 flex items-start gap-1.5">
                            <span className="text-emerald-400 font-black mt-0.5">✓</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="pt-4 mt-4 border-t border-slate-800/80 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setZoomedImage({ title: prop.title, url: prop.imageUrl })}
                        className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <ZoomIn className="w-3.5 h-3.5 text-amber-400" />
                        <span>Ampliar Muestra</span>
                      </button>
                      {onSelectStyle && (
                        <button
                          type="button"
                          onClick={() => onSelectStyle(prop.id)}
                          className={`flex-1 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-emerald-600 text-white'
                              : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isSelected ? 'Seleccionada' : 'Elegir este Diseño'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* PDF Thumbnail Size Simulation (3 columns just like the 7-photo PDF sheet) */
            <div className="bg-white rounded-2xl p-6 text-slate-900 shadow-inner space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <span className="text-[11px] font-black uppercase tracking-wider text-amber-600">
                    SIMULACIÓN REAL DE HOJA CARTA PDF (GRILLA DE 3 COLUMNAS)
                  </span>
                  <h3 className="text-base font-black text-slate-900">
                    Así se leen las 3 propuestas al tamaño exacto con el que salen en el PDF de las 7 Fotos:
                  </h3>
                </div>
                <span className="text-xs font-bold text-slate-500">Escala 1:1 de impresión PDF</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
                {PROPOSALS.map((prop, index) => (
                  <div
                    key={prop.id}
                    className="border border-slate-300 rounded-lg overflow-hidden bg-slate-50 shadow-sm"
                  >
                    <div className="bg-slate-900 text-amber-400 text-[11px] font-black px-3 py-1.5 flex items-center justify-between">
                      <span>4. FOTO BÁSCULA</span>
                      <span className="text-[9px] text-emerald-300">DISEÑO {index + 1}</span>
                    </div>
                    <div className="p-1.5 bg-white">
                      <img
                        src={prop.imageUrl}
                        alt={prop.title}
                        onClick={() => setZoomedImage({ title: prop.title, url: prop.imageUrl })}
                        className="w-full h-44 object-contain cursor-pointer border border-slate-200 rounded"
                      />
                    </div>
                    <div className="px-3 py-2 bg-slate-100 border-t border-slate-200 text-center">
                      <p className="text-xs font-black text-slate-800">{prop.title.split(':')[0]}</p>
                      <p className="text-[10px] text-slate-600">{prop.title.split(':')[1]}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            💡 <strong className="text-amber-300">Nota:</strong> Tus fotos actuales no han sido modificadas todavía. Indícame cuál de los 3 diseños prefieres (o si deseas algún ajuste) para aplicarlo en las fotos cargadas y en la versión publicada.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-5 py-2 rounded-xl text-xs cursor-pointer shrink-0"
          >
            Cerrar Comparativa
          </button>
        </div>
      </div>

      {/* Fullscreen Lightbox for Zooming */}
      {zoomedImage && (
        <div
          onClick={() => setZoomedImage(null)}
          className="fixed inset-0 z-[90] bg-black/95 flex flex-col items-center justify-center p-4 cursor-zoom-out"
        >
          <div className="max-w-5xl w-full flex items-center justify-between mb-3">
            <h3 className="text-white font-black text-sm sm:text-base">{zoomedImage.title}</h3>
            <button
              type="button"
              onClick={() => setZoomedImage(null)}
              className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-4 h-4" /> Cerrar Zoom
            </button>
          </div>
          <img
            src={zoomedImage.url}
            alt={zoomedImage.title}
            className="max-h-[82vh] max-w-full object-contain rounded-xl border border-slate-700 shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
