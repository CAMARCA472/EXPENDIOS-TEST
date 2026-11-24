import { DatabaseSchema } from './dbStore.js';

export interface IntegrityCheckResult {
  healthy: boolean;
  errors: string[];
  warnings: string[];
  checkedAt: string;
  counts: {
    expendios: number;
    historial: number;
    relacionPagos: number;
    trazabilidad: number;
    cuentasCargadas: number;
    registrosAcceso: number;
  };
}

/**
 * Normaliza un período de negocio al formato canónico interno YYYY-MM
 */
export function normalizePeriodKey(periodo: string | undefined | null): string {
  if (!periodo) return '';
  const trimmed = periodo.trim().toUpperCase();

  // Si ya tiene formato YYYY-MM
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Mapeo de meses en español
  const monthMap: Record<string, string> = {
    ENERO: '01', ENE: '01',
    FEBRERO: '02', FEB: '02',
    MARZO: '03', MAR: '03',
    ABRIL: '04', ABR: '04',
    MAYO: '05', MAY: '05',
    JUNIO: '06', JUN: '06',
    JULIO: '07', JUL: '07',
    AGOSTO: '08', AGO: '08',
    SEPTIEMBRE: '09', SEP: '09', SEPT: '09',
    OCTUBRE: '10', OCT: '10',
    NOVIEMBRE: '11', NOV: '11',
    DICIEMBRE: '12', DIC: '12',
  };

  // Coincidencias tipo "MARZO 2026", "2026 MARZO", "MARZO-2026", "2026-MARZO"
  const parts = trimmed.split(/[\s\-_/]+/);
  let year = '';
  let month = '';

  for (const p of parts) {
    if (/^\d{4}$/.test(p)) {
      year = p;
    } else if (/^\d{1,2}$/.test(p)) {
      month = p.padStart(2, '0');
    } else if (monthMap[p]) {
      month = monthMap[p];
    }
  }

  if (year && month) {
    return `${year}-${month}`;
  }

  return trimmed;
}

export interface LocalStateValidationReport {
  valid: boolean;
  repairedCount: number;
  deduplicatedExpendiosCount: number;
  reconciledPagosCount: number;
  reconciledHistorialCount: number;
  expendiosCount: number;
  historialCount: number;
  targetMasterFile: string;
  checkedAt: string;
  issues: string[];
}

/**
 * Función de validación de estado que verifica y asegura la integridad de la base de datos local
 * antes de ejecutar el proceso de guardado en `database/camarca_master_db.json`.
 */
