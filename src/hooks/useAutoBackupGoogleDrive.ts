import { useState, useEffect, useRef, useCallback } from 'react';
import { User } from 'firebase/auth';
import { 
  initAuth, 
  googleSignIn, 
  logoutGoogle, 
  clearSessionToken,
  getAccessToken, 
  getCachedUser,
  refreshGoogleAccessToken,
  connectGoogleOAuth2Offline,
  saveManualRefreshToken,
  hasStoredRefreshToken,
  isAccessTokenExpired,
  getTimeUntilExpiration
} from '../lib/googleAuth';
import { 
  executeGoogleDriveBackup, 
  GoogleDriveFile, 
  listBackupFiles, 
  getOrCreateBackupFolder,
  purgeOldBackupsFromGoogleDrive,
  PurgeBackupsResult,
  syncAllPhotosToGoogleDrive
} from '../lib/googleDriveService';
import { GoogleDriveBackupRecord, SystemConfig } from '../types';

const BACKUP_INTERVAL_MS = 10 * 60 * 1000; // 7,200,000 ms

export interface AutoBackupState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  isBackingUp: boolean;
  isPurging: boolean;
  hasRefreshToken: boolean;
  tiempoHastaExpiracion: string;
  ultimoBackup: GoogleDriveBackupRecord | null;
  historialBackups: GoogleDriveBackupRecord[];
  proximoBackupTimestamp: number | null;
  tiempoRestanteStr: string;
  error: string | null;
  carpetaDriveId: string | null;
  carpetaDriveUrl: string | null;
  autoBackupActivo: boolean;
  diasRetencion: number;
  ultimoPurgeDrive: string | null;
}

