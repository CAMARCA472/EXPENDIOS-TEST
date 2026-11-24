import assert from 'assert';

const BASE_URL = 'http://localhost:3000';

async function runSecurityFunctionalTests() {
  console.log('==============================================================');
  console.log('EJECUTANDO PRUEBAS FUNCIONALES HTTP EN VIVO (PORT 3000)');
  console.log('==============================================================\n');

  // Primero, consultar un expendio existente en el sistema
  // Para las pruebas, creamos dos expendios de prueba o usamos el existente
  const configRes = await fetch(`${BASE_URL}/api/config`);
  assert(configRes.ok, 'Servidor debe responder a /api/config');

  // Caso G: Cédula válida -> resolver expendio.id real
  console.log('[Prueba G] Cédula válida: debe resolver expendio.id real...');
  const { loadDatabase } = await import('../server/dbStore.js');
  const currentDb = loadDatabase();
  const sampleExp = (currentDb.expendios && currentDb.expendios.length > 0)
    ? currentDb.expendios[0]
    : { id: 'exp-sample-1', cedula: '1116796414' };

  const validCedula = String(sampleExp.cedula).trim();
  const expectedExpId = sampleExp.id;

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cedula: validCedula }),
  });

  assert.strictEqual(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert(loginData.success, 'Login debe ser exitoso');
  assert.strictEqual(loginData.user.expendioId, expectedExpId, `Debe resolver expendio.id canónico ("${expectedExpId}")`);
  assert.notStrictEqual(loginData.user.expendioId, validCedula, 'expendioId no debe ser la cédula');
  console.log(`  ✓ Login exitoso. expendioId canónico resuelto: "${loginData.user.expendioId}".`);

  // Caso E: Cédula inexistente -> rechazar con 404
  console.log('\n[Prueba E] Cédula inexistente: debe rechazar con 404 Not Found...');
  const nonExistentRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cedula: '9999999999999999' }),
  });
  const nonExistentData = await nonExistentRes.json();
  assert.strictEqual(nonExistentRes.status, 404);
  assert.strictEqual(nonExistentData.success, false);
  console.log('  ✓ Acceso rechazado correctamente con 404 ante cédula inexistente.');

  // Caso B: Modificar x-user-role NO cambia permisos
  console.log('\n[Prueba B] Modificar x-user-role: NO debe otorgar permisos administrativos...');
  const spoofRoleRes = await fetch(`${BASE_URL}/api/admin/historial`, {
    headers: {
      'x-user-role': 'admin',
    },
  });
  assert.strictEqual(spoofRoleRes.status, 403, 'Debe rechazar con 403 Forbidden');
  console.log('  ✓ Intento de spoofing de rol con x-user-role rechazado con 403.');

  // Caso C: Modificar x-user-cedula NO establece identidad
  console.log('\n[Prueba C] Modificar x-user-cedula: NO debe establecer identidad...');
  const spoofCedulaRes = await fetch(`${BASE_URL}/api/expendio/exp-test-1`, {
    headers: {
      'x-user-cedula': '1094269932',
    },
  });
  assert.strictEqual(spoofCedulaRes.status, 401, 'Debe rechazar con 401 Unauthorized sin token criptográfico');
  console.log('  ✓ Intento de spoofing de identidad con x-user-cedula rechazado con 401.');

  // Caso D: Enviar requestedRole NO cambia permisos
  console.log('\n[Prueba D] Enviar requestedRole en login: NO debe cambiar permisos...');
  const reqRoleRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cedula: validCedula,
      requestedRole: 'admin',
      role: 'admin',
    }),
  });
  const reqRoleData = await reqRoleRes.json();
  assert(reqRoleData.success, 'Login exitoso');
  assert(!reqRoleData.user.roles.includes('admin'), 'Usuario no debe recibir rol admin');
  assert.strictEqual(reqRoleData.user.role, 'expendio', 'El rol final debe ser expendio');
  console.log('  ✓ requestedRole ignorado completamente; solo se asignan roles autorizados.');

  // Caso A: Usuario Expendio A intenta acceder a Expendio B -> 403
  console.log('\n[Prueba A] Usuario Expendio A intenta acceder a datos de Expendio B -> debe recibir 403...');
  const { generateSessionToken } = await import('../server/authService.js');
  const tokenExpA = generateSessionToken({
    cedula: '88123456',
    roles: ['expendio'],
    role: 'expendio',
    expendioId: 'exp-diferente-no-autorizado',
    name: 'Expendio A',
    isMultiRoleAdmin: false,
    issuedAt: Date.now(),
  });

  // Acceder al expendio real (sampleExp.id) con las credenciales de exp-diferente
  const crossAccessRes = await fetch(`${BASE_URL}/api/expendio/${expectedExpId}`, {
    headers: {
      'Authorization': `Bearer ${tokenExpA}`,
    },
  });
  assert.strictEqual(crossAccessRes.status, 403, 'Debe denegar acceso cruzado con 403 Forbidden');
  const crossAccessData = await crossAccessRes.json();
  assert.strictEqual(crossAccessData.success, false);
  console.log(`  ✓ Intento de acceso cruzado denegado estrictamente con 403 Forbidden: "${crossAccessData.message}".`);

  console.log('\n==============================================================');
  console.log('✓✓✓ TODAS LAS PRUEBAS FUNCIONALES HTTP EN VIVO PASARON');
  console.log('==============================================================');
}

runSecurityFunctionalTests().catch((err) => {
  console.error('Fallo en pruebas funcionales HTTP:', err);
  process.exit(1);
});
