import { relations, sql } from 'drizzle-orm';
import { boolean, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

// 1. Usuarios del Sistema (Administradores y Operadores)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  cedula: text('cedula'),
  role: varchar('role', { length: 50 }).default('expendio').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 2. Catálogo Maestro de Expendios Postales CAMARCA
export const expendios = pgTable(
  'expendios',
  {
    id: text('id').primaryKey(), // ID Canónico e Inmutable (e.g. 'exp-excel-...')
    numeroExpendio: text('numero_expendio'),
    codigo: text('codigo'),
    nombrePunto: text('nombre_punto').notNull(),
    departamento: text('departamento').default('CUNDINAMARCA'),
    municipio: text('municipio').notNull(),
    localidad: text('localidad'),
    centroOperativo: text('centro_operativo'),
    centroAcopio: text('centro_acopio'),
    regional: text('regional').default('ORIENTE'),
    direccionPunto: text('direccion_punto').notNull(),
    encargado: text('encargado').notNull(),
    cedula: text('cedula').notNull(), // Cédula Autorizada
    telefonoPunto: text('telefono_punto').notNull(),
    cuentaBancaria: text('cuenta_bancaria'),
    banco: text('banco').default('NEQUI'),
    tipoCuenta: text('tipo_cuenta').default('AHORROS'),
    correoElectronico: text('correo_electronico'),
    usuarioSipost: text('usuario_sipost'),
    internet: text('internet').default('SI'),
    nit: text('nit'),
    valorMensual: numeric('valor_mensual', { precision: 14, scale: 2 }).default('0'),
    admisionSipost: numeric('admision_sipost', { precision: 14, scale: 2 }).default('0'),
    valorVariable: numeric('valor_variable', { precision: 14, scale: 2 }).default('0'),
    observaciones: text('observaciones'),
    observacion: text('observacion'),
    estado: varchar('estado', { length: 50 }).default('ACTIVO').notNull(),
    activo: boolean('activo').default(true).notNull(),
    primeraVezActualizado: boolean('primera_vez_actualizado').default(false),
    bienvenidaRealizada: boolean('bienvenida_realizada').default(false),
    fechaUltimaActualizacion: text('fecha_ultima_actualizacion'),
    // Disponibilidad de ítems
    tieneAviso: text('tiene_aviso').default(''),
    tieneBascula: text('tiene_bascula').default(''),
    tieneMatasello: text('tiene_matasello').default(''),
    tieneImpresora: text('tiene_impresora').default(''),
    tieneComputador: text('tiene_computador').default(''),
    motivoFaltaAviso: text('motivo_falta_aviso'),
    motivoFaltaBascula: text('motivo_falta_bascula'),
    motivoFaltaMatasello: text('motivo_falta_matasello'),
    motivoFaltaImpresora: text('motivo_falta_impresora'),
    motivoFaltaComputador: text('motivo_falta_computador'),
    // URLs de fotos canónicas
    fotoAvisoUrl: text('foto_aviso_url'),
    fotoPanoramicaUrl: text('foto_panoramica_url'),
    fotoMataselloUrl: text('foto_matasello_url'),
    fotoBasculaUrl: text('foto_bascula_url'),
    fotoContratistaUrl: text('foto_contratista_url'),
    fotoHorarioUrl: text('foto_horario_url'),
    fotoTarifasUrl: text('foto_tarifas_url'),
    letreroUrl: text('letrero_url'),
    basculaUrl: text('bascula_url'),
    mataselloUrl: text('matasello_url'),
    computadorUrl: text('computador_url'),
    contratoUrl: text('contrato_url'),
    contratoPdfUrl: text('contrato_pdf_url'),
    revision: integer('revision').default(1).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_expendios_cedula_activa')
      .on(table.cedula)
      .where(sql`activo = true AND cedula != '' AND cedula != '0'`),
  ]
);

// 3. Historial Contable y Cuentas de Cobro
export const historialCuentas = pgTable('historial_cuentas', {
  id: text('id').primaryKey(),
  consecutivo: text('consecutivo'),
  numeroCuenta: text('numero_cuenta'),
  expendioId: text('expendio_id').notNull().references(() => expendios.id, { onDelete: 'cascade' }),
  encargado: text('encargado').notNull(),
  cedula: text('cedula').notNull(),
  expendio: text('expendio'),
  municipio: text('municipio'),
  localidad: text('localidad'),
  banco: text('banco'),
  cuentaBancaria: text('cuenta_bancaria'),
  mes: text('mes').notNull(),
  anio: text('anio').notNull(),
  periodo: text('periodo').notNull(),
  totalPagar: numeric('total_pagar', { precision: 14, scale: 2 }).default('0'),
  monto: numeric('monto', { precision: 14, scale: 2 }).default('0'),
  valorBase: numeric('valor_base', { precision: 14, scale: 2 }).default('0'),
  valorBruto: numeric('valor_bruto', { precision: 14, scale: 2 }).default('0'),
  fecha: text('fecha'),
  fechaGeneracion: text('fecha_generacion'),
  estado: varchar('estado', { length: 50 }).default('GENERADA').notNull(),
  tipo: text('tipo').default('Cuenta de Cobro'),
  detalles: text('detalles'),
  cuentaData: jsonb('cuenta_data'),
  soporteUrl: text('soporte_url'),
  soporteFirmadoUrl: text('soporte_firmado_url'),
  cuentaCargadaId: text('cuenta_cargada_id'),
  cuentaFirmadaCargada: boolean('cuenta_firmada_cargada').default(false),
  fechaCargueFirmada: text('fecha_cargue_firmada'),
  conciliadoConIa: boolean('conciliado_con_ia').default(false),
  novedades: jsonb('novedades'),
  deducciones: jsonb('deducciones'),
  retenciones: jsonb('retenciones'),
  observaciones: text('observaciones'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 4. Relación Consolidada de Pagos Bancarios
export const relacionPagos = pgTable('relacion_pagos', {
  id: text('id').primaryKey(),
  expendioId: text('expendio_id').references(() => expendios.id, { onDelete: 'cascade' }),
  consecutivo: text('consecutivo'),
  numeroCuenta: text('numero_cuenta'),
  centroOperativo: text('centro_operativo'),
  municipio: text('municipio'),
  concepto: text('concepto'),
  nombreEncargado: text('nombre_encargado'),
  beneficiario: text('beneficiario').notNull(),
  cedula: text('cedula').notNull(),
  banco: text('banco').notNull(),
  cuenta: text('cuenta'),
  numeroCuentaBancaria: text('numero_cuenta_bancaria').notNull(),
  tipoCuenta: text('tipo_cuenta').default('AHORROS'),
  valorPagar: numeric('valor_pagar', { precision: 14, scale: 2 }).default('0'),
  valorCancelar: numeric('valor_cancelar', { precision: 14, scale: 2 }).default('0'),
  periodo: text('periodo').notNull(),
  mes: text('mes'),
  anio: text('anio'),
  fechaPago: text('fecha_pago'),
  estado: varchar('estado', { length: 50 }).default('PENDIENTE').notNull(),
  cuentaCargadaId: text('cuenta_cargada_id'),
  soporteUrl: text('soporte_url'),
  cambioDetectado: jsonb('cambio_detectado'),
  loteId: text('lote_id'),
  observaciones: text('observaciones'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 5. Cuentas Firmadas Cargadas por los Puntos
export const cuentasCargadas = pgTable('cuentas_cargadas', {
  id: text('id').primaryKey(),
  expendioId: text('expendio_id').references(() => expendios.id, { onDelete: 'cascade' }),
  encargado: text('encargado').notNull(),
  cedula: text('cedula').notNull(),
  mes: text('mes').notNull(),
  anio: text('anio').notNull(),
  periodo: text('periodo').notNull(),
  nombreArchivo: text('nombre_archivo').notNull(),
  urlArchivo: text('url_archivo'),
  tipoArchivo: text('tipo_archivo'),
  estado: varchar('estado', { length: 50 }).default('PENDIENTE').notNull(),
  fechaCarga: text('fecha_carga').notNull(),
  analizadaIa: boolean('analizada_ia').default(false),
  datosIa: jsonb('datos_ia'),
  observaciones: text('observaciones'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 6. Registro de Trazabilidad y Auditoría de Novedades
export const trazabilidad = pgTable('trazabilidad', {
  id: text('id').primaryKey(),
  expendioId: text('expendio_id').references(() => expendios.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull(),
  actorRole: text('actor_role').default('expendio').notNull(),
  timestamp: text('timestamp').notNull(),
  municipio: text('municipio'),
  localidad: text('localidad'),
  novedad: text('novedad').notNull(),
  encargadoAnterior: text('encargado_anterior'),
  encargadoNuevo: text('encargado_nuevo'),
  cedulaAnterior: text('cedula_anterior'),
  cedulaNuevo: text('cedula_nuevo'),
  registradoPor: text('registrado_por'),
  observaciones: text('observaciones'),
  fechaRegistro: text('fecha_registro').notNull(),
  commitId: text('commit_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 7. Parámetros Globales y Configuración del Sistema
export const systemConfig = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 8. Registros de Acceso y Logs de Seguridad
export const registrosAcceso = pgTable('registros_acceso', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  actorId: text('actor_id').notNull(),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  details: jsonb('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 9. Evidencias Fotográficas Georreferenciadas
export const googleDrivePhotos = pgTable('google_drive_photos', {
  photoId: text('photo_id').primaryKey(),
  expendioId: text('expendio_id').references(() => expendios.id, { onDelete: 'cascade' }),
  slot: text('slot'),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').default('image/jpeg'),
  path: text('path'),
  checksum: text('checksum'),
  driveFileId: text('drive_file_id'),
  webViewLink: text('web_view_link'),
  thumbnailLink: text('thumbnail_link'),
  uploadedAt: text('uploaded_at').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 10. Almacenamiento Híbrido de Fotografía (Firebase Storage + AWS S3 Contingencia)
export const photoStorage = pgTable('photo_storage', {
  photoId: text('photo_id').primaryKey(),
  expendioId: text('expendio_id').references(() => expendios.id, { onDelete: 'cascade' }),
  cedula: text('cedula'),
  slotKey: text('slot_key').notNull(),
  version: integer('version').default(1).notNull(),
  checksumSha256: text('checksum_sha256').notNull(),
  sizeBytes: integer('size_bytes').default(0).notNull(),
  mimeType: text('mime_type').default('image/jpeg').notNull(),
  storageProvider: varchar('storage_provider', { length: 50 }).default('FIREBASE').notNull(),
  firebaseStoragePath: text('firebase_storage_path'),
  s3Bucket: text('s3_bucket'),
  s3Key: text('s3_key'),
  status: varchar('status', { length: 50 }).default('FIREBASE_PRIMARY').notNull(),
  lastError: text('last_error'),
  retryCount: integer('retry_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastSyncAt: timestamp('last_sync_at'),
});

// 11. Cola Durable de Sincronización entre Firebase y AWS S3
export const photoStorageSyncQueue = pgTable('photo_storage_sync_queue', {
  id: serial('id').primaryKey(),
  photoId: text('photo_id').notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).default('PENDING').notNull(),
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').default(0).notNull(),
  nextRetryAt: timestamp('next_retry_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relaciones Relacionales
export const expendiosRelations = relations(expendios, ({ many }) => ({
  historial: many(historialCuentas),
  relacionPagos: many(relacionPagos),
  cuentasCargadas: many(cuentasCargadas),
  trazabilidad: many(trazabilidad),
}));

export const historialRelations = relations(historialCuentas, ({ one }) => ({
  expendio: one(expendios, {
    fields: [historialCuentas.expendioId],
    references: [expendios.id],
  }),
}));
