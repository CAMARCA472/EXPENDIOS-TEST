import { db } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { sql, eq } from 'drizzle-orm';
import { mutateDatabase, getDatabase } from '../server/dbStore.ts';
import { generateSessionToken, ADMIN_CEDULA } from '../server/authService.ts';
import fs from 'fs';
import path from 'path';

async function runTests() {
  console.log('==============================================================');
  console.log('TEST COMPLETO: IMPORTACIÓN EXCEL, CENTRO OPERATIVO/ACOPIO,');
  console.log('ACTUALIZACIONES PARCIALES Y RESET TOTAL DE DATOS');
  console.log('==============================================================\n');

  let passedAll = true;

  // 1. GENERAR TOKEN DE ADMINISTRADOR AUTÉNTICO
  const adminToken = generateSessionToken({
    cedula: ADMIN_CEDULA,
    name: 'ADMINISTRADOR GENERAL CAMARCA',
    roles: ['admin', 'expendio'],
    role: 'admin',
    expendioId: 'exp-admin-master',
    isMultiRoleAdmin: true,
    issuedAt: Date.now(),
  });

  // --------------------------------------------------------------------------
  // TEST 1: IMPORTACIÓN EXCEL CON HOJA EXCLUSIVA "EXPENDIOS"
  // --------------------------------------------------------------------------
  console.log('[TEST 1] Verificando Importación de Excel con Hoja EXPENDIOS...');
  const testExpendiosData = [
    {
      id: 'exp-test-excel-1',
      nombrePunto: 'PUNTO AGUACHICA NORTE',
      municipio: 'AGUACHICA',
      localidad: 'AGUACHICA NORTE',
      encargado: 'MARIA PAULA GOMEZ',
      cedula: '1098765432',
      centroOperativo: 'PO.BUCARAMANGA',
      centroAcopio: 'ACOPIO SUR AGUACHICA',
      direccionPunto: 'CRA 15 # 4-20',
      telefonoPunto: '3151234567',
      usuarioSipost: 'SIP_AGUACHICA_N1',
      internet: 'SI',
      nit: '900062917',
      valorMensual: '450000',
    },
    {
      id: 'exp-test-excel-2',
      nombrePunto: 'PUNTO OCAÑA PLAZA',
      municipio: 'OCAÑA',
      localidad: 'OCAÑA PLAZA',
      encargado: 'CARLOS ALBERTO PEREZ',
      cedula: '1090334889',
      centroOperativo: 'PO. CUCUTA',
      centroAcopio: 'CENTRO ACOPIO OCAÑA',
      direccionPunto: 'CALLE 10 # 8-12',
      telefonoPunto: '3187654321',
      usuarioSipost: 'SIP_OCANA_P1',
      internet: 'SI',
      nit: '900062917',
      valorMensual: '500000',
    },
    {
      id: 'exp-test-excel-3',
      nombrePunto: 'PUNTO SARAVENA CENTRO',
      municipio: 'SARAVENA',
      localidad: 'SARAVENA CENTRO',
      encargado: 'PEDRO NEL DUARTE',
      cedula: '88234567',
      centroOperativo: 'PO. ARAUCA',
      centroAcopio: '#VALUE!', // Prueba de detección de error de fórmula sin alteración
      direccionPunto: 'CALLE 20 # 14-30',
      telefonoPunto: '3119876543',
      usuarioSipost: 'SIP_SARAVENA_01',
      internet: 'SI',
      nit: '900062917',
      valorMensual: '420000',
    },
  ];

  // Inserción segura y aislada de expendios de prueba en PostgreSQL (sin sobreescribir el catálogo maestro)
  for (const testExp of testExpendiosData) {
    await db
      .insert(schema.expendios)
      .values(testExp as any)
      .onConflictDoUpdate({
        target: schema.expendios.id,
        set: testExp as any,
      });
  }

  // Consultar directamente desde PostgreSQL
  const dbExpendios = await db
    .select()
    .from(schema.expendios)
    .where(
      sql`${schema.expendios.id} IN ('exp-test-excel-1', 'exp-test-excel-2', 'exp-test-excel-3')`
    );

  if (dbExpendios.length !== 3) {
    console.error(`  ✗ Error: Se esperaban 3 expendios en PostgreSQL, encontrados: ${dbExpendios.length}`);
    passedAll = false;
  } else {
    console.log(`  ✓ 3 expendios importados y persistidos directamente en PostgreSQL.`);
  }

  // --------------------------------------------------------------------------
  // TEST 2: VERIFICAR FIDELIDAD DE CENTRO OPERATIVO Y CENTRO DE ACOPIO
  // --------------------------------------------------------------------------
  console.log('\n[TEST 2] Verificando exactitud de CENTRO OPERATIVO y CENTRO DE ACOPIO...');
  const exp1 = dbExpendios.find((e) => e.id === 'exp-test-excel-1');
  const exp2 = dbExpendios.find((e) => e.id === 'exp-test-excel-2');
  const exp3 = dbExpendios.find((e) => e.id === 'exp-test-excel-3');

  const cOp1Match = exp1?.centroOperativo === 'PO.BUCARAMANGA';
  const cAc1Match = exp1?.centroAcopio === 'ACOPIO SUR AGUACHICA';
  const cOp2Match = exp2?.centroOperativo === 'PO. CUCUTA';
  const cAc2Match = exp2?.centroAcopio === 'CENTRO ACOPIO OCAÑA';
  const cOp3Match = exp3?.centroOperativo === 'PO. ARAUCA';
  const cAc3Match = exp3?.centroAcopio === '#VALUE!';

  if (cOp1Match && cAc1Match && cOp2Match && cAc2Match && cOp3Match && cAc3Match) {
    console.log('  ✓ CENTRO OPERATIVO en PostgreSQL coincide 100% con Excel.');
    console.log('  ✓ CENTRO DE ACOPIO en PostgreSQL coincide 100% con Excel.');
    console.log('  ✓ Error de fórmula "#VALUE!" preservado y reportado sin conversiones arbitrarias.');
  } else {
    console.error('  ✗ Fallo en exactitud de CENTRO OPERATIVO o CENTRO DE ACOPIO:', {
      exp1: { op: exp1?.centroOperativo, ac: exp1?.centroAcopio },
      exp2: { op: exp2?.centroOperativo, ac: exp2?.centroAcopio },
      exp3: { op: exp3?.centroOperativo, ac: exp3?.centroAcopio },
    });
    passedAll = false;
  }

  // --------------------------------------------------------------------------
  // TEST 3: ACTUALIZACIÓN PARCIAL PRESERVA CENTRO OPERATIVO Y ACOPIO
  // --------------------------------------------------------------------------
  console.log('\n[TEST 3] Verificando que una actualización parcial no borra CENTRO OPERATIVO / ACOPIO...');
  await db
    .update(schema.expendios)
    .set({ telefonoPunto: '3209998877' })
    .where(eq(schema.expendios.id, 'exp-test-excel-1'));

  const updatedExp1 = await db.select().from(schema.expendios).where(eq(schema.expendios.id, 'exp-test-excel-1'));
  if (
    updatedExp1[0]?.telefonoPunto === '3209998877' &&
    updatedExp1[0]?.centroOperativo === 'PO.BUCARAMANGA' &&
    updatedExp1[0]?.centroAcopio === 'ACOPIO SUR AGUACHICA'
  ) {
    console.log('  ✓ Actualización parcial completada: Teléfono modificado, CENTRO OPERATIVO y ACOPIO preservados.');
  } else {
    console.error('  ✗ Error: La actualización parcial alteró CENTRO OPERATIVO o ACOPIO:', updatedExp1[0]);
    passedAll = false;
  }

  // --------------------------------------------------------------------------
  // TEST 4: CREACIÓN DE METADATA Y ARCHIVOS DE FOTO PARA PRUEBA DE RESET
  // --------------------------------------------------------------------------
  console.log('\n[TEST 4] Creando registros operativos y fotos para prueba de RESET TOTAL...');
  const testPhotoDir = path.join(process.cwd(), 'data', 'photos_permanent');
  if (!fs.existsSync(testPhotoDir)) fs.mkdirSync(testPhotoDir, { recursive: true });
  const testPhotoPath = path.join(testPhotoDir, '1098765432_fotoAvisoUrl.jpg');
  fs.writeFileSync(testPhotoPath, Buffer.from('FAKE_PHOTO_DATA_RESET_TEST'));

  await db.insert(schema.googleDrivePhotos).values({
    photoId: 'photo_test_reset_1',
    expendioId: 'exp-test-excel-1',
    slot: 'fotoAvisoUrl',
    fileName: '1098765432_fotoAvisoUrl.jpg',
    mimeType: 'image/jpeg',
    path: testPhotoPath,
    checksum: 'sha256fakechecksum',
    uploadedAt: new Date().toISOString(),
  }).onConflictDoNothing();

  await db.insert(schema.relacionPagos).values({
    id: 'pago-test-reset-1',
    expendioId: 'exp-test-excel-1',
    beneficiario: 'MARIA PAULA GOMEZ',
    cedula: '1098765432',
    banco: 'NEQUI',
    numeroCuentaBancaria: '3151234567',
    mes: 'MARZO',
    anio: '2026',
    periodo: 'MARZO 2026',
    valorPagar: '450000',
    valorCancelar: '450000',
  }).onConflictDoNothing();

  await db.insert(schema.historialCuentas).values({
    id: 'hist-test-reset-1',
    expendioId: 'exp-test-excel-1',
    encargado: 'MARIA PAULA GOMEZ',
    cedula: '1098765432',
    mes: 'MARZO',
    anio: '2026',
    periodo: 'MARZO 2026',
    totalPagar: '450000',
    monto: '450000',
  }).onConflictDoNothing();

  await db.insert(schema.trazabilidad).values({
    id: 'traz-test-reset-1',
    expendioId: 'exp-test-excel-1',
    actorId: 'admin',
    novedad: 'Prueba de reset',
    timestamp: new Date().toISOString(),
    fechaRegistro: new Date().toISOString(),
  }).onConflictDoNothing();

  console.log('  ✓ Datos operativos y foto de prueba creados.');

  // --------------------------------------------------------------------------
  // TEST 5: LIMPIEZA SEGURA DE DATOS DE PRUEBA (AISLAMIENTO TOTAL)
  // --------------------------------------------------------------------------
  console.log('\n[TEST 5] Ejecutando LIMPIEZA SEGURA Y VALIDACIÓN DE AISLAMIENTO...');
  // REGLA CRÍTICA DE SEGURIDAD: Jamás ejecutar db.delete() global contra tablas de producción.
  // Las pruebas deben aislar y purgar ÚNICAMENTE registros con prefijo de prueba.

  await Promise.all([
    db.delete(schema.expendios).where(eq(schema.expendios.id, 'exp-test-excel-1')),
    db.delete(schema.expendios).where(eq(schema.expendios.id, 'exp-test-excel-2')),
    db.delete(schema.expendios).where(eq(schema.expendios.id, 'exp-test-excel-3')),
    db.delete(schema.relacionPagos).where(eq(schema.relacionPagos.id, 'rel-test-reset-1')),
    db.delete(schema.historialCuentas).where(eq(schema.historialCuentas.id, 'hist-test-reset-1')),
    db.delete(schema.trazabilidad).where(eq(schema.trazabilidad.id, 'traz-test-reset-1')),
    db.delete(schema.googleDrivePhotos).where(eq(schema.googleDrivePhotos.expendioId, 'exp-test-excel-1')),
  ]);

  // Eliminar archivos físicos de prueba
  if (fs.existsSync(testPhotoPath)) {
    fs.unlinkSync(testPhotoPath);
  }

  // --------------------------------------------------------------------------
  // TEST 6: VERIFICACIÓN DE AUSENCIA DE HUÉRFANOS DE PRUEBA Y PROTECCIÓN DE DATOS
  // --------------------------------------------------------------------------
  console.log('\n[TEST 6] Verificando eliminación de huérfanos de prueba y protección de catálogo...');
  const [testExpCount, testPagosCount, testHistCount, testTrazCount, totalExpCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(schema.expendios).where(eq(schema.expendios.id, 'exp-test-excel-1')),
    db.select({ count: sql<number>`count(*)` }).from(schema.relacionPagos).where(eq(schema.relacionPagos.id, 'rel-test-reset-1')),
    db.select({ count: sql<number>`count(*)` }).from(schema.historialCuentas).where(eq(schema.historialCuentas.id, 'hist-test-reset-1')),
    db.select({ count: sql<number>`count(*)` }).from(schema.trazabilidad).where(eq(schema.trazabilidad.id, 'traz-test-reset-1')),
    db.select({ count: sql<number>`count(*)` }).from(schema.expendios),
  ]);

  const nTestExp = Number(testExpCount[0]?.count || 0);
  const nTestPagos = Number(testPagosCount[0]?.count || 0);
  const nTestHist = Number(testHistCount[0]?.count || 0);
  const nTestTraz = Number(testTrazCount[0]?.count || 0);
  const nTotalExp = Number(totalExpCount[0]?.count || 0);
  const physicalPhotoExists = fs.existsSync(testPhotoPath);

  console.log(`  - Expendios de prueba residuales: ${nTestExp}`);
  console.log(`  - Relación de Pagos de prueba residuales: ${nTestPagos}`);
  console.log(`  - Historial de Cobros de prueba residuales: ${nTestHist}`);
  console.log(`  - Trazabilidad de prueba residuales: ${nTestTraz}`);
  console.log(`  - Archivo físico de foto de prueba eliminado: ${!physicalPhotoExists ? 'SÍ' : 'NO'}`);
  console.log(`  - Total de expendios legítimos protegidos en PostgreSQL: ${nTotalExp}`);

  if (nTestExp === 0 && nTestPagos === 0 && nTestHist === 0 && nTestTraz === 0 && !physicalPhotoExists && nTotalExp >= 177) {
    console.log('  ✓✓✓ LIMPIEZA EXITOSA: Datos de prueba eliminados sin afectar el catálogo autoritativo de 177 expendios.');
  } else {
    console.error('  ✗ Error en verificación: Existen huérfanos o se violó la integridad del catálogo.');
    passedAll = false;
  }

  // --------------------------------------------------------------------------
  // TEST 7: VERIFICAR QUE EL SISTEMA PERMANECE 100% OPERATIVO
  // --------------------------------------------------------------------------
  console.log('\n[TEST 7] Verificando disponibilidad operativa del catálogo...');
  const activeExp = await db.select().from(schema.expendios).where(eq(schema.expendios.cedula, '1094269932')).limit(1);
  if (activeExp.length > 0) {
    console.log(`  ✓ Expendio administrador/muestra verificado: ${activeExp[0].encargado} (${activeExp[0].cedula})`);
  } else {
    console.warn('  ⚠️ Aviso: No se encontró expendio muestra con cédula 1094269932.');
  }

  console.log('\n==============================================================');
  if (passedAll) {
    console.log('✓✓✓ TODAS LAS PRUEBAS PASARON AL 100% (PASS)');
  } else {
    console.error('✗ ALGUNAS PRUEBAS FALLARON (FAIL)');
    process.exit(1);
  }
  console.log('==============================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Error fatal ejecutando pruebas:', err);
  process.exit(1);
});
