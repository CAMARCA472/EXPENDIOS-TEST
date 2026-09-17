import jsPDF from 'jspdf';
import { ExpendioData } from '../types';

/**
 * Genera el documento oficial de "HORARIO DE ATENCIÓN EXPENDIO 4-72"
 * Conforme al modelo oficial adjunto:
 * - Logos superiores: Gobierno de Colombia, MinTIC, 4-72
 * - Título: EXPENDIO 4-72
 * - Municipio personalizado según el expendio
 * - Sección "Horario de Atención"
 * - Franja Lunes a Viernes (8 a.m. a 12 m. / 2 p.m. a 6 p.m.) y Sábados (8 a.m. a 12 m.)
 * - Pie de página oficial de Servicios Postales Nacionales S.A.
 */
export async function generateHorarioAtencionPDF(expendio: ExpendioData): Promise<void> {
  // Formato CARTA (Letter: 279.4 x 215.9 mm en horizontal)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 279.4 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 215.9 mm

  // Fondo blanco puro
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  // --- CABECERA OFICIAL CON IDENTIDAD GRÁFICA INSTITUCIONAL ---
  // 1. Escudo República de Colombia & GOBIERNO DE COLOMBIA (Izquierda)
  const govLeftX = 24;
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.circle(govLeftX + 5, 17, 7, 'FD');

  // Franjas tricolor de Colombia (Amarillo, Azul, Rojo)
  doc.setFillColor(255, 209, 0); // Amarillo 50%
  doc.rect(govLeftX + 1.5, 13.5, 7, 2.8, 'F');
  doc.setFillColor(0, 56, 147); // Azul 25%
  doc.rect(govLeftX + 1.5, 16.3, 7, 1.4, 'F');
  doc.setFillColor(206, 17, 38); // Rojo 25%
  doc.rect(govLeftX + 1.5, 17.7, 7, 1.4, 'F');

  doc.setTextColor(218, 59, 39);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('GOBIERNO', govLeftX + 15, 15.5);
  doc.text('DE COLOMBIA', govLeftX + 15, 19.5);

  // 2. LOGO OFICIAL MinTIC (Centro) - Diseño Vectorial Auténtico MinTIC (Sin círculos rojos invasivos)
  const minticCenterX = pageWidth / 2;
  // Isotipo tecnológico sutil: tres puntos de conectividad digital
  doc.setFillColor(13, 148, 136); // Teal MinTIC
  doc.circle(minticCenterX - 22, 17, 2, 'F');
  doc.setFillColor(14, 116, 144);
  doc.circle(minticCenterX - 18.5, 14.5, 1.3, 'F');
  doc.setFillColor(234, 179, 8);
  doc.circle(minticCenterX - 18.5, 19.5, 1.3, 'F');

  // Tipografía oficial MinTIC
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(13, 148, 136); // Teal institucional
  doc.text('Min', minticCenterX - 14, 18.5);
  doc.setTextColor(10, 37, 85); // Azul marino corporativo
  doc.text('TIC', minticCenterX - 2.5, 18.5);

  // Subtítulo oficial del Ministerio
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(71, 85, 105);
  doc.text('Ministerio de Tecnologías de la Información', minticCenterX + 12, 16.5);
  doc.text('y las Comunicaciones', minticCenterX + 12, 19.5);

  // 3. LOGO OFICIAL 4-72 (Derecha)
  const logoRightX = pageWidth - 68;
  // Flecha izquierda amarilla «
  doc.setTextColor(234, 179, 8);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('«', logoRightX, 19);

  // Texto 4-72 Azul marino
  doc.setTextColor(10, 37, 85);
  doc.setFontSize(24);
  doc.text('4-72', logoRightX + 7, 19);

  // Flecha derecha roja »
  doc.setTextColor(220, 38, 38);
  doc.setFontSize(24);
  doc.text('»', logoRightX + 26, 19);

  // Subtítulo oficial 4-72
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(10, 37, 85);
  doc.text('El servicio de envíos', logoRightX + 33, 16);
  doc.text('de Colombia', logoRightX + 33, 19.5);

  // Divisor superior limpio
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(20, 26, pageWidth - 20, 26);

  // --- CUERPO PRINCIPAL (AMPLIADO Y DESTACADO PARA TAMAÑO CARTA) ---
  // Título "EXPENDIO 4-72" agrandado y con gran impacto visual
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(44);
  doc.setTextColor(10, 37, 85);
  doc.text('EXPENDIO 4-72', pageWidth / 2, 49, { align: 'center' });

  // Municipio personalizado (Elegante serif tamaño grande)
  const rawMun = expendio.municipio || expendio.localidad || 'SANTANDER';
  const formattedMunicipio = rawMun
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  doc.setFont('times', 'normal');
  doc.setFontSize(38);
  doc.setTextColor(10, 37, 85);
  doc.text(`Municipio ${formattedMunicipio}`, pageWidth / 2, 68, { align: 'center' });

  // Subtítulo "Horario de Atención" con peso visual
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(42);
  doc.setTextColor(10, 37, 85);
  doc.text('Horario de Atención', pageWidth / 2, 94, { align: 'center' });

  // Franja "LUNES A VIERNES"
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(10, 37, 85);
  doc.text('LUNES A VIERNES', pageWidth / 2, 114, { align: 'center' });

  // Horas L-V ampliadas para máxima legibilidad
  doc.setFont('times', 'normal');
  doc.setFontSize(27);
  doc.text('8 a.m. a 12 m.', pageWidth / 2, 126, { align: 'center' });
  doc.text('2 p.m. a 6 p.m.', pageWidth / 2, 139, { align: 'center' });

  // Franja "SÁBADOS"
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('SÁBADOS', pageWidth / 2, 156, { align: 'center' });

  // Horas Sábado
  doc.setFont('times', 'normal');
  doc.setFontSize(27);
  doc.text('8 a.m. a 12 m.', pageWidth / 2, 168, { align: 'center' });

  // Línea sólida de base centrada
  doc.setDrawColor(10, 37, 85);
  doc.setLineWidth(0.8);
  doc.line(pageWidth / 2 - 45, 174, pageWidth / 2 + 45, 174);

  // --- PIE DE PÁGINA OFICIAL EN FORMATO CARTA ---
  // Sello redondo "EL CORREO OFICIAL DE COLOMBIA"
  const footerY = 200;
  doc.setDrawColor(10, 37, 85);
  doc.setLineWidth(0.4);
  doc.circle(28, footerY, 7.5);
  doc.circle(28, footerY, 6.7);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.2);
  doc.setTextColor(10, 37, 85);
  doc.text('EL CORREO', 28, footerY - 1.5, { align: 'center' });
  doc.text('OFICIAL', 28, footerY + 0.5, { align: 'center' });
  doc.text('DE COLOMBIA', 28, footerY + 2.5, { align: 'center' });

  // Textos legales 4-72
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(70, 70, 70);
  doc.text('Servicios Postales Nacionales S.A.  -  4-72', 38, footerY - 3.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.text('Diagonal 25G Nº 95A - 55 Bogotá · Línea Bogotá: (601) 472 2000 · Nacional: 01 8000 111 210', 38, footerY + 0.5);
  doc.text('Código Postal: 110911 · Vigilado y Controlado por MinTIC · www.4-72.com.co', 38, footerY + 4);

  // Decoración diagonal en esquina inferior derecha (Amarillo, Azul, Rojo)
  // Franja gris de base
  doc.setFillColor(225, 227, 230);
  doc.triangle(pageWidth - 42, pageHeight, pageWidth, pageHeight - 42, pageWidth, pageHeight, 'F');

  // Franja amarilla
  doc.setFillColor(245, 197, 24);
  doc.triangle(pageWidth - 25, pageHeight - 14, pageWidth - 17, pageHeight - 14, pageWidth - 21, pageHeight - 18, 'F');

  // Franja azul
  doc.setFillColor(14, 88, 189);
  doc.triangle(pageWidth - 20, pageHeight - 9, pageWidth - 12, pageHeight - 9, pageWidth - 16, pageHeight - 13, 'F');

  // Franja roja
  doc.setFillColor(218, 37, 28);
  doc.triangle(pageWidth - 15, pageHeight - 4, pageWidth - 7, pageHeight - 4, pageWidth - 11, pageHeight - 8, 'F');

  const fileName = `Horario_Atencion_472_${formattedMunicipio.replace(/\s+/g, '_')}_Carta.pdf`;
  doc.save(fileName);
}

