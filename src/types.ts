export interface ExpendioData {
  id: string;
  nombre?: string;
  nombreExpendio?: string;
  centroOperativo: string;
  centroAcopio: string;
  localidad: string;
  encargado: string;
  cedula: string;
  direccionPunto: string;
  telefonoPunto: string;
  
  // 7 Fotos oficiales requeridas
  fotoAvisoUrl?: string; // 1. Foto aviso
  fotoPanoramicaUrl?: string; // 2. Foto panorámica (fachada + aviso 4-72)
  fotoMataselloUrl?: string; // 3. Foto matasello
  fotoBasculaUrl?: string; // 4. Foto báscula
  fotoContratistaUrl?: string; // 5. Foto del contratista
  fotoHorarioUrl?: string; // 6. Foto horario
  fotoTarifasUrl?: string; // 7. Foto tarifas

  // Backward compatibility alias
  letreroUrl?: string;
  basculaUrl?: string;
  mataselloUrl?: string;
  computadorUrl?: string;
  fotoFachadaUrl?: string;
  fotoFirmaContratoUrl?: string;
  fotoCedulaFrontalUrl?: string;
  fotoCedulaPosteriorUrl?: string;
  fotoCedulaRespaldoUrl?: string;
  fotoRutUrl?: string;
  fotoCertificacionBancariaUrl?: string;

  usuarioSipost: string;
  internet: string;
  nit: string;
  correoElectronico: string;
  cuentaBancaria?: string;
  banco?: string;
  tipoCuenta?: string;
  tieneComputador?: "" | "SI" | "NO" | "N/A";
  motivoFaltaComputador?: string;
  regional?: string;
  observacion: string;
  municipio: string;
  valorMensual: number;
  admisionSipost?: number;
  valorVariable?: number;
  contratoUrl?: string;
  contratoPdfUrl?: string;
  estado?: 'Activo' | 'Inhabilitado' | 'Cambiado' | 'En Transición';
  fechaUltimaActualizacion?: string;
  primeraVezActualizado?: boolean;
  bienvenidaRealizada?: boolean;

  // Disponibilidad de ítems (SI / NO)
  tieneAviso?: 'SI' | 'NO' | '' | 'N/A';
  tieneBascula?: 'SI' | 'NO' | '' | 'N/A';
  tieneMatasello?: 'SI' | 'NO' | '' | 'N/A';
  motivoFaltaAviso?: string;
  motivoFaltaBascula?: string;
  motivoFaltaMatasello?: string;

  // Observaciones, comentarios o sugerencias del expendio
  observaciones?: string;
}

export interface CuentaCobroParams {
  aplicarGrossUp: boolean;
  modificarValorInicialRetencion: number;
  porcentajeRetencion: number;
  periodo: string;
}

export interface CuentaCobroResult {
  id: string;
  cedula: string;
  encargado: string;
  expendio: string;
  municipio: string;
  numeroConsecutivo?: number;
  totalPaginas?: number;
  centroOperativo?: string;
  centroAcopio?: string;
  regional?: string;
  funcion?: string;
  cargoBasico: number;
  admisionSipost: number;
  valorVariable: number;
  pagoTotal: number;
  retef1: number;
  valorNeto: number;
  valorEnLetras?: string;
  direccion?: string;
  telefono?: string;
  banco?: string;
  cuentaBancaria?: string;
  nitCamarca?: string;
  empresaCamarca?: string;
  fechaEmision?: string;
  periodo: string;
  inconsistenciaMatematica?: string;
  // legacy compatibility
  valorBase?: number;
  valorBruto?: number;
  porcentajeRetencion?: number;
  retencionValor?: number;
  grossUpAplicado?: boolean;
  // Account module properties
  porcentajeRetefuente?: number;
  retefuente?: number;
  porcentajeReteica?: number;
  reteica?: number;
  netoPagar?: number;
  nombre?: string;
  concepto?: string;
  fechaGeneracion?: string;
}

export interface TrazabilidadExpendio {
  id: string;
  municipio: string;
  localidad: string;
  tipoMovimiento?: 'CAMBIO_ENCARGADO' | 'RETIRO_INHABILITACION' | 'INGRESO_NUEVO' | 'REACTIVACION' | string;
  novedad?: string;
  
