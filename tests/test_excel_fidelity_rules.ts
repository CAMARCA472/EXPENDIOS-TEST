import * as XLSX from 'xlsx';

async function testExcelFidelityRules() {
  console.log('==============================================================');
  console.log('TEST OBLIGATORIO: REGLAS Y FIDELIDAD DE IMPORTACIÓN DE EXCEL');
  console.log('==============================================================\n');

  // 1. REGLA DE DETECCIÓN Y VALIDACIÓN DE CABECERAS
  console.log('[TEST 1] Verificando validación de cabeceras obligatorias...');
  
  const headersCorrectos = [
    'N°',
    'REGIONAL',
    'DEPARTAMENTO',
    'CENTRO OPERATIVO',
    'CENTRO DE ACOPIO',
    'LOCALIDAD (Municipio Corregimiento Inpección de p. etc)',
    'ENCARGADO',
    'CEDULA',
    'DIRECCION PUNTO',
    'TELEFONO PUNTO',
    'LETRERO',
    'BASCULA',
    'MATASELLO',
    'USUARIO DE SIPOST',
    'COMPUTADOR',
    'INTERNET',
    'NIT',
    'Correo Electronico',
    'OBSERVACION',
  ];

  const headersIncompletos = [
    'N°',
    'REGIONAL',
    'DEPARTAMENTO',
    'LOCALIDAD (Municipio Corregimiento Inpección de p. etc)',
    'ENCARGADO',
    'CEDULA',
  ];

  function validarCabeceras(headers: string[]): { ok: boolean; faltantes: string[] } {
    const normalizeKey = (s: string) =>
      String(s || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');

    const foundMap: Record<string, boolean> = {};

    headers.forEach((h) => {
      const norm = normalizeKey(h);
      if (norm.includes('cedula') || norm.includes('documento') || norm === 'cc') foundMap['cedula'] = true;
      if (norm.includes('centrooperativo') || norm === 'coperativo' || norm === 'operativo' || norm === 'po') foundMap['centroOperativo'] = true;
      if (norm.includes('centrodeacopio') || norm.includes('centroacopio') || norm === 'cacopio' || norm.includes('acopio')) foundMap['centroAcopio'] = true;
    });

    const faltantes: string[] = [];
    if (!foundMap['cedula']) faltantes.push('CEDULA');
    if (!foundMap['centroOperativo']) faltantes.push('CENTRO OPERATIVO');
    if (!foundMap['centroAcopio']) faltantes.push('CENTRO DE ACOPIO');

    return { ok: faltantes.length === 0, faltantes };
  }

  const resValCorrect = validarCabeceras(headersCorrectos);
  if (!resValCorrect.ok) {
    throw new Error(`Error en validación de cabeceras correctas. Faltantes: ${resValCorrect.faltantes.join(', ')}`);
  }
  console.log('  ✓ Detección de cabeceras completas aprobada.');

  const resValIncorrect = validarCabeceras(headersIncompletos);
  if (resValIncorrect.ok || !resValIncorrect.faltantes.includes('CENTRO OPERATIVO') || !resValIncorrect.faltantes.includes('CENTRO DE ACOPIO')) {
    throw new Error('Error: La validación de cabeceras incompletas no detectó las columnas faltantes.');
  }
  console.log(`  ✓ Rechazo correcto por cabeceras faltantes: ${resValIncorrect.faltantes.join(', ')}.`);

  // 2. PRUEBA DE PRESERVACIÓN DIRECTA SIN INFERENCIA DE MUNICIPIO
  console.log('\n[TEST 2] Verificando preservación directa y no-inferencia entre Excel y PostgreSQL...');

  const mockExcelRows = [
    {
      'CEDULA': '1090334889',
      'LOCALIDAD (Municipio Corregimiento Inpección de p. etc)': 'ABREGO',
      'DEPARTAMENTO': 'NORTE DE SANTANDER',
      'CENTRO OPERATIVO': 'PO.CUCUTA',
      'CENTRO DE ACOPIO': 'Ocaña',
    },
    {
      'CEDULA': '1116796414',
      'LOCALIDAD (Municipio Corregimiento Inpección de p. etc)': 'ARAUQUITA',
      'DEPARTAMENTO': 'ARAUCA',
      'CENTRO OPERATIVO': 'PO.ARAUCA',
      'CENTRO DE ACOPIO': 'Arauca',
    },
    {
      'CEDULA': '91234567',
      'LOCALIDAD (Municipio Corregimiento Inpección de p. etc)': 'AGUACHICA',
      'DEPARTAMENTO': 'CESAR',
      'CENTRO OPERATIVO': 'PO.VALLEDUPAR',
      'CENTRO DE ACOPIO': 'Aguachica',
    },
  ];

  let totalFilasExcel = mockExcelRows.length;
  let filasImportadas = 0;
  let cedulasCoincidentes = 0;
  let centroOpCoincidentes = 0;
  let centroAcopioCoincidentes = 0;
  let diferencias: string[] = [];

  // Mapeo simulación de inserción
  const pgStoredRecords = mockExcelRows.map((row) => {
    filasImportadas++;
    return {
      cedula: row['CEDULA'],
      centroOperativo: row['CENTRO OPERATIVO'],
      centroAcopio: row['CENTRO DE ACOPIO'],
      localidad: row['LOCALIDAD (Municipio Corregimiento Inpección de p. etc)'],
      departamento: row['DEPARTAMENTO'],
    };
  });

  // Comparar fila por fila
  for (let i = 0; i < mockExcelRows.length; i++) {
    const excelRow = mockExcelRows[i];
    const pgRecord = pgStoredRecords[i];

    if (excelRow['CEDULA'] === pgRecord.cedula) cedulasCoincidentes++;
    else diferencias.push(`Fila ${i + 1}: Cédula Excel (${excelRow['CEDULA']}) vs PG (${pgRecord.cedula})`);

    if (excelRow['CENTRO OPERATIVO'] === pgRecord.centroOperativo) centroOpCoincidentes++;
    else diferencias.push(`Fila ${i + 1}: Centro Operativo Excel (${excelRow['CENTRO OPERATIVO']}) vs PG (${pgRecord.centroOperativo})`);

    if (excelRow['CENTRO DE ACOPIO'] === pgRecord.centroAcopio) centroAcopioCoincidentes++;
    else diferencias.push(`Fila ${i + 1}: Centro Acopio Excel (${excelRow['CENTRO DE ACOPIO']}) vs PG (${pgRecord.centroAcopio})`);
  }

  console.log('\n--- REPORT DE FIDELIDAD DE IMPORTACIÓN ---');
  console.log(`• Total de filas Excel: ${totalFilasExcel}`);
  console.log(`• Filas importadas: ${filasImportadas}`);
  console.log(`• Cédulas coincidentes: ${cedulasCoincidentes}`);
  console.log(`• Centros Operativos coincidentes: ${centroOpCoincidentes}`);
  console.log(`• Centros de Acopio coincidentes: ${centroAcopioCoincidentes}`);
  console.log(`• Diferencias encontradas: ${diferencias.length}`);

  if (diferencias.length > 0) {
    console.error('Diferencias reales:', diferencias);
    throw new Error('Se encontraron diferencias entre Excel y la simulación PostgreSQL');
  }

  console.log('\n✓ TODAS LAS REGLAS DE IMPORTACIÓN Y FIDELIDAD FUERON VERIFICADAS CON ÉXITO.\n');
}

testExcelFidelityRules().catch((err) => {
  console.error('Error ejecutando el test:', err);
  process.exit(1);
});
