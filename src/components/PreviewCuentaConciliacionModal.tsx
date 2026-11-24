import React, { useState } from 'react';
import { CuentaCobroResult, ExpendioData } from '../types';
import { formatPesos } from '../utils/formatters';
import {
  FileCheck2,
  CheckCircle2,
  AlertTriangle,
  X,
  ChevronLeft,
  ChevronRight,
  Printer,
  Building2,
  UserCheck,
  CreditCard,
  MapPin,
  Calendar,
  DollarSign,
  ShieldCheck,
  Loader2,
  Check,
  ArrowRight,
  ExternalLink,
  Maximize2
} from 'lucide-react';

interface PreviewCuentaConciliacionModalProps {
  isOpen: boolean;
  onClose: () => void;
  cuentas: CuentaCobroResult[];
  initialIndex?: number;
  expendiosList?: ExpendioData[];
  onConciliacionExitosa?: (conciliada: CuentaCobroResult) => void;
}

export const PreviewCuentaConciliacionModal: React.FC<PreviewCuentaConciliacionModalProps> = ({
  isOpen,
  onClose,
  cuentas,
  initialIndex = 0,
  expendiosList = [],
  onConciliacionExitosa,
}) => {
  const [currentIndex, setCurrentIndex] = useState<number>(
    Math.min(Math.max(0, initialIndex), Math.max(0, cuentas.length - 1))
  );
  const [conciliadasIds, setConciliadasIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [numeroComprobante, setNumeroComprobante] = useState<string>('');
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!isOpen || cuentas.length === 0) return null;

  const currentCuenta = cuentas[currentIndex];
  if (!currentCuenta) return null;

  const cargo = currentCuenta.cargoBasico ?? currentCuenta.valorBase ?? 0;
  const sipost = currentCuenta.admisionSipost ?? 0;
  const variable = currentCuenta.valorVariable ?? 0;
  const isGrossUp = !!currentCuenta.grossUpAplicado;
  const pRet = currentCuenta.porcentajeRetencion || 1;
  const subtotalBruto = cargo + sipost + variable;
  const retef = isGrossUp ? 0 : (currentCuenta.retef1 ?? currentCuenta.retencionValor ?? Math.round(subtotalBruto * (pRet / 100)));
  const valorNeto = isGrossUp ? subtotalBruto : (currentCuenta.valorNeto ?? (subtotalBruto - retef));

  // Buscar coincidencia en maestro de expendios
  const cleanCed = (currentCuenta.cedula || '').replace(/\D/g, '');
  const munUpper = (currentCuenta.municipio || currentCuenta.expendio || '').trim().toUpperCase();
  const matchedExpendio = expendiosList.find(
    (e) =>
      (cleanCed && (e.cedula || '').replace(/\D/g, '') === cleanCed) ||
      ((e.municipio || e.localidad || '').trim().toUpperCase() === munUpper)
  );

  const cuentaKey = `${currentCuenta.cedula || currentCuenta.encargado}-${currentCuenta.periodo || ''}-${currentIndex}`;
  const isAlreadyConciliada = conciliadasIds.has(cuentaKey) || currentCuenta.estado === 'Cancelado';

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setFeedbackMsg(null);
    }
  };

  const handleNext = () => {
    if (currentIndex < cuentas.length - 1) {
      setCurrentIndex((i) => i + 1);
      setFeedbackMsg(null);
    }
  };

  const handleAprobarConciliacion = async () => {
    setIsProcessing(true);
    setFeedbackMsg(null);

    try {
      const payload = {
        municipio: currentCuenta.municipio || currentCuenta.expendio,
        mes: currentCuenta.periodo?.split(' ')[0] || 'MARZO',
        anio: currentCuenta.periodo?.split(' ')[1] || '2026',
        encargado: currentCuenta.encargado,
        cedula: currentCuenta.cedula,
        valorCobro: valorNeto,
        soporteUrl: currentCuenta.soporteUrl || '',
        datosSoporte: {
          entidad: matchedExpendio?.banco || 'Transferencia Bancaria',
          referencia: numeroComprobante.trim() || `CONCIL-${Date.now()}`,
          fecha: new Date().toISOString().split('T')[0],
        },
      };

      const res = await fetch('/api/admin/aprobar-conciliacion-cuenta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setConciliadasIds((prev) => new Set(prev).add(cuentaKey));
        setFeedbackMsg({
          type: 'success',
          text: `✓ ¡Cuenta de ${currentCuenta.municipio || currentCuenta.encargado} conciliada y marcada como Cancelada exitosamente!`,
        });

        if (onConciliacionExitosa) {
          onConciliacionExitosa({ ...currentCuenta, estado: 'Cancelado' });
        }
      } else {
        setFeedbackMsg({
          type: 'error',
          text: data.message || 'Error al aprobar la conciliación.',
        });
      }
    } catch (err: any) {
      console.error('Error al conciliar:', err);
      setFeedbackMsg({
        type: 'error',
        text: 'Error de red o comunicación con el servidor al conciliar la cuenta.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-6xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
              <FileCheck2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-black text-slate-100">
                  Vista Previa Oficial de la Cuenta a Conciliar
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                  {currentCuenta.periodo || 'PERIODO ACTIVO'}
                </span>
                {isAlreadyConciliada && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center space-x-1">
                    <Check className="w-3 h-3" />
                    <span>CONCILIADA</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Visualiza el documento de la cuenta antes de autorizar la conciliación en la Relación de Pagos y el Historial.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Carousel navigation */}
            {cuentas.length > 1 && (
              <div className="flex items-center space-x-1 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1">
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={currentIndex === 0}
                  className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  title="Cuenta anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono font-bold text-slate-300 px-1">
                  {currentIndex + 1} / {cuentas.length}
                </span>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={currentIndex === cuentas.length - 1}
                  className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  title="Siguiente cuenta"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title="Cerrar vista previa"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Feedback message banner */}
        {feedbackMsg && (
          <div
            className={`px-6 py-2.5 text-xs flex items-center justify-between border-b ${
              feedbackMsg.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/80 border-rose-500/40 text-rose-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              {feedbackMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span className="font-medium">{feedbackMsg.text}</span>
            </div>
            <button
              onClick={() => setFeedbackMsg(null)}
              className="text-xs underline cursor-pointer ml-3 opacity-80 hover:opacity-100"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Modal Body: Split View */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 bg-slate-900/60">
          {/* Left Column: Official Document Preview Layout (Carta de Cuenta de Cobro) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white text-slate-900 rounded-2xl p-6 sm:p-7 shadow-xl border border-slate-300 relative space-y-5">
              {/* Watermark/Stamp if Conciliada */}
              {isAlreadyConciliada && (
                <div className="absolute top-8 right-8 rotate-12 border-4 border-emerald-600 text-emerald-700 px-4 py-1.5 rounded-xl font-black text-xs uppercase tracking-widest bg-emerald-50/80 shadow-md pointer-events-none select-none">
                  ✓ CONCILIADO Y CANCELADO
                </div>
              )}

              {/* Document Header */}
              <div className="border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black uppercase tracking-tight text-slate-950">
                    CAMARCA S.A.S.
                  </h2>
                  <p className="text-xs font-semibold text-slate-700">NIT: 900504241-7</p>
                  <p className="text-[11px] text-slate-500">Operador Logístico Regional • Convenio 4-72</p>
                </div>
                <div className="text-left sm:text-right">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                    Documento Oficial
                  </span>
                  <span className="text-base font-black text-slate-900 font-mono">
                    CUENTA DE COBRO
                  </span>
                  <div className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-300 mt-1 inline-block">
                    Periodo: {currentCuenta.periodo || 'MARZO 2026'}
                  </div>
                </div>
              </div>

              {/* Contratista / Encargado Data */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Encargado / Contratista:
                    </span>
                    <strong className="text-slate-950 text-sm block">
                      {currentCuenta.encargado}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Cédula / Identificación:
                    </span>
                    <span className="font-mono text-slate-900 font-bold text-sm">
                      {currentCuenta.cedula}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-200">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Municipio:
                    </span>
                    <span className="font-semibold text-slate-800">
                      {currentCuenta.municipio || currentCuenta.expendio}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Centro Operativo:
                    </span>
                    <span className="font-semibold text-slate-800">
                      {currentCuenta.centroOperativo || matchedExpendio?.centroOperativo || 'REGIONAL ORIENTE'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Teléfono de Contacto:
                    </span>
                    <span className="font-mono text-slate-800">
                      {currentCuenta.telefono || matchedExpendio?.telefonoPunto || 'Registrado'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Financial Items Table */}
              <div className="space-y-1">
                <span className="text-[11px] font-black uppercase text-slate-700 tracking-wider">
                  Liquidación Financiera del Período
                </span>
                <table className="w-full text-xs border border-slate-300 rounded-lg overflow-hidden">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="py-2 px-3 text-left">Concepto</th>
                      <th className="py-2 px-3 text-right">Valor Liquidado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">
                        1. Cargo Básico Operativo de Expendio
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                        {formatPesos(cargo)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">
                        2. Admisión SIPOST / Ventas de Envíos
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-700">
                        {formatPesos(sipost)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">
                        3. Variable de Gestión y Entregas
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-700">
                        {formatPesos(variable)}
                      </td>
                    </tr>
                    <tr className="bg-slate-50/80 font-bold">
                      <td className="py-2 px-3 text-slate-800">
                        Subtotal Bruto Liquidado
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-900">
                        {formatPesos(subtotalBruto)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-rose-700">
                        Menos: Retención en la Fuente ({pRet}%)
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-rose-700">
                        -{formatPesos(retef)}
                      </td>
                    </tr>
                    <tr className="bg-emerald-50 border-t-2 border-emerald-600 font-black text-sm">
                      <td className="py-2.5 px-3 text-emerald-950 uppercase tracking-wide">
                        TOTAL NETO A PAGAR
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-800 text-base">
                        {formatPesos(valorNeto)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Bank Account Details */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center space-x-2.5">
                  <CreditCard className="w-5 h-5 text-slate-600 shrink-0" />
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">
                      Dispersión de Fondos:
                    </span>
                    <span className="font-bold text-slate-900">
                      {currentCuenta.banco || matchedExpendio?.banco || 'Bancolombia / Nequi'}
                    </span>
                    <span className="text-slate-600 ml-2 font-mono text-xs">
                      No. {currentCuenta.cuentaBancaria || currentCuenta.cuenta || matchedExpendio?.cuentaBancaria || 'Registrada en Ficha'}
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 font-medium sm:text-right">
                  Tipo: {currentCuenta.tipoCuenta || matchedExpendio?.tipoCuenta || 'Ahorros'}
                </div>
              </div>

              {/* Physical Scanned Document / Voucher Preview (if available) */}
              {(currentCuenta.soporteUrl || (currentCuenta as any).archivoUrl || (currentCuenta as any).imagenEscaneadaUrl) && (
                <div className="border border-slate-300 rounded-xl p-3 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                    <span>Soporte Físico Escaneado Adjunto</span>
                    <a
                      href={currentCuenta.soporteUrl || (currentCuenta as any).archivoUrl || (currentCuenta as any).imagenEscaneadaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-600 hover:underline flex items-center space-x-1"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Ver Original</span>
                    </a>
                  </div>
                  <div className="max-h-60 overflow-hidden rounded-lg bg-black/10 flex items-center justify-center">
                    <img
                      src={currentCuenta.soporteUrl || (currentCuenta as any).archivoUrl || (currentCuenta as any).imagenEscaneadaUrl}
                      alt="Soporte Físico de Cuenta"
                      className="max-h-56 object-contain mx-auto"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Reconciliaton Control & Comparison Workspace */}
          <div className="lg:col-span-5 space-y-4">
            {/* Status & Match Card */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center space-x-2 text-slate-200">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h4 className="text-sm font-bold">Estado de Conciliación & Relación de Pagos</h4>
              </div>

              <div className="space-y-3 text-xs">
                {/* Status indicator */}
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Estado en el Sistema:
                  </span>
                  <div className="flex items-center space-x-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        isAlreadyConciliada ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                      }`}
                    />
                    <span
                      className={`font-black text-sm ${
                        isAlreadyConciliada ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {isAlreadyConciliada ? 'CONCILIADA & CANCELADA' : 'LISTA PARA CONCILIAR'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 pt-0.5">
                    {isAlreadyConciliada
                      ? 'Esta cuenta ya fue cruzada exitosamente con la Relación de Pagos y registrada en el Historial.'
                      : 'Verifica los valores contra la liquidación y presiona el botón para conciliar inmediatamente.'}
                  </p>
                </div>

                {/* Amount Verification */}
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Cruce de Cifras Determinístico:
                  </span>
                  <div className="flex items-center justify-between font-mono">
                    <span className="text-slate-400">Total Cuenta:</span>
                    <strong className="text-emerald-400 font-bold text-sm">
                      {formatPesos(valorNeto)}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-slate-400">Retención 1%:</span>
                    <span className="text-rose-400">-{formatPesos(retef)}</span>
                  </div>
                  <div className="flex items-center justify-between font-mono text-[11px] pt-1 border-t border-slate-800">
                    <span className="text-slate-400">Diferencia:</span>
                    <span className="text-emerald-300 font-bold">$ 0 (Exacto)</span>
                  </div>
                </div>

                {/* Optional Voucher Reference Input */}
                <div className="space-y-1 pt-1">
                  <label className="text-[11px] font-bold text-slate-300 block">
                    Número de Comprobante / Referencia Bancaria (Opcional):
                  </label>
                  <input
                    type="text"
                    value={numeroComprobante}
                    onChange={(e) => setNumeroComprobante(e.target.value)}
                    placeholder="Ej: TRANSF-89342 / LOTE-03"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 space-y-2">
                {!isAlreadyConciliada ? (
                  <button
                    type="button"
                    onClick={handleAprobarConciliacion}
                    disabled={isProcessing}
                    className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black py-3 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 shadow-xl shadow-emerald-950/50 cursor-pointer transition-all active:scale-98 disabled:opacity-60"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    <span>
                      {isProcessing ? 'Conciliando Cuenta...' : 'Aprobar y Conciliar Esta Cuenta'}
                    </span>
                  </button>
                ) : (
                  <div className="p-3 bg-emerald-950/60 border border-emerald-600/60 text-emerald-300 rounded-xl text-center text-xs font-bold flex items-center justify-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Cuenta Conciliada y Cancelada</span>
                  </div>
                )}

                {cuentas.length > 1 && currentIndex < cuentas.length - 1 && (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2 px-4 rounded-xl text-xs flex items-center justify-center space-x-1.5 cursor-pointer transition-colors"
                  >
                    <span>Pasar a Siguiente Cuenta ({currentIndex + 2} de {cuentas.length})</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Verification Rules Summary */}
            <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-4 text-[11px] text-slate-400 space-y-1.5">
              <span className="font-bold text-slate-300 uppercase tracking-wider block text-[10px]">
                Reglas de Conciliación Determinística CAMARCA:
              </span>
              <ul className="list-disc list-inside space-y-1 text-slate-400">
                <li>Conciliación 100% determinística basada en datos de cuenta y OCR.</li>
                <li>Actualiza automáticamente el estado a <strong>CANCELADO / PAGADO</strong> en la Relación de Pagos.</li>
                <li>Registra trazabilidad con fecha y hora en el Historial de Cobros de PostgreSQL.</li>
                <li>Garantiza persistencia permanente en base de datos.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shrink-0">
          <div className="text-slate-400 text-[11px]">
            Cuenta de cobro de <strong className="text-slate-200">{currentCuenta.encargado}</strong> ({currentCuenta.municipio || currentCuenta.expendio})
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-4 py-2 rounded-xl text-xs transition-colors cursor-pointer"
            >
              Cerrar Vista Previa
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
