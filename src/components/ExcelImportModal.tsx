import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { ExpendioData } from '../types';
import { FileSpreadsheet, Upload, Download, CheckCircle2, AlertCircle, X, Database, RefreshCw } from 'lucide-react';

interface ExcelImportModalProps {
  onClose: () => void;
  onImportSuccess: (message: string) => void;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  onClose,
  onImportSuccess,
}) => {
  const [parsedRows, setParsedRows] = useState<Partial<ExpendioData>[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [detectedSheets, setDetectedSheets] = useState<string[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          setErrorMsg('El archivo Excel no contiene hojas de cálculo.');
          setParsedRows([]);
          setDetectedSheets([]);
          return;
        }

        setDetectedSheets(workbook.SheetNames);
        const allMappedData: Partial<ExpendioData>[] = [];

        // Iterate through all sheets in the workbook
        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          if (!worksheet) return;

          // Convert sheet to JSON array of objects
          const rawData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });
          if (!rawData || rawData.length === 0) return;

          const sUpper = sheetName.toUpperCase();
          let sheetDefaultCO = 'PO.BUCARAMANGA';
          if (sUpper.includes('CUCUTA') || sUpper.includes('NORTE')) sheetDefaultCO = 'PO. CUCUTA';
          else if (sUpper.includes('ARAUCA')) sheetDefaultCO = 'PO. ARAUCA';
          else if (sUpper.includes('VALLEDUPAR') || sUpper.includes('CESAR')) sheetDefaultCO = 'PO. VALLEDUPAR';
          else if (sUpper.includes('BUCARAMANGA') || sUpper.includes('SANTANDER') || sUpper.includes('SAN GIL')) sheetDefaultCO = 'PO. BUCARAMANGA';

          // Map flexible headers to standard ExpendioData properties
          rawData.forEach((row, idx) => {
            const normalize = (s: string) =>
              s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

            // Helper to find key ignoring case, accents, and supporting substring matches
            const getValue = (...keys: string[]) => {
              for (const key of keys) {
                const targetKey = normalize(key);
                // First try exact normalized equality
                let matchedKey = Object.keys(row).find((k) => normalize(k) === targetKey);
                // If not found, try substring match
                if (!matchedKey) {
                  matchedKey = Object.keys(row).find((k) => normalize(k).includes(targetKey));
                }
                if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && String(row[matchedKey]).trim() !== '') {
                  return String(row[matchedKey]).trim();
                }
              }
              return '';
            };

            const localidad =
              getValue(
                'localidad (municipio corregimiento inpección de p. etc)',
                'localidad (municipio corregimiento inspección de p. etc)',
                'localidad',
                'nombre del expendio',
                'nombre de expendio',
                'nombre expendio',
                'expendio',
                'municipio',
                'punto',
                'ciudad'
              );

            // Skip total / empty lines
            if (!localidad || localidad.toUpperCase().includes('TOTAL') || localidad.toUpperCase().includes('CONSOLIDADO')) {
              return;
            }

            const centroAcopio =
              getValue(
                'centro de acopio',
                'centro acopio',
                'centro_acopio',
                'centroacopio',
                'acopio'
              ) || localidad;

            const centroOperativo =
              getValue(
                'centro operativo',
                'centro_operativo',
                'centrooperativo',
                'punto operativo',
                'c.operativo',
                'c operativo'
              ) || (getValue('regional') ? `PO.${getValue('regional').replace(/^PO\.?/i, '').trim()}` : sheetDefaultCO);

            const encargado =
              getValue('encargado', 'nombre', 'titular', 'responsable', 'representante') || `ENCARGADO ${localidad.toUpperCase()}`;

            const cedula = getValue('cedula', 'cédula', 'cc', 'documento', 'nit') || `${1000000000 + allMappedData.length + 1}`;

            const direccionPunto =
              getValue('direccion punto', 'dirección punto', 'direccion', 'dirección', 'ubicacion') || `CALLE PRINCIPAL ${localidad.toUpperCase()}`;

            const telefonoPunto =
              getValue('telefono punto', 'teléfono punto', 'telefono', 'teléfono', 'celular', 'movil', 'móvil') || '3123304166';

            const usuarioSipost =
              getValue('usuario de sipost', 'usuario sipost', 'usuario_sipost', 'sipost') || `SIP_${localidad.toUpperCase().slice(0, 8)}_${allMappedData.length + 1}`;

            const internet = getValue('internet') || 'SI';
            const nit = getValue('nit') || '900062917';
            const correoElectronico = getValue('correo electronico', 'correo electrónico', 'correo', 'email') || '';
            const observacion = getValue('observacion', 'observaciones', 'notas') || `Cargado desde Excel (${sheetName})`;

            const letreroVal = getValue('letrero');
            const basculaVal = getValue('bascula', 'báscula');
            const mataselloVal = getValue('matasello');
            const computadorVal = getValue('computador');

            const valorRaw = getValue('cargo basico', 'cargo básico', 'cargobasico', 'cargo_basico', 'valor mensual', 'valor_mensual', 'valor', 'canon', 'arriendo', 'monto');
            const valorMensual = valorRaw ? Number(valorRaw.replace(/[^0-9]/g, '')) || 0 : 0;

            allMappedData.push({
              id: `exp-excel-${Date.now()}-${allMappedData.length + 1}`,
              localidad: localidad.toUpperCase(),
              encargado: encargado.toUpperCase(),
              cedula: cedula,
              direccionPunto: direccionPunto.toUpperCase(),
              telefonoPunto: telefonoPunto,
              usuarioSipost: usuarioSipost,
              internet: internet.toUpperCase(),
              nit: nit,
              correoElectronico: correoElectronico,
              centroOperativo: centroOperativo.toUpperCase(),
              centroAcopio: centroAcopio.toUpperCase(),
              valorMensual: valorMensual,
              municipio: localidad.toUpperCase(),
              observacion: observacion,
              letreroUrl: undefined,
              basculaUrl: undefined,
              mataselloUrl: undefined,
              computadorUrl: undefined,
            });
          });
        });

        if (allMappedData.length === 0) {
          setErrorMsg('No se pudieron extraer filas de datos válidas del archivo Excel.');
          setParsedRows([]);
          return;
        }

        setParsedRows(allMappedData);
      } catch (err) {
        console.error('Error leyendo Excel:', err);
        setErrorMsg('Error al procesar el archivo Excel. Asegúrate de que sea un archivo válido .xlsx o .xls.');
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        LOCALIDAD: 'AGUACHICA',
        ENCARGADO: 'LINA ARRIETA',
        CEDULA: '1063563019',
        DIRECCION: 'CALLE 5A NO 11 18 LOCAL 2',
        CELULAR: '3176474603',
        SIPOST: 'SIP_AGUACHICA_01',
        'CARGO BASICO': 0,
        'CENTRO OPERATIVO': 'PO.BUCARAMANGA',
        'CENTRO ACOPIO': 'ACOPIO AGUACHICA',
        INTERNET: 'SI',
      },
      {
        LOCALIDAD: 'SIMITI',
        ENCARGADO: 'MARIO DE JESUS TORRES MEJIA',
        CEDULA: '3983162',
        DIRECCION: 'CALLE PRINCIPAL SIMITI',
        CELULAR: '3101234567',
        SIPOST: 'SIP_SIMITI_01',
        'CARGO BASICO': 0,
        'CENTRO OPERATIVO': 'PO.BUCARAMANGA',
        'CENTRO ACOPIO': 'SIMITI',
        INTERNET: 'SI',
      },
      {
        LOCALIDAD: 'OCAÑA CENTRO',
        ENCARGADO: 'WILSON JOSE MARTINEZ',
        CEDULA: '1090334120',
        DIRECCION: 'CARRERA 11 NO 10 45',
        CELULAR: '3128899001',
        SIPOST: 'SIP_OCANA_01',
        'CARGO BASICO': 0,
        'CENTRO OPERATIVO': 'PO.BUCARAMANGA',
        'CENTRO ACOPIO': 'ACOPIO OCAÑA',
        INTERNET: 'SI',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Expendios_Plantilla');
    XLSX.writeFile(workbook, 'Plantilla_Censo_Expendios.xlsx');
  };

  const handleConfirmImport = async () => {
    if (parsedRows.length === 0) return;
    setIsUploading(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/admin/import-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expendios: parsedRows,
          mode: importMode,
        }),
      });

      const data = await res.json();
      if (data.success) {
        onImportSuccess(data.message || `✓ Censo de ${parsedRows.length} expendios cargado con éxito desde Excel.`);
        onClose();
      } else {
        setErrorMsg(data.message || 'Error guardando datos en la base.');
      }
    } catch (err) {
      console.error('Error importando Excel:', err);
      setErrorMsg('Error de conexión con el servidor al guardar el archivo Excel.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3 text-emerald-400">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">Cargar Base de Datos desde Excel</h3>
              <p className="text-xs text-slate-400">Importa tus expendios oficiales desde archivos .xlsx / .xls</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action / File Selector Box */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div>
              <span className="text-xs font-bold text-slate-200 block">Plantilla de Ejemplo</span>
              <span className="text-[11px] text-slate-400">Descarga el formato de columnas recomendado para tu Excel</span>
            </div>
            <button
              onClick={handleDownloadTemplate}
              className="bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-xs py-2 px-3 rounded-lg flex items-center space-x-1.5 transition-colors whitespace-nowrap border border-amber-500/30 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar Plantilla Excel (.xlsx)</span>
            </button>
          </div>

          {/* File Upload Zone */}
          <div className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-6 text-center bg-slate-950/50 transition-colors relative cursor-pointer group">
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="flex flex-col items-center justify-center space-y-2">
              <Upload className="w-8 h-8 text-emerald-400 group-hover:scale-110 transition-transform" />
              <div className="text-xs font-semibold text-slate-200">
                {fileName ? (
                  <span className="text-emerald-400 font-bold">{fileName}</span>
                ) : (
                  <span>Haz clic o arrastra aquí tu archivo Excel (.xlsx, .xls)</span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Soporta encabezados como LOCALIDAD, ENCARGADO, CEDULA, DIRECCION, CELULAR, VALOR MENSUAL
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Preview Section if rows parsed */}
        {parsedRows.length > 0 && (
          <div className="space-y-4 pt-2 border-t border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-emerald-400 flex items-center space-x-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Vista Previa: {parsedRows.length} expendios detectados</span>
                </span>
                {detectedSheets.length > 1 && (
                  <span className="bg-sky-500/20 text-sky-300 text-[10px] font-semibold px-2 py-0.5 rounded-md border border-sky-500/30">
                    {detectedSheets.length} hojas: {detectedSheets.join(', ')}
                  </span>
                )}
              </div>

              {/* Import Mode Selector */}
              <div className="flex items-center space-x-2 text-xs">
                <span className="text-slate-400">Modo:</span>
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                    importMode === 'replace'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                  title="Reemplaza todos los datos actuales con las filas del Excel"
                >
                  Reemplazar Base
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('merge')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                    importMode === 'merge'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                  title="Actualiza existentes y agrega nuevos sin borrar los que ya están"
                >
                  Actualizar / Fusionar
                </button>
              </div>
            </div>

            {/* Table Preview */}
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left text-xs text-slate-300 border-collapse">
                <thead className="sticky top-0 bg-slate-900 text-slate-400 font-bold text-[11px] uppercase border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Localidad</th>
                    <th className="py-2 px-3">Encargado</th>
                    <th className="py-2 px-3">Cédula</th>
                    <th className="py-2 px-3">Celular</th>
                    <th className="py-2 px-3">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {parsedRows.slice(0, 15).map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/50">
                      <td className="py-2 px-3 text-slate-500 font-mono text-[10px]">{idx + 1}</td>
                      <td className="py-2 px-3 font-bold text-amber-300">{row.localidad}</td>
                      <td className="py-2 px-3 text-slate-200">{row.encargado}</td>
                      <td className="py-2 px-3 text-slate-400 font-mono">{row.cedula}</td>
                      <td className="py-2 px-3 text-slate-400 font-mono">{row.telefonoPunto}</td>
                      <td className="py-2 px-3 text-emerald-400 font-bold">
                        ${row.valorMensual?.toLocaleString('es-CO')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {parsedRows.length > 15 && (
              <p className="text-[11px] text-slate-400 text-center italic">
                Mostrando los primeros 15 de {parsedRows.length} registros...
              </p>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2 px-4 rounded-xl text-xs transition-colors cursor-pointer"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={parsedRows.length === 0 || isUploading}
            onClick={handleConfirmImport}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-5 rounded-xl text-xs flex items-center space-x-2 shadow-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Database className="w-4 h-4" />
            <span>
              {isUploading ? 'Guardando en Base...' : `Cargar ${parsedRows.length} Expendios a la Base`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
