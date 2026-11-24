import Dexie, { Table } from 'dexie';

/**
 * Registro estructurado de error en IndexedDB del cliente
 */
export interface ClientStoredErrorRecord {
  id?: number;
  uuid: string;
  timestamp: string;
  timeEpoch: number;
  errorCode: string;
  errorName?: string;
  severity: 'CRITICO' | 'ALTO' | 'MEDIO' | 'INFORMATIVO';
  category: 'FOTOS_S3' | 'CUENTAS_COBRO' | 'AUTENTICACION' | 'CAMARA_GPS' | 'OFFLINE_SYNC' | 'BASE_DATOS' | 'GENERAL' | 'RENDER_CRASH' | 'UNHANDLED_EXCEPTION';
  userMessage: string;
  technicalDetails: string;
  stackTrace?: string;
  componentStack?: string;
  url: string;
  userAgent: string;
  expendioId?: string;
  municipio?: string;
  cedula?: string;
  source: 'react-boundary' | 'window-error' | 'unhandled-rejection' | 'expendio-app' | 'manual';
  syncedToServer: boolean;
  resolved: boolean;
}

export interface LogClientExceptionOptions {
  error?: Error | unknown;
  errorCode?: string;
  errorName?: string;
  userMessage?: string;
  technicalDetails?: string;
  componentStack?: string;
  category?: ClientStoredErrorRecord['category'];
  severity?: ClientStoredErrorRecord['severity'];
  source?: ClientStoredErrorRecord['source'];
  expendio?: {
    id?: string;
    municipio?: string;
    cedula?: string;
  } | null;
}

/**
 * Base de datos IndexedDB dedicada exclusivamente al registro de excepciones y diagnósticos locales
 */
export class CamarcaClientErrorDatabase extends Dexie {
  clientErrorLogs!: Table<ClientStoredErrorRecord, number>;

  constructor() {
    super('CamarcaClientErrorDB');
    this.version(1).stores({
      clientErrorLogs: '++id, uuid, timestamp, timeEpoch, errorCode, severity, category, source, syncedToServer, resolved',
    });
  }
}

export const clientErrorDB = new CamarcaClientErrorDatabase();

// Mensajes amigables por defecto según el tipo de excepción para evitar mostrar jerga técnica
const DEFAULT_FRIENDLY_MESSAGES: Record<string, string> = {
  REACT_RENDER_CRASH: 'Se presentó una novedad temporal al cargar este componente. La información técnica fue guardada para soporte.',
  UNHANDLED_REJECTION: 'Una operación en segundo plano no pudo completarse debido a intermitencia en la red.',
  WINDOW_RUNTIME_ERROR: 'Ocurrió un evento inesperado en la interfaz. El estado local se mantiene protegido.',
  PHOTO_UPLOAD_FAILED: 'No se pudo subir la fotografía. Tu imagen se encuentra guardada en la memoria de tu dispositivo.',
  PHOTO_S3_STORAGE_UNREACHABLE: 'El almacenamiento en la nube no respondió a tiempo. Se activó el respaldo local.',
  PHOTO_FORMAT_INVALID: 'El formato de archivo no es soportado. Por favor toma la foto directamente con la cámara.',
  PHOTO_CROSS_CONTAMINATION_PREVENTED: 'Se verificó la autenticidad de las imágenes asignadas a tu expendio.',
  GPS_PERMISSION_DENIED: 'Se requiere permiso de ubicación en el navegador para registrar las coordenadas del expendio.',
  GPS_TIMEOUT: 'La señal GPS tardó demasiado en responder. Por favor reintenta con cielo despejado.',
  CUENTA_COBRO_PERIOD_DISABLED: 'La consulta de cuentas de cobro aún no está habilitada para este periodo.',
  CUENTA_COBRO_PDF_GENERATION_FAILED: 'Dificultad temporal al generar el documento PDF. Por favor reintenta en unos instantes.',
  AUTH_SESSION_EXPIRED: 'Tu sesión ha finalizado. Por favor ingresa nuevamente tus credenciales.',
};

let isLoggingRecursionGuard = false;

/**
 * Extrae contexto del expendio activo desde el almacenamiento local si no fue provisto
 */
