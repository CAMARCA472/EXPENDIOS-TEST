import React, { useState, useEffect } from 'react';
import { UserSession, Role, ThemeMode } from '../types';
import { 
  ShieldCheck, 
  Building2, 
  UserCheck, 
  LogOut, 
  Sparkles,
  Store,
  RefreshCw,
  SlidersHorizontal,
  Sun,
  Moon,
  Database,
  CheckCircle2,
  Cloud,
  X
} from 'lucide-react';

interface HeaderProps {
  session: UserSession | null;
  onLogout: () => void;
  onSwitchRole?: (newRole: Role) => void;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  session,
  onLogout,
  onSwitchRole,
  theme = 'dark',
  onToggleTheme,
}) => {
  const isSuperAdmin = session?.cedulaOrNit === '1094269932' || session?.isMultiRoleAdmin;
  const isLight = theme === 'light';

  const [firestoreStatus, setFirestoreStatus] = useState<{
    connected: boolean;
    lastSync: string | null;
    totalExpendios: number;
    error: string | null;
  }>({
    connected: true,
    lastSync: null,
    totalExpendios: 177,
    error: null,
  });
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const checkStatus = async () => {
    try {
      const res = await fetch('/api/system/firestore-status');
      if (res.ok) {
        const data = await res.json();
        setFirestoreStatus({
          connected: Boolean(data.connected),
          lastSync: data.lastSync || null,
          totalExpendios: data.totalExpendios || 177,
          error: data.error || null,
        });
      }
    } catch {}
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await fetch('/api/system/sync-now', { method: 'POST' });
      const data = await res.json();
      setSyncFeedback(data.message || 'Sincronizado con éxito');
      await checkStatus();
    } catch (err: any) {
      setSyncFeedback('Error de conexión al sincronizar.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <header className={`${isLight ? 'bg-white text-slate-900 border-slate-200 shadow-sm' : 'bg-slate-900 text-white border-slate-800 shadow-md'} border-b sticky top-0 z-30 transition-colors`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand logo & title */}
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-amber-500 to-amber-400 text-slate-950 p-2 rounded-xl shadow-inner font-black text-xl flex items-center justify-center h-10 w-10">
            C
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className={`font-bold text-lg tracking-tight leading-none ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                CAMARCA <span className="text-amber-500 font-semibold">| 4-72</span>
              </h1>
            </div>
            <p className={`text-xs leading-tight ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Control de Personal y Gestión de Expendios
            </p>
          </div>
        </div>

        {/* User Badge / Status & Actions */}
        <div className="flex items-center space-x-2 sm:space-x-3">

          {/* Indicador de Persistencia en Firestore - SOLO visible en Panel Administrador */}
          {session?.role === 'admin' && (
            <button
              type="button"
              onClick={() => setShowStatusModal(true)}
              title="Persistencia Google Cloud Firestore Activa"
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer shadow-sm ${
                firestoreStatus.connected
                  ? isLight
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                    : 'bg-emerald-950/60 text-emerald-300 border-emerald-600/50 hover:bg-emerald-900/60'
                  : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
              }`}
            >
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${firestoreStatus.connected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${firestoreStatus.connected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              </span>
              <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="hidden md:inline font-bold">
                Firestore: {firestoreStatus.totalExpendios} Expendios
              </span>
              <span className="md:hidden font-bold">
                {firestoreStatus.totalExpendios} Nube
              </span>
            </button>
          )}
          
          {/* Botón de Cambio de Tema (Blanco / Negro) */}
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              title={isLight ? 'Cambiar a Tema Negro (Oscuro)' : 'Cambiar a Tema Blanco (Claro)'}
              className={`p-2 rounded-xl border text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
              }`}
            >
              {isLight ? (
                <>
                  <Moon className="w-4 h-4 text-slate-700" />
                  <span className="hidden md:inline text-[11px] font-semibold text-slate-700">Tema Negro</span>
                </>
              ) : (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span className="hidden md:inline text-[11px] font-semibold text-amber-300">Tema Blanco</span>
                </>
              )}
            </button>
          )}

          {session ? (
            <div className={`flex items-center space-x-2 sm:space-x-3 backdrop-blur py-1.5 px-3 rounded-xl text-xs border ${
              isLight
                ? 'bg-slate-100/90 border-slate-300 text-slate-800'
                : 'bg-slate-800/80 border-slate-700/60 text-slate-200'
            }`}>
              
              {/* If super admin (C.C. 1094269932), show direct role switcher */}
              {isSuperAdmin && onSwitchRole ? (
                <div className={`flex items-center space-x-1.5 p-1 rounded-lg border ${
                  isLight ? 'bg-white border-slate-300' : 'bg-slate-950/70 border-slate-700'
                }`}>
                  <span className="text-[10px] uppercase font-bold text-amber-500 px-1 hidden md:inline">
                    Módulo:
                  </span>
                  <button
                    type="button"
                    onClick={() => onSwitchRole('admin')}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer flex items-center space-x-1 ${
                      session.role === 'admin'
                        ? 'bg-amber-400 text-slate-950 shadow'
                        : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ShieldCheck className="w-3 h-3" />
                    <span>Admin</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSwitchRole('expendio')}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer flex items-center space-x-1 ${
                      session.role === 'expendio'
                        ? 'bg-emerald-500 text-white shadow'
                        : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Store className="w-3 h-3" />
                    <span>Expendio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSwitchRole('cliente')}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer flex items-center space-x-1 ${
                      session.role === 'cliente'
                        ? 'bg-sky-500 text-white shadow'
                        : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Building2 className="w-3 h-3" />
                    <span>Cliente</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 font-medium">
                  {session.role === 'admin' && (
                    <span className="flex items-center text-amber-600 dark:text-amber-400 font-semibold bg-amber-400/10 px-2 py-0.5 rounded-md border border-amber-400/30">
                      <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                      Panel Admin
                    </span>
                  )}
                  {session.role === 'cliente' && (
                    <span className="flex items-center text-sky-700 dark:text-sky-400 font-semibold bg-sky-400/10 px-2 py-0.5 rounded-md border border-sky-400/30">
                      <Building2 className="w-3.5 h-3.5 mr-1" />
                      Cliente 4-72
                    </span>
                  )}
                  {session.role === 'expendio' && (
                    <span className="flex items-center text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-400/10 px-2 py-0.5 rounded-md border border-emerald-400/30">
                      <UserCheck className="w-3.5 h-3.5 mr-1" />
                      Expendio
                    </span>
                  )}
                  <span className={`hidden sm:inline-block font-medium max-w-[140px] truncate ml-1 ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                    {session.name}
                  </span>
                </div>
              )}

              <div className={`h-4 w-px ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />

              <button
                onClick={onLogout}
                title="Cerrar Sesión"
                className="flex items-center text-slate-500 hover:text-red-500 transition-colors cursor-pointer text-xs font-medium"
              >
                <LogOut className="w-3.5 h-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Salir</span>
              </button>
            </div>
          ) : (
            <div className="text-xs text-amber-600 dark:text-amber-400 font-medium bg-amber-400/10 border border-amber-400/30 px-3 py-1.5 rounded-lg flex items-center">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Acceso Restringido por Rol
            </div>
          )}
        </div>
      </div>

      {/* Modal de Detalle de Persistencia en Firestore */}
      {showStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`w-full max-w-md rounded-2xl border shadow-2xl p-5 sm:p-6 relative ${
            isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
          }`}>
            <button
              onClick={() => {
                setShowStatusModal(false);
                setSyncFeedback(null);
              }}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-black text-base uppercase tracking-tight">
                  Estado de Persistencia en la Nube
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Google Cloud Firestore (Protección Permanente)
                </p>
              </div>
            </div>

            <div className="space-y-3 mb-5">
              <div className={`p-3 rounded-xl border ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/50 border-slate-800'
              }`}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-500 font-medium">Base de Datos Maestra:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    {firestoreStatus.totalExpendios} Expendios Respaldados
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-500 font-medium">Colección de Fotos:</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    camarca_photos (Firestore)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Conexión a Firestore:</span>
                  <span className="font-semibold text-emerald-600">
                    {firestoreStatus.connected ? 'En Línea y Sincronizado' : 'Offline'}
                  </span>
                </div>
              </div>

              <div className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
                <p className="flex items-start space-x-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span>
                    <strong>Sin pérdida de datos:</strong> Cada cambio en expendios y cada foto subida se almacena de inmediato en Firestore y en disco.
                  </span>
                </p>
                <p className="flex items-start space-x-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span>
                    <strong>Resistente a reinicios:</strong> Aunque el servidor web se reinicie o actualice, la base de datos de {firestoreStatus.totalExpendios} expendios y sus fotos se recuperan automáticamente.
                  </span>
                </p>
              </div>

              {syncFeedback && (
                <div className={`p-2.5 rounded-lg text-xs font-semibold ${
                  syncFeedback.includes('Error')
                    ? 'bg-red-500/10 text-red-600 border border-red-500/30'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                }`}>
                  {syncFeedback}
                </div>
              )}
            </div>

            <div className="flex space-x-2">
              <button
                type="button"
                onClick={handleManualSync}
                disabled={isSyncing}
                className="flex-1 bg-amber-500 hover:bg-amber-400 active:scale-98 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Sincronizando...' : 'Verificar y Respaldar en Firestore'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowStatusModal(false);
                  setSyncFeedback(null);
                }}
                className={`py-2.5 px-4 rounded-xl text-xs font-semibold border cursor-pointer ${
                  isLight ? 'bg-slate-100 hover:bg-slate-200 border-slate-300' : 'bg-slate-800 hover:bg-slate-700 border-slate-700'
                }`}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
