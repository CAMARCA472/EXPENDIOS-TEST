import { mutateDatabase } from '../server/dbStore.js';
import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

async function runConcurrencyTest() {
  console.log('=== INICIANDO PRUEBA REAL DE CONCURRENCIA MULTI-ESCRITURA EN POSTGRESQL ===');

  // Asegurar que existe el expendio objetivo 'exp-test-concurrencia-1'
  const targetId = 'exp-test-concurrencia-1';
  await mutateDatabase((dbState) => {
    let exp = dbState.expendios.find((e: any) => e.id === targetId) as any;
    if (!exp) {
      exp = {
        id: targetId,
        nombrePunto: 'Expendio Concurrencia PostgreSQL Test',
        municipio: 'BOGOTA',
        departamento: 'CUNDINAMARCA',
        localidad: 'BOGOTA',
        direccionPunto: 'CALLE BASE 123',
        encargado: 'PRUEBA CONCURRENCIA',
        cedula: '8877665544',
        telefonoPunto: '300-BASE-0000',
        estado: 'ACTIVO',
        activo: true,
        revision: 1,
      };
      dbState.expendios.push(exp);
    }
    exp.telefonoPunto = '300-BASE-0000';
    exp.direccionPunto = 'CALLE BASE 123';
    exp.observaciones = 'Estado inicial de prueba en PostgreSQL';
    exp.fechaUltimaActualizacion = new Date().toISOString();
  });

  const setupRows = await db.select().from(schema.expendios).where(eq(schema.expendios.id, targetId));
  const setupRev = Number(setupRows[0]?.revision) || 1;
  console.log(`✓ Expendio de prueba preparado en PostgreSQL. Revisión establecida: ${setupRev}`);

  // 2. Ejecutar dos escritores concurrentes sobre el MISMO expendio en paralelo
  console.log('\n[Paso 2] Lanzando Escritor A y Escritor B simultáneamente sobre el mismo expendio...');

  const writerAPromise = mutateDatabase((dbState) => {
    const exp = dbState.expendios.find((e: any) => e.id === targetId) as any;
    if (!exp) throw new Error('Expendio no encontrado en Escritor A');
    console.log('[Escritor A] Modificando telefonoPunto -> "311-WRITER-A"...');
    exp.telefonoPunto = '311-WRITER-A';
    exp.observacion = 'Modificación efectuada por Escritor A';
  });

  const writerBPromise = mutateDatabase((dbState) => {
    const exp = dbState.expendios.find((e: any) => e.id === targetId) as any;
    if (!exp) throw new Error('Expendio no encontrado en Escritor B');
    console.log('[Escritor B] Modificando direccionPunto -> "CARRERA 99-WRITER-B"...');
    exp.direccionPunto = 'CARRERA 99-WRITER-B';
    exp.observaciones = 'Modificación efectuada por Escritor B';
  });

  // Esperar a que ambos escritores completen (el Mutex y las transacciones PostgreSQL los serializan atómicamente)
  console.log('[Paso 2.1] Procesando mutaciones concurrentes en PostgreSQL...');
  await Promise.all([writerAPromise, writerBPromise]);
  console.log('✓ Ambas mutaciones concurrentes han finalizado exitosamente en PostgreSQL.');

  // 3. Verificar estado final directamente en PostgreSQL
  console.log('\n[Paso 3] Verificando estado final autoritativo descargado directamente desde PostgreSQL...');
  const finalRows = await db.select().from(schema.expendios).where(eq(schema.expendios.id, targetId));
  const finalExp = finalRows[0];

  if (!finalExp) {
    throw new Error('FALLO: El expendio objetivo no existe en PostgreSQL al finalizar.');
  }

  const finalRev = Number(finalExp.revision) || 0;
  console.log(`Revisión inicial: ${setupRev}`);
  console.log(`Revisión final en PostgreSQL: ${finalRev}`);

  console.log('\n[Paso 4] Inspección detallada de campos en PostgreSQL:');
  console.log('  - telefonoPunto:', finalExp.telefonoPunto);
  console.log('  - direccionPunto:', finalExp.direccionPunto);
  console.log('  - observacion (A):', finalExp.observacion);
  console.log('  - observaciones (B):', finalExp.observaciones);

  // Validaciones estrictas:
  const aPreserved = finalExp.telefonoPunto === '311-WRITER-A' && finalExp.observacion === 'Modificación efectuada por Escritor A';
  const bPreserved = finalExp.direccionPunto === 'CARRERA 99-WRITER-B' && finalExp.observaciones === 'Modificación efectuada por Escritor B';
  const revAdvanced = finalRev >= setupRev + 2;

  console.log('\n=== RESULTADO DE LA VALIDACIÓN EN POSTGRESQL ===');
  console.log(`1. Cambio de Escritor A preservado en PostgreSQL: ${aPreserved ? '✓ SÍ' : '✗ NO'}`);
  console.log(`2. Cambio de Escritor B preservado en PostgreSQL: ${bPreserved ? '✓ SÍ' : '✗ NO'}`);
  console.log(`3. Revisión avanzó monótonamente (+2): ${revAdvanced ? '✓ SÍ' : '✗ NO'} (${setupRev} -> ${finalRev})`);

  // Limpieza
  await db.delete(schema.expendios).where(eq(schema.expendios.id, targetId)).catch(() => {});

  if (aPreserved && bPreserved && revAdvanced) {
    console.log('\n✓✓✓ PRUEBA EXITOSA: Cero actualizaciones perdidas (Lost Updates: 0). Concurrencia atómica en PostgreSQL verificada.');
    process.exit(0);
  } else {
    console.error('\n✗✗✗ ERROR EN VALIDACIÓN DE CONCURRENCIA EN POSTGRESQL.');
    process.exit(1);
  }
}

runConcurrencyTest().catch((err) => {
  console.error('Error fatal en prueba de concurrencia:', err);
  process.exit(1);
});