function getActiveExpendioContext(): { id?: string; municipio?: string; cedula?: string } {
  try {
    const sessionStr = localStorage.getItem('camarca_session') || sessionStorage.getItem('camarca_session');
    if (sessionStr) {
      const parsed = JSON.parse(sessionStr);
      return {
        id: parsed?.expendioData?.id || parsed?.id,
        municipio: parsed?.expendioData?.municipio || parsed?.municipio,
        cedula: parsed?.cedulaOrNit || parsed?.cedula,
      };
    }
  } catch {}
  return {};
}

/**
 * Registra una excepción crítica en la base de datos IndexedDB local
 * y despacha sincronización en segundo plano al servidor.
 */
export async function logCriticalClientException(
  options: LogClientExceptionOptions
): Promise<{ id: number; uuid: string; userMessage: string }> {
  if (isLoggingRecursionGuard) {
    return { id: 0, uuid: '', userMessage: 'Error registrado internamente.' };
  }

  isLoggingRecursionGuard = true;

  try {
    const err = options.error as any;
    const errorCode = options.errorCode || (err?.code ? String(err.code) : 'CLIENT_UNSPECIFIED_EXCEPTION');
    const errorName = options.errorName || err?.name || 'Error';
    const rawErrorMessage = err?.message || (typeof err === 'string' ? err : 'Excepción crítica no descripta');
    const stackTrace = err?.stack || (typeof err === 'object' && err !== null ? JSON.stringify(err) : undefined);

    const userMessage =
      options.userMessage ||
      DEFAULT_FRIENDLY_MESSAGES[errorCode] ||
      'Se presentó una novedad temporal en la plataforma. Tus datos están a salvo y el equipo técnico revisará el registro.';

    const technicalDetails =
      options.technicalDetails ||
      `Mensaje: ${rawErrorMessage}\nCódigo: ${errorCode}\nNombre: ${errorName}\nURL: ${typeof window !== 'undefined' ? window.location.href : 'N/A'}`;

    const expContext = options.expendio || getActiveExpendioContext();

    const uuid = `err-client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date();

    const record: ClientStoredErrorRecord = {
      uuid,
      timestamp: now.toISOString(),
      timeEpoch: now.getTime(),
      errorCode,
      errorName,
      severity: options.severity || (errorCode.includes('CRASH') || errorCode.includes('FATAL') ? 'CRITICO' : 'ALTO'),
      category: options.category || (errorCode.includes('RENDER') ? 'RENDER_CRASH' : 'GENERAL'),
      userMessage,
      technicalDetails,
      stackTrace,
      componentStack: options.componentStack,
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      expendioId: expContext.id,
      municipio: expContext.municipio,
      cedula: expContext.cedula,
      source: options.source || 'manual',
      syncedToServer: false,
      resolved: false,
    };

    // 1. Guardar en IndexedDB
    const insertedId = await clientErrorDB.clientErrorLogs.add(record);
    record.id = insertedId;

    // 2. Disparar evento para componentes observadores (ej: Modal de diagnóstico)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('camarca_client_error_logged', {
          detail: record,
        })
      );
    }

    // 3. Intentar sincronización asíncrona al backend si hay conectividad
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      syncSingleErrorToServer(record).catch(() => {
        // Fallo de red silencioso; el registro ya está seguro en IndexedDB
      });
    }

    return { id: insertedId, uuid, userMessage };
  } catch (dbErr) {
    console.warn('[clientErrorStorageDB] Falló escritura en IndexedDB:', dbErr);
    return {
      id: 0,
      uuid: '',
      userMessage: options.userMessage || 'Novedad temporal registrada en el dispositivo.',
    };
  } finally {
    isLoggingRecursionGuard = false;
  }
}

/**
 * Envía un error a /api/error-log y actualiza su estado en IndexedDB
 */
async function syncSingleErrorToServer(record: ClientStoredErrorRecord): Promise<boolean> {
  if (!record.id) return false;

  try {
    const res = await fetch('/api/error-log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        errorCode: record.errorCode,
        source: `client-${record.source}`,
        expendioId: record.expendioId,
        municipio: record.municipio,
        cedula: record.cedula,
        userMessage: record.userMessage,
        technicalDetails: `${record.technicalDetails}\n[Stack]\n${record.stackTrace || 'Sin stack'}\n[ComponentStack]\n${record.componentStack || 'N/A'}\n[UUID]: ${record.uuid}`,
        category: record.category === 'RENDER_CRASH' ? 'GENERAL' : record.category,
        severity: record.severity,
      }),
    });

    if (res.ok) {
      await clientErrorDB.clientErrorLogs.update(record.id, {
        syncedToServer: true,
      });
      return true;
    }
  } catch {
    // Red no disponible
  }
  return false;
}

/**
 * Sincroniza todos los errores pendientes almacenados en IndexedDB hacia el servidor
 */
export async function syncPendingErrorsToServer(): Promise<{ total: number; synced: number }> {
  try {
    const pending = await clientErrorDB.clientErrorLogs
      .where('syncedToServer')
      .equals(0) // en IndexedDB boolean false o 0
      .or('syncedToServer')
      .equals(false as any)
      .toArray();

    let count = 0;
    for (const record of pending) {
      const ok = await syncSingleErrorToServer(record);
      if (ok) count++;
    }

    return { total: pending.length, synced: count };
  } catch (e) {
    console.warn('[clientErrorStorageDB] Error sincronizando pendientes:', e);
    return { total: 0, synced: 0 };
  }
}

/**
 * Obtiene lista de errores guardados en IndexedDB
 */
export async function getClientStoredErrors(limit = 100): Promise<ClientStoredErrorRecord[]> {
  try {
    return await clientErrorDB.clientErrorLogs
      .orderBy('timeEpoch')
      .reverse()
      .limit(limit)
      .toArray();
  } catch (err) {
    console.error('[clientErrorStorageDB] Error leyendo logs de IndexedDB:', err);
    return [];
  }
}

/**
 * Vacia los registros de error en IndexedDB
 */
export async function clearClientStoredErrors(): Promise<void> {
  try {
    await clientErrorDB.clientErrorLogs.clear();
  } catch (err) {
    console.error('[clientErrorStorageDB] Error vaciando IndexedDB:', err);
  }
}

/**
 * Elimina un registro específico por ID de IndexedDB
 */
export async function deleteClientStoredError(id: number): Promise<void> {
  try {
    await clientErrorDB.clientErrorLogs.delete(id);
  } catch (err) {
    console.error('[clientErrorStorageDB] Error eliminando registro:', err);
  }
}

/**
 * Inicializa manejadores globales de error en la ventana (window.error y unhandledrejection)
 * para interceptar cualquier fallo crítico no controlado y almacenarlo en IndexedDB sin alarmar la interfaz.
 */
let handlersInitialized = false;

export function initGlobalErrorHandlers(): void {
  if (handlersInitialized || typeof window === 'undefined') return;
  handlersInitialized = true;

  // 1. Interceptar excepciones síncronas o no capturadas de scripts
  window.addEventListener('error', (event: ErrorEvent) => {
    // Ignorar errores de extensiones externas del navegador
    if (event.filename && (event.filename.includes('chrome-extension://') || event.filename.includes('moz-extension://'))) {
      return;
    }

    logCriticalClientException({
      error: event.error || new Error(event.message || 'Excepción en ventana'),
      errorCode: 'WINDOW_RUNTIME_ERROR',
      errorName: event.error?.name || 'ErrorDeEjecucion',
      technicalDetails: `Error: ${event.message}\nArchivo: ${event.filename}:${event.lineno}:${event.colno}`,
      category: 'UNHANDLED_EXCEPTION',
      severity: 'CRITICO',
      source: 'window-error',
    }).catch(() => {});
  });

  // 2. Interceptar rechazos de promesas no controladas (unhandledrejection)
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const msg = reason?.message || String(reason || 'Rechazo de promesa asíncrona no controlado');

    // Ignorar cancelaciones de red estándar o abortos intencionales
    if (msg.includes('AbortError') || msg.includes('aborted')) {
      return;
    }

    logCriticalClientException({
      error: reason instanceof Error ? reason : new Error(msg),
      errorCode: 'UNHANDLED_REJECTION',
      errorName: reason?.name || 'UnhandledPromiseRejection',
      technicalDetails: `Promesa rechazada no capturada: ${msg}\n${reason?.stack || ''}`,
      category: 'UNHANDLED_EXCEPTION',
      severity: 'ALTO',
      source: 'unhandled-rejection',
    }).catch(() => {});
  });

  // 3. Sincronización automática de logs pendientes cuando vuelva la conexión
  window.addEventListener('online', () => {
    syncPendingErrorsToServer().catch(() => {});
  });
}