  // Encargado anterior / saliente
  encargadoAnterior?: string;
  cedulaAnterior?: string;
  fechaRetiro?: string; // e.g. "2026-07-15"
  
  // Encargado nuevo / entrante
  encargadoNuevo?: string;
  cedulaNuevo?: string;
  fechaIngreso?: string; // e.g. "2026-07-16"

  telefonoNuevo?: string;
  direccionNueva?: string;
  
  estadoPunto?: 'Activo' | 'Inhabilitado' | 'Cambiado' | 'En Transición' | string;
  motivo?: string;
  observaciones?: string;
  fechaRegistro: string;
  registradoPor?: string;
}

export interface HistorialItem {
  id: string;
  periodo: string;
  tipo: 'Cuenta de Cobro' | 'Trazabilidad' | 'Actualización' | 'Creación' | 'Eliminación' | string;
  encargado: string;
  cedula: string;
  expendio: string;
  monto: number;
  fecha: string;
  estado: 'Procesado' | 'Pendiente' | 'Aprobado' | 'Cancelado' | string;
  detalles?: string;
  cuentaData?: CuentaCobroResult;
  soporteUrl?: string;
  soporteFirmadoUrl?: string;
  cuentaCargadaId?: string;
  cuentaFirmadaCargada?: boolean;
  fechaCargueFirmada?: string;
  fechaCancelado?: string;
  conciliadoConIA?: boolean;
}

export interface ResultadoConciliacionAI {
  id: string;
  archivoNombre: string;
  archivoUrl: string;
  mimeType?: string;
  hojaNumero?: number;
  totalHojas?: number;
  municipio: string;
  municipioConfianza: 'Alta' | 'Media' | 'Baja';
  requiereRevisionMunicipio: boolean;
  mes: string;
  anio: string;
  periodo: string;
  encargado: string;
  cedula: string;
  valorCobro: number;
  tieneSoportePago: boolean;
  datosSoporte?: {
    entidad?: string;
    valorPagado?: number;
    fechaPago?: string;
    numeroAprobacion?: string;
    titular?: string;
    coincideValor?: boolean;
    tipoTransaccion?: string;
  };
  observacionesIA?: string;
  estadoConciliacion: 'Listo' | 'RevisionManual' | 'Cancelado';
  historialMatchedId?: string;
  expendioMatchedId?: string;
  expendioNombre?: string;
}

export interface OfflinePhotoItem {
  id: string;
  cedula: string;
  expendioNombre: string;
  municipio: string;
  slotKey: string;
  slotTitle: string;
  dataUrl: string;
  timestamp: string;
  coords?: { latitude: number; longitude: number; accuracy?: number } | null;
  status: 'queued' | 'syncing' | 'synced' | 'failed';
  errorMessage?: string;
  retries: number;
}

export interface StoredPhotoRecord {
  id?: number;
  uuid: string;
  cedula: string;
  slotKey: string;
  slotTitle: string;
  compositeKey: string; // `${cedula}_${slotKey}`
  expendioNombre: string;
  municipio: string;
  fecha: string; // YYYY-MM-DD
  timestamp: number;
  createdAt: string;
  blob: Blob;
  dataUrl: string;
  mimeType: string;
  fileSize: number;
  fileName: string;
  gpsCoordinates?: { latitude: number; longitude: number; accuracy?: number } | null;
  status: 'pending' | 'uploading' | 'synced' | 'failed';
  serverSynced: boolean;
  serverSyncedAt?: string;
  driveSynced: boolean;
  driveSyncedAt?: string;
  driveFileId?: string;
  driveWebViewLink?: string;
  driveFolderName?: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
}

export interface IndexedDBStorageStats {
  total: number;
  pending: number;
  synced: number;
  failed: number;
  totalBytes: number;
  totalRecords?: number;
  pendingRecords?: number;
  driveSyncedRecords?: number;
  estimatedBytesFormatted?: string;
  lastPurgeAt?: string;
  totalPurgedCount?: number;
  retentionHours?: number;
}

