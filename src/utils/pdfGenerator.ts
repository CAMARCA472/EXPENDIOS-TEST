import jsPDF from 'jspdf';
import JSZip from 'jszip';
import html2canvas from 'html2canvas';
import { CuentaCobroResult, ExpendioData } from '../types';
import { numeroALetras } from './numeroALetras';
import { isRealPhoto } from './photoValidation';

function extractMesAno(periodoStr: string) {
  const clean = (periodoStr || '').toUpperCase();
  let mes = 'ENERO';
  let ano = '2026';
  const meses = [
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
  ];
  for (const m of meses) {
    if (clean.includes(m)) {
      mes = m;
      break;
    }
  }
  const matchAno = clean.match(/20\d\d/);
  if (matchAno) {
    ano = matchAno[0];
  }
  return { mes, ano };
}

function formatCurrency(val?: number) {
  const num = Math.round(Number(val) || 0);
  return `$ ${num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

let cachedLogoDataUrl: string | null = null;

export async function getCamarcaLogoDataUrl(): Promise<string> {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  try {
    const svgStr = `<svg viewBox="0 0 540 140" width="540" height="140" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="goldG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FBBF24" />
          <stop offset="50%" stop-color="#F59E0B" />
          <stop offset="100%" stop-color="#D97706" />
        </linearGradient>
        <linearGradient id="purpleG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#581C87" />
          <stop offset="60%" stop-color="#3B0764" />
          <stop offset="100%" stop-color="#1E1B4B" />
        </linearGradient>
      </defs>
      <!-- Isometric Cube Emblem -->
      <g transform="translate(10, 8) scale(0.78)">
        <path d="M 15 45 L 100 92 L 100 155 L 15 108 Z" fill="url(#goldG)" stroke="#B45309" stroke-width="2" stroke-linejoin="round" />
        <path d="M 15 45 L 100 92 L 185 45 L 100 8 Z" fill="url(#purpleG)" stroke="#3B0764" stroke-width="2" stroke-linejoin="round" />
        <path d="M 100 92 L 185 45 L 185 108 L 100 155 Z" fill="#1E293B" stroke="#0F172A" stroke-width="2" stroke-linejoin="round" />
        <path d="M 52 76 A 36 36 0 1 1 144 86" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
        <polygon points="136,62 160,78 136,94" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="1" stroke-linejoin="round" />
        <circle cx="98" cy="84" r="5" fill="#FBBF24" />
        <line x1="98" y1="84" x2="98" y2="58" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" />
        <line x1="98" y1="84" x2="122" y2="102" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" />
      </g>
      <!-- Brand Name Typography -->
      <text x="175" y="68" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="50" font-weight="900">
        <tspan fill="#0F172A">CAMAR</tspan><tspan fill="#F59E0B">CA</tspan>
      </text>
      <text x="445" y="46" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="20" font-weight="800" fill="#64748B">
        S.A.S
      </text>
      <!-- Subtitle & Badge -->
      <text x="176" y="104" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="15" fill="#475569" letter-spacing="3.2">
        OPERADOR POSTAL &amp; LOGÍSTICA
      </text>
      <rect x="472" y="89" width="46" height="20" rx="4" fill="#FEF3C7" stroke="#FDE68A" stroke-width="1.5" />
      <text x="495" y="104" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="13" fill="#D97706" text-anchor="middle">
        4-72
      </text>
    </svg>`;

    const img = new Image();
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    await new Promise((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 280;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, 1080, 280);
      cachedLogoDataUrl = canvas.toDataURL('image/png');
    }
    URL.revokeObjectURL(url);
    return cachedLogoDataUrl || '';
  } catch (e) {
    console.warn('Could not pre-render SVG logo:', e);
    return '';
  }
}

// Helper to render concept text with selective bold tokens and word wrapping
function renderRichConcepto(
  pdf: jsPDF,
  startX: number,
  startY: number,
  maxWidth: number,
  tokens: { text: string; bold: boolean }[],
  fontSize: number = 8.2,
  lineHeight: number = 3.9
) {
  pdf.setFontSize(fontSize);
  pdf.setTextColor(15, 23, 42);

  const words: { text: string; bold: boolean }[] = [];
  for (const token of tokens) {
    const split = token.text.split(' ');
    for (let i = 0; i < split.length; i++) {
      const w = split[i];
      if (w.length > 0) {
        words.push({ text: w, bold: token.bold });
      }
    }
  }

  let currentX = startX;
  let currentY = startY;

  for (let i = 0; i < words.length; i++) {
    const item = words[i];
    pdf.setFont('helvetica', item.bold ? 'bold' : 'normal');
    const wordWidth = pdf.getTextWidth(item.text);
    const spaceWidth = pdf.getTextWidth(' ');

    if (currentX + wordWidth > startX + maxWidth && currentX > startX) {
      currentX = startX;
      currentY += lineHeight;
    }

    pdf.text(item.text, currentX, currentY);
    currentX += wordWidth + spaceWidth;
  }
}

export function drawCuentaCobroPageVector(
  pdf: jsPDF,
  item: CuentaCobroResult,
  index: number,
  total: number,
  customPeriodo?: string,
  logoDataUrl?: string
) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 16;
  const contentWidth = pageWidth - marginX * 2;

  const municipioUpper = (item.municipio || item.expendio || 'CRAVO NORTE').toUpperCase();
  const centroOpUpper = (item.centroOperativo || 'PO.ARAUCA').toUpperCase();
  const regionalUpper = (item.regional || 'ORIENTE').toUpperCase();
  const encargadoUpper = (item.encargado || 'POR ASIGNAR').toUpperCase();

  const { mes, ano } = extractMesAno(customPeriodo || item.periodo || '');
  const fechaEmisionUpper = (customPeriodo || item.periodo || `MES DE ${mes} DEL AÑO ${ano}`).toUpperCase();

  const cargoBasico = item.cargoBasico ?? item.valorBase ?? 0;
  const subsidioInternet = item.admisionSipost ?? 0;
  const variableGestion = item.valorVariable ?? 0;
  const isGrossUp = !!item.grossUpAplicado;
  const pRet = item.porcentajeRetencion || 1;
  const retef1 = isGrossUp ? 0 : (item.retef1 ?? item.retencionValor ?? Math.round((cargoBasico + subsidioInternet + variableGestion) * (pRet / 100)));
  const neto = isGrossUp ? (cargoBasico + subsidioInternet + variableGestion) : (item.valorNeto ?? (cargoBasico + subsidioInternet + variableGestion - retef1));

  const pageNum = item.numeroConsecutivo || (index + 1);
  const totalPages = item.totalPaginas || total;
  const pageLabel = totalPages > 1 ? `PÁG. ${pageNum} / ${totalPages}` : `PÁG. ${pageNum}`;

  // 1. TOP HEADER WITH DATE & PAGE NUMBER
  pdf.setFontSize(8.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(15, 23, 42);
  pdf.text(`${municipioUpper} ${fechaEmisionUpper}`, marginX, 14);
  pdf.text(pageLabel, pageWidth - marginX, 14, { align: 'right' });

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.5);
  pdf.line(marginX, 16.5, pageWidth - marginX, 16.5);

  // 2. LOGO & CORPORATE HEADER (NO OVERLAPPING TEXT, CLEAN PROPORTIONS)
  const logoW = 66;
  const logoH = 17.1;
  const logoX = (pageWidth - logoW) / 2;
  const logoY = 19;

  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, 'PNG', logoX, logoY, logoW, logoH);
    } catch (e) {
      // fallback
    }
  } else {
    // Text fallback if image not ready
    pdf.setFontSize(15);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(15, 23, 42);
    pdf.text('CAMARCA S.A.S.', pageWidth / 2, 27, { align: 'center' });
    pdf.setFontSize(7.5);
    pdf.setTextColor(217, 119, 6);
    pdf.text('OPERADOR POSTAL & LOGÍSTICA SPU 4-72', pageWidth / 2, 33, { align: 'center' });
  }

  // Header Titles below Logo
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(15, 23, 42);
  pdf.text('CUENTA DE COBRO', pageWidth / 2, 40.5, { align: 'center' });

  pdf.setFontSize(9.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 41, 59);
  pdf.text('CAMARCA SAS', pageWidth / 2, 45, { align: 'center' });

  pdf.setFontSize(8.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(71, 85, 105);
  pdf.text('NIT 900.504.241-7', pageWidth / 2, 49, { align: 'center' });

  // 3. DEBE A CARD (MATCHING MODAL LAYOUT & TYPOGRAPHY)
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.35);
  pdf.roundedRect(marginX, 53, contentWidth, 18.5, 2.5, 2.5, 'FD');

  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(100, 116, 139);
  pdf.text('DEBE A:', pageWidth / 2, 57.5, { align: 'center' });

  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(15, 23, 42);
  pdf.text(encargadoUpper, pageWidth / 2, 63.5, { align: 'center' });

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 41, 59);
  pdf.text(`C.C ${item.cedula}`, pageWidth / 2, 68.5, { align: 'center' });

  // 4. CONCEPTO TEXT (WITH 4px THICK LEFT BLACK BAR, EXACT STYLING)
  const conceptoBoxY = 75;
  const conceptoBoxH = 24;
  pdf.setFillColor(248, 250, 252);
  pdf.rect(marginX, conceptoBoxY, contentWidth, conceptoBoxH, 'F');

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(1.3);
  pdf.line(marginX, conceptoBoxY, marginX, conceptoBoxY + conceptoBoxH);

  // Concept tokens with specific words marked as bold (matching preview document)
  const tokens = [
    { text: 'POR CONCEPTO DE PRESTACION DE SERVICIOS DEL SPU, PUBLICACION DE LISTAS DE CORREO, ADMISION SIPOST Y DISTRIBUCION DE PIEZAS POSTALES EN EL EXPENDIO DE 4-72 UBICADO EN EL MUNICIPIO DE', bold: false },
    { text: municipioUpper, bold: true },
    { text: 'DEL CENTRO OPERATIVO', bold: false },
    { text: centroOpUpper, bold: true },
    { text: 'EL CUAL PERTENECE A LA REGIONAL', bold: false },
    { text: regionalUpper, bold: true },
    { text: 'DURANTE EL MES DE', bold: false },
    { text: mes, bold: true },
    { text: 'DEL AÑO', bold: false },
    { text: ano, bold: true },
  ];

  renderRichConcepto(pdf, marginX + 5, conceptoBoxY + 5.5, contentWidth - 10, tokens, 8.2, 3.9);

  // 5. BREAKDOWN TABLE (5 ROWS, CRISP BLACK GRID, ACCURATE PADDING & FONT SIZES)
  let y = 103;
  const col1Width = contentWidth - 46;
  const col2Width = 46;
  const colDividerX = marginX + col1Width;
  const rightTextX = pageWidth - marginX - 4;

  pdf.setLineWidth(0.35);
  pdf.setDrawColor(0, 0, 0);

  // Row 1: Cargo Basico
  pdf.rect(marginX, y, contentWidth, 8.5);
  pdf.line(colDividerX, y, colDividerX, y + 8.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.2);
  pdf.setTextColor(15, 23, 42);
  pdf.text('VALOR CARGO BASICO', marginX + 3.5, y + 5.5);
  pdf.setFontSize(8.8);
  pdf.text(formatCurrency(cargoBasico), rightTextX, y + 5.5, { align: 'right' });

  // Row 2: Subsidio Sipost
  y += 8.5;
  pdf.rect(marginX, y, contentWidth, 8.5);
  pdf.line(colDividerX, y, colDividerX, y + 8.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.2);
  pdf.text('SUBSIDIO DE INTERNET USO DE SIPOST - SI APLICA', marginX + 3.5, y + 5.5);
  pdf.setFontSize(8.8);
  pdf.text(subsidioInternet > 0 ? formatCurrency(subsidioInternet) : '$ ', rightTextX, y + 5.5, { align: 'right' });

  // Row 3: Variable
  y += 8.5;
  pdf.rect(marginX, y, contentWidth, 9.5);
  pdf.line(colDividerX, y, colDividerX, y + 9.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.0);
  pdf.text('VARIABLE GESTION DE PIEZAS POSTALES, LISTAS DE CORREO, ADMISION CREDITO- SI APLICA', marginX + 3.5, y + 6);
  pdf.setFontSize(8.8);
  pdf.text(formatCurrency(variableGestion), rightTextX, y + 6, { align: 'right' });

  // Row 4: Retencion (Red Text)
  y += 9.5;
  pdf.rect(marginX, y, contentWidth, 8.5);
  pdf.line(colDividerX, y, colDividerX, y + 8.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.2);
  pdf.setTextColor(15, 23, 42);
  pdf.text(`RETENCION ${pRet}%`, marginX + 3.5, y + 5.5);
  pdf.setFontSize(8.8);
  pdf.setTextColor(220, 38, 38); // Red
  pdf.text(formatCurrency(retef1), rightTextX, y + 5.5, { align: 'right' });

  // Row 5: Neto A Pagar
  y += 8.5;
  pdf.setFillColor(248, 250, 252);
  pdf.rect(marginX, y, contentWidth, 15, 'FD');
  pdf.line(colDividerX, y, colDividerX, y + 15);
  
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('NETO A PAGAR', marginX + 3.5, y + 5.5);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.2);
  pdf.setTextColor(71, 85, 105);
  const textoLetras = `( ${numeroALetras(neto)} )`;
  const letrasLines = pdf.splitTextToSize(textoLetras, col1Width - 7);
  pdf.text(letrasLines, marginX + 3.5, y + 10.5);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text(formatCurrency(neto), rightTextX, y + 9.5, { align: 'right' });

  // 6. BANKING & SIGNATURES FOOTER
  y += 24;
  pdf.setFontSize(8.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(15, 23, 42);
  pdf.text('CUENTA BANCARIA__________________________', marginX, y);
  pdf.text('BANCO___________________________________', marginX, y + 6.5);

  y += 28;
  pdf.setLineWidth(0.4);
  pdf.line(marginX, y, marginX + 75, y);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.8);
  pdf.setTextColor(15, 23, 42);
  pdf.text(encargadoUpper, marginX, y + 5);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(51, 65, 85);
  pdf.text(`C.C ${item.cedula}`, marginX, y + 9.5);

  // Bottom Line & Addresses
  pdf.setLineWidth(0.35);
  pdf.setDrawColor(0, 0, 0);
  pdf.line(marginX, pageHeight - 16, pageWidth - marginX, pageHeight - 16);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text(`DIRECCION: ${item.direccion || 'SEDE PRINCIPAL EXPENDIO'} ${item.telefono ? `| TEL: ${item.telefono}` : ''}`, marginX, pageHeight - 11);

  pdf.setFontSize(8.2);
  pdf.setTextColor(15, 23, 42);
  pdf.text(pageLabel, pageWidth - marginX, pageHeight - 11, { align: 'right' });
}

export async function generateSingleCuentaCobroPDFBlob(
  item: CuentaCobroResult,
  index: number,
  total: number,
  periodo?: string,
  logoDataUrl?: string
): Promise<Blob> {
  const pdf = new jsPDF('p', 'mm', 'letter');
  drawCuentaCobroPageVector(pdf, item, index, total, periodo, logoDataUrl);
  return pdf.output('blob');
}

export async function generateCuentasCobroConsolidadoPDF(
  items: CuentaCobroResult[],
  periodo: string
) {
  if (items.length === 0) return;
  const logoDataUrl = await getCamarcaLogoDataUrl();
  const pdf = new jsPDF('p', 'mm', 'letter');

  for (let i = 0; i < items.length; i++) {
    if (i > 0) {
      pdf.addPage('letter', 'p');
    }
    drawCuentaCobroPageVector(pdf, items[i], i, items.length, periodo, logoDataUrl);
  }

  const { mes, ano } = extractMesAno(periodo || items[0]?.periodo || '');
  pdf.save(`Cuentas_de_Cobro_Consolidadas_CAMARCA_${mes}_${ano}.pdf`);
}

export async function generateCuentasCobroPDF(
  items: CuentaCobroResult[],
  periodo: string,
  onProgress?: (msg: string) => void
) {
  if (items.length === 0) return;

  try {
    if (onProgress) onProgress('Preparando logotipo y motor PDF...');
    const logoDataUrl = await getCamarcaLogoDataUrl();
    const zip = new JSZip();

    const sampleMes = extractMesAno(periodo || items[0]?.periodo || '').mes;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (onProgress && (i % 10 === 0 || i === items.length - 1)) {
        onProgress(`Generando PDF ${i + 1} de ${items.length}...`);
      }

      const pdf = new jsPDF('p', 'mm', 'letter');
      drawCuentaCobroPageVector(pdf, item, i, items.length, periodo, logoDataUrl);
      const pdfBlob = pdf.output('blob');

      const municipioUpper = (item.municipio || item.expendio || 'CRAVO NORTE').toUpperCase();
      const municipioClean = municipioUpper.replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_');

      let finalFileName = `${municipioClean}_${sampleMes}.pdf`;
      let counter = 1;
      while (zip.file(finalFileName)) {
        finalFileName = `${municipioClean}_${sampleMes}_${counter}.pdf`;
        counter++;
      }

      zip.file(finalFileName, pdfBlob);
    }

    if (onProgress) onProgress('Comprimiendo archivo ZIP...');
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 5 }
    });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `Cuentas_de_Cobro_CAMARCA_${sampleMes}_2026.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (onProgress) onProgress('¡Descarga completada!');
  } catch (error) {
    console.error('Error generating cuentas de cobro ZIP:', error);
    throw error;
  }
}

