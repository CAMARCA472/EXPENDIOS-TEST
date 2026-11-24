import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { ExpendioData } from '../types';
import {
  normalizeCentroOperativo,
  normalizeCentroAcopio,
  CANONICAL_CENTROS_OPERATIVOS,
  CANONICAL_CENTROS_ACOPIO,
} from '../utils/centroOperativoAcopioHelper';
import {
  FileSpreadsheet,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
  Database,
  Layers,
  FileCheck,
  CheckSquare,
  Square,
  Info,
} from 'lucide-react';

interface ExcelImportModalProps {
  onClose: () => void;
  onImportSuccess: (message: string) => void;
}

interface ImportSummaryReport {
  archivo: string;
  hojasSeleccionadas: string[];
  totalProcesados: number;
  insertados: number;
  actualizados: number;
  rechazados: number;
  errores: string[];
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  onClose,
  onImportSuccess,
}) => {
  const [workbookInstance, setWorkbookInstance] = useState<XLSX.WorkBook | null>(null);
  const [detectedSheets, setDetectedSheets] = useState<string[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Partial<ExpendioData>[]>([]);
  const [detectedErrors, setDetectedErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [summaryReport, setSummaryReport] = useState<ImportSummaryReport | null>(null);

  // Parsear hojas seleccionadas cuando cambia la selección o el workbook
  useEffect(() => {
    if (!workbookInstance) {
      setParsedRows([]);
      setDetectedErrors([]);
      return;
    }

    if (selectedSheets.length === 0) {
      setParsedRows([]);
      setDetectedErrors([]);
      return;
    }

    const allMappedData: Partial<ExpendioData>[] = [];
    const errorsList: string[] = [];

    const normalizeKey = (s: string) =>
      String(s || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');

    // Procesar EXCLUSIVAMENTE las hojas seleccionadas
    selectedSheets.forEach((sheetName) => {
      const worksheet = workbookInstance.Sheets[sheetName];
      if (!worksheet) {
        errorsList.push(`La hoja "${sheetName}" no pudo ser leída.`);
        return;
      }

      // 1. Obtener datos tanto como objetos con claves de encabezado como matriz 2D
      const rawObjRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });
      const grid: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      if ((!rawObjRows || rawObjRows.length === 0) && (!grid || grid.length === 0)) return;

      // Buscar la fila de encabezados en la matriz 2D
      let headerRowIndex = -1;
      let maxHeaderMatches = 0;
      let colMap: Record<string, number> = {};

      for (let r = 0; r < Math.min(15, grid.length); r++) {
        const row = grid[r] || [];
        let matches = 0;
        const tempMap: Record<string, number> = {};

        row.forEach((cell: any, cIdx: number) => {
          const norm = normalizeKey(cell);
          if (!norm) return;

          if (norm.includes('departamento') || norm === 'dpto' || norm === 'depto') {
            tempMap['departamento'] = cIdx;
            matches += 2;
          } else if (norm.includes('centrooperativo') || norm === 'coperativo' || norm === 'operativo' || norm === 'po') {
            tempMap['centroOperativo'] = cIdx;
            matches += 4;
          } else if (norm.includes('centrodeacopio') || norm.includes('centroacopio') || norm === 'cacopio' || norm.includes('acopio')) {
            tempMap['centroAcopio'] = cIdx;
            matches += 4;
          } else if (norm.includes('localidad') || norm.includes('municipio') || norm.includes('expendio') || norm === 'punto' || norm === 'ciudad') {
            tempMap['localidad'] = cIdx;
            matches += 3;
          } else if (norm.includes('encargado') || norm.includes('nombre') || norm.includes('titular') || norm.includes('responsable') || norm.includes('representante') || norm.includes('contratista')) {
            tempMap['encargado'] = cIdx;
            matches += 3;
          } else if (norm.includes('cedula') || norm.includes('documento') || norm === 'cc' || norm === 'identificacion') {
            tempMap['cedula'] = cIdx;
            matches += 3;
          } else if (norm.includes('direccion') || norm.includes('ubicacion')) {
            tempMap['direccionPunto'] = cIdx;
            matches += 2;
          } else if (norm.includes('telefono') || norm.includes('celular') || norm.includes('movil') || norm.includes('contacto')) {
            tempMap['telefonoPunto'] = cIdx;
            matches += 2;
          } else if (norm.includes('sipost') || norm.includes('usuariosistema')) {
            tempMap['usuarioSipost'] = cIdx;
            matches += 2;
          } else if (norm.includes('internet') || norm.includes('conectividad')) {
            tempMap['internet'] = cIdx;
            matches += 1;
          } else if (norm.includes('nit')) {
            tempMap['nit'] = cIdx;
            matches += 1;
          } else if (norm.includes('cuentabancaria') || norm.includes('cuenta') || norm.includes('banco')) {
            tempMap['cuentaBancaria'] = cIdx;
            matches += 1;
          } else if (norm.includes('correo') || norm.includes('email')) {
            tempMap['correoElectronico'] = cIdx;
            matches += 1;
          } else if (norm.includes('observacion') || norm.includes('observaciones') || norm.includes('nota')) {
            tempMap['observacion'] = cIdx;
            matches += 1;
          } else if (norm.includes('cargo') || norm.includes('basico') || norm.includes('valor') || norm.includes('canon') || norm.includes('monto') || norm.includes('arriendo')) {
            tempMap['valorMensual'] = cIdx;
            matches += 1;
          }
        });

        if (matches > maxHeaderMatches) {
          maxHeaderMatches = matches;
          headerRowIndex = r;
          colMap = tempMap;
        }
      }

      // Si no se detectaron encabezados por texto, asignar mapeo según presencia de columna DEPARTAMENTO
      if (maxHeaderMatches < 3) {
        headerRowIndex = 0;
        // Revisar si columna 0 es Departamento (ej: ARAUCA, CESAR, BOLIVAR, SANTANDER)
        const firstCell = String(grid[1]?.[0] || grid[0]?.[0] || '').toUpperCase();
        const hasDptoCol = ['ARAUCA', 'CESAR', 'BOLIVAR', 'SANTANDER', 'BOYACA', 'NORTE DE SANTANDER', 'CUNDINAMARCA'].some(d => firstCell.includes(d));

        if (hasDptoCol) {
          colMap = {
            departamento: 0,
            centroOperativo: 1,
            centroAcopio: 2,
            localidad: 3,
            encargado: 4,
            cedula: 5,
            direccionPunto: 6,
            telefonoPunto: 7,
            letrero: 8,
            bascula: 9,
            matasello: 10,
            usuarioSipost: 11,
            computador: 12,
            internet: 13,
            nit: 14,
            cuentaBancaria: 15,
            correoElectronico: 16,
            observacion: 17,
          };
        } else {
          colMap = {
            centroOperativo: 0,
            centroAcopio: 1,
            localidad: 2,
            encargado: 3,
            cedula: 4,
            direccionPunto: 5,
            telefonoPunto: 6,
            letrero: 7,
            bascula: 8,
            matasello: 9,
            usuarioSipost: 10,
            computador: 11,
            internet: 12,
            nit: 13,
            cuentaBancaria: 14,
            correoElectronico: 15,
            observacion: 16,
          };
        }
      }

      // VALIDACIÓN OBLIGATORIA DE CABECERAS
      const missingMandatory: string[] = [];
      if (colMap['cedula'] === undefined) missingMandatory.push('CEDULA');
      if (colMap['centroOperativo'] === undefined) missingMandatory.push('CENTRO OPERATIVO');
      if (colMap['centroAcopio'] === undefined) missingMandatory.push('CENTRO DE ACOPIO');

      if (missingMandatory.length > 0) {
        errorsList.push(`La hoja "${sheetName}" no contiene las cabeceras obligatorias requeridas: ${missingMandatory.join(', ')}. No se puede importar.`);
        return;
      }

      // Procesar filas de datos a partir de headerRowIndex + 1
      const startRow = Math.max(0, headerRowIndex + 1);
      for (let rIdx = startRow; rIdx < grid.length; rIdx++) {
        const row = grid[rIdx];
        if (!row || row.length === 0) continue;

        // Buscar también en objeto coincidente por índice si existe
        const objRow = rawObjRows[rIdx - startRow] || {};

        const getFlexValue = (key: string, ...objKeyPatterns: string[]): string => {
          // 1. Por índice de columna detectado
          const idx = colMap[key];
          if (idx !== undefined && row[idx] !== undefined && row[idx] !== null) {
            const val = String(row[idx]).trim();
            if (val !== '') return val;
          }

          // 2. Por claves del objeto JSON
          for (const pattern of objKeyPatterns) {
            const normPattern = normalizeKey(pattern);
            const matchedKey = Object.keys(objRow).find(k => normalizeKey(k).includes(normPattern));
            if (matchedKey && objRow[matchedKey] !== undefined && objRow[matchedKey] !== null) {
              const val = String(objRow[matchedKey]).trim();
              if (val !== '') return val;
            }
          }

          return '';
        };

        const localidadRaw = getFlexValue('localidad', 'localidad', 'municipio', 'nombre del expendio', 'expendio', 'ciudad');
        // Omitir líneas vacías, de totales o encabezados residuales
        if (
          !localidadRaw ||
          localidadRaw.toUpperCase().includes('TOTAL') ||
          localidadRaw.toUpperCase().includes('CONSOLIDADO') ||
          localidadRaw.toUpperCase() === 'LOCALIDAD' ||
          localidadRaw.toUpperCase() === 'MUNICIPIO'
        ) {
          continue;
        }

        // Detección de fórmulas con error en Excel
        const checkFormulaError = (val: string, colName: string): string => {
          if (
            val.includes('#VALUE!') ||
            val.includes('#VALOR!') ||
            val.includes('#REF!') ||
            val.includes('#N/A') ||
            val.includes('#NAME?')
          ) {
            errorsList.push(`Hoja "${sheetName}" Fila ${rIdx + 1} (${localidadRaw}): Error de fórmula Excel "${val}" en columna "${colName}".`);
          }
          return val;
        };

        const rawCO = checkFormulaError(getFlexValue('centroOperativo', 'centro operativo', 'c.operativo', 'operativo', 'po'), 'CENTRO OPERATIVO');
        const rawCA = checkFormulaError(getFlexValue('centroAcopio', 'centro de acopio', 'centro acopio', 'acopio'), 'CENTRO DE ACOPIO');
        const localidad = localidadRaw.toUpperCase();
        const departamento = getFlexValue('departamento', 'departamento', 'dpto', 'depto').toUpperCase();

        // REGLA FUNDAMENTAL: Preservación directa y exacta de la fila de Excel (sin inferencias ni sustitución por diccionarios)
        const centroOperativo = String(rawCO || '').trim();
        const centroAcopio = String(rawCA || '').trim();

        const encargadoRaw = getFlexValue('encargado', 'encargado', 'nombre', 'titular', 'responsable', 'representante', 'contratista');
        const cedulaRaw = getFlexValue('cedula', 'cedula', 'cédula', 'documento', 'cc', 'identificacion');

        // REGLA: Si la cédula o el encargado faltan, RECHAZAR y reportar, nunca inventar valores ficticios
        const cleanCedula = String(cedulaRaw || '').replace(/\D/g, '');
        if (!cleanCedula || cleanCedula === '0') {
          errorsList.push(`Hoja "${sheetName}" Fila ${rIdx + 1} (${localidadRaw}): Rechazada - No contiene número de cédula válido.`);
          continue;
        }

        if (!encargadoRaw || !encargadoRaw.trim()) {
          errorsList.push(`Hoja "${sheetName}" Fila ${rIdx + 1} (${localidadRaw}): Rechazada - Falta nombre del encargado.`);
          continue;
        }

        const direccionPunto = getFlexValue('direccionPunto', 'direccion punto', 'dirección', 'direccion', 'ubicacion');
        const telefonoPunto = getFlexValue('telefonoPunto', 'telefono punto', 'telefono', 'teléfono', 'celular', 'movil');
        const usuarioSipost = getFlexValue('usuarioSipost', 'usuario de sipost', 'usuario sipost', 'sipost');
        const internet = getFlexValue('internet', 'internet', 'conectividad') || 'SI';
        const nit = getFlexValue('nit', 'nit') || '';
        const cuentaBancaria = getFlexValue('cuentaBancaria', 'cuenta bancaria', 'cuenta', 'banco') || '';
        const correoElectronico = getFlexValue('correoElectronico', 'correo electronico', 'correo', 'email') || '';
        const observacion = getFlexValue('observacion', 'observacion', 'observaciones', 'notas') || `Cargado desde Excel (${sheetName})`;

        const valorRaw = getFlexValue('valorMensual', 'cargo basico', 'cargo básico', 'valor mensual', 'valor', 'canon');
        const valorMensual = valorRaw ? Number(String(valorRaw).replace(/[^0-9]/g, '')) || 0 : 0;

        allMappedData.push({
          id: `exp-excel-${Date.now()}-${allMappedData.length + 1}`,
          localidad: localidad,
          municipio: localidad,
          departamento: departamento,
          encargado: encargadoRaw.trim().toUpperCase(),
          cedula: cleanCedula,
          direccionPunto: (direccionPunto || '').trim().toUpperCase(),
          telefonoPunto: (telefonoPunto || '').trim(),
          usuarioSipost: (usuarioSipost || '').trim(),
          internet: internet.toUpperCase(),
          nit: (nit || '').trim(),
          cuentaBancaria: cuentaBancaria,
          correoElectronico: correoElectronico,
          centroOperativo: centroOperativo,
          centroAcopio: centroAcopio,
          valorMensual: valorMensual,
          observacion: observacion,
        });
      }
    });

    setParsedRows(allMappedData);
    setDetectedErrors(errorsList);
  }, [workbookInstance, selectedSheets]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    setSummaryReport(null);
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          setErrorMsg('El archivo Excel no contiene hojas de cálculo válidas.');
          setWorkbookInstance(null);
          setDetectedSheets([]);
          setSelectedSheets([]);
          return;
        }

        setWorkbookInstance(workbook);
        setDetectedSheets(workbook.SheetNames);

        // Regla: Para expendios se debe seleccionar EXCLUSIVAMENTE 'EXPENDIOS' por defecto
        const expendiosSheet = workbook.SheetNames.find(
          (s) => s.trim().toUpperCase() === 'EXPENDIOS'
        );

        if (expendiosSheet) {
          setSelectedSheets([expendiosSheet]);
        } else {
          // Si no existe exactamente 'EXPENDIOS', seleccionar la primera hoja disponible
          setSelectedSheets([workbook.SheetNames[0]]);
        }
      } catch (err) {
        console.error('Error leyendo Excel:', err);
        setErrorMsg('Error al procesar el archivo Excel. Asegúrate de que sea un archivo válido .xlsx o .xls.');
      }
    };

    reader.readAsBinaryString(file);
  };

  const toggleSheetSelection = (sheetName: string) => {
    setSelectedSheets((prev) => {
      if (prev.includes(sheetName)) {
        return prev.filter((s) => s !== sheetName);
      } else {
        return [...prev, sheetName];
      }
    });
  };

  const handleSelectAllSheets = () => {
    setSelectedSheets([...detectedSheets]);
  };

  const handleSelectOnlyExpendios = () => {
    const expSheet = detectedSheets.find((s) => s.trim().toUpperCase() === 'EXPENDIOS');
    if (expSheet) {
      setSelectedSheets([expSheet]);
    }
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
    XLSX.utils.book_append_sheet(workbook, worksheet, 'EXPENDIOS');
    XLSX.writeFile(workbook, 'ACTUALIZACION DE EXPENDIOS.xlsx');
  };

  const handleConfirmImport = async () => {
    if (selectedSheets.length === 0) {
      setErrorMsg('Debe seleccionar al menos una hoja para importar.');
      return;
    }

    if (parsedRows.length === 0) {
      setErrorMsg('No hay filas de expendios válidas en las hojas seleccionadas.');
      return;
    }

    setIsUploading(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/admin/import-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expendios: parsedRows,
          mode: importMode,
          selectedSheets,
          fileName,
          clientErrors: detectedErrors,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSummaryReport({
          archivo: data.archivo || fileName,
          hojasSeleccionadas: data.hojasSeleccionadas || selectedSheets,
          totalProcesados: data.totalProcesados ?? parsedRows.length,
          insertados: data.insertados ?? 0,
          actualizados: data.actualizados ?? 0,
          rechazados: data.rechazados ?? 0,
          errores: data.errores || detectedErrors,
        });
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
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-6 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3 text-emerald-400">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">Cargar Base de Datos desde Excel</h3>
              <p className="text-xs text-slate-400">
                Selección estricta de hojas y mapeo fiel de CENTRO OPERATIVO y CENTRO DE ACOPIO
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Report View when import succeeds */}
        {summaryReport ? (
          <div className="space-y-5">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 space-y-2">
              <div className="flex items-center space-x-2 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Importación a PostgreSQL Completada con Éxito</span>
              </div>
              <p className="text-xs text-slate-300">
                Los datos fueron validados y persistidos en PostgreSQL como única fuente de verdad.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
                <span className="text-[11px] text-slate-400 block font-semibold">Procesados</span>
                <strong className="text-lg font-mono text-slate-100">{summaryReport.totalProcesados}</strong>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-emerald-800/40 text-center">
                <span className="text-[11px] text-emerald-400 block font-semibold">Insertados</span>
                <strong className="text-lg font-mono text-emerald-300">{summaryReport.insertados}</strong>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-sky-800/40 text-center">
                <span className="text-[11px] text-sky-400 block font-semibold">Actualizados</span>
                <strong className="text-lg font-mono text-sky-300">{summaryReport.actualizados}</strong>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-amber-800/40 text-center">
                <span className="text-[11px] text-amber-400 block font-semibold">Rechazados</span>
                <strong className="text-lg font-mono text-amber-300">{summaryReport.rechazados}</strong>
              </div>
            </div>

            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Archivo:</span>
                <span className="font-semibold text-slate-200">{summaryReport.archivo}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Hojas procesadas:</span>
                <span className="font-semibold text-amber-300">{summaryReport.hojasSeleccionadas.join(', ')}</span>
              </div>
            </div>

            {summaryReport.errores.length > 0 && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs space-y-1.5 max-h-36 overflow-y-auto">
                <div className="flex items-center space-x-1.5 text-amber-400 font-bold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Alertas o Errores de Fórmula Detectados ({summaryReport.errores.length}):</span>
                </div>
                <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-0.5">
                  {summaryReport.errores.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-3">
              <button
                type="button"
                onClick={() => {
                  onImportSuccess(`✓ Importación completada: ${summaryReport.totalProcesados} expendios procesados.`);
                  onClose();
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-6 rounded-xl text-xs flex items-center space-x-2 cursor-pointer shadow-lg"
              >
                <FileCheck className="w-4 h-4" />
                <span>Aceptar y Actualizar Panel</span>
              </button>
            </div>
          </div>
        ) : (
          /* Normal Upload & Selection Form */
          <div className="space-y-4">
            {/* Template Box */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div>
                <span className="text-xs font-bold text-slate-200 block">Plantilla Oficial</span>
                <span className="text-[11px] text-slate-400">
                  Descarga el formato de columnas exacto (Hoja "EXPENDIOS")
                </span>
              </div>
              <button
                onClick={handleDownloadTemplate}
                className="bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-xs py-2 px-3 rounded-lg flex items-center space-x-1.5 transition-colors whitespace-nowrap border border-amber-500/30 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar Plantilla (.xlsx)</span>
              </button>
            </div>

            {/* File Upload Drop Area */}
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
                  Soporta ACTUALIZACION DE EXPENDIOS.xlsx con selección individual de hojas
                </p>
              </div>
            </div>

            {/* Sheet Selector with Checkboxes */}
            {detectedSheets.length > 0 && (
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Layers className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold text-slate-200 uppercase">
                      Hojas Detectadas en el Excel ({detectedSheets.length})
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-[11px]">
                    <button
                      type="button"
                      onClick={handleSelectOnlyExpendios}
                      className="text-emerald-400 hover:underline cursor-pointer font-semibold"
                    >
                      Solo EXPENDIOS
                    </button>
                    <span className="text-slate-600">|</span>
                    <button
                      type="button"
                      onClick={handleSelectAllSheets}
                      className="text-amber-400 hover:underline cursor-pointer font-semibold"
                    >
                      Seleccionar Todas
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pt-1">
                  {detectedSheets.map((sheet) => {
                    const isSelected = selectedSheets.includes(sheet);
                    const isExpendios = sheet.trim().toUpperCase() === 'EXPENDIOS';
                    const isExcludedByDefault = ['CENTROS DE ACOPIO', 'HOJA1', 'CIERRES', 'APERTURAS'].includes(
                      sheet.trim().toUpperCase()
                    );

                    return (
                      <button
                        type="button"
                        key={sheet}
                        onClick={() => toggleSheetSelection(sheet)}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-xs text-left cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-200'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate">
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500 shrink-0" />
                          )}
                          <span className="font-semibold truncate">{sheet}</span>
                        </div>
                        {isExpendios && (
                          <span className="bg-emerald-500/20 text-emerald-300 text-[10px] px-1.5 py-0.5 rounded font-bold border border-emerald-500/30 shrink-0 ml-1">
                            Principal
                          </span>
                        )}
                        {isExcludedByDefault && !isExpendios && (
                          <span className="text-[10px] text-slate-500 shrink-0 ml-1">Secundaria</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <p className="text-[11px] text-slate-400 flex items-start space-x-1.5 pt-1">
                  <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Para expendios oficiales se procesa <strong>únicamente la hoja "EXPENDIOS"</strong>. Los campos{' '}
                    <code>CENTRO OPERATIVO</code> y <code>CENTRO DE ACOPIO</code> quedarán en PostgreSQL exactamente
                    como están en la hoja.
                  </span>
                </p>
              </div>
            )}

            {/* Error Message */}
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Formula / Value Warnings */}
            {detectedErrors.length > 0 && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">
                    Se detectaron {detectedErrors.length} advertencias/errores de fórmula en el Excel:
                  </span>
                  <span className="text-[11px] text-slate-300">
                    Los valores con fórmulas como <code>#VALUE!</code> se reportarán sin alteraciones ni conversiones
                    arbitrarias.
                  </span>
                </div>
              </div>
            )}

            {/* Preview Section if rows parsed */}
            {parsedRows.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-emerald-400 flex items-center space-x-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Vista Previa: {parsedRows.length} expendios detectados</span>
                  </span>

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
                    >
                      Actualizar / Fusionar
                    </button>
                  </div>
                </div>

                {/* Table Preview */}
                <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950">
                  <table className="w-full text-left text-xs text-slate-300 border-collapse">
                    <thead className="sticky top-0 bg-slate-900 text-slate-400 font-bold text-[10px] uppercase border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Localidad</th>
                        <th className="py-2 px-3">Centro Operativo</th>
                        <th className="py-2 px-3">Centro Acopio</th>
                        <th className="py-2 px-3">Encargado</th>
                        <th className="py-2 px-3">Cédula</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {parsedRows.slice(0, 10).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/50">
                          <td className="py-2 px-3 text-slate-500 font-mono text-[10px]">{idx + 1}</td>
                          <td className="py-2 px-3 font-bold text-amber-300">{row.localidad}</td>
                          <td className="py-2 px-3 text-sky-300 font-mono text-[11px]">{row.centroOperativo}</td>
                          <td className="py-2 px-3 text-slate-300 font-mono text-[11px]">{row.centroAcopio}</td>
                          <td className="py-2 px-3 text-slate-200">{row.encargado}</td>
                          <td className="py-2 px-3 text-slate-400 font-mono">{row.cedula}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {parsedRows.length > 10 && (
                  <p className="text-[11px] text-slate-400 text-center italic">
                    Mostrando los primeros 10 de {parsedRows.length} registros...
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
                disabled={parsedRows.length === 0 || selectedSheets.length === 0 || isUploading}
                onClick={handleConfirmImport}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-5 rounded-xl text-xs flex items-center space-x-2 shadow-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Database className="w-4 h-4" />
                <span>
                  {isUploading
                    ? 'Guardando en PostgreSQL...'
                    : `Cargar ${parsedRows.length} Expendios (${selectedSheets.length} Hojas)`}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
