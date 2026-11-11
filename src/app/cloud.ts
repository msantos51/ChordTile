// Conta (Supabase): sessão, "My songs" e os dados de cada pessoa.
// Tudo fica na conta: as músicas (ficheiro no Storage + linha em `songs`) e os dados (tabela `user_data`:
// notas, secções, progresso, Tile by Tile, preferências). O browser só guarda a sessão de login.
// Só fica ativo se o site for compilado com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { storageKey } from './cloud-plan';
import type { Entitlement } from './plan';
import type { SongMeta } from './library';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const BUCKET = 'songs';

export const cloudEnabled = Boolean(URL_ && KEY);

let client: Promise<SupabaseClient> | null = null;
/** O cliente só é descarregado quando é preciso (não pesa no arranque de quem não usa conta). */
function sb(): Promise<SupabaseClient> {
  if (!cloudEnabled) return Promise.reject(new Error('Cloud sync is not configured'));
  client ??= import('@supabase/supabase-js').then(m => m.createClient(URL_!, KEY!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    global: { fetch: keepaliveFetch },
  }));
  return client;
}

/**
 * As gravações dos dados da pessoa (user_data) são pedidos "keepalive": se a página fechar com uma a meio,
 * o browser acaba-a na mesma (um pedido normal era cancelado e a alteração perdia-se).
 */
const keepaliveFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const small = typeof init?.body === 'string' && init.body.length < KEEPALIVE_MAX / 2;
  if (init?.method === 'POST' && small && url.includes('/rest/v1/user_data')) {
    return fetch(input, { ...init, keepalive: true }).catch(() => fetch(input, init)); // (recusado pelo limite do browser: pedido normal)
  }
  return fetch(input, init);
};

export interface Account { id: string; email: string; name: string }
const toAccount = (s: Session | null): Account | null =>
  s ? { id: s.user.id, email: s.user.email ?? '', name: String(s.user.user_metadata?.name ?? '') } : null;

/**
 * Chama `cb` agora com a conta atual (ou null) e sempre que a sessão mudar.
 * `recovery` é true quando a pessoa chegou por um link de "nova palavra-passe".
 */
export async function watchAccount(cb: (a: Account | null, recovery?: boolean) => void): Promise<void> {
  const c = await sb();
  const { data } = await c.auth.getSession();
  lastSession = data.session;
  cb(toAccount(data.session));
  c.auth.onAuthStateChange((e, s) => { lastSession = s; cb(toAccount(s), e === 'PASSWORD_RECOVERY'); });
}
/** A sessão mais recente (para o envio de última hora ao fechar a página, que não pode esperar por nada). */
let lastSession: Session | null = null;

const pageUrl = (page: string) => new URL(page, location.href).href.split('?')[0].split('#')[0];

/** Cria a conta. `needsConfirm`: o Supabase pede para confirmar o email antes de entrar. */
export async function signUp(email: string, password: string, name: string): Promise<{ needsConfirm: boolean }> {
  const c = await sb();
  const { data, error } = await c.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: pageUrl('/player') } });
  if (error) throw error;
  // Email já registado (o Supabase não o diz, por privacidade): devolve um utilizador sem identidades
  if (data.user && data.user.identities && data.user.identities.length === 0) throw Object.assign(new Error('User already registered'), { code: 'user_already_exists' });
  return { needsConfirm: !data.session };
}

export async function signIn(email: string, password: string): Promise<void> {
  const c = await sb();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Envia o email para escolher uma nova palavra-passe (o link abre a página da conta). */
export async function sendPasswordReset(email: string): Promise<void> {
  const c = await sb();
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('/account') + '?reset=1' });
  if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  const c = await sb();
  const { error } = await c.auth.updateUser({ password });
  if (error) throw error;
}
/** Muda o email: o Supabase envia um link de confirmação para o novo endereço. */
export async function updateEmail(email: string): Promise<void> {
  const c = await sb();
  const { error } = await c.auth.updateUser({ email }, { emailRedirectTo: pageUrl('/account') });
  if (error) throw error;
}
export async function updateName(name: string): Promise<void> {
  const c = await sb();
  const { error } = await c.auth.updateUser({ data: { name } });
  if (error) throw error;
}

export async function signOut(everywhere = false): Promise<void> {
  const c = await sb();
  await c.auth.signOut({ scope: everywhere ? 'global' : 'local' });
}

/** Apaga a conta e tudo o que está nela (função delete-account no servidor). */
export async function deleteAccount(): Promise<void> {
  const c = await sb();
  const { error } = await c.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw error;
  await c.auth.signOut({ scope: 'local' });
}

