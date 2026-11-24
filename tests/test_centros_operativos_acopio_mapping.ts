import {
  normalizeCentroOperativo,
  normalizeCentroAcopio,
  CANONICAL_CENTROS_OPERATIVOS,
  CANONICAL_CENTROS_ACOPIO,
} from '../src/utils/centroOperativoAcopioHelper.ts';

function runTests() {
  console.log('--- TEST CENTROS OPERATIVOS Y CENTROS DE ACOPIO ---');

  // 1. Centros Operativos Canónicos (5)
  console.log('Centros Operativos Canónicos:', CANONICAL_CENTROS_OPERATIVOS);
  const expectedCO = ['PO.ARAUCA', 'PO.BUCARAMANGA', 'PO.CUCUTA', 'PO.SAN GIL', 'PO.VALLEDUPAR'];
  if (CANONICAL_CENTROS_OPERATIVOS.length !== 5) {
    throw new Error(`Se esperaban 5 centros operativos, hay ${CANONICAL_CENTROS_OPERATIVOS.length}`);
  }
  for (const co of expectedCO) {
    if (!CANONICAL_CENTROS_OPERATIVOS.includes(co as any)) {
      throw new Error(`Falta el centro operativo: ${co}`);
    }
  }

  // 2. Centros de Acopio Canónicos (9)
  console.log('Centros de Acopio Canónicos:', CANONICAL_CENTROS_ACOPIO);
  const expectedCA = [
    'Arauca',
    'Aguachica',
    'Barrancabermeja',
    'Bucaramanga',
    'Málaga',
    'Ocaña',
    'Cúcuta',
    'San Gil',
    'Valledupar',
  ];
  if (CANONICAL_CENTROS_ACOPIO.length !== 9) {
    throw new Error(`Se esperaban 9 centros de acopio, hay ${CANONICAL_CENTROS_ACOPIO.length}`);
  }
  for (const ca of expectedCA) {
    if (!CANONICAL_CENTROS_ACOPIO.includes(ca as any)) {
      throw new Error(`Falta el centro de acopio: ${ca}`);
    }
  }

  // 3. Normalizaciones de Centro Operativo
  console.log('Probando normalizaciones de Centro Operativo...');
  if (normalizeCentroOperativo('ARAUCA') !== 'PO.ARAUCA') throw new Error('ARAUCA falló');
  if (normalizeCentroOperativo('PO.ARAUCA') !== 'PO.ARAUCA') throw new Error('PO.ARAUCA falló');
  if (normalizeCentroOperativo('PO. BUCARAMANGA') !== 'PO.BUCARAMANGA') throw new Error('PO. BUCARAMANGA falló');
  if (normalizeCentroOperativo('CUCUTA') !== 'PO.CUCUTA') throw new Error('CUCUTA falló');
  if (normalizeCentroOperativo('PO.CÚCUTA') !== 'PO.CUCUTA') throw new Error('PO.CÚCUTA falló');
  if (normalizeCentroOperativo('SAN GIL') !== 'PO.SAN GIL') throw new Error('SAN GIL falló');
  if (normalizeCentroOperativo('PO.SAN GIL') !== 'PO.SAN GIL') throw new Error('PO.SAN GIL falló');
  if (normalizeCentroOperativo('VALLEDUPAR') !== 'PO.VALLEDUPAR') throw new Error('VALLEDUPAR falló');
  if (normalizeCentroOperativo('PO.VALLEDUPAR') !== 'PO.VALLEDUPAR') throw new Error('PO.VALLEDUPAR falló');

  // Fallbacks por acopio o municipio
  if (normalizeCentroOperativo('', 'Aguachica') !== 'PO.VALLEDUPAR') throw new Error('Fallback Aguachica falló');
  if (normalizeCentroOperativo('', 'Ocaña') !== 'PO.CUCUTA') throw new Error('Fallback Ocaña falló');
  if (normalizeCentroOperativo('', 'Málaga') !== 'PO.BUCARAMANGA') throw new Error('Fallback Málaga falló');
  if (normalizeCentroOperativo('', 'Charalá') !== 'PO.SAN GIL') throw new Error('Fallback Charalá falló');
  if (normalizeCentroOperativo('', 'Tame') !== 'PO.ARAUCA') throw new Error('Fallback Tame falló');

  // 4. Normalizaciones de Centro de Acopio
  console.log('Probando normalizaciones de Centro de Acopio...');
  if (normalizeCentroAcopio('ARAUCA') !== 'Arauca') throw new Error('Acopio Arauca falló');
  if (normalizeCentroAcopio('aguachica') !== 'Aguachica') throw new Error('Acopio Aguachica falló');
  if (normalizeCentroAcopio('BARRANCABERMEJA') !== 'Barrancabermeja') throw new Error('Acopio Barrancabermeja falló');
  if (normalizeCentroAcopio('Bucaramanga') !== 'Bucaramanga') throw new Error('Acopio Bucaramanga falló');
  if (normalizeCentroAcopio('MALAGA') !== 'Málaga') throw new Error('Acopio Málaga falló');
  if (normalizeCentroAcopio('OCANA') !== 'Ocaña') throw new Error('Acopio Ocaña falló');
  if (normalizeCentroAcopio('CUCUTA') !== 'Cúcuta') throw new Error('Acopio Cúcuta falló');
  if (normalizeCentroAcopio('SAN GIL') !== 'San Gil') throw new Error('Acopio San Gil falló');
  if (normalizeCentroAcopio('VALLEDUPAR') !== 'Valledupar') throw new Error('Acopio Valledupar falló');

  console.log('✓ Todos los tests de Centros Operativos y Centros de Acopio pasaron exitosamente!');
}

runTests();
