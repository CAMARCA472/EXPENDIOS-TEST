import assert from 'assert';
import fs from 'fs';
import path from 'path';

/**
 * TEST: VERIFICACIÓN DE RESTRICCIÓN ESTRICTA DE FIREBASE
 *
 * ARQUITECTURA OFICIAL:
 * - PERMITIDO:
 *   - 'firebase-admin' exclusivamente para Firebase Storage (persistencia de bytes de fotografías en bucket).
 * - PROHIBIDO:
 *   - Firestore / @google-cloud/firestore / @firebase/firestore como base de datos o caché.
 *   - Firebase Auth como autenticación de usuarios (se usa JWT/sesión propia con PostgreSQL).
 *   - Firebase como fuente de verdad (la única fuente de verdad es PostgreSQL).
 */
async function testStrictFirebaseStorageOnly() {
  console.log('========================================================================');
  console.log('TEST: VERIFICACIÓN DE RESTRICCIÓN ESTRICTA DE FIREBASE (STORAGE ONLY)');
  console.log('========================================================================\n');

  // 1. Verificar package.json: Cero Firestore, Cero Firebase client SDK
  console.log('[Paso 1] Verificando dependencias en package.json...');
  const pkgJsonPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  // Paquetes prohibidos (Firestore y cliente completo)
  const forbiddenPackages = [
    '@google-cloud/firestore',
    '@firebase/firestore',
    '@firebase/auth',
    'firebase', // Client bundle
  ];

  for (const p of forbiddenPackages) {
    assert.strictEqual(allDeps[p], undefined, `El paquete prohibido "${p}" no debe estar en package.json`);
  }

  // Verificar que firebase-admin existe para Storage
  assert.ok(
    allDeps['firebase-admin'],
    'firebase-admin debe estar instalado para dar soporte a Firebase Storage (almacenamiento de fotos).'
  );
  console.log('  ✓ Dependencias verificadas: Firestore ausente, firebase-admin disponible para Storage.');

  // 2. Verificar ausencia de artefactos de base de datos Firestore
  console.log('\n[Paso 2] Verificando ausencia de artefactos de Firestore como base de datos...');
  const forbiddenFiles = [
    'firestore.rules',
    'firebase-blueprint.json',
    'server/firestoreDatabase.ts',
    'src/lib/firebase.ts',
    'src/components/FirebaseHealthCheck.tsx',
    'src/components/FirebaseDailyUsageCard.tsx',
    'src/components/FirebaseQuotaMonitorView.tsx',
    'data/.firestore_quota_status.json',
    'data/.firestore_daily_usage.json',
    'data/.firestore_hashes.json',
  ];

  for (const f of forbiddenFiles) {
    const fullPath = path.join(process.cwd(), f);
    assert.strictEqual(
      fs.existsSync(fullPath),
      false,
      `El archivo de Firestore "${f}" no debe existir en el proyecto`
    );
  }
  console.log('  ✓ Cero reglas o artefactos de Firestore en el proyecto.');

  // 3. Verificar código fuente: Cero uso de Firestore o Firebase Auth en src/ y server/
  console.log('\n[Paso 3] Escaneando código fuente para garantizar que Firebase no se use como DB...');
  const scanDirs = ['src', 'server'];
  let forbiddenMatches = 0;

  for (const dir of scanDirs) {
    const dirPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(dirPath)) continue;

    const walk = (d: string) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          const content = fs.readFileSync(full, 'utf-8');

          // Prohibido: imports de Firestore o Firebase Auth
          const forbiddenImport = content.match(
            /from\s+['"](@google-cloud\/firestore|@firebase\/firestore|firebase\/firestore|firebase\/auth)['"]/g
          );
          if (forbiddenImport) {
            console.error(`  ✗ Import prohibido en ${full}:`, forbiddenImport);
            forbiddenMatches++;
          }

          // Prohibido: llamadas al SDK de base de datos Firestore
          const firestoreSdkMatch = content.match(
            /\b(getFirestore|firestore\(\)|onSnapshot|runTransaction|setDoc|getDoc|getDocs|deleteDoc)\s*\(/g
          );
          if (firestoreSdkMatch) {
            console.error(`  ✗ Llamada prohibida a SDK de Firestore en ${full}:`, firestoreSdkMatch);
            forbiddenMatches++;
          }
        }
      }
    };
    walk(dirPath);
  }

  assert.strictEqual(
    forbiddenMatches,
    0,
    'No debe existir ningún import ni invocación a Firestore/Auth en el código fuente.'
  );
  console.log('  ✓ Verificado: Cero uso de Firestore como base de datos o caché.');

  console.log('\n========================================================================');
  console.log('✓✓✓ TEST EXITOSO: FIREBASE STORAGE PERMITIDO PARA BYTES, FIRESTORE ELIMINADO');
  console.log('========================================================================');
}

testStrictFirebaseStorageOnly()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ Fallo en testStrictFirebaseStorageOnly:', err);
    process.exit(1);
  });