export interface PhotoPurgeResult {
  purgedCount: number;
  freedBytes: number;
  remainingCount: number;
  pendingCount: number;
  failedCount: number;
  retentionHours: number;
  executedAt: string;
}

export type Role = 'admin' | 'cliente' | 'expendio';

export interface GoogleDriveBackupRecord {
  id: string;
  name: string;
  timestamp: string;
  sizeBytes: number;
  webViewLink?: string;
  webContentLink?: string;
  status: 'Completado' | 'Fallido';
  mensaje?: string;
  carpetaId?: string;
  cuentaGoogle?: string;
  origen?: 'Automatico_10m' | 'Manual';
}

export interface DocumentoExpendioConfig {
  id: string;
  nombre: string;
  descripcion: string;
  tipo: 'horario' | 'contrato' | 'aviso' | 'tarifario' | 'archivo';
  habilitado: boolean;
  archivoUrl?: string;
  archivoNombreOriginal?: string;
  fechaActualizacion?: string;
  badge?: string;
  icono?: string;
}

export interface SystemConfig {
  isEphemeralSeed?: boolean;
  periodoHabilitadoDescarga: string; // e.g. "FEBRERO 2026"
  descargaHabilitada: boolean;
  fechaActualizacion?: string;
  googleDriveWebhookUrl?: string;
  lastSyncFromPublished?: string;
  googleDriveBackups?: GoogleDriveBackupRecord[];
  ultimoBackupDrive?: string;
  proximoBackupDrive?: string;
  backupAutomaticoDriveActivo?: boolean;
  carpetaDriveId?: string;
  cuentaGoogleConectada?: string;
  ultimoPurgeDrive?: string;
  diasRetencionDrive?: number;
  documentosExpendios?: DocumentoExpendioConfig[];
  googleDriveAccessToken?: string;
  googleDriveRefreshToken?: string;
  googleDriveAccountEmail?: string;
  googleDriveAccountName?: string;
  googleDriveTokenExpiresAt?: number;
}

export interface AnalisisIACuentaCobro {
  extraido?: {
    encargado?: string;
    cedula?: string;
    municipio?: string;
    cuenta?: string;
    banco?: string;
    valor?: number;
    periodo?: string;
    tieneFirma?: boolean;
    observacionesDetectadas?: string;
  };
  novedades?: Array<{
    campo: string;
    descripcion: string;
    valorAnterior?: string | number | null;
    valorNuevo?: string | number | null;
  }> | string[];
  hayNovedad?: boolean;
  resumen?: string;
  fechaAnalisis?: string;
  confianza?: 'Alta' | 'Media' | 'Baja';
  esCuentaCobro?: boolean;
  tieneSoportePago?: boolean;
  coincideMunicipio?: boolean;
  coincidePeriodo?: boolean;
  confianzaGeneral?: string;
  verificaciones?: {
    firmaPresente?: boolean;
    datosBancariosPresentes?: boolean;
    soporteAdjunto?: boolean;
    municipioLegible?: boolean;
    periodoLegible?: boolean;
  };
  // Legacy fields
  cuentaDetectada?: string;
  bancoDetectado?: string;
  encargadoDetectado?: string;
  valorDetectado?: number;
}

export interface CuentaCargadaExpendio {
  id: string;
  expendioId?: string;
  cedula: string;
  encargado: string;
  expendio?: string;
  municipio: string;
  centroOperativo?: string;
  mesPeriodo?: string;
  anioPeriodo?: string;
  periodo: string; // e.g. "FEBRERO 2026"
  fotoUrl: string; // URL of scanned/processed image with Magic Pro filter
  imagenEscaneadaUrl?: string; // Additional URL for scanned image
  fechaCargue?: string;
  fechaCarga?: string;
  estado: 'Pendiente' | 'Aprobada' | 'Rechazada';
  observaciones?: string;
  monto?: number;
  analisisIA?: AnalisisIACuentaCobro;
  driveUrl?: string;
  driveFileId?: string;
}

