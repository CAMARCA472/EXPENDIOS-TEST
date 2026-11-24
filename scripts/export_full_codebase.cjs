const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();

// Ordered list of files and directories to include
const fileCategories = [
  {
    category: '1. CONFIGURACIÓN, REGLAS Y BLUEPRINT DEL SISTEMA',
    files: [
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'index.html',
      'metadata.json',
      '.env.example'
    ]
  },
  {
    category: '2. BACKEND Y PERSISTENCIA (EXPRESS + POSTGRESQL + DRIVE)',
    files: [
      'server.ts',
      'server/dbStore.ts',
      'server/postgresTransactionalStore.ts',
      'src/db/schema.ts',
      'src/db/index.ts',
      'src/db/cloudSqlStore.ts',
      'server/authService.ts',
      'server/domainIntegrity.ts',
      'server/durableOutbox.ts',
      'tests/test_concurrency_same_expendio.ts',
      'public/drive-sync-sw.js'
    ]
  },
  {
    category: '3. NÚCLEO FRONTEND Y TIPOS DE DATOS',
    files: [
      'src/main.tsx',
      'src/App.tsx',
      'src/types.ts'
    ]
  },
  {
    category: '4. LIBRERÍAS DE INTEGRACIÓN Y SERVICIOS CLIENTE',
    files: [
      'src/lib/cryptoToken.ts',
      'src/lib/driveSync.ts',
      'src/lib/driveSyncServiceWorker.ts',
      'src/lib/googleAuth.ts',
      'src/lib/googleDriveService.ts',
      'src/lib/googleSheetsService.ts',
      'src/lib/photoStorageDB.ts'
    ]
  },
  {
    category: '5. UTILIDADES, GENERADORES DE DOCUMENTOS Y FILTROS',
    files: [
      'src/utils/camScannerFilter.ts',
      'src/utils/documentosExpendiosGenerator.ts',
      'src/utils/formatters.ts',
      'src/utils/numeroALetras.ts',
      'src/utils/offlinePhotoQueue.ts',
      'src/utils/pdfGenerator.ts',
      'src/utils/photoValidation.ts',
      'src/utils/photoWatermarkGps.ts'
    ]
  },
  {
    category: '6. HOOKS PERSONALIZADOS',
    files: [
      'src/hooks/useAutoBackupGoogleDrive.ts',
      'src/hooks/useFirebaseData.ts'
    ]
  },
  {
    category: '7. COMPONENTES DE INTERFAZ DE USUARIO (MODALES Y PANELES)',
    directory: 'src/components'
  }
];

function collectFiles() {
  const result = [];

  for (const cat of fileCategories) {
    if (cat.files) {
      for (const rel of cat.files) {
        const full = path.join(rootDir, rel);
        if (fs.existsSync(full)) {
          result.push({ rel, category: cat.category, path: full });
        }
      }
    } else if (cat.directory) {
      const dirFull = path.join(rootDir, cat.directory);
      if (fs.existsSync(dirFull)) {
        const list = fs.readdirSync(dirFull).sort();
        for (const file of list) {
          if (file.endsWith('.tsx') || file.endsWith('.ts')) {
            const rel = path.join(cat.directory, file);
            result.push({ rel, category: cat.category, path: path.join(dirFull, file) });
          }
        }
      }
    }
  }

  return result;
}

