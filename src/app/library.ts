// Biblioteca de músicas importadas, guardada só neste browser (IndexedDB).
// Os ficheiros nunca saem do dispositivo: isto é só para não ter de os voltar a carregar.

export interface SongMeta {
  /** Identificador estável da música (título | artista | nº de compassos). */
  id: string;
  fileName: string;
  title: string;
  artist: string;
  bars: number;
  addedAt: number;
  openedAt: number;
}
interface SongRecord extends SongMeta { bytes: ArrayBuffer }

const DB = 'mapa-de-compassos';
const STORE = 'songs';
/** Ficheiro escolhido na página inicial, à espera de ser aberto no leitor. */
const PENDING = 'pending';

function open(idb: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PENDING)) db.createObjectStore(PENDING);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>, idb?: IDBFactory, store = STORE): Promise<T> {
  return open(idb).then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = () => { db.close(); reject(t.error ?? req.error); };
    t.onabort = () => { db.close(); reject(t.error ?? new Error('Operation aborted')); };
  }));
}

/** Guarda (ou atualiza) uma música. Mantém a data em que foi adicionada pela primeira vez. */
export async function saveSong(meta: Omit<SongMeta, 'addedAt' | 'openedAt'>, bytes: Uint8Array, idb?: IDBFactory): Promise<void> {
  const prev = await getSong(meta.id, idb).catch(() => null);
  const now = Date.now();
  const copy = bytes.slice().buffer as ArrayBuffer;
  const rec: SongRecord = { ...meta, bytes: copy, addedAt: prev?.addedAt ?? now, openedAt: now };
  await tx('readwrite', s => s.put(rec), idb);
}

/** Lista as músicas (sem os ficheiros), da aberta mais recentemente para a mais antiga. */
export async function listSongs(idb?: IDBFactory): Promise<SongMeta[]> {
  const all = await tx<SongRecord[]>('readonly', s => s.getAll() as IDBRequest<SongRecord[]>, idb);
  return all
    .map(({ bytes: _bytes, ...meta }) => meta)
    .sort((a, b) => b.openedAt - a.openedAt);
}

export async function getSong(id: string, idb?: IDBFactory): Promise<(SongMeta & { bytes: Uint8Array }) | null> {
  const rec = await tx<SongRecord | undefined>('readonly', s => s.get(id) as IDBRequest<SongRecord | undefined>, idb);
  return rec ? { ...rec, bytes: new Uint8Array(rec.bytes) } : null;
}

/** Marca a música como aberta agora (para aparecer em primeiro e abrir ao voltar ao site). */
export async function touchSong(id: string, idb?: IDBFactory, at = Date.now()): Promise<void> {
  const rec = await tx<SongRecord | undefined>('readonly', s => s.get(id) as IDBRequest<SongRecord | undefined>, idb);
  if (rec) await tx('readwrite', s => s.put({ ...rec, openedAt: at }), idb);
}

/** Guarda uma música tal como veio da nuvem (mantém as datas de quando foi adicionada e aberta). */
export async function putSong(meta: SongMeta, bytes: Uint8Array, idb?: IDBFactory): Promise<void> {
  const copy = bytes.slice().buffer as ArrayBuffer;
  await tx('readwrite', s => s.put({ ...meta, bytes: copy } satisfies SongRecord), idb);
}

export async function deleteSong(id: string, idb?: IDBFactory): Promise<void> {
  await tx('readwrite', s => s.delete(id), idb);
}

/** Ficheiro escolhido na página inicial: fica guardado até o leitor o abrir (só um de cada vez). */
export interface PendingFile { name: string; bytes: Uint8Array }

export async function setPendingFile(name: string, bytes: Uint8Array, idb?: IDBFactory): Promise<void> {
  const copy = bytes.slice().buffer as ArrayBuffer;
  await tx('readwrite', s => s.put({ name, bytes: copy }, 'file'), idb, PENDING);
}

/** Devolve o ficheiro pendente (ou null) e apaga-o, para não voltar a abrir na visita seguinte. */
export async function takePendingFile(idb?: IDBFactory): Promise<PendingFile | null> {
  const rec = await tx<{ name: string; bytes: ArrayBuffer } | undefined>('readonly', s => s.get('file'), idb, PENDING);
  if (!rec) return null;
  await tx('readwrite', s => s.delete('file'), idb, PENDING);
  return { name: rec.name, bytes: new Uint8Array(rec.bytes) };
}

/** Pede ao browser para não apagar estes dados quando falta espaço (sobretudo no Safari). */
export function askPersistentStorage(): void {
  try { void navigator.storage?.persist?.(); } catch { /* sem suporte */ }
}

/** "há 3 dias", "hoje", … */
export function relativeDay(ts: number, now = Date.now()): string {
  const days = Math.floor((now - ts) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : months + ' months ago';
}
