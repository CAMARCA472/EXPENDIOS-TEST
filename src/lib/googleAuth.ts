import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User, 
  signOut 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  saveEncryptedRefreshToken,
  getStoredRefreshToken,
  clearEncryptedRefreshToken,
  hasStoredRefreshToken,
  saveTokenExpiration,
  getTokenExpiration,
  isAccessTokenExpired,
  getTimeUntilExpiration
} from './cryptoToken';

export {
  hasStoredRefreshToken,
  getTokenExpiration,
  isAccessTokenExpired,
  getTimeUntilExpiration
};

// Defined scopes for Google Drive backup & Google Sheets database integration
export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.setCustomParameters({
  prompt: 'consent',
  access_type: 'offline',
});

// In-memory token cache with active session support
let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;
let isSigningIn = false;
let activeRefreshPromise: Promise<string | null> | null = null;

const SESSION_TOKEN_KEY = 'camarca_gdrive_access_token';
const SESSION_TIMESTAMP_KEY = 'camarca_gdrive_token_ts';
const SESSION_EMAIL_KEY = 'camarca_gdrive_email';
const SESSION_NAME_KEY = 'camarca_gdrive_name';

function getStoredSessionToken(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const token = window.localStorage.getItem(SESSION_TOKEN_KEY) || window.sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (token && token.trim().length > 10) {
      return token.trim();
    }
  } catch {}
  return null;
}

function saveSessionToken(token: string | null, email?: string, displayName?: string, expiresInSeconds: number = 3600) {
  try {
    if (typeof window === 'undefined') return;
    if (token && token.trim().length > 10) {
      const cleanToken = token.trim();
      window.localStorage.setItem(SESSION_TOKEN_KEY, cleanToken);
      window.localStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
      window.sessionStorage.setItem(SESSION_TOKEN_KEY, cleanToken);
      window.sessionStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
      saveTokenExpiration(expiresInSeconds);

      if (email) {
        window.localStorage.setItem(SESSION_EMAIL_KEY, email);
        window.sessionStorage.setItem(SESSION_EMAIL_KEY, email);
      }
      if (displayName) {
        window.localStorage.setItem(SESSION_NAME_KEY, displayName);
        window.sessionStorage.setItem(SESSION_NAME_KEY, displayName);
      }

      // Persistir al servidor backend
      const storedRefreshToken = getStoredRefreshToken();
      fetch('/api/admin/google-drive/set-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accessToken: cleanToken,
          refreshToken: storedRefreshToken || undefined,
          expiresIn: expiresInSeconds,
          email: email || window.localStorage.getItem(SESSION_EMAIL_KEY) || '',
          displayName: displayName || window.localStorage.getItem(SESSION_NAME_KEY) || '',
        }),
      }).catch(() => {});
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
      window.localStorage.removeItem(SESSION_TIMESTAMP_KEY);
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
      window.sessionStorage.removeItem(SESSION_TIMESTAMP_KEY);
    }
  } catch {}
}

/**
 * Renueva automáticamente el Access Token utilizando el Refresh Token
 * Almacenado de forma encriptada en localStorage o persistido en el servidor
 */
export const refreshGoogleAccessToken = async (): Promise<string | null> => {
  // Deduplicación de promesas concurrentes
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    try {
      const storedRefreshToken = getStoredRefreshToken();
      const res = await fetch('/api/admin/google-drive/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: storedRefreshToken || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.accessToken) {
        const newAccessToken = data.accessToken;
        const expiresIn = data.expiresIn || 3600;

        cachedAccessToken = newAccessToken;
        saveTokenExpiration(expiresIn);
        saveSessionToken(newAccessToken, undefined, undefined, expiresIn);

        // Notificar al navegador que el token ha sido renovado
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('googleDriveTokenRefreshed', {
              detail: { accessToken: newAccessToken, expiresIn },
            })
          );
        }

        console.log(`[GoogleAuth] ✓ Token de acceso renovado exitosamente sin requerir inicio de sesión. Vigencia: ${expiresIn}s`);
        return newAccessToken;
      } else {
        console.warn('[GoogleAuth] Fallo en la renovación automática de token:', data.error);
        return null;
      }
    } catch (err: any) {
      console.error('[GoogleAuth] Error durante la renovación de token:', err.message);
      return null;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
};

/**
 * Temporizador de fondo que renueva proactivamente el access token antes de que expire (< 5 min)
 */