async function getBase64ImageFromUrl(imageUrl?: string): Promise<string | null> {
  if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim() === '') {
    return null;
  }
  if (!isRealPhoto(imageUrl)) {
    return null;
  }
  if (imageUrl.startsWith('data:image/')) {
    return imageUrl;
  }

  try {
    const res = await fetch(imageUrl, { mode: 'cors' });
    if (!res.ok) throw new Error('Fetch failed');
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    // Fallback: try HTML Image object
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || 400;
            canvas.height = img.naturalHeight || 300;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0);
              resolve(canvas.toDataURL('image/jpeg', 0.85));
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = imageUrl;
      } catch {
        resolve(null);
      }
    });
  }
}

interface PhotoSlotMetadata {
  title: string;
  subtitle: string;
  url?: string;
}

function getExpendioPhotoSlots(exp: ExpendioData): PhotoSlotMetadata[] {
  const getValidUrl = (u1?: string, u2?: string): string | undefined => {
    if (u1 && isRealPhoto(u1)) return u1;
    if (u2 && isRealPhoto(u2)) return u2;
    return undefined;
  };

  return [
    {
      title: '1. FOTO AVISO',
      subtitle: 'Aviso exterior oficial',
      url: getValidUrl(exp.fotoAvisoUrl, exp.letreroUrl),
    },
    {
      title: '2. FOTO PANORÁMICA',
      subtitle: 'Fachada y aviso 4-72 visible',
      url: getValidUrl(exp.fotoPanoramicaUrl),
    },
    {
      title: '3. FOTO MATASELLO',
      subtitle: 'Matasello postal de correspondencia',
      url: getValidUrl(exp.fotoMataselloUrl, exp.mataselloUrl),
    },
    {
      title: '4. FOTO BÁSCULA',
      subtitle: 'Báscula de pesaje calibrada',
      url: getValidUrl(exp.fotoBasculaUrl, exp.basculaUrl),
    },
    {
      title: '5. FOTO DEL CONTRATISTA',
      subtitle: 'Encargado en el punto de atención',
      url: getValidUrl(exp.fotoContratistaUrl),
    },
    {
      title: '6. FOTO HORARIO',
      subtitle: 'Horario de atención publicado',
      url: getValidUrl(exp.fotoHorarioUrl),
    },
    {
      title: '7. FOTO TARIFAS',
      subtitle: 'Tarifario oficial visible al público',
      url: getValidUrl(exp.fotoTarifasUrl),
    },
  ];
}

