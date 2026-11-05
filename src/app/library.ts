// "My songs" vive na conta (ver cloud.ts). Este módulo só sabe ler o que versões antigas do site
// deixaram NESTE browser (músicas em IndexedDB e dados em localStorage), para os passar para a conta
// uma única vez e depois apagar tudo do browser.

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
/** Prefixo das chaves que o site antigo guardava no localStorage. */
const PREFIX = 'mapa:';

/** Abre a base antiga só se existir (nunca a cria). */
function openExisting(idb: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    let created = false;
    const req = idb.open(DB);
    req.onupgradeneeded = () => { created = true; };
    req.onsuccess = () => {
      const db = req.result;
      if (created || !db.objectStoreNames.contains(STORE)) {
        db.close();
        if (!created) { resolve(null); return; }
        // Abrir criou uma base vazia: apaga-a logo, para não deixar nada no browser
        const del = idb.deleteDatabase(DB); del.onsuccess = del.onerror = del.onblocked = () => resolve(null);
        return;
      }
      resolve(db);
    };
    req.onerror = () => resolve(null);
  });
}

/** Músicas que versões antigas guardaram neste browser (da aberta mais recentemente para a mais antiga). */
export async function readLegacySongs(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<(SongMeta & { bytes: Uint8Array })[]> {
  if (!idb) return [];
  const db = await openExisting(idb);
  if (!db) return [];
  const all = await new Promise<SongRecord[]>(resolve => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<SongRecord[]>;
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
  db.close();
  return all.map(r => ({ ...r, bytes: new Uint8Array(r.bytes) })).sort((a, b) => b.openedAt - a.openedAt);
}

/** Dados que versões antigas guardaram no localStorage (notas, secções, progresso, preferências…). */
export function readLegacyData(ls: Storage | undefined = globalThis.localStorage): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    if (!ls) return out;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const raw = ls.getItem(k);
      try { out[k] = JSON.parse(raw ?? 'null'); } catch { out[k] = raw; }
    }
  } catch { /* sem acesso */ }
  return out;
}

/** Apaga do browser tudo o que versões antigas lá deixaram. */
export async function wipeLegacy(idb: IDBFactory | undefined = globalThis.indexedDB, ls: Storage | undefined = globalThis.localStorage): Promise<void> {
  try {
    if (ls) for (const k of Object.keys(readLegacyData(ls))) ls.removeItem(k);
  } catch { /* sem acesso */ }
  if (!idb) return;
  await new Promise<void>(resolve => {
    try { const r = idb.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => resolve(); } catch { resolve(); }
  });
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