function generateBundle() {
  const allFiles = collectFiles();
  console.log(`Recolectando ${allFiles.length} archivos fuente...`);

  let out = '';
  out += '################################################################################\n';
  out += '# PROYECTO: CONTROL DE PERSONAL Y EXPENDIOS - CAMARCA SAS                     #\n';
  out += '# EXPORTACIÓN COMPLETA DEL CÓDIGO FUENTE PARA ANÁLISIS EN CLAUDE / LLM         #\n';
  out += `# FECHA DE GENERACIÓN: ${new Date().toISOString()}                             #\n`;
  out += `Total de archivos incluidos: ${allFiles.length}\n`;
  out += '################################################################################\n\n';

  out += '================================================================================\n';
  out += 'TABLA DE CONTENIDOS / ÍNDICE DE ARCHIVOS\n';
  out += '================================================================================\n';

  let currentCat = '';
  let fileIndex = 1;
  for (const item of allFiles) {
    if (item.category !== currentCat) {
      currentCat = item.category;
      out += `\n[${currentCat}]\n`;
    }
    const content = fs.readFileSync(item.path, 'utf8');
    const lines = content.split('\n').length;
    const bytes = fs.statSync(item.path).size;
    out += `  ${String(fileIndex).padStart(2, '0')}. ${item.rel.padEnd(50, ' ')} | ${String(lines).padStart(5, ' ')} líneas | ${(bytes / 1024).toFixed(1).padStart(6, ' ')} KB\n`;
    fileIndex++;
  }

  out += '\n================================================================================\n';
  out += 'RESUMEN DE ARQUITECTURA DEL SISTEMA\n';
  out += '================================================================================\n';
  out += '1. BACKEND (server.ts, server/dbStore.ts, server/postgresTransactionalStore.ts):\n';
  out += '   - Node.js + Express + TypeScript montando Vite en desarrollo y estáticos en prod.\n';
  out += '   - Base de datos relacional PostgreSQL / Cloud SQL como única fuente de verdad.\n';
  out += '   - Mutaciones atómicas transaccionales con commit y control de concurrencia optimista.\n';
  out += '   - Endpoints de autenticación, generación de cuentas de cobro, relación de pagos.\n';
  out += '   - Guardas de seguridad: autorización por rol, rate limiting, hashing de credenciales.\n';
  out += '   - Sincronización automática asíncrona de 7 fotografías por punto con Google Drive.\n';
  out += '\n2. FRONTEND (src/):\n';
  out += '   - React 18 SPA con TypeScript, Tailwind CSS y Lucide Icons.\n';
  out += '   - Modos de acceso: Super Admin, Expendio (Punto Postal 4-72), y Cliente.\n';
  out += '   - Módulo de captura georreferenciada de 7 fotos con GPS y marca de agua en canvas.\n';
  out += '   - Generación de cuentas de cobro en PDF (pdf-lib) y planillas Excel (xlsx).\n';
  out += '   - Integración OAuth 2.0 para Google Drive y Google Sheets.\n';
  out += '================================================================================\n\n';

  // Append file contents
  fileIndex = 1;
  for (const item of allFiles) {
    const content = fs.readFileSync(item.path, 'utf8');
    const lines = content.split('\n').length;
    const bytes = fs.statSync(item.path).size;

    out += '################################################################################\n';
    out += `ARCHIVO [${fileIndex}/${allFiles.length}]: ${item.rel}\n`;
    out += `CATEGORÍA: ${item.category}\n`;
    out += `LÍNEAS: ${lines} | TAMAÑO: ${(bytes / 1024).toFixed(1)} KB\n`;
    out += '################################################################################\n';
    out += content;
    if (!content.endsWith('\n')) out += '\n';
    out += `\n# --- FIN DE ARCHIVO: ${item.rel} ---\n\n`;
    fileIndex++;
  }

  // Save to root and to public/
  const rootTarget = path.join(rootDir, 'codigo_completo_app.txt');
  const publicDir = path.join(rootDir, 'public');
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  const publicTarget = path.join(publicDir, 'codigo_completo_app.txt');

  fs.writeFileSync(rootTarget, out, 'utf8');
  fs.writeFileSync(publicTarget, out, 'utf8');

  const totalSizeMB = (fs.statSync(rootTarget).size / (1024 * 1024)).toFixed(2);
  const totalLines = out.split('\n').length;
  console.log(`✓ Archivo generado exitosamente: ${rootTarget}`);
  console.log(`✓ Copia pública generada: ${publicTarget}`);
  console.log(`✓ Total de archivos: ${allFiles.length}`);
  console.log(`✓ Total de líneas: ${totalLines}`);
  console.log(`✓ Tamaño total: ${totalSizeMB} MB`);
}

generateBundle();
