/**
 * Utilitario de Geolocalización y Estampado de Marca de Agua Oficial
 * para Fotografías de Expendios - CAMARCA SAS
 */

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp?: number;
}

export interface WatermarkOptions {
  expendioNombre: string;
  municipio?: string;
  encargado: string;
  cedula: string;
  tituloSlot?: string;
  coords?: GeoCoordinates | null;
  timestamp?: Date;
  marcaAguaPrincipal?: string; // Default 'EXPENDIO CAMARCA SAS'
}

/**
 * Obtiene la posición GPS actual del dispositivo solicitando los permisos del navegador.
 */
export async function getCurrentGpsLocation(timeoutMs = 12000): Promise<GeoCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('La geolocalización no es soportada por este navegador o dispositivo.'));
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
      },
      (error) => {
        let errorMsg = 'No se pudo obtener la ubicación GPS.';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMsg = 'Permiso de ubicación denegado por el usuario o navegador.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMsg = 'La señal de GPS o ubicación no está disponible en este momento.';
            break;
          case error.TIMEOUT:
            errorMsg = 'Tiempo de espera agotado al consultar la ubicación GPS.';
            break;
        }
        reject(new Error(errorMsg));
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      }
    );
  });
}

/**
 * Carga un origen de imagen (File, Blob, DataUrl, ImageElement) en un elemento HTMLImageElement
 */
function loadImageSource(source: string | File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error('Error al cargar la imagen para estampado.'));

    if (typeof source === 'string') {
      img.src = source;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          img.src = e.target.result as string;
        } else {
          reject(new Error('Error leyendo archivo de imagen.'));
        }
      };
      reader.onerror = () => reject(new Error('Error de lectura de archivo.'));
      reader.readAsDataURL(source);
    }
  });
}

/**
 * Estampa sobre la foto la marca de agua 'EXPENDIO CAMARCA SAS',
 * el nombre del expendio, encargado, fecha/hora y coordenadas GPS.
 */