async function renderExpendioPageOnPDF(pdf: jsPDF, exp: ExpendioData, isFirst: boolean) {
  if (!isFirst) {
    pdf.addPage();
  }

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const munUpper = (exp.municipio || exp.localidad || 'GENERAL').toUpperCase();

  // Top Dark Header Banner
  pdf.setFillColor(15, 23, 42); // slate-900
  pdf.rect(0, 0, pageWidth, 18, 'F');

  // Amber accent line
  pdf.setFillColor(245, 158, 11); // amber-500
  pdf.rect(0, 18, pageWidth, 1.2, 'F');

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.text(`REPORTE FOTOGRÁFICO OFICIAL DE EXPENDIO (7 REGISTROS) - 4-72`, 10, 8);

  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(226, 232, 240);
  pdf.text(
    `MUNICIPIO: ${munUpper} | LOCALIDAD: ${(exp.localidad || exp.municipio).toUpperCase()} | CAMARCA S.A.S. - NIT 900.504.241-7`,
    10,
    14.5
  );

  // Metadata Info Card (Clean compact box)
  const metaY = 21.5;
  const metaH = 13;
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.roundedRect(10, metaY, pageWidth - 20, metaH, 1.5, 1.5, 'FD');

  pdf.setTextColor(30, 41, 59);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.text('CONTRATISTA / ENCARGADO:', 13, metaY + 4.2);
  pdf.text('DIRECCIÓN DEL PUNTO:', 13, metaY + 9.8);

  pdf.text('CÉDULA / NIT:', 105, metaY + 4.2);
  pdf.text('TELÉFONO:', 105, metaY + 9.8);

  pdf.text('USUARIO SIPOST:', 155, metaY + 4.2);
  pdf.text('FECHA REGISTRO:', 155, metaY + 9.8);

  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(51, 65, 85);
  pdf.text((exp.encargado || 'POR ASIGNAR').substring(0, 35).toUpperCase(), 50, metaY + 4.2);
  pdf.text((exp.direccionPunto || 'SEDE PRINCIPAL').substring(0, 35).toUpperCase(), 44, metaY + 9.8);

  pdf.text(exp.cedula || 'N/A', 124, metaY + 4.2);
  pdf.text(exp.telefonoPunto || 'N/A', 120, metaY + 9.8);

  pdf.text(exp.usuarioSipost || 'NO REGISTRADO', 178, metaY + 4.2);
  pdf.text(new Date().toLocaleDateString('es-CO'), 178, metaY + 9.8);

  // 7 Photographic Slots Grid: 3 rows (Row 1: 1 photo centered - Foto Aviso, Row 2: 3 photos, Row 3: 3 photos)
  // Formato Carta garantizado con márgenes limpios y fotos ampliadas sin banners inferiores.
  const photoSlots = getExpendioPhotoSlots(exp);
  const startY = 36.5;
  const photoBoxH = 70.5;
  const gapX = 3.2;
  const gapY = 3.2;
  const colW3 = (pageWidth - 20 - gapX * 2) / 3; // ~63.16mm each

  for (let i = 0; i < photoSlots.length; i++) {
    const slot = photoSlots[i];
    let x: number;
    let y: number;
    let w: number;
    const h = photoBoxH;

    if (i === 0) {
      // Row 1: Photo 1 (Foto Aviso) - Centrada y ampliada
      w = 118;
      x = (pageWidth - w) / 2;
      y = startY;
    } else if (i <= 3) {
      // Row 2: Photos 2, 3, 4 (Panorámica, Matasello, Báscula)
      w = colW3;
      x = 10 + (i - 1) * (colW3 + gapX);
      y = startY + photoBoxH + gapY;
    } else {
      // Row 3: Photos 5, 6, 7 (Contratista, Horario, Tarifas)
      w = colW3;
      x = 10 + (i - 4) * (colW3 + gapX);
      y = startY + (photoBoxH + gapY) * 2;
    }

    // Box outer frame
    pdf.setFillColor(241, 245, 249);
    pdf.setDrawColor(203, 213, 225);
    pdf.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');

    // Header label of photo
    pdf.setFillColor(30, 41, 59);
    pdf.roundedRect(x, y, w, 5.5, 1.5, 1.5, 'F');
    pdf.rect(x, y + 4, w, 1.5, 'F'); // square bottom of header

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.8);
    pdf.setTextColor(245, 158, 11); // Amber
    pdf.text(slot.title, x + 2.5, y + 3.8);

    // Fetch and render image
    const imgData = await getBase64ImageFromUrl(slot.url);

    // Área ampliada de la fotografía aprovechando el espacio liberado por la eliminación del banner
    const imgInnerX = x + 1.2;
    const imgInnerY = y + 5.8;
    const imgInnerW = w - 2.4;
    const imgInnerH = h - 7.0; // Ganancia vertical de +5.5mm por foto

    if (imgData) {
      try {
        pdf.addImage(imgData, 'JPEG', imgInnerX, imgInnerY, imgInnerW, imgInnerH, undefined, 'FAST');
        pdf.setDrawColor(203, 213, 225);
        pdf.rect(imgInnerX, imgInnerY, imgInnerW, imgInnerH, 'S');
      } catch (e) {
        console.error('Error drawing image on PDF:', e);
        drawPlaceholder(pdf, x, y, w, h, slot.subtitle, false);
      }
    } else {
      drawPlaceholder(pdf, x, y, w, h, slot.subtitle, true);
    }
  }

  // Bottom Page Footer (Guaranteed Letter Single Page)
  pdf.setDrawColor(203, 213, 225);
  pdf.line(10, 260.5, pageWidth - 10, 260.5);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text(
    `Sistema de Control y Evidencia Fotográfica CAMARCA S.A.S. | Operador Postal Oficial 4-72`,
    pageWidth / 2,
    265.5,
    { align: 'center' }
  );
  pdf.text(
    `Documento Oficial de Registro Fotográfico de Expendio Postal | Fecha de Emisión: ${new Date().toLocaleDateString('es-CO')} | Hoja 1 de 1 (Tamaño Carta)`,
    pageWidth / 2,
    270,
    { align: 'center' }
  );
}

