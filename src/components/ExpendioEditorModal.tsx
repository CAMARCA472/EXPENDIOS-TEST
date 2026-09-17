import React, { useState } from 'react';
import { ExpendioData } from '../types';
import { Store, Save, X, Building2, User, Phone, MapPin, Mail, CreditCard, ShieldCheck, FileText, Globe } from 'lucide-react';
import { getAccessToken } from '../lib/googleAuth';
import { updateSingleExpendioInGoogleSheets } from '../lib/googleSheetsService';

interface ExpendioEditorModalProps {
  expendio?: ExpendioData | null;
  onClose: () => void;
  onSaveSuccess: (updatedOrNew: ExpendioData, isNew: boolean) => void;
}

export const ExpendioEditorModal: React.FC<ExpendioEditorModalProps> = ({
  expendio,
  onClose,
  onSaveSuccess,
}) => {
  const isEditing = !!expendio;

  const [formData, setFormData] = useState<Partial<ExpendioData>>({
    centroOperativo: expendio?.centroOperativo || 'PO.BUCARAMANGA',
    centroAcopio: expendio?.centroAcopio || 'SIMITI',
    localidad: expendio?.localidad || '',
    municipio: expendio?.municipio || '',
    encargado: expendio?.encargado || '',
    cedula: expendio?.cedula || '',
    direccionPunto: expendio?.direccionPunto || '',
    telefonoPunto: expendio?.telefonoPunto || '',
    cuentaBancaria: expendio?.cuentaBancaria || '',
    banco: expendio?.banco || 'NEQUI',
    usuarioSipost: expendio?.usuarioSipost || '',
    internet: expendio?.internet || 'SI',
    nit: expendio?.nit || '900062917',
    correoElectronico: expendio?.correoElectronico || '',
    observacion: expendio?.observacion || '',
    valorMensual: expendio?.valorMensual || 0,
    letreroUrl: expendio?.letreroUrl || '',
    basculaUrl: expendio?.basculaUrl || '',
    mataselloUrl: expendio?.mataselloUrl || '',
    computadorUrl: expendio?.computadorUrl || '',
  });

  const [saving, setSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const handleChange = (field: keyof ExpendioData, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
      // Keep municipio in sync if localidad changes
      ...(field === 'localidad' && !prev.municipio ? { municipio: value } : {}),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.localidad || !formData.encargado || !formData.cedula) {
      setErrorMsg('Los campos Localidad, Encargado y Cédula son obligatorios.');
      return;
    }

    setSaving(true);
    setErrorMsg('');

    try {
      const url = isEditing ? `/api/admin/expendios/${expendio.id}` : '/api/admin/expendios';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (data.success) {
        onSaveSuccess(data.data, !isEditing);

        // Sincronizar actualización directamente a Google Sheets
        getAccessToken().then((token) => {
          if (token && data.data) {
            updateSingleExpendioInGoogleSheets(token, data.data).catch(() => {});
          }
        }).catch(() => {});

        onClose();
      } else {
        setErrorMsg(data.message || 'Error al guardar los datos.');
      }
    } catch (err) {
      console.error('Error guardando expendio:', err);
      setErrorMsg('Error de conexión con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative space-y-5 my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">
                {isEditing ? `Editar Expendio: ${expendio.localidad}` : 'Registrar Nuevo Expendio'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Sincronización directa en tiempo real con la base de datos del sistema
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-950/50 border border-red-800 text-red-300 text-xs rounded-xl">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Section 1: Ubicación y Operación */}
          <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
            <div className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center space-x-1.5">
              <Building2 className="w-3.5 h-3.5" />
              <span>1. Datos de Ubicación y Operación</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Centro Operativo
                </label>
                <input
                  type="text"
                  value={formData.centroOperativo || ''}
                  onChange={(e) => handleChange('centroOperativo', e.target.value)}
                  placeholder="Ej: PO.BUCARAMANGA"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Centro de Acopio
                </label>
                <input
                  type="text"
                  value={formData.centroAcopio || ''}
                  onChange={(e) => handleChange('centroAcopio', e.target.value)}
                  placeholder="Ej: SIMITI"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-amber-300 mb-1">
                  Municipio Principal (Clave Primaria del Sistema) <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.municipio || formData.localidad || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      municipio: v,
                      localidad: prev.localidad ? prev.localidad : v,
                    }));
                  }}
                  placeholder="Ej: SIMITI"
                  className="w-full bg-slate-900 border border-amber-500/50 rounded-lg px-3 py-2 text-xs text-amber-200 font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Localidad / Sector
                </label>
                <input
                  type="text"
                  value={formData.localidad || formData.municipio || ''}
                  onChange={(e) => handleChange('localidad', e.target.value)}
                  placeholder="Ej: SIMITI CENTRO"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Encargado y Contacto */}
          <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
            <div className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center space-x-1.5">
              <User className="w-3.5 h-3.5" />
              <span>2. Datos del Encargado y Contacto</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Nombre Completo Encargado <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.encargado || ''}
                  onChange={(e) => handleChange('encargado', e.target.value)}
                  placeholder="Ej: MARIO DE JESUS TORRES MEJIA"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Número de Cédula <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.cedula || ''}
                  onChange={(e) => handleChange('cedula', e.target.value)}
                  placeholder="Ej: 3983162"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Dirección del Punto
                </label>
                <input
                  type="text"
                  value={formData.direccionPunto || ''}
                  onChange={(e) => handleChange('direccionPunto', e.target.value)}
                  placeholder="Ej: CALLE PRINCIPAL SIMITI"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Teléfono Móvil
                </label>
                <input
                  type="text"
                  value={formData.telefonoPunto || ''}
                  onChange={(e) => handleChange('telefonoPunto', e.target.value)}
                  placeholder="Ej: 3101234567"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-emerald-300 mb-1">
                  Cuenta Bancaria (Número)
                </label>
                <input
                  type="text"
                  value={formData.cuentaBancaria || ''}
                  onChange={(e) => handleChange('cuentaBancaria', e.target.value.toUpperCase())}
                  placeholder="Ej: 3101234567 o 1234567890"
                  className="w-full bg-slate-900 border border-emerald-500/40 rounded-lg px-3 py-2 text-xs text-emerald-300 font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Banco / Entidad Financiera
                </label>
                <select
                  value={
                    ['NEQUI', 'AHORROS BANCOLOMBIA', 'CUENTA CORRIENTE BANCOLOMBIA', 'DAVIPLATA'].includes(
                      (formData.banco || 'NEQUI').toUpperCase()
                    )
                      ? (formData.banco || 'NEQUI').toUpperCase()
                      : 'OTROS'
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val !== 'OTROS') {
                      handleChange('banco', val);
                    } else {
                      handleChange('banco', 'OTRO BANCO');
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 uppercase cursor-pointer"
                >
                  <option value="NEQUI">NEQUI (Predeterminada)</option>
                  <option value="AHORROS BANCOLOMBIA">AHORROS BANCOLOMBIA</option>
                  <option value="CUENTA CORRIENTE BANCOLOMBIA">CUENTA CORRIENTE BANCOLOMBIA</option>
                  <option value="DAVIPLATA">DAVIPLATA</option>
                  <option value="OTROS">OTROS (Escribir abajo)</option>
                </select>
                {!['NEQUI', 'AHORROS BANCOLOMBIA', 'CUENTA CORRIENTE BANCOLOMBIA', 'DAVIPLATA'].includes(
                  (formData.banco || '').toUpperCase()
                ) && (
                  <input
                    type="text"
                    value={formData.banco || ''}
                    onChange={(e) => handleChange('banco', e.target.value.toUpperCase())}
                    placeholder="Escriba el nombre del banco..."
                    className="w-full mt-1.5 bg-slate-900 border border-amber-500/50 rounded-lg px-3 py-1.5 text-xs text-amber-300 font-semibold uppercase"
                  />
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  value={formData.correoElectronico || ''}
                  onChange={(e) => handleChange('correoElectronico', e.target.value)}
                  placeholder="ejemplo@expendio.com"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  NIT Cliente
                </label>
                <input
                  type="text"
                  value={formData.nit || '900062917'}
                  onChange={(e) => handleChange('nit', e.target.value)}
                  placeholder="900062917"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Sistemas e Internet */}
          <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
            <div className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center space-x-1.5">
              <Globe className="w-3.5 h-3.5" />
              <span>3. Sistemas, SIPOST y Valor Mensual</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Usuario SIPOST
                </label>
                <input
                  type="text"
                  value={formData.usuarioSipost || ''}
                  onChange={(e) => handleChange('usuarioSipost', e.target.value)}
                  placeholder="Ej: simiti_sipost"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Servicio Internet
                </label>
                <select
                  value={formData.internet || 'SI'}
                  onChange={(e) => handleChange('internet', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 cursor-pointer"
                >
                  <option value="SI">SI</option>
                  <option value="NO">NO</option>
                  <option value="EN PROCESO">EN PROCESO</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Computador
                </label>
                <select
                  value={formData.tieneComputador === 'NO' ? 'NO' : 'SI'}
                  onChange={(e) => handleChange('tieneComputador', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 cursor-pointer"
                >
                  <option value="SI">SI</option>
                  <option value="NO">NO</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Valor Mensual Base ($ COP)
                </label>
                <input
                  type="number"
                  value={formData.valorMensual || 1350000}
                  onChange={(e) => handleChange('valorMensual', Number(e.target.value))}
                  placeholder="1350000"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Letrero / Aviso</label>
                <select
                  value={formData.tieneAviso === 'NO' ? 'NO' : 'SI'}
                  onChange={(e) => handleChange('tieneAviso', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 cursor-pointer"
                >
                  <option value="SI">SI</option>
                  <option value="NO">NO</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Báscula</label>
                <select
                  value={formData.tieneBascula === 'NO' ? 'NO' : 'SI'}
                  onChange={(e) => handleChange('tieneBascula', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 cursor-pointer"
                >
                  <option value="SI">SI</option>
                  <option value="NO">NO</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Matasello</label>
                <select
                  value={formData.tieneMatasello === 'NO' ? 'NO' : 'SI'}
                  onChange={(e) => handleChange('tieneMatasello', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 cursor-pointer"
                >
                  <option value="SI">SI</option>
                  <option value="NO">NO</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Observación / Novedades
              </label>
              <textarea
                value={formData.observacion || ''}
                onChange={(e) => handleChange('observacion', e.target.value)}
                placeholder="Notas u observaciones del punto de expendio..."
                rows={2}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2.5 px-4 rounded-xl text-xs transition-colors cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-5 rounded-xl text-xs flex items-center space-x-2 shadow-lg transition-all cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Guardando...' : 'Guardar y Sincronizar'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
