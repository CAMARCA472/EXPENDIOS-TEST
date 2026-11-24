import assert from 'assert';
import { generateSessionToken, verifySessionToken, normalizeCedula, ADMIN_CEDULA } from '../server/authService.js';
import { loadDatabase } from '../server/dbStore.js';

const BASE_URL = 'http://localhost:3000';

async function testAuthWithoutFirebase() {
  console.log('==============================================================');
  console.log('TEST 4: AUTENTICACIÓN CENTRALIZADA SIN FIREBASE AUTH');
  console.log('==============================================================\n');

  const db = loadDatabase();
  const sampleExp = (db.expendios && db.expendios.length > 0)
    ? db.expendios[0]
    : { id: 'exp-test-1', cedula: '1116796414', encargado: 'TEST USER' };

  const validCedula = String(sampleExp.cedula).trim();

  // 1. Login vía API con Cédula
  console.log('[Paso 1] Ejecutando Login mediante Cédula contra el backend (sin Firebase Auth)...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cedula: validCedula }),
  });

  assert.strictEqual(loginRes.status, 200, 'Login debe retornar HTTP 200');
  const loginData = await loginRes.json();
  assert(loginData.success, 'Login debe ser exitoso');
  assert(loginData.token, 'Debe devolver un token firmado');
  assert.strictEqual(loginData.user.expendioId, sampleExp.id, 'Debe resolver expendioId canónico');
  console.log(`  ✓ Login exitoso. Token firmado emitido por el backend.`);

  // 2. Verificación criptográfica del token
  console.log('\n[Paso 2] Verificando firma criptográfica HMAC-SHA256 del token...');
  const verifiedUser = verifySessionToken(loginData.token);
  assert(verifiedUser, 'El token debe ser verificado con éxito');
  assert.strictEqual(normalizeCedula(verifiedUser.cedula), normalizeCedula(validCedula));
  console.log(`  ✓ Token válido para usuario: "${verifiedUser.name}" (CC: ${verifiedUser.cedula}).`);

  // 3. Verificación de Login de Administrador
  console.log('\n[Paso 3] Verificando login de Administrador Maestro (C.C. 1094269932)...');
  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cedula: ADMIN_CEDULA }),
  });

  assert.strictEqual(adminLoginRes.status, 200);
  const adminData = await adminLoginRes.json();
  assert(adminData.user.roles.includes('admin'), 'Debe otorgar rol de admin exclusivamente');
  console.log('  ✓ Administrador autenticado correctamente con rol "admin".');

  // 4. Intento de elevar privilegios admin con cédula distinta
  console.log('\n[Paso 4] Verificando que cédula no autorizada con token manipulado sea rechazada para Admin...');
  const forgedToken = generateSessionToken({
    cedula: '12345678',
    roles: ['admin'],
    role: 'admin',
    expendioId: 'exp-forged',
    name: 'Hacker',
    isMultiRoleAdmin: false,
    issuedAt: Date.now(),
  });

  const verifiedForged = verifySessionToken(forgedToken);
  assert.strictEqual(verifiedForged, null, 'El backend debe rechazar el token con rol admin y cédula no autorizada');
  console.log('  ✓ Intento de elevación de privilegios bloqueado estrictamente por la capa de seguridad.');

  // 5. Verificación de rechazo ante cédula inexistente
  console.log('\n[Paso 5] Verificando rechazo ante cédula inexistente...');
  const nonExistentRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cedula: '99999999999999' }),
  });
  assert.strictEqual(nonExistentRes.status, 404, 'Cédula inexistente debe responder 404');
  console.log('  ✓ Cédula inexistente rechazada con 404.');

  console.log('\n==============================================================');
  console.log('✓✓✓ TEST 4 EXITOSO: AUTENTICACIÓN SEGURA SIN FIREBASE AUTH');
  console.log('==============================================================');
}

testAuthWithoutFirebase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ Fallo en testAuthWithoutFirebase:', err);
    process.exit(1);
  });
