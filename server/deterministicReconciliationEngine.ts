import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import pdfParse from 'pdf-parse';
import { db } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { normalizeCedula } from './authService.ts';

// =========================================================================
// MOTOR DE CONCILIACIÓN DE CUENTAS DE COBRO 100% DETERMINÍSTICO
// REGLA FUNDAMENTAL: PROHIBICIÓN TOTAL DE MODELOS GENERATIVOS, LLMs O EMBEDDINGS.
// Todas las decisiones se ejecutan mediante OCR local, normalización de cadenas,
// expresiones regulares determinísticas, verificación SHA-256 y consultas a PostgreSQL.
// =========================================================================

export type EstadoConciliacionDeterminista =
  | 'MATCH_EXACTO'
  | 'SIN_COINCIDENCIA'
  | 'AMBIGUA'
  | 'DUPLICADO_EXACTO';

export interface ExtractedOcrFields {
  cedula: string;
  mes: string;
  anio: string;
  periodo: string;
  municipio: string;
  encargado: string;
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
  rawText: string;
  fileHashSha256: string;
}

export interface CandidatoExpendio {
  id: string;
  nombrePunto: string;
  municipio: string;
  localidad?: string | null;
  cedula: string;
  encargado: string;
  valorMensual?: number;
  regional?: string | null;
}

export interface ResultadoConciliacionDeterminista {
  id: string;
  archivoNombre: string;
  archivoUrl: string;
  mimeType: string;
  hojaNumero: number;
  totalHojas: number;
  fileHashSha256: string;
  
  // Estado 100% determinístico
  estadoDeterminista: EstadoConciliacionDeterminista;
  motivoDeterminista: string;

  // Datos extraídos por OCR determinístico
  cedula: string;
  municipio: string;
  mes: string;
  anio: string;
  periodo: string;
  encargado: string;
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

  // Coincidencias con PostgreSQL
  expendioMatchedId?: string;
  expendioNombre?: string;
  candidatosAmbiguedad?: CandidatoExpendio[];
  duplicadoPrevioDetalle?: {
    id?: string;
    fechaCarga?: string;
    periodo?: string;
    expendio?: string;
  };

  // Compatibilidad con interfaz gráfica existente
  estadoConciliacion: 'Listo' | 'RevisionManual' | 'Cancelado' | EstadoConciliacionDeterminista;
  requiereRevisionMunicipio: boolean;
  municipioConfianza: 'Alta' | 'Media' | 'Baja';
  observacionesIA: string;
}

const MESES_COLOMBIA: { [key: string]: string } = {
  ENERO: 'ENERO',
  ENE: 'ENERO',
  FEBRERO: 'FEBRERO',
  FEB: 'FEBRERO',
  MARZO: 'MARZO',
  MAR: 'MARZO',
  ABRIL: 'ABRIL',
  ABR: 'ABRIL',
  MAYO: 'MAYO',
  MAY: 'MAYO',
  JUNIO: 'JUNIO',
  JUN: 'JUNIO',
  JULIO: 'JULIO',
  JUL: 'JULIO',
  AGOSTO: 'AGOSTO',
  AGO: 'AGOSTO',
  SEPTIEMBRE: 'SEPTIEMBRE',
  SETIEMBRE: 'SEPTIEMBRE',
  SEP: 'SEPTIEMBRE',
  SET: 'SEPTIEMBRE',
  OCTUBRE: 'OCTUBRE',
  OCT: 'OCTUBRE',
  NOVIEMBRE: 'NOVIEMBRE',
  NOV: 'NOVIEMBRE',
  DICIEMBRE: 'DICIEMBRE',
  DIC: 'DICIEMBRE',
};

const NUMERO_A_MES: { [key: string]: string } = {
  '01': 'ENERO', '1': 'ENERO',
  '02': 'FEBRERO', '2': 'FEBRERO',
  '03': 'MARZO', '3': 'MARZO',
  '04': 'ABRIL', '4': 'ABRIL',
  '05': 'MAYO', '5': 'MAYO',
  '06': 'JUNIO', '6': 'JUNIO',
  '07': 'JULIO', '7': 'JULIO',
  '08': 'AGOSTO', '8': 'AGOSTO',
  '09': 'SEPTIEMBRE', '9': 'SEPTIEMBRE',
  '10': 'OCTUBRE',
  '11': 'NOVIEMBRE',
  '12': 'DICIEMBRE',
};

