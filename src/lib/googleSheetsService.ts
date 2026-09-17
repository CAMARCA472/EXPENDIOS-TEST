import { ExpendioData, HistorialItem, PagoRelacionItem } from '../types';

export const SHEET_NAME_EXPENDIOS = 'EXPENDIOS_MASTER';
export const SHEET_NAME_HISTORIAL = 'HISTORIAL_CUENTAS';
export const SHEET_NAME_PAGOS = 'RELACION_PAGOS';
export const SPREADSHEET_TITLE = 'Base de Datos Oficial Expendios 4-72 - CAMARCA SAS';

export interface GoogleSheetsSyncResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  totalExpendiosExported: number;
  totalHistorialExported: number;
  totalPagosExported: number;
  timestamp: string;
}

export interface GoogleSheetInfo {
  id: string;
  name: string;
  url: string;
}

// Columnas estructuradas para la hoja de cálculo de Expendios
export const EXPENDIOS_COLUMNS = [
  'ID',
  'MUNICIPIO',
  'LOCALIDAD',
  'ENCARGADO',
  'CEDULA',
  'DIRECCION PUNTO',
  'TELEFONO / CELULAR',
  'CORREO ELECTRONICO',
  'CENTRO OPERATIVO',
  'CENTRO ACOPIO',
  'BANCO',
  'TIPO CUENTA',
  'NUMERO CUENTA BANCARIA',
  'VALOR MENSUAL FIJO',
  'VALOR VARIABLE',
  'ADMISION SIPOST',
  'USUARIO SIPOST',
  'TIENE INTERNET',
  'NIT',
  'ESTADO',
  'FECHA ULTIMA ACTUALIZACION',
  'TIENE AVISO',
  'TIENE BASCULA',
  'TIENE MATASELLO',
  'MOTIVO FALTA AVISO',
  'MOTIVO FALTA BASCULA',
  'MOTIVO FALTA MATASELLO',
  'FOTO 1 AVISO URL',
  'FOTO 2 PANORAMICA URL',
  'FOTO 3 MATASELLO URL',
  'FOTO 4 BASCULA URL',
  'FOTO 5 CONTRATISTA URL',
  'FOTO 6 HORARIO URL',
  'FOTO 7 TARIFAS URL',
  'OBSERVACIONES GENERALES',
];

/**
 * Busca si ya existe la hoja de cálculo oficial en Google Drive
 */
export async function findExistingDatabaseSpreadsheet(accessToken: string): Promise<GoogleSheetInfo | null> {
  const query = `name='${SPREADSHEET_TITLE}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink)&spaces=drive`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Error consultando Google Drive (HTTP ${res.status})`);
  }

  const data = await res.json();
  if (data.files && data.files.length > 0) {
    return {
      id: data.files[0].id,
      name: data.files[0].name,
      url: data.files[0].webViewLink || `https://docs.google.com/spreadsheets/d/${data.files[0].id}/edit`,
    };
  }
  return null;
}

/**
 * Crea la hoja de cálculo en Google Sheets con las 3 pestañas principales formateadas
 */
