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
    version: '3.0 (Firebase)',
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
 * Traduce el tipo de foto a su nombre canónico de ítem: foto_aviso, foto_panoramica, foto_tarifas, etc.
 */
export function getPhotoItemSlug(slotKey: string): string {
  const key = (slotKey || '').toLowerCase();
  if (key.includes('tarifa')) return 'foto_tarifas';
  if (key.includes('aviso') || key.includes('letrero')) return 'foto_aviso';
  if (key.includes('panoramica') || key.includes('fachada')) return 'foto_panoramica';
  if (key.includes('matasello')) return 'foto_matasello';
  if (key.includes('bascula')) return 'foto_bascula';
  if (key.includes('contratista') || key.includes('encargado') || key.includes('persona')) return 'foto_contratista';
  if (key.includes('horario')) return 'foto_horario';
  if (key.includes('computador') || key.includes('pc')) return 'foto_computador';
  if (key.includes('cedulafrontal') || key.includes('cedula_frontal')) return 'foto_cedula_frontal';
  if (key.includes('cedulaposterior') || key.includes('cedula_posterior')) return 'foto_cedula_posterior';
  if (key.includes('rut')) return 'foto_rut';
  return 'foto_punto';
}

/**
 * Genera el nombre dinámico exacto de la foto utilizando el patrón:
 * item_municipio_fecha.jpg (ej: foto_aviso_giron_2026-09-07.jpg, foto_bascula_giron_2026-09-07.jpg)
 */
