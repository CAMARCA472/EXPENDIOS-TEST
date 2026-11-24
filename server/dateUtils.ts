/**
 * Utilidades canónicas de formateo de fechas para CAMARCA (Lado Servidor).
 * Regla de negocio: Toda presentación visual al usuario debe ser estrictamente DD-MM-AAAA.
 */

export function formatDateCanonical(dateInput: string | number | Date | null | undefined, fallback = ''): string {
  if (!dateInput) return fallback;

  try {
    let d: Date;
    if (dateInput instanceof Date) {
      d = dateInput;
    } else if (typeof dateInput === 'number') {
      d = new Date(dateInput);
    } else {
      const str = String(dateInput).trim();
      if (!str) return fallback;

      const ddmmyyyyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
      if (ddmmyyyyMatch) {
        const day = ddmmyyyyMatch[1].padStart(2, '0');
        const month = ddmmyyyyMatch[2].padStart(2, '0');
        const year = ddmmyyyyMatch[3];
        return `${day}-${month}-${year}`;
      }

      const yyyymmddMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (yyyymmddMatch) {
        const year = yyyymmddMatch[1];
        const month = yyyymmddMatch[2].padStart(2, '0');
        const day = yyyymmddMatch[3].padStart(2, '0');
        return `${day}-${month}-${year}`;
      }

      d = new Date(str);
    }

    if (isNaN(d.getTime())) {
      return String(dateInput);
    }

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear());

    return `${day}-${month}-${year}`;
  } catch {
    return String(dateInput);
  }
}

export function formatDateTimeCanonical(dateInput: string | number | Date | null | undefined, fallback = ''): string {
  if (!dateInput) return fallback;
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);

    const dateStr = formatDateCanonical(d);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    return `${dateStr} ${hours}:${minutes}:${seconds}`;
  } catch {
    return String(dateInput);
  }
}
