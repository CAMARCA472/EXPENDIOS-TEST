import fs from 'fs';
import path from 'path';
import { db } from '../src/db/index.ts';
import { saveDatabaseToPostgres } from '../src/db/migrateData.ts';
import { normalizeDatabase } from '../server/dbStore.ts';

async function runMigration() {
  const publishedDbPath = path.join(process.cwd(), 'data', 'database.published.json');
  console.log('Checking published database at:', publishedDbPath);
  
  if (!fs.existsSync(publishedDbPath)) {
    console.error('database.published.json does not exist!');
    return;
  }

  const raw = fs.readFileSync(publishedDbPath, 'utf8');
  const parsed = JSON.parse(raw);
  const normalized = normalizeDatabase(parsed);
  
  console.log('Loaded published JSON database:');
  console.log('- Expendios:', normalized.expendios?.length);
  console.log('- Historial (Cuentas):', normalized.historial?.length);
  console.log('- RelacionPagos:', normalized.relacionPagos?.length);

  if (!normalized.historial || normalized.historial.length === 0) {
    console.warn('Historial is empty in database.published.json!');
    return;
  }

  console.log('Migrating and upserting loaded data directly to Cloud SQL PostgreSQL...');
  await saveDatabaseToPostgres(normalized);
  console.log('✓ Migration completed successfully.');
}

runMigration().catch(console.error);
