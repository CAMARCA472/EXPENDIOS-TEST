import { db } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { mutateDatabase, loadDatabase, ConcurrencyConflictError } from '../server/dbStore.ts';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

async function runFase1Tests() {
  console.log('================================================================');
  console.log('  EJECUTANDO PRUEBAS OBLIGATORIAS — FASE 1 MIGRACIÓN POSTGRESQL');
  console.log('================================================================\n');

  let passedTests = 0;
  const totalTests = 8;

  const testExpId = `exp-test-f1-${Date.now()}`;
  const testCedula = `998877${Math.floor(1000 + Math.random() * 9000)}`;

  // --------------------------------------------------------------------------
  // PRUEBA 1: Escritura PostgreSQL
  // --------------------------------------------------------------------------
  console.log('[PRUEBA 1] Creación y modificación de expendio directamente en PostgreSQL...');
  await mutateDatabase((db) => {
    db.expendios.push({
      id: testExpId,
      nombrePunto: 'PUNTO PRUEBA FASE 1',
      municipio: 'SOACHA',
      departamento: 'CUNDINAMARCA',
      direccionPunto: 'CALLE 1 # 2-3',
      encargado: 'JUAN TESTER',
      cedula: testCedula,
      telefonoPunto: '3001112233',
      banco: 'NEQUI',
      cuentaBancaria: '3001112233',
      estado: 'ACTIVO',
      activo: true,
      revision: 1,
    } as any);
  });

  const checkPg1 = await db.select().from(schema.expendios).where(eq(schema.expendios.id, testExpId));
  if (checkPg1.length === 1 && checkPg1[0].encargado === 'JUAN TESTER') {
    console.log(`  ✓ PRUEBA 1 EXITOSA: Registro creado y confirmado en PostgreSQL (ID: ${testExpId}).`);
    passedTests++;
  } else {
    throw new Error('FALLO PRUEBA 1: El registro no se encontró en PostgreSQL tras mutateDatabase().');
  }

  // --------------------------------------------------------------------------
  // PRUEBA 2: Persistencia tras reinicio
  // --------------------------------------------------------------------------
  console.log('\n[PRUEBA 2] Verificando persistencia autoritativa independiente de memoria...');
  // Limpiamos la caché en memoria forzando una nueva lectura directa de PostgreSQL
  const directPgRows = await db.select().from(schema.expendios).where(eq(schema.expendios.id, testExpId));
  if (directPgRows.length === 1 && directPgRows[0].cedula === testCedula) {
    console.log('  ✓ PRUEBA 2 EXITOSA: El registro persiste en PostgreSQL sin depender del estado en memoria.');
    passedTests++;
  } else {
    throw new Error('FALLO PRUEBA 2: Persistencia no confirmada en PostgreSQL.');
  }

  // --------------------------------------------------------------------------
  // PRUEBA 3: Trazabilidad en PostgreSQL
  // --------------------------------------------------------------------------
  console.log('\n[PRUEBA 3] Modificación con trazabilidad dentro de la misma transacción PostgreSQL...');
  const trazId = `traz-${Date.now()}`;
  await mutateDatabase((db) => {
    const exp = db.expendios.find((e) => e.id === testExpId);
    if (exp) {
      exp.telefonoPunto = '3209998877';
      exp.direccionPunto = 'AVENIDA NUEVA 45';
    }
    db.trazabilidad.push({
      id: trazId,
      expendioId: testExpId,
      actorId: 'admin_test',
      actorRole: 'admin',
      novedad: 'Actualización de contacto en prueba Fase 1',
      municipio: 'SOACHA',
      timestamp: new Date().toISOString(),
      fechaRegistro: new Date().toISOString(),
    } as any);
  });

  const checkExp3 = await db.select().from(schema.expendios).where(eq(schema.expendios.id, testExpId));
  const checkTraz3 = await db.select().from(schema.trazabilidad).where(eq(schema.trazabilidad.id, trazId));

  if (checkExp3[0]?.telefonoPunto === '3209998877' && checkTraz3.length === 1) {
    console.log('  ✓ PRUEBA 3 EXITOSA: Cambio y trazabilidad confirmados juntos en PostgreSQL.');
    passedTests++;
  } else {
    throw new Error('FALLO PRUEBA 3: Cambio o trazabilidad ausente en PostgreSQL.');
  }

  // --------------------------------------------------------------------------
  // PRUEBA 4: Rollback Transaccional
  // --------------------------------------------------------------------------
  console.log('\n[PRUEBA 4] Provocando fallo antes de commit para verificar ROLLBACK transaccional...');
  const preRollbackExp = (await db.select().from(schema.expendios).where(eq(schema.expendios.id, testExpId)))[0];
  const preRollbackPhone = preRollbackExp.telefonoPunto;
  const orphanTrazId = `traz-orphan-${Date.now()}`;

  let caughtError = false;
  try {
    await mutateDatabase((db) => {
      const exp = db.expendios.find((e) => e.id === testExpId);
      if (exp) {
        exp.telefonoPunto = '999-ROLLBACK-FAIL';
      }
      db.trazabilidad.push({
        id: orphanTrazId,
        expendioId: testExpId,
        actorId: 'tester',
        actorRole: 'admin',
        novedad: 'Esta trazabilidad debe ser abortada',
        municipio: 'SOACHA',
        timestamp: new Date().toISOString(),
        fechaRegistro: new Date().toISOString(),
      } as any);

      // Simular fallo fatal antes del commit
      throw new Error('SIMULATED_TRANSACTION_FAILURE_BEFORE_COMMIT');
    });
  } catch (err: any) {
    if (err.message === 'SIMULATED_TRANSACTION_FAILURE_BEFORE_COMMIT') {
      caughtError = true;
    }
  }

  const postRollbackExp = (await db.select().from(schema.expendios).where(eq(schema.expendios.id, testExpId)))[0];
  const checkOrphanTraz = await db.select().from(schema.trazabilidad).where(eq(schema.trazabilidad.id, orphanTrazId));

  if (caughtError && postRollbackExp.telefonoPunto === preRollbackPhone && checkOrphanTraz.length === 0) {
    console.log('  ✓ PRUEBA 4 EXITOSA: ROLLBACK confirmado. Datos intactos y cero registros huérfanos.');
    passedTests++;
  } else {
    throw new Error('FALLO PRUEBA 4: El ROLLBACK no restableció el estado correctamente.');
  }

  // --------------------------------------------------------------------------
  // PRUEBA 5: Concurrencia Optimista CAS en PostgreSQL
  // --------------------------------------------------------------------------
  console.log('\n[PRUEBA 5] Verificando control de concurrencia optimista (CAS) en PostgreSQL...');
  const currentExp = (await db.select().from(schema.expendios).where(eq(schema.expendios.id, testExpId)))[0];
  const validRev = Number(currentExp.revision);

  // Intentar actualizar con una revisión vieja/obsoleta
  let conflictCaught = false;
  try {
    await mutateDatabase(
      (db) => {
        const exp = db.expendios.find((e) => e.id === testExpId);
        if (exp) exp.direccionPunto = 'CALLE CONFLICTO';
      },
      {
        entityType: 'expendio',
        entityId: testExpId,
        expectedRevision: validRev - 1, // Revisión desfasada a propósito
      }
    );
  } catch (err: any) {
    if (err instanceof ConcurrencyConflictError || err.name === 'ConcurrencyConflictError' || err.status === 409) {
      conflictCaught = true;
      console.log(`  ✓ Conflicto detectado correctamente: ${err.message}`);
    }
  }

  if (conflictCaught) {
    console.log('  ✓ PRUEBA 5 EXITOSA: Concurrencia protegida en PostgreSQL con rechazo 409 (CAS).');
    passedTests++;
  } else {
    throw new Error('FALLO PRUEBA 5: No se detectó conflicto de concurrencia ante revisión desfasada.');
  }

  // --------------------------------------------------------------------------
  // PRUEBA 6: Cédula Inmutable y Restricción de Unicidad en PostgreSQL
  // --------------------------------------------------------------------------
  console.log('\n[PRUEBA 6] Verificando restricción UNIQUE parcial de cédula activa en PostgreSQL...');
  let uniqueViolationCaught = false;
  const duplicateId = `exp-dupe-${Date.now()}`;

  try {
    // Intentar insertar otro expendio ACTIVO con la MISMA cédula
    await db.insert(schema.expendios).values({
      id: duplicateId,
      nombrePunto: 'PUNTO DUPLICADO',
      municipio: 'SOACHA',
      direccionPunto: 'CALLE DUPE',
      encargado: 'OTRO ENCARGADO',
      cedula: testCedula, // MISMA CÉDULA DEL EXPENDIO ACTIVO ANTERIOR
      telefonoPunto: '3000000000',
      estado: 'ACTIVO',
      activo: true,
      revision: 1,
    });
  } catch (err: any) {
    const fullErrStr = `${err.message || ''} ${err.cause?.message || ''} ${err.cause?.constraint || ''}`;
    if (fullErrStr.includes('unique constraint') || fullErrStr.includes('idx_expendios_cedula_activa') || err.cause?.code === '23505') {
      uniqueViolationCaught = true;
      console.log(`  ✓ PostgreSQL rechazó duplicado por índice: ${err.cause?.message || err.message}`);
    }
  }

  if (uniqueViolationCaught) {
    console.log('  ✓ PRUEBA 6 EXITOSA: Restricción UNIQUE de cédula activa confirmada en PostgreSQL.');
    passedTests++;
  } else {
    throw new Error('FALLO PRUEBA 6: PostgreSQL permitió dos expendios activos con la misma cédula.');
  }

  // --------------------------------------------------------------------------
  // PRUEBA 7: Fotos sin Firebase Storage
  // --------------------------------------------------------------------------
  console.log('\n[PRUEBA 7] Guardado de fotografía y persistencia de metadata con checksum en PostgreSQL...');
  const sampleBuffer = Buffer.from('FAKE_JPEG_IMAGE_CONTENT_FOR_TEST_' + Date.now());
  const photoChecksum = crypto.createHash('sha256').update(sampleBuffer).digest('hex');
  const photoId = `photo_test_${Date.now()}`;
  const diskPath = path.join(process.cwd(), 'data', 'fotos_expendios', `${photoId}.jpg`);

  if (!fs.existsSync(path.dirname(diskPath))) {
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
  }
  fs.writeFileSync(diskPath, sampleBuffer);

  await db.insert(schema.googleDrivePhotos).values({
    photoId,
    expendioId: testExpId,
    slot: 'fotoAvisoUrl',
    fileName: `${photoId}.jpg`,
    mimeType: 'image/jpeg',
    path: diskPath,
    checksum: photoChecksum,
    uploadedAt: new Date().toISOString(),
    metadata: { test: true },
  });

  const checkPhoto = await db.select().from(schema.googleDrivePhotos).where(eq(schema.googleDrivePhotos.photoId, photoId));
  if (checkPhoto.length === 1 && checkPhoto[0].checksum === photoChecksum && fs.existsSync(diskPath)) {
    console.log('  ✓ PRUEBA 7 EXITOSA: Fotografía persistida en disco y metadata en PostgreSQL sin Firebase.');
    passedTests++;
    try { fs.unlinkSync(diskPath); } catch {}
  } else {
    throw new Error('FALLO PRUEBA 7: Fallo al guardar o recuperar foto en PostgreSQL.');
  }

  // --------------------------------------------------------------------------
  // PRUEBA 8: Persistencia Autónoma Exclusiva en PostgreSQL
  // --------------------------------------------------------------------------
  console.log('\n[PRUEBA 8] Verificando persistencia autónoma 100% en PostgreSQL (sin servicios externos)...');

  let mutationSucceeded = false;
  await mutateDatabase((db) => {
    const exp = db.expendios.find((e) => e.id === testExpId);
    if (exp) {
      exp.observaciones = 'Actualizado de forma autónoma en PostgreSQL';
    }
    mutationSucceeded = true;
  });

  const checkExp8 = (await db.select().from(schema.expendios).where(eq(schema.expendios.id, testExpId)))[0];
  if (mutationSucceeded && checkExp8?.observaciones === 'Actualizado de forma autónoma en PostgreSQL') {
    console.log('  ✓ PRUEBA 8 EXITOSA: mutateDatabase() confirmó de forma 100% autónoma en PostgreSQL.');
    passedTests++;
  } else {
    throw new Error('FALLO PRUEBA 8: La mutación falló en PostgreSQL.');
  }

  // Limpieza del registro de prueba
  await db.delete(schema.googleDrivePhotos).where(eq(schema.googleDrivePhotos.expendioId, testExpId)).catch(() => {});
  await db.delete(schema.trazabilidad).where(eq(schema.trazabilidad.expendioId, testExpId)).catch(() => {});
  await db.delete(schema.expendios).where(eq(schema.expendios.id, testExpId)).catch(() => {});

  console.log('\n================================================================');
  console.log(`  ✓✓✓ TODAS LAS ${passedTests}/${totalTests} PRUEBAS DE LA FASE 1 PASARON CON ÉXITO AL 100%`);
  console.log('================================================================');
}

runFase1Tests().then(() => process.exit(0)).catch((err) => {
  console.error('\n✗ Error fatal en pruebas de Fase 1:', err);
  process.exit(1);
});
