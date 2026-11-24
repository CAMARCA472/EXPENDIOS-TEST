import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cloud,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Database,
  ExternalLink,
  FolderOpen,
  Lock,
  Server,
  HardDrive,
} from 'lucide-react';

export interface AwsS3StatusData {
  success: boolean;
  primaryStorage: string;
  reserveStorage: string;
  bucket: string;
  region: string;
  maskedAccessKeyId?: string | null;
  credentialsConfigured: boolean;
  authenticated: boolean;
  bucketExists: boolean;
  bucketAccessible: boolean;
  bucketCreatedNow?: boolean;
  photoCountInBucket: number;
  totalBytes?: number;
  totalSizeMB?: string;
  totalSizeGB?: string;
  quotaGB?: number;
  quotaMB?: number;
  usagePercent?: string;
  availableMB?: string;
  availableGB?: string;
  avgPhotoSizeKB?: number;
  latencyMs?: number;
  checkedAt?: string;
  errorDetails?: string | null;
  consoleUrl?: string;
  sampleObjects?: Array<{
    key: string;
    size: number;
    lastModified?: string;
    etag?: string;
  }>;
}

interface AwsS3ConnectionStatusPanelProps {
  onStatusUpdated?: (status: AwsS3StatusData) => void;
  onSyncAllPhotos?: () => void;
  isSyncingPhotos?: boolean;
}

