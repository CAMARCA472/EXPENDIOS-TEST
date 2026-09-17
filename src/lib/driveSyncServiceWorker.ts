/**
 * Cliente para el Service Worker Dedicado de Sincronización de Archivos con Google Drive
 * Sistema de Expendios 4-72 - CAMARCA SAS
 *
 * Proporciona:
 * - Registro del Service Worker en el ámbito raíz '/'.
 * - Registro de tareas de Background Sync API ('camarca-drive-sync').
 * - Canal de comunicación en tiempo real (BroadcastChannel + postMessage).
 * - Sincronización transparente ante reconexiones de red sin bloquear la UI principal.
 */

import { getAccessToken } from './googleAuth';

export interface WorkerSyncStats {
  isSyncing: boolean;
  totalInQueue: number;
  processedCount: number;
  syncedCount: number;
  failedCount: number;
  retryingCount: number;
  lastSyncTime: string | null;
  lastError: string | null;
  currentFile: string | null;
}

export type WorkerSyncEventType =
  | 'SYNC_STARTED'
  | 'SYNC_PROGRESS'
  | 'SYNC_ITEM_SUCCESS'
  | 'SYNC_ITEM_RETRY'
  | 'SYNC_ITEM_FAILED'
  | 'SYNC_COMPLETED'
  | 'SYNC_ERROR'
  | 'SYNC_TOKEN_REQUIRED'
  | 'SYNC_TOKEN_EXPIRED';

export interface WorkerSyncEvent {
  type: WorkerSyncEventType;
  payload: any;
  timestamp: number;
  version?: string;
}

const SW_PATH = '/drive-sync-sw.js';
const SYNC_TAG = 'camarca-drive-sync';
const CHANNEL_NAME = 'camarca_drive_sync_channel';

let swRegistration: ServiceWorkerRegistration | null = null;
let broadcastChannel: BroadcastChannel | null = null;
const listeners = new Set<(event: WorkerSyncEvent) => void>();

/**
 * Determina si el entorno admite Service Workers
 */
export function isServiceWorkerSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator;
}

/**
 * Determina si el navegador admite la API de Background Sync
 */
export function isBackgroundSyncSupported(): boolean {
  return (
    isServiceWorkerSupported() &&
    'SyncManager' in window &&
    'sync' in (ServiceWorkerRegistration.prototype as any)
  );
}

/**
 * Registra y pone en marcha el Service Worker dedicado
 */
export async function initDriveSyncServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) {
    console.info('[SW Client] Service Workers no están soportados en este navegador.');
    return null;
  }

  try {
    // Configurar BroadcastChannel para recibir eventos en tiempo real
    if (typeof BroadcastChannel !== 'undefined' && !broadcastChannel) {
      broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
      broadcastChannel.onmessage = (event) => {
        if (event.data && event.data.type) {
          notifyListeners(event.data);
        }
      };
    }

    // Escuchar mensajes directos de serviceWorker (fallback para navegadores sin BroadcastChannel)
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type) {
        notifyListeners(event.data);
      }
    });

    // Registrar el Service Worker con alcance completo
    swRegistration = await navigator.serviceWorker.register(SW_PATH, {
      scope: '/',
      updateViaCache: 'none',
    });

    console.log('[SW Client] ✓ Service Worker de Sincronización registrado con alcance:', swRegistration.scope);

    // Escuchar cambios de estado del Service Worker activo
    if (swRegistration.installing) {
      swRegistration.installing.addEventListener('statechange', (e: any) => {
        if (e.target.state === 'activated') {
          console.log('[SW Client] ✓ Service Worker ahora está activado y listo.');
          sendActiveTokenToWorker();
        }
      });
    }

    // Si ya está activo, suministrar token en segundo plano
    if (swRegistration.active) {
      sendActiveTokenToWorker();
    }

    // Escuchar eventos de reconexión de red para solicitar sincronización automática
    window.addEventListener('online', () => {
      console.log('[SW Client] Conexión a internet reanudada. Notificando a Service Worker...');
      requestBackgroundSyncRegistration();
      triggerDriveSyncViaWorker().catch(() => {});
    });

    return swRegistration;
  } catch (err: any) {
    console.warn('[SW Client] No se pudo inicializar Service Worker (modo seguro activo):', err?.message || err);
    return null;
  }
}

