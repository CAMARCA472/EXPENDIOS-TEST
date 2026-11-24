import { GoogleDriveBackupRecord } from '../types';
import { getAccessToken, clearSessionToken } from './googleAuth';

const FOLDER_NAME = 'Copias de Seguridad - Expendios 4-72';

export interface GoogleDriveFolder {
  id: string;
  name: string;
  webViewLink?: string;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  size?: string;
  createdTime?: string;
  webViewLink?: string;
  webContentLink?: string;
}

/**
 * Busca o crea la carpeta designada para respaldos en el Google Drive del usuario.
 */
export async function getOrCreateBackupFolder(accessToken: string): Promise<GoogleDriveFolder> {
  const query = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,webViewLink)&spaces=drive`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!searchRes.ok) {
    if (searchRes.status === 401) {
      clearSessionToken();
    }
    const errData = await searchRes.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Error buscando carpeta en Google Drive (HTTP ${searchRes.status})`
    );
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return {
      id: searchData.files[0].id,
      name: searchData.files[0].name,
      webViewLink: searchData.files[0].webViewLink,
    };
  }

  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Carpeta oficial de respaldos automáticos cada 10 minutos del Sistema de Liquidación de Expendios 4-72 (CAMARCA SAS)',
    }),
  });

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Error creando carpeta de respaldos en Google Drive (HTTP ${createRes.status})`
    );
  }

  const folderData = await createRes.json();
  return {
    id: folderData.id,
    name: folderData.name,
    webViewLink: folderData.webViewLink,
  };
}

/**
 * Lista los archivos de respaldo existentes en la carpeta de Google Drive.
 */
export async function listBackupFiles(
  accessToken: string,
  folderId: string
): Promise<GoogleDriveFile[]> {
  const query = `'${folderId}' in parents and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&orderBy=createdTime desc&pageSize=30&fields=files(id,name,size,createdTime,webViewLink,webContentLink)`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    console.warn('Error listando archivos de Drive:', res.status);
    return [];
  }

  const data = await res.json();
  return data.files || [];
}

/**
 * Realiza la copia de seguridad completa a Google Drive.
 * Obtiene la instantánea del servidor, la empaqueta y la sube a la carpeta de Drive.
 */
export async function executeGoogleDriveBackup(
  tokenOverride?: string,
  origen: 'Automatico_10m' | 'Manual' = 'Automatico_10m',
  cuentaGoogleEmail?: string
): Promise<GoogleDriveBackupRecord> {
  const token = tokenOverride || (await getAccessToken());
  if (!token) {
    throw new Error('No hay sesión de Google activa para realizar la copia de seguridad.');
  }

  // 1. Obtener los datos completos desde la base de datos local (backend)
  const [resExp, resHist, resPagos, resCuentas] = await Promise.all([
    fetch('/api/expendios?_t=' + Date.now()),
    fetch('/api/admin/historial?_t=' + Date.now()),
    fetch('/api/admin/relacion-pagos?_t=' + Date.now()),
    fetch('/api/admin/cuentas-cargadas?_t=' + Date.now()).catch(() => ({ json: () => ({ data: [] }) }))
  ]);

  const [expData, histData, pagosData, cuentasData] = await Promise.all([
    resExp.json(),
    resHist.json(),
    resPagos.json(),
    resCuentas.json()
  ]);

  const exportData = {
    expendios: expData.data || [],
    historial: histData.data || [],
    relacionPagos: pagosData.data || [],
    cuentasCargadas: cuentasData.data || []
  };

  // 2. Preparar el payload enriquecido de la copia de seguridad
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours()
  )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const filename = `Backup_Expendios_472_${dateStr}.json`;

  const backupPayload = {
    sistema: 'Sistema de Liquidación y Control de Expendios 4-72 - CAMARCA SAS',
    tipoRespaldo: origen === 'Automatico_10m' ? 'Copia Automática Programada (Cada 10 minutos)' : 'Copia de Seguridad Manual',
    timestamp: now.toISOString(),
    fechaHoraColombia: now.toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
    version: '4.0 (PostgreSQL)',
    resumen: {
      totalExpendios: exportData.expendios.length,
      totalHistorial: exportData.historial.length,
      totalRelacionPagos: exportData.relacionPagos.length,
      totalCuentasCargadas: exportData.cuentasCargadas.length,
    },
    database: exportData,
  };

  const fileContentStr = JSON.stringify(backupPayload, null, 2);
  const sizeBytes = new Blob([fileContentStr]).size;

  // 3. Localizar o crear la carpeta en Google Drive
  const folder = await getOrCreateBackupFolder(token);

  // 4. Subida Multipart a Google Drive v3
  const boundary = `-------CamarcaDriveBackupBoundary${Date.now()}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: filename,
    mimeType: 'application/json',
    parents: [folder.id],
    description: `Copia de seguridad del sistema (${origen === 'Automatico_10m' ? 'Automática cada 10 minutos' : 'Manual'}) - ${backupPayload.fechaHoraColombia}`,
  };

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    fileContentStr +
    closeDelimiter;

  const uploadUrl =
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,size,createdTime';

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartRequestBody,
  });

  if (!uploadRes.ok) {
    if (uploadRes.status === 401) {
      clearSessionToken();
    }
    const errData = await uploadRes.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Error al subir el archivo a Google Drive (HTTP ${uploadRes.status})`
    );
  }

  const uploadedFile = await uploadRes.json();

  const backupRecord: GoogleDriveBackupRecord = {
    id: uploadedFile.id || `drive-${Date.now()}`,
    name: uploadedFile.name || filename,
    timestamp: now.toISOString(),
    sizeBytes: parseInt(uploadedFile.size || sizeBytes.toString(), 10) || sizeBytes,
    webViewLink: uploadedFile.webViewLink,
    webContentLink: uploadedFile.webContentLink,
    status: 'Completado',
    carpetaId: folder.id,
    cuentaGoogle: cuentaGoogleEmail,
    origen,
    mensaje: `Copia archivada en carpeta "${FOLDER_NAME}" exitosamente.`,
  };

  // 5. Registrar el respaldo en el servidor para persistencia global
  try {
    await fetch('/api/admin/google-drive/register-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backupRecord),
    });
  } catch (regErr) {
    console.warn('Error registrando copia en el servidor:', regErr);
  }

  // 6. Política de retención (1 semana): Depuración automática de copias de más de 7 días
  try {
    const purgeResult = await purgeOldBackupsFromGoogleDrive(token, folder.id, 7);
    if (purgeResult.totalDeleted > 0) {
      console.log(
        `[Google Drive Auto-Purge] ${purgeResult.totalDeleted} copias con más de 1 semana de antigüedad eliminadas exitosamente de Drive para prevenir saturación.`
      );
    }
  } catch (purgeErr) {
    console.warn('Advertencia ejecutando depuración automática de 1 semana en Drive:', purgeErr);
  }

  // Notificar a la interfaz
  window.dispatchEvent(
    new CustomEvent('googleDriveBackupCompleted', {
      detail: backupRecord,
    })
  );

  return backupRecord;
}

export interface PurgeBackupsResult {
  totalChecked: number;
  totalDeleted: number;
  deletedFiles: Array<{ id: string; name: string; createdTime?: string }>;
  errors: string[];
}

/**
 * Elimina automáticamente de Google Drive las copias de seguridad que tengan más de 1 semana (7 días)
 * de antigüedad, evitando que el almacenamiento de Google Drive se sature.
 */
export async function purgeOldBackupsFromGoogleDrive(
  tokenOverride?: string,
  folderIdOverride?: string,
  maxAgeDays: number = 7
): Promise<PurgeBackupsResult> {
  const token = tokenOverride || (await getAccessToken());
  const result: PurgeBackupsResult = {
    totalChecked: 0,
    totalDeleted: 0,
    deletedFiles: [],
    errors: [],
  };

  if (!token) {
    result.errors.push('No hay token de acceso a Google Drive para depurar.');
    return result;
  }

  try {
    let folderId = folderIdOverride;
    if (!folderId) {
      const folder = await getOrCreateBackupFolder(token);
      folderId = folder.id;
    }

    // 1 semana = 7 días
    const ONE_WEEK_MS = maxAgeDays * 24 * 60 * 60 * 1000;
    const cutoffTimestamp = Date.now() - ONE_WEEK_MS;

    // Consultar todos los archivos dentro de la carpeta de respaldos
    const query = `'${folderId}' in parents and trashed=false`;
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      query
    )}&pageSize=100&fields=files(id,name,size,createdTime)&orderBy=createdTime asc`;

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!listRes.ok) {
      const errText = await listRes.text().catch(() => '');
      result.errors.push(`Error listando archivos para purga: HTTP ${listRes.status} ${errText}`);
      return result;
    }

    const listData = await listRes.json();
    const files = listData.files || [];
    result.totalChecked = files.length;

    for (const file of files) {
      let fileDateMs = 0;

      // 1. Intentar obtener fecha desde createdTime de Google Drive
      if (file.createdTime) {
        const parsed = new Date(file.createdTime).getTime();
        if (!isNaN(parsed) && parsed > 0) {
          fileDateMs = parsed;
        }
      }

      // 2. Comprobar además si el nombre coincide con Backup_Expendios_472_YYYY-MM-DD...
      if (file.name) {
        const match = file.name.match(/Backup_Expendios_472_(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
          const nameParsed = new Date(`${match[1]}-${match[2]}-${match[3]}`).getTime();
          if (!isNaN(nameParsed) && nameParsed > 0) {
            // Usar la fecha más antigua de ambas para mayor precisión
            fileDateMs = fileDateMs > 0 ? Math.min(fileDateMs, nameParsed) : nameParsed;
          }
        }
      }

      // Si el archivo tiene más de 1 semana (7 días), eliminarlo definitivamente de Drive
      if (fileDateMs > 0 && fileDateMs < cutoffTimestamp) {
        try {
          const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });

          if (delRes.ok || delRes.status === 204 || delRes.status === 404) {
            result.totalDeleted++;
            result.deletedFiles.push({
              id: file.id,
              name: file.name,
              createdTime: file.createdTime,
            });
          } else {
            const delErrText = await delRes.text().catch(() => '');
            result.errors.push(`No se pudo eliminar ${file.name}: HTTP ${delRes.status} - ${delErrText}`);
          }
        } catch (delError: any) {
          result.errors.push(`Fallo al eliminar archivo ${file.name}: ${delError.message || delError}`);
        }
      }
    }

    // 3. Sincronizar la limpieza con el servidor para actualizar el historial local
    if (result.totalDeleted > 0) {
      try {
        await fetch('/api/admin/google-drive/cleanup-old-records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deletedIds: result.deletedFiles.map((f) => f.id),
            maxAgeDays,
          }),
        });
      } catch (srvErr) {
        console.warn('Error sincronizando depuración con backend:', srvErr);
      }

      // Emitir evento para refrescar componentes visuales
      window.dispatchEvent(
        new CustomEvent('googleDrivePurgeCompleted', {
          detail: result,
        })
      );
    }
  } catch (error: any) {
    console.warn('Aviso durante purgeOldBackupsFromGoogleDrive:', error?.message || error);
    result.errors.push(error.message || 'Error desconocido durante la depuración');
  }

  return result;
}