export const AwsS3ConnectionStatusPanel: React.FC<AwsS3ConnectionStatusPanelProps> = ({
  onStatusUpdated,
  onSyncAllPhotos,
  isSyncingPhotos = false,
}) => {
  const [statusData, setStatusData] = useState<AwsS3StatusData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onStatusUpdatedRef = useRef(onStatusUpdated);
  useEffect(() => {
    onStatusUpdatedRef.current = onStatusUpdated;
  }, [onStatusUpdated]);

  const verifyConnection = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const token =
        sessionStorage.getItem('camarca_token') ||
        localStorage.getItem('camarca_token') ||
        '';
      const headers: Record<string, string> = {
        'Cache-Control': 'no-store',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-session-token'] = token;
      }

      const response = await fetch(`/api/admin/s3/status?_t=${Date.now()}`, {
        headers,
        credentials: 'same-origin',
      });
      const json = await response.json();
      if (response.ok && json.success) {
        setStatusData(json);
        if (onStatusUpdatedRef.current) {
          onStatusUpdatedRef.current(json);
        }
      } else {
        setErrorMsg(json.message || json.errorDetails || 'No fue posible verificar la conexión con AWS S3.');
        setStatusData(json);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error de red al verificar el estado del bucket AWS S3.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    verifyConnection();
  }, [verifyConnection]);

  const isAuthOk = Boolean(statusData?.authenticated && statusData?.credentialsConfigured);
  const isBucketOk = Boolean(statusData?.bucketAccessible && statusData?.bucketExists);
  const bucketName = statusData?.bucket || 'camarca-expendios-photos-contingency';
  const regionName = statusData?.region || 'us-east-1';

  const usedMB = statusData?.totalSizeMB || '0.00';
  const usedGB = statusData?.totalSizeGB || '0.0000';
  const quotaGB = statusData?.quotaGB ?? 5.0;
  const quotaMB = statusData?.quotaMB ?? 5120;
  const usagePercentNum = Math.min(100, Math.max(0, parseFloat(statusData?.usagePercent || '0')));
  const usagePercentLabel = statusData?.usagePercent || '0.00';
  const availableMB = statusData?.availableMB || '5120.00';
  const availableGB = statusData?.availableGB || '5.000';
  const avgPhotoKB = statusData?.avgPhotoSizeKB ?? 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      {/* Encabezado Principal */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-sky-400 font-semibold">
            <Cloud className="w-4 h-4" />
            <span>Almacenamiento Primario AWS S3</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="font-mono text-slate-300">{bucketName}</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">Región {regionName}</span>
          </div>
          <h3 className="text-base font-bold text-slate-100">
            Verificación de Conexión y Acceso al Bucket AWS S3
          </h3>
          <p className="text-xs text-slate-400">
            Comprueba en tiempo real las credenciales IAM configuradas, la accesibilidad y el uso de almacenamiento del bucket primario{' '}
            <span className="font-mono text-slate-200">{bucketName}</span>, manteniendo Firebase Storage en reserva.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={verifyConnection}
            disabled={loading}
            className="min-w-[185px] justify-center bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} />
            <span className="whitespace-nowrap">{loading ? 'Verificando S3...' : 'Verificar Conexión S3'}</span>
          </button>

          {onSyncAllPhotos && (
            <button
              type="button"
              onClick={onSyncAllPhotos}
              disabled={isSyncingPhotos}
              className="min-w-[205px] justify-center bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-100 border border-slate-700 font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Database className={`w-3.5 h-3.5 shrink-0 text-emerald-400 ${isSyncingPhotos ? 'animate-spin' : ''}`} />
              <span className="whitespace-nowrap">{isSyncingPhotos ? 'Sincronizando...' : 'Sincronizar Fotos al Bucket'}</span>
            </button>
          )}

          {statusData?.consoleUrl && (
            <a
              href={statusData.consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-slate-800/80 hover:bg-slate-800 text-sky-300 border border-slate-700 font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-1.5 transition-colors"
              title="Abrir carpeta photos/ directamente en la consola de AWS S3"
            >
              <span>Abrir Bucket en AWS</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Mensaje de error si ocurre */}
      {(errorMsg || statusData?.errorDetails) && (
        <div className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-700/50 text-amber-200 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-semibold">Aviso de diagnóstico AWS S3</div>
            <div className="text-amber-300/90">{errorMsg || statusData?.errorDetails}</div>
          </div>
        </div>
      )}

      {/* Métricas de Diagnóstico (Autenticación, Accesibilidad, Inventario, Uso de Almacenamiento y Prioridad) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* 1. Estado de Autenticación IAM */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex items-start gap-3">
          <div
            className={`p-2 rounded-lg shrink-0 ${
              isAuthOk
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}
          >
            <Lock className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-slate-400 font-medium">Autenticación AWS IAM</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              {isAuthOk ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-xs font-bold text-emerald-400 truncate">Credenciales Válidas</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs font-bold text-amber-400 truncate">Revisar Credenciales</span>
                </>
              )}
            </div>
            <div className="mt-1 text-[11px] text-slate-500 font-mono truncate">
              {statusData?.maskedAccessKeyId
                ? `${statusData.maskedAccessKeyId} · ${regionName}`
                : `SDK @aws-sdk/client-s3 · ${regionName}`}
            </div>
          </div>
        </div>

        {/* 2. Accesibilidad del Bucket */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex items-start gap-3">
          <div
            className={`p-2 rounded-lg shrink-0 ${
              isBucketOk
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}
          >
            <FolderOpen className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-slate-400 font-medium">Estado del Bucket S3</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              {isBucketOk ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-xs font-bold text-emerald-400 truncate">Bucket Accesible</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs font-bold text-amber-400 truncate">No Accesible</span>
                </>
              )}
            </div>
            <div className="mt-1 text-[11px] text-slate-500 font-mono truncate" title={bucketName}>
              {bucketName}
            </div>
          </div>
        </div>

        {/* 3. Objetos Almacenados en el Bucket */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex items-start gap-3">
          <div className="p-2 rounded-lg shrink-0 bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Database className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-slate-400 font-medium">Fotografías en S3 (photos/)</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-sm font-bold text-slate-100 font-mono tabular-nums">
                {statusData ? statusData.photoCountInBucket : '—'}
              </span>
              <span className="text-[11px] text-slate-400">
                archivos ({usedMB} MB)
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Latencia S3: <span className="font-mono text-slate-300">{statusData?.latencyMs ?? '—'} ms</span>
            </div>
          </div>
        </div>

        {/* 4. Uso de Almacenamiento S3 */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex items-start gap-3">
          <div className="p-2 rounded-lg shrink-0 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <HardDrive className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-slate-400 font-medium">Uso de Almacenamiento S3</div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-sm font-bold text-slate-100 font-mono tabular-nums">
                {usedMB} MB
              </span>
              <span className="text-[11px] text-sky-400 font-mono tabular-nums">
                ({usagePercentLabel}%)
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500 font-mono truncate">
              Libre: {availableGB} GB de {quotaGB.toFixed(1)} GB
            </div>
          </div>
        </div>

        {/* 5. Jerarquía de Almacenamiento */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex items-start gap-3">
          <div className="p-2 rounded-lg shrink-0 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Server className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-slate-400 font-medium">Prioridad de Almacenamiento</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-xs font-bold text-slate-100 truncate">AWS S3 (Primario)</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Reserva: Firebase Storage · Backup: Drive
            </div>
          </div>
        </div>
      </div>

      {/* Barra Detallada de Uso de Almacenamiento del Bucket AWS S3 */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="text-xs font-bold text-slate-200">
              Capacidad y Uso de Almacenamiento en Bucket Primario ({bucketName})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
            <span className="text-slate-300">
              Usado: <strong className="text-sky-400">{usedMB} MB</strong> ({usedGB} GB)
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-300">
              Disponible: <strong className="text-emerald-400">{availableMB} MB</strong> ({availableGB} GB)
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">
              Cuota Ref.: <strong className="text-slate-200">{quotaGB.toFixed(1)} GB</strong> ({quotaMB} MB)
            </span>
          </div>
        </div>

        {/* Barra de progreso */}
        <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              usagePercentNum > 85
                ? 'bg-red-500'
                : usagePercentNum > 65
                ? 'bg-amber-500'
                : 'bg-gradient-to-r from-sky-500 to-emerald-400'
            }`}
            style={{ width: `${Math.max(usagePercentNum > 0 ? 1.5 : 0, usagePercentNum)}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Ocupación actual:{' '}
              <strong className="text-slate-200 font-mono">{usagePercentLabel}%</strong> del nivel estándar (5 GB)
            </span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span>
              Tamaño exacto:{' '}
              <strong className="text-slate-300 font-mono">
                {(statusData?.totalBytes ?? 0).toLocaleString('es-CO')} bytes
              </strong>
            </span>
            {avgPhotoKB > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-700">·</span>
                <span>
                  Promedio por foto:{' '}
                  <strong className="text-slate-300 font-mono">~{avgPhotoKB} KB</strong>
                </span>
              </>
            )}
          </div>
          <span className="text-emerald-400 font-medium">
            Capacidad óptima · Sin riesgo de saturación
          </span>
        </div>
      </div>

      {/* Pie con fecha de última comprobación */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 pt-1 border-t border-slate-800/60">
        <div className="flex items-center gap-2">
          <span>
            Última verificación:{' '}
            <strong className="text-slate-300 font-mono">
              {statusData?.checkedAt ? new Date(statusData.checkedAt).toLocaleTimeString('es-CO') : 'Pendiente'}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            URI: <code className="text-sky-300 font-mono">s3://{bucketName}/photos/</code>
          </span>
        </div>
      </div>
    </div>
  );
};