export function validateLocalDatabaseStateBeforeSave(
  db: DatabaseSchema,
  minimumExpectedExpendios = 1
): LocalStateValidationReport {
  const issues: string[] = [];
  let repairedCount = 0;
  let deduplicatedExpendiosCount = 0;
  let reconciledPagosCount = 0;
  let reconciledHistorialCount = 0;

  if (!db || typeof db !== 'object') {
    throw new Error('Validación de estado fallida: El objeto de base de datos local es inválido o nulo.');
  }

  if (!Array.isArray(db.expendios)) {
    db.expendios = [];
    repairedCount++;
    issues.push('El arreglo de expendios no estaba inicializado y fue restaurado.');
  }
  if (!Array.isArray(db.historial)) {
    db.historial = [];
    repairedCount++;
  }
  if (!Array.isArray(db.relacionPagos)) {
    db.relacionPagos = [];
    repairedCount++;
  }
  if (!Array.isArray(db.trazabilidad)) {
    db.trazabilidad = [];
    repairedCount++;
  }
  if (!Array.isArray(db.cuentasCargadas)) {
    db.cuentasCargadas = [];
    repairedCount++;
  }

  if (minimumExpectedExpendios > 0 && db.expendios.length < minimumExpectedExpendios) {
    throw new Error(
      `Validación de estado abortada por protección anti-pérdida: Se esperaban al menos ${minimumExpectedExpendios} expendios, pero el borrador contiene ${db.expendios.length}.`
    );
  }

  // 1. Verificar unicidad de IDs canónicos de expendios y fusionar posibles duplicados sin perder datos ni cédulas anteriores
  const canonicalById = new Map<string, any>();
  const cedulaToIdMap = new Map<string, string>();

  for (let i = 0; i < db.expendios.length; i++) {
    const exp = db.expendios[i];
    if (!exp || typeof exp !== 'object') continue;

    let cleanId = typeof exp.id === 'string' && exp.id.trim() ? exp.id.trim() : '';
    const cleanCedula = String(exp.cedula || '').trim();
    const cedDigits = cleanCedula.replace(/\D/g, '');

    if (!cleanId) {
      cleanId = cedDigits.length >= 4 ? `exp_ced_${cedDigits}` : `exp_repaired_${Date.now()}_${i}`;
      exp.id = cleanId;
      repairedCount++;
      issues.push(`Expendio en índice ${i} (${exp.localidad || exp.municipio || 'SIN_NOMBRE'}) no tenía ID canónico; asignado "${cleanId}".`);
    }

    // Sincronizar alias de campos de contacto y ubicación para coherencia total entre Admin y Expendio
    if (exp.direccionPunto && !exp.direccion) {
      exp.direccion = exp.direccionPunto;
    } else if (exp.direccion && !exp.direccionPunto) {
      exp.direccionPunto = exp.direccion;
    }
    if (exp.telefonoPunto && !exp.telefono) {
      exp.telefono = exp.telefonoPunto;
    } else if (exp.telefono && !exp.telefonoPunto) {
      exp.telefonoPunto = exp.telefono;
    }
    if (exp.localidad && !exp.municipio) {
      exp.municipio = exp.localidad;
    } else if (exp.municipio && !exp.localidad) {
      exp.localidad = exp.municipio;
    }

    const existing = canonicalById.get(cleanId);
    if (!existing) {
      canonicalById.set(cleanId, exp);
    } else {
      deduplicatedExpendiosCount++;
      repairedCount++;
      const revCurrent = Number(exp.revision) || 0;
      const revExisting = Number(existing.revision) || 0;
      const timeCurrent = new Date(exp.updatedAt || exp.fechaUltimaActualizacion || 0).getTime() || 0;
      const timeExisting = new Date(existing.updatedAt || existing.fechaUltimaActualizacion || 0).getTime() || 0;

      const currentWins = revCurrent > revExisting || (revCurrent === revExisting && timeCurrent >= timeExisting);
      const winner = currentWins ? exp : existing;
      const loser = currentWins ? existing : exp;

      const merged: any = { ...loser, ...winner, id: cleanId };
      const prevCeds = new Set<string>([
        ...(Array.isArray(winner.cedulasAnteriores) ? winner.cedulasAnteriores : []),
        ...(Array.isArray(loser.cedulasAnteriores) ? loser.cedulasAnteriores : []),
      ]);
      const loserCed = String(loser.cedula || '').trim();
      const winnerCed = String(winner.cedula || '').trim();
      if (loserCed && loserCed !== winnerCed) {
        prevCeds.add(loserCed);
      }
      if (prevCeds.size > 0) {
        merged.cedulasAnteriores = Array.from(prevCeds);
      }
      canonicalById.set(cleanId, merged);
      issues.push(`Expendio duplicado con ID "${cleanId}" fusionado automáticamente conservando revisión más reciente.`);
    }
  }

  db.expendios = Array.from(canonicalById.values());

  // Construir mapa de cédulas actuales y anteriores -> expendioId para integridad referencial
  for (const exp of db.expendios) {
    const cedDigits = String(exp.cedula || '').trim().replace(/\D/g, '');
    if (cedDigits.length >= 4 && exp.estado !== 'Inhabilitado') {
      cedulaToIdMap.set(cedDigits, exp.id);
    }
    if (Array.isArray((exp as any).cedulasAnteriores)) {
      for (const oldCed of (exp as any).cedulasAnteriores) {
        const oldDigits = String(oldCed || '').trim().replace(/\D/g, '');
        if (oldDigits.length >= 4 && !cedulaToIdMap.has(oldDigits)) {
          cedulaToIdMap.set(oldDigits, exp.id);
        }
      }
    }
  }

  // 2. Validar y reconciliar Relación de Pagos
  for (let i = 0; i < db.relacionPagos.length; i++) {
    const p = db.relacionPagos[i];
    if (!p) continue;
    if (!p.id) {
      p.id = `pago_repaired_${Date.now()}_${i}`;
      repairedCount++;
    }
    const pAny = p as any;
    if (!pAny.expendioId || !canonicalById.has(pAny.expendioId)) {
      const cleanCed = p.cedula ? String(p.cedula).trim().replace(/\D/g, '') : '';
      const matchedId = cleanCed ? cedulaToIdMap.get(cleanCed) : null;
      if (matchedId) {
        pAny.expendioId = matchedId;
        reconciledPagosCount++;
      } else if (pAny.expendioId) {
        pAny.expendioId = null;
      }
    }
  }

  // 3. Validar y reconciliar Historial Contable
  const seenHistIds = new Set<string>();
  for (let i = 0; i < db.historial.length; i++) {
    const h = db.historial[i];
    if (!h) continue;
    if (!h.id || seenHistIds.has(h.id)) {
      h.id = `${h.id || 'hist'}_${Date.now()}_${i}`;
      repairedCount++;
    }
    seenHistIds.add(h.id);
    const hAny = h as any;
    if (!hAny.expendioId || !canonicalById.has(hAny.expendioId)) {
      const cleanCed = h.cedula ? String(h.cedula).trim().replace(/\D/g, '') : '';
      const matchedId = cleanCed ? cedulaToIdMap.get(cleanCed) : null;
      if (matchedId) {
        hAny.expendioId = matchedId;
        reconciledHistorialCount++;
      }
    }
  }

  return {
    valid: true,
    repairedCount,
    deduplicatedExpendiosCount,
    reconciledPagosCount,
    reconciledHistorialCount,
    expendiosCount: db.expendios.length,
    historialCount: db.historial.length,
    targetMasterFile: 'database/camarca_master_db.json',
    checkedAt: new Date().toISOString(),
    issues,
  };
}

