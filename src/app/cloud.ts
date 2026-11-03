// Conta e sincronização de "My songs" entre dispositivos (Supabase).
// Só fica ativo se o site for compilado com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY;
// sem isso, tudo continua a funcionar só neste browser, como antes.

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { planSync, storageKey, type RemoteSong } from './cloud-plan';
import type { Entitlement } from './plan';
import { deleteSong, getSong, listSongs, putSong, touchSong, type SongMeta } from './library';

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
  }));
  return client;
}

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
  cb(toAccount(data.session));
  c.auth.onAuthStateChange((e, s) => cb(toAccount(s), e === 'PASSWORD_RECOVERY'));
}

const pageUrl = (page: string) => new URL(page, location.href).href.split('?')[0].split('#')[0];

/** Cria a conta. `needsConfirm`: o Supabase pede para confirmar o email antes de entrar. */
export async function signUp(email: string, password: string, name: string): Promise<{ needsConfirm: boolean }> {
  const c = await sb();
  const { data, error } = await c.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: pageUrl('player.html') } });
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
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('account.html') + '?reset=1' });
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
  const { error } = await c.auth.updateUser({ email }, { emailRedirectTo: pageUrl('account.html') });
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
const fromRow = (r: Row): RemoteSong => ({
  id: r.id, fileName: r.file_name, title: r.title, artist: r.artist, bars: r.bars,
  addedAt: ms(r.added_at), openedAt: ms(r.opened_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : null,
});
const toRow = (uid: string, s: SongMeta) => ({
  user_id: uid, id: s.id, file_name: s.fileName, title: s.title, artist: s.artist, bars: s.bars,
  added_at: iso(s.addedAt), opened_at: iso(s.openedAt), deleted_at: null,
});

async function uid(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getSession();
  if (!data.session) throw new Error('Not signed in');
  return data.session.user.id;
}

/** Envia uma música (ficheiro e dados) para a conta. */
export async function uploadSong(id: string): Promise<void> {
  const c = await sb(); const u = await uid(c);
  const song = await getSong(id);
  if (!song) return;
  const { bytes, ...meta } = song;
  const path = u + '/' + await storageKey(id);
  const up = await c.storage.from(BUCKET).upload(path, bytes, { upsert: true, contentType: 'application/octet-stream' });
  if (up.error) throw up.error;
  const { error } = await c.from('songs').upsert(toRow(u, meta));
  if (error) throw error;
}

/** Marca a música como apagada na conta (os outros dispositivos apagam-na na próxima sincronização). */
export async function deleteRemoteSong(id: string): Promise<void> {
  const c = await sb(); const u = await uid(c);
  const now = iso(Date.now());
  const { error } = await c.from('songs').update({ deleted_at: now, opened_at: now }).eq('user_id', u).eq('id', id);
  if (error) throw error;
  await c.storage.from(BUCKET).remove([u + '/' + await storageKey(id)]);
}

export interface SyncResult { uploaded: number; downloaded: number; deleted: number }

/** Junta "My songs" deste browser com a conta: o que falta de cada lado passa para o outro. */
export async function syncLibrary(): Promise<SyncResult> {
  const c = await sb(); const u = await uid(c);
  const { data, error } = await c.from('songs').select('id,file_name,title,artist,bars,added_at,opened_at,deleted_at').eq('user_id', u);
  if (error) throw error;
  const remote = (data as Row[]).map(fromRow);
  const plan = planSync(await listSongs(), remote);

  for (const id of plan.upload) await uploadSong(id);
  for (const id of plan.download) {
    const r = remote.find(s => s.id === id)!;
    const dl = await c.storage.from(BUCKET).download(u + '/' + await storageKey(id));
    if (dl.error || !dl.data) continue; // ficheiro em falta na nuvem: fica para a próxima
    const { deletedAt: _d, ...meta } = r;
    await putSong(meta, new Uint8Array(await dl.data.arrayBuffer()));
  }
  for (const id of plan.deleteLocal) await deleteSong(id);
  for (const id of plan.pushOpened) {
    const l = (await getSong(id))!;
    await c.from('songs').update({ opened_at: iso(l.openedAt) }).eq('user_id', u).eq('id', id);
  }
  for (const p of plan.pullOpened) await touchSong(p.id, undefined, p.openedAt);

  return { uploaded: plan.upload.length, downloaded: plan.download.length, deleted: plan.deleteLocal.length };
}

/** Plano da conta (experiência, subscrição ou vitalícia). null se ainda não houver linha. */
export async function fetchEntitlement(): Promise<Entitlement | null> {
  const c = await sb(); const u = await uid(c);
  const { data, error } = await c.from('entitlements').select('plan,trial_ends_at,premium_until').eq('user_id', u).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as { plan: Entitlement['plan']; trial_ends_at: string; premium_until: string | null };
  return { plan: r.plan, trialEndsAt: ms(r.trial_ends_at), premiumUntil: r.premium_until ? ms(r.premium_until) : null };
}