export function useAutoBackupGoogleDrive() {
  const [user, setUser] = useState<User | null>(getCachedUser());
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [hasRefreshTokenState, setHasRefreshTokenState] = useState<boolean>(hasStoredRefreshToken());
  const getExpirationText = (): string => {
    try {
      const exp = getTimeUntilExpiration();
      if (!exp) return 'Vigente';
      if (typeof exp === 'string') return exp;
      return exp.text || 'Vigente';
    } catch {
      return 'Vigente';
    }
  };

  const [tiempoHastaExpiracion, setTiempoHastaExpiracion] = useState<string>(getExpirationText());
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [isBackingUp, setIsBackingUp] = useState<boolean>(false);
  const [isPurging, setIsPurging] = useState<boolean>(false);
  const [ultimoBackup, setUltimoBackup] = useState<GoogleDriveBackupRecord | null>(null);
  const [historialBackups, setHistorialBackups] = useState<GoogleDriveBackupRecord[]>([]);
  const [proximoBackupTimestamp, setProximoBackupTimestamp] = useState<number | null>(null);
  const [tiempoRestanteStr, setTiempoRestanteStr] = useState<string>('--:--:--');
  const [error, setError] = useState<string | null>(null);
  const [carpetaDriveId, setCarpetaDriveId] = useState<string | null>(null);
  const [carpetaDriveUrl, setCarpetaDriveUrl] = useState<string | null>(null);
  const [autoBackupActivo, setAutoBackupActivo] = useState<boolean>(true);
  const [ultimoPurgeDrive, setUltimoPurgeDrive] = useState<string | null>(null);

  const isBackingUpRef = useRef<boolean>(false);
  isBackingUpRef.current = isBackingUp;

  const proximoBackupRef = useRef<number | null>(proximoBackupTimestamp);
  proximoBackupRef.current = proximoBackupTimestamp;

  const ultimoBackupRef = useRef<GoogleDriveBackupRecord | null>(ultimoBackup);
  ultimoBackupRef.current = ultimoBackup;

  // Cargar estado inicial y registros guardados en el servidor
  const fetchServerBackupStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/google-drive/status?_t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        if (Array.isArray(data.backups)) {
          setHistorialBackups(data.backups);
          if (data.backups.length > 0) {
            setUltimoBackup(data.backups[0]);
          } else {
            setUltimoBackup(null);
          }
        }
        if (data.ultimoBackupDrive) {
          const lastTime = new Date(data.ultimoBackupDrive).getTime();
          setProximoBackupTimestamp(lastTime + BACKUP_INTERVAL_MS);
        }
        if (typeof data.backupAutomaticoDriveActivo === 'boolean') {
          setAutoBackupActivo(data.backupAutomaticoDriveActivo);
        }
        if (data.carpetaDriveId) {
          setCarpetaDriveId(data.carpetaDriveId);
        }
        if (data.carpetaDriveUrl) {
          setCarpetaDriveUrl(data.carpetaDriveUrl);
        }
        if (data.ultimoPurgeDrive) {
          setUltimoPurgeDrive(data.ultimoPurgeDrive);
        }
      }
    } catch (err) {
      console.warn('Error obteniendo estado de backup del servidor:', err);
    }
  }, []);

  // Escuchar eventos globales de purga y de renovación de token
  useEffect(() => {
    const handlePurgeCompleted = () => {
      fetchServerBackupStatus();
    };
    const handleTokenRefreshed = (e: any) => {
      if (e.detail?.accessToken) {
        setAccessToken(e.detail.accessToken);
        setHasRefreshTokenState(hasStoredRefreshToken());
        setTiempoHastaExpiracion(getExpirationText());
        setError(null);
      }
    };

    window.addEventListener('googleDrivePurgeCompleted', handlePurgeCompleted);
    window.addEventListener('googleDriveTokenRefreshed', handleTokenRefreshed);

    const timer = setInterval(() => {
      setTiempoHastaExpiracion(getExpirationText());
      setHasRefreshTokenState(hasStoredRefreshToken());
    }, 15000);

    return () => {
      window.removeEventListener('googleDrivePurgeCompleted', handlePurgeCompleted);
      window.removeEventListener('googleDriveTokenRefreshed', handleTokenRefreshed);
      clearInterval(timer);
    };
  }, [fetchServerBackupStatus]);

  // Inicializar autenticación con Google
  useEffect(() => {
    fetchServerBackupStatus();

    const unsubscribe = initAuth(
      async (authedUser, token) => {
        setUser(authedUser);
        setAccessToken(token);
        setError(null);

        // Detectar o crear carpeta en Drive
        try {
          const folder = await getOrCreateBackupFolder(token);
          setCarpetaDriveId(folder.id);
          setCarpetaDriveUrl(folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`);

          // Ejecutar depuración pasiva de 1 semana en segundo plano al conectar
          purgeOldBackupsFromGoogleDrive(token, folder.id, 7)
            .then((pRes) => {
              if (pRes && pRes.totalDeleted > 0) {
                fetchServerBackupStatus();
              }
            })
            .catch(() => {});

          // Sincronización automática de fotos en segundo plano hacia Google Drive DESACTIVADA
          // syncAllPhotosToGoogleDrive(token).catch(() => {});
        } catch (fErr: any) {
          const isAuthError =
            fErr?.message?.includes('invalid authentication credentials') ||
            fErr?.message?.includes('401') ||
            fErr?.message?.includes('UNAUTHENTICATED') ||
            fErr?.message?.includes('Invalid Credentials') ||
            fErr?.message?.includes('Failed to fetch') ||
            fErr?.message?.includes('NetworkError');

          if (isAuthError) {
            console.warn('[Google Drive] Credenciales de Google inválidas o no disponibles al inicializar. Limpiando sesión...');
            clearSessionToken();
            setAccessToken(null);
            setUser(null);
          } else {
            console.warn('Aviso resolviendo carpeta de Drive:', fErr?.message || fErr);
          }
        }
      },
      () => {
        setUser(null);
        setAccessToken(null);
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [fetchServerBackupStatus]);

  // Ejecutar copia de seguridad (manual o automática)
  const ejecutarCopia = useCallback(
    async (origen: 'Automatico_10m' | 'Manual' = 'Automatico_10m'): Promise<GoogleDriveBackupRecord | null> => {
      if (isBackingUpRef.current) return null;

      // Programar preventivamente el siguiente ciclo a 10 minutos para evitar bucles de reintento en caso de fallo
      const nextTime = Date.now() + BACKUP_INTERVAL_MS;
      proximoBackupRef.current = nextTime;
      setProximoBackupTimestamp(nextTime);

      const currentToken = accessToken || (await getAccessToken());
      if (!currentToken || isAccessTokenExpired(0)) {
        clearSessionToken();
        setAccessToken(null);
        setUser(null);
        setProximoBackupTimestamp(null);
        proximoBackupRef.current = null;
        setError('No hay sesión de Google activa para realizar la copia de seguridad.');
        return null;
      }

      setIsBackingUp(true);
      setError(null);

      try {
        const record = await executeGoogleDriveBackup(
          currentToken,
          origen,
          user?.email || undefined
        );

        setUltimoBackup(record);
        setHistorialBackups((prev) => [record, ...prev.filter((b) => b.id !== record.id)].slice(0, 40));

        if (record.carpetaId) {
          setCarpetaDriveId(record.carpetaId);
          setCarpetaDriveUrl(`https://drive.google.com/drive/folders/${record.carpetaId}`);
        }

        // Subida automática de fotos en segundo plano DESACTIVADA por petición del usuario (ahora es manual)
        // syncAllPhotosToGoogleDrive(currentToken).catch(() => {});

        return record;
      } catch (err: any) {
        const isAuthOrNetError =
          err?.message?.includes('invalid authentication credentials') ||
          err?.message?.includes('401') ||
          err?.message?.includes('UNAUTHENTICATED') ||
          err?.message?.includes('Invalid Credentials') ||
          err?.message?.includes('Failed to fetch') ||
          err?.message?.includes('NetworkError');

        if (isAuthOrNetError) {
          console.warn('[Google Drive] Credenciales de Google Drive no disponibles o expiradas:', err?.message);
          clearSessionToken();
          setAccessToken(null);
          setUser(null);
          setProximoBackupTimestamp(null);
          proximoBackupRef.current = null;
          setError('La sesión de Google Drive ha expirado. Por favor conecta tu cuenta si deseas sincronizar un respaldo en Google Drive.');
        } else {
          console.warn('Advertencia durante la copia de seguridad en Google Drive:', err?.message || err);
          setError(err.message || 'Error al guardar la copia en Google Drive');
        }
        return null;
      } finally {
        setIsBackingUp(false);
      }
    },
    [accessToken, user]
  );

  // Iniciar sesión con Google Drive
  const handleSignIn = async () => {
    setIsAuthenticating(true);
    setError(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setAccessToken(res.accessToken);

        // Al iniciar sesión por primera vez o reconectar, verificar si corresponde hacer backup
        const folder = await getOrCreateBackupFolder(res.accessToken);
        setCarpetaDriveId(folder.id);
        setCarpetaDriveUrl(folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`);

        // Si nunca se ha hecho o pasaron más de 10 minutos, ejecutar inmediatamente
        const lastBackupTime = ultimoBackup ? new Date(ultimoBackup.timestamp).getTime() : 0;
        if (Date.now() - lastBackupTime >= BACKUP_INTERVAL_MS) {
          ejecutarCopia('Automatico_10m');
        } else {
          setProximoBackupTimestamp(lastBackupTime + BACKUP_INTERVAL_MS);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Error autenticando con Google');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Cerrar sesión
  const handleSignOut = async () => {
    try {
      await logoutGoogle();
      setUser(null);
      setAccessToken(null);
      setProximoBackupTimestamp(null);
      setTiempoRestanteStr('--:--:--');
    } catch (err) {
      console.warn('Error al cerrar sesión de Google:', err);
    }
  };

  // Activar o pausar el auto backup
  const handleToggleAuto = async (activo: boolean) => {
    setAutoBackupActivo(activo);
    try {
      await fetch('/api/admin/google-drive/toggle-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo }),
      });
    } catch (err) {
      console.warn('Error guardando configuración de auto backup:', err);
    }
  };

  // Guardar referencia mutable de ejecutarCopia para no recrear el temporizador
  const ejecutarCopiaRef = useRef(ejecutarCopia);
  ejecutarCopiaRef.current = ejecutarCopia;

  // Bucle de cuenta regresiva y verificación de 10 minutos
  useEffect(() => {
    if (!user || !accessToken || !autoBackupActivo) {
      setTiempoRestanteStr((prev) => (prev === '--:--:--' ? prev : '--:--:--'));
      return;
    }

    const intervalId = setInterval(() => {
      const now = Date.now();

      // Si no tenemos timestamp próximo programado, lo fijamos a 10 minutos desde el último o desde ahora
      let target = proximoBackupRef.current;
      if (!target) {
        const lastTime = ultimoBackupRef.current ? new Date(ultimoBackupRef.current.timestamp).getTime() : 0;
        target = lastTime > 0 ? lastTime + BACKUP_INTERVAL_MS : now;
        proximoBackupRef.current = target;
        setProximoBackupTimestamp(target);
      }

      const diff = target - now;

      if (diff <= 0) {
        // ¡Han pasado las 10 minutos! Programar preventivamente el siguiente ciclo y ejecutar
        const nextCycle = now + BACKUP_INTERVAL_MS;
        proximoBackupRef.current = nextCycle;
        setProximoBackupTimestamp(nextCycle);
        if (!isBackingUpRef.current) {
          ejecutarCopiaRef.current('Automatico_10m');
        }
      } else {
        // Formatear cuenta regresiva hh:mm:ss
        const totalSeconds = Math.floor(diff / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const pad = (n: number) => n.toString().padStart(2, '0');
        const formatted = `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
        setTiempoRestanteStr((prev) => (prev === formatted ? prev : formatted));
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [Boolean(user), Boolean(accessToken), autoBackupActivo]);

  // Ejecutar purga de copias mayores a 1 semana (7 días)
  const ejecutarPurga = useCallback(
    async (dias: number = 7): Promise<PurgeBackupsResult | null> => {
      const currentToken = accessToken || (await getAccessToken());
      if (!currentToken) {
        setError('No hay sesión de Google activa para realizar la depuración.');
        return null;
      }
      setIsPurging(true);
      setError(null);
      try {
        const result = await purgeOldBackupsFromGoogleDrive(currentToken, carpetaDriveId || undefined, dias);
        await fetchServerBackupStatus();
        return result;
      } catch (err: any) {
        console.warn('Aviso purgando copias mayores a 1 semana en Drive:', err?.message || err);
        setError(err.message || 'Error al depurar copias antiguas en Google Drive');
        return null;
      } finally {
        setIsPurging(false);
      }
    },
    [accessToken, carpetaDriveId, fetchServerBackupStatus]
  );

  const handleRenovarToken = async () => {
    setIsAuthenticating(true);
    setError(null);
    try {
      const newToken = await refreshGoogleAccessToken();
      if (newToken) {
        setAccessToken(newToken);
        setHasRefreshTokenState(hasStoredRefreshToken());
        setTiempoHastaExpiracion(getExpirationText());
        return newToken;
      } else {
        setError('No se pudo renovar el token con el Refresh Token actual. Puede requerir reconexión.');
        return null;
      }
    } catch (err: any) {
      setError(err.message || 'Error renovando token');
      return null;
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleConectarOAuth2Offline = async () => {
    setIsAuthenticating(true);
    setError(null);
    try {
      const res = await connectGoogleOAuth2Offline();
      if (res.success && res.accessToken) {
        setAccessToken(res.accessToken);
        setHasRefreshTokenState(true);
        setTiempoHastaExpiracion(getExpirationText());
        return res;
      } else {
        setError(res.error || 'No se pudo completar la conexión offline');
        return res;
      }
    } catch (err: any) {
      setError(err.message || 'Error en conexión OAuth2');
      return { success: false, hasRefreshToken: false, error: err.message };
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleGuardarRefreshTokenManual = async (rawToken: string) => {
    setIsAuthenticating(true);
    setError(null);
    try {
      const ok = await saveManualRefreshToken(rawToken);
      if (ok) {
        setHasRefreshTokenState(true);
        setTiempoHastaExpiracion(getExpirationText());
        const tok = await getAccessToken();
        setAccessToken(tok);
        return true;
      } else {
        setError('El Refresh Token ingresado no es válido o fue rechazado por Google.');
        return false;
      }
    } catch (err: any) {
      setError(err.message || 'Error guardando refresh token');
      return false;
    } finally {
      setIsAuthenticating(false);
    }
  };

  return {
    user,
    accessToken,
    isAuthenticated: !!user && !!accessToken,
    isAuthenticating,
    isBackingUp,
    isPurging,
    hasRefreshToken: hasRefreshTokenState,
    tiempoHastaExpiracion,
    ultimoBackup,
    historialBackups,
    proximoBackupTimestamp,
    tiempoRestanteStr,
    error,
    carpetaDriveId,
    carpetaDriveUrl,
    autoBackupActivo,
    diasRetencion: 7,
    ultimoPurgeDrive,
    ejecutarCopia,
    ejecutarPurga,
    signIn: handleSignIn,
    signOut: handleSignOut,
    toggleAutoBackup: handleToggleAuto,
    refreshStatus: fetchServerBackupStatus,
    renovarToken: handleRenovarToken,
    conectarOAuth2Offline: handleConectarOAuth2Offline,
    guardarRefreshTokenManual: handleGuardarRefreshTokenManual,
  };
}
