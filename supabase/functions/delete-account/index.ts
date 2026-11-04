// Apaga a conta de quem faz o pedido (sessão no cabeçalho Authorization): cancela a subscrição
// da Stripe (se houver), apaga os ficheiros das músicas e o utilizador. As linhas das tabelas
// songs e entitlements desaparecem em cascata (on delete cascade).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user }, error } = await admin.auth.getUser(jwt);
  if (error || !user) return json({ error: 'Not signed in' }, 401);
  try {
    // 1) Subscrição ativa na Stripe: cancela já (a vitalícia não tem subscrição)
    const { data: ent } = await admin.from('entitlements').select('stripe_subscription_id').eq('user_id', user.id).maybeSingle();
    if (ent?.stripe_subscription_id && STRIPE_KEY) {
      const r = await fetch('https://api.stripe.com/v1/subscriptions/' + ent.stripe_subscription_id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + STRIPE_KEY } });
      if (!r.ok && r.status !== 404) console.error('stripe cancel', r.status, await r.text());
    }
    // 2) Ficheiros das músicas (pasta <user_id>/ do bucket songs)
    // (no máximo 50 voltas: se a remoção falhar, a lista não encolhe e o ciclo nunca acabaria)
    for (let round = 0; round < 50; round++) {
      const { data: files, error: listErr } = await admin.storage.from('songs').list(user.id, { limit: 100 });
      if (listErr) throw listErr;
      if (!files?.length) break;
      const { error: rmErr } = await admin.storage.from('songs').remove(files.map(f => user.id + '/' + f.name));
      if (rmErr) throw rmErr;
      if (files.length < 100) break;
    }
    // 3) O utilizador (e, em cascata, as linhas de songs e entitlements)
    const del = await admin.auth.admin.deleteUser(user.id);
    if (del.error) throw del.error;
    return json({ deleted: true });
  } catch (e) {
    console.error('delete-account', e);
    return json({ error: 'Could not delete the account' }, 500);
  }
});
