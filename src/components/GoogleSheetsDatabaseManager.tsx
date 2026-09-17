import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  Cloud,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  UploadCloud,
  DownloadCloud,
  ShieldCheck,
  AlertCircle,
  Clock,
  Database,
  ArrowUpDown,
  Sparkles,
  Info,
} from 'lucide-react';
import {
  syncDatabaseToGoogleSheets,
  importExpendiosFromGoogleSheets,
  findExistingDatabaseSpreadsheet,
  GoogleSheetInfo,
  GoogleSheetsSyncResult,
  SPREADSHEET_TITLE,
  SHEET_NAME_EXPENDIOS,
  SHEET_NAME_HISTORIAL,
  SHEET_NAME_PAGOS,
} from '../lib/googleSheetsService';
import { ExpendioData, HistorialItem, PagoRelacionItem, ThemeMode } from '../types';

interface GoogleSheetsDatabaseManagerProps {
  accessToken: string | null;
  isAuthenticated: boolean;
  onSignIn?: () => void;
  theme?: ThemeMode;
  onDataImported?: (importedExpendios: Partial<ExpendioData>[]) => void;
}

export const GoogleSheetsDatabaseManager: React.FC<GoogleSheetsDatabaseManagerProps> = ({
  accessToken,
  isAuthenticated,
  onSignIn,
  theme = 'light',
  onDataImported,
}) => {
  const isLight = theme === 'light';

  const [existingSheet, setExistingSheet] = useState<GoogleSheetInfo | null>(null);
  const [isSearchingSheet, setIsSearchingSheet] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('');
  const [lastSyncResult, setLastSyncResult] = useState<GoogleSheetsSyncResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Cargar estado de la hoja de cálculo en Drive
  const checkSheetStatus = async () => {
    if (!accessToken) return;
    setIsSearchingSheet(true);
    setErrorMsg(null);
    try {
      const found = await findExistingDatabaseSpreadsheet(accessToken);
      setExistingSheet(found);
    } catch (err: any) {
      console.warn('Error buscando hoja de cálculo:', err);
    } finally {
      setIsSearchingSheet(false);
    }
  };

  useEffect(() => {
    if (accessToken) {
      checkSheetStatus();
    }
  }, [accessToken]);

  // Ejecutar migración completa hacia Google Sheets
  const handleExportToGoogleSheets = async () => {
    if (!accessToken) {
      if (onSignIn) onSignIn();
      return;
    }

    setIsSyncing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setSyncStatusMsg('Descargando datos consolidados del sistema...');

    try {
      // 1. Obtener los 177 expendios, historial y pagos de los endpoints
      const [resExp, resHist, resPagos] = await Promise.all([
        fetch(`/api/expendios?_t=${Date.now()}`),
        fetch(`/api/admin/historial?_t=${Date.now()}`).catch(() => null),
        fetch(`/api/admin/relacion-pagos?_t=${Date.now()}`).catch(() => null),
      ]);

      let expendios: ExpendioData[] = [];
      let historial: HistorialItem[] = [];
      let pagos: PagoRelacionItem[] = [];

      if (resExp.ok) {
        const d = await resExp.json();
        if (d.success && Array.isArray(d.data)) expendios = d.data;
      }

      if (resHist && resHist.ok) {
        const d = await resHist.json();
        if (d.success && Array.isArray(d.data)) historial = d.data;
      }

      if (resPagos && resPagos.ok) {
        const d = await resPagos.json();
        if (d.success && Array.isArray(d.data)) pagos = d.data;
      }

      setSyncStatusMsg(`Sincronizando ${expendios.length} expendios con Google Sheets...`);

      const result = await syncDatabaseToGoogleSheets(
        accessToken,
        expendios,
        historial,
        pagos,
        (progressMsg) => setSyncStatusMsg(progressMsg)
      );

      setLastSyncResult(result);
      setExistingSheet({
        id: result.spreadsheetId,
        name: SPREADSHEET_TITLE,
        url: result.spreadsheetUrl,
      });

      setSuccessMsg(
        `✓ Migración exitosa: ${result.totalExpendiosExported} expendios, ${result.totalHistorialExported} cuentas y ${result.totalPagosExported} pagos exportados a Google Sheets en tiempo real.`
      );
    } catch (err: any) {
      console.error('Error sincronizando con Google Sheets:', err);
      setErrorMsg(err.message || 'Error durante la migración a Google Sheets.');
    } finally {
      setIsSyncing(false);
      setSyncStatusMsg('');
    }
  };

  // Importar cambios desde Google Sheets si se editaron celdas en línea
  const handleImportFromGoogleSheets = async () => {
    if (!accessToken) {
      if (onSignIn) onSignIn();
      return;
    }

    setIsImporting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await importExpendiosFromGoogleSheets(accessToken);
      if (res.success && res.data.length > 0) {
        // Enviar al servidor para actualizar la base de datos
        const saveRes = await fetch('/api/admin/expendios/batch-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expendios: res.data }),
        });

        if (saveRes.ok) {
          const saveData = await saveRes.json();
          setSuccessMsg(
            `✓ Se importaron y actualizaron ${saveData.updatedCount || res.data.length} expendios desde Google Sheets hacia el sistema local.`
          );
          if (onDataImported) onDataImported(res.data);
        } else {
          setSuccessMsg(`✓ Se leyeron ${res.data.length} expendios desde Google Sheets.`);
          if (onDataImported) onDataImported(res.data);
        }
      } else {
        setErrorMsg(res.error || 'No se encontraron filas con cédula válida en la hoja.');
      }
    } catch (err: any) {
      console.error('Error importando de Google Sheets:', err);
      setErrorMsg(err.message || 'Error importando datos desde Google Sheets.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      className={`rounded-2xl border p-5 sm:p-7 transition-all ${
        isLight
          ? 'bg-white border-emerald-200 shadow-sm'
          : 'bg-slate-900 border-emerald-900/60 shadow-md'
      }`}
    >
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-start space-x-3.5">
          <div className="p-3 bg-emerald-600 text-white rounded-xl shadow-md shrink-0">
            <FileSpreadsheet className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                Base de Datos Ilimitada en Google Drive
              </span>
              <span className="inline-flex items-center space-x-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Cero Cuotas / Cero Límites</span>
              </span>
            </div>
            <h3 className="text-xl font-black text-black dark:text-white mt-1">
              Google Sheets Database Sync
            </h3>
            <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-0.5 font-medium">
              Gestión centralizada de los 177 expendios, pagos e historial directamente en una hoja de cálculo en vivo.
            </p>
          </div>
        </div>

        {/* Botón de Acceso / Estado Google */}
        <div className="flex items-center space-x-2 self-start sm:self-center">
          {!isAuthenticated ? (
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition-colors cursor-pointer"
            >
              <Cloud className="w-4 h-4" />
              <span>Conectar Google Drive</span>
            </button>
          ) : (
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-black bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Google Drive Conectado</span>
              </span>
              <button
                type="button"
                onClick={checkSheetStatus}
                disabled={isSearchingSheet}
                className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Actualizar estado de la hoja"
              >
                <RefreshCw className={`w-4 h-4 ${isSearchingSheet ? 'animate-spin text-emerald-600' : ''}`} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Info / Ventajas */}
      <div className="my-5 p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs sm:text-sm text-slate-800 dark:text-slate-200">
        <div className="flex items-start space-x-2.5">
          <Info className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-black dark:text-white">
              ¿Por qué migrar a Google Sheets?
            </p>
            <p>
              1. <strong>Capacidad de 10 millones de celdas</strong>: Olvídate de los límites de 200 lecturas/escrituras diarias de Firebase.
            </p>
            <p>
              2. <strong>Edición colaborativa en Excel / Navegador</strong>: Cualquier administrador de CAMARCA SAS puede abrir la hoja, ordenar por municipio, editar números o teléfonos y ver los cambios reflejados.
            </p>
            <p>
              3. <strong>Pestañas automáticas</strong>: Organizado en <code>{SHEET_NAME_EXPENDIOS}</code>, <code>{SHEET_NAME_HISTORIAL}</code> y <code>{SHEET_NAME_PAGOS}</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Enlace directo a la hoja si ya existe */}
      {existingSheet && (
        <div className="mb-5 p-4 rounded-xl bg-white dark:bg-slate-800 border-2 border-emerald-400 dark:border-emerald-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg text-emerald-700 dark:text-emerald-300">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-black uppercase text-emerald-800 dark:text-emerald-400">
                Hoja de Cálculo Activa en Google Drive
              </div>
              <div className="text-sm font-black text-black dark:text-white">
                {existingSheet.name}
              </div>
            </div>
          </div>

          <a
            href={existingSheet.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow transition-colors"
          >
            <span>Abrir en Google Sheets</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      )}

      {/* Mensajes de Estado */}
      {syncStatusMsg && (
        <div className="mb-4 p-3.5 rounded-xl bg-sky-50 dark:bg-sky-950/50 border border-sky-300 dark:border-sky-800 text-xs font-bold text-sky-900 dark:text-sky-200 flex items-center space-x-2.5">
          <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
          <span>{syncStatusMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="mb-4 p-3.5 rounded-xl bg-emerald-100 dark:bg-emerald-950 border border-emerald-400 dark:border-emerald-800 text-xs font-black text-emerald-900 dark:text-emerald-200 flex items-center space-x-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mb-4 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-xs font-bold text-rose-900 dark:text-rose-200 flex items-center space-x-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Botones Principales de Acción */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
        <button
          type="button"
          onClick={handleExportToGoogleSheets}
          disabled={isSyncing || isImporting}
          className="flex items-center justify-center space-x-2.5 px-5 py-3.5 rounded-xl font-black text-xs uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white shadow-md disabled:opacity-50 transition-all cursor-pointer"
        >
          {isSyncing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Sincronizando Base de Datos...</span>
            </>
          ) : (
            <>
              <UploadCloud className="w-4 h-4" />
              <span>Exportar / Sincronizar Todo a Google Sheets</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleImportFromGoogleSheets}
          disabled={isSyncing || isImporting || !existingSheet}
          className="flex items-center justify-center space-x-2.5 px-5 py-3.5 rounded-xl font-black text-xs uppercase tracking-wider bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-[0.99] text-black dark:text-white border-2 border-emerald-500 shadow-sm disabled:opacity-40 transition-all cursor-pointer"
        >
          {isImporting ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
              <span>Importando desde Sheets...</span>
            </>
          ) : (
            <>
              <DownloadCloud className="w-4 h-4 text-emerald-600" />
              <span>Importar Cambios desde Google Sheets</span>
            </>
          )}
        </button>
      </div>

      {/* Resumen de la última sincronización */}
      {lastSyncResult && (
        <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="text-[10px] font-black uppercase text-slate-500">Expendios</div>
            <div className="text-lg font-black text-black dark:text-white">
              {lastSyncResult.totalExpendiosExported}
            </div>
          </div>
          <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="text-[10px] font-black uppercase text-slate-500">Historial Cuentas</div>
            <div className="text-lg font-black text-black dark:text-white">
              {lastSyncResult.totalHistorialExported}
            </div>
          </div>
          <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="text-[10px] font-black uppercase text-slate-500">Relación Pagos</div>
            <div className="text-lg font-black text-black dark:text-white">
              {lastSyncResult.totalPagosExported}
            </div>
          </div>
          <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="text-[10px] font-black uppercase text-slate-500">Hora de Sincronización</div>
            <div className="text-xs font-black text-emerald-600 dark:text-emerald-400 mt-1">
              {new Date(lastSyncResult.timestamp).toLocaleTimeString('es-CO')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