export const PHOTOS_FOLDER_NAME = 'Fotos Expendios 4-72 - CAMARCA SAS';

/**
 * Busca o crea la carpeta designada para fotos de expendios en el Google Drive del usuario.
 */
export async function getOrCreatePhotosFolder(accessToken: string): Promise<GoogleDriveFolder> {
  const query = `name='${PHOTOS_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,webViewLink)&spaces=drive`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!searchRes.ok) {
    const errData = await searchRes.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Error buscando carpeta de fotos en Google Drive (HTTP ${searchRes.status})`
    );
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return {
      id: searchData.files[0].id,
      name: searchData.files[0].name,
      webViewLink: searchData.files[0].webViewLink || `https://drive.google.com/drive/folders/${searchData.files[0].id}`,
    };
  }

  // Crear la carpeta de fotos
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: PHOTOS_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Carpeta permanente de archivo fotográfico georreferenciado (Avisos, Básculas, Matasellos, Computadores) de Expendios 4-72 - CAMARCA SAS',
    }),
  });

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Error creando carpeta de fotos en Google Drive (HTTP ${createRes.status})`
    );
  }

  const folderData = await createRes.json();
  return {
    id: folderData.id,
    name: folderData.name,
    webViewLink: folderData.webViewLink || `https://drive.google.com/drive/folders/${folderData.id}`,
  };
}

