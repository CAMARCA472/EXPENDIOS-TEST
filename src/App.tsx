import React, { useState, useEffect } from 'react';
import { UserSession, ExpendioData, ThemeMode } from './types';
import { Header } from './components/Header';
import { LoginModal } from './components/LoginModal';
import { AdminPanel } from './components/AdminPanel';
import { ClientePanel } from './components/ClientePanel';
import { ExpendioPanel } from './components/ExpendioPanel';
import { AlertTriangle, X } from 'lucide-react';

import { clearAllPhotoMetadata } from './lib/photoCacheHandler';
import { clearSyncedPhotosFromIndexedDB } from './lib/photoStorageDB';

// PURGAR CACHÉ Y LOCALSTORAGE RELACIONADO CON FOTOS DE LA APP SELECTIVAMENTE
export async function clearAppCache(): Promise<boolean> {
  console.log('[Cache-Purge] Iniciando purga selectiva de cachés de la aplicación...');
  let success = true;

  // 1. Purga selectiva de la API de caché del navegador
  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        // Purgamos selectivamente los recursos antiguos o relacionados con fotos/vistas de expendio
        if (name.includes('photos') || name.includes('expendio') || name.includes('static') || name.includes('assets') || name.includes('workbox')) {
          console.log(`[Cache-Purge] Eliminando caché de navegador: ${name}`);
          await caches.delete(name);
        }
      }
    }
  } catch (err) {
    console.warn('[Cache-Purge] Error purgando cachés del navegador:', err);
    success = false;
  }

  // 2. Limpieza de localStorage relacionado con las fotos y metadatos
  try {
    clearAllPhotoMetadata();
    if (typeof localStorage !== 'undefined') {
      const keysToClear = [
        'camarca_total_purged_count',
        'camarca_photos_cache',
        'camarca_local_photos',
        'camarca_last_photo_sync_time',
        'camarca_sync_photo_timestamp',
      ];
      // También buscar cualquier clave que tenga el patrón "photo", "foto", o "camarca_photo_meta_"
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('photo') || key.includes('foto') || key.includes('sync_time') || key.startsWith('camarca_photo_meta_'))) {
          keysToClear.push(key);
        }
      }
      keysToClear.forEach((key) => {
        console.log(`[Cache-Purge] Removiendo localStorage: ${key}`);
        localStorage.removeItem(key);
      });
    }
  } catch (err) {
    console.warn('[Cache-Purge] Error limpiando localStorage:', err);
    success = false;
  }

  // 3. Limpieza de fotos sincronizadas en IndexedDB
  try {
    await clearSyncedPhotosFromIndexedDB();
    console.log('[Cache-Purge] Fotos sincronizadas purgadas de IndexedDB.');
  } catch (idbErr) {
    console.warn('[Cache-Purge] Nota sobre IndexedDB:', idbErr);
  }

  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('camarca_cache_cleared', { detail: { timestamp: Date.now() } }));
    }
  } catch {}

  console.log('[Cache-Purge] Purga de caché y localStorage completada.');
  return success;
}

if (typeof window !== 'undefined') {
  (window as any).clearAppCache = clearAppCache;
}

const INACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 horas (1 día) de inactividad máxima