/**
 * Valida todas las invariantes de dominio de una base de datos antes de permitir un commit.
 * Lanza un error si se encuentra una inconsistencia grave que comprometería la integridad.
 */
export function validateDatabaseInvariants(db: DatabaseSchema): void {
  validateLocalDatabaseStateBeforeSave(db, 0);
}

/**
 * Auditor de integridad completo para la herramienta de diagnóstico del sistema.
 */
export function auditDatabaseIntegrity(db: DatabaseSchema): IntegrityCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const expendios = Array.isArray(db.expendios) ? db.expendios : [];
  const historial = Array.isArray(db.historial) ? db.historial : [];
  const pagos = Array.isArray(db.relacionPagos) ? db.relacionPagos : [];
  const trazabilidad = Array.isArray(db.trazabilidad) ? db.trazabilidad : [];
  const cuentas = Array.isArray(db.cuentasCargadas) ? db.cuentasCargadas : [];
  const accesos = Array.isArray(db.registrosAcceso) ? db.registrosAcceso : [];

  const expendioIdMap = new Map<string, any>();
  const cedulaMap = new Map<string, string[]>();

  for (const exp of expendios) {
    if (!exp.id) {
      errors.push(`Expendio sin ID: "${exp.nombre || exp.municipio || 'Desconocido'}"`);
      continue;
    }
    if (expendioIdMap.has(exp.id)) {
      errors.push(`Expendio ID duplicado: "${exp.id}"`);
    }
    expendioIdMap.set(exp.id, exp);

    const ced = String(exp.cedula || '').trim().replace(/\D/g, '');
    if (ced) {
      if (!cedulaMap.has(ced)) cedulaMap.set(ced, []);
      cedulaMap.get(ced)!.push(exp.id);
    }
  }

  // Comprobar cédulas duplicadas
  for (const [ced, ids] of cedulaMap.entries()) {
    if (ids.length > 1) {
      const activeMatches = ids.filter((id) => expendioIdMap.get(id)?.estado !== 'Inhabilitado');
      if (activeMatches.length > 1) {
        errors.push(`Inconsistencia de Cédula Duplicada: Cédula "${ced}" asignada a múltiples expendios activos: [${activeMatches.join(', ')}]`);
      } else {
        warnings.push(`Cédula "${ced}" asociada a múltiples expendios históricos/inactivos: [${ids.join(', ')}]`);
      }
    }
  }

  // Pagos huérfanos
  for (const p of pagos) {
    const pExpId = (p as any).expendioId;
    if (pExpId && !expendioIdMap.has(pExpId)) {
      warnings.push(`Pago "${p.id}" tiene expendioId no encontrado: "${pExpId}"`);
    }
  }

  // Historial huérfano
  for (const h of historial) {
    const hExpId = (h as any).expendioId;
    if (hExpId && !expendioIdMap.has(hExpId)) {
      warnings.push(`Historial "${h.id}" tiene expendioId no encontrado: "${hExpId}"`);
    }
  }

  return {
    healthy: errors.length === 0,
    errors,
    warnings,
    checkedAt: new Date().toISOString(),
    counts: {
      expendios: expendios.length,
      historial: historial.length,
      relacionPagos: pagos.length,
      trazabilidad: trazabilidad.length,
      cuentasCargadas: cuentas.length,
      registrosAcceso: accesos.length,
    },
  };
}
