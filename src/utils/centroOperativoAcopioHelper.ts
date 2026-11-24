/**
 * Helper y normalizador estándar de Centros Operativos y Centros de Acopio
 * Regional Oriente 4-72
 */

export const CANONICAL_CENTROS_OPERATIVOS = [
  'PO.ARAUCA',
  'PO.BUCARAMANGA',
  'PO.CUCUTA',
  'PO.SAN GIL',
  'PO.VALLEDUPAR',
] as const;

export type CentroOperativoCanonical = (typeof CANONICAL_CENTROS_OPERATIVOS)[number];

export const CANONICAL_CENTROS_ACOPIO = [
  'Arauca',
  'Aguachica',
  'Barrancabermeja',
  'Bucaramanga',
  'Málaga',
  'Ocaña',
  'Cúcuta',
  'San Gil',
  'Valledupar',
] as const;

export type CentroAcopioCanonical = (typeof CANONICAL_CENTROS_ACOPIO)[number];

// Mapa de Centro de Acopio a su Centro Operativo correspondiente
export const ACOPIO_TO_OPERATIVO_MAP: Record<string, CentroOperativoCanonical> = {
  ARAUCA: 'PO.ARAUCA',
  AGUACHICA: 'PO.VALLEDUPAR',
  VALLEDUPAR: 'PO.VALLEDUPAR',
  BARRANCABERMEJA: 'PO.BUCARAMANGA',
  BUCARAMANGA: 'PO.BUCARAMANGA',
  MALAGA: 'PO.BUCARAMANGA',
  MÁLAGA: 'PO.BUCARAMANGA',
  CUCUTA: 'PO.CUCUTA',
  CÚCUTA: 'PO.CUCUTA',
  OCANA: 'PO.CUCUTA',
  OCAÑA: 'PO.CUCUTA',
  SANGIL: 'PO.SAN GIL',
  'SAN GIL': 'PO.SAN GIL',
};