if (typeof window !== 'undefined') {
  setInterval(async () => {
    try {
      if (hasStoredRefreshToken() && isAccessTokenExpired(300)) {
        console.log('[GoogleAuth Watchdog] Token próximo a expirar (< 5 min). Auto-renovando con Refresh Token...');
        await refreshGoogleAccessToken();
      }
    } catch {}
  }, 60 * 1000);
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // Sincronizar token existente
  const storedToken = getStoredSessionToken();
  const storedRefreshToken = getStoredRefreshToken();

  if (storedToken) {
    if (isAccessTokenExpired(0)) {
      if (storedRefreshToken) {
        refreshGoogleAccessToken()
          .then((newToken) => {
            if (newToken && onAuthSuccess && cachedUser) {
              onAuthSuccess(cachedUser, newToken);
            }
          })
          .catch(() => {
            clearSessionToken();
          });
      } else {
        // Token expirado y sin refresh token: limpiar sesión obsoleta
        clearSessionToken();
        cachedAccessToken = null;
      }
    } else {
      cachedAccessToken = storedToken;
      fetch('/api/admin/google-drive/set-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: storedToken,
          refreshToken: storedRefreshToken || undefined,
        }),
      }).catch(() => {});
    }
  }

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      cachedUser = user;
      let validToken: string | null = cachedAccessToken || getStoredSessionToken();

      // Si no hay token o expiró, intentar renovar con refresh token
      if (!validToken || isAccessTokenExpired(0)) {
        if (hasStoredRefreshToken()) {
          validToken = await refreshGoogleAccessToken();
        } else {
          validToken = null;
          clearSessionToken();
          cachedAccessToken = null;
        }
      }

      if (validToken && !isAccessTokenExpired(0)) {
        cachedAccessToken = validToken;
        if (onAuthSuccess) onAuthSuccess(user, validToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedUser = null;
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('No se pudo obtener el token de acceso de Google Drive');
    }

    cachedAccessToken = credential.accessToken;
    cachedUser = result.user;
    
    // Guardar token de acceso y vigencia estimada (3600 segundos estándar)
    saveSessionToken(cachedAccessToken, result.user.email || '', result.user.displayName || '', 3600);

    // Si ya existe un refresh token encriptado guardado, asociarlo de inmediato en el servidor
    const existingRefreshToken = getStoredRefreshToken();
    fetch('/api/admin/google-drive/set-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: credential.accessToken,
        refreshToken: existingRefreshToken || undefined,
        expiresIn: 3600,
        email: result.user.email || '',
        displayName: result.user.displayName || '',
      }),
    }).catch(() => {});

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Error al iniciar sesión con Google:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Flujo de autorización OAuth2 Offline con Google Identity Services (GIS)
 * Permite obtener directamente el código de autorización para recibir el Refresh Token permanente
 */
export const connectGoogleOAuth2Offline = async (): Promise<{
  success: boolean;
  accessToken?: string;
  hasRefreshToken: boolean;
  error?: string;
}> => {
  return new Promise((resolve) => {
    try {
      const googleObj = (window as any).google;
      if (!googleObj?.accounts?.oauth2) {
        // Si no está cargado el script GIS, intentar con Firebase popup directo
        googleSignIn()
          .then((res) => {
            if (res) {
              resolve({
                success: true,
                accessToken: res.accessToken,
                hasRefreshToken: hasStoredRefreshToken(),
              });
            } else {
              resolve({ success: false, hasRefreshToken: false, error: 'No se completó el inicio de sesión' });
            }
          })
          .catch((err) => resolve({ success: false, hasRefreshToken: false, error: err.message }));
        return;
      }

      const client = googleObj.accounts.oauth2.initCodeClient({
        client_id: (firebaseConfig as any).oAuthClientId || '1094702324887-rp4lbvga43esdfrgjvp00huuf2tihoit.apps.googleusercontent.com',
        scope: SCOPES.join(' '),
        ux_mode: 'popup',
        select_account: true,
        access_type: 'offline', // Clave para obtener el Refresh Token permanente
        prompt: 'consent', // Forzar pantalla de consentimiento para emitir refresh_token
        callback: async (response: any) => {
          if (response.error) {
            console.error('Error en popup OAuth2 GIS:', response.error);
            resolve({ success: false, hasRefreshToken: false, error: response.error });
            return;
          }

          if (response.code) {
            try {
              // Intercambiar código por Access Token y Refresh Token en el servidor
              const exchangeRes = await fetch('/api/admin/google-drive/oauth2/code-exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code: response.code,
                  redirectUri: 'postmessage',
                }),
              });

              const exchangeData = await exchangeRes.json();
              if (exchangeRes.ok && exchangeData.success && exchangeData.accessToken) {
                cachedAccessToken = exchangeData.accessToken;
                const expiresIn = exchangeData.expiresIn || 3600;

                // Almacenar el Refresh Token de forma encriptada en localStorage
                if (exchangeData.refreshToken) {
                  saveEncryptedRefreshToken(exchangeData.refreshToken);
                }

                saveSessionToken(exchangeData.accessToken, undefined, undefined, expiresIn);

                if (typeof window !== 'undefined') {
                  window.dispatchEvent(
                    new CustomEvent('googleDriveTokenRefreshed', {
                      detail: { accessToken: exchangeData.accessToken, expiresIn },
                    })
                  );
                }

                resolve({
                  success: true,
                  accessToken: exchangeData.accessToken,
                  hasRefreshToken: Boolean(exchangeData.refreshToken || hasStoredRefreshToken()),
                });
              } else {
                resolve({
                  success: false,
                  hasRefreshToken: false,
                  error: exchangeData.error || 'Fallo en el intercambio de código OAuth2',
                });
              }
            } catch (err: any) {
              resolve({ success: false, hasRefreshToken: false, error: err.message });
            }
          } else {
            resolve({ success: false, hasRefreshToken: false, error: 'No se recibió código de autorización de Google.' });
          }
        },
      });

      client.requestCode();
    } catch (err: any) {
      resolve({ success: false, hasRefreshToken: false, error: err.message });
    }
  });
};