export interface DrivePhotoUploadResult {
  id: string;
  name: string;
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  cedula: string;
  slotKey: string;
  folderName?: string;
}

/**
 * Traduce el tipo de foto al formato solicitado (ej: Foto_Bascula, Foto_Matasello, etc.)
 */
export function getTipoFotoEtiqueta(slotKey: string): string {
  const key = (slotKey || '').toLowerCase();
  if (key.includes('tarifa')) return 'Tarifas';
  if (key.includes('bascula')) return 'Bascula';
  if (key.includes('matasello')) return 'Matasello';
  if (key.includes('aviso') || key.includes('letrero')) return 'Aviso';
  if (key.includes('panoramica') || key.includes('fachada')) return 'Panoramica';
  if (key.includes('contratista') || key.includes('encargado') || key.includes('persona')) return 'Contratista';
  if (key.includes('horario')) return 'Horario';
  if (key.includes('computador') || key.includes('pc')) return 'Computador';
  return 'Foto';
}

/**
 * Traduce el tipo de foto a su nombre legible con prefijo Foto_ (ej: Foto_Aviso, Foto_Bascula, Foto_Matasello)
 */
export function getPhotoItemSlug(slotKey: string): string {
  const key = (slotKey || '').toLowerCase();
  if (key.includes('tarifa')) return 'Foto_Tarifas';
  if (key.includes('aviso') || key.includes('letrero')) return 'Foto_Aviso';
  if (key.includes('panoramica') || key.includes('fachada')) return 'Foto_Panoramica';
  if (key.includes('matasello')) return 'Foto_Matasello';
  if (key.includes('bascula')) return 'Foto_Bascula';
  if (key.includes('contratista') || key.includes('encargado') || key.includes('persona')) return 'Foto_Contratista';
  if (key.includes('horario')) return 'Foto_Horario';
  if (key.includes('computador') || key.includes('pc')) return 'Foto_Computador';
  if (key.includes('cedulafrontal') || key.includes('cedula_frontal')) return 'Foto_Cedula_Frontal';
  if (key.includes('cedulaposterior') || key.includes('cedula_posterior')) return 'Foto_Cedula_Posterior';
  if (key.includes('rut')) return 'Foto_RUT';
  return 'Foto_Punto';
}

/**
 * Formatea una fecha a DDMMAAAA (ej: 23102026)
 */
export function formatFechaDDMMAAAA(rawFecha?: string | Date): string {
  let d: Date | null = null;
  if (rawFecha instanceof Date && !isNaN(rawFecha.getTime())) {
    d = rawFecha;
  } else if (typeof rawFecha === 'string' && rawFecha.trim()) {
    const clean = rawFecha.trim();
    // Si ya viene como DDMMAAAA (8 dígitos)
    if (/^\d{8}$/.test(clean)) {
      return clean;
    }
    // Si viene como YYYY-MM-DD o ISO
    const isoMatch = clean.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})/);
    if (isoMatch) {
      return `${isoMatch[3]}${isoMatch[2]}${isoMatch[1]}`;
    }
    // Si viene como DD/MM/YYYY o DD-MM-YYYY
    const dmyMatch = clean.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})/);
    if (dmyMatch) {
      return `${dmyMatch[1]}${dmyMatch[2]}${dmyMatch[3]}`;
    }
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) {
      d = parsed;
    }
  }
  if (!d) {
    d = new Date();
  }
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear());
  return `${day}${month}${year}`;
}

/**
 * Genera el nombre dinámico exacto de la foto utilizando el patrón programado:
 * NombreMunicipio_TipoDeFoto_FechaDDMMAAAA.jpg (ej: Giron_Foto_Aviso_23102026.jpg)
 */
export function getDrivePhotoFileName(slotKey: string, rawMunicipio?: string, rawFecha?: string | Date): string {
  const itemSlug = getPhotoItemSlug(slotKey);
  const muniClean = formatMunicipioNombre(rawMunicipio || 'Giron')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '');
  const fechaDDMMAAAA = formatFechaDDMMAAAA(rawFecha);

  return `${muniClean || 'Municipio'}_${itemSlug}_${fechaDDMMAAAA}.jpg`;
}

/**
 * Normaliza y capitaliza el municipio (ej: "GIRON" -> "Giron", "Bucaramanga")
 */
