import React, { useState } from 'react';
import {
  Sparkles,
  UserCheck,
  Camera,
  FileCheck2,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Store,
  Info,
  ExternalLink,
  ShieldCheck,
  HelpCircle,
  X
} from 'lucide-react';
import { ExpendioData } from '../types';

interface ExpendioBienvenidaCapacitacionModalProps {
  isOpen: boolean;
  onClose: () => void;
  expendio: ExpendioData;
  isLight?: boolean;
}

export const ExpendioBienvenidaCapacitacionModal: React.FC<ExpendioBienvenidaCapacitacionModalProps> = ({
  isOpen,
  onClose,
  expendio,
  isLight = true,
}) => {
  const [activeStep, setActiveStep] = useState<number>(0);

  if (!isOpen) return null;

  // Extract first name and city for a warm, natural personalized greeting:
  // e.g. "DIEGO FERNANDO PEREZ" -> "Diego"
  // "GIRON" -> "Girón"
  const rawName = (expendio.encargado || 'Contratista').trim();
  const firstName = rawName.split(' ')[0]
    ? rawName.split(' ')[0].charAt(0).toUpperCase() + rawName.split(' ')[0].slice(1).toLowerCase()
    : rawName;
  const rawCity = (expendio.municipio || expendio.localidad || 'Punto').trim();
  const cityName = rawCity.charAt(0).toUpperCase() + rawCity.slice(1).toLowerCase();

  const trainingModules = [
    {
      id: 1,
      tag: 'MÓDULO 1',
      title: 'Actualización Oficial de Datos & Cuenta Bancaria',
      icon: UserCheck,
      color: 'amber',
      shortDesc: 'Tus datos de contacto, dirección y cuenta para pago de honorarios.',
      details: [
        {
          heading: 'Verificación de Contacto y Dirección',
          text: 'Es indispensable mantener tu número de celular, correo electrónico y dirección física exacta actualizados para todas las notificaciones operativas.',
        },
        {
          heading: 'Cuenta Bancaria para Giros (Nequi / Bancolombia / Otros)',
          text: 'Registra y confirma tu número de cuenta bancaria o billetera virtual. Sobre este número se realizarán las transferencias de tus liquidaciones mensuales.',
        },
        {
          heading: 'Casilla de Observaciones & Sugerencias',
          text: 'Dispones de un espacio dedicado para reportar novedades, comentarios o sugerencias directas a la administración de CAMARCA SAS y 4-72.',
        },
      ],
      tip: 'Todo se guarda automáticamente en mayúsculas sostenidas según los lineamientos de 4-72.',
    },
    {
      id: 2,
      tag: 'MÓDULO 2',
      title: 'Registro Fotográfico Obligatorio de Cumplimiento',
      icon: Camera,
      color: 'sky',
      shortDesc: '7 fotografías con geolocalización GPS y fecha exacta.',
      details: [
        {
          heading: 'Toma Directa desde tu Celular',
          text: 'Puedes capturar las fotos directamente con la cámara de tu teléfono móvil o adjuntarlas desde tu galería de imágenes.',
        },
        {
          heading: '¿No dispones de Báscula, Matasello o Letrero/Aviso?',
          text: '¡Importante! Si en tu punto no cuentas con báscula, matasello o letrero exterior, el sistema te permite marcar la opción "No dispongo de este ítem". Esto actualizará la base de datos a "NO" y te permitirá continuar con el cargue sin ningún bloqueo.',
        },
        {
          heading: 'Estampado Automático GPS',
          text: 'El sistema incrusta en cada foto las coordenadas satelitales, nombre del expendio, municipio, fecha y hora para validar tu cumplimiento contractual.',
        },
      ],
      tip: 'Si tienes los 3 elementos, toma la foto para que la base de datos se actualice automáticamente a "SI".',
    },
    {
      id: 3,
      tag: 'MÓDULO 3',
      title: 'Liquidación Mensual & Cuentas de Cobro',
      icon: FileCheck2,
      color: 'emerald',
      shortDesc: 'Generación, firma digital y descarga en PDF oficial.',
      details: [
        {
          heading: 'Consulta de tu Liquidación',
          text: 'Visualiza el valor mensual bruto, retenciones de ley y el valor neto a transferir por los servicios postales prestados.',
        },
        {
          heading: 'Firma Digital y Generación PDF',
          text: 'Firma directamente en pantalla usando tu dedo o ratón. El sistema generará tu Cuenta de Cobro en PDF con formato oficial 4-72 listo para descargar.',
        },
        {
          heading: 'Radicación de Soportes',
          text: 'Puedes cargar la cuenta firmada y el comprobante de pago para tener el historial consolidado de todos los meses del año.',
        },
      ],
      tip: 'Cada periodo queda archivado para que puedas consultar tus cuentas históricas en cualquier momento.',
    },
  ];

  const currentModule = trainingModules[activeStep];

  const handleNext = () => {
    if (activeStep < trainingModules.length - 1) {
      setActiveStep(activeStep + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn overflow-y-auto">
      <div
        className={`w-full max-w-2xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[95vh] ${
          isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-800 text-white'
        }`}
      >
        {/* Top Header Banner */}
        <div className="bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 px-5 py-5 text-slate-950 relative">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-2xl bg-white/30 backdrop-blur-md flex items-center justify-center shadow-inner text-slate-950">
                <Store className="w-7 h-7" />
              </div>
              <div>
                <div className="inline-flex items-center space-x-1.5 bg-slate-950/20 text-slate-950 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider mb-1">
                  <Sparkles className="w-3 h-3 text-amber-950" />
                  <span>Primer Ingreso al Sistema</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black tracking-tight leading-none text-slate-950">
                  ¡Bienvenido {firstName} - Expendio {cityName}!
                </h2>
                <p className="text-xs text-amber-950/90 font-medium mt-1">
                  Portal Oficial de Gestión Operativa y Cuentas de Cobro 4-72 & CAMARCA S.A.S.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="text-slate-900 hover:text-slate-950 p-1.5 rounded-xl hover:bg-black/10 transition-colors cursor-pointer"
              title="Cerrar y continuar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Steps Navigation Tabs */}
        <div className="px-5 pt-3 pb-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 overflow-x-auto">
          {trainingModules.map((mod, idx) => {
            const isCurrent = activeStep === idx;
            const isCompleted = activeStep > idx;
            return (
              <button
                key={mod.id}
                onClick={() => setActiveStep(idx)}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer border ${
                  isCurrent
                    ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-sm'
                    : isCompleted
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800'
                    : isLight
                    ? 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                    isCurrent
                      ? 'bg-slate-950 text-amber-400'
                      : isCompleted
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {isCompleted ? '✓' : idx + 1}
                </div>
                <span className="truncate whitespace-nowrap text-[11px] uppercase">
                  {mod.tag}
                </span>
              </button>
            );
          })}
        </div>

        {/* Module Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Module Title Box */}
          <div className="flex items-start space-x-3.5">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                currentModule.id === 1
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                  : currentModule.id === 2
                  ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400'
                  : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              <currentModule.icon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Capacitación de Módulos • Paso {activeStep + 1} de {trainingModules.length}
              </div>
              <h3 className="text-base sm:text-lg font-black tracking-tight mt-0.5">
                {currentModule.title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {currentModule.shortDesc}
              </p>
            </div>
          </div>

          {/* Detailed Points */}
          <div className="space-y-2.5 pt-1">
            {currentModule.details.map((point, i) => (
              <div
                key={i}
                className={`p-3.5 rounded-2xl border transition-all ${
                  isLight
                    ? 'bg-slate-50 border-slate-200/80 hover:border-slate-300'
                    : 'bg-slate-800/60 border-slate-700/60 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center space-x-2 font-bold text-xs mb-1 text-slate-800 dark:text-slate-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{point.heading}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 pl-6 leading-relaxed">
                  {point.text}
                </p>
              </div>
            ))}
          </div>

          {/* Module Helpful Note / Tip */}
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl flex items-start space-x-2.5 text-xs text-amber-900 dark:text-amber-200">
            <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="leading-snug">
              <span className="font-bold">Recomendación Clave:</span> {currentModule.tip}
            </p>
          </div>
        </div>

        {/* Modal Bottom Footer Actions */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={handlePrev}
            disabled={activeStep === 0}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition-colors cursor-pointer ${
              activeStep === 0
                ? 'opacity-40 cursor-not-allowed text-slate-400'
                : isLight
                ? 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Anterior</span>
          </button>

          <div className="flex items-center space-x-1.5">
            {trainingModules.map((_, dotIdx) => (
              <div
                key={dotIdx}
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  activeStep === dotIdx
                    ? 'w-6 bg-amber-500'
                    : activeStep > dotIdx
                    ? 'bg-emerald-500'
                    : 'bg-slate-300 dark:bg-slate-700'
                }`}
              />
            ))}
          </div>

          {activeStep < trainingModules.length - 1 ? (
            <button
              type="button"
              onClick={handleNext}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-all active:scale-98"
            >
              <span>Siguiente Módulo</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-black px-5 py-2.5 rounded-xl text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-all active:scale-98"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>¡Entendido! Comenzar a usar el portal</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
