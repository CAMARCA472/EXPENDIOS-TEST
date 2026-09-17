import React, { useState, useEffect } from 'react';
import { UserSession, ExpendioData, ThemeMode } from './types';
import { Header } from './components/Header';
import { LoginModal } from './components/LoginModal';
import { AdminPanel } from './components/AdminPanel';
import { ClientePanel } from './components/ClientePanel';
import { ExpendioPanel } from './components/ExpendioPanel';

export default function App() {
  const [session, setSession] = useState<UserSession | null>(() => {
    try {
      const saved = localStorage.getItem('camarca_session');
      return saved ? JSON.parse(saved) : null;
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

  // Track general application visits for administrator access metrics
  useEffect(() => {
    fetch('/api/metrics/track-visit', { method: 'POST' }).catch(() => {});
  }, []);

  // Silently refresh expendio session data on mount so it's not stale from localStorage
  useEffect(() => {
    if (session?.role === 'expendio' && session?.cedulaOrNit) {
      fetch('/api/expendios?_t=' + Date.now(), { cache: 'no-store' })
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.data)) {
            const freshExp = data.data.find((e: any) => e.cedula === session.cedulaOrNit || e.id === session.cedulaOrNit);
            if (freshExp) {
              const updated = { ...session, expendioData: freshExp };
              setSession(updated);
              localStorage.setItem('camarca_session', JSON.stringify(updated));
            }
          }
        })
        .catch(() => {});
    }
  }, [session?.cedulaOrNit, session?.role]);


  const handleToggleTheme = () => {
    const nextTheme: ThemeMode = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    try {
      localStorage.setItem('camarca_theme', nextTheme);
    } catch (e) {
      console.error('Error saving theme preference:', e);
    }
  };

  const handleLoginSuccess = (newSession: UserSession) => {
    setSession(newSession);
    try {
      localStorage.setItem('camarca_session', JSON.stringify(newSession));
      // If no explicit theme saved, default expendio / cliente to light
      const savedTheme = localStorage.getItem('camarca_theme');
      if (!savedTheme && (newSession.role === 'expendio' || newSession.role === 'cliente')) {
        setTheme('light');
      }
    } catch (e) {
      console.error('Error saving session:', e);
    }
  };

  const handleLogout = () => {
    setSession(null);
    try {
      // Preserve Google Drive integration credentials and theme across user logouts
      const gdriveToken = localStorage.getItem('camarca_gdrive_access_token');
      const gdriveTs = localStorage.getItem('camarca_gdrive_token_ts');
      const gdriveEmail = localStorage.getItem('camarca_gdrive_email');
      const gdriveName = localStorage.getItem('camarca_gdrive_name');
      const savedTheme = localStorage.getItem('camarca_theme');

      // Purge session-specific storage
      localStorage.removeItem('camarca_session');
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

  const handleUpdateSessionData = (updatedExpendio: ExpendioData) => {
    if (!session) return;
    const updatedSession: UserSession = {
      ...session,
      name: updatedExpendio.encargado,
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

    // Fetch fresh expendio data when switching to expendio role to avoid stale cache issues
    if (newRole === 'expendio') {
      try {
        const res = await fetch('/api/expendios?_t=' + Date.now(), { cache: 'no-store' });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          const selfExpendio = data.data.find((e: any) => e.cedula === session.cedulaOrNit || e.id === session.cedulaOrNit);
          if (selfExpendio) {
            updatedExpendioData = selfExpendio;
          } else if (session.cedulaOrNit === '1094269932') {
             // Mock Super-Admin if not in DB to prevent Arauca fallback
             updatedExpendioData = {
               id: '1094269932',
               cedula: '1094269932',
               encargado: 'ADMINISTRADOR GENERAL CAMARCA SAS',
               municipio: 'BUCARAMANGA',
               centroOperativo: 'PO. BUCARAMANGA',
             } as any;
          } else {
             updatedExpendioData = null as any;
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

    try {
      localStorage.setItem('camarca_session', JSON.stringify(updatedSession));
    } catch (e) {
      console.error('Error switching role:', e);
    }
  };

  const isLight = theme === 'light';

  return (
    <div className={`min-h-screen flex flex-col font-sans antialiased selection:bg-amber-400 selection:text-slate-950 transition-colors duration-200 ${theme} ${
      isLight ? 'bg-slate-100 text-slate-900' : 'bg-slate-950 text-slate-100'
    }`}>
      <Header
        session={session}
        onLogout={handleLogout}
        onSwitchRole={handleSwitchRole}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      <main className="flex-1 pb-12">
        {!session ? (
          <LoginModal onLoginSuccess={handleLoginSuccess} />
        ) : (
          <>
            {session.role === 'admin' && <AdminPanel />}
            {session.role === 'cliente' && <ClientePanel theme={theme} onToggleTheme={handleToggleTheme} />}
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