// Diccionario exhaustivo de Municipios a Centro de Acopio y Centro Operativo
export const MUNICIPIO_CENTROS_MAP: Record<string, { acopio: CentroAcopioCanonical; operativo: CentroOperativoCanonical }> = {
  // Arauca (PO.ARAUCA)
  ARAUCA: { acopio: 'Arauca', operativo: 'PO.ARAUCA' },
  ARAUQUITA: { acopio: 'Arauca', operativo: 'PO.ARAUCA' },
  'CRAVO NORTE': { acopio: 'Arauca', operativo: 'PO.ARAUCA' },
  CUBARA: { acopio: 'Arauca', operativo: 'PO.ARAUCA' },
  CUBARÁ: { acopio: 'Arauca', operativo: 'PO.ARAUCA' },
  FORTUL: { acopio: 'Arauca', operativo: 'PO.ARAUCA' },
  'PUERTO RONDON': { acopio: 'Arauca', operativo: 'PO.ARAUCA' },
  'PUERTO RONDÓN': { acopio: 'Arauca', operativo: 'PO.ARAUCA' },
  SARAVENA: { acopio: 'Arauca', operativo: 'PO.ARAUCA' },
  TAME: { acopio: 'Arauca', operativo: 'PO.ARAUCA' },

  // Aguachica / Sur de Bolívar (PO.VALLEDUPAR)
  AGUACHICA: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  GAMARRA: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  'LA GLORIA': { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  PELAYA: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  'RIO DE ORO': { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  'RÍO DE ORO': { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  'SAN ALBERTO': { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  'SAN MARTIN': { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  'SAN MARTÍN': { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  GONZALEZ: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  GONZÁLEZ: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  ARENAL: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  MORALES: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  NOROSI: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  NOROSÍ: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  REGIDOR: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  'RIO VIEJO': { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  'RÍO VIEJO': { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  'SANTA ROSA DEL SUR': { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  SIMITI: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },
  SIMITÍ: { acopio: 'Aguachica', operativo: 'PO.VALLEDUPAR' },

  // Valledupar (PO.VALLEDUPAR)
  VALLEDUPAR: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  'AGUSTIN CODAZZI': { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  'AGUSTÍN CODAZZI': { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  CODAZZI: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  ASTREA: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  BECERRIL: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  BOSCONIA: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  CHIMICHAGUA: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  CHIRIGUANA: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  CHIRIGUANÁ: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  CURUMANI: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  CURUMANÍ: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  'EL COPEY': { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  'EL PASO': { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  'LA JAGUA DE IBIRICO': { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  'LA PAZ': { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  MANAURE: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  PAILITAS: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  'PUEBLO BELLO': { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  'SAN DIEGO': { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },
  TAMALAMEQUE: { acopio: 'Valledupar', operativo: 'PO.VALLEDUPAR' },

  // Cúcuta (PO.CUCUTA)
  CUCUTA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  CÚCUTA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  CUCUTA1: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  CUCUTA2: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  CUCUTA3: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  ARBOLEDAS: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  BOCHALEMA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  BUCARASICA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  CACOTA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  CÁCOTA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  CHINACOTA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  CHINÁCOTA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  CHITAGA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  CHITAGÁ: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  CUCUTILLA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  DURANIA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  'EL TARRA': { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  'EL ZULIA': { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  GRAMALOTE: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  HERRAN: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  HERRÁN: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  LABATECA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  'LA BATECA': { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  'LOS PATIOS': { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  LOURDES: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  MUTISCUA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  PAMPLONA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  PAMPLONITA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  'PUERTO SANTANDER': { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  RAGONVALIA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  SALAZAR: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  'SALAZAR DE LAS PALMAS': { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  'SAN CAYETANO': { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  SANTIAGO: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  SILOS: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  'SANTO DOMINGO DE SILOS': { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  TIBU: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  TIBÚ: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  TOLEDO: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  'VILLA CARO': { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  'VILLA DEL ROSARIO': { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },
  SARDINATA: { acopio: 'Cúcuta', operativo: 'PO.CUCUTA' },

  // Ocaña (PO.CUCUTA)
  OCANA: { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  OCAÑA: { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  ABREGO: { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  ÁBREGO: { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  CACHIRA: { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  CÁCHIRA: { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  CONVENCION: { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  CONVENCIÓN: { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  'EL CARMEN': { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  HACARI: { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  HACARÍ: { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  'LA ESPERANZA': { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  'LA PLAYA': { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  'LA PLAYA DE BELEN': { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  'LA PLAYA DE BELÉN': { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  'SAN CALIXTO': { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },
  TEORAMA: { acopio: 'Ocaña', operativo: 'PO.CUCUTA' },

  // Barrancabermeja (PO.BUCARAMANGA)
  BARRANCABERMEJA: { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  CANTAGALLO: { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  CIMITARRA: { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  LANDAZURI: { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  LANDÁZURI: { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  'PUERTO PARRA': { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  'PUERTO WILCHES': { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  'SABANA DE TORRES': { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  'SAN PABLO': { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  'SAN VICENTE DE CHUCURI': { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  'SAN VICENTE DE CHUCURÍ': { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  YONDO: { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  YONDÓ: { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  'EL CARMEN DE CHUCURI': { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },
  'EL CARMEN DE CHUCURÍ': { acopio: 'Barrancabermeja', operativo: 'PO.BUCARAMANGA' },

  // Málaga (PO.BUCARAMANGA)
  MALAGA: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  MÁLAGA: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  CAPITANEJO: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  CARCASI: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  CARCASÍ: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  CERRITO: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  CONCEPCION: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  CONCEPCIÓN: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  ENCISO: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  GUACA: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  MACARAVITA: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  MOLAGAVITA: { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  'SAN ANDRES': { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  'SAN ANDRÉS': { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  'SAN JOSE DE MIRANDA': { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  'SAN JOSÉ DE MIRANDA': { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },
  'SAN MIGUEL': { acopio: 'Málaga', operativo: 'PO.BUCARAMANGA' },

  // San Gil (PO.SAN GIL)
  'SAN GIL': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  SANGIL: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  AGUADA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  ARATOCA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  BARBOSA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  BARICHARA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  BOLIVAR: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  BOLÍVAR: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CABRERA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CEPITA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CEPITÁ: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CHARALA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CHARALÁ: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CHIMA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CHIPATA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CHIPATÁ: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CHITARAQUE: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CONFINES: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CONTRATACION: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CONTRATACIÓN: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  COROMORO: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CURITI: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  CURITÍ: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'EL GUACAMAYO': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'EL PENON': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'EL PEÑÓN': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  ENCINO: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  FLORIAN: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  FLORIÁN: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  GALAN: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  GALÁN: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  GAMBITA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  GÁMBITA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  GUADALUPE: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  GUAPOTA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  GUAPOTÁ: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  GUAVATA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  GUAVATÁ: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  GUEPSA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  GÜEPSA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  HATO: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'JESUS MARIA': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'JESÚS MARÍA': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  JORDAN: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  JORDÁN: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'LA BELLEZA': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'LA PAZ S': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  MOGOTES: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  MONIQUIRA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  MONIQUIRÁ: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  OCAMONTE: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  OIBA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  ONZAGA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  PALMAR: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'PALMAS DEL SOCORRO': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  PARAMO: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  PÁRAMO: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  PINCHOTE: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'PUENTE NACIONAL': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'SAN BENITO VIEJO': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'SAN JOAQUIN': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'SAN JOAQUÍN': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'SAN JOSE DE PARE': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'SAN JOSÉ DE PARE': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'SANTA HELENA DEL OPON': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'SANTA HELENA DEL OPÓN': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  SANTANA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  SIMACOTA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  SOCORRO: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  SUAITA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  SUCRE: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  TOGUI: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  TOGÜÍ: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'VALLE DE SAN JOSE': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  'VALLE DE SAN JOSÉ': { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  VELEZ: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  VÉLEZ: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },
  VILLANUEVA: { acopio: 'San Gil', operativo: 'PO.SAN GIL' },

  // Bucaramanga (PO.BUCARAMANGA)
  BUCARAMANGA: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  BUCARAMANGA1: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  BUCARAMANGA2: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  BUCARAMANGA3: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  FLORIDABLANCA: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  GIRON: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  GIRÓN: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  PIEDECUESTA: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  LEBRIJA: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  RIONEGRO: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  'EL PLAYON': { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  'EL PLAYÓN': { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  PLAYON: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  MATANZA: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  SURATA: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  SURATÁ: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  CALIFORNIA: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  VETAS: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  CHARTA: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  TONA: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  'SANTA BARBARA': { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  'SANTA BÁRBARA': { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  'LOS SANTOS': { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  ZAPATOCA: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
  BETULIA: { acopio: 'Bucaramanga', operativo: 'PO.BUCARAMANGA' },
};

/**
 * Normaliza un valor de Centro Operativo a uno de los 5 estándar canónicos:
 * PO.ARAUCA, PO.BUCARAMANGA, PO.CUCUTA, PO.SAN GIL, PO.VALLEDUPAR
 */
export function normalizeCentroOperativo(raw: any, fallbackAcopioOrLoc?: string): CentroOperativoCanonical {
  const s = String(raw || '').trim().toUpperCase();
  const clean = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');

  if (clean.includes('ARAUCA')) return 'PO.ARAUCA';
  if (clean.includes('VALLEDUPAR') || clean.includes('VALLE') || clean.includes('CESAR')) return 'PO.VALLEDUPAR';
  if (clean.includes('CUCUTA')) return 'PO.CUCUTA';
  if (clean.includes('SANGIL') || (clean.includes('SAN') && clean.includes('GIL'))) return 'PO.SAN GIL';
  if (clean.includes('BUCARAMANGA') || clean.includes('BGA') || clean.includes('SANTANDER')) return 'PO.BUCARAMANGA';

  // Fallback por Centro de Acopio o Localidad
  if (fallbackAcopioOrLoc) {
    const fbNorm = fallbackAcopioOrLoc.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (MUNICIPIO_CENTROS_MAP[fbNorm]) {
      return MUNICIPIO_CENTROS_MAP[fbNorm].operativo;
    }
    if (ACOPIO_TO_OPERATIVO_MAP[fbNorm]) {
      return ACOPIO_TO_OPERATIVO_MAP[fbNorm];
    }
  }

  return 'PO.BUCARAMANGA';
}

/**
 * Normaliza un valor de Centro de Acopio a uno de los 9 estándar canónicos:
 * Arauca, Aguachica, Barrancabermeja, Bucaramanga, Málaga, Ocaña, Cúcuta, San Gil, Valledupar
 */
export function normalizeCentroAcopio(raw: any, fallbackLoc?: string): CentroAcopioCanonical {
  const s = String(raw || '').trim();
  const clean = s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');

  if (clean.includes('ARAUCA')) return 'Arauca';
  if (clean.includes('AGUACHICA')) return 'Aguachica';
  if (clean.includes('BARRANCA') || clean.includes('BERMEJA')) return 'Barrancabermeja';
  if (clean.includes('BUCARAMANGA') || clean.includes('BGA')) return 'Bucaramanga';
  if (clean.includes('MALAGA')) return 'Málaga';
  if (clean.includes('OCANA')) return 'Ocaña';
  if (clean.includes('CUCUTA')) return 'Cúcuta';
  if (clean.includes('SANGIL') || (clean.includes('SAN') && clean.includes('GIL'))) return 'San Gil';
  if (clean.includes('VALLEDUPAR')) return 'Valledupar';

  // Fallback por Localidad / Municipio
  if (fallbackLoc) {
    const locNorm = fallbackLoc.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (MUNICIPIO_CENTROS_MAP[locNorm]) {
      return MUNICIPIO_CENTROS_MAP[locNorm].acopio;
    }
  }

  return 'Bucaramanga';
}
