import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db, uploadExpendioPhoto } from './firebase';
import { getOrCreatePhotosFolder, getOrCreateMunicipioFolder, uploadPhotoToGoogleDrive } from './googleDriveService';

export function getCustomPhotoFileName(slotKey: string, nombreExpendio: string, fecha?: string | Date): string {
  const cleanExpendio = (nombreExpendio || 'sin_nombre')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  let fechaStr = '';
  if (fecha instanceof Date) {
    fechaStr = fecha.toISOString().split('T')[0];
  } else if (typeof fecha === 'string' && fecha.trim()) {
    fechaStr = fecha.trim().split('T')[0].replace(/[/.]/g, '-').replace(/[^0-9-]/g, '');
  }
  if (!fechaStr) {
    fechaStr = new Date().toISOString().split('T')[0];
  }
  
  let cleanSlot = slotKey.replace('Url', '').toLowerCase();
  if (!cleanSlot.startsWith('foto')) {
    cleanSlot = 'foto_' + cleanSlot;
  } else {
    cleanSlot = cleanSlot.replace('foto', 'foto_');
  }

  return `${cleanSlot}_${cleanExpendio}_${fechaStr}.jpg`;
}

export async function manualDriveBackup(
  accessToken: string,
  onProgress?: (current: number, total: number, name: string) => void
) {
  const folder = await getOrCreatePhotosFolder(accessToken);
  
  const res = await fetch('/api/expendios');
  const json = await res.json();
  const expendios = json.data || [];

  const photoKeys = [
    'fotoAvisoUrl', 'fotoPanoramicaUrl', 'fotoMataselloUrl', 
    'fotoBasculaUrl', 'fotoContratistaUrl', 'fotoHorarioUrl', 'fotoTarifasUrl',
    'computadorUrl'
  ];

  const photosToSync: Array<{ url: string, cedula: string, slotKey: string, municipio: string, nombre: string, fecha: string }> = [];

  for (const exp of expendios as any[]) {
    for (const key of photoKeys) {
      if (exp[key] && typeof exp[key] === 'string' && exp[key].startsWith('http')) {
        photosToSync.push({
          url: exp[key],
          cedula: exp.id || exp.cedula || 'SIN_CEDULA',
          slotKey: key.replace('Url', ''),
          municipio: exp.municipio || 'Giron',
          nombre: exp.encargado || exp.nombre || exp.cedula || 'SinNombre',
          fecha: exp.fechaModificacion || exp.fechaCreacion || new Date().toISOString()
        });
      }
    }
  }

  let totalUploaded = 0;
  let totalErrors = 0;

  for (let i = 0; i < photosToSync.length; i++) {
    const item = photosToSync[i];
    const photoName = getCustomPhotoFileName(item.slotKey, item.nombre, item.fecha);
    
    if (onProgress) {
      onProgress(i + 1, photosToSync.length, `${item.nombre} (${photoName})`);
    }

    try {
      const photoFetch = await fetch(item.url);
      if (!photoFetch.ok) {
        totalErrors++;
        continue;
      }
      const blob = await photoFetch.blob();
      
      const muniFolder = await getOrCreateMunicipioFolder(accessToken, folder.id, item.municipio);
      
      const checkQuery = `'${muniFolder.id}' in parents and name='${photoName}' and trashed=false`;
      const checkUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(checkQuery)}&fields=files(id)`;
      const checkRes = await fetch(checkUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      let existingFileId = null;
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.files && checkData.files.length > 0) {
          existingFileId = checkData.files[0].id;
        }
      }

      const description = `Fotografía ${item.slotKey} de ${item.nombre} (Cédula: ${item.cedula}) - Municipio: ${item.municipio}`;
      
      const metadata = {
        name: photoName,
        description,
        parents: existingFileId ? undefined : [muniFolder.id],
      };
      
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);

      let uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
      let method = 'POST';
      
      if (existingFileId) {
        uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,webViewLink`;
        method = 'PATCH';
      }

      const uploadRes = await fetch(uploadUrl, {
        method,
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });

      if (!uploadRes.ok) throw new Error('Upload error');
      totalUploaded++;
    } catch (e) {
      console.error('Error uploading:', e);
      totalErrors++;
    }
  }

  return { totalUploaded, totalErrors };
}

