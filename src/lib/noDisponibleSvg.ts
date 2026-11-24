/**
 * Generador SVG de alta fidelidad en Blanco y Negro para implementos declarados
 * como "NO DISPONIBLE" por los expendios (Báscula, Aviso Exterior, Matasello Fechador).
 * Utiliza tipografías nativas de sistema (DejaVu Sans) para prevenir caracteres tofu (cuadros vacíos).
 */
export function generateNoDisponibleSvg(options: {
  itemSlot: string;
  itemLabel?: string;
  municipio: string;
  cedula: string;
  motivo?: string;
  fecha?: string;
}): string {
  const escapeXml = (str: string) =>
    String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const muniText = escapeXml((options.municipio || 'EXPENDIO').toUpperCase());
  const cleanCedula = escapeXml(options.cedula || '');
  const motivoText = escapeXml(
    (options.motivo || 'REPORTADO POR EL EXPENDIO COMO NO DISPONIBLE').toUpperCase().slice(0, 80)
  );
  const fechaText = escapeXml(options.fecha || new Date().toLocaleDateString('es-CO'));

  let labelText = options.itemLabel ? escapeXml(options.itemLabel) : '';
  if (!labelText) {
    if (options.itemSlot === 'fotoBasculaUrl') {
      labelText = 'BÁSCULA DIGITAL / PESO';
    } else if (options.itemSlot === 'fotoAvisoUrl') {
      labelText = 'LETRERO / AVISO EXTERIOR';
    } else {
      labelText = 'MATASELLO FECHADOR';
    }
  }

  let illustrationSvg = '';

  if (options.itemSlot === 'fotoBasculaUrl') {
    illustrationSvg = `
      <g id="illustration-bascula">
        <line x1="200" y1="375" x2="600" y2="375" stroke="#94A3B8" stroke-width="3" stroke-linecap="round"/>
        <rect x="250" y="360" width="30" height="15" rx="3" fill="#334155"/>
        <rect x="520" y="360" width="30" height="15" rx="3" fill="#334155"/>
        <path d="M 235 360 L 265 305 L 535 305 L 565 360 Z" fill="#E2E8F0" stroke="#1E293B" stroke-width="4" stroke-linejoin="round"/>
        <rect x="290" y="318" width="120" height="32" rx="4" fill="#0F172A"/>
        <text x="350" y="340" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="14" font-weight="bold" fill="#38BDF8" text-anchor="middle">0.000 kg</text>
        <circle cx="430" cy="334" r="5" fill="#64748B"/>
        <circle cx="450" cy="334" r="5" fill="#64748B"/>
        <text x="430" y="325" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="7" fill="#64748B" text-anchor="middle">TARE</text>
        <text x="450" y="325" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="7" fill="#64748B" text-anchor="middle">ZERO</text>
        <rect x="220" y="295" width="360" height="12" rx="3" fill="#94A3B8" stroke="#1E293B" stroke-width="3"/>
        <rect x="500" y="140" width="22" height="160" fill="#CBD5E1" stroke="#1E293B" stroke-width="3"/>
        <rect x="460" y="105" width="102" height="60" rx="6" fill="#1E293B" stroke="#0F172A" stroke-width="3"/>
        <rect x="470" y="115" width="82" height="40" rx="3" fill="#0284C7"/>
        <text x="511" y="142" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="18" font-weight="bold" fill="#FFFFFF" text-anchor="middle">0.00 kg</text>
        <g transform="translate(270, 185)">
          <rect x="0" y="0" width="130" height="110" rx="4" fill="#F1F5F9" stroke="#1E293B" stroke-width="3.5"/>
          <line x1="65" y1="0" x2="65" y2="110" stroke="#CBD5E1" stroke-width="12"/>
          <line x1="0" y1="55" x2="130" y2="55" stroke="#CBD5E1" stroke-width="12"/>
          <rect x="15" y="15" width="40" height="30" rx="2" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
          <line x1="20" y1="23" x2="48" y2="23" stroke="#64748B" stroke-width="2"/>
          <line x1="20" y1="30" x2="42" y2="30" stroke="#64748B" stroke-width="2"/>
          <line x1="20" y1="37" x2="50" y2="37" stroke="#64748B" stroke-width="2"/>
          <path d="M 85 85 L 85 65 L 80 70 M 85 65 L 90 70 M 98 85 L 98 65 L 93 70 M 98 65 L 103 70" stroke="#1E293B" stroke-width="2" stroke-linecap="round"/>
        </g>
      </g>`;
  } else if (options.itemSlot === 'fotoAvisoUrl') {
    illustrationSvg = `
      <g id="illustration-aviso">
        <line x1="120" y1="120" x2="680" y2="120" stroke="#E2E8F0" stroke-width="2" stroke-dasharray="20,15"/>
        <line x1="100" y1="180" x2="700" y2="180" stroke="#E2E8F0" stroke-width="2" stroke-dasharray="25,20"/>
        <line x1="120" y1="240" x2="680" y2="240" stroke="#E2E8F0" stroke-width="2" stroke-dasharray="30,15"/>
        <line x1="100" y1="300" x2="700" y2="300" stroke="#E2E8F0" stroke-width="2" stroke-dasharray="20,20"/>
        <line x1="120" y1="360" x2="680" y2="360" stroke="#E2E8F0" stroke-width="2" stroke-dasharray="25,15"/>
        <rect x="230" y="100" width="24" height="24" rx="4" fill="#334155"/>
        <circle cx="242" cy="112" r="4" fill="#94A3B8"/>
        <rect x="546" y="100" width="24" height="24" rx="4" fill="#334155"/>
        <circle cx="558" cy="112" r="4" fill="#94A3B8"/>
        <line x1="242" y1="124" x2="242" y2="165" stroke="#1E293B" stroke-width="8" stroke-linecap="round"/>
        <line x1="558" y1="124" x2="558" y2="165" stroke="#1E293B" stroke-width="8" stroke-linecap="round"/>
        <circle cx="310" cy="130" r="14" fill="#475569"/>
        <path d="M 302 144 L 290 162 L 330 162 Z" fill="#64748B"/>
        <line x1="310" y1="110" x2="310" y2="130" stroke="#1E293B" stroke-width="4"/>
        <circle cx="490" cy="130" r="14" fill="#475569"/>
        <path d="M 482 144 L 470 162 L 510 162 Z" fill="#64748B"/>
        <line x1="490" y1="110" x2="490" y2="130" stroke="#1E293B" stroke-width="4"/>
        <rect x="150" y="165" width="500" height="190" rx="12" fill="#0F172A" stroke="#1E293B" stroke-width="4"/>
        <rect x="162" y="177" width="476" height="166" rx="8" fill="#FFFFFF" stroke="#0F172A" stroke-width="3"/>
        <rect x="162" y="177" width="476" height="75" rx="8" fill="#0F172A"/>
        <rect x="162" y="244" width="476" height="8" fill="#475569"/>
        <g transform="translate(195, 192)">
          <rect x="0" y="0" width="44" height="44" rx="8" fill="#FFFFFF"/>
          <text x="22" y="32" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="28" font-weight="900" fill="#0F172A" text-anchor="middle">4</text>
          <text x="56" y="32" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="26" font-weight="900" fill="#FFFFFF">-</text>
          <text x="80" y="32" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="28" font-weight="900" fill="#FFFFFF">72</text>
          <text x="135" y="24" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="12" font-weight="bold" fill="#E2E8F0" letter-spacing="1">SERVICIOS POSTALES</text>
          <text x="135" y="40" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="11" font-weight="bold" fill="#94A3B8" letter-spacing="1">NACIONALES DE COLOMBIA</text>
        </g>
        <text x="400" y="286" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="22" font-weight="900" fill="#0F172A" text-anchor="middle" letter-spacing="3">EXPENDIO AUTORIZADO</text>
        <text x="400" y="318" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="13" font-weight="bold" fill="#475569" text-anchor="middle" letter-spacing="2">RED POSTAL OFICIAL DE COLOMBIA</text>
      </g>`;
  } else {
    illustrationSvg = `
      <g id="illustration-matasello">
        <line x1="120" y1="365" x2="680" y2="365" stroke="#94A3B8" stroke-width="3" stroke-linecap="round"/>
        <g transform="translate(170, 95)">
          <ellipse cx="70" cy="20" rx="32" ry="16" fill="#1E293B"/>
          <path d="M 52 28 C 50 50, 42 75, 40 100 L 100 100 C 98 75, 90 50, 88 28 Z" fill="#334155" stroke="#1E293B" stroke-width="3"/>
          <rect x="36" y="100" width="68" height="14" rx="3" fill="#64748B" stroke="#1E293B" stroke-width="2"/>
          <rect x="25" y="114" width="90" height="42" rx="4" fill="#E2E8F0" stroke="#1E293B" stroke-width="3"/>
          <rect x="33" y="120" width="16" height="30" rx="2" fill="#0F172A"/>
          <rect x="53" y="120" width="16" height="30" rx="2" fill="#0F172A"/>
          <rect x="73" y="120" width="16" height="30" rx="2" fill="#0F172A"/>
          <text x="41" y="139" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF" text-anchor="middle">2</text>
          <text x="61" y="139" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF" text-anchor="middle">8</text>
          <text x="81" y="139" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="10" font-weight="bold" fill="#FFFFFF" text-anchor="middle">10</text>
          <rect x="18" y="156" width="104" height="24" rx="3" fill="#64748B" stroke="#1E293B" stroke-width="3"/>
          <rect x="14" y="180" width="112" height="12" rx="2" fill="#0F172A"/>
          <ellipse cx="70" cy="196" rx="58" ry="7" fill="#CBD5E1"/>
        </g>
        <g transform="translate(420, 140)">
          <circle cx="100" cy="95" r="90" fill="none" stroke="#0F172A" stroke-width="4.5"/>
          <circle cx="100" cy="95" r="78" fill="none" stroke="#0F172A" stroke-width="1.8"/>
          <text x="100" y="42" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="13" font-weight="bold" fill="#0F172A" text-anchor="middle" letter-spacing="1">4-72 CORREOS</text>
          <text x="100" y="58" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="10" font-weight="bold" fill="#475569" text-anchor="middle" letter-spacing="1">COLOMBIA</text>
          <polygon points="35,95 38,87 47,87 40,82 43,74 35,79 27,74 30,82 23,87 32,87" fill="#0F172A" transform="translate(0, 10) scale(0.6)"/>
          <polygon points="35,95 38,87 47,87 40,82 43,74 35,79 27,74 30,82 23,87 32,87" fill="#0F172A" transform="translate(142, 10) scale(0.6)"/>
          <line x1="36" y1="80" x2="164" y2="80" stroke="#0F172A" stroke-width="2"/>
          <text x="100" y="101" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="18" font-weight="bold" fill="#0F172A" text-anchor="middle" letter-spacing="2">${fechaText}</text>
          <line x1="36" y1="110" x2="164" y2="110" stroke="#0F172A" stroke-width="2"/>
          <text x="100" y="132" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="11" font-weight="bold" fill="#0F172A" text-anchor="middle" letter-spacing="1">FECHADOR POSTAL</text>
          <text x="100" y="148" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="10" fill="#475569" text-anchor="middle" letter-spacing="1">ADMISION Y ENTREGA</text>
          <path d="M 198 60 Q 220 50, 245 60 T 290 60 T 330 60" fill="none" stroke="#0F172A" stroke-width="3" stroke-linecap="round"/>
          <path d="M 198 80 Q 220 70, 245 80 T 290 80 T 330 80" fill="none" stroke="#0F172A" stroke-width="3" stroke-linecap="round"/>
          <path d="M 198 100 Q 220 90, 245 100 T 290 100 T 330 100" fill="none" stroke="#0F172A" stroke-width="3" stroke-linecap="round"/>
          <path d="M 198 120 Q 220 110, 245 120 T 290 120 T 330 120" fill="none" stroke="#0F172A" stroke-width="3" stroke-linecap="round"/>
        </g>
      </g>`;
  }

  return `<svg width="800" height="600" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="600" fill="#FFFFFF"/>
    <rect x="18" y="18" width="764" height="564" rx="14" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="3" stroke-dasharray="10,6"/>
    <rect x="220" y="24" width="360" height="40" rx="8" fill="#0F172A"/>
    <text x="400" y="50" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="16" font-weight="bold" fill="#FFFFFF" text-anchor="middle" letter-spacing="2">ELEMENTO NO DISPONIBLE</text>

    ${illustrationSvg}

    <rect x="36" y="395" width="728" height="180" rx="12" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="2"/>
    <text x="400" y="430" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="22" font-weight="bold" fill="#0F172A" text-anchor="middle">${labelText}</text>
    <line x1="70" y1="445" x2="730" y2="445" stroke="#E2E8F0" stroke-width="1.5"/>
    <text x="400" y="475" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="16" font-weight="bold" fill="#1E293B" text-anchor="middle">EXPENDIO: ${muniText} | C.C. ${cleanCedula}</text>
    <text x="400" y="505" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="14" fill="#475569" text-anchor="middle">MOTIVO: ${motivoText}</text>
    <text x="400" y="540" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="12" font-weight="bold" fill="#64748B" text-anchor="middle" letter-spacing="1">CONSTANCIA OFICIAL DE NO DISPONIBILIDAD TEMPORAL O DEFINITIVA</text>
    <text x="400" y="560" font-family="DejaVu Sans, FreeSans, sans-serif" font-size="11" fill="#94A3B8" text-anchor="middle">REGISTRO AUDITABLE 4-72 • FECHA: ${fechaText}</text>
  </svg>`;
}
