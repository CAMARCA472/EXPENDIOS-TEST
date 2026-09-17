/**
 * Servicio de encriptación sencilla y gestión segura de Refresh Token en localStorage
 * para OAuth2 de Google Drive (CAMARCA SAS).
 */

const REFRESH_TOKEN_STORAGE_KEY = 'camarca_gdrive_rt_enc';
const EXPIRES_AT_STORAGE_KEY = 'camarca_gdrive_expires_at';
const LAST_REFRESH_STORAGE_KEY = 'camarca_gdrive_last_refresh';
const DEFAULT_SALT = 'camarca_gdrive_oauth2_secure_salt_2026';

/**
 * Deriva una clave determinística usando el salt base y características del entorno
 */
function getDerivedKey(): number[] {
  let seed = DEFAULT_SALT;
  try {
    if (typeof window !== 'undefined' && window.location) {
      seed += '_' + (window.location.hostname || 'camarca');
    }
  } catch {}

  const keyBytes: number[] = [];
  for (let i = 0; i < seed.length; i++) {
    keyBytes.push(seed.charCodeAt(i) ^ ((i * 31 + 17) & 0xff));
  }
  return keyBytes;
}

/**
 * Encripta un string usando codificación de bytes, XOR rotativo y empaquetado seguro Base64
 */
export function encryptToken(plainText: string): string {
  if (!plainText || typeof plainText !== 'string') return '';
  try {
    const key = getDerivedKey();
    const utf8Bytes = new TextEncoder().encode(plainText.trim());
    const resultBytes = new Uint8Array(utf8Bytes.length);

    for (let i = 0; i < utf8Bytes.length; i++) {
      const k = key[i % key.length];
      // XOR rotativo con desplazamiento posicional reversible
      resultBytes[i] = utf8Bytes[i] ^ k ^ ((i * 7 + 13) & 0xff);
    }

    // Convertir a Base64 estándar
    let binary = '';
    for (let i = 0; i < resultBytes.length; i++) {
      binary += String.fromCharCode(resultBytes[i]);
    }
    const b64 = btoa(binary);
    return `enc_v1:${b64}`;
  } catch (err) {
    console.error('Error al encriptar token:', err);
    return '';
  }
}

/**
 * Desencripta un token previamente encriptado con encryptToken
 */
export function decryptToken(cipherText: string): string | null {
  if (!cipherText || typeof cipherText !== 'string') return null;
  const clean = cipherText.trim();
  if (!clean.startsWith('enc_v1:')) {
    // Si no tiene prefijo pero es un token válido directo, permitir migración
    if (clean.startsWith('1//') || clean.length > 20) {
      return clean;
    }
    return null;
  }

  try {
    const b64 = clean.slice(7);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const key = getDerivedKey();
    const resultBytes = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      const k = key[i % key.length];
      resultBytes[i] = bytes[i] ^ k ^ ((i * 7 + 13) & 0xff);
    }

    const decrypted = new TextDecoder().decode(resultBytes);
    if (decrypted && decrypted.length > 5) {
      return decrypted;
    }
  } catch (err) {
    console.warn('Advertencia al desencriptar token en localStorage:', err);
  }
  return null;
}

/**
 * Guarda el Refresh Token encriptado en localStorage y sessionStorage
 */
export function saveEncryptedRefreshToken(refreshToken: string): void {
  try {
    if (typeof window === 'undefined') return;
    if (!refreshToken || refreshToken.trim().length < 5) return;
    const encrypted = encryptToken(refreshToken.trim());
    if (encrypted) {
      window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, encrypted);
      window.sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, encrypted);
    }
  } catch (e) {
    console.warn('No se pudo guardar refresh token en localStorage:', e);
  }
}

/**
 * Obtiene el Refresh Token desencriptado desde localStorage
 */
export function getStoredRefreshToken(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) || 
                window.sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    if (!raw) return null;
    return decryptToken(raw);
  } catch {
    return null;
  }
}

/**
 * Elimina el Refresh Token encriptado de localStorage
 */
export function clearEncryptedRefreshToken(): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    window.sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(EXPIRES_AT_STORAGE_KEY);
    window.sessionStorage.removeItem(EXPIRES_AT_STORAGE_KEY);
  } catch {}
}

/**
 * Comprueba si hay un Refresh Token almacenado
 */
export function hasStoredRefreshToken(): boolean {
  return Boolean(getStoredRefreshToken());
}

/**
 * Guarda la marca de tiempo en que expirará el access token
 */
export function saveTokenExpiration(expiresInSeconds: number = 3600): void {
  try {
    if (typeof window === 'undefined') return;
    const expiresAt = Date.now() + (expiresInSeconds * 1000);
    window.localStorage.setItem(EXPIRES_AT_STORAGE_KEY, expiresAt.toString());
    window.localStorage.setItem(LAST_REFRESH_STORAGE_KEY, Date.now().toString());
    window.sessionStorage.setItem(EXPIRES_AT_STORAGE_KEY, expiresAt.toString());
  } catch {}
}

/**
 * Obtiene la marca de tiempo en que expira el token actual
 */
export function getTokenExpiration(): number | null {
  try {
    if (typeof window === 'undefined') return null;
    const val = window.localStorage.getItem(EXPIRES_AT_STORAGE_KEY) || 
                window.sessionStorage.getItem(EXPIRES_AT_STORAGE_KEY);
    if (val) {
      const num = parseInt(val, 10);
      if (!isNaN(num)) return num;
    }
  } catch {}
  return null;
}

/**
 * Verifica si el access token ha expirado o está cerca de expirar
 * @param marginSeconds Margen de seguridad en segundos (por defecto 300 = 5 minutos)
 */
export function isAccessTokenExpired(marginSeconds: number = 300): boolean {
  const expiresAt = getTokenExpiration();
  if (!expiresAt) {
    // Si no hay fecha de expiración registrada, asumir expirado para evitar llamadas con credenciales obsoletas
    return true;
  }
  const now = Date.now();
  const marginMs = marginSeconds * 1000;
  return now >= (expiresAt - marginMs);
}

/**
 * Devuelve el tiempo restante en minutos y segundos antes de la expiración
 */
export function getTimeUntilExpiration(): { minutes: number; seconds: number; isExpired: boolean; text: string } {
  const expiresAt = getTokenExpiration();
  if (!expiresAt) {
    return { minutes: 0, seconds: 0, isExpired: false, text: 'Vigente' };
  }
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    return { minutes: 0, seconds: 0, isExpired: true, text: 'Expirado' };
  }
  const totalSecs = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSecs / 60);
  const seconds = totalSecs % 60;
  return {
    minutes,
    seconds,
    isExpired: false,
    text: `${minutes}m ${seconds.toString().padStart(2, '0')}s`,
  };
}
