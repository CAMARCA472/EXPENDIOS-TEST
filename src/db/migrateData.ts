import { DatabaseSchema, setAuthoritativeDatabase, getDatabase } from '../../server/dbStore.ts';

export async function saveDatabaseToPostgres(data?: DatabaseSchema) {
  if (data) {
    setAuthoritativeDatabase(data);
  } else {
    const current = getDatabase();
    setAuthoritativeDatabase(current);
  }
  return true;
}

export async function migrateLocalJsonToCloudSql() {
  return saveDatabaseToPostgres();
}