/**
 * Genera el documento oficial "AVISO PUNTO DE VENTA 4-72"
 * Conforme al modelo oficial adjunto:
 * - Marco con doble filete azul y detalles de esquinas
 * - « 4-72 » logo con chevrons amarillo y rojo
 * - Separador vertical amarillo
 * - "PUNTO DE VENTA" / "SERVICIOS POSTALES"
 * - Barra tricolor
 * - EXPENDIO: [Nombre personalizado del expendio / municipio]
 */
export async function generateAviso472PDF(expendio: ExpendioData): Promise<void> {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4', // 297 x 210 mm
  });

  const pageWidth = 297;
  const pageHeight = 210;

  // Fondo blanco puro
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  // Marco exterior azul oscuro
  doc.setDrawColor(10, 50, 120);
  doc.setLineWidth(1.2);
  doc.rect(12, 12, pageWidth - 24, pageHeight - 24);

  // Marco interior delgado
  doc.setLineWidth(0.4);
  doc.rect(14, 14, pageWidth - 28, pageHeight - 28);

  // Bandas decorativas superior e inferior
  // Esquina superior izquierda
  doc.setFillColor(245, 197, 24); // Amarillo
  doc.rect(16, 2, 40, 8, 'F');
  doc.setFillColor(14, 88, 189); // Azul
  doc.rect(56, 2, 25, 8, 'F');

  // Esquina superior derecha
  doc.setFillColor(14, 88, 189); // Azul
  doc.rect(pageWidth - 80, 2, 35, 8, 'F');
  doc.setFillColor(218, 37, 28); // Rojo
  doc.rect(pageWidth - 45, 2, 30, 8, 'F');

  // Esquina inferior izquierda
  doc.setFillColor(14, 88, 189);
  doc.rect(16, pageHeight - 10, 35, 8, 'F');
  doc.setFillColor(245, 197, 24);
  doc.rect(51, pageHeight - 10, 30, 8, 'F');

  // Esquina inferior derecha
  doc.setFillColor(14, 88, 189);
  doc.rect(pageWidth - 75, pageHeight - 10, 45, 8, 'F');
  doc.setFillColor(218, 37, 28);
  doc.rect(pageWidth - 30, pageHeight - 10, 15, 8, 'F');

  // --- SECCIÓN SUPERIOR: LOGO Y PUNTO DE VENTA ---
  // Chevrons « y »
  // Chevron amarillo izquierdo «
  doc.setTextColor(245, 197, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(44);
  doc.text('«', 36, 75);

  // 4-72 en azul marino de gran tamaño
  doc.setTextColor(10, 45, 115);
  doc.setFontSize(54);
  doc.text('4-72', 54, 76);

  // Chevron rojo derecho »
  doc.setTextColor(218, 37, 28);
  doc.setFontSize(44);
  doc.text('»', 114, 75);

  // Línea divisoria vertical amarilla
  doc.setDrawColor(245, 197, 24);
  doc.setLineWidth(1.6);
  doc.line(146, 36, 146, 118);

  // Texto PUNTO DE VENTA
  doc.setTextColor(10, 45, 115);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text('PUNTO DE VENTA', 156, 55);

  // Texto SERVICIOS POSTALES
  doc.setFontSize(14);
  doc.text('SERVICIOS POSTALES', 170, 72);

  // Barra tricolor centrada
  doc.setFillColor(245, 197, 24); // Amarillo
  doc.rect(173, 85, 14, 3.5, 'F');
  doc.setFillColor(14, 88, 189); // Azul
  doc.rect(187, 85, 16, 3.5, 'F');
  doc.setFillColor(218, 37, 28); // Rojo
  doc.rect(203, 85, 14, 3.5, 'F');

  // --- SECCIÓN INFERIOR: EXPENDIO ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(10, 45, 115);
  doc.text('EXPENDIO:', 32, 155);

  // Línea azul de subrayado para el nombre
  doc.setDrawColor(10, 45, 115);
  doc.setLineWidth(1.2);
  doc.line(84, 158, pageWidth - 32, 158);

  // Nombre del expendio / municipio
  const rawNombre = (expendio.localidad || expendio.municipio || 'EXPENDIO AUTORIZADO 4-72').toUpperCase();
  const munNombre = (expendio.municipio && expendio.municipio.toUpperCase() !== rawNombre) ? ` - ${expendio.municipio.toUpperCase()}` : '';
  const expendioCompleto = `${rawNombre}${munNombre}`;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(10, 45, 115);
  doc.text(expendioCompleto, 88, 153);

  const safeMun = (expendio.municipio || '472').replace(/\s+/g, '_');
  const fileName = `Aviso_472_Punto_Venta_${safeMun}.pdf`;
  doc.save(fileName);
}

/**
 * Genera el documento legal completo de 13 páginas:
 * "CONTRATO DE PRESTACIÓN DE SERVICIOS"
 * Conforme a la minuta contractual oficial adjunta:
 * - Página 1: Cuadro con CONTRATANTE (CAMARCA S.A.S.), CONTRATISTA (expendio), OBJETO, VALOR, MUNICIPIO
 * - Páginas 1 a 12: Cláusulas PRIMERA a TRIGÉSIMA SEGUNDA completas y exactas
 * - Página 13: Bloque de firmas oficial con MAURICIO PARDO MESA y datos del CONTRATISTA
 */
