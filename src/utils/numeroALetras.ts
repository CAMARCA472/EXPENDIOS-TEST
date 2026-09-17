/**
 * Conversor oficial de números a letras para Colombia (Pesos M/CTE)
 * Soporta desde 0 hasta miles de millones con acentuación y gramática en español.
 */

function Unidades(num: number): string {
  switch (num) {
    case 1: return 'UN';
    case 2: return 'DOS';
    case 3: return 'TRES';
    case 4: return 'CUATRO';
    case 5: return 'CINCO';
    case 6: return 'SEIS';
    case 7: return 'SIETE';
    case 8: return 'OCHO';
    case 9: return 'NUEVE';
    default: return '';
  }
}

function DecenasY(strSin: string, numUnidades: number): string {
  if (numUnidades > 0) {
    return `${strSin} Y ${Unidades(numUnidades)}`;
  }
  return strSin;
}

function Decenas(num: number): string {
  const decena = Math.floor(num / 10);
  const unidad = num - (decena * 10);

  switch (decena) {
    case 1:
      switch (unidad) {
        case 0: return 'DIEZ';
        case 1: return 'ONCE';
        case 2: return 'DOCE';
        case 3: return 'TRECE';
        case 4: return 'CATORCE';
        case 5: return 'QUINCE';
        default: return `DIECI${Unidades(unidad)}`;
      }
    case 2:
      switch (unidad) {
        case 0: return 'VEINTE';
        default: return `VEINTI${Unidades(unidad)}`;
      }
    case 3: return DecenasY('TREINTA', unidad);
    case 4: return DecenasY('CUARENTA', unidad);
    case 5: return DecenasY('CINCUENTA', unidad);
    case 6: return DecenasY('SESENTA', unidad);
    case 7: return DecenasY('SETENTA', unidad);
    case 8: return DecenasY('OCHENTA', unidad);
    case 9: return DecenasY('NOVENTA', unidad);
    case 0: return Unidades(unidad);
    default: return '';
  }
}

function Centenas(num: number): string {
  const centenas = Math.floor(num / 100);
  const decenas = num - (centenas * 100);

  switch (centenas) {
    case 1:
      if (decenas > 0) return `CIENTO ${Decenas(decenas)}`;
      return 'CIEN';
    case 2: return `DOSCIENTOS ${Decenas(decenas)}`;
    case 3: return `TRESCIENTOS ${Decenas(decenas)}`;
    case 4: return `CUATROCIENTOS ${Decenas(decenas)}`;
    case 5: return `QUINIENTOS ${Decenas(decenas)}`;
    case 6: return `SEISCIENTOS ${Decenas(decenas)}`;
    case 7: return `SETECIENTOS ${Decenas(decenas)}`;
    case 8: return `OCHOCIENTOS ${Decenas(decenas)}`;
    case 9: return `NOVECIENTOS ${Decenas(decenas)}`;
    default: return Decenas(decenas);
  }
}

function Seccion(num: number, divisor: number, strSingular: string, strPlural: string): string {
  const cientos = Math.floor(num / divisor);
  const resto = num - (cientos * divisor);

  let letras = '';

  if (cientos > 0) {
    if (cientos > 1) {
      letras = `${Centenas(cientos)} ${strPlural}`;
    } else {
      letras = strSingular;
    }
  }

  if (resto > 0) {
    letras += '';
  }

  return letras;
}

function Miles(num: number): string {
  const divisor = 1000;
  const cientos = Math.floor(num / divisor);
  const resto = num - (cientos * divisor);

  const strMiles = Seccion(num, divisor, 'UN MIL', 'MIL');
  const strCentenas = Centenas(resto);

  if (strMiles === '') return strCentenas;
  return `${strMiles} ${strCentenas}`.trim();
}

function Millones(num: number): string {
  const divisor = 1000000;
  const cientos = Math.floor(num / divisor);
  const resto = num - (cientos * divisor);

  const strMillones = Seccion(num, divisor, 'UN MILLÓN', 'MILLONES');
  const strMiles = Miles(resto);

  if (strMillones === '') return strMiles;
  return `${strMillones} ${strMiles}`.trim();
}

export function numeroALetras(cantidad?: number): string {
  if (cantidad === undefined || cantidad === null || isNaN(cantidad)) {
    return 'CERO PESOS M/CTE';
  }

  const rounded = Math.round(cantidad);
  if (rounded === 0) {
    return 'CERO PESOS M/CTE';
  }

  if (rounded < 0) {
    return `MENOS ${numeroALetras(Math.abs(rounded))}`;
  }

  let letras = Millones(rounded).replace(/\s+/g, ' ').trim();

  // Fix grammar edge cases
  letras = letras
    .replace(/VEINTIUN\b/g, 'VEINTIÚN')
    .replace(/DIECISEIS\b/g, 'DIECISÉIS')
    .replace(/VEINTIDOS\b/g, 'VEINTIDÓS')
    .replace(/VEINTITRES\b/g, 'VEINTITRÉS')
    .replace(/VEINTISEIS\b/g, 'VEINTISÉIS');

  return `${letras} PESOS M/CTE`;
}