export function formatMunicipioNombre(rawMunicipio?: string): string {
  const clean = (rawMunicipio || 'General')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

  if (!clean) return 'General';
  return clean
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Busca o crea la subcarpeta del municipio dentro de "Fotos Expendios 4-72 - CAMARCA SAS"
 * Ejemplo: Fotos Expendios 4-72 - CAMARCA SAS\Giron
 */
export async function getOrCreateMunicipioFolder(
  accessToken: string,
  rootFolderId: string,
  municipioRaw?: string
): Promise<GoogleDriveFolder> {
  const municipioFormatted = formatMunicipioNombre(municipioRaw);

  const query = `'${rootFolderId}' in parents and name='${municipioFormatted}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,webViewLink)&spaces=drive`;

  try {
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        return {
          id: searchData.files[0].id,
          name: searchData.files[0].name,
          webViewLink: searchData.files[0].webViewLink || `https://drive.google.com/drive/folders/${searchData.files[0].id}`,
        };
      }
    }
  } catch (e) {
    console.warn('Error buscando subcarpeta de municipio en Drive:', e);
  }

  // Crear la subcarpeta dentro de la carpeta raíz
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: municipioFormatted,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId],
      description: `Carpeta de fotos de expendios del municipio ${municipioFormatted} - 4-72 CAMARCA SAS`,
    }),
  });

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Error creando carpeta de municipio ${municipioFormatted} en Google Drive`
    );
  }

  const folderData = await createRes.json();
  return {
    id: folderData.id,
    name: folderData.name,
    webViewLink: folderData.webViewLink || `https://drive.google.com/drive/folders/${folderData.id}`,
  };
}

/**
 * Extrae la clave canónica del slot a partir de cualquier variación del nombre del archivo en Google Drive
 * Ejemplos: "Cravo_norte_Foto_Tarifas_27102026.jpg", "Giron_Foto_Aviso_28102026.jpg"
 */
export function getSlotKeyFromFileName(fileName: string): string | null {
  const clean = (fileName || '').toLowerCase();
  if (clean.includes('tarifa')) return 'fotoTarifasUrl';
  if (clean.includes('aviso') || clean.includes('letrero')) return 'fotoAvisoUrl';
  if (clean.includes('panoramica') || clean.includes('fachada')) return 'fotoPanoramicaUrl';
  if (clean.includes('matasello')) return 'fotoMataselloUrl';
  if (clean.includes('bascula') || clean.includes('pesa')) return 'fotoBasculaUrl';
  if (clean.includes('contratista') || clean.includes('encargado') || clean.includes('persona')) return 'fotoContratistaUrl';
  if (clean.includes('horario')) return 'fotoHorarioUrl';
  if (clean.includes('computador') || clean.includes('pc')) return 'computadorUrl';
  if (clean.includes('cedulafrontal') || clean.includes('cedula_frontal')) return 'fotoCedulaFrontalUrl';
  if (clean.includes('cedulaposterior') || clean.includes('cedula_posterior')) return 'fotoCedulaPosteriorUrl';
  if (clean.includes('rut')) return 'fotoRutUrl';
  return null;
}

/**
 * Normaliza cualquier clave de slot a su nombre canónico en ExpendioData (ej: fotoAvisoUrl)
 */
export function normalizeCanonicalSlotKey(rawSlot: string): string {
  const s = (rawSlot || '').toLowerCase().trim();
  if (s.includes('aviso') || s.includes('letrero')) return 'fotoAvisoUrl';
  if (s.includes('panoramica') || s.includes('fachada')) return 'fotoPanoramicaUrl';
  if (s.includes('matasello')) return 'fotoMataselloUrl';
  if (s.includes('bascula')) return 'fotoBasculaUrl';
  if (s.includes('contratista') || s.includes('encargado') || s.includes('propietario')) return 'fotoContratistaUrl';
  if (s.includes('horario')) return 'fotoHorarioUrl';
  if (s.includes('tarifa')) return 'fotoTarifasUrl';
  if (s.includes('computador') || s.includes('pc')) return 'computadorUrl';
  return rawSlot;
}

/**
 * Sube una fotografía individual a la subcarpeta del municipio correspondiente en Google Drive.
 * Estructura resultante:
 * Fotos Expendios 4-72 - CAMARCA SAS\{Municipio}\{NombreMunicipio}_{TipoDeFoto}_{FechaDDMMAAAA}.jpg
 * 
 * Reglas estrictas:
 * 1. Si la foto ya está guardada e idéntica (mismo tamaño), NO se vuelve a subir ("no se carguen las mismas fotos").
 * 2. Si existen versiones duplicadas anteriores de este mismo slot (ej: de días previos), se eliminan automáticamente
 *    para que queden EXACTAMENTE las 7 fotos por municipio.
 */
