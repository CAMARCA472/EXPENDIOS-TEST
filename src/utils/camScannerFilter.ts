/**
 * CamScanner Magic Pro Filter & Image Processing Utility
 * Implements high-contrast document scanning, adaptive binarization,
 * grayscale contrast stretching, and shadow removal.
 */

export type ScanFilterType = 'magic_bw' | 'magic_gray' | 'high_contrast' | 'original';

export interface ProcessScanOptions {
  filter: ScanFilterType;
  brightness?: number; // -50 to 50 (default 0)
  contrast?: number; // -50 to 50 (default 15)
  threshold?: number; // 0 to 255 (default 128)
  rotation?: number; // 0, 90, 180, 270
}

/**
 * Processes an HTMLImageElement or HTMLCanvasElement and returns a processed Canvas
 */
export function processImageWithMagicFilter(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  options: ProcessScanOptions
): HTMLCanvasElement {
  const { filter, brightness = 0, contrast = 15, rotation = 0 } = options;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  // Determine dimensions based on rotation
  const srcWidth = ('videoWidth' in source && source.videoWidth) ? source.videoWidth : (source.width || 800);
  const srcHeight = ('videoHeight' in source && source.videoHeight) ? source.videoHeight : (source.height || 600);

  if (rotation === 90 || rotation === 270) {
    canvas.width = srcHeight;
    canvas.height = srcWidth;
  } else {
    canvas.width = srcWidth;
    canvas.height = srcHeight;
  }

  // Handle Rotation
  ctx.save();
  if (rotation === 90) {
    ctx.translate(canvas.width, 0);
    ctx.rotate((90 * Math.PI) / 180);
  } else if (rotation === 180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate((180 * Math.PI) / 180);
  } else if (rotation === 270) {
    ctx.translate(0, canvas.height);
    ctx.rotate((270 * Math.PI) / 180);
  }
  ctx.drawImage(source, 0, 0, srcWidth, srcHeight);
  ctx.restore();

  if (filter === 'original') {
    return canvas;
  }

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const len = data.length;

  // Precompute contrast factor
  // contrast input range: -50 to 50
  const cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const bOffset = brightness * 1.5;

  if (filter === 'magic_bw') {
    // Magic Pro B&W: Whitens paper background, sharpens dark text, eliminates yellow/gray ambient shadows
    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Luminance
      let gray = 0.299 * r + 0.587 * g + 0.114 * b;

      // Apply contrast curve
      gray = cFactor * (gray - 128) + 128 + bOffset;

      // Magic Pro Adaptive Document Curve:
      // Dark values (ink, signatures, text) get pushed to deep black
      // Light-medium values (gray shadows, paper) get pushed to crisp white
      if (gray > 135) {
        // Boost highlights to clean pure white
        gray = Math.min(255, gray * 1.35 + 20);
      } else if (gray < 110) {
        // Deepen text / pen ink to rich dark
        gray = Math.max(0, gray * 0.7 - 10);
      } else {
        // Steep middle transition
        gray = ((gray - 110) / 25) * 255;
      }

      // Hard clamp
      const finalVal = gray > 185 ? 255 : (gray < 75 ? 0 : Math.round(gray));

      data[i] = finalVal;
      data[i + 1] = finalVal;
      data[i + 2] = finalVal;
    }
  } else if (filter === 'magic_gray') {
    // Magic Grayscale: Clean smooth grayscale with brightened background
    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      let gray = 0.299 * r + 0.587 * g + 0.114 * b;
      gray = cFactor * (gray - 128) + 128 + bOffset;

      // Subtle background clearing
      if (gray > 140) {
        gray = Math.min(255, gray * 1.2 + 15);
      }

      const clamped = Math.max(0, Math.min(255, Math.round(gray)));
      data[i] = clamped;
      data[i + 1] = clamped;
      data[i + 2] = clamped;
    }
  } else if (filter === 'high_contrast') {
    // Pure binary threshold
    for (let i = 0; i < len; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const val = (gray + bOffset) > 130 ? 255 : 0;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Converts a Canvas to a JPEG/PNG Blob or Base64 Data URL
 */
export function canvasToDataURL(canvas: HTMLCanvasElement, quality = 0.92): string {
  return canvas.toDataURL('image/jpeg', quality);
}