export interface PagoRelacionItem {
  id: string;
  consecutivo: number; // N°
  centroOperativo: string;
  municipio: string;
  concepto: string; // e.g. "PAGO MES FEBRERO EXPENDIO ARAUCA"
  nombreEncargado: string;
  cedula: string;
  cuenta: string; // e.g. "NEQUI 3123304166"
  valorCancelar: number; // e.g. 121200
  banco: string; // e.g. "NEQUI"
  estado: string; // e.g. "Cuenta Cargada", "Pendiente", "Listo para Pago", "Pagado"
  mes: string; // e.g. "FEBRERO"
  anio: string; // e.g. "2026"
  cuentaCargadaId?: string;
  soporteUrl?: string;
  analisisIA?: AnalisisIACuentaCobro;
  cambioDetectado?: {
    tieneCambio: boolean;
    detalles: string[];
    encargadoAnterior?: string;
    cedulaAnterior?: string;
    cuentaAnterior?: string;
    valorAnterior?: number;
    aprobado?: boolean;
  };
}

export interface DetalleCambioCampo {
  campo: 'encargado' | 'cedula' | 'cuenta' | 'valor';
  label: string;
  valorAnterior: string | number;
  valorActual: string | number;
}

export interface CambioIntermensual {
  id: string;
  municipio: string;
  centroOperativo: string;
  itemActual: PagoRelacionItem;
  itemAnterior?: PagoRelacionItem;
  cambios: DetalleCambioCampo[];
  estadoAprobacion: 'Pendiente' | 'Aprobado' | 'Rechazado';
}

export interface UserSession {
  role: Role;
  cedulaOrNit: string;
  name: string;
  expendioData?: ExpendioData;
  isMultiRoleAdmin?: boolean;
}

export interface ResumenFinancieroCuentas {
  totalCuentas: number;
  totalCargoBasico: number;
  totalSubsidioSipost: number;
  totalVariable: number;
  totalPagoTotal: number;
  totalRetencion: number;
  totalNeto: number;
  mes: string;
  ano: string;
  periodo: string;
}

export type CampoEncargadoDiscrepancia = 'nombre' | 'cedula' | 'celular' | 'direccion';

export interface DiscrepanciaEncargadoItem {
  id: string;
  municipio: string;
  expendioId?: string;
  campo: CampoEncargadoDiscrepancia;
  campoEtiqueta: string;
  valorBD: string;
  valorArchivo: string;
}

export type ResolucionDiscrepanciasModo = 'actualizar_bd' | 'actualizar_archivo';

export type ThemeMode = 'light' | 'dark';

export interface RegistroAcceso {
  id: string;
  timestamp: string;
  fechaFormateada: string;
  fechaCorta: string;
  usuario: string;
  cedulaOrNit: string;
  rol: Role | 'desconocido';
  municipio?: string;
  ip?: string;
  ubicacionIp?: string;
  isp?: string;
  dispositivo?: string;
  navegador?: string;
  tipoAcceso: 'login' | 'visita';
  exitoso: boolean;
  detalles?: string;
}

export interface ResumenExpendioAcceso {
  cedula: string;
  encargado: string;
  municipio: string;
  totalIngresos: number;
  ultimoIngreso: string;
  telefonoPunto?: string;
  tieneFotos?: boolean;
  ultimaIp?: string;
  ultimaUbicacion?: string;
  isp?: string;
}

export interface MetricasAccesoResumen {
  totalIngresos: number;
  totalUsuariosUnicos: number;
  totalVisitasGenerales: number;
  ingresosHoy: number;
  ingresosUltimos7Dias: number;
  ingresosEsteMes: number;
  expendiosRegistradosTotales: number;
  expendiosQueHanIngresadoCount: number;
  porcentajeCoberturaExpendios: number;
  desglosePorRol: {
    expendio: number;
    admin: number;
    cliente: number;
  };
  desgloseDispositivo: {
    movil: number;
    escritorio: number;
    tablet: number;
  };
  expendiosQueHanIngresado: ResumenExpendioAcceso[];
  expendiosPendientesPorIngresar: {
    cedula: string;
    encargado: string;
    municipio: string;
    telefonoPunto?: string;
  }[];
  ultimosAccesos: RegistroAcceso[];
}