export async function uploadPhotoToGoogleDrive(
  accessToken: string,
  params: {
    cedula: string;
    slotKey: string;
    fileOrBlob?: Blob | File;
    dataUrl?: string;
    expendioNombre?: string;
    municipio?: string;
    folderId?: string;
    fecha?: string | Date;
  }
): Promise<DrivePhotoUploadResult> {
  const { cedula, fileOrBlob, dataUrl, expendioNombre, municipio, fecha } = params;
  const canonicalSlotKey = normalizeCanonicalSlotKey(params.slotKey);

  // 1. Obtener la carpeta raíz "Fotos Expendios 4-72 - CAMARCA SAS"
  const rootFolder = await getOrCreatePhotosFolder(accessToken);

  // 2. Forzar obligatoriamente la subcarpeta específica para el municipio (ej: Giron, Pamplona, Herran, Cravo norte)
  const municipioFolder = await getOrCreateMunicipioFolder(accessToken, rootFolder.id, municipio);
  const targetFolderId = municipioFolder.id;

  // 3. Generar el nombre dinámico exacto solicitado: NombreMunicipio_TipoDeFoto_FechaDDMMAAAA.jpg
  const fileName = getDrivePhotoFileName(canonicalSlotKey, municipio, fecha);
  const tipoLabel = getTipoFotoEtiqueta(canonicalSlotKey);
  const muniFormatted = formatMunicipioNombre(municipio);

  let blob: Blob;
  if (fileOrBlob) {
    blob = fileOrBlob;
  } else if (dataUrl) {
    const cleanBase64 = dataUrl.replace(/^data:[^;]+;base64,/, '').trim();
    const binary = atob(cleanBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: 'image/jpeg' });
  } else {
    throw new Error('Debe proporcionar el archivo o dataUrl de la fotografía');
  }

  // 4. Listar TODOS los archivos existentes en la subcarpeta del municipio
  let existingFiles: Array<{ id: string; name: string; size?: string; modifiedTime?: string; webViewLink?: string; webContentLink?: string }> = [];
  try {
    const listUrl = `https://www.googleapis.com/drive/v3/files?q='${targetFolderId}'+in+parents+and+trashed=false&fields=files(id,name,size,modifiedTime,webViewLink,webContentLink)&pageSize=100`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      if (Array.isArray(listData.files)) {
        existingFiles = listData.files;
      }
    }
  } catch (err) {
    console.warn('[GoogleDrive] Error listando archivos en carpeta de municipio:', err);
  }

  // Filtrar archivos que corresponden a este mismo slot
  const matchingFiles = existingFiles.filter((f) => {
    const fileSlot = getSlotKeyFromFileName(f.name);
    return fileSlot === canonicalSlotKey;
  });

  // Ordenar los existentes por fecha de modificación descendente (el más nuevo primero)
  matchingFiles.sort((a, b) => {
    const timeA = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
    const timeB = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
    return timeB - timeA;
  });

  const newestExisting = matchingFiles[0];

  // Si hay más de un archivo para este mismo slot (DUPLICADOS de fechas anteriores como _27102026 y _28102026):
  // Eliminar inmediatamente los duplicados más antiguos para que quede SOLO 1 por slot (7 por municipio)
  if (matchingFiles.length > 1) {
    const olderDuplicates = matchingFiles.slice(1);
    for (const dup of olderDuplicates) {
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${dup.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        console.log(`[GoogleDrive] Duplicado previo eliminado en ${muniFormatted}: ${dup.name} (${dup.id})`);
      } catch (delErr) {
        console.warn(`[GoogleDrive] Error eliminando duplicado ${dup.name}:`, delErr);
      }
    }
  }

  // REGLA DEL USUARIO: "no se carguen las mismas fotos que ya estar guardadas"
  // Si ya existe y el tamaño en bytes es idéntico al que se iba a subir: OMITIR CARGA!
  const isIdentical = newestExisting && newestExisting.size && Math.abs(Number(newestExisting.size) - blob.size) === 0;

  if (isIdentical && newestExisting) {
    console.log(`[GoogleDrive] ✓ Foto de ${tipoLabel} en ${muniFormatted} ya está guardada e idéntica. Se omite carga.`);
    return {
      id: newestExisting.id,
      name: newestExisting.name,
      webViewLink: newestExisting.webViewLink || '',
      webContentLink: newestExisting.webContentLink || '',
      cedula,
      slotKey: canonicalSlotKey,
      folderName: municipioFolder.name,
    };
  }

  const description = `Fotografía de ${tipoLabel} del expendio en ${muniFormatted} (Cédula: ${cedula}, Encargado: ${expendioNombre || ''}) - CAMARCA SAS`;

  if (newestExisting) {
    // Actualizar contenido del archivo existente (PATCH media) y asegurar nombre nuevo DDMMAAAA
    const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${newestExisting.id}?uploadType=media&fields=id,name,webViewLink,webContentLink`;
    const updateRes = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'image/jpeg',
      },
      body: blob,
    });

    if (!updateRes.ok) {
      const err = await updateRes.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Error actualizando foto en Google Drive (HTTP ${updateRes.status})`);
    }

    const updatedData = await updateRes.json();

    // Actualizar metadatos de nombre a formato NombreMunicipio_TipoDeFoto_DDMMAAAA.jpg
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${newestExisting.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: fileName, description }),
      });
    } catch {}

    // Registrar en el backend local con el slotKey canónico
    try {
      await fetch('/api/admin/google-drive/register-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cedula,
          slotKey: canonicalSlotKey,
          driveFileId: updatedData.id,
          webViewLink: updatedData.webViewLink,
          webContentLink: updatedData.webContentLink,
          fileName,
          municipio: muniFormatted,
        }),
      });
    } catch {}

    return {
      id: updatedData.id,
      name: fileName,
      webViewLink: updatedData.webViewLink,
      webContentLink: updatedData.webContentLink,
      cedula,
      slotKey: canonicalSlotKey,
      folderName: municipioFolder.name,
    };
  }

  // 5. Subida Multipart de nuevo archivo a la subcarpeta del municipio
  const boundary = `-------CamarcaPhotoBoundary${Date.now()}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    mimeType: 'image/jpeg',
    parents: [targetFolderId],
    description,
  };

  const arrayBuffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  // Construir cuerpo multipart con bytes binarios
  const encoder = new TextEncoder();
  const part1 = encoder.encode(
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: image/jpeg\r\n\r\n'
  );
  const part2 = encoder.encode(closeDelimiter);

  const fullBody = new Uint8Array(part1.length + uint8.length + part2.length);
  fullBody.set(part1, 0);
  fullBody.set(uint8, part1.length);
  fullBody.set(part2, part1.length + uint8.length);

  const uploadUrl =
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink';

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: fullBody,
  });

  if (!uploadRes.ok) {
    const errData = await uploadRes.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Error al subir la fotografía a Google Drive (HTTP ${uploadRes.status})`
    );
  }

  const uploadedData = await uploadRes.json();

  // Registrar en el backend local con el slotKey canónico
  try {
    await fetch('/api/admin/google-drive/register-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cedula,
        slotKey: canonicalSlotKey,
        driveFileId: uploadedData.id,
        webViewLink: uploadedData.webViewLink,
        webContentLink: uploadedData.webContentLink,
        fileName,
        municipio: muniFormatted,
      }),
    });
  } catch {}

  return {
    id: uploadedData.id,
    name: uploadedData.name || fileName,
    webViewLink: uploadedData.webViewLink,
    webContentLink: uploadedData.webContentLink,
    cedula,
    slotKey: canonicalSlotKey,
    folderName: municipioFolder.name,
  };
}

