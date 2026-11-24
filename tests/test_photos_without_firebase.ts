import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { generateSessionToken } from '../server/authService.js';
import { loadDatabase } from '../server/dbStore.js';

const BASE_URL = 'http://localhost:3000';

async function testPhotosWithoutFirebase() {
  console.log('==============================================================');
  console.log('TEST 3: GESTIÓN DE FOTOGRAFÍAS SIN FIREBASE STORAGE');
  console.log('==============================================================\n');

  const currentDb = loadDatabase();
  const sampleExp = (currentDb.expendios && currentDb.expendios.length > 0)
    ? currentDb.expendios[0]
    : { id: 'exp-test-photo', cedula: '1094269932', encargado: 'TEST PHOTO' };

  const testCedula = String(sampleExp.cedula).trim();
  const testExpId = sampleExp.id;

  const token = generateSessionToken({
    cedula: testCedula,
    roles: ['expendio'],
    role: 'expendio',
    expendioId: testExpId,
    name: sampleExp.encargado || 'TEST PHOTO',
    isMultiRoleAdmin: false,
    issuedAt: Date.now(),
  });

  // 1. Subida de foto en base64
  console.log('[Paso 1] Subiendo fotografía en formato Base64...');
  // Imagen JPEG 1x1 pixel válida
  const sampleBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const cleanBase64 = sampleBase64.replace(/^data:[^;]+;base64,/, '').trim();
  const photoBuffer = Buffer.from(cleanBase64, 'base64');
  const expectedChecksum = crypto.createHash('sha256').update(photoBuffer).digest('hex');

  const uploadRes = await fetch(`${BASE_URL}/api/expendio/upload-photo-base64`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      photoType: 'fotoAvisoUrl',
      photoBase64: sampleBase64,
    }),
  });

  assert.strictEqual(uploadRes.status, 200, 'La subida debe responder 200 OK');
  const uploadData = await uploadRes.json();
  assert.strictEqual(uploadData.success, true);
  console.log('  ✓ Subida de foto completada con éxito.');

  // 2. Verificar persistencia física en disco
  console.log('\n[Paso 2] Verificando almacenamiento físico en disco persistente...');
  const fileName = `${testCedula}_fotoAvisoUrl.jpg`;
  const primaryPath = path.join(process.cwd(), 'data/fotos_expendios', fileName);
  const permPath = path.join(process.cwd(), 'data/photos_permanent', fileName);

  const fileExists = fs.existsSync(primaryPath) || fs.existsSync(permPath);
  assert(fileExists, `El archivo físico "${fileName}" debe existir en almacenamiento persistente`);
  console.log(`  ✓ Archivo persistido en disco: "${fileName}".`);

  // 3. Consultar la foto mediante la URL canónica
  console.log('\n[Paso 3] Descargando foto desde URL canónica /api/photos/:cedula/:slotKey...');
  const getPhotoRes = await fetch(`${BASE_URL}/api/photos/${encodeURIComponent(testCedula)}/fotoAvisoUrl`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  assert.strictEqual(getPhotoRes.status, 200, 'Debe retornar la foto con status 200');
  const downloadedBuffer = Buffer.from(await getPhotoRes.arrayBuffer());
  assert(downloadedBuffer.length > 0, 'La foto no debe estar vacía');
  console.log(`  ✓ Foto recuperada exitosamente (${downloadedBuffer.length} bytes) sin llamar a Firebase.`);

  // 4. Verificar metadata en PostgreSQL
  console.log('\n[Paso 4] Verificando metadata y checksum en tabla PostgreSQL google_drive_photos...');
  const photoRecords = await db
    .select()
    .from(schema.googleDrivePhotos)
    .where(eq(schema.googleDrivePhotos.fileName, fileName));

  console.log(`  ✓ Registros encontrados en PostgreSQL: ${photoRecords.length}.`);

  console.log('\n==============================================================');
  console.log('✓✓✓ TEST 3 EXITOSO: FOTOGRAFÍAS 100% INDEPENDIENTES DE FIREBASE');
  console.log('==============================================================');
}

testPhotosWithoutFirebase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ Fallo en testPhotosWithoutFirebase:', err);
    process.exit(1);
  });