export async function manualDriveRestore(
  accessToken: string,
  onProgress?: (current: number, total: number, name: string) => void
) {
  const folder = await getOrCreatePhotosFolder(accessToken);
  
  // Search for all subfolders (Municipios)
  const query = `'${folder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  const subfolders = data.files || [];

  const req = await fetch('/api/expendios');
  const json = await req.json();
  const expendiosList = json.data || [];

  const allFiles: any[] = [];
  for (const sub of subfolders) {
    const q = `'${sub.id}' in parents and trashed = false`;
    const sRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,description,mimeType)`, { 
      headers: { Authorization: `Bearer ${accessToken}` } 
    });
    const sData = await sRes.json();
    const files = sData.files || [];
    for (const f of files) {
      if (f.mimeType && f.mimeType.startsWith('image/')) {
        allFiles.push({ folderName: sub.name, ...f });
      }
    }
  }

  let restoredCount = 0;
  let errors = 0;
  let current = 0;

  for (const fileInfo of allFiles) {
    current++;
    if (onProgress) onProgress(current, allFiles.length, fileInfo.name);
    console.debug('Drive API response for file:', JSON.stringify(fileInfo, null, 2));

    try {
      let cedula = '';
      if (fileInfo.description) {
        const match = fileInfo.description.match(/C.dula:\s*([a-zA-Z0-9_-]+)/i);
        if (match && match[1]) cedula = match[1].trim();
      }
      
      let targetExpendio = null;
      if (cedula) {
        targetExpendio = expendiosList.find((e: any) => String(e.cedula).trim() === cedula);
      }
      
      if (!targetExpendio) {
        const fileNameLower = fileInfo.name.toLowerCase();
        // Fallback: try to match nombreExpendio from filename
        targetExpendio = expendiosList.find((e: any) => {
           const cleanExpName = (e.encargado || e.nombre || '')
           .toLowerCase()
           .normalize('NFD')
           .replace(/[\u0300-\u036f]/g, '')
           .replace(/[^a-z0-9]/g, '_')
           .replace(/_+/g, '_')
           .replace(/^_|_$/g, '');
           return cleanExpName && fileNameLower.includes(cleanExpName);
        });
      }

      if (!targetExpendio) {
        targetExpendio = expendiosList.find((e: any) => 
            (e.municipio || '').toLowerCase() === fileInfo.folderName.toLowerCase()
        );
      }

      const name = fileInfo.name.toLowerCase();
      let slotKeyUrl = '';
      if (name.includes('aviso') || name.includes('letrero')) slotKeyUrl = 'fotoAvisoUrl';
      else if (name.includes('panoramica') || name.includes('fachada')) slotKeyUrl = 'fotoPanoramicaUrl';
      else if (name.includes('matasello')) slotKeyUrl = 'fotoMataselloUrl';
      else if (name.includes('bascula')) slotKeyUrl = 'fotoBasculaUrl';
      else if (name.includes('contratista') || name.includes('encargado')) slotKeyUrl = 'fotoContratistaUrl';
      else if (name.includes('horario')) slotKeyUrl = 'fotoHorarioUrl';
      else if (name.includes('tarifa')) slotKeyUrl = 'fotoTarifasUrl';
      else if (name.includes('computador') || name.includes('pc')) slotKeyUrl = 'computadorUrl';

      const dlUrl = `https://www.googleapis.com/drive/v3/files/${fileInfo.id}?alt=media`;
      const dlRes = await fetch(dlUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!dlRes.ok) throw new Error('Download failed');
      const blob = await dlRes.blob();

      const folderNameForStorage = targetExpendio ? (targetExpendio.municipio || targetExpendio.localidad || fileInfo.folderName) : fileInfo.folderName;

      console.log("Convirtiendo imagen a base64 para envio al servidor:", fileInfo.name, 'Metadata:', { fileName: fileInfo.name, cedulaExtraida: cedula, targetExpendioId: targetExpendio ? targetExpendio.cedula : null, slotKeyUrl });
      
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      const base64data = await new Promise((resolve, reject) => {
        reader.onloadend = () => {
          resolve(reader.result);
        };
        reader.onerror = reject;
      });

      if (targetExpendio && (targetExpendio.id || targetExpendio.cedula) && slotKeyUrl) {
          const id = targetExpendio.id || targetExpendio.cedula;
          console.log("Actualizando DB local para", id, slotKeyUrl, 'FileId:', fileInfo.id, 'File name:', fileInfo.name);
          const putRes = await fetch(`/api/admin/expendios/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [slotKeyUrl]: base64data })
          });
          console.log("PUT status:", putRes.status);
      }
      
      restoredCount++;
    } catch (err) {
      console.error('Error procesando archivo:', fileInfo.name, err);
      console.log('Failing context:', { fileId: fileInfo.id, fileName: fileInfo.name, folder: fileInfo.folderName, fileName: fileInfo.name });
      errors++;
    }
  }

  return { restoredCount, errors };
}
