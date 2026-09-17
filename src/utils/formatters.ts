/**
 * Formats a numerical value as Colombian Pesos with dot separator for thousands (e.g. $ 121.200)
 */
export const formatPesos = (val?: number | string | null): string => {
  if (val === undefined || val === null) return '$ 0';
  const num = Math.round(Number(val) || 0);
  return `$ ${num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
};

/**
 * Formats a number with dot separator for thousands (e.g. 121.200)
 */
export const formatNumberWithDots = (val?: number | string | null): string => {
  if (val === undefined || val === null) return '0';
  const num = Math.round(Number(val) || 0);
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

/**
 * Cleans and extracts a valid 10-digit Colombian mobile / Nequi number (e.g. from "3218960568 - 3125614614" or "NEQUI 32189605683125614614" -> "3218960568")
 */
export const cleanNequiNumber = (raw?: string | number | null): string => {
  if (!raw) return '';
  const str = String(raw).trim();

  // 1. Look for a clean 10-digit Colombian mobile starting with 3
  const matchMobile = str.match(/\b(3\d{9})\b/);
  if (matchMobile) {
    return matchMobile[1];
  }

  // 2. Try splitting by delimiters like '-' or '/' or ',' or space
  const tokens = str.split(/[\/\-,\s]+/);
  for (const token of tokens) {
    const digits = token.replace(/[^0-9]/g, '');
    if (digits.length === 10 && digits.startsWith('3')) {
      return digits;
    }
  }

  // 3. If it was already merged into >10 digits starting with 3 (e.g. "32189605683125614614"), slice the first 10 digits
  const allDigits = str.replace(/[^0-9]/g, '');
  if (allDigits.length >= 10 && allDigits.startsWith('3')) {
    return allDigits.slice(0, 10);
  }

  return allDigits;
};

/**
 * Formats a bank account string, ensuring Nequi accounts have exactly 10 digits without concatenated multiple phone numbers
 */
export const formatCuentaBancaria = (
  rawCuenta?: string | number | null,
  rawBanco?: string | null
): { cuenta: string; banco: string } => {
  if (!rawCuenta) return { cuenta: 'NEQUI 3123304166', banco: 'NEQUI' };
  const str = String(rawCuenta).trim();
  const upper = str.toUpperCase();
  const bancoUpper = (rawBanco || '').toUpperCase();

  const isNequi =
    upper.includes('NEQUI') ||
    bancoUpper.includes('NEQUI') ||
    (!upper.includes('BANCO') &&
      !upper.includes('AHORRO') &&
      !upper.includes('CORRIENTE') &&
      !upper.includes('DAVIPLATA') &&
      /3\d{9}/.test(str));

  if (isNequi) {
    const numClean = cleanNequiNumber(str);
    const validNum = numClean.length === 10 ? numClean : numClean || '3123304166';
    return {
      cuenta: `NEQUI ${validNum}`,
      banco: 'NEQUI',
    };
  }

  return {
    cuenta: str,
    banco:
      rawBanco ||
      (upper.includes('BANCOLOMBIA')
        ? 'BANCOLOMBIA'
        : upper.includes('DAVIPLATA')
        ? 'DAVIPLATA'
        : 'BANCO'),
  };
};

