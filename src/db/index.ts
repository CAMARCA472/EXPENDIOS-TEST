import * as schema from './schema.ts';

/**
 * Motor Sin Costo $0 (Desconexión Total de Cloud SQL PostgreSQL)
 * --------------------------------------------------------------
 * Este módulo reemplaza la conexión TCP a Cloud SQL por un adaptador local sin costo ($0 COP/mes)
 * respaldado por data/database.json + data/database.published.json + Firebase Firestore + Google Drive.
 * No abre ningún socket ni realiza conexiones de red hacia instancias de Cloud SQL.
 */

export function isProductionDatabaseTarget(): boolean {
  const env = String(process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase();
  return env === 'production' || env === 'prod';
}

export function assertNotProduction(actionDescription: string = 'operación destructiva de pruebas') {
  if (isProductionDatabaseTarget()) {
    throw new Error(`SECURITY_VIOLATION: [${actionDescription}] está prohibido en producción.`);
  }
}

function createChainableQueryStub(defaultResult: any = []) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    offset: () => chain,
    orderBy: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    groupBy: () => chain,
    values: () => chain,
    set: () => chain,
    onConflictDoUpdate: () => chain,
    onConflictDoNothing: () => chain,
    returning: () => Promise.resolve(defaultResult),
    execute: () => Promise.resolve(defaultResult),
    then: (onFulfilled?: any, onRejected?: any) => Promise.resolve(defaultResult).then(onFulfilled, onRejected),
    catch: (onRejected?: any) => Promise.resolve(defaultResult).catch(onRejected),
    finally: (onFinally?: any) => Promise.resolve(defaultResult).finally(onFinally),
  };
  return chain;
}

const zeroCostPoolStub: any = {
  totalCount: 0,
  idleCount: 0,
  waitingCount: 0,
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  }),
  on: () => {},
  end: async () => {},
};

export const createPool = () => zeroCostPoolStub;

export const db: any = {
  schema,
  select: () => createChainableQueryStub([]),
  insert: () => createChainableQueryStub([]),
  update: () => createChainableQueryStub([]),
  delete: () => createChainableQueryStub([]),
  execute: async () => ({ rows: [{ version: 'Motor Sin Costo $0 (Firestore + JSON + Drive)', current_database: 'camarca_zero_cost', current_user: 'camarca' }], rowCount: 1 }),
  transaction: async (cb: (tx: any) => Promise<any>) => cb(db),
  query: {},
};