/**
 * Recarga y restaura todas las fotografías desde las carpetas por municipio de Google Drive
 * hacia el servidor y los expendios de la plataforma.
 */
export async function restorePhotosFromGoogleDrive(
  accessToken: string,
  onProgress?: (current: number, total: number, photoName: string) => void
): Promise<{ restoredCount: number; errors: number }> {
  try {
    // 1. Primero ejecutar reconciliación y escaneo en el servidor si hay token
    try {
      await fetch('/api/admin/google-drive/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      });
    } catch {}

    const folder = await getOrCreatePhotosFolder(accessToken);
    let restoredCount = 0;
    let errors = 0;

    // Buscar todas las subcarpetas de municipios dentro de la carpeta raíz
    const query = `'${folder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=100`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    const subfolders = data.files || [];

    // Consultar todos los expendios desde el backend autoritativo
    const expRes = await fetch('/api/expendios');
    const expJson = await expRes.json();
    const expendiosList = expJson.data || [];

    const normalizeDigits = (val?: string) => String(val || '').replace(/\D/g, '').trim();
    const normalizeText = (val?: string) =>
      String(val || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const allFiles: {
      folderName: string;
      fileId: string;
      fileName: string;
      description?: string;
      webViewLink?: string;
      webContentLink?: string;
    }[] = [];

    // Obtener también archivos sueltos en la carpeta raíz por si alguno quedó allí
    const rootFilesQuery = `'${folder.id}' in parents and mimeType contains 'image/' and trashed = false`;
    const rootFilesRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(rootFilesQuery)}&fields=files(id,name,description,webViewLink,webContentLink)&pageSize=200`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (rootFilesRes.ok) {
      const rootFilesData = await rootFilesRes.json();
      for (const rf of rootFilesData.files || []) {
        allFiles.push({
          folderName: 'Root',
          fileId: rf.id,
          fileName: rf.name,
          description: rf.description,
          webViewLink: rf.webViewLink,
          webContentLink: rf.webContentLink,
        });
      }
    }

    // Obtener archivos de cada subcarpeta de Municipio
    for (const sub of subfolders) {
      const q = `'${sub.id}' in parents and mimeType contains 'image/' and trashed = false`;
      const sUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,description,webViewLink,webContentLink)&pageSize=200`;
      const sRes = await fetch(sUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      const sData = await sRes.json();
      const files = sData.files || [];
      for (const f of files) {
        allFiles.push({
          folderName: sub.name,
          fileId: f.id,
          fileName: f.name,
          description: f.description,
          webViewLink: f.webViewLink,
          webContentLink: f.webContentLink,
        });
      }
    }

    const totalPhotos = allFiles.length;
    let current = 0;

    for (const fileInfo of allFiles) {
      current++;
      if (onProgress) {
        onProgress(current, totalPhotos, `${fileInfo.folderName}/${fileInfo.fileName}`);
      }

      try {
        // 1. Extraer cédula de la descripción si existe
        let cedula = '';
        if (fileInfo.description) {
          const match = fileInfo.description.match(/C.dula:\s*([a-zA-Z0-9._-]+)/i);
          if (match && match[1]) {
            cedula = match[1].trim();
          }
        }

        let targetExpendio = null;
        if (cedula) {
          targetExpendio = expendiosList.find(
            (e: any) => normalizeDigits(e.cedula) === normalizeDigits(cedula)
          );
        }

        // 2. Fallback por nombre de carpeta (Municipio) o prefijo del archivo (NombreMunicipio_TipoFoto_DDMMAAAA.jpg)
        if (!targetExpendio && fileInfo.folderName && fileInfo.folderName !== 'Root') {
          const targetMuni = normalizeText(fileInfo.folderName);
          targetExpendio = expendiosList.find(
            (e: any) =>
              normalizeText(e.municipio) === targetMuni ||
              normalizeText(e.localidad) === targetMuni
          );
        }

        if (!targetExpendio) {
          const nameParts = fileInfo.fileName.replace(/\.(jpg|jpeg|png)$/i, '').split('_');
          if (nameParts.length >= 2) {
            if (/^\d+$/.test(nameParts[0])) {
              targetExpendio = expendiosList.find(
                (e: any) => normalizeDigits(e.cedula) === normalizeDigits(nameParts[0])
              );
            } else {
              const possibleMuni = normalizeText(nameParts[0]);
              targetExpendio = expendiosList.find(
                (e: any) =>
                  normalizeText(e.municipio) === possibleMuni ||
                  normalizeText(e.localidad) === possibleMuni
              );
            }
          }
        }

        // Determinar slotKey canónico a partir del nombre del archivo
        const slotKeyUrl = normalizeCanonicalSlotKey(fileInfo.fileName);

        // Descargar la imagen desde Google Drive
        const dlUrl = `https://www.googleapis.com/drive/v3/files/${fileInfo.fileId}?alt=media`;
        const dlRes = await fetch(dlUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!dlRes.ok) throw new Error('Download failed');
        const blob = await dlRes.blob();

        if (targetExpendio && slotKeyUrl) {
          const cleanCed = normalizeDigits(targetExpendio.cedula) || String(targetExpendio.cedula).trim();
          const formData = new FormData();
          formData.append('foto', blob, `${cleanCed}_${slotKeyUrl}.jpg`);
          await fetch(
            `/api/photos/upload-hybrid/${encodeURIComponent(cleanCed)}/${encodeURIComponent(slotKeyUrl)}`,
            {
              method: 'POST',
              body: formData,
            }
          );

          await fetch('/api/admin/google-drive/register-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cedula: cleanCed,
              slotKey: slotKeyUrl,
              driveFileId: fileInfo.fileId,
              webViewLink: fileInfo.webViewLink,
              webContentLink: fileInfo.webContentLink,
              fileName: fileInfo.fileName,
              municipio: fileInfo.folderName !== 'Root' ? fileInfo.folderName : targetExpendio.municipio,
            }),
          });
        }

        restoredCount++;
      } catch (err) {
        console.error('Error restoring photo:', fileInfo.fileName, err);
        errors++;
      }
    }

    // Vincular fotos locales y de Drive con los expendios
    try {
      await fetch('/api/admin/photos/scan-and-link', { method: 'POST' });
    } catch {}

    return { restoredCount, errors };
  } catch (error) {
    console.error('Error restoring photos from Google Drive:', error);
    throw error;
  }
}