/**
 * Guarda manualmente un Refresh Token (por ejemplo de consola GCP o credencial de servicio)
 * encriptándolo de forma segura en localStorage y sincronizándolo al servidor.
 */
export const saveManualRefreshToken = async (rawToken: string): Promise<boolean> => {
  if (!rawToken || rawToken.trim().length < 5) return false;
  try {
    const cleanToken = rawToken.trim();
    saveEncryptedRefreshToken(cleanToken);

    // Intentar renovar el access token inmediatamente para validar que el refresh token sea funcional
    const newAccessToken = await refreshGoogleAccessToken();
    return Boolean(newAccessToken);
  } catch (err) {
    console.error('Error guardando refresh token manual:', err);
    return false;
  }
};

export const getAccessToken = async (forceRefresh: boolean = false): Promise<string | null> => {
  // 1. Si no se fuerza y el token en memoria sigue vigente (> 1 minuto restante), usarlo
  if (!forceRefresh && cachedAccessToken && !isAccessTokenExpired(60)) {
    return cachedAccessToken;
  }

  // 2. Si ha expirado o se fuerza refresco, intentar renovar con refresh token
  const hasRt = hasStoredRefreshToken();
  if (forceRefresh || hasRt || isAccessTokenExpired(0)) {
    if (hasRt) {
      const refreshed = await refreshGoogleAccessToken();
      if (refreshed && !isAccessTokenExpired(0)) {
        return refreshed;
      }
    }
  }

  // 3. Verificar token almacenado en localStorage SOLO si sigue vigente
  const stored = getStoredSessionToken();
  if (stored && !isAccessTokenExpired(0)) {
    cachedAccessToken = stored;
    return stored;
  }

  // Si el token almacenado expiró y no se pudo renovar, limpiar la sesión
  if (stored && isAccessTokenExpired(0) && !hasRt) {
    clearSessionToken();
    cachedAccessToken = null;
  }

  // 4. Fallback: Consultar al servidor backend
  try {
    const res = await fetch('/api/admin/google-drive/token', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.accessToken && data.hasToken) {
        cachedAccessToken = data.accessToken;
        saveSessionToken(data.accessToken);
        return data.accessToken;
      }
    }
  } catch {}

  return null;
};

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
  saveSessionToken(token);
};

export const getCachedUser = (): User | null => {
  return cachedUser || auth.currentUser;
};

export const clearSessionToken = () => {
  cachedAccessToken = null;
  cachedUser = null;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
      window.localStorage.removeItem(SESSION_TIMESTAMP_KEY);
      window.localStorage.removeItem(SESSION_EMAIL_KEY);
      window.localStorage.removeItem(SESSION_NAME_KEY);
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
      window.sessionStorage.removeItem(SESSION_TIMESTAMP_KEY);
      window.sessionStorage.removeItem(SESSION_EMAIL_KEY);
      window.sessionStorage.removeItem(SESSION_NAME_KEY);
    }
  } catch {}
  clearEncryptedRefreshToken();
};

export const logoutGoogle = async () => {
  try {
    await signOut(auth);
  } catch {}
  clearSessionToken();

  // Limpiar servidor
  try {
    await fetch('/api/admin/google-drive/set-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: 'cleared' }),
    });
  } catch {}
};
