// Plano de sincronização entre "My songs" deste browser e a conta na nuvem.
// Módulo puro (sem rede nem IndexedDB) para poder ser testado.

import type { SongMeta } from './library';

/** Linha da tabela `songs` na nuvem (datas em milissegundos). */
export interface RemoteSong extends SongMeta {
  /** Quando a música foi apagada (noutro dispositivo); null se continua na biblioteca. */
  deletedAt: number | null;
}

export interface SyncPlan {
  /** Existem só aqui (ou foram reimportadas depois de apagadas): enviar ficheiro e dados. */
  upload: string[];
  /** Existem só na nuvem: descarregar para este browser. */
  download: string[];
  /** Foram apagadas noutro dispositivo depois da última vez que foram abertas aqui. */
  deleteLocal: string[];
  /** Abertas aqui mais recentemente: atualizar a data na nuvem. */
  pushOpened: string[];
  /** Abertas noutro dispositivo mais recentemente: atualizar a data aqui. */
  pullOpened: { id: string; openedAt: number }[];
}

export function planSync(local: SongMeta[], remote: RemoteSong[]): SyncPlan {
  const plan: SyncPlan = { upload: [], download: [], deleteLocal: [], pushOpened: [], pullOpened: [] };
  const here = new Map(local.map(s => [s.id, s]));
  const there = new Map(remote.map(s => [s.id, s]));

  for (const l of local) {
    const r = there.get(l.id);
    if (!r) plan.upload.push(l.id);
    else if (r.deletedAt !== null) {
      // Apagada noutro dispositivo: só a mantemos se foi aberta (ou reimportada) aqui depois disso
      if (l.openedAt > r.deletedAt) plan.upload.push(l.id);
      else plan.deleteLocal.push(l.id);
    } else if (l.openedAt > r.openedAt) plan.pushOpened.push(l.id);
    else if (r.openedAt > l.openedAt) plan.pullOpened.push({ id: l.id, openedAt: r.openedAt });
  }
  for (const r of remote) {
    if (r.deletedAt === null && !here.has(r.id)) plan.download.push(r.id);
  }
  return plan;
}

/** Nome do ficheiro na nuvem: o id da música tem espaços e "|", por isso usamos o seu SHA-256. */
export async function storageKey(id: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
