import assert from 'assert';
import { db } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { mutateDatabase, loadDatabase, ConcurrencyConflictError } from '../server/dbStore.ts';

async function runFase1Tests() {
  console.log('========================================================');
  console.log('PRUEBAS FASE 1: POSTGRESQL FUENTE DE VERDAD AUTORITATIVA');
  console.log('========================================================\n');

  // Test 1: Verificar que PostgreSQL está conectado y contiene registros
  console.log('[Test 1] Verificando conexión directa a PostgreSQL...');
  const expCountRes = await db.select({ count: sql<number>`count(*)` }).from(schema.expendios);
  const initialExpCount = Number(expCountRes[0]?.count || 0);
  console.log(`✓ PostgreSQL conectado. Registros de expendios en tabla 'expendios': ${initialExpCount}`);
  assert(initialExpCount > 0, 'Debe haber expendios cargados en PostgreSQL');

  // Test 2: Escritura a través de mutateDatabase() persiste directamente en PostgreSQL
  console.log('\n[Test 2] Ejecutando mutación de negocio en mutateDatabase()...');
  const testDb = loadDatabase();
  const targetExp = testDb.expendios[0];
  const oldObservacion = targetExp.observacion || '';
  const newObservacion = `Prueba Fase 1 Timestamp ${Date.now()}`;

  await mutateDatabase((database) => {
    const exp = database.expendios.find((e) => e.id === targetExp.id);
    if (!exp) throw new Error('Expendio no encontrado');
    exp.observacion = newObservacion;
  }, { entityType: 'expendio', entityId: targetExp.id });

  // Consultar PostgreSQL directamente (sin usar caché ni memoria)
  const [pgRow] = await db
    .select({ id: schema.expendios.id, observacion: schema.expendios.observacion, revision: schema.expendios.revision })
    .from(schema.expendios)
    .where(eq(schema.expendios.id, targetExp.id));

  assert(pgRow, 'El registro debe existir en PostgreSQL');
  assert.strictEqual(pgRow.observacion, newObservacion, 'PostgreSQL debe contener el nuevo valor inmediatamente tras COMMIT');
  console.log(`✓ Test 2 Exitoso: mutateDatabase() escribió directamente en PostgreSQL (Revisión actual: ${pgRow.revision}).`);

  // Test 3: Regla de Cédula Inmutable
  console.log('\n[Test 3] Verificando invariante de Cédula Inmutable en PostgreSQL...');
  const originalCedula = targetExp.cedula;
  await mutateDatabase((database) => {
    const exp = database.expendios.find((e) => e.id === targetExp.id);
    if (!exp) throw new Error('Expendio no encontrado');
    exp.cedula = '99999999999'; // Intento no autorizado de cambiar cédula
  }, { entityType: 'expendio', entityId: targetExp.id });

  const [pgRowAfterCed] = await db
    .select({ cedula: schema.expendios.cedula })
    .from(schema.expendios)
    .where(eq(schema.expendios.id, targetExp.id));

  assert.strictEqual(pgRowAfterCed.cedula, originalCedula, 'La cédula en PostgreSQL NO debe modificarse');
  console.log(`✓ Test 3 Exitoso: Cédula inmutable preservada en PostgreSQL ("${pgRowAfterCed.cedula}").`);

  // Test 4: Concurrencia Optimista en PostgreSQL (revision mismatch)
  console.log('\n[Test 4] Verificando rechazo por conflicto de concurrencia optimista en PostgreSQL...');
  let conflictCaught = false;
  try {
    await mutateDatabase((database) => {
      const exp = database.expendios.find((e) => e.id === targetExp.id);
      if (!exp) throw new Error('Expendio no encontrado');
      exp.observacion = 'Intento concurrente obsoleto';
    }, {
      entityType: 'expendio',
      entityId: targetExp.id,
      expectedRevision: 999999, // Revisión desactualizada intencional
    });
  } catch (err: any) {
    if (err instanceof ConcurrencyConflictError || err.name === 'ConcurrencyConflictError' || (err.message && err.message.includes('concurrencia'))) {
      conflictCaught = true;
    }
  }
  assert.strictEqual(conflictCaught, true, 'Debe lanzar ConcurrencyConflictError ante revisión desactualizada');
  console.log('✓ Test 4 Exitoso: Concurrencia optimista en PostgreSQL rechazó la transacción obsoleta.');

  // Test 5: Rollback atómico si la mutación falla
  console.log('\n[Test 5] Verificando ROLLBACK atómico en PostgreSQL ante fallo de invariante...');
  const [beforeRollback] = await db
    .select({ revision: schema.expendios.revision, observacion: schema.expendios.observacion })
    .from(schema.expendios)
    .where(eq(schema.expendios.id, targetExp.id));

  let rollbackCaught = false;
  try {
    await mutateDatabase((database) => {
      const exp = database.expendios.find((e) => e.id === targetExp.id);
      if (!exp) throw new Error('Expendio no encontrado');
      exp.observacion = 'Texto que no debe persistirse por fallo posterior';
      // Inyectar fallo antes de commit
      throw new Error('SIMULATED_BUSINESS_LOGIC_FAILURE');
    }, { entityType: 'expendio', entityId: targetExp.id });
  } catch (e: any) {
    if (e.message === 'SIMULATED_BUSINESS_LOGIC_FAILURE') rollbackCaught = true;
  }
  assert.strictEqual(rollbackCaught, true, 'Debe atrapar el error simulado');

  const [afterRollback] = await db
    .select({ revision: schema.expendios.revision, observacion: schema.expendios.observacion })
    .from(schema.expendios)
    .where(eq(schema.expendios.id, targetExp.id));

  assert.strictEqual(afterRollback.observacion, beforeRollback.observacion, 'PostgreSQL no debe haber guardado cambios');
  assert.strictEqual(afterRollback.revision, beforeRollback.revision, 'La revisión en PostgreSQL no debe haber avanzado');
  console.log('✓ Test 5 Exitoso: ROLLBACK garantizado en PostgreSQL. Estado intacto.');

  console.log('\n========================================================');
  console.log('✓✓✓ TODAS LAS PRUEBAS DE LA FASE 1 PASARON CON ÉXITO');
  console.log('========================================================');
  process.exit(0);
}

runFase1Tests().catch((err) => {
  console.error('Error en pruebas Fase 1:', err);
  process.exit(1);
});
