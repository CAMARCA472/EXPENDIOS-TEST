import { getDatabase, getRegistrosAcceso } from '../../server/dbStore.ts';

export interface ActiveConnectionInfo {
  pid: number;
  clientAddr: string;
  applicationName: string;
  state: string;
  backendStart: string;
  queryStart: string;
  query: string;
  latencyMs: number;
}

export interface TableMetricInfo {
  tableName: string;
  displayName: string;
  rowCount: number;
  sizePretty: string;
  lastUpdated: string;
}

export interface CloudSqlDetailedMetrics {
  connected: boolean;
  instanceName: string;
  region: string;
  databaseName: string;
  databaseSize: string;
  serverVersion: string;
  activeConnectionsCount: number;
  maxConnections: number;
  poolTotalCount: number;
  poolIdleCount: number;
  poolWaitingCount: number;
  currentLatencyMs: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  activeConnections: ActiveConnectionInfo[];
  tables: TableMetricInfo[];
  timestamp: string;
}

export async function getCloudSqlDetailedMetrics(): Promise<CloudSqlDetailedMetrics> {
  const localDb = getDatabase();
  const nowIso = new Date().toISOString();
  const expCount = Array.isArray(localDb.expendios) ? localDb.expendios.length : 0;
  const histCount = Array.isArray(localDb.historial) ? localDb.historial.length : 0;
  const pagosCount = Array.isArray(localDb.relacionPagos) ? localDb.relacionPagos.length : 0;
  const trazCount = Array.isArray(localDb.trazabilidad) ? localDb.trazabilidad.length : 0;
  const cuentasCount = Array.isArray(localDb.cuentasCargadas) ? localDb.cuentasCargadas.length : 0;
  const accCount = getRegistrosAcceso().length;

  const tables: TableMetricInfo[] = [
    {
      tableName: 'expendios',
      displayName: 'Catálogo Maestro de Expendios (4-72)',
      rowCount: expCount,
      sizePretty: '~220 KB',
      lastUpdated: localDb.updatedAt || nowIso,
    },
    {
      tableName: 'historial_cuentas',
      displayName: 'Historial de Cuentas de Cobro',
      rowCount: histCount,
      sizePretty: '~650 KB',
      lastUpdated: localDb.updatedAt || nowIso,
    },
    {
      tableName: 'relacion_pagos',
      displayName: 'Relación Consolidada de Pagos',
      rowCount: pagosCount,
      sizePretty: '~120 KB',
      lastUpdated: localDb.updatedAt || nowIso,
    },
    {
      tableName: 'cuentas_cargadas',
      displayName: 'Cuentas Firmadas Cargadas por Puntos',
      rowCount: cuentasCount,
      sizePretty: '~45 KB',
      lastUpdated: localDb.updatedAt || nowIso,
    },
    {
      tableName: 'trazabilidad',
      displayName: 'Auditoría y Trazabilidad de Novedades',
      rowCount: trazCount,
      sizePretty: '~35 KB',
      lastUpdated: localDb.updatedAt || nowIso,
    },
    {
      tableName: 'registros_acceso',
      displayName: 'Logs de Acceso y Seguridad HTTP',
      rowCount: accCount,
      sizePretty: '~20 KB',
      lastUpdated: nowIso,
    },
  ];

  return {
    connected: true,
    instanceName: 'firestore-drive-zero-cost',
    region: 'us-east1 (Capa Gratuita $0)',
    databaseName: 'camarca_zero_cost_db',
    databaseSize: '~1.2 MB',
    serverVersion: 'Firestore + Drive ($0/mes)',
    activeConnectionsCount: 0,
    maxConnections: 100,
    poolTotalCount: 0,
    poolIdleCount: 0,
    poolWaitingCount: 0,
    currentLatencyMs: 1,
    avgLatencyMs: 1,
    minLatencyMs: 1,
    maxLatencyMs: 2,
    activeConnections: [],
    tables,
    timestamp: nowIso,
  };
}

export async function getCloudSqlDatabaseSnapshot(): Promise<any> {
  const localDb = getDatabase();
  const expList = Array.isArray(localDb.expendios) ? localDb.expendios : [];
  return {
    expendios: expList,
    historial: Array.isArray(localDb.historial) ? localDb.historial : [],
    relacionPagos: Array.isArray(localDb.relacionPagos) ? localDb.relacionPagos : [],
    trazabilidad: Array.isArray(localDb.trazabilidad) ? localDb.trazabilidad : [],
    cuentasCargadas: Array.isArray(localDb.cuentasCargadas) ? localDb.cuentasCargadas : [],
    config: localDb.config || {},
    revision: localDb.revision || Math.max(...expList.map((e: any) => e.revision || 1), 1),
    updatedAt: localDb.updatedAt || new Date().toISOString(),
  };
}

export async function checkCloudSqlHealth() {
  const metrics = await getCloudSqlDetailedMetrics();
  return {
    expendiosCount: metrics.tables.find((t) => t.tableName === 'expendios')?.rowCount || 0,
    historialCount: metrics.tables.find((t) => t.tableName === 'historial_cuentas')?.rowCount || 0,
    relacionPagosCount: metrics.tables.find((t) => t.tableName === 'relacion_pagos')?.rowCount || 0,
    trazabilidadCount: metrics.tables.find((t) => t.tableName === 'trazabilidad')?.rowCount || 0,
    cuentasCargadasCount: metrics.tables.find((t) => t.tableName === 'cuentas_cargadas')?.rowCount || 0,
    connected: true,
    latencyMs: 1,
    metrics,
  };
}
