import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const outputFile = path.join(rootDir, 'camarca_codigo_completo.txt');
const publicOutputFile = path.join(rootDir, 'public', 'camarca_codigo_completo.txt');

// Extensiones de código fuente estricto
const allowedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.html', '.css', '.json', '.sql'];

// Carpetas de datos pesados, snapshots, logs y artefactos que NO son código fuente
const ignoredPaths = [
  'node_modules',
  'dist',
  '.git',
  '.vite',
  'data', // Ignorar backups y snapshots de base de datos JSON
  'public/camarca_codigo_completo.txt',
  'camarca_codigo_completo.txt',
  'package-lock.json',
  '.env',
];

function getAllCodeFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    const relPath = path.relative(rootDir, fullPath);

    if (ignoredPaths.some((ignored) => relPath === ignored || relPath.startsWith(ignored + path.sep))) {
      return;
    }

    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllCodeFiles(fullPath, arrayOfFiles);
    } else {
      const ext = path.extname(file).toLowerCase();
      if (allowedExtensions.includes(ext)) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

export function generatePureCodeTxt() {
  console.log('[Export Code] Recolectando archivos de código fuente puro...');
  const allFiles = getAllCodeFiles(rootDir);
  allFiles.sort();
  console.log(`[Export Code] Total de archivos de código fuente: ${allFiles.length}`);

  let combinedContent = '';
  combinedContent += `================================================================================\n`;
  combinedContent += `  CAMARCA S.A.S. - CÓDIGO FUENTE PURO CONSOLIDADO\n`;
  combinedContent += `  Fecha de generación: ${new Date().toISOString()}\n`;
  combinedContent += `  Total de archivos: ${allFiles.length}\n`;
  combinedContent += `  Arquitectura: React (TypeScript) + Express API + Cloud SQL (PostgreSQL 18.6)\n`;
  combinedContent += `================================================================================\n\n`;

  // Índice de archivos
  combinedContent += `ÍNDICE GENERAL DE ARCHIVOS FUENTE:\n`;
  allFiles.forEach((file, idx) => {
    const rel = path.relative(rootDir, file);
    const sizeKb = (fs.statSync(file).size / 1024).toFixed(1);
    combinedContent += `  [${String(idx + 1).padStart(3, ' ')}] ${rel} (${sizeKb} KB)\n`;
  });
  combinedContent += `\n================================================================================\n\n`;

  // Concatenar cada archivo con cabeceras claras
  allFiles.forEach((file, idx) => {
    const rel = path.relative(rootDir, file);
    try {
      const content = fs.readFileSync(file, 'utf-8');
      combinedContent += `/*******************************************************************************\n`;
      combinedContent += ` * [${idx + 1}/${allFiles.length}] ARCHIVO: ${rel}\n`;
      combinedContent += ` ******************************************************************************/\n\n`;
      combinedContent += content;
      combinedContent += `\n\n`;
    } catch (e: any) {
      console.warn(`[Export Code] Error leyendo archivo ${rel}:`, e.message);
    }
  });

  fs.writeFileSync(outputFile, combinedContent, 'utf-8');
  if (!fs.existsSync(path.join(rootDir, 'public'))) {
    fs.mkdirSync(path.join(rootDir, 'public'), { recursive: true });
  }
  fs.writeFileSync(publicOutputFile, combinedContent, 'utf-8');

  const sizeMb = (fs.statSync(outputFile).size / (1024 * 1024)).toFixed(2);
  const sizeKb = (fs.statSync(outputFile).size / 1024).toFixed(0);
  console.log(`[Export Code] ✓ Archivo de código puro generado: ${outputFile} (${sizeMb} MB / ${sizeKb} KB)`);
}

generatePureCodeTxt();