function drawPlaceholder(
  pdf: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  sublabel: string,
  isMissing: boolean
) {
  const innerX = x + 1.2;
  const innerY = y + 5.8;
  const innerW = w - 2.4;
  const innerH = h - 7.0;

  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.rect(innerX, innerY, innerW, innerH, 'FD');

  if (!isMissing) {
    pdf.setTextColor(245, 158, 11);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.2);
    pdf.text('FOTO EN PROCESO', x + w / 2, innerY + innerH / 2, { align: 'center' });
  }
}

export async function generateReporteFotograficoPDF(expendios: ExpendioData[], options?: { municipioFilter?: string }) {
  const pdf = new jsPDF('p', 'mm', 'letter');

  let listToProcess = expendios;
  if (options?.municipioFilter && options.municipioFilter !== 'TODOS') {
    const filterUpper = options.municipioFilter.trim().toUpperCase();
    listToProcess = expendios.filter(
      (e) => (e.municipio || '').toUpperCase() === filterUpper || (e.localidad || '').toUpperCase() === filterUpper
    );
  }

  if (listToProcess.length === 0) {
    listToProcess = expendios;
  }

  // Sort list by Municipio name
  const sortedList = [...listToProcess].sort((a, b) => (a.municipio || '').localeCompare(b.municipio || ''));

  for (let i = 0; i < sortedList.length; i++) {
    await renderExpendioPageOnPDF(pdf, sortedList[i], i === 0);
  }

  const munSuffix = options?.municipioFilter && options.municipioFilter !== 'TODOS'
    ? `_${options.municipioFilter.replace(/\s+/g, '_')}`
    : '_Consolidado_Todos_Municipios';

  pdf.save(`Reporte_Fotografico_7Fotos_CAMARCA${munSuffix}_${new Date().toISOString().split('T')[0]}.pdf`);
}

export async function generateReporteFotograficoSinglePDF(expendio: ExpendioData) {
  const pdf = new jsPDF('p', 'mm', 'letter');
  await renderExpendioPageOnPDF(pdf, expendio, true);
  const munClean = (expendio.municipio || expendio.localidad || 'expendio').replace(/\s+/g, '_');
  pdf.save(`Reporte_Fotografico_7Fotos_${munClean}.pdf`);
}

export async function generateReporteFotograficoZip(expendios: ExpendioData[]) {
  const zip = new JSZip();

  for (let i = 0; i < expendios.length; i++) {
    const exp = expendios[i];
    const pdf = new jsPDF('p', 'mm', 'letter');
    await renderExpendioPageOnPDF(pdf, exp, true);
    const pdfBlob = pdf.output('blob');

    const munClean = (exp.municipio || exp.localidad || `expendio_${i + 1}`).replace(/[^A-Z0-9]/gi, '_');
    zip.file(`Reporte_Fotografico_7Fotos_${munClean}.pdf`, pdfBlob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(zipBlob);
  link.download = `Reportes_Fotograficos_7Fotos_Municipios_CAMARCA_${new Date().toISOString().split('T')[0]}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

