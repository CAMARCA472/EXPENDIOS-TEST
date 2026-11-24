import assert from 'assert';
import { generateSessionToken } from '../server/authService.js';
import { loadDatabase } from '../server/dbStore.js';

const BASE_URL = 'http://localhost:3000';

async function testImmutableCedulaScenarios() {
  console.log('==============================================================');
  console.log('PRUEBAS: CÉDULA INMUTABLE Y ACTUALIZACIONES DE EXPENDIO');
  console.log('==============================================================\n');

  const db = loadDatabase();
  const sampleExp = db.expendios && db.expendios.length > 0
    ? db.expendios[0]
    : { id: 'exp-excel-1785467427948-0', cedula: '1116796414', encargado: 'JORGE LOPEZ' };

  const originalCedula = sampleExp.cedula;
  const originalExpId = sampleExp.id;

  console.log(`[Configuración] Probando con Expendio ID: "${originalExpId}", Cédula Maestra: "${originalCedula}"`);

  // Crear token firmado para el expendio autenticado
  const token = generateSessionToken({
    cedula: originalCedula,
    roles: ['expendio'],
    role: 'expendio',
    expendioId: originalExpId,
    name: sampleExp.encargado || 'TEST ENCARGADO',
    isMultiRoleAdmin: false,
    issuedAt: Date.now(),
  });

  // 1. Expendio actualiza nombre -> debe funcionar
  console.log('\n[Escenario 1] Expendio actualiza nombre (encargado)...');
  const updateNameRes = await fetch(`${BASE_URL}/api/expendio/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      encargado: 'JUAN PEREZ ACTUALIZADO',
    }),
  });
  const nameData = await updateNameRes.json();
  assert.strictEqual(updateNameRes.status, 200, 'Debe retornar HTTP 200');
  assert.strictEqual(nameData.success, true);
  assert.strictEqual(nameData.data.encargado, 'JUAN PEREZ ACTUALIZADO');
  assert.strictEqual(nameData.data.cedula, originalCedula, 'La cédula debe permanecer intacta');
  assert.strictEqual(nameData.data.id, originalExpId, 'El expendio.id debe ser inmutable');
  console.log('  ✓ Nombre actualizado exitosamente preservando ID y Cédula maestra.');

  // 2. Expendio actualiza teléfono -> debe funcionar
  console.log('\n[Escenario 2] Expendio actualiza teléfono...');
  const updatePhoneRes = await fetch(`${BASE_URL}/api/expendio/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      telefonoPunto: '3209998877',
    }),
  });
  const phoneData = await updatePhoneRes.json();
  assert.strictEqual(updatePhoneRes.status, 200);
  assert.strictEqual(phoneData.data.telefonoPunto, '3209998877');
  assert.strictEqual(phoneData.data.cedula, originalCedula, 'La cédula debe permanecer intacta');
  console.log('  ✓ Teléfono actualizado exitosamente.');

  // 3. Expendio actualiza dirección -> debe funcionar
  console.log('\n[Escenario 3] Expendio actualiza dirección...');
  const updateAddressRes = await fetch(`${BASE_URL}/api/expendio/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      direccionPunto: 'CALLE 10 # 20 - 30 NUEVA SEDE',
    }),
  });
  const addressData = await updateAddressRes.json();
  assert.strictEqual(updateAddressRes.status, 200);
  assert.strictEqual(addressData.data.direccionPunto, 'CALLE 10 # 20 - 30 NUEVA SEDE');
  assert.strictEqual(addressData.data.cedula, originalCedula, 'La cédula debe permanecer intacta');
  console.log('  ✓ Dirección actualizada exitosamente.');

  // 4. Expendio actualiza fotografías (vía base64) -> debe funcionar
  console.log('\n[Escenario 4] Expendio actualiza fotografía...');
  const testPhotoBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const updatePhotoRes = await fetch(`${BASE_URL}/api/expendio/upload-photo-base64`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      photoType: 'fotoPanoramicaUrl',
      photoBase64: testPhotoBase64,
    }),
  });
  const photoData = await updatePhotoRes.json();
  assert.strictEqual(updatePhotoRes.status, 200);
  assert.strictEqual(photoData.success, true);
  console.log('  ✓ Fotografía actualizada y vinculada correctamente.');

  // 5. Intento HTTP malicioso de enviar 'cedula' diferente en la petición
  console.log('\n[Escenario 5] Intento malicioso: Enviar campo "cedula" diferente en la petición HTTP...');
  const spoofCedulaRes = await fetch(`${BASE_URL}/api/expendio/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      cedula: '9999999999', // Cédula no autorizada
      direccionPunto: 'DIRECCIÓN ATTEMPT SPOOF',
    }),
  });
  const spoofData = await spoofCedulaRes.json();
  assert.strictEqual(spoofCedulaRes.status, 200);
  assert.strictEqual(spoofData.data.cedula, originalCedula, 'La cédula debe ser estrictamente la original');
  assert.notStrictEqual(spoofData.data.cedula, '9999999999', 'El backend NO debe aceptar la cédula enviada');
  console.log(`  ✓ Cédula maliciosa ignorada por el backend. Cédula almacenada: "${spoofData.data.cedula}".`);

  // 6. Intento HTTP malicioso de enviar 'cedulaNueva' junto con actualización válida
  console.log('\n[Escenario 6] Intento malicioso: Enviar "cedulaNueva" junto con datos válidos...');
  const spoofCedulaNuevaRes = await fetch(`${BASE_URL}/api/expendio/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      cedulaNueva: '8888888888',
      encargado: 'ENCARGADO CON CEDULA NUEVA ATTEMPT',
      telefonoPunto: '3101122334',
    }),
  });
  const spoofNuevaData = await spoofCedulaNuevaRes.json();
  assert.strictEqual(spoofCedulaNuevaRes.status, 200);
  assert.strictEqual(spoofNuevaData.data.cedula, originalCedula, 'La cédula original debe permanecer intacta');
  assert.notStrictEqual(spoofNuevaData.data.cedula, '8888888888');
  assert.strictEqual(spoofNuevaData.data.encargado, 'ENCARGADO CON CEDULA NUEVA ATTEMPT');
  assert.strictEqual(spoofNuevaData.data.id, originalExpId, 'El expendio.id canónico se preserva');
  console.log(`  ✓ Campo "cedulaNueva" completamente ignorado. Cédula permanece: "${spoofNuevaData.data.cedula}".`);

  // 7. Verificación final de la base de datos en disco
  console.log('\n[Escenario 7] Verificación de la base de datos persistida...');
  const updatedDb = loadDatabase();
  const verifyExp = updatedDb.expendios.find(e => e.id === originalExpId);
  assert(verifyExp, 'Expendio debe existir en la base de datos');
  assert.strictEqual(verifyExp.cedula, originalCedula, 'Cédula en base de datos debe ser exactamente la original');
  assert.strictEqual(verifyExp.id, originalExpId, 'ID en base de datos debe ser el ID canónico inmutable');
  console.log('  ✓ Persistencia verificada: Cédula e ID son estrictamente inmutables en base de datos.');

  console.log('\n==============================================================');
  console.log('✓✓✓ TODOS LOS ESCENARIOS DE CÉDULA INMUTABLE FUERON SUPERADOS');
  console.log('==============================================================');
}

testImmutableCedulaScenarios().catch((err) => {
  console.error('Fallo en pruebas de cédula inmutable:', err);
  process.exit(1);
});
