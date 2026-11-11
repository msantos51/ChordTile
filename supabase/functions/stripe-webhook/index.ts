// Recebe os eventos da Stripe e atualiza o plano da conta (tabela public.entitlements).
// Segredos (Supabase → Edge Functions → Secrets): STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem em todas as funções.
// Eventos a ativar na Stripe: checkout.session.completed, customer.subscription.updated,
// customer.subscription.deleted (e checkout.session.async_payment_succeeded, se houver métodos de
// pagamento que só confirmam mais tarde, como débito direto).

import { createClient } from 'npm:@supabase/supabase-js@2';

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

/** Verifica a assinatura "Stripe-Signature" (HMAC-SHA256 de "<t>.<corpo>"), com 5 min de tolerância. */
async function verify(body: string, header: string | null): Promise<boolean> {
  if (!header || !WEBHOOK_SECRET) return false;
  const t = header.split(',').find(p => p.startsWith('t='))?.slice(2);
  const sigs = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(t + '.' + body)));
  // Comparação em tempo constante (não revela quantos caracteres coincidem)
  const same = (a: string) => { if (a.length !== expected.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ expected.charCodeAt(i); return d === 0; };
  return sigs.some(same);
}

async function stripe(path: string, method = 'GET'): Promise<Record<string, unknown>> {
  const r = await fetch('https://api.stripe.com/v1/' + path, { method, headers: { Authorization: 'Bearer ' + STRIPE_KEY } });
  if (!r.ok) throw new Error('Stripe ' + r.status + ': ' + await r.text());
  return r.json();
}
/** O id da conta vem no link de pagamento (client_reference_id): só se aceita um UUID. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A conta já não existe (apagada entre o pagamento e o aviso): repetir o aviso não resolve nada. */
const isMissingUser = (e: unknown) => (e as { code?: string } | null)?.code === '23503';

type Sub = {
  id: string; customer: string; status: string; ended_at: number | null; current_period_end?: number;
  items?: { data: { current_period_end?: number; price?: { recurring?: { interval?: string } } }[] };
};
/** Fim do período pago (nas versões novas da API está em cada item da subscrição). */
const periodEnd = (s: Sub) => s.current_period_end ?? s.items?.data[0]?.current_period_end ?? null;
const interval = (s: Sub) => (s.items?.data[0]?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly');
const iso = (sec: number | null) => (sec ? new Date(sec * 1000).toISOString() : null);

async function applySubscription(sub: Sub, userId?: string) {
  const active = ['active', 'trialing', 'past_due'].includes(sub.status);
  const until = active ? iso(periodEnd(sub)) : iso(sub.ended_at) ?? new Date().toISOString();
  const row = { plan: interval(sub), premium_until: until, stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, updated_at: new Date().toISOString() };
  // Quem comprou a vitalícia nunca é rebaixado por uma subscrição antiga
  const q = db.from('entitlements').update(row).neq('plan', 'lifetime');
  const { error } = userId ? await q.eq('user_id', userId) : await q.eq('stripe_subscription_id', sub.id);
  if (error) throw error;
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const body = await req.text();
  if (!(await verify(body, req.headers.get('stripe-signature')))) return new Response('Bad signature', { status: 400 });

  const event = JSON.parse(body) as { type: string; data: { object: Record<string, unknown> } };
  const obj = event.data.object;
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const userId = obj.client_reference_id as string | null;
      if (!userId || !UUID_RE.test(userId)) return new Response('No client_reference_id', { status: 200 });
      if (obj.mode === 'payment' && obj.payment_status === 'paid') {
        // Quem tinha uma subscrição e compra a vitalícia deixa de a pagar: cancela-se já, senão continuava a ser cobrada.
        const { data: before } = await db.from('entitlements').select('stripe_subscription_id').eq('user_id', userId).maybeSingle();
        const { error } = await db.from('entitlements').upsert({
          user_id: userId, plan: 'lifetime', premium_until: null, stripe_subscription_id: null,
          stripe_customer_id: (obj.customer as string | null) ?? null, updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        if (before?.stripe_subscription_id) {
          // (Se falhar, por exemplo por a chave não poder cancelar, fica no registo para se cancelar à mão: a vitalícia já está ativa.)
          try { await stripe('subscriptions/' + before.stripe_subscription_id, 'DELETE'); }
          catch (e) { console.error('cancel subscription after lifetime', before.stripe_subscription_id, e); }
        }
      } else if (obj.mode === 'subscription' && obj.subscription) {
        // Garante a linha (conta criada antes do período de experiência existir)
        const { error } = await db.from('entitlements').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
        if (error) throw error;
        await applySubscription(await stripe('subscriptions/' + obj.subscription) as unknown as Sub, userId);
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      // Os avisos podem chegar fora de ordem: usa-se sempre o estado atual da subscrição na Stripe, não o do aviso
      // (um aviso antigo a chegar depois de um novo repunha um período que já passou).
      let sub = obj as unknown as Sub;
      try { sub = await stripe('subscriptions/' + sub.id) as unknown as Sub; }
      catch (e) { if (event.type !== 'customer.subscription.deleted') throw e; }
      await applySubscription(sub);
    }
  } catch (e) {
    console.error(event.type, e);
    if (isMissingUser(e)) return new Response('Account no longer exists', { status: 200 });
    return new Response('Error', { status: 500 }); // a Stripe volta a tentar
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