export async function generateContratoServiciosPDF(expendio: ExpendioData): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4', // 210 x 297 mm
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 22;
  const contentWidth = pageWidth - marginX * 2; // 166 mm

  const contratistaNombre = (expendio.encargado || 'CONTRATISTA AUTORIZADO').toUpperCase();
  const contratistaCedula = (expendio.cedula || 'SIN CÉDULA').toUpperCase();
  const contratistaMunicipio = (expendio.municipio || expendio.localidad || 'SANTANDER').toUpperCase();
  const contratistaTelefono = (expendio.telefonoPunto || '').toUpperCase();
  const contratistaDireccion = (expendio.direccionPunto || '').toUpperCase();

  let currentPage = 1;
  const totalPages = 13;

  const renderFooter = (pNum: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(`Contrato de Prestación de Servicios - CAMARCA S.A.S. / Expendio 4-72`, marginX, pageHeight - 12);
    doc.text(`Página ${pNum} de ${totalPages}`, pageWidth - marginX, pageHeight - 12, { align: 'right' });
  };

  // ==========================================
  // PÁGINA 1: INFORMACIÓN CONTRATO & PARTES
  // ==========================================
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text('CONTRATO DE PRESTACIÓN DE SERVICIOS', pageWidth / 2, 25, { align: 'center' });

  doc.setFontSize(9);
  doc.text('I.     INFORMACIÓN CONTRATO DE PRESTACIÓN DE SERVICIOS', marginX, 35);

  // Tabla con bordes
  let tableY = 40;
  const col1Width = 60;
  const col2Width = contentWidth - col1Width;

  const rows = [
    { label: 'CONTRATANTE:', value: 'CAMARCA S.A.S.' },
    { label: 'REPRESENTANTE LEGAL:', value: 'MAURICIO PARDO MESA' },
    { label: 'NIT:', value: '900.504.241-7' },
    { label: 'DOMICILIO CONTRATANTE:', value: 'Carrera 50 # 119 - 10, Bogotá D.C.' },
    { label: 'NOMBRE DEL CONTRATISTA:', value: contratistaNombre },
    { label: 'ID. CONTRATISTA:', value: contratistaCedula },
    {
      label: 'OBJETO:',
      value: 'Desarrollar actividades de recolección, distribución y devolución de paquetería y sobres designados en las rutas establecidas, en el municipio relacionado en el presente contrato, como también publicar la lista de correo, instalar o publicar el letrero, aviso corporativo, tarifas, horario y demás papelería que sea solicitado, conforme a las indicaciones del CONTRATANTE garantizando la adecuada prestación del servicio',
    },
    {
      label: 'VALOR:',
      value: '($ 121.200) CIENTO VEINTIUN MIL DOSCIENTOS PESOS M/CTE\n\nNOTA: Si el contratista presta personalmente el servicio de admisión de correo, el contratante realizará el pago por subsidio de internet por valor de OCHENTA MIL PESOS M/CTE ($80.000), no obstante, en aras de establecer el subsidio a cancelar, se validará con el reporte generado por parte de Servicios Postales Nacionales S.A.S, en aras de corroborar la información.',
    },
    {
      label: 'MUNICIPIO /CORREGIMIENTO /\nINSPECCIÓN',
      value: contratistaMunicipio,
    },
  ];

  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.3);

  rows.forEach((row) => {
    const isObjeto = row.label === 'OBJETO:';
    const isValor = row.label === 'VALOR:';
    const isMun = row.label.includes('MUNICIPIO');
    const rowHeight = isObjeto ? 32 : isValor ? 38 : isMun ? 14 : 9;

    doc.rect(marginX, tableY, col1Width, rowHeight);
    doc.rect(marginX + col1Width, tableY, col2Width, rowHeight);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(row.label, marginX + 3, tableY + 5);

    doc.setFont('helvetica', isObjeto || isValor ? 'normal' : 'bold');
    doc.setFontSize(8);
    const splitVal = doc.splitTextToSize(row.value, col2Width - 6);
    doc.text(splitVal, marginX + col1Width + 3, tableY + 5);

    tableY += rowHeight;
  });

  // II. PARTES
  tableY += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('II.     PARTES', marginX, tableY);

  tableY += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const partesTxt = `Entre los suscritos a saber CAMARCA S.A.S. sociedad identificada con el NIT 900.504.241-7, matrícula mercantil Nro. 02188494, según consta en el certificado de existencia y representación legal, representada legamente por MAURICIO PARDO MESA, identificado con cédula de ciudadanía 79.467.353, quien para efectos de este contrato se denominará el “CONTRATANTE” por una parte y por otra “EL CONTRATISTA” previamente identificado en el cuadro superior, hemos convenido celebrar la presente contrato de Prestación de Servicios, conforme a las siguientes cláusulas.`;
  const splitPartes = doc.splitTextToSize(partesTxt, contentWidth);
  doc.text(splitPartes, marginX, tableY);

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 2: CLÁUSULAS 1 A 3 (Forma de pago & Tarifas)
  // ==========================================
  doc.addPage();
  currentPage = 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('III.     CLÁUSULAS', marginX, 25);

  let y = 33;
  const printClause = (title: string, text: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(title, marginX, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const split = doc.splitTextToSize(text, contentWidth);
    doc.text(split, marginX, y);
    y += split.length * 3.8 + 4;
  };

  printClause(
    'PRIMERA. OBJETO.',
    'EL CONTRATISTA se obliga para con el CONTRATANTE a desarrollar actividades de recolección, distribución y devolución de paquetería y sobres designados en las rutas establecidas, en el municipio relacionado en el presente contrato, como también publicar la lista de correo, conforme a las indicaciones del CONTRATANTE garantizando la adecuada prestación del servicio.'
  );

  printClause(
    'SEGUNDA. VALOR DEL CONTRATO.',
    'El valor del presente contrato es de una suma fija mensual de: ($ 121.200) CIENTO VEINTIUN MIL DOSCIENTOS PESOS M/CTE\n\nNOTA: Si el contratista presta personalmente el servicio de admisión de correo, el contratante realizará el pago por subsidio de internet por valor de OCHENTA MIL PESOS M/CTE ($80.000), no obstante, en aras de establecer el subsidio a cancelar, se validará con el reporte generado por parte de Servicios Postales Nacionales S.A.S en aras de corroborar la información.'
  );

  printClause(
    'TERCERA. FORMA DE PAGO:',
    'El presente contrato está compuesto por una suma fija, EL CONTRATANTE cancelará en pagos mensuales vencidos, durante el término de ejecución del presente contrato, previo el cumplimiento de la obligación del CONTRATISTA de relacionar y presentar los siguientes documentos, que deben contar con aprobación por parte del CONTRATANTE para que se acredite el pago:\n\n' +
      '1. Presentación de cuenta de cobro o documento equivalente que cumpla con los requisitos de ley.\n' +
      '2. Presentación de informe de cumplimiento de actividades y obligaciones ante el Coordinador Regional asignado por EL CONTRATANTE.\n' +
      '3. Certificación de cumplimiento firmada por el Coordinador Regional asignado por EL CONTRATANTE.\n' +
      '4. Soporte que acredite los aportes al Sistema de Seguridad Social. (SI APLICA)\n' +
      '5. Informe de supervisión.\n' +
      '6. Registro fotográfico de los puntos de atención que evidencie la correcta disposición de los elementos mínimos requeridos para la prestación de los servicios por medio magnético.\n\n' +
      'PARÁGRAFO PRIMERO: El pago de los envíos que se distribuyan por lista de correo, se cancelarán conforme a las siguientes tarifas: Por prueba de entrega cumplida $600 | De paquetería mayor a 2kg $1.200 | Por prueba de entrega envíos masivo $310 | Devolución causal "no reclamado" $150 | Por cada envío admitido licencia de crédito $490.\n\n' +
      'PARÁGRAFO SEGUNDO. El pago se realizará dentro de los TREINTA (30) días hábiles siguientes a la aprobación de los documentos previamente mencionados, dicho término sólo se empezará a contar, una vez los documentos hayan sido presentados en debida forma y aprobados y por mensualidades vencidas.'
  );

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 3: CLÁUSULAS 3 (Cont.) A 6 (Obligaciones 1-4)
  // ==========================================
  doc.addPage();
  currentPage = 3;
  y = 25;

  printClause(
    'PARÁGRAFO TERCERO:',
    'El contratista deberá discriminar en la cuenta de cobro los siguientes ítems: Valor del cargo Básico, subsidio de internet (si aplica); gestión de las piezas postales entregadas y/o retorno de listas de correo (si aplica); retención (si aplica) y el valor neto a pagar.'
  );

  printClause(
    'PARÁGRAFO CUARTO:',
    'La no entrega del acuse de recibo y/o pruebas de entrega, dará lugar al no pago del valor correspondiente del mismo.'
  );

  printClause(
    'CUARTA. APORTES A SEGURIDAD SOCIAL.',
    'El CONTRATISTA asumirá los pagos correspondientes al Sistema General de Seguridad Social, entendiéndose Salud, Pensión y Riesgos Laborales, conforme lo determina la normatividad vigente. El soporte de los aportes al SGSS será requisito esencial para el pago de los honorarios y deberá presentarse en los tiempos correspondientes.\n\n' +
      'PARÁGRAFO PRIMERO. Conforme a lo establecido por el Decreto 3032 de 2013 artículo 9 parágrafo único, la obligación de verificar que los aportes al Sistema General de Seguridad Social estén realizados de acuerdo con los ingresos obtenidos en el contrato, se exceptúa cuando la totalidad de los pagos mensuales sean inferiores a un salario mínimo legal mensual vigente (1 smlmv).'
  );

  printClause(
    'QUINTA. TÉRMINO:',
    'El presente contrato de Prestación de Servicios se ejecutará por un término de (6) seis meses y/o hasta el agotamiento de los recursos lo que primero ocurra, contados a partir de la firma del presente contrato. El término inicial pactado podrá ser prorrogado por acuerdo expreso suscrito entre las partes, previa aprobación y requerimiento del CONTRATANTE.\n\n' +
      'PARÁGRAFO PRIMERO. EL CONTRATANTE se reserva la facultad unilateral de modificar el presente término según el cronograma de actividades o servicios fijado por el mismo.'
  );

  printClause(
    'SEXTA. OBLIGACIONES DE EL CONTRATISTA.',
    'EL CONTRATISTA sin perjuicio de las demás obligaciones que emanan de la Ley y del contrato se obliga como mínimo con EL CONTRATANTE en ejecución del presente contrato a:\n\n' +
      '1) Prestar el servicio de admisión y entrega de correo por medio de la herramienta de distribución denominada, lista de correo, de todos los servicios públicos contemplados en el Servicio Postal Universal.\n' +
      '2) Contar con un establecimiento comercial en el que no se desarrollen actividades de venta y manipulación de alimentos.\n' +
      '3) Admitir los servicios públicos postales contenidos en el Servicio Postal Universal, sin seguro con destino a los lugares establecidos del territorio nacional e internacional atendiendo las especificaciones de peso y dimensiones, estipulados, además de las proferidas por las organizaciones internacionales postales que tenga acuerdos vigentes con Colombia, igualmente podrán prestar aquellos servicios adicionales que EL CONTRATANTE autorice.\n' +
      '4) Admitir los servicios públicos postales con destino a cualquier lugar del territorio nacional o internacional atendiendo las especificaciones de peso (Max 30 Kg Nacional 20 kg internacional) y dimensiones (la sumatoria de sus lados no supere los 3 metros).'
  );

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 4: OBLIGACIONES 5 A 23
  // ==========================================
  doc.addPage();
  currentPage = 4;
  y = 25;

  printClause(
    'SEXTA. OBLIGACIONES DE EL CONTRATISTA (Continuación):',
    '5) Comercializar en los locales previamente autorizados por EL CONTRATANTE, los servicios postales que demanden exclusivamente los usuarios, donde se indique nombre del expendio, lugar y fecha de imposición del envío.\n' +
      '6) Permitir y colaborar con la práctica de las visitas del supervisor o revisión que hiciere EL CONTRATANTE a través de los funcionarios delegados para el efecto, sin que ello afecte o modifique la autonomía técnica y directiva de EL CONTRATISTA en la ejecución del servicio materia del presente contrato.\n' +
      '7) Adquirir las estampillas en las Oficinas Postales asignadas como Centros Operativos y/o en la dependencia de EL CONTRATANTE previamente autorizada.\n' +
      '8) Abstenerse de vender, enajenar o reutilizar las especies postales sea cual fuere la razón para ello.\n' +
      '9) Recibir y franquear todos los servicios de correo mediante las modalidades autorizadas en la normatividad vigente.\n' +
      '10) Mantener en los establecimientos suficientes especies (estampillas) postales para atender la demanda de imposición de envíos de acuerdo al promedio semanal de ventas de servicios de correo del SPU.\n' +
      '11) Administrar y conservar los elementos entregados en calidad de comodato precario por EL CONTRATANTE para la prestación del servicio de correo en el establecimiento de comercio, de acuerdo con el inventario que se le entregue.\n' +
      '12) Suscribir acta de entrega de elementos junto con el correspondiente inventario.\n' +
      '13) Realizar devolución de los elementos entregados por Servicios Postales Nacionales al finalizar la ejecución de este contrato.\n' +
      '14) Responder a EL CONTRATANTE previa investigación por los envíos que sufran algún tipo de avería, pérdida o expoliación.\n' +
      '15) Atender o reportar a EL CONTRATANTE cualquier reclamo realizado por los clientes.\n' +
      '16) Cumplir con los protocolos de admisión y procedimientos operativos vigentes de EL CONTRATANTE.\n' +
      '17) Ubicar en un lugar visible al público las tarifas vigentes, horario, afiches de prohibida circulación, tiempos de entrega y todo material publicitario suministrado.\n' +
      '18) Realizar un buen diligenciamiento de los formatos o documentos establecidos por EL CONTRATANTE.\n' +
      '19) Realizar el mismo día de su recepción, la entrega de todos los envíos a los circuitos de recolección establecido por EL CONTRATANTE.\n' +
      '20) Garantizar la seguridad de los envíos evitando expoliaciones, averías o pérdidas.\n' +
      '21) Capacitar y divulgar cualquier comunicado o información emitido por Servicios Postales Nacionales S.A.S.\n' +
      '22) Garantizar todas las actividades derivadas, inherentes y necesarias para el desarrollo del objeto contractual (concesión 010 de 2004).\n' +
      '23) Cuando EL CONTRATISTA haga un cambio de personal, números telefónicos, direcciones y horarios en el expendio debe informar de manera inmediata con registros fotográficos.'
  );

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 5: OBLIGACIONES 24 A 43
  // ==========================================
  doc.addPage();
  currentPage = 5;
  y = 25;

  printClause(
    'SEXTA. OBLIGACIONES DE EL CONTRATISTA (Continuación):',
    '24) Cuando EL CONTRATISTA haga un traslado de expendio, debe soportar el recibido de los elementos del punto con acta de entrega.\n' +
      '25) Notificar de manera inmediata al supervisor delegado el cierre de los puntos de atención y actualizar la base de datos.\n' +
      '26) Dar apertura a un punto de atención reportado con novedad de cierre en un término máximo de 5 días hábiles.\n' +
      '27) Capacitar a los encargados de los expendios cuando existan cambios de personal.\n' +
      '28) Cancelar en los 8 días siguientes a los encargados de los expendios una vez recibido el pago de Servicios Postales Nacionales S.A.S.\n' +
      '29) Ser el único responsable de realizar todos los pagos respectivos a la operación de los expendios.\n' +
      '30) Permitir auditorías en el establecimiento y reportar información requerida con eficacia y prontitud.\n' +
      '31) Cumplir con los procedimientos operativos vigentes de EL CONTRATANTE.\n' +
      '32) Informar anomalías operativas (transporte, faltantes/sobrantes de envíos, expoliaciones).\n' +
      '33) Expender al público usuario del servicio las especies postales provistas conforme a las normas vigentes.\n' +
      '34) Facturar a los clientes los servicios según tarifas vigentes establecidas.\n' +
      '35) Aceptar, utilizar y conservar los elementos publicitarios que EL CONTRATANTE le suministre.\n' +
      '36) Sellar correspondencia y otros envíos postales admitidos a los clientes con especies postales oficiales.\n' +
      '37) Diligenciar correctamente el valor y el número de seguimiento de guía y/o sticker.\n' +
      '38) Adoptar y hacer uso del sistema que EL CONTRATANTE defina para la admisión de envíos postales (SIPOST).\n' +
      '39) Ejercer el cuidado y vigilancia sobre los objetos postales de los usuarios.\n' +
      '40) Asegurar el correcto manejo y continuidad de la numeración de guías y stickers entregados.\n' +
      '41) Facturar la totalidad de los servicios a los que alude este contrato.\n' +
      '42) Devolver a la finalización del contrato el material, objetos postales y documentos pertenecientes a EL CONTRATANTE.\n' +
      '43) Disponer de medios de comunicación para la correcta ejecución del presente contrato.'
  );

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 6: OBLIGACIONES 44 A 65
  // ==========================================
  doc.addPage();
  currentPage = 6;
  y = 25;

  printClause(
    'SEXTA. OBLIGACIONES DE EL CONTRATISTA (Continuación):',
    '44) Ubicar en un lugar visible las tarifas vigentes, horario y avisos informativos o publicitarios.\n' +
      '45) Recepcionar los envíos postales bajo franquicia postal y/o licencia de crédito.\n' +
      '46) Verificar cantidades físicas con respecto a las planillas de envío.\n' +
      '47) Realizar y aceptar los cambios pertinentes de publicidad o imagen de marca de SERVICIOS POSTALES NACIONALES S.A.S.\n' +
      '48) Asignar un espacio mínimo de 2 metros cuadrados para la imagen y publicidad corporativa.\n' +
      '49) Iniciar la operación única y exclusivamente tras contar con los elementos y la capacitación requerida.\n' +
      '50) Elaborar y publicar diariamente la lista de destinatarios de correo por 20 a 30 días.\n' +
      '51) Pegar stickers en planilla original y en cada envío registrando en las 4 copias el número asignado.\n' +
      '52) Devolver al cliente original con recibido, dar curso a dos copias al centro de control y archivar una copia.\n' +
      '53) Asumir la seguridad sobre los objetos postales confiados para evitar averías o pérdidas.\n' +
      '54) Custodiar envíos de lista de correo hasta su entrega o devolución oficial.\n' +
      '55) Entregar y hacer firmar la planilla de entrega de lista de correo.\n' +
      '56) Efectuar devolución al centro de control a los 30 días por causal no reclamada.\n' +
      '57) Gestionar contacto telefónico de ser necesario para la entrega a los destinatarios.\n' +
      '58) Retornar al centro de control dentro de 24 horas constancias de recibido y pruebas de entrega.\n' +
      '59) Reportar oportunamente informes y estadísticas solicitadas.\n' +
      '60) Utilizar la papelería oficial 4-72 para despachos.\n' +
      '61) Contar con un espacio en fachada para publicar el aviso de 4-72.\n' +
      '62) Recepcionar envíos crédito y pegar los stickers correspondientes.\n' +
      '63) Entregar comprobante de admisión con fecha, valor y sticker.\n' +
      '64) Garantizar estándares de calidad en la prestación del servicio.\n' +
      '65) Radicar en 4-72 la factura entre el 10 y 15 de cada mes con soportes contractuales.'
  );

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 7: OBLIGACIONES 66 A 80
  // ==========================================
  doc.addPage();
  currentPage = 7;
  y = 25;

  printClause(
    'SEXTA. OBLIGACIONES DE EL CONTRATISTA (Continuación):',
    '66) Garantizar acuerdo escrito con los encargados de puntos de atención para el cumplimiento contractual.\n' +
      '67) Discriminar en factura cantidades y valores a pagar según conceptos autorizados.\n' +
      '68) Atender de inmediato requerimientos del supervisor designado por EL CONTRATANTE.\n' +
      '69) Informar inconvenientes suscitados en la ejecución del servicio.\n' +
      '70) Asistir obligatoriamente a capacitaciones y reuniones convocadas.\n' +
      '71) Devolver al término del contrato materiales, correspondencia e implementos de la empresa.\n' +
      '72) Custodiar y responder por objetos postales recepcionados ante avería o expoliación.\n' +
      '73) Garantizar conexión a internet y aplicativo SIPOST donde aplique la instalación.\n' +
      '74) Soportar la calibración autorizada de balanzas y elementos de medición.\n' +
      '75) Promocionar y mantener políticas publicitarias conforme a las directrices comerciales de la compañía.\n' +
      '76) Realizar aportes al Sistema de Seguridad Social Integral (Ley 100 de 1993, Ley 1150 de 2007) y anexar soportes de pago.\n' +
      '77) Garantizar el funcionamiento del Sistema Postal SIPOST para el reconocimiento del subsidio mensual correspondiente.\n' +
      '78) Utilizar estrictamente los lineamientos de marca e imagen autorizados para el punto Expendio.\n' +
      '79) Atender al público mínimo 8 horas diarias en franja de 7:00 a.m. a 9:00 p.m. de lunes a viernes.\n' +
      '80) Ejecutar las demás actividades inherentes y necesarias para el cumplimiento del objeto contractual.'
  );

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 8: OBLIGACIONES DEL CONTRATANTE & PROHIBICIONES
  // ==========================================
  doc.addPage();
  currentPage = 8;
  y = 25;

  printClause(
    'SÉPTIMA. OBLIGACIONES DEL CONTRATANTE.',
    'EL CONTRATANTE se compromete para con el CONTRATISTA a:\n' +
      '1. Pagar el valor fijado al CONTRATISTA según la forma de pago acordada.\n' +
      '2. Suministrar de forma oportuna la paquetería y sobres requeridos para la gestión.\n' +
      '3. Expedir las certificaciones a que haya lugar.\n' +
      '4. Las que EL CONTRATANTE considere necesarias para la correcta ejecución contractual.'
  );

  printClause(
    'OCTAVA. PROHIBICIONES DEL CONTRATISTA:',
    'EL CONTRATISTA se obliga a abstenerse de:\n' +
      '1) Reutilizar estampillas.\n' +
      '2) Recibir envíos sin su empaque respectivo.\n' +
      '3) Recibir envíos en mal estado o abiertos.\n' +
      '4) Recibir envíos con datos incompletos o ilegibles.\n' +
      '5) Aceptar envíos agrupados con una sola estampilla o sello para múltiples destinatarios.\n' +
      '6) Violar correspondencia (Ley 1369 de 2009 y Código Penal).\n' +
      '7) Utilizar estampillas en mal estado, rasgadas o deterioradas.\n' +
      '8) Divulgar a terceros el conocimiento adquirido en la ejecución contractual.\n' +
      '9) Aplicar tarifas distintas a las oficialmente vigentes.\n' +
      '10) No contar con el aprovisionamiento mínimo de especies postales.\n' +
      '11) Admitir envíos fuera del portafolio autorizado.\n' +
      '12) Realizar prácticas ilegales contrarias al régimen postal.\n' +
      '13) No retornar envíos cumplido el término de 30 días de publicación.\n' +
      '14) No despachar envíos el mismo día o al día siguiente de su admisión.\n' +
      '15) Acciones u omisiones imputables que perjudiquen la operación.\n\n' +
      'PARÁGRAFO PRIMERO. La no entrega de acuses de recibo o pruebas de entrega dará lugar al no pago del valor correspondiente.\n' +
      'PARÁGRAFO SEGUNDO. La lista anterior es enunciativa y cualquier contravención afectará el contrato con igual gravedad.'
  );

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 9: SUPERVISIÓN, MULTAS & CLÁUSULA PENAL
  // ==========================================
  doc.addPage();
  currentPage = 9;
  y = 25;

  printClause(
    'NOVENA. SUPERVISIÓN Y CONTROL.',
    'La supervisión y control del contrato estará a cargo de EL CONTRATANTE a través del supervisor asignado, facultado para suscribir actas, verificar el cumplimiento de obligaciones, requerir al contratista y solicitar liquidaciones o modificaciones.'
  );

  printClause(
    'DÉCIMA. SUSPENSIÓN DEL CONTRATO.',
    'Por circunstancias de fuerza mayor o caso fortuito, las partes podrán suspender temporalmente la ejecución del contrato mediante suscripción de acta respectiva.'
  );

  printClause(
    'DÉCIMA PRIMERA. MULTA.',
    'En caso de mora o incumplimiento parcial o total imputable al CONTRATISTA, este autoriza a EL CONTRATANTE a descontar los valores de los saldos pendientes por facturar.\n\n' +
      'PARÁGRAFO. En caso de incumplimiento sin porcentaje específico, LA EMPRESA descontará el cinco por ciento (5%) de la factura presentada por EL CONTRATISTA.'
  );

  printClause(
    'DÉCIMA SEGUNDA. CLÁUSULA PENAL.',
    'EL CONTRATISTA se obliga a pagar a EL CONTRATANTE una suma equivalente al diez por ciento (10%) del valor total del contrato a título de indemnización por perjuicios ocasionados por incumplimiento, exigible mediante compensación de saldos.'
  );

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 10: INDEMNIDAD, PROPIEDAD INDUSTRIAL & CONFIDENCIALIDAD
  // ==========================================
  doc.addPage();
  currentPage = 10;
  y = 25;

  printClause(
    'DÉCIMA TERCERA. INDEMNIDAD.',
    'EL CONTRATISTA mantendrá indemne y defenderá a su propio costo a EL CONTRATANTE de todo pleito, reclamación o demanda derivada de sus actos u omisiones en desarrollo del contrato.'
  );

  printClause(
    'DÉCIMA CUARTA. PROPIEDAD INDUSTRIAL.',
    'Las marcas, lemas y emblemas asociados a SERVICIOS POSTALES NACIONALES S.A.S. y CAMARCA S.A.S. son de sus respectivos titulares y su uso se restringe exclusivamente al cumplimiento del objeto contractual sin otorgar derecho sobre las mismas.'
  );

  printClause(
    'DÉCIMA QUINTA. AUTORIZACIÓN DE DESCUENTO.',
    'EL CONTRATISTA autoriza expresamente e irrevocablemente a EL CONTRATANTE para deducir de cualquier saldo a su favor las obligaciones económicas causadas por daños, sanciones o perjuicios en cualquier tiempo.'
  );

  printClause(
    'DÉCIMA SEXTA. CONFIDENCIALIDAD.',
    'Las partes guardarán estricta reserva de toda la información técnica, operativa o comercial que conozcan, prohibiéndose su divulgación a terceros hasta dos meses después de terminado el contrato.'
  );

  printClause(
    'DÉCIMA SÉPTIMA. MÉRITO EJECUTIVO.',
    'Las partes reconocen que el presente contrato y sus liquidaciones prestan mérito ejecutivo pleno para exigir el cumplimiento de obligaciones dinerarias y de hacer.'
  );

  printClause(
    'DÉCIMA OCTAVA. INVALIDEZ E INEFICACIA PARCIAL.',
    'Si alguna disposición fuere declarada nula o ineficaz, no afectará la validez del resto del contrato, el cual se mantendrá vigente en todos sus efectos.'
  );

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 11: DATOS PERSONALES, NO COMPETENCIA & EXENCIÓN LABORAL
  // ==========================================
  doc.addPage();
  currentPage = 11;
  y = 25;

  printClause(
    'DÉCIMA NOVENA. PROTECCIÓN DE DATOS PERSONALES.',
    'EL CONTRATISTA se obliga a cumplir la Ley Estatutaria 1581 de 2012 y el Decreto 1377 de 2013 en el tratamiento y confidencialidad de los datos personales a los que tenga acceso.'
  );

  printClause(
    'VIGÉSIMA. NO COMPETENCIA.',
    'EL CONTRATISTA no podrá promover en el municipio contractual servicios de compañías competidoras del CONTRATANTE en la prestación del servicio postal.'
  );

  printClause(
    'VIGÉSIMA PRIMERA. EXENCIÓN LABORAL.',
    'Se deja expresa constancia de que la celebración del presente contrato no vincula laboralmente a las partes, ni otorga derecho a salarios o prestaciones sociales.\n\n' +
      'PARÁGRAFO: EL CONTRATISTA declara y garantiza que actúa de manera autónoma e independiente, sin subordinación laboral con CAMARCA S.A.S.'
  );

  printClause(
    'VIGÉSIMA SEGUNDA. TERMINACIÓN.',
    'EL CONTRATANTE podrá terminar anticipadamente el contrato por escrito en cualquier momento sin lugar a indemnización, cancelando únicamente honorarios causados a la fecha, o por causales como mutuo acuerdo, incumplimiento, mala calidad del servicio, retraso reiterado en envíos o falta de digitalización.'
  );

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 12: CESIÓN, CUSTODIA & POLÍTICAS SG-SST
  // ==========================================
  doc.addPage();
  currentPage = 12;
  y = 25;

  printClause(
    'VIGÉSIMA TERCERA. CESIÓN.',
    'El presente contrato es intuito personae y no es susceptible de cesión sin autorización previa y escrita del CONTRATANTE.'
  );

  printClause(
    'VIGÉSIMA CUARTA. SOLUCIÓN DE CONTROVERSIAS.',
    'Las diferencias se resolverán de común acuerdo mediante arreglo directo o transacción.'
  );

  printClause(
    'VIGÉSIMA QUINTA. TOTAL ENTENDIMIENTO.',
    'Las partes manifiestan conocer y aceptar todas y cada una de las cláusulas y anexos del presente acuerdo contractual.'
  );

  printClause(
    'VIGÉSIMA SEXTA. CONVENIO COMPLETO.',
    'Este instrumento sustituye cualquier conversación, entendimiento o acuerdo verbal o escrito previo.'
  );

  printClause(
    'VIGÉSIMA SÉPTIMA. ACUERDO DE CUSTODIA.',
    'EL CONTRATISTA custodiará todo material confiado bajo máxima fidelidad, advirtiéndose las responsabilidades del Art. 249 del Código Penal por abuso de confianza.'
  );

  printClause(
    'VIGÉSIMA OCTAVA. POLÍTICAS SG-SST.',
    'EL CONTRATISTA deja constancia de haber recibido la inducción y lineamientos del Sistema de Gestión de Seguridad y Salud en el Trabajo de CAMARCA S.A.S.'
  );

  printClause(
    'VIGÉSIMA NOVENA. PERFECCIONAMIENTO.',
    'El contrato se perfecciona válidamente con la firma de las partes.'
  );

  renderFooter(currentPage);

  // ==========================================
  // PÁGINA 13: DOMICILIO, PAZ Y SALVO & FIRMAS OFICIALES
  // ==========================================
  doc.addPage();
  currentPage = 13;
  y = 25;

  printClause(
    'TRIGÉSIMA. DOMICILIO:',
    'Para todos los efectos legales el domicilio contractual será la ciudad de Bogotá D.C.'
  );

  printClause(
    'TRIGÉSIMA PRIMERA. PAZ Y SALVO POR TODO CONCEPTO:',
    'Las partes acuerdan y declaran irrevocablemente que no existe deuda pendiente anterior a la suscripción del presente documento.'
  );

  printClause(
    'TRIGÉSIMA SEGUNDA. DEROGATORIA:',
    'El presente contrato deja sin efecto cualquier convenio previo entre las partes.'
  );

  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Las partes en señal de entendimiento y acuerdo firman en dos ejemplares del mismo tenor y valor.', marginX, y);

  // Bloque de Firmas
  y += 28;

  // Firma Contratante
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.4);
  doc.line(marginX, y, marginX + 75, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('EL CONTRATANTE', marginX, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('NOMBRE: MAURICIO PARDO MESA', marginX, y + 10);
  doc.text('C.C. No. 79.467.353', marginX, y + 14);
  doc.text('CAMARCA S.A.S.', marginX, y + 18);
  doc.text('NIT. 900.504.241-7', marginX, y + 22);

  // Firma Contratista Personalizada con datos del expendio
  y += 38;
  doc.line(marginX, y, marginX + 90, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('EL CONTRATISTA', marginX, y + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(`NOMBRE: ${contratistaNombre}`, marginX, y + 10);
  doc.text(`C.C. No.: ${contratistaCedula}`, marginX, y + 14);
  doc.setFont('helvetica', 'normal');
  doc.text(`Celular: ${contratistaTelefono || 'POR DILIGENCIAR'}`, marginX, y + 18);
  doc.text(`Dirección (Domicilio): ${contratistaDireccion || 'POR DILIGENCIAR'}`, marginX, y + 22);
  doc.text(`Municipio: ${contratistaMunicipio}`, marginX, y + 26);

  renderFooter(currentPage);

  const safeName = contratistaNombre.replace(/[^A-Za-z0-9]/g, '_').substring(0, 20);
  const fileName = `Contrato_Prestacion_Servicios_${safeName}_${contratistaCedula}.pdf`;
  doc.save(fileName);
}

/**
 * Genera la cartelera reglamentaria oficial "TARIFAS SERVICIOS SPU - Versión: 01-2026"
 * Conforme al modelo oficial MINTIC y 4-72 adjuntado por el usuario:
 * - Cabecera azul oscuro: "TARIFAS SERVICIOS SPU" - Versión: 01-2026 Vigilado y Controlado MINTIC
 * - Logotipo institucional 4-72
 * - Identificación oficial del Expendio (Municipio, Encargado, Cédula, Dirección)
 * - Tabla completa de SERVICIOS DE CORREO NACIONAL CON CERTIFICACIÓN (Rangos de peso 0g a 2000g, Urbano, Regional, Nacional, Trayecto Especial)
 * - Tabla completa de SERVICIOS DE CORREO NACIONAL SIN CERTIFICACIÓN
 * - Instructivo MinTIC (Resolución 4114/2023) y Matriz de Tiempos de Tránsito
 * - Tarifas de Correo Internacional (Zonas A, B, C, D, E, F)
 * - Cuadros reglamentarios de avisos obligatorios "¡IMPORTANTE!"
 */
export async function generateTarifarioPDF(expendio: ExpendioData): Promise<void> {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4', // 297 x 210 mm
  });

  const pageWidth = 297;
  const pageHeight = 210;

  // Fondo blanco limpio
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  // --- CABECERA PRINCIPAL SUPERIOR ---
  // Banda azul marino institucional superior
  doc.setFillColor(10, 37, 85);
  doc.rect(0, 0, pageWidth, 16, 'F');

  // Título grande "TARIFAS SERVICIOS SPU"
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text('TARIFAS SERVICIOS SPU', 14, 11);

  // Subtítulo de versión
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(220, 230, 255);
  doc.text('Versión: 01-2026  |  Vigilado y Controlado MinTIC', 105, 11);

  // Logotipo 4-72 a la derecha
  doc.setTextColor(234, 179, 8); // Amarillo
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('«', 255, 11);
  doc.setTextColor(255, 255, 255);
  doc.text('4-72', 261, 11);
  doc.setTextColor(220, 38, 38); // Rojo
  doc.text('»', 276, 11);

  // --- BANDA DE IDENTIFICACIÓN DEL EXPENDIO ---
  doc.setFillColor(241, 245, 249);
  doc.rect(0, 16, pageWidth, 8.5, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.line(0, 24.5, pageWidth, 24.5);

  const rawMun = (expendio.municipio || expendio.localidad || 'EXPENIDIO NACIONAL').toUpperCase();
  const rawEnc = (expendio.encargado || 'TITULAR AUTORIZADO').toUpperCase();
  const rawCed = expendio.cedula ? `C.C. ${expendio.cedula}` : '';
  const rawTel = expendio.telefonoPunto ? `Tel: ${expendio.telefonoPunto}` : '';
  const rawDir = expendio.direccionPunto ? `Dir: ${expendio.direccionPunto}` : '';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`EXPENDIO AUTORIZADO 4-72: ${rawMun}`, 14, 21.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85);
  doc.text(`Encargado: ${rawEnc} ${rawCed ? `| ${rawCed}` : ''} ${rawTel ? `| ${rawTel}` : ''} ${rawDir ? `| ${rawDir}` : ''}`, 105, 21.5);

  // --- ESTRUCTURA DE 2 COLUMNAS NACIONALES ---
  const col1X = 10;
  const colWidth = 135;
  const col2X = 152;

  // TABLA 1: CON CERTIFICACIÓN
  doc.setFillColor(14, 116, 144); // Azul cian / petróleo
  doc.roundedRect(col1X, 27, colWidth, 6, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text('SERVICIOS DE CORREO NACIONAL  -  CON CERTIFICACIÓN', col1X + 4, 31.2);

  // Sub-items
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(71, 85, 105);
  doc.text('• Correspondencia Prioritaria Certificada  • Correspondencia No Prioritaria Certificada  • Encomienda Certificada', col1X, 36);

  // Encabezados de tabla 1
  const t1Y = 38;
  doc.setFillColor(226, 232, 240);
  doc.rect(col1X, t1Y, colWidth, 4.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.setTextColor(15, 23, 42);
  doc.text('RANGO DE PESO', col1X + 2, t1Y + 3.2);
  doc.text('URBANO', col1X + 42, t1Y + 3.2);
  doc.text('REGIONAL', col1X + 66, t1Y + 3.2);
  doc.text('NACIONAL', col1X + 90, t1Y + 3.2);
  doc.text('TRAYECTO ESPECIAL', col1X + 112, t1Y + 3.2);

  // Filas Tabla 1 (Datos exactos de la resolución MINTIC 2026 del poster oficial)
  const rowsCert = [
    { peso: '0 a 20 g', u: '$10.100', r: '$15.500', n: '$16.900', e: '$24.700' },
    { peso: '21 a 50 g', u: '$11.000', r: '$16.800', n: '$18.500', e: '$26.800' },
    { peso: '51 a 100 g', u: '$12.300', r: '$18.900', n: '$20.700', e: '$30.000' },
    { peso: '101 a 150 g', u: '$13.700', r: '$20.900', n: '$23.100', e: '$33.500' },
    { peso: '151 a 200 g', u: '$15.100', r: '$23.000', n: '$25.400', e: '$36.800' },
    { peso: '201 a 250 g', u: '$16.500', r: '$25.100', n: '$27.700', e: '$40.100' },
    { peso: '251 a 350 g', u: '$18.600', r: '$28.300', n: '$31.300', e: '$45.400' },
    { peso: '351 a 500 g', u: '$21.500', r: '$32.800', n: '$36.200', e: '$52.500' },
    { peso: '501 a 750 g', u: '$24.800', r: '$37.900', n: '$41.800', e: '$60.600' },
    { peso: '751 a 1.000 g (1 Kg)', u: '$28.200', r: '$43.000', n: '$47.500', e: '$68.800' },
    { peso: '1.001 a 1.500 g', u: '$34.800', r: '$53.300', n: '$58.800', e: '$85.300' },
    { peso: '1.501 a 2.000 g (2 Kg)', u: '$41.500', r: '$63.600', n: '$70.200', e: '$101.800' },
  ];

  let currentY = t1Y + 4.5;
  rowsCert.forEach((row, i) => {
    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(col1X, currentY, colWidth, 3.8, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.line(col1X, currentY + 3.8, col1X + colWidth, currentY + 3.8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.setTextColor(30, 41, 59);
    doc.text(row.peso, col1X + 2, currentY + 2.8);

    doc.setFont('helvetica', 'normal');
    doc.text(row.u, col1X + 44, currentY + 2.8);
    doc.text(row.r, col1X + 68, currentY + 2.8);
    doc.text(row.n, col1X + 92, currentY + 2.8);
    doc.text(row.e, col1X + 114, currentY + 2.8);
    currentY += 3.8;
  });

  // TABLA 2: SIN CERTIFICACIÓN
  doc.setFillColor(15, 118, 110); // Teal oscuro
  doc.roundedRect(col2X, 27, colWidth, 6, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text('SERVICIOS DE CORREO NACIONAL  -  SIN CERTIFICACIÓN', col2X + 4, 31.2);

  // Sub-items
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(71, 85, 105);
  doc.text('• Correspondencia Prioritaria Normal  • Correspondencia No Prioritaria Normal  • Encomienda Normal', col2X, 36);

  // Encabezados de tabla 2
  doc.setFillColor(226, 232, 240);
  doc.rect(col2X, t1Y, colWidth, 4.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.setTextColor(15, 23, 42);
  doc.text('RANGO DE PESO', col2X + 2, t1Y + 3.2);
  doc.text('URBANO', col2X + 42, t1Y + 3.2);
  doc.text('REGIONAL', col2X + 66, t1Y + 3.2);
  doc.text('NACIONAL', col2X + 90, t1Y + 3.2);
  doc.text('TRAYECTO ESPECIAL', col2X + 112, t1Y + 3.2);

  // Filas Tabla 2
  const rowsSinCert = [
    { peso: '0 a 20 g', u: '$3.100', r: '$7.400', n: '$8.800', e: '$16.600' },
    { peso: '21 a 50 g', u: '$3.900', r: '$8.800', n: '$10.400', e: '$18.700' },
    { peso: '51 a 100 g', u: '$5.200', r: '$10.900', n: '$12.600', e: '$21.900' },
    { peso: '101 a 150 g', u: '$6.600', r: '$12.900', n: '$15.000', e: '$25.400' },
    { peso: '151 a 200 g', u: '$8.000', r: '$15.000', n: '$17.300', e: '$28.700' },
    { peso: '201 a 250 g', u: '$9.400', r: '$17.100', n: '$19.600', e: '$32.000' },
    { peso: '251 a 350 g', u: '$11.500', r: '$20.300', n: '$23.200', e: '$37.300' },
    { peso: '351 a 500 g', u: '$14.400', r: '$24.800', n: '$28.100', e: '$44.400' },
    { peso: '501 a 750 g', u: '$17.700', r: '$29.900', n: '$33.700', e: '$52.500' },
    { peso: '751 a 1.000 g (1 Kg)', u: '$21.100', r: '$35.000', n: '$39.400', e: '$60.700' },
    { peso: '1.001 a 1.500 g', u: '$27.700', r: '$45.300', n: '$50.700', e: '$77.200' },
    { peso: '1.501 a 2.000 g (2 Kg)', u: '$34.400', r: '$55.600', n: '$62.100', e: '$93.700' },
  ];

  let currentY2 = t1Y + 4.5;
  rowsSinCert.forEach((row, i) => {
    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(col2X, currentY2, colWidth, 3.8, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.line(col2X, currentY2 + 3.8, col2X + colWidth, currentY2 + 3.8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.setTextColor(30, 41, 59);
    doc.text(row.peso, col2X + 2, currentY2 + 2.8);

    doc.setFont('helvetica', 'normal');
    doc.text(row.u, col2X + 44, currentY2 + 2.8);
    doc.text(row.r, col2X + 68, currentY2 + 2.8);
    doc.text(row.n, col2X + 92, currentY2 + 2.8);
    doc.text(row.e, col2X + 114, currentY2 + 2.8);
    currentY2 += 3.8;
  });

  // --- SECCIÓN INFERIOR: INTERNACIONAL, ZONAS Y REGLAMENTACIÓN ---
  const bottomY = 92;

  // Cuadro 1: CORREO INTERNACIONAL (Izquierda)
  doc.setFillColor(239, 68, 68); // Rojo 4-72
  doc.roundedRect(col1X, bottomY, colWidth, 5.5, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text('SERVICIOS DE CORREO INTERNACIONAL (SPU) - CON Y SIN CERTIFICACIÓN', col1X + 4, bottomY + 3.8);

  // Zonas internacionales resumen
  const intY = bottomY + 7.5;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(col1X, intY, colWidth, 36, 1, 1, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(col1X, intY, colWidth, 36, 1, 1, 'D');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(15, 23, 42);
  doc.text('DEFINICIÓN DE ZONAS TARIFARIAS INTERNACIONALES:', col1X + 3, intY + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.2);
  doc.setTextColor(51, 65, 85);
  doc.text('• ZONA A: Ecuador, Panamá, Perú, Venezuela.', col1X + 3, intY + 9);
  doc.text('• ZONA B: Resto de Sudamérica, Centroamérica y Caribe.', col1X + 3, intY + 13.5);
  doc.text('• ZONA C: Norteamérica (Canadá, Costa Rica, México, Puerto Rico).', col1X + 3, intY + 18);
  doc.text('• ZONA D: Europa Occidental (España, Francia, Italia, Reino Unido, Alemania, etc.).', col1X + 3, intY + 22.5);
  doc.text('• ZONA E: Estados Unidos de América (todas las ciudades continentales).', col1X + 3, intY + 27);
  doc.text('• ZONA F: Asia, Europa Oriental, África y Oceanía.', col1X + 3, intY + 31.5);

  // Cuadro 2: ¡IMPORTANTE! Y REGLAMENTACIÓN MINISTERIAL (Derecha)
  doc.setFillColor(234, 179, 8); // Amarillo
  doc.roundedRect(col2X, bottomY, colWidth, 5.5, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(15, 23, 42);
  doc.text('¡IMPORTANTE! REGLAMENTACIÓN OFICIAL DE ENVÍOS (MINTIC RESOLUCIÓN 4114/2023)', col2X + 4, bottomY + 3.8);

  const regY = bottomY + 7.5;
  doc.setFillColor(254, 252, 232); // Amarillo suave
  doc.roundedRect(col2X, regY, colWidth, 36, 1, 1, 'F');
  doc.setDrawColor(254, 240, 138);
  doc.roundedRect(col2X, regY, colWidth, 36, 1, 1, 'D');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.setTextColor(113, 63, 18);
  doc.text('• DOCUMENTOS:', col2X + 3, regY + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.2);
  doc.text('Se entenderá por correspondencia toda comunicación escrita sobre papel o soporte físico de carácter actual y personal.', col2X + 22, regY + 4);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.text('• PAQUETES:', col2X + 3, regY + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.2);
  doc.text('Contendrán cosas, objetos o mercaderías con o sin valor comercial que no excedan las dimensiones y peso reglamentario.', col2X + 18, regY + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.text('• OBJETOS PROHIBIDOS:', col2X + 3, regY + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.2);
  doc.text('Estupefacientes, dinero en efectivo, joyas, explosivos, sustancias corrosivas o materiales biológicos.', col2X + 32, regY + 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.text('• DERECHOS DEL USUARIO:', col2X + 3, regY + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.2);
  doc.text('Derecho a guía de rastreo y prueba de entrega en envíos certificados. Tiempos contados a partir de la admisión.', col2X + 35, regY + 22);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.text('• ATENCIÓN AL CLIENTE:', col2X + 3, regY + 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.2);
  doc.text('Línea Nacional Gratuita 01 8000 111 210 | Bogotá (601) 472 2000 | www.4-72.com.co', col2X + 32, regY + 28);

  // --- SECCIÓN INFERIOR 3: MATRIZ DE TIEMPOS ESTIMADOS (ANCHO COMPLETO) ---
  const timesY = 139;
  doc.setFillColor(10, 37, 85);
  doc.roundedRect(col1X, timesY, pageWidth - 20, 5, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(255, 255, 255);
  doc.text('MATRIZ DE TIEMPOS DE TRÁNSITO Y ENTREGA SERVICIOS POSTALES NACIONALES SPU (DÍAS HÁBILES)', col1X + 4, timesY + 3.5);

  const tboxY = timesY + 6;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(col1X, tboxY, pageWidth - 20, 16, 1, 1, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(col1X, tboxY, pageWidth - 20, 16, 1, 1, 'D');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.4);
  doc.setTextColor(51, 65, 85);
  doc.text('• Ámbito Urbano: D+1 (Entrega al día siguiente hábil de la admisión en ciudades principales y cabeceras municipales).', col1X + 3, tboxY + 4);
  doc.text('• Ámbito Regional: D+2 a D+3 días hábiles entre municipios de un mismo departamento o corredor troncal.', col1X + 3, tboxY + 8);
  doc.text('• Ámbito Nacional: D+3 a D+5 días hábiles a nivel interdepartamental y ciudades intermedias.', col1X + 3, tboxY + 12);
  doc.text('• Trayectos Especiales / Zonas Difícil Acceso: D+5 a D+10 días hábiles según frecuencia fluvial, aérea o terrestre programada.', 150, tboxY + 4);
  doc.text('• Envíos Internacionales Salientes: Tránsito nacional hasta aeropuerto El Dorado (D+2) + tiempos del operador postal de destino.', 150, tboxY + 8);
  doc.text('• Reclamaciones y PQR: 10 días hábiles posteriores a la fecha programada de entrega conforme al Código Postal.', 150, tboxY + 12);

  // --- PIE DE PÁGINA REGLAMENTARIO ---
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(10, 196, pageWidth - 10, 196);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(10, 37, 85);
  doc.text('SERVICIOS POSTALES NACIONALES S.A.  -  4-72 LA RED POSTAL OFICIAL DE COLOMBIA', 14, 201);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(100, 116, 139);
  doc.text('Cartelera de exhibición obligatoria en punto de expendio autorizada por MinTIC conforme a la Ley 1369 de 2009. Prohibida su alteración.', 14, 204.5);

  doc.setFont('helvetica', 'bold');
  doc.text(`Expendio: ${rawMun}  |  Fecha de Emisión: 2026`, pageWidth - 65, 201);

  const safeMun = rawMun.replace(/[^A-Za-z0-9]/g, '_').substring(0, 15);
  const fileName = `Tarifas_Oficiales_Servicios_SPU_472_${safeMun}_2026.pdf`;
  doc.save(fileName);
}

