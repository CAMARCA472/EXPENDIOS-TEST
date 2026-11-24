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

export interface GoogleUser {
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  uid?: string;
}

export type User = GoogleUser;

// Scopes for Google Drive photo backup
export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
];

const GOOGLE_CLIENT_ID = '1094702324887-rp4lbvga43esdfrgjvp00huuf2tihoit.apps.googleusercontent.com';

async function resolveClientId(): Promise<string> {
  try {
    const res = await fetch('/api/admin/google-drive/token');
    if (res.ok) {
      const data = await res.json();
      if (data.googleOAuthClientId && data.googleOAuthClientId.trim()) {
        return data.googleOAuthClientId.trim();
      }
    }
  } catch {}
  return GOOGLE_CLIENT_ID;
}

// In-memory token cache with active session support
let cachedAccessToken: string | null = null;
let cachedUser: GoogleUser | null = null;
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

      // Persistir al servidor backend (el Refresh Token se gestiona exclusivamente en PostgreSQL en el backend)
      fetch('/api/admin/google-drive/set-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accessToken: cleanToken,
          expiresIn: expiresInSeconds,
          email: email || (typeof window !== 'undefined' ? window.localStorage.getItem(SESSION_EMAIL_KEY) || '' : ''),
          displayName: displayName || (typeof window !== 'undefined' ? window.localStorage.getItem(SESSION_NAME_KEY) || '' : ''),
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
 * persistido de forma segura en PostgreSQL en el servidor.
 */
export const refreshGoogleAccessToken = async (): Promise<string | null> => {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    try {
      const res = await fetch('/api/admin/google-drive/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();
      if (res.ok && data.success && data.accessToken) {
        const newAccessToken = data.accessToken;
        const expiresIn = data.expiresIn || 3600;

        cachedAccessToken = newAccessToken;
        saveTokenExpiration(expiresIn);
        saveSessionToken(newAccessToken, undefined, undefined, expiresIn);

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('googleDriveTokenRefreshed', {
              detail: { accessToken: newAccessToken, expiresIn },
            })
          );
        }

        console.log(`[GoogleAuth] ✓ Token de acceso renovado exitosamente desde PostgreSQL. Vigencia: ${expiresIn}s`);
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

// Temporizador proactivo para renovar token antes de que expire (< 5 min)
if (typeof window !== 'undefined') {
  setInterval(async () => {
    try {
      if (hasStoredRefreshToken() && isAccessTokenExpired(300)) {
        await refreshGoogleAccessToken();
      }
    } catch {}
  }, 60 * 1000);
}

export const initAuth = (
  onAuthSuccess?: (user: GoogleUser, token: string) => void,
  onAuthFailure?: () => void
) => {
  const storedToken = getStoredSessionToken();
  const email = typeof window !== 'undefined' ? window.localStorage.getItem(SESSION_EMAIL_KEY) || 'admin@camarca.com' : 'admin@camarca.com';
  const displayName = typeof window !== 'undefined' ? window.localStorage.getItem(SESSION_NAME_KEY) || 'Administrador' : 'Administrador';

  const defaultUser: GoogleUser = { email, displayName };

  // Intentar refrescar o recuperar token sin desconectar
  const tryRecoverToken = async () => {
    // 1. Probar renovación con Refresh Token backend/PostgreSQL
    try {
      const refreshedToken = await refreshGoogleAccessToken();
      if (refreshedToken) {
        cachedAccessToken = refreshedToken;
        cachedUser = defaultUser;
        if (onAuthSuccess) onAuthSuccess(defaultUser, refreshedToken);
        return;
      }
    } catch {}

    // 2. Probar consultar token activo del servidor
    try {
      const res = await fetch('/api/admin/google-drive/token', { cache: 'no-store' });
      const data = await res.json();
      if (data.success && data.accessToken && data.hasToken) {
        cachedAccessToken = data.accessToken;
        const u: GoogleUser = {
          email: data.email || email,
          displayName: data.displayName || displayName,
        };
        cachedUser = u;
        saveSessionToken(data.accessToken, u.email || '', u.displayName || '');
        if (onAuthSuccess) onAuthSuccess(u, data.accessToken);
        return;
      }
    } catch {}

    // Si aún no hay token nuevo pero tenemos token almacenado, preservarlo
    if (storedToken) {
      cachedAccessToken = storedToken;
      cachedUser = defaultUser;
      if (onAuthSuccess) onAuthSuccess(defaultUser, storedToken);
      return;
    }

    if (onAuthFailure) onAuthFailure();
  };

  if (storedToken && !isAccessTokenExpired(0)) {
    cachedAccessToken = storedToken;
    cachedUser = defaultUser;
    if (onAuthSuccess) onAuthSuccess(defaultUser, storedToken);
  } else {
    tryRecoverToken();
  }

  return () => {};
};


/**
 * Inicio de sesión con Google usando Google Identity Services (GIS)
 * Prefiere el flujo de código offline para obtener y persistir el Refresh Token en PostgreSQL
 */
export const googleSignIn = async (): Promise<{ user: GoogleUser; accessToken: string } | null> => {
  try {
    const offlineRes = await connectGoogleOAuth2Offline();
    if (offlineRes.success && offlineRes.accessToken) {
      let userInfo: GoogleUser = { email: 'admin@camarca.com', displayName: 'Administrador CAMARCA' };
      try {
        const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${offlineRes.accessToken}` },
        });
        if (uRes.ok) {
          const uJson = await uRes.json();
          userInfo = {
            email: uJson.email,
            displayName: uJson.name,
            photoURL: uJson.picture,
            uid: uJson.sub,
          };
        }
      } catch {}

      cachedUser = userInfo;
      cachedAccessToken = offlineRes.accessToken;
      return { user: userInfo, accessToken: offlineRes.accessToken };
    }
  } catch (offlineErr) {
    console.warn('[GoogleAuth] Fallo en flujo offline, intentando fallback token client:', offlineErr);
  }

  return new Promise((resolve, reject) => {
    try {
      isSigningIn = true;
      const googleObj = typeof window !== 'undefined' ? (window as any).google : null;

      if (!googleObj?.accounts?.oauth2) {
        // Fallback: Si no está cargado GIS, verificar si el servidor ya tiene token
        fetch('/api/admin/google-drive/token', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (data.success && data.accessToken && data.hasToken) {
              const u: GoogleUser = { email: data.email || 'admin@camarca.com', displayName: data.displayName || 'Administrador' };
              cachedAccessToken = data.accessToken;
              cachedUser = u;
              resolve({ user: u, accessToken: data.accessToken });
            } else {
              reject(new Error('Google Identity Services no está disponible en este momento.'));
            }
          })
          .catch((err) => reject(err));
        return;
      }

      resolveClientId().then((activeClientId) => {
        const client = googleObj.accounts.oauth2.initTokenClient({
          client_id: activeClientId,
          scope: SCOPES.join(' '),
          prompt: 'consent',
          callback: async (response: any) => {
            if (response.error) {
              reject(new Error(response.error_description || response.error));
              return;
            }

            if (response.access_token) {
              const token = response.access_token;
              cachedAccessToken = token;
              const expiresIn = Number(response.expires_in) || 3600;

              let userInfo: GoogleUser = { email: 'admin@camarca.com', displayName: 'Administrador CAMARCA' };
              try {
                const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (uRes.ok) {
                  const uJson = await uRes.json();
                  userInfo = {
                    email: uJson.email,
                    displayName: uJson.name,
                    photoURL: uJson.picture,
                    uid: uJson.sub,
                  };
                }
              } catch {}

              cachedUser = userInfo;
              saveSessionToken(token, userInfo.email || '', userInfo.displayName || '', expiresIn);

              resolve({ user: userInfo, accessToken: token });
            } else {
              reject(new Error('No se recibió token de acceso de Google.'));
            }
          },
        });

        client.requestAccessToken();
      }).catch((e) => reject(e));
    } catch (err) {
      reject(err);
    } finally {
      isSigningIn = false;
    }
  });
};

/**
 * Flujo de autorización OAuth2 Offline con Google Identity Services (GIS)
 * Permite obtener el Refresh Token permanente mediante intercambio de código
 */
export const connectGoogleOAuth2Offline = async (): Promise<{
  success: boolean;
  accessToken?: string;
  hasRefreshToken: boolean;
  error?: string;
}> => {
  return new Promise((resolve) => {
    try {
      const googleObj = typeof window !== 'undefined' ? (window as any).google : null;
      if (!googleObj?.accounts?.oauth2) {
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

      fetch('/api/admin/google-drive/token')
        .then((res) => res.json())
        .then((data) => {
          const activeClientId = (data?.googleOAuthClientId && data.googleOAuthClientId.trim()) || GOOGLE_CLIENT_ID;
          const hasClientSecret = Boolean(data?.googleOAuthClientSecret && data.googleOAuthClientSecret.trim());

          if (!hasClientSecret && activeClientId === GOOGLE_CLIENT_ID) {
            console.log('[GoogleAuth] Fallback: No se detectó googleOAuthClientSecret propio. Usando initTokenClient de Google.');
            // Fallback a initTokenClient para obtener el access token directamente en el cliente
            const client = googleObj.accounts.oauth2.initTokenClient({
              client_id: activeClientId,
              scope: SCOPES.join(' '),
              prompt: 'consent',
              callback: async (response: any) => {
                if (response.error) {
                  resolve({ success: false, hasRefreshToken: false, error: response.error_description || response.error });
                  return;
                }

                if (response.access_token) {
                  const token = response.access_token;
                  cachedAccessToken = token;
                  const expiresIn = Number(response.expires_in) || 3600;

                  let userInfo: GoogleUser = { email: 'admin@camarca.com', displayName: 'Administrador CAMARCA' };
                  try {
                    const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    if (uRes.ok) {
                      const uJson = await uRes.json();
                      userInfo = {
                        email: uJson.email,
                        displayName: uJson.name,
                        photoURL: uJson.picture,
                        uid: uJson.sub,
                      };
                    }
                  } catch {}

                  cachedUser = userInfo;
                  saveSessionToken(token, userInfo.email || '', userInfo.displayName || '', expiresIn);

                  resolve({
                    success: true,
                    accessToken: token,
                    hasRefreshToken: false,
                  });
                } else {
                  resolve({ success: false, hasRefreshToken: false, error: 'No se recibió token de acceso de Google.' });
                }
              },
            });

            client.requestAccessToken();
            return;
          }

          // Si hay un client secret configurado o un Client ID propio, procedemos con el flujo offline seguro
          const client = googleObj.accounts.oauth2.initCodeClient({
            client_id: activeClientId,
            scope: SCOPES.join(' '),
            ux_mode: 'popup',
            select_account: true,
            access_type: 'offline',
            prompt: 'consent',
            callback: async (response: any) => {
              if (response.error) {
                resolve({ success: false, hasRefreshToken: false, error: response.error });
                return;
              }

              if (response.code) {
                try {
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

                    // El Refresh Token queda protegido en PostgreSQL, nunca en el navegador
                    clearEncryptedRefreshToken();

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
                      hasRefreshToken: Boolean(exchangeData.hasRefreshToken),
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
        })
        .catch((e) => resolve({ success: false, hasRefreshToken: false, error: e.message }));
    } catch (err: any) {
      resolve({ success: false, hasRefreshToken: false, error: err.message });
    }
  });
};

export const saveManualRefreshToken = async (rawToken: string): Promise<boolean> => {
  if (!rawToken || rawToken.trim().length < 5) return false;
  try {
    const cleanToken = rawToken.trim();
    // Guardar Refresh Token exclusivamente en PostgreSQL en el backend
    const res = await fetch('/api/admin/google-drive/set-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: cleanToken }),
    });
    if (res.ok) {
      const newAccessToken = await refreshGoogleAccessToken();
      return Boolean(newAccessToken);
    }
    return false;
  } catch (err) {
    console.error('Error guardando refresh token manual en PostgreSQL:', err);
    return false;
  }
};

export const getAccessToken = async (forceRefresh: boolean = false): Promise<string | null> => {
  if (!forceRefresh && cachedAccessToken && !isAccessTokenExpired(60)) {
    return cachedAccessToken;
  }

  // Renovar a través del servidor backend con el Refresh Token de PostgreSQL
  const refreshed = await refreshGoogleAccessToken();
  if (refreshed && !isAccessTokenExpired(0)) {
    return refreshed;
  }

  // Fallback a consultar token activo desde servidor
  try {
    const res = await fetch('/api/admin/google-drive/token', { cache: 'no-store' });
    const data = await res.json();
    if (data.success && data.accessToken && data.hasToken) {
      cachedAccessToken = data.accessToken;
      saveSessionToken(data.accessToken, data.email, data.displayName);
      return data.accessToken;
    }
  } catch {}

  return cachedAccessToken;
};

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
  saveSessionToken(token);
};

export const getCachedUser = (): GoogleUser | null => {
  return cachedUser;
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
  clearSessionToken();
  try {
    await fetch('/api/admin/google-drive/set-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: 'cleared' }),
    });
  } catch {}
};
