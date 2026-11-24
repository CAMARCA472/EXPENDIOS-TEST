import assert from 'assert';
import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { mutateDatabase } from '../server/dbStore.js';

async function testPostgresOnlyRuntime() {
  console.log('==============================================================');
  console.log('TEST 2: RUNTIME 100% POSTGRESQL PURO Y TRANSACCIONAL');
  console.log('==============================================================\n');

  // 1. Conexión directa a PostgreSQL
  console.log('[Paso 1] Verificando conexión activa a PostgreSQL...');
  const expCountRows = await db.select().from(schema.expendios);
  assert(expCountRows.length > 0, 'Debe haber registros en la tabla expendios');
  console.log(`  ✓ Conectado a PostgreSQL. Total expendios en tabla: ${expCountRows.length}.`);

  // 2. Transacción de mutación de negocio en PostgreSQL
  console.log('\n[Paso 2] Ejecutando mutación de negocio mediante transacción ACID en PostgreSQL...');
  const testExpId = `exp-pg-only-${Date.now()}`;
  const testCedula = `888${Date.now().toString().slice(-7)}`;
  const nowIso = new Date().toISOString();

  await mutateDatabase((database) => {
    database.expendios.push({
      id: testExpId,
      estado: 'Activo',
      centroOperativo: 'PO.BUCARAMANGA',
      centroAcopio: 'GIRON',
      localidad: 'TEST POSTGRES ONLY',
      municipio: 'GIRON',
      encargado: 'PRUEBA POSTGRES',
      cedula: testCedula,
      direccionPunto: 'CALLE 123 # 45-67',
      telefonoPunto: '3001234567',
      usuarioSipost: 'NO ASIGNADO',
      internet: 'SI',
      nit: '900062917',
      correoElectronico: 'test@postgres.com',
      observacion: 'Creado en prueba de runtime exclusivo PostgreSQL',
      valorMensual: 150000,
      fechaUltimaActualizacion: nowIso.split('T')[0],
      updatedAt: nowIso,
      revision: 1,
    });
  });

  const [createdRow] = await db.select().from(schema.expendios).where(eq(schema.expendios.id, testExpId));
  assert(createdRow, 'El registro debe existir en PostgreSQL');
  assert.strictEqual(createdRow.id, testExpId);
  console.log(`  ✓ Registro creado y verificado directamente en tabla PostgreSQL (ID: "${createdRow.id}").`);

  // 3. Rollback atómico en PostgreSQL
  console.log('\n[Paso 3] Provocando fallo para verificar ROLLBACK transaccional en PostgreSQL...');
  let errorCaught = false;
  try {
    await mutateDatabase((database) => {
      const exp = database.expendios.find((e) => e.id === testExpId);
      if (exp) {
        exp.encargado = 'INTENTO FALLIDO';
      }
      throw new Error('SIMULATED_TRANSACTION_FAILURE');
    });
  } catch (err: any) {
    if (err.message === 'SIMULATED_TRANSACTION_FAILURE') {
      errorCaught = true;
    }
  }

  assert(errorCaught, 'El error debe ser capturado');
  const [rowAfterRollback] = await db.select().from(schema.expendios).where(eq(schema.expendios.id, testExpId));
  assert.strictEqual(rowAfterRollback.encargado, 'PRUEBA POSTGRES', 'El encargado NO debe haber cambiado debido al ROLLBACK');
  console.log('  ✓ ROLLBACK confirmado: Los datos en PostgreSQL permanecieron intactos.');

  // 4. Invariante de Concurrencia CAS en PostgreSQL
  console.log('\n[Paso 4] Verificando protección CAS ante revisión obsoleta en PostgreSQL...');
  let conflictCaught = false;
  try {
    await mutateDatabase((database) => {
      const exp = database.expendios.find((e) => e.id === testExpId);
      if (exp) {
        exp.observacion = 'Intento concurrente obsoleto';
      }
    }, {
      entityType: 'expendio',
      entityId: testExpId,
      expectedRevision: 999999, // Revisión inexistente / desactualizada
    });
  } catch (conflictErr: any) {
    if (conflictErr.name === 'ConcurrencyConflictError' || conflictErr.message.includes('concurrencia')) {
      conflictCaught = true;
    }
  }

  assert(conflictCaught, 'Debe lanzar ConcurrencyConflictError por revisión desactualizada');
  console.log('  ✓ Conflicto detectado y rechazado correctamente con CAS en PostgreSQL.');

  // 5. Restricción UNIQUE parcial de cédula activa en PostgreSQL
  console.log('\n[Paso 5] Verificando índice UNIQUE idx_expendios_cedula_activa en PostgreSQL...');
  let uniqueViolationCaught = false;
  try {
    await db.insert(schema.expendios).values({
      id: `exp-dup-${Date.now()}`,
      nombrePunto: 'TEST DUPLICADO',
      direccionPunto: 'CALLE 1 # 2-3',
      telefonoPunto: '3000000000',
      localidad: 'TEST DUPLICADO',
      municipio: 'GIRON',
      encargado: 'OTRO ENCARGADO',
      cedula: testCedula, // Misma cédula activa
      estado: 'ACTIVO',
      revision: 1,
    });
  } catch (uniqueErr: any) {
    const fullErrStr = `${uniqueErr.message || ''} ${uniqueErr.cause?.message || ''} ${uniqueErr.cause?.constraint || ''} ${uniqueErr.code || ''} ${uniqueErr.cause?.code || ''}`;
    if (fullErrStr.includes('unique constraint') || fullErrStr.includes('idx_expendios_cedula_activa') || fullErrStr.includes('23505') || uniqueErr.cause?.code === '23505') {
      uniqueViolationCaught = true;
    }
  }

  assert(uniqueViolationCaught, 'PostgreSQL debe rechazar la duplicación por idx_expendios_cedula_activa');
  console.log('  ✓ Restricción UNIQUE parcial validada en PostgreSQL.');

  // Limpieza
  await mutateDatabase((database) => {
    database.expendios = database.expendios.filter((e) => e.id !== testExpId);
  }).catch(() => {});

  console.log('\n==============================================================');
  console.log('✓✓✓ TEST 2 EXITOSO: POSTGRESQL ES LA ÚNICA FUENTE DE VERDAD');
  console.log('==============================================================');
}

testPostgresOnlyRuntime()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ Fallo en testPostgresOnlyRuntime:', err);
    process.exit(1);
  });