export interface DriveSyncProgress {
  current: number;
  total: number;
  municipio: string;
  slotTitle: string;
  photoName: string;
  percent: number;
  skipped: boolean;
  uploadedCount: number;
  skippedCount: number;
}

export interface DriveDeduplicationProgress {
  currentMuniIndex: number;
  totalMunis: number;
  currentMunicipio: string;
  duplicatesRemovedInMuni: number;
  totalDuplicatesRemoved: number;
  percent: number;
}

/**
 * Escanea y elimina todas las fotos duplicadas en Google Drive en todas las carpetas de municipios.
 * Deja exactamente las 7 fotos oficiales por municipio conservando la versión más reciente.
 */
export async function deduplicateAllMunicipalityPhotosInDrive(
  accessToken: string,
  onProgress?: (progress: DriveDeduplicationProgress) => void
): Promise<{
  success: boolean;
  totalMunicipalities: number;
  totalDuplicatesDeleted: number;
  details: Array<{ municipio: string; deletedFiles: string[]; remainingFiles: number }>;
}> {
  // 1. Obtener la carpeta raíz "Fotos Expendios 4-72 - CAMARCA SAS"
  const rootFolder = await getOrCreatePhotosFolder(accessToken);

  // 2. Listar todas las subcarpetas de municipios
  const muniFolders: GoogleDriveFolder[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const listFoldersUrl: string = `https://www.googleapis.com/drive/v3/files?q='${rootFolder.id}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=nextPageToken,files(id,name)&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(listFoldersUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    if (data.files) muniFolders.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);

  let totalDuplicatesDeleted = 0;
  const details: Array<{ municipio: string; deletedFiles: string[]; remainingFiles: number }> = [];

  for (let i = 0; i < muniFolders.length; i++) {
    const folder = muniFolders[i];
    const muniName = folder.name;

    // Listar todos los archivos dentro de la subcarpeta del municipio
    const filesInMuni: Array<{ id: string; name: string; modifiedTime: string; size: string }> = [];
    let filePageToken: string | undefined = undefined;
    do {
      const listFilesUrl: string = `https://www.googleapis.com/drive/v3/files?q='${folder.id}'+in+parents+and+trashed=false&fields=nextPageToken,files(id,name,modifiedTime,size)&pageSize=100${filePageToken ? `&pageToken=${filePageToken}` : ''}`;
      const fRes = await fetch(listFilesUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!fRes.ok) break;
      const fData = await fRes.json();
      if (fData.files) filesInMuni.push(...fData.files);
      filePageToken = fData.nextPageToken;
    } while (filePageToken);

    // Agrupar archivos por tipo/slot (Aviso, Panorámica, Matasello, Báscula, Contratista, Horario, Tarifas)
    const slotBuckets: Record<string, Array<{ id: string; name: string; modifiedTime: string; size: string }>> = {
      fotoAvisoUrl: [],
      fotoPanoramicaUrl: [],
      fotoMataselloUrl: [],
      fotoBasculaUrl: [],
      fotoContratistaUrl: [],
      fotoHorarioUrl: [],
      fotoTarifasUrl: [],
      otros: [],
    };

    for (const file of filesInMuni) {
      const slot = getSlotKeyFromFileName(file.name);
      if (slot && slotBuckets[slot]) {
        slotBuckets[slot].push(file);
      } else {
        slotBuckets.otros.push(file);
      }
    }

    const deletedInThisMuni: string[] = [];

    // Para cada uno de los 7 slots: si hay más de 1 archivo, ordenar por fecha más reciente,
    // conservar únicamente el más nuevo y eliminar todos los demás duplicados
    for (const [slotKey, files] of Object.entries(slotBuckets)) {
      if (slotKey === 'otros') continue;
      if (files.length > 1) {
        // Ordenar descendente: [0] es el más reciente (new Date(modifiedTime))
        files.sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime());
        const filesToDelete = files.slice(1);
        for (const dup of filesToDelete) {
          try {
            const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${dup.id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (delRes.ok || delRes.status === 204 || delRes.status === 404) {
              totalDuplicatesDeleted++;
              deletedInThisMuni.push(dup.name);
            }
          } catch (e) {
            console.warn(`Error eliminando archivo duplicado ${dup.name}:`, e);
          }
        }
      }
    }

    const remainingCount = filesInMuni.length - deletedInThisMuni.length;
    details.push({
      municipio: muniName,
      deletedFiles: deletedInThisMuni,
      remainingFiles: remainingCount,
    });

    if (onProgress) {
      onProgress({
        currentMuniIndex: i + 1,
        totalMunis: muniFolders.length,
        currentMunicipio: muniName,
        duplicatesRemovedInMuni: deletedInThisMuni.length,
        totalDuplicatesRemoved: totalDuplicatesDeleted,
        percent: Math.round(((i + 1) / muniFolders.length) * 100),
      });
    }
  }

  return {
    success: true,
    totalMunicipalities: muniFolders.length,
    totalDuplicatesDeleted,
    details,
  };
}

/**
 * Sincroniza todas las fotos activas hacia Google Drive organizadas por municipios.
 * Implementa progreso en tiempo real de cada municipio cargado y evita duplicación de fotos ya guardadas.
 */
