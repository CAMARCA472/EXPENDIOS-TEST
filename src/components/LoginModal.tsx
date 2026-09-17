import React, { useState } from 'react';
import { UserSession, Role } from '../types';
import { 
  KeyRound, 
  AlertCircle, 
  ArrowRight, 
  MessageCircle, 
  ShieldCheck, 
  Store, 
  Building2, 
  CheckCircle2, 
  ChevronRight,
  HelpCircle,
  Sparkles
} from 'lucide-react';

interface LoginModalProps {
  onLoginSuccess: (session: UserSession) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess }) => {
  const [inputVal, setInputVal] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showWhatsAppHelp, setShowWhatsAppHelp] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Role selector step for Super-Admin ID 1094269932
  const [pendingAdminUser, setPendingAdminUser] = useState<UserSession | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = inputVal.trim();
    if (!cleanId) {
      setErrorMsg('Por favor ingresa tu número de Cédula o NIT de acceso.');
      setShowWhatsAppHelp(false);
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setShowWhatsAppHelp(false);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passwordOrCedula: cleanId,
        }),
      });

      const data = await res.json();

      if (data.success && data.user) {
        // If it's the Admin ID 1094269932, prompt to choose module
        if (cleanId === '1094269932' || data.isMultiRoleAdmin || data.canSelectRole) {
          setPendingAdminUser(data.user);
        } else {
          onLoginSuccess(data.user);
        }
      } else {
        setErrorMsg(
          data.message || 'No se encontró ningún registro para el número ingresado. Verifica tus datos o contáctate con el administrador.'
        );
        setShowWhatsAppHelp(true);
      }
    } catch (err) {
      console.error('Error durante el inicio de sesión:', err);
      setErrorMsg('Error de conexión con el servidor. Verifica tus datos o contáctate con el administrador.');
      setShowWhatsAppHelp(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRole = (chosenRole: Role) => {
    if (!pendingAdminUser) return;
    const finalSession: UserSession = {
      ...pendingAdminUser,
      role: chosenRole,
    };
    onLoginSuccess(finalSession);
  };

  const whatsappMessage = encodeURIComponent(
    `Hola, necesito verificación o soporte para ingresar al sistema CAMARCA 4-72. Mi número de identificación es: ${inputVal.trim() || 'No especificado'}`
  );
  const whatsappUrl = `https://wa.me/573182822512?text=${whatsappMessage}`;

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-8 bg-slate-950/40">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 sm:p-8">
        
        {/* VIEW 1: Role Selection for Super-Admin 1094269932 */}
        {pendingAdminUser ? (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-400/10 border border-amber-400/20 text-amber-400 mb-3">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold text-slate-100 tracking-tight">
                Bienvenido Administrador
              </h2>
              <p className="text-xs text-amber-400/90 font-medium mt-0.5">
                Cédula: 1094269932 • Acceso Multi-Rol Habilitado
              </p>
              <p className="text-xs text-slate-400 mt-2">
                Selecciona en qué módulo deseas ingresar hoy:
              </p>
            </div>

            <div className="space-y-3 pt-2">
              {/* Option 1: Administrador */}
              <button
                type="button"
                onClick={() => handleSelectRole('admin')}
                className="w-full text-left bg-slate-950/80 hover:bg-slate-800/90 border border-amber-500/30 hover:border-amber-400 p-4 rounded-xl transition-all group flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center space-x-3.5">
                  <div className="w-10 h-10 rounded-lg bg-amber-400/10 border border-amber-400/20 text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100 group-hover:text-amber-300 transition-colors">
                      Módulo Administrador
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Gestión total de expendios, pagos, historial, trazabilidad y control.
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-amber-400 transition-colors shrink-0 ml-2" />
              </button>

              {/* Option 2: Expendio */}
              <button
                type="button"
                onClick={() => handleSelectRole('expendio')}
                className="w-full text-left bg-slate-950/80 hover:bg-slate-800/90 border border-emerald-500/30 hover:border-emerald-400 p-4 rounded-xl transition-all group flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center space-x-3.5">
                  <div className="w-10 h-10 rounded-lg bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <Store className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100 group-hover:text-emerald-300 transition-colors">
                      Módulo Expendio
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Cargue de cuentas de cobro escaneadas y actualización de datos de tu punto.
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors shrink-0 ml-2" />
              </button>

              {/* Option 3: Cliente 4-72 */}
              <button
                type="button"
                onClick={() => handleSelectRole('cliente')}
                className="w-full text-left bg-slate-950/80 hover:bg-slate-800/90 border border-sky-500/30 hover:border-sky-400 p-4 rounded-xl transition-all group flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center space-x-3.5">
                  <div className="w-10 h-10 rounded-lg bg-sky-400/10 border border-sky-400/20 text-sky-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100 group-hover:text-sky-300 transition-colors">
                      Módulo Cliente 4-72
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Visualización de relación de pagos, cuentas validadas y reportes consolidados.
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-sky-400 transition-colors shrink-0 ml-2" />
              </button>
            </div>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setPendingAdminUser(null)}
                className="text-xs text-slate-500 hover:text-slate-300 underline cursor-pointer"
              >
                Volver a ingresar otra identificación
              </button>
            </div>
          </div>
        ) : (
          /* VIEW 2: Standard Identification Entry Form */
          <>
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-400/10 border border-amber-400/20 text-amber-400 mb-3">
                <KeyRound className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Acceso al Sistema</h2>
              <p className="text-xs text-slate-400 mt-1">
                Ingresa tu número de identificación o Cédula para acceder a tu módulo correspondiente
              </p>
            </div>

            {/* Error message box with verification guidance */}
            {errorMsg && (
              <div className="mb-4 p-3.5 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs space-y-2">
                <div className="flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="font-medium leading-relaxed">{errorMsg}</span>
                </div>
              </div>
            )}

            {/* WhatsApp direct assistance box when ID is invalid or not registered */}
            {showWhatsAppHelp && (
              <div className="mb-5 p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/80 space-y-2.5">
                <div className="flex items-center space-x-2 text-emerald-300 text-xs font-semibold">
                  <HelpCircle className="w-4 h-4 text-emerald-400" />
                  <span>¿Necesitas soporte o no estás registrado?</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Verifica que no tengas espacios ni puntos en tu número de cédula. Si eres un nuevo expendio o contratista, comunícate directamente con el administrador para habilitar tu acceso.
                </p>
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-3.5 rounded-xl text-xs flex items-center justify-center space-x-2 shadow-lg transition-colors cursor-pointer"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>Enviar mensaje a WhatsApp (3182822512)</span>
                </a>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Número de Identificación / Cédula / NIT
                </label>
                <input
                  type="text"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  placeholder="Ej: Ingrese su número de Cédula o NIT"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent font-mono shadow-inner"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-3.5 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center space-x-2 cursor-pointer active:scale-[0.99] disabled:opacity-75"
              >
                {loading ? (
                  <span className="font-bold flex items-center justify-center space-x-2">
                    <span>Verificando acceso...</span>
                  </span>
                ) : (
                  <>
                    <span>Ingresar al Sistema</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
              <span>CAMARCA S.A.S. • 4-72</span>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:underline flex items-center space-x-1"
              >
                <MessageCircle className="w-3 h-3" />
                <span>WhatsApp Soporte</span>
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