/**
 * Obtiene el token activo de Google Drive y se lo envía al Service Worker
 */
export async function sendActiveTokenToWorker(tokenOverride?: string): Promise<boolean> {
  if (!isServiceWorkerSupported()) return false;

  let token = tokenOverride;
  if (!token) {
    try {
      token = (await getAccessToken()) || undefined;
    } catch {}
  }

  if (!token) return false;

  const activeWorker = navigator.serviceWorker.controller || swRegistration?.active;
  if (activeWorker) {
    activeWorker.postMessage({
      type: 'SET_TOKEN',
      token,
    });
    return true;
  }
  return false;
}

/**
 * Solicita el registro de una tarea en la Background Sync API
 */
export async function requestBackgroundSyncRegistration(): Promise<boolean> {
  if (!isBackgroundSyncSupported()) return false;

  try {
    const reg = swRegistration || (await navigator.serviceWorker.ready);
    if ('sync' in reg) {
      await (reg as any).sync.register(SYNC_TAG);
      console.log(`[SW Client] ✓ Tarea de sincronización registrada en Background Sync API ("${SYNC_TAG}")`);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[SW Client] Advertencia al registrar en Background Sync API:', err);
    return false;
  }
}

/**
 * Dispara la sincronización en segundo plano a través del Service Worker de forma 100% no bloqueante
 */
export async function triggerDriveSyncViaWorker(tokenOverride?: string): Promise<{
  success: boolean;
  message: string;
  workerActive: boolean;
}> {
  if (!isServiceWorkerSupported()) {
    return {
      success: false,
      message: 'Service Workers no están disponibles en este entorno.',
      workerActive: false,
    };
  }

  let token = tokenOverride;
  if (!token) {
    try {
      token = (await getAccessToken()) || undefined;
    } catch {}
  }

  try {
    const reg = swRegistration || (await navigator.serviceWorker.ready);
    const worker = reg.active || navigator.serviceWorker.controller;

    if (worker) {
      // Enviar mensaje al worker para iniciar
      worker.postMessage({
        type: 'START_SYNC',
        token,
        trigger: 'client_ui_action',
      });

      // Intentar también registrar la tarea en la Background Sync API para persistir si se cierra la pestaña
      requestBackgroundSyncRegistration().catch(() => {});

      return {
        success: true,
        message: 'Sincronización en segundo plano iniciada por el Service Worker.',
        workerActive: true,
      };
    } else {
      return {
        success: false,
        message: 'El Service Worker aún se está instalando o no está activo.',
        workerActive: false,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Error comunicándose con el Service Worker.',
      workerActive: false,
    };
  }
}

/**
 * Obtiene el estado actual del Service Worker mediante MessageChannel
 */
export async function getWorkerSyncStatus(): Promise<WorkerSyncStats | null> {
  if (!isServiceWorkerSupported()) return null;

  try {
    const reg = swRegistration || (await navigator.serviceWorker.ready);
    const worker = reg.active || navigator.serviceWorker.controller;

    if (!worker) return null;

    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => resolve(null), 2500);

      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        if (event.data && event.data.stats) {
          resolve(event.data.stats);
        } else {
          resolve(null);
        }
      };

      worker.postMessage({ type: 'GET_STATUS' }, [channel.port2]);
    });
  } catch {
    return null;
  }
}

/**
 * Suscribe un callback para escuchar eventos de sincronización del Service Worker en tiempo real
 */
export function subscribeToWorkerSyncEvents(callback: (event: WorkerSyncEvent) => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notifyListeners(event: WorkerSyncEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      console.error('[SW Client] Error en listener de evento SW:', e);
    }
  }
}