interface Row {
  id: string; file_name: string; title: string; artist: string; bars: number;
  added_at: string; opened_at: string; deleted_at: string | null;
}
const ms = (t: string) => new Date(t).getTime();
const iso = (t: number) => new Date(t).toISOString();
const fromRow = (r: Row): SongMeta => ({
  id: r.id, fileName: r.file_name, title: r.title, artist: r.artist, bars: r.bars, addedAt: ms(r.added_at), openedAt: ms(r.opened_at),
});

async function uid(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getSession();
  if (!data.session) throw new Error('Not signed in');
  return data.session.user.id;
}

/** Erro "chegou ao limite de músicas do plano" (a regra está no servidor: Gratuito 3, Premium sem limite). */
export class SongLimitError extends Error { constructor() { super('Song limit reached'); this.name = 'SongLimitError'; } }
const isPolicyError = (e: { message?: string; statusCode?: string | number; code?: string } | null) =>
  !!e && (/row-level security|violates|policy/i.test(e.message ?? '') || e.code === '42501' || String(e.statusCode) === '403');

// Cópia em memória (só enquanto a página está aberta; nada fica no browser)
const fileCache = new Map<string, Uint8Array>();

/** "My songs" da conta, da aberta mais recentemente para a mais antiga. */
export async function listAccountSongs(): Promise<SongMeta[]> {
  const c = await sb(); const u = await uid(c);
  const { data, error } = await c.from('songs').select('id,file_name,title,artist,bars,added_at,opened_at,deleted_at')
    .eq('user_id', u).is('deleted_at', null).order('opened_at', { ascending: false });
  if (error) throw error;
  return (data as Row[]).map(fromRow);
}

/** Uma música da conta, com o ficheiro. null se já não existir. */
export async function getAccountSong(id: string): Promise<(SongMeta & { bytes: Uint8Array }) | null> {
  const c = await sb(); const u = await uid(c);
  const { data, error } = await c.from('songs').select('id,file_name,title,artist,bars,added_at,opened_at,deleted_at')
    .eq('user_id', u).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  let bytes = fileCache.get(id);
  if (!bytes) {
    const dl = await c.storage.from(BUCKET).download(u + '/' + await storageKey(id));
    if (dl.error || !dl.data) throw dl.error ?? new Error('File missing');
    bytes = new Uint8Array(await dl.data.arrayBuffer());
    fileCache.set(id, bytes);
  }
  return { ...fromRow(data as Row), bytes };
}

/**
 * Guarda uma música na conta (ficheiro e dados). Voltar a guardar uma que já existe só atualiza a data.
 * Lança SongLimitError se o plano já não deixar guardar mais.
 */
export async function addAccountSong(meta: Omit<SongMeta, 'addedAt' | 'openedAt'>, bytes: Uint8Array): Promise<void> {
  const c = await sb(); const u = await uid(c);
  const now = iso(Date.now());
  const { data: existing, error: readErr } = await c.from('songs').select('id,deleted_at').eq('user_id', u).eq('id', meta.id).maybeSingle();
  if (readErr) throw readErr;
  const path = u + '/' + await storageKey(meta.id);
  const opts = { contentType: 'application/octet-stream' };
  const files = c.storage.from(BUCKET);
  // Música que já está na conta: substitui o ficheiro (uma substituição não conta para o limite do plano).
  // Enviar como novo com "upsert" passava pela regra de criação e era recusado a quem já está no limite.
  let up = existing ? await files.update(path, bytes, opts) : null;
  if (!up || up.error) up = await files.upload(path, bytes, { ...opts, upsert: true });
  if (up.error && isPolicyError(up.error as never) && await pruneOrphanFiles(c, u)) {
    // Havia ficheiros sem música (um apagar que ficou a meio) a ocupar o limite: tenta outra vez
    up = await files.upload(path, bytes, { ...opts, upsert: true });
  }
  if (up.error) { if (isPolicyError(up.error as never)) throw new SongLimitError(); throw up.error; }
  const row = { user_id: u, id: meta.id, file_name: meta.fileName, title: meta.title, artist: meta.artist, bars: meta.bars, opened_at: now, deleted_at: null };
  const { error } = existing
    ? await c.from('songs').update({ ...row, ...(existing.deleted_at ? { added_at: now } : {}) }).eq('user_id', u).eq('id', meta.id)
    : await c.from('songs').insert({ ...row, added_at: now });
  if (error) {
    if (!existing) await c.storage.from(BUCKET).remove([path]); // não deixar o ficheiro sem a linha
    if (isPolicyError(error)) throw new SongLimitError();
    throw error;
  }
  fileCache.set(meta.id, bytes);
}