export async function createDatabaseSpreadsheet(accessToken: string): Promise<GoogleSheetInfo> {
  const createUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
  const body = {
    properties: {
      title: SPREADSHEET_TITLE,
      locale: 'es_CO',
      timeZone: 'America/Bogota',
    },
    sheets: [
      {
        properties: {
          sheetId: 0,
          title: SHEET_NAME_EXPENDIOS,
          gridProperties: {
            frozenRowCount: 1,
            rowCount: 300,
            columnCount: EXPENDIOS_COLUMNS.length + 2,
          },
        },
      },
      {
        properties: {
          sheetId: 1,
          title: SHEET_NAME_HISTORIAL,
          gridProperties: {
            frozenRowCount: 1,
            rowCount: 500,
            columnCount: 15,
          },
        },
      },
      {
        properties: {
          sheetId: 2,
          title: SHEET_NAME_PAGOS,
          gridProperties: {
            frozenRowCount: 1,
            rowCount: 500,
            columnCount: 15,
          },
        },
      },
    ],
  };

  const res = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Error creando Google Sheet (HTTP ${res.status})`);
  }

  const data = await res.json();
  return {
    id: data.spreadsheetId,
    name: data.properties?.title || SPREADSHEET_TITLE,
    url: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
  };
}

/**
 * Convierte un objeto ExpendioData en una fila de Google Sheets
 */
function expendioToRow(exp: ExpendioData): (string | number)[] {
  return [
    exp.id || '',
    exp.municipio || '',
    exp.localidad || '',
    exp.encargado || '',
    exp.cedula || '',
    exp.direccionPunto || '',
    exp.telefonoPunto || '',
    exp.correoElectronico || '',
    exp.centroOperativo || 'PO.BUCARAMANGA',
    exp.centroAcopio || 'PO.BUCARAMANGA',
    exp.banco || '',
    exp.tipoCuenta || '',
    exp.cuentaBancaria || '',
    exp.valorMensual || 0,
    exp.valorVariable || 0,
    exp.admisionSipost || 0,
    exp.usuarioSipost || '',
    exp.internet || 'NO',
    exp.nit || '',
    exp.estado || 'Activo',
    exp.fechaUltimaActualizacion || '',
    exp.tieneAviso || '',
    exp.tieneBascula || '',
    exp.tieneMatasello || '',
    exp.motivoFaltaAviso || '',
    exp.motivoFaltaBascula || '',
    exp.motivoFaltaMatasello || '',
    exp.fotoAvisoUrl || '',
    exp.fotoPanoramicaUrl || '',
    exp.fotoMataselloUrl || '',
    exp.fotoBasculaUrl || '',
    exp.fotoContratistaUrl || '',
    exp.fotoHorarioUrl || '',
    exp.fotoTarifasUrl || '',
    exp.observacion || '',
  ];
}

/**
 * Sincroniza la base de datos completa de expendios a Google Sheets
 */
export async function syncDatabaseToGoogleSheets(
  accessToken: string,
  expendios: ExpendioData[],
  historial: HistorialItem[] = [],
  relacionPagos: PagoRelacionItem[] = [],
  onProgress?: (msg: string) => void
): Promise<GoogleSheetsSyncResult> {
  onProgress?.('Localizando hoja de cálculo en Google Drive...');
  
  let sheet = await findExistingDatabaseSpreadsheet(accessToken);
  if (!sheet) {
    onProgress?.('Creando nueva hoja "Base de Datos Oficial Expendios 4-72"...');
    sheet = await createDatabaseSpreadsheet(accessToken);
  }

  const spreadsheetId = sheet.id;

  // 1. Preparar datos de EXPENDIOS_MASTER
  onProgress?.(`Preparando ${expendios.length} expendios para Google Sheets...`);
  const expendiosRows: (string | number)[][] = [
    EXPENDIOS_COLUMNS,
    ...expendios.map(expendioToRow),
  ];

  // 2. Preparar datos de HISTORIAL_CUENTAS
  const historialRows: (string | number)[][] = [
    [
      'ID',
      'CEDULA',
      'NOMBRE',
      'EXPENDIO / MUNICIPIO',
      'PERIODO',
      'VALOR TOTAL',
      'FECHA GENERACION',
      'ESTADO',
      'DETALLES',
    ],
    ...historial.map((h) => [
      h.id || '',
      h.cedula || '',
      h.encargado || '',
      h.expendio || '',
      h.periodo || '',
      h.monto || h.cuentaData?.valorNeto || 0,
      h.fecha || '',
      h.estado || 'Generada',
      h.detalles || '',
    ]),
  ];

  // 3. Preparar datos de RELACION_PAGOS
  const pagosRows: (string | number)[][] = [
    [
      'ID',
      'CONSECUTIVO',
      'MUNICIPIO',
      'CONCEPTO',
      'CEDULA',
      'NOMBRE ENCARGADO',
      'BANCO',
      'CUENTA',
      'VALOR CANCELAR',
      'PERIODO (MES / AÑO)',
      'ESTADO',
    ],
    ...relacionPagos.map((p) => [
      p.id || '',
      p.consecutivo || 0,
      p.municipio || '',
      p.concepto || '',
      p.cedula || '',
      p.nombreEncargado || '',
      p.banco || '',
      p.cuenta || '',
      p.valorCancelar || 0,
      `${p.mes || ''} ${p.anio || ''}`.trim(),
      p.estado || 'Pendiente',
    ]),
  ];

  // 4. BatchUpdate values to Google Sheets
  onProgress?.('Escribiendo registros en Google Sheets...');
  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;

  const payload = {
    valueInputOption: 'USER_ENTERED',
    data: [
      {
        range: `${SHEET_NAME_EXPENDIOS}!A1`,
        values: expendiosRows,
      },
      {
        range: `${SHEET_NAME_HISTORIAL}!A1`,
        values: historialRows,
      },
      {
        range: `${SHEET_NAME_PAGOS}!A1`,
        values: pagosRows,
      },
    ],
  };

  const writeRes = await fetch(batchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!writeRes.ok) {
    const err = await writeRes.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Error actualizando celdas en Sheets (HTTP ${writeRes.status})`);
  }

  // 5. Formatear encabezados de la hoja con color azul corporativo 4-72
  try {
    const formatUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    await fetch(formatUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.05, green: 0.25, blue: 0.55 },
                  textFormat: {
                    foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                    bold: true,
                    fontSize: 10,
                  },
                  horizontalAlignment: 'CENTER',
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
          },
        ],
      }),
    });
  } catch {}

  return {
    spreadsheetId,
    spreadsheetUrl: sheet.url,
    totalExpendiosExported: expendios.length,
    totalHistorialExported: historial.length,
    totalPagosExported: relacionPagos.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Actualiza o inserta un único expendio directamente en la hoja de Google Sheets
 * Permite que cada vez que un expendio actualice datos o cargue fotos, se actualice en Sheets al instante.
 */
export async function updateSingleExpendioInGoogleSheets(
  accessToken: string,
  expendio: ExpendioData
): Promise<{ success: boolean; spreadsheetUrl?: string }> {
  try {
    const sheet = await findExistingDatabaseSpreadsheet(accessToken);
    if (!sheet) {
      return { success: false };
    }

    // 1. Obtener la columna de cédulas para encontrar el número de fila
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheet.id}/values/${SHEET_NAME_EXPENDIOS}!E:E`;
    const readRes = await fetch(readUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!readRes.ok) return { success: false };
    const readData = await readRes.json();
    const rows = readData.values || [];

    const targetCedula = String(expendio.cedula || '').trim();
    let rowIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i] && String(rows[i][0] || '').trim() === targetCedula) {
        rowIndex = i + 1; // 1-indexed for Sheets
        break;
      }
    }

    const rowValues = [expendioToRow(expendio)];

    if (rowIndex > 0) {
      // Actualizar fila existente
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheet.id}/values/${SHEET_NAME_EXPENDIOS}!A${rowIndex}?valueInputOption=USER_ENTERED`;
      await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: rowValues }),
      });
    } else {
      // Agregar nueva fila al final
      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheet.id}/values/${SHEET_NAME_EXPENDIOS}!A1:append?valueInputOption=USER_ENTERED`;
      await fetch(appendUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: rowValues }),
      });
    }

    return { success: true, spreadsheetUrl: sheet.url };
  } catch (err) {
    console.warn('[Google Sheets Sync] Error actualizando expendio individual:', err);
    return { success: false };
  }
}

/**
 * Importa los expendios desde Google Sheets hacia la aplicación si se desea cargar desde la nube
 */
export async function importExpendiosFromGoogleSheets(
  accessToken: string
): Promise<{ success: boolean; data: Partial<ExpendioData>[]; error?: string }> {
  try {
    const sheet = await findExistingDatabaseSpreadsheet(accessToken);
    if (!sheet) {
      return { success: false, data: [], error: 'No se encontró la hoja de cálculo en Google Drive' };
    }

    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheet.id}/values/${SHEET_NAME_EXPENDIOS}!A2:AI500`;
    const res = await fetch(readUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, data: [], error: err?.error?.message || `HTTP ${res.status}` };
    }

    const result = await res.json();
    const rows = result.values || [];

    const expendios: Partial<ExpendioData>[] = rows.map((r: any[]) => ({
      id: r[0] || '',
      municipio: r[1] || '',
      localidad: r[2] || '',
      encargado: r[3] || '',
      cedula: r[4] || '',
      direccionPunto: r[5] || '',
      telefonoPunto: r[6] || '',
      correoElectronico: r[7] || '',
      centroOperativo: r[8] || 'PO.BUCARAMANGA',
      centroAcopio: r[9] || 'PO.BUCARAMANGA',
      banco: r[10] || '',
      tipoCuenta: r[11] || '',
      cuentaBancaria: r[12] || '',
      valorMensual: Number(r[13]) || 0,
      valorVariable: Number(r[14]) || 0,
      admisionSipost: Number(r[15]) || 0,
      usuarioSipost: r[16] || '',
      internet: r[17] || 'NO',
      nit: r[18] || '',
      estado: r[19] || 'Activo',
      fechaUltimaActualizacion: r[20] || '',
      tieneAviso: r[21] || '',
      tieneBascula: r[22] || '',
      tieneMatasello: r[23] || '',
      motivoFaltaAviso: r[24] || '',
      motivoFaltaBascula: r[25] || '',
      motivoFaltaMatasello: r[26] || '',
      fotoAvisoUrl: r[27] || '',
      fotoPanoramicaUrl: r[28] || '',
      fotoMataselloUrl: r[29] || '',
      fotoBasculaUrl: r[30] || '',
      fotoContratistaUrl: r[31] || '',
      fotoHorarioUrl: r[32] || '',
      fotoTarifasUrl: r[33] || '',
      observacion: r[34] || '',
    }));

    return { success: true, data: expendios.filter((e) => Boolean(e.cedula)) };
  } catch (err: any) {
    return { success: false, data: [], error: err.message };
  }
}
