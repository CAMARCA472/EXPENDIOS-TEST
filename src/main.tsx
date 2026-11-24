import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initDriveSyncServiceWorker } from './lib/driveSyncServiceWorker';
import { initGlobalErrorHandlers } from './lib/clientErrorStorageDB';

// Inicializar de inmediato los interceptores globales de excepciones críticas a IndexedDB
try {
  initGlobalErrorHandlers();
} catch (err) {
  console.warn('[main] No se pudo inicializar logger de errores en IndexedDB:', err);
}

// ==========================================
// CLIENT FETCH INTERCEPTOR (AUTENTICACIÓN CENTRAL)
// Inyecta automáticamente el token de sesión criptográfico firmado en todas las peticiones a la API
// ==========================================
try {
  const originalFetch = window.fetch ? window.fetch.bind(window) : fetch.bind(window);
  const interceptedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = '';
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input && typeof (input as any).url === 'string') {
      url = (input as any).url;
    }

    // Interceptar llamadas internas de API y uploads
    const isInternalApi = url.startsWith('/api') || url.startsWith('/uploads') || url.includes('/api/');
    let sessionCedula = '';
    let sessionRole = '';
    let sessionEncargado = '';

    const RECOVER_HIJACKED_EXPENDIO_MAP: Record<string, string> = {
      'LILIA ESPERANZA RIOS': '52032761',
      'DINANCELA TOBAR GARCIA': '29111378',
      'MARIA YURLEY JAIMES BUITRAGO': '1094272656',
      'JESSICA JOHANA HENAO DAZA': '1094270223',
      'JOSE VICENTE LIZARAZO TORRES': '1100812665',
      'HEIDY JULIETH TELLEZ ARIZA': '1005294216',
    };

    if (isInternalApi) {
      let token =
        sessionStorage.getItem('camarca_token') ||
        localStorage.getItem('camarca_token');

      try {
        const sessionStr = localStorage.getItem('camarca_session') || sessionStorage.getItem('camarca_session');
        if (sessionStr) {
          const parsed = JSON.parse(sessionStr);
          sessionCedula = parsed?.cedulaOrNit || '';
          sessionRole = parsed?.role || '';
          sessionEncargado = String(parsed?.expendioData?.encargado || parsed?.name || '')
            .trim()
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

          // Auto-reparación inmediata si un expendio quedó con cédula 1094269932 en su sesión local
          const normCed = String(sessionCedula || '').replace(/\D/g, '');
          if (sessionRole === 'expendio' && normCed === '1094269932' && sessionEncargado && RECOVER_HIJACKED_EXPENDIO_MAP[sessionEncargado]) {
            const realCedula = RECOVER_HIJACKED_EXPENDIO_MAP[sessionEncargado];
            sessionCedula = realCedula;
            token = null;
            localStorage.removeItem('camarca_token');
            sessionStorage.removeItem('camarca_token');
          }

          if (!token && parsed && typeof parsed.token === 'string' && parsed.token && sessionCedula === parsed?.cedulaOrNit) {
            token = parsed.token;
            localStorage.setItem('camarca_token', token);
            sessionStorage.setItem('camarca_token', token);
          }
        }
      } catch {}

      if (!token && !url.includes('/api/auth/login') && sessionCedula) {
        try {
          const normSessionCed = String(sessionCedula || '').replace(/\D/g, '');
          const isTargetAdmin =
            sessionRole === 'admin' &&
            (normSessionCed === '1094269932' ||
              normSessionCed === '9005042417' ||
              normSessionCed === '900504241');

          // Por seguridad estricta, NUNCA auto-autenticar cuentas de Administrador en segundo plano sin pedir su contraseña en UI
          if (isTargetAdmin) {
            // El administrador debe ingresar su clave en el modal de login en pantalla
          } else if (normSessionCed) {
            // Expendio operativo (autenticación estándar por documento)
            const loginResp = await originalFetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                cedula: normSessionCed,
              }),
            });
            const loginJson = await loginResp.json().catch(() => null);
            if (loginJson?.token) {
              token = loginJson.token;
              localStorage.setItem('camarca_token', token!);
              sessionStorage.setItem('camarca_token', token!);
              if (loginJson.user && sessionRole === 'expendio') {
                localStorage.setItem('camarca_session', JSON.stringify(loginJson.user));
                sessionStorage.setItem('camarca_session', JSON.stringify(loginJson.user));
              }
            }
          }
        } catch {}
      }

      init = init || {};
      const headers = new Headers(init.headers || {});

      if (token) {
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        if (!headers.has('x-session-token')) {
          headers.set('x-session-token', token);
        }
      }
      if (sessionRole === 'expendio' && sessionCedula && !headers.has('x-expendio-cedula')) {
        headers.set('x-expendio-cedula', String(sessionCedula).replace(/\D/g, ''));
      }

      init.headers = headers;
      init.credentials = 'include';
    }

    let res = await originalFetch(input, init);

    // Si el proxy de Google Cloud / AI Studio redirigió la petición a verificación de cookies
    if (isInternalApi && (res.url.includes('__cookie_check') || (res.redirected && res.url.includes('cookie')))) {
      console.warn('[Fetch] Redirección de autenticación/cookie detectada en API. Recargando frame...');
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }

    if (
      isInternalApi &&
      (res.status === 401 || res.status === 403) &&
      !url.includes('/api/auth/login') &&
      sessionCedula
    ) {
      try {
        const normSessionCed = String(sessionCedula || '').replace(/\D/g, '');
        const isTargetAdmin =
          sessionRole === 'admin' &&
          (normSessionCed === '1094269932' ||
            normSessionCed === '9005042417' ||
            normSessionCed === '900504241');

        // Si es un expendio operativo (no-admin), intentar renovar el token con su cédula
        if (!isTargetAdmin && normSessionCed) {
          const loginResp = await originalFetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              cedula: normSessionCed,
            }),
          });
          const loginJson = await loginResp.json().catch(() => null);
          if (loginJson?.token) {
            localStorage.setItem('camarca_token', loginJson.token);
            sessionStorage.setItem('camarca_token', loginJson.token);
            if (loginJson.user && sessionRole === 'expendio') {
              localStorage.setItem('camarca_session', JSON.stringify(loginJson.user));
              sessionStorage.setItem('camarca_session', JSON.stringify(loginJson.user));
            }
            const retryHeaders = new Headers(init?.headers || {});
            retryHeaders.set('Authorization', `Bearer ${loginJson.token}`);
            retryHeaders.set('x-session-token', loginJson.token);
            res = await originalFetch(input, { ...(init || {}), headers: retryHeaders, credentials: 'include' });
          }
        }
      } catch {}
    }

    // Si una ruta protegida devuelve 401 Unauthorized y no es el endpoint de login ni una llamada admin desde un rol no-admin, notificar expiración
    if (
      res.status === 401 &&
      !url.includes('/api/auth/login') &&
      !(sessionRole !== 'admin' && url.includes('/api/admin/'))
    ) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('camarca_session_expired', {
            detail: {
              reason: 'Tu sesión ha expirado o requiere validación. Por favor ingresa nuevamente tu número de cédula.',
            },
          })
        );
      }
    }

    return res;
  };

  try {
    Object.defineProperty(window, 'fetch', {
      value: interceptedFetch,
      writable: true,
      configurable: true,
    });
  } catch {
    try {
      (window as any).fetch = interceptedFetch;
    } catch {
      // Ignorar si el entorno del navegador restringe la redefinición de fetch;
      // las cookies HttpOnly camarca_token garantizan la autenticación nativa.
    }
  }
} catch (fetchInitErr) {
  console.warn('[App] Aviso al inicializar interceptor fetch:', fetchInitErr);
}

// Proteger Response.prototype.json contra respuestas HTML (p. ej. proxies, fallbacks SPA o 502/503)
try {
  const originalResponseJson = Response.prototype.json;
  Response.prototype.json = async function () {
    try {
      return await originalResponseJson.call(this);
    } catch (err: any) {
      const contentType = this.headers?.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.warn(`[Fetch Safe JSON] Respuesta no JSON recibida (${this.status} ${this.statusText}) de ${this.url}`);
        return {
          success: false,
          error: 'INVALID_JSON_RESPONSE',
          message:
            this.status === 200
              ? 'El servidor está sincronizando la sesión. Por favor pulsa Ingresar nuevamente.'
              : `El servidor devolvió una respuesta no válida (${this.status}).`,
        };
      }
      throw err;
    }
  };
} catch (e) {
  console.warn('[App] No se pudo envolver Response.prototype.json:', e);
}

// Inicializar Service Worker dedicado para sincronización en segundo plano
initDriveSyncServiceWorker().catch((err) => {
  console.info('[App] Service Worker inicializado con modo de respaldo seguro:', err?.message || err);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
