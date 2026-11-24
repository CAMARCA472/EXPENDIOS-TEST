import { db } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { DatabaseSchema, ExpendioData, HistorialItem, PagoRelacionItem, TrazabilidadExpendio } from '../src/types.ts';

export class ConcurrencyConflictError extends Error {
  public status: number;
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyConflictError';
    this.status = 409;
  }
}

export interface PostgresMutationOptions {
  entityType?: string;
  entityId?: string;
  expectedRevision?: number;
  skipPostgresTransaction?: boolean;
}

/**
 * Aplica todos los cambios de una mutación dentro de una transacción PostgreSQL (BEGIN ... COMMIT / ROLLBACK)
 */
export async function persistChangesToPostgresTransaction(
  tx: any,
  draftDb: DatabaseSchema,
  cleanSnapshot: DatabaseSchema,
  options: PostgresMutationOptions = {}
): Promise<void> {
  // 0. Bloqueo pesimista de serialización a nivel de fila en PostgreSQL para transacciones concurrentes
  try {
    await tx
      .select({ key: schema.systemConfig.key })
      .from(schema.systemConfig)
      .where(eq(schema.systemConfig.key, 'global_config'))
      .for('update');
  } catch {}

  // 1. CONTROL DE CONCURRENCIA OPTIMISTA SOBRE EXPENDIO ESPECÍFICO (Si aplica)
  if (options.entityType === 'expendio' && options.entityId && options.expectedRevision !== undefined) {
    const existingRows = await tx
      .select({ id: schema.expendios.id, revision: schema.expendios.revision })
      .from(schema.expendios)
      .where(eq(schema.expendios.id, options.entityId))
      .for('update');

    if (existingRows.length > 0) {
      const currentRev = Number(existingRows[0].revision) || 0;
      if (currentRev !== options.expectedRevision) {
        throw new ConcurrencyConflictError(
          `Conflicto de concurrencia en PostgreSQL: El expendio ${options.entityId} tiene revisión ${currentRev}, pero se esperaba ${options.expectedRevision}.`
        );
      }
    }
  }

  // 2. EXPENDIOS: Detectar cambios y persistir
  const cleanExpMap = new Map((cleanSnapshot.expendios || []).map((e) => [e.id, e]));
  const draftExpMap = new Map((draftDb.expendios || []).map((e) => [e.id, e]));

  // Detectar eliminados
  const deletedExpIds: string[] = [];
  for (const [id] of cleanExpMap) {
    if (!draftExpMap.has(id)) {
      deletedExpIds.push(id);
    }
  }
  if (deletedExpIds.length > 0) {
    await tx.delete(schema.expendios).where(inArray(schema.expendios.id, deletedExpIds));
  }

  // Detectar creados o modificados
  const changedExp: ExpendioData[] = [];
  for (const exp of draftDb.expendios || []) {
    const old = cleanExpMap.get(exp.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(exp)) {
      changedExp.push(exp);
    }
  }

  if (changedExp.length > 0) {
    for (const exp of changedExp) {
      const existing = cleanExpMap.get(exp.id);
      const isNew = !existing;

      const expAny = exp as any;
      const record = {
        id: String(exp.id),
        numeroExpendio: expAny.numeroExpendio ? String(expAny.numeroExpendio) : null,
        codigo: expAny.codigo ? String(expAny.codigo) : null,
        nombrePunto: String(expAny.nombrePunto || exp.localidad || exp.municipio || 'PUNTO EXPENDIO'),
        departamento: String(expAny.departamento || 'CUNDINAMARCA'),
        municipio: String(exp.municipio || exp.localidad || 'CUNDINAMARCA'),
        localidad: exp.localidad ? String(exp.localidad) : null,
        centroOperativo: exp.centroOperativo ? String(exp.centroOperativo) : null,
        centroAcopio: exp.centroAcopio ? String(exp.centroAcopio) : null,
        regional: exp.regional ? String(exp.regional) : 'ORIENTE',
        direccionPunto: String(exp.direccionPunto || 'PENDIENTE'),
        encargado: String(exp.encargado || 'ENCARGADO'),
        cedula: String(exp.cedula || '0'),
        telefonoPunto: String(exp.telefonoPunto || '0'),
        cuentaBancaria: exp.cuentaBancaria ? String(exp.cuentaBancaria) : null,
        banco: exp.banco ? String(exp.banco) : 'NEQUI',
        tipoCuenta: exp.tipoCuenta ? String(exp.tipoCuenta) : 'AHORROS',
        correoElectronico: exp.correoElectronico ? String(exp.correoElectronico) : null,
        usuarioSipost: exp.usuarioSipost ? String(exp.usuarioSipost) : null,
        internet: exp.internet ? String(exp.internet) : 'SI',
        nit: exp.nit ? String(exp.nit) : null,
        valorMensual: String(exp.valorMensual || expAny.valor || '0'),
        admisionSipost: String(exp.admisionSipost || '0'),
        valorVariable: String(exp.valorVariable || '0'),
        observaciones: exp.observaciones ? String(exp.observaciones) : null,
        observacion: exp.observacion ? String(exp.observacion) : null,
        estado: String(exp.estado || 'ACTIVO'),
        activo: expAny.activo !== false,
        primeraVezActualizado: !!exp.primeraVezActualizado,
        bienvenidaRealizada: !!exp.bienvenidaRealizada,
        fechaUltimaActualizacion: exp.fechaUltimaActualizacion ? String(exp.fechaUltimaActualizacion) : null,
        tieneAviso: exp.tieneAviso ? String(exp.tieneAviso) : '',
        tieneBascula: exp.tieneBascula ? String(exp.tieneBascula) : '',
        tieneMatasello: exp.tieneMatasello ? String(exp.tieneMatasello) : '',
        tieneImpresora: exp.tieneImpresora ? String(exp.tieneImpresora) : '',
        tieneComputador: exp.tieneComputador ? String(exp.tieneComputador) : '',
        motivoFaltaAviso: exp.motivoFaltaAviso ? String(exp.motivoFaltaAviso) : null,
        motivoFaltaBascula: exp.motivoFaltaBascula ? String(exp.motivoFaltaBascula) : null,
        motivoFaltaMatasello: exp.motivoFaltaMatasello ? String(exp.motivoFaltaMatasello) : null,
        motivoFaltaImpresora: exp.motivoFaltaImpresora ? String(exp.motivoFaltaImpresora) : null,
        motivoFaltaComputador: exp.motivoFaltaComputador ? String(exp.motivoFaltaComputador) : null,
        fotoAvisoUrl: exp.fotoAvisoUrl || exp.letreroUrl || null,
        fotoPanoramicaUrl: exp.fotoPanoramicaUrl || exp.fotoFachadaUrl || null,
        fotoMataselloUrl: exp.fotoMataselloUrl || exp.mataselloUrl || null,
        fotoBasculaUrl: exp.fotoBasculaUrl || exp.basculaUrl || null,
        fotoContratistaUrl: exp.fotoContratistaUrl || null,
        fotoHorarioUrl: exp.fotoHorarioUrl || null,
        fotoTarifasUrl: exp.fotoTarifasUrl || null,
        letreroUrl: exp.letreroUrl || exp.fotoAvisoUrl || null,
        basculaUrl: exp.basculaUrl || exp.fotoBasculaUrl || null,
        mataselloUrl: exp.mataselloUrl || exp.fotoMataselloUrl || null,
        computadorUrl: exp.computadorUrl || null,
        contratoUrl: exp.contratoUrl || null,
        contratoPdfUrl: exp.contratoPdfUrl || null,
        revision: isNew ? (Number(exp.revision) || 1) : Math.max(Number(exp.revision) || 0, Number(existing.revision) || 0) + 1,
        updatedAt: new Date(),
      };

      exp.revision = record.revision;

      if (isNew) {
        await tx.insert(schema.expendios).values(record);
      } else {
        // Actualizar cédula si fue modificada explícitamente en la edición
        if (exp.cedula) {
          record.cedula = String(exp.cedula).trim();
        }

        // Control de concurrencia optimista por versión
        const expectedRev = (options.expectedRevision !== undefined && exp.id === options.entityId)
          ? options.expectedRevision
          : undefined;

        const whereClause = expectedRev !== undefined
          ? and(eq(schema.expendios.id, exp.id), eq(schema.expendios.revision, expectedRev))
          : eq(schema.expendios.id, exp.id);

        const updateRes = await tx
          .update(schema.expendios)
          .set({
            ...record,
            revision: sql`${schema.expendios.revision} + 1`,
          })
          .where(whereClause)
          .returning({ newRevision: schema.expendios.revision });

        if (expectedRev !== undefined && (!updateRes || updateRes.length === 0)) {
          throw new ConcurrencyConflictError(
            `Conflicto de concurrencia en PostgreSQL: El expendio ${exp.id} fue modificado por otra transacción simultánea (revisión esperada: ${expectedRev}).`
          );
        }

        if (updateRes && updateRes[0]?.newRevision) {
          exp.revision = Number(updateRes[0].newRevision);
        }
      }
    }
  }

  // 3. HISTORIAL: Persistir elementos nuevos o modificados
  const cleanHistMap = new Map((cleanSnapshot.historial || []).map((h) => [h.id, h]));
  const changedHist: HistorialItem[] = [];
  for (const h of draftDb.historial || []) {
    const old = cleanHistMap.get(h.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(h)) {
      changedHist.push(h);
    }
  }

  // Detectar eliminados en historial
  const deletedHistIds: string[] = [];
  const draftHistMap = new Map((draftDb.historial || []).map((h) => [h.id, h]));
  for (const [id] of cleanHistMap) {
    if (!draftHistMap.has(id)) {
      deletedHistIds.push(id);
    }
  }
  if (deletedHistIds.length > 0) {
    await tx.delete(schema.historialCuentas).where(inArray(schema.historialCuentas.id, deletedHistIds));
  }

  if (changedHist.length > 0) {
    for (const item of changedHist) {
      const itemAny = item as any;
      const montoVal = item.monto !== undefined ? item.monto : (itemAny.totalPagar || itemAny.valor || itemAny.cuentaData?.valorNeto || 0);

      // Extraer mes y año si no vienen explícitos
      let mesVal = itemAny.mes;
      let anioVal = itemAny.anio;
      if (!mesVal || !anioVal) {
        const rawPer = String(item.periodo || '').toUpperCase();
        const meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
        for (const m of meses) {
          if (rawPer.includes(m)) {
            mesVal = m;
            break;
          }
        }
        const mYear = rawPer.match(/\b(20\d\d)\b/);
        if (mYear) anioVal = mYear[1];
      }
      mesVal = String(mesVal || 'MARZO').toUpperCase();
      anioVal = String(anioVal || '2026');

      // Vincular expendioId de forma segura contra llave foránea
      const normMuni = (s: any) => String(s || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const validExpIds = new Set((draftDb.expendios || []).map((e) => String(e.id)));
      let expId = itemAny.expendioId && validExpIds.has(String(itemAny.expendioId)) ? String(itemAny.expendioId) : '';
      if (!expId) {
        const cleanCed = String(item.cedula || itemAny.cuentaData?.cedula || '').replace(/\D/g, '');
        const itemMuni = normMuni(itemAny.municipio || item.expendio || itemAny.cuentaData?.municipio || itemAny.cuentaData?.expendio);
        const matched =
          (draftDb.expendios || []).find((e) => cleanCed && String(e.cedula || '').replace(/\D/g, '') === cleanCed) ||
          (draftDb.expendios || []).find((e) => itemMuni && normMuni(e.municipio || e.localidad) === itemMuni);
        if (matched) expId = String(matched.id);
      }
      if (!expId) {
        // Si no existe expendio vinculado en el catálogo, omitir inserción huérfana para no romper FK
        continue;
      }

      const record = {
        id: String(item.id),
        consecutivo: itemAny.consecutivo ? String(itemAny.consecutivo) : null,
        numeroCuenta: itemAny.numeroCuenta ? String(itemAny.numeroCuenta) : null,
        expendioId: expId,
        encargado: String(item.encargado || ''),
        cedula: String(item.cedula || ''),
        expendio: String(item.expendio || itemAny.municipio || itemAny.localidad || ''),
        municipio: itemAny.municipio ? String(itemAny.municipio) : null,
        localidad: itemAny.localidad ? String(itemAny.localidad) : null,
        banco: itemAny.banco ? String(itemAny.banco) : null,
        cuentaBancaria: itemAny.cuentaBancaria ? String(itemAny.cuentaBancaria) : null,
        mes: mesVal,
        anio: anioVal,
        periodo: String(item.periodo || `${mesVal} ${anioVal}`),
        totalPagar: String(montoVal),
        monto: String(montoVal),
        valorBase: String(itemAny.valorBase || itemAny.cuentaData?.cargoBasico || itemAny.cuentaData?.valorBase || '0'),
        valorBruto: String(itemAny.valorBruto || itemAny.cuentaData?.pagoTotal || itemAny.cuentaData?.valorBruto || '0'),
        fecha: item.fecha ? String(item.fecha) : (itemAny.fechaGeneracion ? String(itemAny.fechaGeneracion) : null),
        fechaGeneracion: itemAny.fechaGeneracion ? String(itemAny.fechaGeneracion) : (item.fecha ? String(item.fecha) : null),
        estado: String(item.estado || 'GENERADA'),
        tipo: String(item.tipo || 'Cuenta de Cobro'),
        detalles: item.detalles ? String(item.detalles) : null,
        cuentaData: item.cuentaData || null,
        soporteUrl: item.soporteUrl ? String(item.soporteUrl) : null,
        soporteFirmadoUrl: item.soporteFirmadoUrl ? String(item.soporteFirmadoUrl) : null,
        cuentaCargadaId: item.cuentaCargadaId ? String(item.cuentaCargadaId) : null,
        cuentaFirmadaCargada: !!item.cuentaFirmadaCargada,
        fechaCargueFirmada: item.fechaCargueFirmada ? String(item.fechaCargueFirmada) : null,
        conciliadoConIa: !!item.conciliadoConIA,
        novedades: itemAny.novedades || null,
        deducciones: itemAny.deducciones || null,
        retenciones: itemAny.retenciones || null,
        observaciones: itemAny.observaciones ? String(itemAny.observaciones) : null,
        updatedAt: new Date(),
      };

      await tx
        .insert(schema.historialCuentas)
        .values(record)
        .onConflictDoUpdate({
          target: schema.historialCuentas.id,
          set: {
            expendioId: sql`EXCLUDED.expendio_id`,
            encargado: sql`EXCLUDED.encargado`,
            cedula: sql`EXCLUDED.cedula`,
            expendio: sql`EXCLUDED.expendio`,
            municipio: sql`EXCLUDED.municipio`,
            banco: sql`EXCLUDED.banco`,
            cuentaBancaria: sql`EXCLUDED.cuenta_bancaria`,
            mes: sql`EXCLUDED.mes`,
            anio: sql`EXCLUDED.anio`,
            periodo: sql`EXCLUDED.periodo`,
            totalPagar: sql`EXCLUDED.total_pagar`,
            monto: sql`EXCLUDED.monto`,
            fecha: sql`EXCLUDED.fecha`,
            estado: sql`EXCLUDED.estado`,
            tipo: sql`EXCLUDED.tipo`,
            detalles: sql`EXCLUDED.detalles`,
            cuentaData: sql`EXCLUDED.cuenta_data`,
            soporteUrl: sql`EXCLUDED.soporte_url`,
            soporteFirmadoUrl: sql`EXCLUDED.soporte_firmado_url`,
            cuentaCargadaId: sql`EXCLUDED.cuenta_cargada_id`,
            cuentaFirmadaCargada: sql`EXCLUDED.cuenta_firmada_cargada`,
            novedades: sql`EXCLUDED.novedades`,
            deducciones: sql`EXCLUDED.deducciones`,
            retenciones: sql`EXCLUDED.retenciones`,
            observaciones: sql`EXCLUDED.observaciones`,
            updatedAt: new Date(),
          },
        });
    }
  }

  // 4. RELACIÓN DE PAGOS: Persistir elementos nuevos o modificados
  const cleanPagosMap = new Map((cleanSnapshot.relacionPagos || []).map((p) => [p.id, p]));
  const draftPagosMap = new Map((draftDb.relacionPagos || []).map((p) => [p.id, p]));

  // Detectar eliminados en relacionPagos
  const deletedPagosIds: string[] = [];
  for (const [id] of cleanPagosMap) {
    if (!draftPagosMap.has(id)) {
      deletedPagosIds.push(id);
    }
  }
  if (deletedPagosIds.length > 0) {
    await tx.delete(schema.relacionPagos).where(inArray(schema.relacionPagos.id, deletedPagosIds));
  }

  const changedPagos: PagoRelacionItem[] = [];
  for (const p of draftDb.relacionPagos || []) {
    const old = cleanPagosMap.get(p.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(p)) {
      changedPagos.push(p);
    }
  }

  if (changedPagos.length > 0) {
    for (const pago of changedPagos) {
      const pagoAny = pago as any;
      const valorVal = pago.valorCancelar !== undefined ? pago.valorCancelar : (pagoAny.valorPagar || pagoAny.totalPagar || pagoAny.valor || 0);

      let expId = pagoAny.expendioId;
      if (!expId && pago.cedula) {
        const cleanCed = String(pago.cedula).replace(/\D/g, '');
        const matched = (draftDb.expendios || []).find((e) => String(e.cedula || '').replace(/\D/g, '') === cleanCed);
        if (matched) expId = matched.id;
      }

      const mesVal = pago.mes ? String(pago.mes).toUpperCase() : 'MARZO';
      const anioVal = pago.anio ? String(pago.anio) : '2026';

      const record = {
        id: String(pago.id),
        expendioId: expId ? String(expId) : null,
        consecutivo: pago.consecutivo ? String(pago.consecutivo) : null,
        numeroCuenta: pagoAny.numeroCuenta ? String(pagoAny.numeroCuenta) : null,
        centroOperativo: String(pago.centroOperativo || 'PO. ARAUCA'),
        municipio: String(pago.municipio || ''),
        concepto: String(pago.concepto || `PAGO MES ${mesVal} EXPENDIO ${pago.municipio || ''}`),
        nombreEncargado: String(pago.nombreEncargado || pagoAny.beneficiario || pagoAny.encargado || ''),
        beneficiario: String(pago.nombreEncargado || pagoAny.beneficiario || pagoAny.encargado || ''),
        cedula: String(pago.cedula || ''),
        banco: String(pago.banco || 'NEQUI'),
        cuenta: String(pago.cuenta || pagoAny.numeroCuentaBancaria || ''),
        numeroCuentaBancaria: String(pago.cuenta || pagoAny.numeroCuentaBancaria || ''),
        tipoCuenta: String(pagoAny.tipoCuenta || 'AHORROS'),
        valorPagar: String(valorVal),
        valorCancelar: String(valorVal),
        periodo: String(pagoAny.periodo || `${mesVal} ${anioVal}`),
        mes: mesVal,
        anio: anioVal,
        fechaPago: pagoAny.fechaPago ? String(pagoAny.fechaPago) : null,
        estado: String(pago.estado || 'Pendiente'),
        cuentaCargadaId: pago.cuentaCargadaId ? String(pago.cuentaCargadaId) : null,
        soporteUrl: pago.soporteUrl ? String(pago.soporteUrl) : null,
        cambioDetectado: pago.cambioDetectado || null,
        loteId: pagoAny.loteId ? String(pagoAny.loteId) : null,
        observaciones: pagoAny.observaciones ? String(pagoAny.observaciones) : null,
        updatedAt: new Date(),
      };

      await tx
        .insert(schema.relacionPagos)
        .values(record)
        .onConflictDoUpdate({
          target: schema.relacionPagos.id,
          set: {
            expendioId: sql`EXCLUDED.expendio_id`,
            centroOperativo: sql`EXCLUDED.centro_operativo`,
            municipio: sql`EXCLUDED.municipio`,
            concepto: sql`EXCLUDED.concepto`,
            nombreEncargado: sql`EXCLUDED.nombre_encargado`,
            beneficiario: sql`EXCLUDED.beneficiario`,
            cedula: sql`EXCLUDED.cedula`,
            banco: sql`EXCLUDED.banco`,
            cuenta: sql`EXCLUDED.cuenta`,
            numeroCuentaBancaria: sql`EXCLUDED.numero_cuenta_bancaria`,
            valorPagar: sql`EXCLUDED.valor_pagar`,
            valorCancelar: sql`EXCLUDED.valor_cancelar`,
            mes: sql`EXCLUDED.mes`,
            anio: sql`EXCLUDED.anio`,
            periodo: sql`EXCLUDED.periodo`,
            estado: sql`EXCLUDED.estado`,
            cuentaCargadaId: sql`EXCLUDED.cuenta_cargada_id`,
            soporteUrl: sql`EXCLUDED.soporte_url`,
            cambioDetectado: sql`EXCLUDED.cambio_detectado`,
            observaciones: sql`EXCLUDED.observaciones`,
            updatedAt: new Date(),
          },
        });
    }
  }

  // 5. TRAZABILIDAD: Persistir nuevos eventos generados durante esta mutación
  const cleanTrazMap = new Map((cleanSnapshot.trazabilidad || []).map((t) => [t.id, t]));
  const draftTrazMap = new Map((draftDb.trazabilidad || []).map((t) => [t.id, t]));

  // Detectar eliminados en trazabilidad
  const deletedTrazIds: string[] = [];
  for (const [id] of cleanTrazMap) {
    if (!draftTrazMap.has(id)) {
      deletedTrazIds.push(id);
    }
  }
  if (deletedTrazIds.length > 0) {
    await tx.delete(schema.trazabilidad).where(inArray(schema.trazabilidad.id, deletedTrazIds));
  }

  const cleanTrazIds = new Set((cleanSnapshot.trazabilidad || []).map((t) => t.id));
  const newTraz = (draftDb.trazabilidad || []).filter((t) => !cleanTrazIds.has(t.id));

  if (newTraz.length > 0) {
    const envMode = String(process.env.APP_ENV || 'test').toLowerCase();
    
    for (const t of newTraz) {
      const actorIdVal = String(t.actorId || '').trim();
      const expIdVal = String(t.expendioId || '').trim();
      
      // REGLAS ESTRICTAS DE TRAZABILIDAD EN PRODUCCIÓN:
      // 1. No debe insertarse trazabilidad con keywords de test / mock / demo / fake
      const testKeywords = ['test', 'mock', 'demo', 'fake', 'sample', 'fixture', 'dummy', 'simula', 'synthetic', 'health', 'check', 'internal', 'request', 'attemp', 'prueva', 'prueba', 'unknown'];
      const searchStr = `${t.novedad || ''} ${t.observaciones || ''} ${t.registradoPor || ''} ${t.municipio || ''} ${t.localidad || ''} ${actorIdVal}`.toLowerCase();
      let isTestRecord = false;
      for (const keyword of testKeywords) {
        if (searchStr.includes(keyword)) {
          isTestRecord = true;
          break;
        }
      }

      if (isTestRecord) {
        console.warn(`[Trazabilidad DB Guard] Descartado registro debido a patrón de prueba/simulación: "${t.id}"`);
        continue;
      }

      // 2. En producción, validar que expendioId exista realmente
      if (!expIdVal) {
        console.warn(`[Trazabilidad DB Guard] Descartado: El registro "${t.id}" no posee un expendioId válido.`);
        continue;
      }

      // Validar si el expendioId realmente existe en el catálogo maestro en memoria/SNAPSHOT
      const expendioExists = (draftDb.expendios || []).some((e) => String(e.id) === expIdVal);
      if (!expendioExists) {
        console.warn(`[Trazabilidad DB Guard] Descartado: El expendioId "${expIdVal}" no existe en el catálogo maestro de PostgreSQL.`);
        continue;
      }

      // 3. Validar que exista actorId de forma obligatoria
      if (!actorIdVal) {
        console.warn(`[Trazabilidad DB Guard] Descartado: El registro "${t.id}" no posee un actorId (identidad de operador) válido.`);
        continue;
      }

      const record = {
        id: String(t.id),
        expendioId: expIdVal,
        actorId: actorIdVal,
        actorRole: String(t.actorRole || 'expendio'),
        timestamp: String(t.timestamp || new Date().toISOString()),
        municipio: t.municipio ? String(t.municipio) : null,
        localidad: t.localidad ? String(t.localidad) : null,
        novedad: String(t.novedad || 'Registro de auditoría'),
        encargadoAnterior: t.encargadoAnterior ? String(t.encargadoAnterior) : null,
        encargadoNuevo: t.encargadoNuevo ? String(t.encargadoNuevo) : null,
        cedulaAnterior: t.cedulaAnterior ? String(t.cedulaAnterior) : null,
        cedulaNuevo: t.cedulaNuevo ? String(t.cedulaNuevo) : null,
        registradoPor: t.registradoPor ? String(t.registradoPor) : null,
        observaciones: t.observaciones ? String(t.observaciones) : null,
        fechaRegistro: String(t.fechaRegistro || new Date().toISOString()),
        commitId: t.commitId ? String(t.commitId) : null,
        before: t.before ? t.before : null,
        after: t.after ? t.after : null,
      };

      await tx.insert(schema.trazabilidad).values(record).onConflictDoNothing();
    }
  }

  // 6. CUENTAS CARGADAS: Persistir si cambiaron
  if (draftDb.cuentasCargadas) {
    const cleanCuentasMap = new Map((cleanSnapshot.cuentasCargadas || []).map((c: any) => [c.id, c]));
    const draftCuentasMap = new Map((draftDb.cuentasCargadas || []).map((c: any) => [c.id, c]));

    // Detectar eliminados en cuentasCargadas
    const deletedCuentasIds: string[] = [];
    for (const [id] of cleanCuentasMap) {
      if (!draftCuentasMap.has(id)) {
        deletedCuentasIds.push(id);
      }
    }
    if (deletedCuentasIds.length > 0) {
      await tx.delete(schema.cuentasCargadas).where(inArray(schema.cuentasCargadas.id, deletedCuentasIds));
    }

    const cleanCuentasIds = new Set((cleanSnapshot.cuentasCargadas || []).map((c: any) => c.id));
    const newCuentas = (draftDb.cuentasCargadas || []).filter((c: any) => !cleanCuentasIds.has(c.id));
    for (const c of newCuentas as any[]) {
      await tx
        .insert(schema.cuentasCargadas)
        .values({
          id: String(c.id),
          expendioId: c.expendioId ? String(c.expendioId) : null,
          encargado: String(c.encargado || ''),
          cedula: String(c.cedula || ''),
          mes: String(c.mes || ''),
          anio: String(c.anio || ''),
          periodo: String(c.periodo || ''),
          nombreArchivo: String(c.nombreArchivo || 'archivo.pdf'),
          urlArchivo: c.urlArchivo ? String(c.urlArchivo) : null,
          tipoArchivo: c.tipoArchivo ? String(c.tipoArchivo) : null,
          estado: String(c.estado || 'CARGADA'),
          fechaCarga: String(c.fechaCarga || new Date().toISOString()),
          analizadaIa: !!c.analizadaIa,
          datosIa: c.datosIa || null,
          observaciones: c.observaciones ? String(c.observaciones) : null,
        })
        .onConflictDoNothing();
    }
  }

  // 7. CONFIGURACIÓN DEL SISTEMA Y REVISIÓN GLOBAL
  if (draftDb.config || draftDb.revision) {
    const globalPayload = {
      ...(draftDb.config || {}),
      globalRevision: draftDb.revision,
      lastCommitId: (draftDb as any).commitId,
      updatedAt: draftDb.updatedAt,
    };

    await tx
      .insert(schema.systemConfig)
      .values({
        key: 'global_config',
        value: globalPayload,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.systemConfig.key,
        set: {
          value: globalPayload,
          updatedAt: new Date(),
        },
      });
  }
}
