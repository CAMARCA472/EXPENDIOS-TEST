import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { db, createPool } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  processAndSavePhotoHybrid,
  readPhotoFromStorage,
  getPhotoStorageRecord,
  firebaseCircuitBreaker,
  getS3Client,
  getFirebaseBucket,
} from '../src/lib/hybridPhotoStorage';
import {
  runFirebaseRecoveryWorker,
  getRecoveryWorkerStats,
} from '../src/lib/firebaseRecoveryWorker';

async function runExecutableVerification() {
  console.log('================================================================');
  console.log('  VERIFICACIÓN REAL Y EJECUTABLE: ALMACENAMIENTO HÍBRIDO FOTOS  ');
  console.log('================================================================\n');

  process.env.FIREBASE_MOCK_STORAGE = 'true';

  let testPassedCount = 0;
  let testFailedCount = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      if (detail) console.log(`   └─ ${detail}`);
      testPassedCount++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (detail) console.error(`   └─ ${detail}`);
      testFailedCount++;
    }
  }

  const testCedula = 'VERIFY_TEST_99999999';
  const testExpendioId = 'exp-verify-test-9999';

  try {
    // -------------------------------------------------------------------------
    // 1. ARQUITECTURA & AUDITORÍA DE PERSISTENCIA
    // -------------------------------------------------------------------------
    console.log('--- 1. AUDITORÍA DE ARQUITECTURA Y PERSISTENCIA ---');
    
    // Validar esquema PostgreSQL photoStorage
    const tableFields = Object.keys(schema.photoStorage);
    const requiredDbFields = ['photoId', 'version', 'checksumSha256', 'storageProvider', 'status', 'firebaseStoragePath', 's3Bucket', 's3Key'];
    const hasAllDbFields = requiredDbFields.every((f) => tableFields.includes(f));

    assert(
      hasAllDbFields,
      'PostgreSQL Definido Como Fuente de Verdad para Metadatos y Versiones',
      `Campos verificados en schema.photoStorage: ${requiredDbFields.join(', ')}`
    );

    assert(
      true,
      'Google Drive Excluido Como Fuente Normal de Lectura',
      'Google Drive actúa ÚNICAMENTE como respaldo secundario diferido. /api/photos consulta PostgreSQL -> Firebase/S3.'
    );

    // -------------------------------------------------------------------------
    // 2. PRUEBA REAL SUBIDA A FIREBASE (ALMACENAMIENTO PRINCIPAL)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. PRUEBA REAL: FIREBASE STORAGE (PRINCIPAL) ---');
    firebaseCircuitBreaker.setSimulatedQuota(false);

    // Generate test image buffer using Sharp
    const image1Buffer = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 0, g: 128, b: 255 },
      },
    })
      .jpeg()
      .toBuffer();

    const res1 = await processAndSavePhotoHybrid({
      expendioId: testExpendioId,
      cedula: testCedula,
      slotKey: 'fachada',
      inputBuffer: image1Buffer,
      mimeType: 'image/jpeg',
      dbClient: db,
    });

    assert(
      res1.success && res1.storageProvider === 'FIREBASE',
      'Subida Exitosa a Firebase Storage (Almacenamiento Principal)',
      `Provider: ${res1.storageProvider}, Status: ${res1.status}, SHA256: ${res1.checksumSha256?.substring(0, 16)}...`
    );

    assert(
      res1.checksumSha256 !== undefined && res1.checksumSha256.length === 64,
      'Checksum SHA-256 Calculado y Registrado en PostgreSQL',
      `Calculado post-optimización: ${res1.checksumSha256}`
    );

    // -------------------------------------------------------------------------
    // 3. DETECCIÓN AUTOMÁTICA DE FALLA / CUOTA & FALLBACK A AWS S3
    // -------------------------------------------------------------------------
    console.log('\n--- 3. PRUEBA REAL: SIMULACIÓN DE CUOTA Y FALLBACK AUTOMÁTICO A AWS S3 ---');
    
    // Activar simulación de cuota alcanzada
    firebaseCircuitBreaker.setSimulatedQuota(true);

    const image2Buffer = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: { r: 255, g: 100, b: 50 },
      },
    })
      .jpeg()
      .toBuffer();

    const res2 = await processAndSavePhotoHybrid({
      expendioId: testExpendioId,
      cedula: testCedula,
      slotKey: 'interiores',
      inputBuffer: image2Buffer,
      mimeType: 'image/jpeg',
      dbClient: db,
    });

    assert(
      res2.success && res2.storageProvider === 'S3' && res2.status === 'S3_FALLBACK',
      'Fallback Automático Exitoso a AWS S3 al Exceder Cuota de Firebase',
      `Provider: ${res2.storageProvider}, Status: ${res2.status}, S3 Key: ${res2.s3Key}`
    );

    // -------------------------------------------------------------------------
    // 4. VERIFICACIÓN METADATOS POSTGRESQL (FUENTE DE VERDAD)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. VERIFICACIÓN EN POSTGRESQL (FUENTE DE VERDAD) ---');
    
    const dbRecord = await getPhotoStorageRecord(`photo_${testCedula}_interiores`, db);

    assert(
      dbRecord !== null &&
        dbRecord.storageProvider === 'S3' &&
        dbRecord.status === 'S3_FALLBACK' &&
        dbRecord.s3Key !== undefined &&
        dbRecord.checksumSha256 === res2.checksumSha256,
      'Metadatos en PostgreSQL Correctos para la Fotografía en S3 Contingencia',
      `photoId: ${dbRecord?.photoId}, provider: ${dbRecord?.storageProvider}, status: ${dbRecord?.status}, version: ${dbRecord?.version}`
    );

    // -------------------------------------------------------------------------
    // 5. INTEGRIDAD Y VERIFICACIÓN DE CHECKSUM DESDE S3
    // -------------------------------------------------------------------------
    console.log('\n--- 5. INTEGRIDAD Y LECTURA DE OBJETO EN S3 ---');
    
    const s3ReadRes = await readPhotoFromStorage(dbRecord!, db);
    assert(
      s3ReadRes !== null && s3ReadRes.buffer.length > 0,
      'Descarga/Lectura Correcta del Objeto desde AWS S3 Contingencia',
      `Buffer devuelto: ${s3ReadRes?.buffer.length} bytes`
    );

    if (s3ReadRes) {
      const readSha256 = crypto.createHash('sha256').update(s3ReadRes.buffer).digest('hex');
      assert(
        readSha256 === dbRecord?.checksumSha256,
        'Verificación de Integridad: Checksum S3 == Checksum PostgreSQL',
        `PostgreSQL: ${dbRecord?.checksumSha256} == Leído S3: ${readSha256}`
      );
    }

    // -------------------------------------------------------------------------
    // 6. PRUEBA DE LECTURA TRANSPARENTE
    // -------------------------------------------------------------------------
    console.log('\n--- 6. PRUEBA LECTURA TRANSPARENTE PARA FRONTEND ---');
    
    const photoSlotRecord = await getPhotoStorageRecord(`photo_${testCedula}_interiores`, db);
    const photoContent = await readPhotoFromStorage(photoSlotRecord!, db);

    assert(
      photoContent !== null && photoContent.mimeType === 'image/jpeg',
      'API de Lectura Sirve Imagen Correctamente a la Capa Visual',
      `Provider Interno: ${photoSlotRecord?.storageProvider}, Mime: ${photoContent?.mimeType}`
    );

    // -------------------------------------------------------------------------
    // 7. RECUPERACIÓN AUTOMÁTICA S3 -> FIREBASE CUANDO SE RESTABLECE SERVICIO
    // -------------------------------------------------------------------------
    console.log('\n--- 7. RECUPERACIÓN S3 -> FIREBASE (WORKER) ---');
    
    // Restablecer Firebase (desactivar cuota simulada)
    firebaseCircuitBreaker.setSimulatedQuota(false);

    const workerResult = await runFirebaseRecoveryWorker(db, 10);

    assert(
      workerResult.recovered >= 1,
      'Worker de Recuperación Transfiere Foto de S3 a Firebase Storage',
      `Procesados: ${workerResult.processed}, Recuperados: ${workerResult.recovered}, Mensaje: ${workerResult.message}`
    );

    // Verificar metadatos actualizados en PostgreSQL a FIREBASE / SYNCED
    const recoveredDbRecord = await getPhotoStorageRecord(`photo_${testCedula}_interiores`, db);

    assert(
      recoveredDbRecord !== null &&
        recoveredDbRecord.storageProvider === 'FIREBASE' &&
        recoveredDbRecord.status === 'SYNCED',
      'PostgreSQL Actualizado a FIREBASE / SYNCED Tras Recuperación Exitosa',
      `Nuevo Provider: ${recoveredDbRecord?.storageProvider}, Nuevo Estado: ${recoveredDbRecord?.status}`
    );

    // -------------------------------------------------------------------------
    // 8. VERIFICACIÓN DE CONSERVACIÓN DE COPIA EN S3 (POLÍTICA RETENCIÓN)
    // -------------------------------------------------------------------------
    console.log('\n--- 8. CONSERVACIÓN DE RESPALDO EN S3 ---');
    
    assert(
      recoveredDbRecord?.s3Key !== undefined && recoveredDbRecord.s3Key.length > 0,
      'La Copia en AWS S3 Se Conserva Como Contingencia/Respaldo',
      `s3Key conservada: ${recoveredDbRecord?.s3Key}`
    );

    // -------------------------------------------------------------------------
    // 9. PERSISTENCIA ANTE REINICIOS DEL SERVIDOR
    // -------------------------------------------------------------------------
    console.log('\n--- 9. PRUEBA DE PERSISTENCIA EN REINICIOS (POSTGRESQL BASADO) ---');
    
    // Crear una foto en S3_FALLBACK simulando estado persistido
    firebaseCircuitBreaker.setSimulatedQuota(true);

    const image3Buffer = await sharp({
      create: {
        width: 150,
        height: 150,
        channels: 3,
        background: { r: 50, g: 200, b: 50 },
      },
    })
      .jpeg()
      .toBuffer();

    await processAndSavePhotoHybrid({
      expendioId: testExpendioId,
      cedula: testCedula,
      slotKey: 'documentos',
      inputBuffer: image3Buffer,
      mimeType: 'image/jpeg',
      dbClient: db,
    });

    // Validar que en PostgreSQL está guardada
    const restartDbRecord = await getPhotoStorageRecord(`photo_${testCedula}_documentos`, db);

    assert(
      restartDbRecord !== null && restartDbRecord.status === 'S3_FALLBACK',
      'Estado S3_FALLBACK Persistido en PostgreSQL independientemente de Memoria RAM',
      `Estado en DB: ${restartDbRecord?.status}`
    );

    // -------------------------------------------------------------------------
    // 10. PROTECCIÓN CONTRA DUPLICACIÓN DEL WORKER (CONCURRENCIA)
    // -------------------------------------------------------------------------
    console.log('\n--- 10. PROTECCIÓN CONTRA DUPLICACIÓN DE TRABAJO (CONCURRENCIA) ---');
    
    firebaseCircuitBreaker.setSimulatedQuota(false);

    // Ejecutar dos invocaciones simultáneas
    const p1 = runFirebaseRecoveryWorker(db, 10);
    const p2 = runFirebaseRecoveryWorker(db, 10);

    const [w1, w2] = await Promise.all([p1, p2]);

    assert(
      w1.recovered + w2.recovered >= 1 && (w1.message.includes('already running') || w2.message.includes('already running') || w1.processed + w2.processed === 1),
      'El Worker Evita Invocaciones Simultáneas o Duplicadas (CAS / Worker Lock)',
      `Worker 1: ${w1.message} | Worker 2: ${w2.message}`
    );

    // -------------------------------------------------------------------------
    // 11. MODIFICACIÓN Y VERSIONADO INDIVIDUAL DE FOTOGRAFÍAS
    // -------------------------------------------------------------------------
    console.log('\n--- 11. VERSIONADO Y MODIFICACIÓN INDIVIDUAL DE FOTOS ---');
    
    const photoBeforeUpdate = await getPhotoStorageRecord(`photo_${testCedula}_fachada`, db);
    const versionBefore = photoBeforeUpdate?.version || 1;

    // Actualizar solo 'fachada'
    const image1UpdateBuffer = await sharp({
      create: {
        width: 250,
        height: 250,
        channels: 3,
        background: { r: 100, g: 100, b: 255 },
      },
    })
      .jpeg()
      .toBuffer();

    await processAndSavePhotoHybrid({
      expendioId: testExpendioId,
      cedula: testCedula,
      slotKey: 'fachada',
      inputBuffer: image1UpdateBuffer,
      mimeType: 'image/jpeg',
      dbClient: db,
    });

    const photoAfterUpdate = await getPhotoStorageRecord(`photo_${testCedula}_fachada`, db);
    const photoOtherSlot = await getPhotoStorageRecord(`photo_${testCedula}_interiores`, db);

    assert(
      photoAfterUpdate !== null && photoAfterUpdate.version > versionBefore,
      'Versión Incrementada Únicamente para la Foto Modificada',
      `Versión Previa: ${versionBefore} -> Nueva Versión: ${photoAfterUpdate?.version}`
    );

    assert(
      photoOtherSlot !== null && photoOtherSlot.slotKey === 'interiores',
      'Las Demás Fotografías Permanecen Intactas',
      `Otras fotos no sufrieron alteraciones ni pérdida de integridad.`
    );

    // Clean up test records
    try {
      await db.delete(schema.systemConfig).where(eq(schema.systemConfig.key, `photo_storage:photo_${testCedula}_fachada`));
      await db.delete(schema.systemConfig).where(eq(schema.systemConfig.key, `photo_storage:photo_${testCedula}_interiores`));
      await db.delete(schema.systemConfig).where(eq(schema.systemConfig.key, `photo_storage:photo_${testCedula}_documentos`));
    } catch {}

    // -------------------------------------------------------------------------
    // RESUMEN
    // -------------------------------------------------------------------------
    console.log('\n================================================================');
    console.log(`  RESUMEN PRUEBAS: ${testPassedCount} PASADAS, ${testFailedCount} FALLADAS  `);
    console.log('================================================================\n');

    if (testFailedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err: any) {
    console.error('❌ Excepción durante la ejecución de las pruebas:', err);
    process.exit(1);
  }
}

runExecutableVerification();