/**
 * Normaliza texto eliminando diacríticos, tildes y caracteres especiales,
 * garantizando comparaciones determinísticas invariantes.
 */
export function normalizeDeterministicString(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza exclusivamente dígitos para cédulas de ciudadanía colombianas.
 */
export function extractDigits(str: string): string {
  return (str || '').replace(/\D/g, '');
}

/**
 * Calcula el SHA-256 exacto de un buffer físico.
 */
export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Extrae texto de un buffer PDF mediante parsing directo de fuentes/streams.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const fn: any = (pdfParse as any)?.default || pdfParse;
    if (typeof fn === 'function') {
      try {
        const data = await fn(buffer);
        if (data && typeof data.text === 'string') return data.text;
      } catch (innerErr: any) {
        try {
          const instance = new fn({ data: buffer });
          if (typeof instance.load === 'function') await instance.load();
          if (typeof instance.getText === 'function') {
            const res = await instance.getText();
            if (typeof res === 'string') return res;
            if (res && typeof res.text === 'string') return res.text;
          }
        } catch {
          // ignore fallback error
        }
      }
    }
  } catch (err: any) {
    console.warn('[DeterministicEngine] PDFParse error, intentando OCR alternativo:', err?.message || err);
  }
  return '';
}

/**
 * Extrae texto de un buffer de imagen mediante Tesseract.js (motor OCR local y determinístico).
 */
export async function extractTextFromImage(buffer: Buffer): Promise<string> {
  try {
    // Optimizar imagen para OCR determinístico con Sharp (escala de grises + normalización de umbral)
    const optimizedBuffer = await sharp(buffer)
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();

    const worker = await createWorker('spa');
    const ret = await worker.recognize(optimizedBuffer);
    await worker.terminate();
    return ret.data.text || '';
  } catch (err: any) {
    console.error('[DeterministicEngine] Error ejecutando OCR con Tesseract:', err.message);
    return '';
  }
}

/**
 * Extrae determinísticamente los campos relevantes desde el texto OCR bruto:
 * Cédula, Mes, Año, Municipio, Monto y Comprobante de pago.
 */
