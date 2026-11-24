import fs from 'fs';
import path from 'path';

export type ErrorSeverity = 'CRITICO' | 'ALTO' | 'MEDIO' | 'INFORMATIVO';
export type ErrorCategory =
  | 'FOTOS_S3'
  | 'CUENTAS_COBRO'
  | 'AUTENTICACION'
  | 'CAMARA_GPS'
  | 'OFFLINE_SYNC'
  | 'BASE_DATOS'
  | 'GENERAL';

export interface PlatformErrorCatalogItem {
  code: string;
  category: ErrorCategory;
  name: string;
  severity: ErrorSeverity;
  userFriendlyMessage: string;
  technicalCause: string;
  resolutionSteps: string[];
}

export interface PlatformErrorLog {
  id: string;
  timestamp: string;
  errorCode: string;
  errorName: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  source: 'expendio' | 'admin' | 'servidor' | 'cliente';
  expendioId?: string;
  municipio?: string;
  cedula?: string;
  userMessage: string;
  technicalDetails: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
}

/**
 * Catálogo Oficial Completo de Errores que la Plataforma puede generar.
 * Guía de referencia técnica para administradores y soporte.
 */
export const PLATFORM_ERROR_CATALOG: PlatformErrorCatalogItem[] = [
  {
    code: 'PHOTO_UPLOAD_FAILED',
    category: 'FOTOS_S3',
    name: 'Fallo en Carga de Fotografía',
    severity: 'ALTO',
    userFriendlyMessage: 'No se pudo guardar la fotografía en el servidor. Por favor verifica tu conexión a internet e intenta tomarla nuevamente.',
    technicalCause: 'Fallo en la petición HTTP POST /api/photos/upload-hybrid, interrupción de red móvil durante el streaming multipart o rechazo del socket.',
    resolutionSteps: [
      'Verificar que el expendio tenga conexión a datos móviles estable.',
      'Comprobar el estado del almacenamiento en disco local del servidor y credenciales AWS S3.',
      'Pedir al usuario que intente nuevamente desde una zona con mejor señal 4G/WiFi.'
    ]
  },
  {
    code: 'PHOTO_S3_STORAGE_UNREACHABLE',
    category: 'FOTOS_S3',
    name: 'Almacenamiento AWS S3 Inaccesible',
    severity: 'CRITICO',
    userFriendlyMessage: 'Tu fotografía se guardó de forma segura en tu teléfono y en el servidor local. La copia en la nube se sincronizará automáticamente más tarde.',
    technicalCause: 'El bucket de AWS S3 devolvió 403 Forbidden, 500 SlowDown, o las credenciales IAM expiraron / tienen políticas restrictivas.',
    resolutionSteps: [
      'Revisar el panel de diagnóstico AWS S3 en el Administrador para verificar credenciales IAM.',
      'Asegurarse de que el bucket camarca-expendios-photos-contingency esté activo en us-east-1.',
      'Comprobar que la bóveda secundaria en disco local y Firebase Storage mantengan las fotos respaldadas.'
    ]
  },
  {
    code: 'PHOTO_FORMAT_INVALID',
    category: 'FOTOS_S3',
    name: 'Formato o Tamaño de Fotografía Inválido',
    severity: 'MEDIO',
    userFriendlyMessage: 'El archivo seleccionado no es una imagen válida o es demasiado pesado. Utiliza la cámara directamente.',
    technicalCause: 'El archivo enviado no cumple el tipo MIME image/jpeg, image/png o excede el límite de 20MB por archivo.',
    resolutionSteps: [
      'Asegurarse de que el contratista use la opción de tomar foto con la cámara nativa.',
      'Verificar que la compresión del cliente en HTML5 Canvas esté activa antes de enviar el buffer.'
    ]
  },
  {
    code: 'PHOTO_CROSS_CONTAMINATION_PREVENTED',
    category: 'FOTOS_S3',
    name: 'Discrepancia de Expendio Detectada y Corregida',
    severity: 'INFORMATIVO',
    userFriendlyMessage: 'Se actualizaron las fotografías de tu punto para asegurar que correspondan exactamente a tu municipio.',
    technicalCause: 'El verificador de integridad detectó una clave de foto en caché del navegador que no coincidía con el ID o cédula del expendio activo.',
    resolutionSteps: [
      'El sistema purga automáticamente la caché local y descarga la foto oficial directa del servidor.',
      'No requiere intervención manual a menos que el municipio continúe reportando fotos incorrectas.'
    ]
  },
  {
    code: 'GPS_PERMISSION_DENIED',
    category: 'CAMARA_GPS',
    name: 'Permiso de Ubicación GPS Denegado',
    severity: 'MEDIO',
    userFriendlyMessage: 'Para tomar las fotos oficiales es necesario activar el permiso de ubicación en tu navegador para estampar las coordenadas.',
    technicalCause: 'El navegador del dispositivo móvil bloqueó la API navigator.geolocation.getCurrentPosition por denegación del usuario o falta de permisos en Chrome/Safari.',
    resolutionSteps: [
      'Indicar al encargado abrir la configuración del navegador (ícono del candado en la barra de URL) y permitir "Ubicación".',
      'Verificar que el GPS del celular esté encendido en modo "Alta Precisión".'
    ]
  },
  {
    code: 'GPS_TIMEOUT',
    category: 'CAMARA_GPS',
    name: 'Tiempo de Espera GPS Agotado',
    severity: 'MEDIO',
    userFriendlyMessage: 'El satélite GPS tardó demasiado en responder. Asegúrate de estar bajo cielo abierto e inténtalo de nuevo.',
    technicalCause: 'navigator.geolocation excedió el tiempo límite (timeout de 15 segundos) debido a baja visibilidad satelital en interiores.',
    resolutionSteps: [
      'Salir a la puerta o fachada del expendio para capturar mejor señal satelital.',
      'Reiniciar el GPS del teléfono o esperar unos segundos antes de abrir la cámara.'
    ]
  },
  {
    code: 'CUENTA_COBRO_PERIOD_DISABLED',
    category: 'CUENTAS_COBRO',
    name: 'Periodo de Cobro No Habilitado',
    severity: 'MEDIO',
    userFriendlyMessage: 'La descarga de cuentas de cobro para este mes aún no ha sido habilitada por el área administrativa.',
    technicalCause: 'El administrador aún no ha autorizado el periodo del mes actual en la configuración del sistema.',
    resolutionSteps: [
      'Ir a la pestaña "Cuentas de Cobro" en el Panel Administrador.',
      'Verificar el bloque "Control de Periodo Oficial Habilitado" y activar el mes deseado.'
    ]
  },
  {
    code: 'CUENTA_COBRO_PDF_GENERATION_FAILED',
    category: 'CUENTAS_COBRO',
    name: 'Error Generando PDF de Cuenta de Cobro',
    severity: 'ALTO',
    userFriendlyMessage: 'Ocurrió una dificultad al generar el documento PDF. Por favor reintenta en unos instantes o avisa a administración.',
    technicalCause: 'Fallo en pdf-lib o jsPDF durante la renderización de fuentes, caracteres especiales en el nombre o conversión de números a letras.',
    resolutionSteps: [
      'Revisar que los datos del expendio (encargado, valor mensual, cédula) no contengan caracteres corruptos.',
      'Probar la descarga individual de la cuenta desde el panel de Administrador.'
    ]
  },
  {
    code: 'OCR_RECONCILIATION_MISMATCH',
    category: 'CUENTAS_COBRO',
    name: 'Discrepancia en Escaneo OCR con IA',
    severity: 'MEDIO',
    userFriendlyMessage: 'La imagen de la cuenta de cobro firmada fue recibida, pero algunos valores no coinciden exactamente con la planilla oficial. La administración la revisará manualmente.',
    technicalCause: 'El modelo OCR/Gemini detectó un valor a cancelar, periodo o cédula en la imagen escaneada que difiere de la base de datos.',
    resolutionSteps: [
      'Abrir el modal de Conciliación con IA en el panel del Administrador.',
      'Revisar la imagen original subida por el contratista y aprobar o rechazar con observaciones.'
    ]
  },
  {
    code: 'DATABASE_WRITE_LOCKED',
    category: 'BASE_DATOS',
    name: 'Bloqueo Concurrente de Base de Datos',
    severity: 'ALTO',
    userFriendlyMessage: 'El sistema está procesando múltiples solicitudes simultáneas. Tu solicitud se reintentará automáticamente.',
    technicalCause: 'Mutex de escritura en mutateDatabase activo por concurrencia de importación masiva o sincronización de fotos.',
    resolutionSteps: [
      'El motor de persistencia reintenta automáticamente con backoff exponencial.',
      'Si persiste, verificar uso de CPU y memoria en el servidor.'
    ]
  },
  {
    code: 'OFFLINE_SYNC_RETRY_EXHAUSTED',
    category: 'OFFLINE_SYNC',
    name: 'Sincronización Fuera de Línea Pendiente',
    severity: 'MEDIO',
    userFriendlyMessage: 'Tienes fotos pendientes por subir debido a intermitencia en tu internet. Se subirán automáticamente cuando tu señal se restablezca.',
    technicalCause: 'La cola de sincronización en Dexie / IndexedDB no ha podido contactar el servidor tras varios ciclos.',
    resolutionSteps: [
      'El contratista no debe borrar los datos de navegación ni el historial de Chrome.',
      'Una vez que tenga señal WiFi o 4G estable, pulsar el botón "Sincronizar Fotos Pendientes".'
    ]
  },
  {
    code: 'AUTH_INVALID_CREDENTIALS',
    category: 'AUTENTICACION',
    name: 'Credenciales Inválidas de Ingreso',
    severity: 'MEDIO',
    userFriendlyMessage: 'El número de identificación ingresado no se encuentra registrado en el sistema de expendios activos.',
    technicalCause: 'La cédula enviada a /api/auth/login no tiene correspondencia en db.expendios o está inhabilitada.',
    resolutionSteps: [
      'Verificar que el contratista esté registrado en la lista maestra de 178 expendios.',
      'Confirmar que su estado no sea "Inhabilitado".'
    ]
  },
  {
    code: 'AUTH_SESSION_EXPIRED',
    category: 'AUTENTICACION',
    name: 'Sesión Expirada o Token Inválido',
    severity: 'MEDIO',
    userFriendlyMessage: 'Tu sesión ha finalizado por seguridad. Por favor ingresa nuevamente con tu número de identificación.',
    technicalCause: 'El token HMAC-SHA256 en cookie o Authorization expiró (>30 días) o tiene una firma no coincidente.',
    resolutionSteps: [
      'Pedir al usuario volver a escribir su cédula en la pantalla de bienvenida para renovar el token de sesión.'
    ]
  },
  {
    code: 'DUPLICATE_CEDULA_INCONSISTENCY',
    category: 'AUTENTICACION',
    name: 'Cédula Asignada a Múltiples Municipios',
    severity: 'CRITICO',
    userFriendlyMessage: 'Tu número de cédula aparece asignado a más de un punto de atención. Por seguridad de tus pagos, contacta a la administración para validar tu asignación.',
    technicalCause: 'Violación de unicidad en db.expendios: la misma cédula está presente en 2 o más registros activos distintos.',
    resolutionSteps: [
      'Ingresar al panel de Administrador -> Maestro de Expendios.',
      'Buscar la cédula y corregir el encargado o inhabilitar el punto antiguo.'
    ]
  },
  {
    code: 'GOOGLE_DRIVE_DISCONNECTED',
    category: 'GENERAL',
    name: 'Conexión con Google Drive Expirada',
    severity: 'MEDIO',
    userFriendlyMessage: 'El respaldo secundario en Google Drive requiere renovación de permisos.',
    technicalCause: 'El token OAuth2 de Google Drive fue revocado o expiró la sesión de Google.',
    resolutionSteps: [
      'El Administrador debe pulsar "Conectar Google Drive" en la barra superior o en el modal de Copia de Seguridad para reautenticarse.'
    ]
  },
  {
    code: 'STORAGE_QUOTA_EXCEEDED',
    category: 'BASE_DATOS',
    name: 'Cuota de Almacenamiento Alcanzada',
    severity: 'CRITICO',
    userFriendlyMessage: 'El almacenamiento en la nube está temporalmente al límite. La información se encuentra protegida localmente en el servidor.',
    technicalCause: 'Límite de cuota alcanzado en el proveedor de nube.',
    resolutionSteps: [
      'Revisar las métricas de uso en el panel S3 / Firebase.',
      'Liberar archivos antiguos o ampliar la cuota del bucket.'
    ]
  }
];

