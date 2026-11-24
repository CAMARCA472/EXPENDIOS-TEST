import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'FAILED' | 'CONFLICT';

export interface OutboxEvent {
  eventId: string;
  commitId: string;
  revision: number;
  entityType: string;
  entityId: string;
  payload: any;
  checksum: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  status: OutboxStatus;
  lastError: string | null;
  nextAttemptAt: number | null;
}

const OUTBOX_STORAGE_FILE = path.join(process.cwd(), 'data', '.outbox_events.json');

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadOutboxFromDisk(): Map<string, OutboxEvent> {
  const map = new Map<string, OutboxEvent>();
  try {
    if (fs.existsSync(OUTBOX_STORAGE_FILE)) {
      const raw = fs.readFileSync(OUTBOX_STORAGE_FILE, 'utf-8');
      const list: OutboxEvent[] = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.eventId) {
            map.set(item.eventId, item);
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[Outbox] Advertencia cargando outbox desde disco:', err.message);
  }
  return map;
}

function saveOutboxToDisk(map: Map<string, OutboxEvent>) {
  try {
    ensureDir(OUTBOX_STORAGE_FILE);
    const list = Array.from(map.values());
    const tempFile = `${OUTBOX_STORAGE_FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tempFile, JSON.stringify(list, null, 2), 'utf-8');
    fs.renameSync(tempFile, OUTBOX_STORAGE_FILE);
  } catch (err: any) {
    console.error('[Outbox] Error persistiendo outbox a disco:', err.message);
  }
}

const inMemoryOutbox: Map<string, OutboxEvent> = loadOutboxFromDisk();

export function calculatePayloadChecksum(payload: any): string {
  try {
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHash('sha256').update(str).digest('hex');
  } catch {
    return crypto.createHash('sha256').update(String(payload)).digest('hex');
  }
}

export function generateEventId(prefix = 'evt'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Encola un evento en la outbox durable.
 * Si ya existe un evento con el mismo eventId y está CONFIRMED, no se altera (idempotencia).
 */
export function enqueueOutboxEvent(
  params: {
    eventId?: string;
    commitId?: string;
    revision?: number;
    entityType: string;
    entityId: string;
    payload: any;
  }
): OutboxEvent {
  const eventId = params.eventId || generateEventId();
  const existing = inMemoryOutbox.get(eventId);

  if (existing && existing.status === 'CONFIRMED') {
    return existing; // Idempotencia estricta
  }

  const now = new Date().toISOString();
  const checksum = calculatePayloadChecksum(params.payload);

  const event: OutboxEvent = {
    eventId,
    commitId: params.commitId || `c_${params.revision || 0}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    revision: params.revision || 0,
    entityType: params.entityType,
    entityId: params.entityId,
    payload: params.payload,
    checksum,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    attempts: existing ? existing.attempts : 0,
    status: 'PENDING',
    lastError: null,
    nextAttemptAt: Date.now(),
  };

  inMemoryOutbox.set(eventId, event);
  saveOutboxToDisk(inMemoryOutbox);
  return event;
}

export function markOutboxEventProcessing(eventId: string): void {
  const event = inMemoryOutbox.get(eventId);
  if (event) {
    event.status = 'PROCESSING';
    event.attempts += 1;
    event.updatedAt = new Date().toISOString();
    saveOutboxToDisk(inMemoryOutbox);
  }
}

export function markOutboxEventConfirmed(
  eventId: string,
  revision: number,
  commitId: string
): void {
  const event = inMemoryOutbox.get(eventId);
  if (event) {
    event.status = 'CONFIRMED';
    event.revision = revision;
    event.commitId = commitId;
    event.lastError = null;
    event.nextAttemptAt = null;
    event.updatedAt = new Date().toISOString();
    saveOutboxToDisk(inMemoryOutbox);
  }
}

export function markOutboxEventFailed(
  eventId: string,
  errorMsg: string,
  isConflict = false
): void {
  const event = inMemoryOutbox.get(eventId);
  if (event) {
    event.status = isConflict ? 'CONFLICT' : 'FAILED';
    event.lastError = errorMsg;
    event.updatedAt = new Date().toISOString();
    // Backoff exponencial para el siguiente reintento si es recuperable
    const backoffMs = Math.min(300000, 1000 * Math.pow(2, Math.min(event.attempts, 6)));
    event.nextAttemptAt = Date.now() + backoffMs;
    saveOutboxToDisk(inMemoryOutbox);
  }
}

export function getOutboxEvent(eventId: string): OutboxEvent | null {
  return inMemoryOutbox.get(eventId) || null;
}

export function hasProcessedOutboxEvent(eventId: string): boolean {
  const event = inMemoryOutbox.get(eventId);
  return event ? event.status === 'CONFIRMED' : false;
}

export function getPendingOutboxEvents(): OutboxEvent[] {
  const now = Date.now();
  return Array.from(inMemoryOutbox.values()).filter(
    (e) => (e.status === 'PENDING' || e.status === 'PROCESSING' || e.status === 'FAILED') &&
           (e.nextAttemptAt === null || e.nextAttemptAt <= now)
  );
}

export function getOutboxSummary(): {
  total: number;
  pending: number;
  processing: number;
  confirmed: number;
  failed: number;
  conflict: number;
} {
  let pending = 0;
  let processing = 0;
  let confirmed = 0;
  let failed = 0;
  let conflict = 0;

  for (const e of inMemoryOutbox.values()) {
    if (e.status === 'PENDING') pending++;
    else if (e.status === 'PROCESSING') processing++;
    else if (e.status === 'CONFIRMED') confirmed++;
    else if (e.status === 'FAILED') failed++;
    else if (e.status === 'CONFLICT') conflict++;
  }

  return {
    total: inMemoryOutbox.size,
    pending,
    processing,
    confirmed,
    failed,
    conflict,
  };
}
