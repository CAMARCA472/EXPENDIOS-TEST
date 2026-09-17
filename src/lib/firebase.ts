import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getStorage, 
  ref, 
  uploadBytesResumable, 
  getDownloadURL, 
  listAll, 
  deleteObject 
} from 'firebase/storage';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Inicializar la aplicación de Firebase (singleton)
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Instancia de Cloud Firestore
const dbId = (firebaseConfig as Record<string, any>).firestoreDatabaseId;
export const db = dbId && dbId !== '(default)' 
  ? getFirestore(app, dbId) 
  : getFirestore(app);

// Instancia de Firebase Storage
export const storage = getStorage(app);

// ==========================================
// LÓGICA DE COLA DE SUBIDA OFFLINE (IndexedDB)
// ==========================================

const DB_NAME = 'CamarcaOfflineUploads';
const STORE_NAME = 'photos';

function initQueueDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB no soportado en este entorno'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Agrega una foto a la cola local (IndexedDB) para subirse más tarde.
 */
export async function queueExpendioPhoto(
  nombreExpendio: string,
  nombreArchivo: string,
  file: File | Blob
): Promise<string> {
  const db = await initQueueDB();
  const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const item = { id, nombreExpendio, nombreArchivo, file, timestamp: Date.now() };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => {
      // Intentar procesar la cola por si de hecho hay conexión
      processUploadQueue().catch(() => {});
      resolve(id);
    };
    tx.onerror = () => reject(tx.error);
  });
}

let isProcessingQueue = false;

/**
 * Procesa todos los archivos encolados e intenta subirlos a Firebase Storage.
 */
export async function processUploadQueue(): Promise<void> {
  if (isProcessingQueue || typeof navigator === 'undefined' || !navigator.onLine) return;
  isProcessingQueue = true;

  try {
    const db = await initQueueDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const items = await new Promise<any[]>((resolve, reject) => {
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (items.length === 0) return;

    for (const item of items) {
      if (!navigator.onLine) break; // Si se pierde la conexión a mitad de proceso, abortar.
      try {
        const url = await uploadExpendioPhoto(item.nombreExpendio, item.nombreArchivo, item.file);
        
        // Eliminar de la cola tras una subida exitosa
        const delTx = db.transaction(STORE_NAME, 'readwrite');
        delTx.objectStore(STORE_NAME).delete(item.id);
        
        // Disparar un evento por si la interfaz quiere notificar
        window.dispatchEvent(new CustomEvent('offlinePhotoUploaded', { detail: { id: item.id, url, nombreArchivo: item.nombreArchivo } }));
      } catch (err) {
        console.warn(`[Firebase] Error procesando archivo encolado ${item.nombreArchivo}:`, err);
      }
    }
  } catch (err) {
    console.warn('[Firebase] No se pudo acceder a la cola de subidas offline:', err);
  } finally {
    isProcessingQueue = false;
  }
}

// Configurar listener automático para cuando vuelva el internet
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[Firebase] Conexión restaurada. Procesando cola de subidas fotográficas...');
    processUploadQueue().catch(() => {});
  });
}

/**
 * Sube una foto a Firebase Storage bajo la estructura 'expendios/{nombreExpendio}/{nombreArchivo.jpg}'
 * O la guarda en una cola local si el dispositivo no tiene conexión.
 * @param nombreExpendio El nombre del expendio
 * @param nombreArchivo El nombre del archivo
 * @param file El archivo a subir
 * @returns Un objeto indicando si se subió o se encoló, y opcionalmente la URL
 */
export async function queueOrUploadExpendioPhoto(
  nombreExpendio: string,
  nombreArchivo: string,
  file: File | Blob
): Promise<{ status: 'uploaded' | 'queued'; url?: string; queueId?: string }> {
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      const url = await uploadExpendioPhoto(nombreExpendio, nombreArchivo, file);
      return { status: 'uploaded', url };
    } catch (err) {
      console.warn('Fallo en la subida, moviendo a cola de espera:', err);
    }
  }
  
  // Si no hay red o la subida falló (ej. latencia alta), encolar
  const queueId = await queueExpendioPhoto(nombreExpendio, nombreArchivo, file);
  return { status: 'queued', queueId };
}

/**
 * Sube una foto a Firebase Storage bajo la estructura 'expendios/{nombreExpendio}/{nombreArchivo.jpg}'
 * @param nombreExpendio El nombre del expendio (se limpiará de caracteres especiales para la carpeta)
 * @param nombreArchivo El nombre del archivo (ej. 'Cuenta_Cobro_Giron_123.jpg')
 * @param file El archivo a subir (File o Blob)
 * @returns Promesa con la URL pública de descarga de la imagen
 */
export async function uploadExpendioPhoto(
  nombreExpendio: string,
  nombreArchivo: string,
  file: File | Blob
): Promise<string> {
  const cleanExpendio = (nombreExpendio || 'sin_nombre').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanArchivo = (nombreArchivo || 'foto.jpg').trim().replace(/[^a-zA-Z0-9_.-]/g, '_');
  const path = `expendios/${cleanExpendio}/${cleanArchivo}`;
  const storageRef = ref(storage, path);

  const snapshot = await uploadBytesResumable(storageRef, file, {
    contentType: file.type || 'image/jpeg',
  });

  return await getDownloadURL(snapshot.ref);
}

/**
 * Lista todas las fotos de un expendio específico en Firebase Storage
 * @param nombreExpendio El nombre del expendio
 * @returns Lista de objetos con el nombre del archivo y su URL de descarga
 */
export async function listExpendioPhotos(nombreExpendio: string): Promise<Array<{ name: string; url: string; fullPath: string }>> {
  const cleanExpendio = (nombreExpendio || 'sin_nombre').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `expendios/${cleanExpendio}`;
  const storageRef = ref(storage, path);

  const result = await listAll(storageRef);
  
  const photos = await Promise.all(
    result.items.map(async (itemRef) => {
      const url = await getDownloadURL(itemRef);
      return {
        name: itemRef.name,
        fullPath: itemRef.fullPath,
        url,
      };
    })
  );

  return photos;
}

/**
 * Obtiene la URL de descarga de una foto específica
 * @param nombreExpendio El nombre del expendio
 * @param nombreArchivo El nombre del archivo
 */
export async function getExpendioPhotoUrl(nombreExpendio: string, nombreArchivo: string): Promise<string> {
  const cleanExpendio = (nombreExpendio || 'sin_nombre').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanArchivo = (nombreArchivo || 'foto.jpg').trim().replace(/[^a-zA-Z0-9_.-]/g, '_');
  const path = `expendios/${cleanExpendio}/${cleanArchivo}`;
  const storageRef = ref(storage, path);
  
  return await getDownloadURL(storageRef);
}

/**
 * Elimina una foto de Firebase Storage
 * @param fullPath La ruta completa del archivo en Storage
 */
export async function deleteExpendioPhoto(fullPath: string): Promise<void> {
  const storageRef = ref(storage, fullPath);
  await deleteObject(storageRef);
}