/**
 * Apaga da pasta da pessoa os ficheiros que já não pertencem a nenhuma música (ficam quando apagar uma música
 * falha a meio, e contam para o limite do plano). Devolve true se apagou algum.
 */
async function pruneOrphanFiles(c: SupabaseClient, u: string): Promise<boolean> {
  const rows = await c.from('songs').select('id').eq('user_id', u).is('deleted_at', null);
  const list = await c.storage.from(BUCKET).list(u, { limit: 1000 });
  if (rows.error || list.error || !list.data) return false; // sem certeza do que existe, não se apaga nada
  const keep = new Set(await Promise.all((rows.data as { id: string }[]).map(r => storageKey(r.id))));
  const orphans = list.data.filter(f => !keep.has(f.name)).map(f => u + '/' + f.name);
  if (!orphans.length) return false;
  const rm = await c.storage.from(BUCKET).remove(orphans);
  return !rm.error;
}

/** Marca a música como aberta agora (para abrir a última da próxima vez, em qualquer dispositivo). */
export async function touchAccountSong(id: string): Promise<void> {
  const c = await sb(); const u = await uid(c);
  await c.from('songs').update({ opened_at: iso(Date.now()) }).eq('user_id', u).eq('id', id);
}

/** Apaga a música da conta: a linha, o ficheiro e os dados dela (notas, progresso, Tile by Tile). */
export async function deleteAccountSong(id: string): Promise<void> {
  const c = await sb(); const u = await uid(c);
  const { error } = await c.from('songs').delete().eq('user_id', u).eq('id', id);
  if (error) throw error;
  await c.storage.from(BUCKET).remove([u + '/' + await storageKey(id)]);
  await c.from('user_data').delete().eq('user_id', u).in('key', songDataKeys(id));
  fileCache.delete(id);
}
/** Chaves de `user_data` que pertencem a uma música. */
export const songDataKeys = (id: string) => ['mapa:' + id, 'mapa:progress:' + id, 'mapa:learn:' + id];

// ---------- Dados da pessoa (tabela user_data) ----------

/** Todos os dados da pessoa (chave → valor). */
export async function loadUserData(): Promise<Record<string, unknown>> {
  const c = await sb(); const u = await uid(c);
  const { data, error } = await c.from('user_data').select('key,value').eq('user_id', u);
  if (error) throw error;
  return Object.fromEntries((data as { key: string; value: unknown }[]).map(r => [r.key, r.value]));
}

/** Guarda vários valores de uma vez (o site junta as alterações e envia-as a cada poucos segundos). */
export async function saveUserData(entries: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(entries); if (!keys.length) return;
  const c = await sb(); const u = await uid(c);
  const now = iso(Date.now());
  const { error } = await c.from('user_data').upsert(keys.map(key => ({ user_id: u, key, value: entries[key], updated_at: now })));
  if (error) throw error;
}

/**
 * Envio de última hora (a página vai fechar ou ficar em segundo plano): um pedido "keepalive", que o browser
 * acaba mesmo depois de a página fechar, começado logo, sem esperar por nada. Devolve null se não o puder fazer.
 */
export function saveUserDataOnExit(entries: Record<string, unknown>): Promise<void> | null {
  const keys = Object.keys(entries), s = lastSession;
  if (!keys.length || !s || !cloudEnabled) return null;
  if ((s.expires_at ?? Infinity) * 1000 < Date.now()) return null; // sessão por renovar: o servidor recusava
  const now = iso(Date.now());
  const body = JSON.stringify(keys.map(key => ({ user_id: s.user.id, key, value: entries[key], updated_at: now })));
  if (new TextEncoder().encode(body).length > KEEPALIVE_MAX) return null;
  try {
    return fetch(URL_ + '/rest/v1/user_data?on_conflict=user_id%2Ckey', {
      method: 'POST', keepalive: true, body,
      headers: { apikey: KEY!, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); });
  } catch { return null; }
}
/** Os pedidos keepalive de uma página não podem passar, todos juntos, de 64 KB: fica-se bem abaixo. */
const KEEPALIVE_MAX = 30_000;

/** Plano da conta (experiência, subscrição ou vitalícia). null se ainda não houver linha. */
export async function fetchEntitlement(): Promise<Entitlement | null> {
  const c = await sb(); const u = await uid(c);
  const { data, error } = await c.from('entitlements').select('plan,trial_ends_at,premium_until').eq('user_id', u).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as { plan: Entitlement['plan']; trial_ends_at: string; premium_until: string | null };
  return { plan: r.plan, trialEndsAt: ms(r.trial_ends_at), premiumUntil: r.premium_until ? ms(r.premium_until) : null };
}
