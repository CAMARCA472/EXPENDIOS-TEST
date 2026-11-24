/**
 * Utilidad de descarga de archivos con autenticación Bearer y fallback por token de consulta.
 * Resuelve el fallo en navegadores donde los enlaces directos <a href="..."> o window.location.href
 * no envían encabezados de autorización y devuelven 401/403, provocando descargas corruptas como
 * ".customization" o "El archivo no se encontraba disponible en el sitio".
 */

export interface DownloadOptions {
  customToken?: string;
  onStart?: () => void;
  onSuccess?: (filename: string) => void;
  onError?: (err: Error) => void;
}

export async function downloadAuthenticatedFile(
  endpoint: string,
  defaultFilename: string,
  options?: DownloadOptions
): Promise<boolean> {
  try {
    options?.onStart?.();

    let token = options?.customToken;
    if (!token && typeof window !== 'undefined') {
      token = sessionStorage.getItem('camarca_token') || localStorage.getItem('camarca_token') || '';
      if (!token) {
        try {
          const raw = localStorage.getItem('camarca_session') || sessionStorage.getItem('camarca_session');
          if (raw) {
            const parsed = JSON.parse(raw);
            token = parsed?.token || '';
          }
        } catch {}
      }
    }

    let fetchUrl = endpoint;
    if (token && !fetchUrl.includes('token=')) {
      const separator = fetchUrl.includes('?') ? '&' : '?';
      fetchUrl = `${fetchUrl}${separator}token=${encodeURIComponent(token)}`;
    }

    const headers: Record<string, string> = {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-session-token'] = token;
      headers['x-auth-token'] = token;
    }

    const response = await fetch(fetchUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      let errorMessage = `Error al descargar archivo (HTTP ${response.status})`;
      try {
        const errorJson = await response.json();
        if (errorJson && errorJson.message) {
          errorMessage = errorJson.message;
        }
      } catch {
        // No es JSON
      }
      throw new Error(errorMessage);
    }

    // Extraer nombre del archivo desde Content-Disposition si viene en los encabezados
    let resolvedFilename = defaultFilename;
    const disposition = response.headers.get('content-disposition');
    if (disposition) {
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      if (utf8Match && utf8Match[1]) {
        resolvedFilename = decodeURIComponent(utf8Match[1].replace(/["']/g, ''));
      } else {
        const standardMatch = disposition.match(/filename="?([^";]+)"?/i);
        if (standardMatch && standardMatch[1]) {
          resolvedFilename = standardMatch[1].trim();
        }
      }
    }

    // Asegurar que termine con la extensión correspondiente si defaultFilename la tenía
    const defaultExt = defaultFilename.includes('.') ? defaultFilename.slice(defaultFilename.lastIndexOf('.')) : '';
    if (defaultExt && !resolvedFilename.toLowerCase().endsWith(defaultExt.toLowerCase())) {
      resolvedFilename += defaultExt;
    }

    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = resolvedFilename;
    link.setAttribute('download', resolvedFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      window.URL.revokeObjectURL(objectUrl);
    }, 15000);

    options?.onSuccess?.(resolvedFilename);
    return true;
  } catch (err: any) {
    console.error('[downloadAuthenticatedFile]:', err);
    options?.onError?.(err);
    return false;
  }
}