export async function syncAllPhotosToGoogleDrive(
  accessTokenParam?: string,
  onProgress?: ((progress: DriveSyncProgress) => void) | ((current: any, total: any, photoName: any) => void)
): Promise<{
  totalUploaded: number;
  totalSkipped: number;
  totalErrors: number;
  totalDuplicatesCleaned?: number;
  folderUrl: string;
}> {
  const accessToken = accessTokenParam || (await getAccessToken());
  if (!accessToken) {
    throw new Error('No se encontró un token válido de Google Drive. Inicie sesión primero.');
  }

  // 1. Obtener o crear la carpeta raíz en Drive
  const folder = await getOrCreatePhotosFolder(accessToken);

  // 2. Consultar el catálogo completo de fotos del servidor + expendios
  const [catRes, expRes] = await Promise.all([
    fetch('/api/admin/photos/catalog').then((r) => r.json()).catch(() => ({ photos: [] })),
    fetch('/api/expendios').then((r) => r.json()).catch(() => ({ data: [] })),
  ]);

  const expendios = Array.isArray(expRes?.data) ? expRes.data : [];
  const catalogPhotos = Array.isArray(catRes?.photos) ? catRes.photos : [];

  const photoKeys = [
    'fotoAvisoUrl',
    'fotoPanoramicaUrl',
    'fotoMataselloUrl',
    'fotoBasculaUrl',
    'fotoContratistaUrl',
    'fotoHorarioUrl',
    'fotoTarifasUrl',
  ];

  const photosMap = new Map<
    string,
    { url: string; cedula: string; slotKey: string; municipio: string; nombre: string; fecha?: string }
  >();

  // 1. Agregar desde el catálogo del servidor
  for (const p of catalogPhotos) {
    const canonicalSlot = normalizeCanonicalSlotKey(p.slotKey);
    const cleanCed = String(p.cedula || '').replace(/\D/g, '').trim();
    if (!cleanCed || !canonicalSlot) continue;
    const mapKey = `${cleanCed}_${canonicalSlot}`;
    photosMap.set(mapKey, {
      url: p.url || `/api/photos/${encodeURIComponent(cleanCed)}/${encodeURIComponent(canonicalSlot)}`,
      cedula: cleanCed,
      slotKey: canonicalSlot,
      municipio: p.municipio || p.folderName || 'Giron',
      nombre: p.nombre || '',
      fecha: new Date().toISOString(),
    });
  }

  // 2. Agregar desde los expendios activos
  for (const exp of expendios as any[]) {
    const cleanCed = String(exp.cedula || '').replace(/\D/g, '').trim();
    if (!cleanCed) continue;
    for (const key of photoKeys) {
      const val = exp[key];
      if (val && typeof val === 'string' && !val.includes('placehold.co') && val.trim().length > 3) {
        const mapKey = `${cleanCed}_${key}`;
        if (!photosMap.has(mapKey)) {
          photosMap.set(mapKey, {
            url: val.startsWith('http') || val.startsWith('/') ? val : `/api/photos/${encodeURIComponent(cleanCed)}/${key}`,
            cedula: cleanCed,
            slotKey: key,
            municipio: exp.municipio || exp.localidad || 'Giron',
            nombre: exp.encargado || exp.nombre || '',
            fecha: exp.fechaUltimaActualizacion || exp.updatedAt || new Date().toISOString(),
          });
        }
      }
    }
  }

  const photosToSync = Array.from(photosMap.values());
  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (let i = 0; i < photosToSync.length; i++) {
    const item = photosToSync[i];
    const canonicalSlot = normalizeCanonicalSlotKey(item.slotKey);
    const slotTitle = getTipoFotoEtiqueta(canonicalSlot);
    const photoName = getDrivePhotoFileName(canonicalSlot, item.municipio, item.fecha);
    const percent = Math.round(((i + 1) / photosToSync.length) * 100);

    if (onProgress) {
      const progObj: DriveSyncProgress = {
        current: i + 1,
        total: photosToSync.length,
        municipio: item.municipio,
        slotTitle,
        photoName,
        percent,
        skipped: false,
        uploadedCount: totalUploaded,
        skippedCount: totalSkipped,
      };
      if (onProgress.length <= 1) {
        (onProgress as (progress: DriveSyncProgress) => void)(progObj);
      } else {
        (onProgress as any)(i + 1, photosToSync.length, photoName);
      }
    }


    try {
      const photoFetch = await fetch(item.url);
      if (!photoFetch.ok) {
        totalErrors++;
        continue;
      }
      const blob = await photoFetch.blob();
      if (blob.size < 500) {
        totalErrors++;
        continue;
      }

      const uploadResult = await uploadPhotoToGoogleDrive(accessToken, {
        cedula: item.cedula,
        slotKey: item.slotKey,
        fileOrBlob: blob,
        expendioNombre: item.nombre,
        municipio: item.municipio,
        folderId: folder.id,
        fecha: item.fecha,
      });

      // Si la función uploadPhotoToGoogleDrive detectó que ya existía e idéntica, no incrementa nuevo upload
      totalUploaded++;
    } catch (photoErr: any) {
      console.warn(`Error procesando foto ${photoName} en ${item.municipio}:`, photoErr?.message);
      totalErrors++;
    }
  }

  // 3. Purgar y deduplicar archivos remanentes en Drive automáticamente
  let totalDuplicatesCleaned = 0;
  try {
    const dedupRes = await deduplicateAllMunicipalityPhotosInDrive(accessToken);
    totalDuplicatesCleaned = dedupRes.totalDuplicatesDeleted;
  } catch (dedupErr) {
    console.warn('Error en deduplicación final de Google Drive:', dedupErr);
  }

  return {
    totalUploaded,
    totalSkipped,
    totalErrors,
    totalDuplicatesCleaned,
    folderUrl: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
  };
}