export function extractFieldsFromOcrText(
  rawText: string,
  fileHashSha256: string,
  municipiosValidos: string[]
): ExtractedOcrFields {
  const normText = normalizeDeterministicString(rawText);

  // 1. Cédula de ciudadanía colombiana
  let cedula = '';
  // Patrones contextuales prioritarios: "C.C.", "CEDULA", "NIT", "IDENTIFICACION"
  const cedulaPatterns = [
    /(?:C\s*C|CEDULA|IDENTIFICACION|DOCUMENTO|NIT|C\s*E)\s*[:#\-\.]*\s*([0-9]{6,11})\b/i,
    /(?:CONTRATISTA|EXPEDIDOR|TITULAR|FAVOR\s*DE)[^0-9\n]{0,30}\b([0-9]{6,11})\b/i,
  ];

  for (const pat of cedulaPatterns) {
    const m = normText.match(pat);
    if (m && m[1]) {
      const candidate = m[1].trim();
      // Descartar si coincide con un año (2020-2030) o número de celular (inicia con 3 y tiene 10 dígitos)
      if (candidate.length >= 6 && candidate.length <= 10) {
        if (!candidate.startsWith('3') || candidate.length < 10) {
          cedula = candidate;
          break;
        }
      }
    }
  }

  // Si no se halló por contexto, buscar secuencias numéricas de 7 a 10 dígitos no telefónicas
  if (!cedula) {
    const numbers = normText.match(/\b([0-9]{6,10})\b/g) || [];
    for (const num of numbers) {
      const n = num.trim();
      if (n.startsWith('202') || n.startsWith('201')) continue; // Año
      if (n.startsWith('3') && n.length === 10) continue; // Celular
      if (n === '123456789' || n === '0000000000') continue;
      cedula = n;
      break;
    }
  }

  // 2. Mes del periodo de cobro
  let mes = '';
  // Buscar nombres completos de meses en español
  const mesRegex = /\b(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\b/g;
  const matchMeses = normText.match(mesRegex);
  if (matchMeses && matchMeses.length > 0) {
    mes = MESES_COLOMBIA[matchMeses[0]] || matchMeses[0];
  }

  // Si no se encuentra, buscar formato de fecha numérica DD/MM/AAAA o DD-MM-AAAA
  if (!mes) {
    const dateMatch = rawText.match(/\b([0-3]?[0-9])[\/\.\-]([0-1]?[0-9])[\/\.\-](202[0-9])\b/);
    if (dateMatch && dateMatch[2]) {
      const monthNum = String(parseInt(dateMatch[2], 10));
      if (NUMERO_A_MES[monthNum]) {
        mes = NUMERO_A_MES[monthNum];
      }
    }
  }

  // 3. Año del periodo de cobro
  let anio = '2026';
  const anioMatch = normText.match(/\b(202[3-9]|203[0-5])\b/);
  if (anioMatch && anioMatch[1]) {
    anio = anioMatch[1];
  }

  const periodo = `${mes || 'PERIODO ACTUAL'} ${anio}`.trim();

  // 4. Municipio
  let municipio = '';
  const cleanMunicipios = municipiosValidos
    .map((m) => normalizeDeterministicString(m))
    .filter((m) => m.length >= 3);

  // Ordenar de mayor a menor longitud para evitar que un prefijo coincida antes
  cleanMunicipios.sort((a, b) => b.length - a.length);

  for (const mun of cleanMunicipios) {
    // Buscar municipio con límites de palabra para evitar falsos positivos
    const munPattern = new RegExp(`\\b${mun}\\b`);
    if (munPattern.test(normText)) {
      municipio = mun;
      break;
    }
  }

  // 5. Encargado / Contratista
  let encargado = '';
  const encMatch = rawText.match(/(?:CONTRATISTA|ENCARGADO|NOMBRE|SENOR\(A\)|SEÑOR\(A\))\s*[:#\-\.]*\s*([A-Za-zÁÉÍÓÚÑáéíóúñ\s]{4,40})/i);
  if (encMatch && encMatch[1]) {
    encargado = encMatch[1].trim().toUpperCase();
  }

  // 6. Valor de cobro
  let valorCobro = 0;
  const valorMatch = rawText.match(/(?:VALOR|TOTAL|MONTO|PAGAR|SUMA\s*DE)\s*[:#\-\.\$]*\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]{4,8})\b/i);
  if (valorMatch && valorMatch[1]) {
    const rawNum = valorMatch[1].replace(/[^\d]/g, '');
    valorCobro = Number(rawNum) || 0;
  }

  // 7. Soporte bancario / Tirilla de pago
  const palabrasBancarias = [
    'NEQUI',
    'BANCOLOMBIA',
    'DAVIPLATA',
    'CORRESPONSAL',
    'APROBACION',
    'TRANSFERENCIA',
    'TRANSACCION',
    'PAGO EXITOSO',
    'COMPROBANTE',
    'NUMERO DE APROBACION',
    'NUMERO DE TRANSACCION',
    'REFERENCIA',
  ];

  let tieneSoportePago = false;
  let entidadDetectada = '';

  for (const pb of palabrasBancarias) {
    if (normText.includes(pb)) {
      tieneSoportePago = true;
      if (pb === 'NEQUI' || pb === 'BANCOLOMBIA' || pb === 'DAVIPLATA') {
        entidadDetectada = pb;
      }
      break;
    }
  }

  let datosSoporte: ExtractedOcrFields['datosSoporte'] = undefined;
  if (tieneSoportePago) {
    const aprobMatch = rawText.match(/(?:APROBACION|TRANSACCION|COMPROBANTE|REF|ID)[\s:#\-\.]*([A-Za-z0-9]{4,16})/i);
    datosSoporte = {
      entidad: entidadDetectada || 'Comprobante bancario',
      numeroAprobacion: aprobMatch ? aprobMatch[1] : undefined,
      valorPagado: valorCobro > 0 ? valorCobro : undefined,
    };
  }

  return {
    cedula,
    mes,
    anio,
    periodo,
    municipio,
    encargado,
    valorCobro,
    tieneSoportePago,
    datosSoporte,
    rawText,
    fileHashSha256,
  };
}

/**
 * Consulta en PostgreSQL si un hash SHA-256 ya fue registrado previamente
 * para detectar DUPLICADO_EXACTO de manera persistente.
 */
export async function checkDuplicateSha256(
  fileHashSha256: string,
  batchKnownHashes: Set<string>
): Promise<{ isDuplicate: boolean; detail?: any }> {
  // 1. Detección en el mismo lote en curso
  if (batchKnownHashes.has(fileHashSha256)) {
    return {
      isDuplicate: true,
      detail: {
        tipo: 'DUPLICADO_EN_LOTE',
        mensaje: 'Archivo idéntico procesado en este mismo lote de carga.',
      },
    };
  }

  // 2. Consulta en PostgreSQL (tabla system_config: clave 'reconciled_sha256_registry')
  try {
    const configRow = await db
      .select()
      .from(schema.systemConfig)
      .where(eq(schema.systemConfig.key, 'reconciled_sha256_registry'))
      .limit(1);

    if (configRow.length > 0 && configRow[0].value) {
      const registry = configRow[0].value as Record<string, any>;
      if (registry[fileHashSha256]) {
        return {
          isDuplicate: true,
          detail: registry[fileHashSha256],
        };
      }
    }
  } catch (err: any) {
    console.warn('[DeterministicEngine] Error consultando registro de hashes en PostgreSQL:', err.message);
  }

  // 3. Consulta en tabla cuentas_cargadas de PostgreSQL
  try {
    const ccRows = await db
      .select()
      .from(schema.cuentasCargadas)
      .where(sql`observaciones ILIKE ${'%' + fileHashSha256 + '%'}`)
      .limit(1);

    if (ccRows.length > 0) {
      return {
        isDuplicate: true,
        detail: {
          id: ccRows[0].id,
          fechaCarga: ccRows[0].fechaCarga,
          periodo: ccRows[0].periodo,
          expendioId: ccRows[0].expendioId,
        },
      };
    }
  } catch (err: any) {
    console.warn('[DeterministicEngine] Error consultando cuentas_cargadas en PostgreSQL:', err.message);
  }

  return { isDuplicate: false };
}

/**
 * Registra un hash SHA-256 en PostgreSQL para garantizar que
 * las pruebas destructivas y reinicios no pierdan el historial de duplicados.
 */
export async function persistSha256ToRegistry(
  fileHashSha256: string,
  meta: { expendioId?: string; cedula?: string; periodo?: string; archivoNombre?: string }
): Promise<void> {
  try {
    const configRow = await db
      .select()
      .from(schema.systemConfig)
      .where(eq(schema.systemConfig.key, 'reconciled_sha256_registry'))
      .limit(1);

    let currentRegistry: Record<string, any> = {};
    if (configRow.length > 0 && configRow[0].value && typeof configRow[0].value === 'object') {
      currentRegistry = { ...(configRow[0].value as Record<string, any>) };
    }

    currentRegistry[fileHashSha256] = {
      ...meta,
      fechaRegistro: new Date().toISOString(),
    };

    if (configRow.length > 0) {
      await db
        .update(schema.systemConfig)
        .set({ value: currentRegistry, updatedAt: new Date() })
        .where(eq(schema.systemConfig.key, 'reconciled_sha256_registry'));
    } else {
      await db.insert(schema.systemConfig).values({
        key: 'reconciled_sha256_registry',
        value: currentRegistry,
      });
    }
  } catch (err: any) {
    console.warn('[DeterministicEngine] Error persistiendo SHA-256 en system_config:', err.message);
  }
}

/**
 * MOTOR PRINCIPAL: Compara los datos OCR extraídos contra PostgreSQL determinísticamente
 * y clasifica en: MATCH_EXACTO, SIN_COINCIDENCIA, AMBIGUA, DUPLICADO_EXACTO.
 */
export async function reconcileOcrWithPostgres(
  extracted: ExtractedOcrFields,
  fileMeta: { originalname: string; fileUrl: string; mimeType: string; hojaNumero?: number; totalHojas?: number },
  batchKnownHashes: Set<string>
): Promise<ResultadoConciliacionDeterminista> {
  const { cedula, mes, anio, periodo, municipio, fileHashSha256, valorCobro, tieneSoportePago, datosSoporte, encargado } = extracted;

  // 1. REGLA: DUPLICADO_EXACTO (vía SHA-256)
  const dupCheck = await checkDuplicateSha256(fileHashSha256, batchKnownHashes);
  if (dupCheck.isDuplicate) {
    return {
      id: `concil-det-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
      archivoNombre: fileMeta.originalname,
      archivoUrl: fileMeta.fileUrl,
      mimeType: fileMeta.mimeType,
      hojaNumero: fileMeta.hojaNumero || 1,
      totalHojas: fileMeta.totalHojas || 1,
      fileHashSha256,
      estadoDeterminista: 'DUPLICADO_EXACTO',
      motivoDeterminista: `Archivo con huella criptográfica SHA-256 (${fileHashSha256}) idéntico a un documento previamente procesado. Rechazado para prevenir duplicidad.`,
      cedula,
      municipio,
      mes,
      anio,
      periodo,
      encargado,
      valorCobro,
      tieneSoportePago,
      datosSoporte,
      duplicadoPrevioDetalle: dupCheck.detail,
      estadoConciliacion: 'DUPLICADO_EXACTO',
      requiereRevisionMunicipio: false,
      municipioConfianza: 'Alta',
      observacionesIA: `[DUPLICADO_EXACTO] Documento rechazado por SHA-256 idéntico (${fileHashSha256}).`,
    };
  }

  // 2. Consulta de candidatos activos en la base de datos maestra
  let activeExpendios: any[] = [];
  try {
    const { getDatabaseReadOnly } = await import('./dbStore.ts');
    activeExpendios = (getDatabaseReadOnly().expendios || []).filter(
      (e: any) => e.activo !== false && e.estado !== 'Inhabilitado'
    );
  } catch (err: any) {
    console.error('[DeterministicEngine] Error consultando expendios:', err.message);
  }

  const cleanCedula = extractDigits(cedula);
  const normMunicipio = normalizeDeterministicString(municipio);

  // Filtro A: Coincidencia por Cédula en PostgreSQL
  let cedulaMatches: any[] = [];
  if (cleanCedula && cleanCedula.length >= 6) {
    cedulaMatches = activeExpendios.filter((exp) => {
      const expCed = extractDigits(exp.cedula);
      return expCed === cleanCedula;
    });
  }

  // Filtro B: Coincidencia por Municipio en PostgreSQL
  let municipioMatches: any[] = [];
  if (normMunicipio) {
    municipioMatches = activeExpendios.filter((exp) => {
      const expMun = normalizeDeterministicString(exp.municipio);
      const expLoc = normalizeDeterministicString(exp.localidad || '');
      return (
        expMun === normMunicipio ||
        expLoc === normMunicipio ||
        (expMun.length >= 4 && normMunicipio.includes(expMun))
      );
    });
  }

  // =========================================================================
  // EVALUACIÓN DETERMINÍSTICA DE REGLAS DE NEGOCIO
  // =========================================================================

  // CASO 1: Cédula coincide con exactamente 1 expendio
  if (cedulaMatches.length === 1) {
    const matched = cedulaMatches[0];
    const expMun = normalizeDeterministicString(matched.municipio);
    const expLoc = normalizeDeterministicString(matched.localidad || '');

    // Si el OCR también extrajo municipio: verificar que no pertenezca a OTRO expendio distinto
    if (normMunicipio && expMun !== normMunicipio && expLoc !== normMunicipio) {
      // Conflicto: la cédula pertenece a Expendio A, pero el texto especifica Municipio de Expendio B
      const conflictingOther = municipioMatches.filter((e) => e.id !== matched.id);
      if (conflictingOther.length > 0) {
        return {
          id: `concil-det-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
          archivoNombre: fileMeta.originalname,
          archivoUrl: fileMeta.fileUrl,
          mimeType: fileMeta.mimeType,
          hojaNumero: fileMeta.hojaNumero || 1,
          totalHojas: fileMeta.totalHojas || 1,
          fileHashSha256,
          estadoDeterminista: 'AMBIGUA',
          motivoDeterminista: `Conflicto de identidad: La cédula ${cleanCedula} pertenece al expendio ${matched.nombrePunto} (${matched.municipio}), pero el documento menciona el municipio ${municipio} correspondiente a otro expendio.`,
          cedula: cleanCedula,
          municipio: matched.municipio,
          mes,
          anio,
          periodo,
          encargado: matched.encargado,
          valorCobro: valorCobro || Number(matched.valorMensual) || 0,
          tieneSoportePago,
          datosSoporte,
          candidatosAmbiguedad: [matched, ...conflictingOther].map((e) => ({
            id: e.id,
            nombrePunto: e.nombrePunto,
            municipio: e.municipio,
            localidad: e.localidad,
            cedula: e.cedula,
            encargado: e.encargado,
            valorMensual: Number(e.valorMensual) || 0,
            regional: e.regional,
          })),
          estadoConciliacion: 'RevisionManual',
          requiereRevisionMunicipio: true,
          municipioConfianza: 'Baja',
          observacionesIA: `[AMBIGUA] Conflicto entre Cédula (${cleanCedula}) y Municipio (${municipio}). Se requiere desambiguación.`,
        };
      }
    }

    // MATCH_EXACTO UNEQUÍVOCO
    return {
      id: `concil-det-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
      archivoNombre: fileMeta.originalname,
      archivoUrl: fileMeta.fileUrl,
      mimeType: fileMeta.mimeType,
      hojaNumero: fileMeta.hojaNumero || 1,
      totalHojas: fileMeta.totalHojas || 1,
      fileHashSha256,
      estadoDeterminista: 'MATCH_EXACTO',
      motivoDeterminista: `Coincidencia exacta y única por cédula ${matched.cedula} asociada al expendio ${matched.nombrePunto} (${matched.municipio}).`,
      cedula: matched.cedula,
      municipio: matched.municipio,
      mes,
      anio,
      periodo,
      encargado: matched.encargado,
      valorCobro: valorCobro || Number(matched.valorMensual) || 0,
      tieneSoportePago,
      datosSoporte,
      expendioMatchedId: matched.id,
      expendioNombre: matched.nombrePunto || matched.municipio,
      estadoConciliacion: tieneSoportePago ? 'Listo' : 'RevisionManual',
      requiereRevisionMunicipio: false,
      municipioConfianza: 'Alta',
      observacionesIA: `[MATCH_EXACTO] Asignado automáticamente a expendio ${matched.nombrePunto} (C.C. ${matched.cedula}).`,
    };
  }

  // CASO 2: Cédula coincide con múltiples expendios (anomalía de datos)
  if (cedulaMatches.length > 1) {
    return {
      id: `concil-det-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
      archivoNombre: fileMeta.originalname,
      archivoUrl: fileMeta.fileUrl,
      mimeType: fileMeta.mimeType,
      hojaNumero: fileMeta.hojaNumero || 1,
      totalHojas: fileMeta.totalHojas || 1,
      fileHashSha256,
      estadoDeterminista: 'AMBIGUA',
      motivoDeterminista: `La cédula ${cleanCedula} se encuentra registrada en múltiples expendios (${cedulaMatches.length}) en PostgreSQL.`,
      cedula: cleanCedula,
      municipio,
      mes,
      anio,
      periodo,
      encargado,
      valorCobro,
      tieneSoportePago,
      datosSoporte,
      candidatosAmbiguedad: cedulaMatches.map((e) => ({
        id: e.id,
        nombrePunto: e.nombrePunto,
        municipio: e.municipio,
        localidad: e.localidad,
        cedula: e.cedula,
        encargado: e.encargado,
        valorMensual: Number(e.valorMensual) || 0,
        regional: e.regional,
      })),
      estadoConciliacion: 'RevisionManual',
      requiereRevisionMunicipio: true,
      municipioConfianza: 'Media',
      observacionesIA: `[AMBIGUA] Cédula ${cleanCedula} compartida por ${cedulaMatches.length} puntos.`,
    };
  }

  // CASO 3: Cédula no encontrada o ausente, pero Municipio sí
  if (!cleanCedula || cedulaMatches.length === 0) {
    if (municipioMatches.length === 1) {
      const matched = municipioMatches[0];
      // Si la cédula extraída era distinta a la registrada: ambigüedad por inconsistencia
      if (cleanCedula && cleanCedula !== extractDigits(matched.cedula)) {
        return {
          id: `concil-det-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
          archivoNombre: fileMeta.originalname,
          archivoUrl: fileMeta.fileUrl,
          mimeType: fileMeta.mimeType,
          hojaNumero: fileMeta.hojaNumero || 1,
          totalHojas: fileMeta.totalHojas || 1,
          fileHashSha256,
          estadoDeterminista: 'AMBIGUA',
          motivoDeterminista: `Municipio coincide con ${matched.municipio}, pero la cédula extraída (${cleanCedula}) no coincide con la registrada en PostgreSQL (${matched.cedula}).`,
          cedula: cleanCedula,
          municipio: matched.municipio,
          mes,
          anio,
          periodo,
          encargado: matched.encargado,
          valorCobro: valorCobro || Number(matched.valorMensual) || 0,
          tieneSoportePago,
          datosSoporte,
          candidatosAmbiguedad: [
            {
              id: matched.id,
              nombrePunto: matched.nombrePunto,
              municipio: matched.municipio,
              localidad: matched.localidad,
              cedula: matched.cedula,
              encargado: matched.encargado,
              valorMensual: Number(matched.valorMensual) || 0,
              regional: matched.regional,
            },
          ],
          estadoConciliacion: 'RevisionManual',
          requiereRevisionMunicipio: true,
          municipioConfianza: 'Media',
          observacionesIA: `[AMBIGUA] Inconsistencia: Municipio coincide pero Cédula difiere.`,
        };
      }

      // MATCH_EXACTO por municipio único
      return {
        id: `concil-det-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
        archivoNombre: fileMeta.originalname,
        archivoUrl: fileMeta.fileUrl,
        mimeType: fileMeta.mimeType,
        hojaNumero: fileMeta.hojaNumero || 1,
        totalHojas: fileMeta.totalHojas || 1,
        fileHashSha256,
        estadoDeterminista: 'MATCH_EXACTO',
        motivoDeterminista: `Coincidencia unívoca por municipio único ${matched.municipio} asociado al expendio ${matched.nombrePunto}.`,
        cedula: matched.cedula,
        municipio: matched.municipio,
        mes,
        anio,
        periodo,
        encargado: matched.encargado,
        valorCobro: valorCobro || Number(matched.valorMensual) || 0,
        tieneSoportePago,
        datosSoporte,
        expendioMatchedId: matched.id,
        expendioNombre: matched.nombrePunto || matched.municipio,
        estadoConciliacion: tieneSoportePago ? 'Listo' : 'RevisionManual',
        requiereRevisionMunicipio: false,
        municipioConfianza: 'Alta',
        observacionesIA: `[MATCH_EXACTO] Asignado por municipio único ${matched.municipio}.`,
      };
    }

    if (municipioMatches.length > 1) {
      // Múltiples expendios en el mismo municipio y no hay cédula para diferenciarlos
      return {
        id: `concil-det-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
        archivoNombre: fileMeta.originalname,
        archivoUrl: fileMeta.fileUrl,
        mimeType: fileMeta.mimeType,
        hojaNumero: fileMeta.hojaNumero || 1,
        totalHojas: fileMeta.totalHojas || 1,
        fileHashSha256,
        estadoDeterminista: 'AMBIGUA',
        motivoDeterminista: `El municipio ${municipio} posee ${municipioMatches.length} expendios registrados en PostgreSQL. Se requiere cédula para desambiguar.`,
        cedula: cleanCedula,
        municipio,
        mes,
        anio,
        periodo,
        encargado,
        valorCobro,
        tieneSoportePago,
        datosSoporte,
        candidatosAmbiguedad: municipioMatches.map((e) => ({
          id: e.id,
          nombrePunto: e.nombrePunto,
          municipio: e.municipio,
          localidad: e.localidad,
          cedula: e.cedula,
          encargado: e.encargado,
          valorMensual: Number(e.valorMensual) || 0,
          regional: e.regional,
        })),
        estadoConciliacion: 'RevisionManual',
        requiereRevisionMunicipio: true,
        municipioConfianza: 'Baja',
        observacionesIA: `[AMBIGUA] Existen ${municipioMatches.length} expendios en ${municipio}. Falta cédula.`,
      };
    }
  }

  // CASO 4: SIN_COINCIDENCIA
  return {
    id: `concil-det-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
    archivoNombre: fileMeta.originalname,
    archivoUrl: fileMeta.fileUrl,
    mimeType: fileMeta.mimeType,
    hojaNumero: fileMeta.hojaNumero || 1,
    totalHojas: fileMeta.totalHojas || 1,
    fileHashSha256,
    estadoDeterminista: 'SIN_COINCIDENCIA',
    motivoDeterminista: `Ningún expendio en PostgreSQL coincide con la cédula (${cleanCedula || 'No detectada'}) o el municipio (${municipio || 'No detectado'}).`,
    cedula: cleanCedula,
    municipio,
    mes,
    anio,
    periodo,
    encargado,
    valorCobro,
    tieneSoportePago,
    datosSoporte,
    estadoConciliacion: 'RevisionManual',
    requiereRevisionMunicipio: true,
    municipioConfianza: 'Baja',
    observacionesIA: `[SIN_COINCIDENCIA] No se encontró ningún punto postal en PostgreSQL para los datos extraídos.`,
  };
}