export function getDrivePhotoFileName(slotKey: string, rawMunicipio?: string, rawFecha?: string | Date): string {
  const itemSlug = getPhotoItemSlug(slotKey);
  const cleanMuni = (rawMunicipio || 'giron')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  let fechaStr = '';
  if (rawFecha instanceof Date) {
    fechaStr = rawFecha.toISOString().split('T')[0];
  } else if (typeof rawFecha === 'string' && rawFecha.trim()) {
    const cleanDate = rawFecha.trim().split('T')[0].replace(/[/.]/g, '-').replace(/[^0-9-]/g, '');
    fechaStr = cleanDate;
  }
  if (!fechaStr) {
    fechaStr = new Date().toISOString().split('T')[0];
  }

  return `${itemSlug}_${cleanMuni || 'municipio'}_${fechaStr}.jpg`;
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
 * Sube una fotografía individual a la subcarpeta del municipio correspondiente en Google Drive.
 * Estructura resultante:
 * Fotos Expendios 4-72 - CAMARCA SAS\{Municipio}\Foto_{Tipo}_{municipio}_{cedula}_{fecha}.jpg
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
  const { cedula, slotKey, fileOrBlob, dataUrl, expendioNombre, municipio, fecha } = params;

  // 1. Obtener la carpeta raíz "Fotos Expendios 4-72 - CAMARCA SAS"
  const rootFolder = await getOrCreatePhotosFolder(accessToken);

  // 2. Forzar obligatoriamente la subcarpeta específica para el municipio (ej: Giron, Pamplona)
  const municipioFolder = await getOrCreateMunicipioFolder(accessToken, rootFolder.id, municipio);
  const targetFolderId = municipioFolder.id;

  // 3. Generar el nombre dinámico exacto solicitado: item_municipio_fecha.jpg
  // Ej: foto_aviso_giron_2026-09-07.jpg
  const fileName = getDrivePhotoFileName(slotKey, municipio, fecha);
  const tipoLabel = getTipoFotoEtiqueta(slotKey);
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

  // 4. Verificar si ya existe un archivo con ese nombre en la subcarpeta del municipio
  const checkQuery = `'${targetFolderId}' in parents and name='${fileName}' and trashed=false`;
  const checkUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(checkQuery)}&fields=files(id,name,webViewLink,webContentLink)`;
  
  let existingFileId: string | null = null;
  try {
    const checkRes = await fetch(checkUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (checkRes.ok) {
      const checkData = await checkRes.json();
      if (checkData.files && checkData.files.length > 0) {
        existingFileId = checkData.files[0].id;
      }
    }
  } catch {}

  const description = `Fotografía de ${tipoLabel} del expendio en ${muniFormatted} (Cédula: ${cedula}, Encargado: ${expendioNombre || ''}) - CAMARCA SAS`;

  if (existingFileId) {
    // Actualizar contenido del archivo existente (PATCH media)
    const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media&fields=id,name,webViewLink,webContentLink`;
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
    return {
      id: updatedData.id,
      name: fileName,
      webViewLink: updatedData.webViewLink,
      webContentLink: updatedData.webContentLink,
      cedula,
      slotKey,
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

  // Registrar en el backend local
  try {
    await fetch('/api/admin/google-drive/register-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cedula,
        slotKey,
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
    slotKey,
    folderName: municipioFolder.name,
  };
}

/**
 * Sincroniza todas las fotos del catálogo del sistema hacia la carpeta de Google Drive.
 */
export async function restorePhotosFromGoogleDrive(
  accessToken: string,
  onProgress?: (current: number, total: number, photoName: string) => void
): Promise<{ restoredCount: number; errors: number }> {
  try {
    const folder = await getOrCreatePhotosFolder(accessToken);
    let restoredCount = 0;
    let errors = 0;

    // Search for all folders inside the main folder
    const query = `'${folder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
    
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    const subfolders = data.files || [];

    // Dynamically import the upload method to prevent circular issues if any
    const { uploadExpendioPhoto, db } = await import('./firebase');
    const { collection, getDocs, updateDoc, doc } = await import('firebase/firestore');
    
    // Fetch all expendios to map them correctly
    const expendiosSnap = await getDocs(collection(db, 'expendios'));
    const expendiosList = expendiosSnap.docs.map(d => ({ docId: d.id, ...d.data() }));

    let totalPhotos = 0;
    const allFiles: { folderName: string; fileId: string; fileName: string; description?: string }[] = [];

    // Get all files from all subfolders
    for (const sub of subfolders) {
      const q = `'${sub.id}' in parents and mimeType contains 'image/' and trashed = false`;
      const sUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,description)`;
      const sRes = await fetch(sUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      const sData = await sRes.json();
      const files = sData.files || [];
      for (const f of files) {
        allFiles.push({ folderName: sub.name, fileId: f.id, fileName: f.name, description: f.description });
      }
    }

    totalPhotos = allFiles.length;
    let current = 0;

    for (const fileInfo of allFiles) {
      current++;
      if (onProgress) {
        onProgress(current, totalPhotos, fileInfo.fileName);
      }

      try {
        // 1. Try to extract Cedula from description
        let cedula = '';
        if (fileInfo.description) {
          const match = fileInfo.description.match(/C.dula:\s*([a-zA-Z0-9_-]+)/i);
          if (match && match[1]) {
            cedula = match[1].trim();
          }
        }
        
        let targetExpendio = null;
        if (cedula) {
            targetExpendio = expendiosList.find((e: any) => String(e.cedula).trim() === cedula);
        }
        
        // 2. Legacy fallback: check if filename starts with cedula (e.g. 12345_fotoAvisoUrl.jpg)
        if (!targetExpendio) {
            const legacyMatch = fileInfo.fileName.match(/^([a-zA-Z0-9]+)_/);
            if (legacyMatch && legacyMatch[1]) {
               const possibleCedula = legacyMatch[1];
               targetExpendio = expendiosList.find((e: any) => String(e.cedula).trim() === possibleCedula);
            }
        }

        // 3. Fallback to Municipio (folderName). If multiple, we just pick the first.
        if (!targetExpendio) {
            const possibleExpendios = expendiosList.filter((e: any) => 
                (e.municipio || '').toLowerCase() === fileInfo.folderName.toLowerCase() ||
                (e.localidad || '').toLowerCase() === fileInfo.folderName.toLowerCase()
            );
            if (possibleExpendios.length > 0) {
                targetExpendio = possibleExpendios[0];
            }
        }

        // Figure out slot key from filename
        const name = fileInfo.fileName.toLowerCase();
        let slotKeyUrl = '';
        if (name.includes('aviso') || name.includes('letrero')) slotKeyUrl = 'fotoAvisoUrl';
        else if (name.includes('panoramica') || name.includes('fachada')) slotKeyUrl = 'fotoPanoramicaUrl';
        else if (name.includes('matasello')) slotKeyUrl = 'fotoMataselloUrl';
        else if (name.includes('bascula')) slotKeyUrl = 'fotoBasculaUrl';
        else if (name.includes('contratista') || name.includes('encargado')) slotKeyUrl = 'fotoContratistaUrl';
        else if (name.includes('horario')) slotKeyUrl = 'fotoHorarioUrl';
        else if (name.includes('tarifa')) slotKeyUrl = 'fotoTarifasUrl';
        else if (name.includes('computador') || name.includes('pc')) slotKeyUrl = 'computadorUrl';

        // ALWAYS Download from Google Drive (even if we can't map it)
        const dlUrl = `https://www.googleapis.com/drive/v3/files/${fileInfo.fileId}?alt=media`;
        const dlRes = await fetch(dlUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!dlRes.ok) throw new Error('Download failed');
        const blob = await dlRes.blob();

        const folderNameForStorage = targetExpendio ? (targetExpendio.municipio || targetExpendio.localidad || fileInfo.folderName) : fileInfo.folderName;

        // Upload to Firebase Storage
        const downloadUrl = await uploadExpendioPhoto(folderNameForStorage, fileInfo.fileName, blob);
        
        // Update Firestore Document ONLY if we safely found a target and slot
        if (targetExpendio && targetExpendio.docId && slotKeyUrl) {
            await updateDoc(doc(db, 'expendios', targetExpendio.docId), {
                [slotKeyUrl]: downloadUrl
            });
        }
        
        restoredCount++;
      } catch (err) {
        console.error('Error restoring photo:', fileInfo.fileName, err);
        errors++;
      }
    }

    return { restoredCount, errors };
  } catch (error) {
    console.error('Error restoring photos from Google Drive:', error);
    throw error;
  }
}

export async function syncAllPhotosToGoogleDrive(
  accessToken: string,
  onProgress?: (current: number, total: number, photoName: string) => void,
  options: { force?: boolean } = {}
): Promise<{ totalUploaded: number; totalErrors: number; folderUrl: string }> {
  const folder = await getOrCreatePhotosFolder(accessToken);

  // Importar dinámicamente para no causar conflictos circulares
  const { collection, getDocs } = await import('firebase/firestore');
  const { db } = await import('./firebase');

  const expendiosRef = collection(db, 'expendios');
  const snap = await getDocs(expendiosRef);
  const expendios = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const photoKeys = [
    'fotoAvisoUrl', 'fotoPanoramicaUrl', 'fotoMataselloUrl', 
    'fotoBasculaUrl', 'fotoContratistaUrl', 'fotoHorarioUrl', 'fotoTarifasUrl',
    'letreroUrl', 'mataselloUrl', 'basculaUrl' // Legacy fallback keys
  ];

  const photosToSync: Array<{ url: string, cedula: string, slotKey: string, municipio: string, nombre: string, fecha?: string }> = [];

  for (const exp of expendios as any[]) {
    for (const key of photoKeys) {
      if (exp[key] && typeof exp[key] === 'string' && exp[key].startsWith('http')) {
        photosToSync.push({
          url: exp[key],
          cedula: exp.id || exp.cedula || 'SIN_CEDULA',
          slotKey: key.replace('Url', ''),
          municipio: exp.municipio || 'Giron',
          nombre: exp.encargado || exp.nombre || '',
          fecha: exp.fechaModificacion || exp.fechaCreacion || new Date().toISOString()
        });
      }
    }
  }

  let totalUploaded = 0;
  let totalErrors = 0;

  for (let i = 0; i < photosToSync.length; i++) {
    const item = photosToSync[i];
    const photoName = getDrivePhotoFileName(item.slotKey, item.municipio, item.fecha);

    if (onProgress) {
      onProgress(i + 1, photosToSync.length, `${item.nombre || item.cedula} (${photoName})`);
    }

    try {
      // Descargar de Firebase Storage (la URL pública)
      const photoFetch = await fetch(item.url);
      if (!photoFetch.ok) {
        totalErrors++;
        continue;
      }
      const blob = await photoFetch.blob();
      
      await uploadPhotoToGoogleDrive(accessToken, {
        cedula: item.cedula,
        slotKey: item.slotKey,
        fileOrBlob: blob,
        expendioNombre: item.nombre,
        municipio: item.municipio,
        folderId: folder.id,
        fecha: item.fecha,
      });
      totalUploaded++;
    } catch (photoErr) {
      console.warn(`Error subiendo foto ${photoName} a Google Drive:`, photoErr);
      totalErrors++;
    }
  }

  return {
    totalUploaded,
    totalErrors,
    folderUrl: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
  };
}