const DATA_DIR = path.join(process.cwd(), 'data');
const LOGS_FILE = path.join(DATA_DIR, 'system_error_logs.json');
const MAX_STORED_LOGS = 500;

class ErrorLogService {
  private logs: PlatformErrorLog[] = [];

  constructor() {
    this.ensureDataDir();
    this.loadLogsFromDisk();
  }

  private ensureDataDir() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch (e: any) {
      console.warn('[ErrorLogService] Error creando carpeta data:', e.message);
    }
  }

  private loadLogsFromDisk() {
    try {
      if (fs.existsSync(LOGS_FILE)) {
        const raw = fs.readFileSync(LOGS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.logs = parsed;
        }
      }
    } catch (e: any) {
      console.warn('[ErrorLogService] Error cargando logs:', e.message);
      this.logs = [];
    }
  }

  private persistLogsToDisk() {
    try {
      this.ensureDataDir();
      fs.writeFileSync(LOGS_FILE, JSON.stringify(this.logs, null, 2), 'utf-8');
    } catch (e: any) {
      console.warn('[ErrorLogService] Error persistiendo logs a disco:', e.message);
    }
  }

  public logError(params: {
    errorCode: string;
    source?: PlatformErrorLog['source'];
    expendioId?: string;
    municipio?: string;
    cedula?: string;
    userMessage?: string;
    technicalDetails?: string;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
  }): PlatformErrorLog {
    const catalogItem = PLATFORM_ERROR_CATALOG.find((item) => item.code === params.errorCode);
    const category: ErrorCategory = params.category || catalogItem?.category || 'GENERAL';
    const severity: ErrorSeverity = params.severity || catalogItem?.severity || 'MEDIO';
    const errorName = catalogItem?.name || params.errorCode;
    const userMessage =
      params.userMessage || catalogItem?.userFriendlyMessage || 'Ocurrió una novedad en el sistema. Por favor reintenta.';

    const newLog: PlatformErrorLog = {
      id: `ERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      errorCode: params.errorCode,
      errorName,
      category,
      severity,
      source: params.source || 'expendio',
      expendioId: params.expendioId,
      municipio: params.municipio,
      cedula: params.cedula,
      userMessage,
      technicalDetails: params.technicalDetails || 'Sin detalles técnicos adicionales provistos.',
      resolved: false,
    };

    this.logs.unshift(newLog);

    // Limitar tamaño en memoria y disco
    if (this.logs.length > MAX_STORED_LOGS) {
      this.logs = this.logs.slice(0, MAX_STORED_LOGS);
    }

    this.persistLogsToDisk();
    return newLog;
  }

  public getLogs(limit = 150): PlatformErrorLog[] {
    return this.logs.slice(0, limit);
  }

  public markAsResolved(id: string, resolvedBy = 'Administrador'): boolean {
    const item = this.logs.find((l) => l.id === id);
    if (item) {
      item.resolved = true;
      item.resolvedAt = new Date().toISOString();
      item.resolvedBy = resolvedBy;
      this.persistLogsToDisk();
      return true;
    }
    return false;
  }

  public clearLogs(): void {
    this.logs = [];
    this.persistLogsToDisk();
  }

  public getCatalog(): PlatformErrorCatalogItem[] {
    return PLATFORM_ERROR_CATALOG;
  }

  public getStats() {
    const total = this.logs.length;
    const resolved = this.logs.filter((l) => l.resolved).length;
    const pending = total - resolved;
    const critical = this.logs.filter((l) => !l.resolved && l.severity === 'CRITICO').length;
    const high = this.logs.filter((l) => !l.resolved && l.severity === 'ALTO').length;

    return {
      total,
      resolved,
      pending,
      critical,
      high,
    };
  }
}

export const errorLogService = new ErrorLogService();