export default function App() {
  const [inactivityExpiredMsg, setInactivityExpiredMsg] = useState<string>('');

  const [session, setSession] = useState<UserSession | null>(() => {
    try {
      const saved = localStorage.getItem('camarca_session');
      if (!saved) return null;
      const lastActivity = Number(localStorage.getItem('camarca_last_activity') || 0);
      const now = Date.now();
      if (lastActivity > 0 && now - lastActivity > INACTIVITY_TIMEOUT_MS) {
        localStorage.removeItem('camarca_session');
        localStorage.removeItem('camarca_token');
        localStorage.removeItem('camarca_last_activity');
        sessionStorage.clear();
        return null;
      }
      if (!lastActivity) {
        localStorage.setItem('camarca_last_activity', String(now));
      }
      return JSON.parse(saved);
    } catch {
      return null;
    }
  });

  // Theme State (Default to 'light' (blanco) for expendio and cliente)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const savedTheme = localStorage.getItem('camarca_theme') as ThemeMode | null;
      if (savedTheme === 'light' || savedTheme === 'dark') {
        return savedTheme;
      }
      // If no saved preference: expendio and cliente default to 'light'
      if (session?.role === 'expendio' || session?.role === 'cliente') {
        return 'light';
      }
      return 'dark';
    } catch {
      return 'dark';
    }
  });

  // When user role changes or logs in, if no explicit saved theme exists, default to 'light' for expendio / cliente
  useEffect(() => {
    const savedTheme = localStorage.getItem('camarca_theme');
    if (!savedTheme && session) {
      if (session.role === 'expendio' || session.role === 'cliente') {
        setTheme('light');
      }
    }
  }, [session?.role]);

  // Synchronize 'dark' class on HTML root element to strictly control Tailwind dark mode
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      }
    }
  }, [theme]);

  // Track general application visits for administrator access metrics when authenticated
  useEffect(() => {
    if (session?.token || session?.cedulaOrNit) {
      fetch('/api/metrics/track-visit', { method: 'POST' }).catch(() => {});
    }
  }, [session?.cedulaOrNit]);

  // Real-time presence heartbeat ping (every 20s) for live active users online metric
  useEffect(() => {
    const sendHeartbeat = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const payload = {
        cedula: session?.cedulaOrNit || '',
        usuario: session?.name || session?.expendioData?.encargado || '',
        rol: session?.role || 'visita',
        municipio: session?.expendioData?.municipio || session?.expendioData?.localidad || '',
        path: typeof window !== 'undefined' ? window.location.pathname || '/' : '/',
      };
      fetch('/api/presence/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    };

    // Modo Costo $0 (Scale-to-Zero): solo registra presencia al iniciar sesión o recargar,
    // sin enviar peticiones en bucle cuando la pestaña queda abierta sin uso.
    sendHeartbeat();
  }, [session?.cedulaOrNit, session?.role, session?.name]);

  // Silently refresh expendio / admin session data on mount so it's not stale from localStorage
  useEffect(() => {
    const normCed = String(session?.cedulaOrNit || '').replace(/\D/g, '');
    if (session?.role === 'admin' && normCed === '1094269932') {
      if (
        session.name !== 'DIEGO ALEJANDRO BECERRA' ||
        (session.expendioData && session.expendioData.encargado !== 'DIEGO ALEJANDRO BECERRA')
      ) {
        const healedSession: UserSession = {
          ...session,
          name: 'DIEGO ALEJANDRO BECERRA',
          expendioData: session.expendioData
            ? {
                ...session.expendioData,
                encargado: 'DIEGO ALEJANDRO BECERRA',
                municipio: 'GIRON',
                localidad: 'GIRON',
              }
            : session.expendioData,
        };
        setSession(healedSession);
        try {
          localStorage.setItem('camarca_session', JSON.stringify(healedSession));
        } catch {}
      }
      return;
    }

    if (session?.role === 'expendio' && session?.cedulaOrNit) {
      const encNorm = String(session.expendioData?.encargado || session.name || '')
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      const RECOVER_HIJACKED_EXPENDIO_MAP: Record<string, string> = {
        'LILIA ESPERANZA RIOS': '52032761',
        'DINANCELA TOBAR GARCIA': '29111378',
        'MARIA YURLEY JAIMES BUITRAGO': '1094272656',
        'JESSICA JOHANA HENAO DAZA': '1094270223',
        'JOSE VICENTE LIZARAZO TORRES': '1100812665',
        'HEIDY JULIETH TELLEZ ARIZA': '1005294216',
      };

      if (normCed === '1094269932' && encNorm && RECOVER_HIJACKED_EXPENDIO_MAP[encNorm]) {
        const realCedula = RECOVER_HIJACKED_EXPENDIO_MAP[encNorm];
        fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cedula: realCedula }),
        })
          .then((r) => r.json())
          .then((loginData) => {
            if (loginData?.success && loginData?.user) {
              handleLoginSuccess(loginData.user);
            }
          })
          .catch(() => {});
        return;
      }

      fetch('/api/expendios?_t=' + Date.now(), { cache: 'no-store' })
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.data)) {
            const freshExp = data.data.find((e: any) => e.cedula === session.cedulaOrNit || e.id === session.cedulaOrNit);
            if (freshExp) {
              const updated = { ...session, name: freshExp.encargado || session.name, expendioData: freshExp };
              setSession(updated);
              localStorage.setItem('camarca_session', JSON.stringify(updated));
            }
          }
        })
        .catch(() => {});
    }
  }, [session?.cedulaOrNit, session?.role]);

  // Validar sesión contra el servidor al iniciar la app para prevenir estados vacíos silenciosos
  useEffect(() => {
    if (session) {
      // Asegurar que camarca_token exista si session tiene token
      if (session.token && !localStorage.getItem('camarca_token')) {
        localStorage.setItem('camarca_token', session.token);
        sessionStorage.setItem('camarca_token', session.token);
      }

      fetch('/api/auth/me?_t=' + Date.now(), { cache: 'no-store' })
        .then((res) => {
          if (res.status === 401 || res.status === 403) {
            handleLogout('Tu sesión ha expirado por seguridad. Por favor ingresa nuevamente tu número de cédula para acceder.');
          }
        })
        .catch(() => {});
    }

    const handleSessionExpired = (e: any) => {
      const reason = e.detail?.reason || 'Tu sesión ha expirado o requiere validación. Por favor ingresa nuevamente tu cédula.';
      handleLogout(reason);
    };

    window.addEventListener('camarca_session_expired', handleSessionExpired);
    return () => window.removeEventListener('camarca_session_expired', handleSessionExpired);
  }, []);

  const handleToggleTheme = () => {
    const nextTheme: ThemeMode = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    try {
      localStorage.setItem('camarca_theme', nextTheme);
    } catch (e) {
      console.error('Error saving theme preference:', e);
    }
  };

  const handleLoginSuccess = async (newSession: UserSession) => {
    setInactivityExpiredMsg('');
    if (newSession.role === 'expendio') {
      try {
        await clearAppCache();
      } catch (err) {
        console.warn('[Login Cache Purge] Advertencia limpiando caché al iniciar expendio:', err);
      }
    }
    setSession(newSession);
    try {
      const now = Date.now();
      localStorage.setItem('camarca_session', JSON.stringify(newSession));
      localStorage.setItem('camarca_last_activity', String(now));
      localStorage.setItem('camarca_session_login_at', String(now));
      if (newSession.token) {
        localStorage.setItem('camarca_token', newSession.token);
        sessionStorage.setItem('camarca_token', newSession.token);
      }
      // If no explicit theme saved, default expendio / cliente to light
      const savedTheme = localStorage.getItem('camarca_theme');
      if (!savedTheme && (newSession.role === 'expendio' || newSession.role === 'cliente')) {
        setTheme('light');
      }
    } catch (e) {
      console.error('Error saving session:', e);
    }
  };

  const handleLogout = (reasonMsg?: string) => {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setSession(null);
    if (reasonMsg) {
      setInactivityExpiredMsg(reasonMsg);
    }
    try {
      // Preserve Google Drive integration credentials and theme across user logouts
      const gdriveToken = localStorage.getItem('camarca_gdrive_access_token');
      const gdriveTs = localStorage.getItem('camarca_gdrive_token_ts');
      const gdriveEmail = localStorage.getItem('camarca_gdrive_email');
      const gdriveName = localStorage.getItem('camarca_gdrive_name');
      const savedTheme = localStorage.getItem('camarca_theme');

      // Purge session-specific storage
      localStorage.removeItem('camarca_session');
      localStorage.removeItem('camarca_token');
      localStorage.removeItem('camarca_last_activity');
      localStorage.removeItem('camarca_session_login_at');
      sessionStorage.clear();

      // Ensure persistent Google Drive integration token is kept
      if (gdriveToken) localStorage.setItem('camarca_gdrive_access_token', gdriveToken);
      if (gdriveTs) localStorage.setItem('camarca_gdrive_token_ts', gdriveTs);
      if (gdriveEmail) localStorage.setItem('camarca_gdrive_email', gdriveEmail);
      if (gdriveName) localStorage.setItem('camarca_gdrive_name', gdriveName);
      if (savedTheme) localStorage.setItem('camarca_theme', savedTheme);

      // Clear any service worker or browser application caches
      if (typeof window !== 'undefined' && 'caches' in window) {
        caches.keys().then((names) => {
          names.forEach((name) => caches.delete(name));
        }).catch(() => {});
      }
    } catch (e) {
      console.error('Error clearing cache and storage on logout:', e);
    }
  };

  // Control automático de cierre de sesión tras 1 día (24 horas) de inactividad
  useEffect(() => {
    if (!session) return;

    let lastRecorded = Date.now();

    const checkInactivity = () => {
      try {
        const storedLast = Number(localStorage.getItem('camarca_last_activity') || 0);
        if (storedLast > 0 && Date.now() - storedLast > INACTIVITY_TIMEOUT_MS) {
          handleLogout('Por seguridad, tu sesión se ha cerrado automáticamente tras 1 día (24 horas) de inactividad.');
          return true;
        }
      } catch {}
      return false;
    };

    if (checkInactivity()) return;

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastRecorded > 15000) {
        lastRecorded = now;
        try {
          const storedLast = Number(localStorage.getItem('camarca_last_activity') || 0);
          if (storedLast > 0 && now - storedLast > INACTIVITY_TIMEOUT_MS) {
            handleLogout('Por seguridad, tu sesión se ha cerrado automáticamente tras 1 día (24 horas) de inactividad.');
            return;
          }
          localStorage.setItem('camarca_last_activity', String(now));
        } catch {}
      }
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach((ev) => window.addEventListener(ev, recordActivity, { passive: true }));

    const handleVisibilityOrFocus = () => {
      if (!document.hidden) {
        checkInactivity();
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    const intervalId = window.setInterval(checkInactivity, 30000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, recordActivity));
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.clearInterval(intervalId);
    };
  }, [session]);

  const handleUpdateSessionData = (updatedExpendio: ExpendioData) => {
    if (!session) return;
    const isSuperAdmin = session.isMultiRoleAdmin || session.cedulaOrNit === '1094269932';
    const isCleanAdmin = session.isCleanAdmin || String(session.cedulaOrNit || '').replace(/\D/g, '') === '9005042417';

    const targetName = isSuperAdmin
      ? 'DIEGO ALEJANDRO BECERRA'
      : isCleanAdmin
      ? 'ADMINISTRADOR CAMARCA S.A.S.'
      : (updatedExpendio.encargado || session.name);

    const updatedSession: UserSession = {
      ...session,
      name: targetName,
      expendioData: updatedExpendio,
    };
    setSession(updatedSession);
    try {
      localStorage.setItem('camarca_session', JSON.stringify(updatedSession));
    } catch (e) {
      console.error('Error updating session data:', e);
    }
  };

  const handleSwitchRole = async (newRole: 'admin' | 'cliente' | 'expendio') => {
    if (!session) return;
    let updatedExpendioData = session.expendioData;

    // Purge cache and fetch fresh expendio data when switching to expendio role
    if (newRole === 'expendio') {
      try {
        await clearAppCache();
      } catch {}
      try {
        const res = await fetch('/api/expendios?_t=' + Date.now(), { cache: 'no-store' });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          const selfExpendio = data.data.find(
            (e: any) => e.cedula === session.cedulaOrNit || e.id === session.expendioData?.id || e.id === session.cedulaOrNit
          );
          if (selfExpendio) {
            updatedExpendioData = selfExpendio;
          }
        }
      } catch (err) {
        console.warn('Could not auto-fetch expendio data:', err);
      }
    }

    const updatedSession: UserSession = {
      ...session,
      role: newRole,
      expendioData: updatedExpendioData,
    };
    setSession(updatedSession);
    try {
      localStorage.setItem('camarca_session', JSON.stringify(updatedSession));
      localStorage.setItem('camarca_last_activity', String(Date.now()));
    } catch (e) {
      console.error('Error saving switched session:', e);
    }
    
    // Check if user has explicit saved theme, otherwise apply default
    const savedTheme = localStorage.getItem('camarca_theme');
    if (!savedTheme) {
      if (newRole === 'expendio' || newRole === 'cliente') {
        setTheme('light');
      } else if (newRole === 'admin') {
        setTheme('dark');
      }
    }
  };

  const isLight = theme === 'light';

  return (
    <div className={`min-h-screen flex flex-col font-sans antialiased selection:bg-amber-400 selection:text-slate-950 transition-colors duration-200 w-full max-w-full overflow-x-hidden ${theme} ${
      isLight ? 'bg-slate-100 text-slate-900' : 'bg-slate-950 text-slate-100'
    }`}>
      <Header
        session={session}
        onLogout={() => handleLogout()}
        onSwitchRole={handleSwitchRole}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {inactivityExpiredMsg && !session && (
        <div className="max-w-md mx-auto mt-4 px-4 w-full">
          <div className="bg-slate-900 border-2 border-amber-500 text-white px-4 py-3.5 rounded-xl text-xs font-bold flex items-center justify-between gap-3 shadow-2xl">
            <div className="flex items-center space-x-2.5">
              <div className="p-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 shrink-0">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              </div>
              <span className="text-slate-100 leading-relaxed">{inactivityExpiredMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setInactivityExpiredMsg('')}
              className="text-slate-400 hover:text-amber-300 bg-slate-800 hover:bg-slate-700 p-1.5 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 pb-12">
        {!session ? (
          <LoginModal
            onLoginSuccess={handleLoginSuccess}
            onClearNotice={() => setInactivityExpiredMsg('')}
          />
        ) : (
          <>
            {session.role === 'admin' && <AdminPanel session={session} />}
            {session.role === 'cliente' && <ClientePanel session={session} theme={theme} onToggleTheme={handleToggleTheme} />}
            {session.role === 'expendio' && (
              <ExpendioPanel
                session={session}
                onUpdateSessionData={handleUpdateSessionData}
                theme={theme}
                onToggleTheme={handleToggleTheme}
              />
            )}
          </>
        )}
      </main>

      <footer className={`border-t py-6 text-center text-xs transition-colors duration-200 ${
        isLight ? 'bg-white border-slate-200 text-slate-600' : 'bg-slate-900 border-slate-800/80 text-slate-500'
      }`}>
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className={isLight ? 'text-slate-700 font-medium' : 'text-slate-400'}>
            &copy; {new Date().getFullYear()} CAMARCA S.A.S. (NIT 900504241-7) & 4-72
          </div>
          <div className="flex items-center space-x-4 text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Base de Datos Local Sincronizada</span>
            <span className="text-slate-400">•</span>
            <span className={isLight ? 'text-slate-600' : 'text-slate-400'}>Sistema CAMARCA SAS v1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