export async function stampPhotoWithWatermarkAndGps(
  source: string | File | Blob,
  options: WatermarkOptions
): Promise<{ dataUrl: string; blob: Blob; file: File }> {
  const img = await loadImageSource(source);

  // Dimensiones óptimas
  let targetWidth = img.naturalWidth || img.width || 1280;
  let targetHeight = img.naturalHeight || img.height || 960;

  // Limitar ancho máximo a 1920px para asegurar alta resolución sin colapsar memoria móvil
  const MAX_DIM = 1920;
  if (targetWidth > MAX_DIM || targetHeight > MAX_DIM) {
    if (targetWidth > targetHeight) {
      targetHeight = Math.round((targetHeight * MAX_DIM) / targetWidth);
      targetWidth = MAX_DIM;
    } else {
      targetWidth = Math.round((targetWidth * MAX_DIM) / targetHeight);
      targetHeight = MAX_DIM;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el lienzo Canvas de 2D.');
  }

  // 1. Dibujar imagen base
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // 2. Calcular altura proporcional del pie de foto estampado
  // Proporción basada en el ancho del lienzo
  const scale = Math.max(0.6, targetWidth / 1200);
  const footerHeight = Math.round(140 * scale);
  const footerY = targetHeight - footerHeight;

  // Fondo oscuro semi-transparente de alto contraste para máxima legibilidad
  ctx.save();
  ctx.fillStyle = 'rgba(8, 14, 28, 0.90)';
  ctx.fillRect(0, footerY, targetWidth, footerHeight);

  // Línea dorada superior decorativa
  ctx.fillStyle = '#F59E0B';
  ctx.fillRect(0, footerY, targetWidth, Math.max(3, Math.round(4 * scale)));

  // Borde interior sutil
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(4, footerY + 4, targetWidth - 8, footerHeight - 8);

  const padX = Math.round(24 * scale);
  let currentY = footerY + Math.round(30 * scale);

  // FILA 1: Marca de Agua Principal 'EXPENDIO CAMARCA SAS' y Título Slot
  const marcaAgua = (options.marcaAguaPrincipal || 'EXPENDIO CAMARCA SAS').toUpperCase();
  ctx.font = `900 ${Math.round(20 * scale)}px sans-serif`;
  ctx.fillStyle = '#FBBF24'; // Dorado brillante
  ctx.textBaseline = 'middle';
  ctx.fillText(`★ ${marcaAgua}`, padX, currentY);

  // Si hay título de foto (ej: 1. FOTO AVISO EXTERIOR)
  if (options.tituloSlot) {
    const slotText = options.tituloSlot.toUpperCase();
    ctx.font = `bold ${Math.round(13 * scale)}px sans-serif`;
    const slotMetrics = ctx.measureText(slotText);
    const badgeW = slotMetrics.width + Math.round(20 * scale);
    const badgeH = Math.round(22 * scale);
    const badgeX = targetWidth - padX - badgeW;

    ctx.fillStyle = 'rgba(16, 185, 129, 0.25)'; // Fondo esmeralda
    ctx.fillRect(badgeX, currentY - badgeH / 2, badgeW, badgeH);
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(badgeX, currentY - badgeH / 2, badgeW, badgeH);

    ctx.fillStyle = '#34D399';
    ctx.fillText(slotText, badgeX + Math.round(10 * scale), currentY);
  }

  // FILA 2: Nombre de Expendio y Encargado
  currentY += Math.round(28 * scale);
  ctx.font = `bold ${Math.round(15 * scale)}px sans-serif`;
  ctx.fillStyle = '#FFFFFF';
  const expStr = (options.expendioNombre || options.municipio || 'EXPENDIO').toUpperCase();
  const munStr = options.municipio ? ` (${options.municipio.toUpperCase()})` : '';
  const encStr = options.encargado ? ` • ENCARGADO: ${options.encargado.toUpperCase()}` : '';
  const cedStr = options.cedula ? ` (C.C. ${options.cedula})` : '';
  ctx.fillText(`EXPENDIO: ${expStr}${munStr}${encStr}${cedStr}`, padX, currentY);

  // FILA 3: Coordenadas GPS (en blanco si no se dio permiso) y Fecha/Hora de toma o carga
  currentY += Math.round(26 * scale);
  ctx.font = `bold ${Math.round(13 * scale)}px sans-serif`;

  const dateObj = options.timestamp || new Date();
  const formattedDate = dateObj.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  let gpsText = '';
  if (options.coords && typeof options.coords.latitude === 'number' && typeof options.coords.longitude === 'number') {
    const lat = options.coords.latitude.toFixed(6);
    const lng = options.coords.longitude.toFixed(6);
    const acc = options.coords.accuracy ? ` (±${Math.round(options.coords.accuracy)}m)` : '';
    gpsText = `📍 COORDENADAS GPS: Lat ${lat}°, Lng ${lng}°${acc}`;
  } else {
    // Si no se da permiso de GPS, las coordenadas quedan en blanco
    gpsText = '';
  }

  if (gpsText) {
    ctx.fillStyle = '#38BDF8'; // Azul cian para GPS
    ctx.fillText(`${gpsText}   •   📅 FECHA Y HORA: ${formattedDate}`, padX, currentY);
  } else {
    // Solo fecha y hora con coordenadas en blanco
    ctx.fillStyle = '#FCD34D'; // Ámbar dorado para fecha
    ctx.fillText(`📅 FECHA Y HORA DE REGISTRO: ${formattedDate}`, padX, currentY);
  }

  // FILA 4: Subtítulo Legal / Operador
  currentY += Math.round(24 * scale);
  ctx.font = `normal ${Math.round(11 * scale)}px sans-serif`;
  ctx.fillStyle = '#94A3B8'; // Gris claro
  ctx.fillText('CAMARCA SAS • NIT 900.504.241-7 • OPERADOR SPU 4-72 • REGISTRO FOTOGRÁFICO OFICIAL', padX, currentY);

  ctx.restore();

  // 3. Exportar como DataURL, Blob y File
  const dataUrl = canvas.toDataURL('image/jpeg', 0.90);

  const blob: Blob = await new Promise((res, rej) => {
    canvas.toBlob(
      (b) => {
        if (b) res(b);
        else rej(new Error('Error generando Blob de imagen estampada.'));
      },
      'image/jpeg',
      0.90
    );
  });

  const fileName = `foto-expendio-${Date.now()}.jpg`;
  const file = new File([blob], fileName, { type: 'image/jpeg' });

  return { dataUrl, blob, file };
}
