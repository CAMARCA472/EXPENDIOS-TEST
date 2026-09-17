/**
 * Utilidad centralizada para validar fotografías reales.
 * Descarta de manera estricta cualquier placeholder generado o URL ficticia (ej. placehold.co),
 * garantizando que el sistema únicamente procese, cuente y muestre imágenes fotográficas reales.
 */
export function isRealPhoto(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!u) return false;

  const lower = u.toLowerCase();
  if (
    lower.includes('placehold.co') ||
    lower.includes('placeholder') ||
    lower.includes('via.placeholder') ||
    lower.includes('dummyimage') ||
    lower.includes('text=') ||
    lower.startsWith('data:image/svg+xml')
  ) {
    return false;
  }

  // Aceptar fotos reales: data URLs, rutas del servidor /api/photos/ o URLs externas válidas
  return (
    u.startsWith('data:image/') ||
    u.startsWith('/api/photos/') ||
    u.startsWith('/api/expendio/photo/') ||
    u.startsWith('http://') ||
    u.startsWith('https://') ||
    u.startsWith('blob:')
  );
}
