import { logCriticalClientException } from '../lib/clientErrorStorageDB';

/**
 * Utilidad de registro y reporte de errores en la plataforma.
 * Permite capturar errores en el cliente, registrarlos en el backend de forma asíncrona
 * y presentar al usuario un mensaje humano y comprensible sin jerga técnica.
 */

export interface ReportErrorOptions {
  errorCode: string;
  userMessage?: string;
  technicalDetails?: string;
  expendio?: {
    id?: string;
    municipio?: string;
    cedula?: string;
  } | null;
  category?: 'FOTOS_S3' | 'CUENTAS_COBRO' | 'AUTENTICACION' | 'CAMARA_GPS' | 'OFFLINE_SYNC' | 'BASE_DATOS' | 'GENERAL';
  severity?: 'CRITICO' | 'ALTO' | 'MEDIO' | 'INFORMATIVO';
}

const FRIENDLY_ERROR_FALLBACKS: Record<string, string> = {
  PHOTO_UPLOAD_FAILED: 'No se pudo guardar la fotografía en el servidor. Por favor verifica tu conexión a internet e intenta tomarla nuevamente.',
  PHOTO_S3_STORAGE_UNREACHABLE: 'Tu fotografía se guardó en tu dispositivo móvil. El respaldo en la nube se sincronizará cuando haya mejor conexión.',
  PHOTO_FORMAT_INVALID: 'El archivo seleccionado no es una imagen válida o es muy pesado. Por favor toma la foto directamente con la cámara.',
  PHOTO_CROSS_CONTAMINATION_PREVENTED: 'Se verificaron tus fotografías para asegurar que correspondan exactamente a tu punto de atención.',
  GPS_PERMISSION_DENIED: 'Para estampar las coordenadas oficiales en las fotos, por favor autoriza el permiso de ubicación en tu navegador.',
  GPS_TIMEOUT: 'La señal GPS tardó en responder. Por favor acércate a la puerta o fachada del punto e inténtalo de nuevo.',
  CUENTA_COBRO_PERIOD_DISABLED: 'La descarga de cuentas de cobro para este mes aún no ha sido habilitada por la administración.',
  CUENTA_COBRO_PDF_GENERATION_FAILED: 'Ocurrió una dificultad al generar el PDF. Por favor reintenta en unos instantes o avisa a administración.',
  OFFLINE_SYNC_RETRY_EXHAUSTED: 'Tienes fotos pendientes por subir debido a intermitencia en tu internet. Se subirán automáticamente al recuperar señal.',
  AUTH_SESSION_EXPIRED: 'Tu sesión ha finalizado por seguridad. Por favor ingresa nuevamente con tu cédula.',
};

export async function reportPlatformError(options: ReportErrorOptions): Promise<string> {
  const friendlyMsg =
    options.userMessage ||
    FRIENDLY_ERROR_FALLBACKS[options.errorCode] ||
    'Ocurrió una novedad temporal en la plataforma. Por favor reintenta en unos instantes.';

  try {
    // 1. Guardar de inmediato en la base de datos IndexedDB del cliente
    logCriticalClientException({
      errorCode: options.errorCode,
      userMessage: friendlyMsg,
      technicalDetails: options.technicalDetails || 'Error reportado desde la interfaz del expendio',
      expendio: options.expendio,
      category: options.category,
      severity: options.severity || 'ALTO',
      source: 'expendio-app',
    }).catch(() => {
      // Ignorar fallo de almacenamiento
    });

    // 2. Enviar de forma desacoplada al backend si está disponible
    fetch('/api/error-log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        errorCode: options.errorCode,
        source: 'expendio',
        expendioId: options.expendio?.id,
        municipio: options.expendio?.municipio,
        cedula: options.expendio?.cedula,
        userMessage: friendlyMsg,
        technicalDetails: options.technicalDetails || 'Error reportado desde la interfaz del expendio',
        category: options.category,
        severity: options.severity,
      }),
    }).catch(() => {
      // Ignorar fallo de red del logger para no crear cascada de errores
    });
  } catch {}

  return friendlyMsg;
}

