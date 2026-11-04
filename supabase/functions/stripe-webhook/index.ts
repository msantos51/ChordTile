// Recebe os eventos da Stripe e atualiza o plano da conta (tabela public.entitlements).
// Segredos (Supabase → Edge Functions → Secrets): STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem em todas as funções.
// Eventos a ativar na Stripe: checkout.session.completed, customer.subscription.updated,
// customer.subscription.deleted.

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

async function stripe(path: string): Promise<Record<string, unknown>> {
  const r = await fetch('https://api.stripe.com/v1/' + path, { headers: { Authorization: 'Bearer ' + STRIPE_KEY } });
  if (!r.ok) throw new Error('Stripe ' + r.status + ': ' + await r.text());
  return r.json();
}

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
    if (event.type === 'checkout.session.completed') {
      const userId = obj.client_reference_id as string | null;
      if (!userId) return new Response('No client_reference_id', { status: 200 });
      if (obj.mode === 'payment' && obj.payment_status === 'paid') {
        const { error } = await db.from('entitlements').upsert({
          user_id: userId, plan: 'lifetime', premium_until: null,
          stripe_customer_id: (obj.customer as string | null) ?? null, updated_at: new Date().toISOString(),
        });
        if (error) throw error;
      } else if (obj.mode === 'subscription' && obj.subscription) {
        // Garante a linha (conta criada antes do período de experiência existir)
        await db.from('entitlements').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
        await applySubscription(await stripe('subscriptions/' + obj.subscription) as unknown as Sub, userId);
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await applySubscription(obj as unknown as Sub);
    }
  } catch (e) {
    console.error(event.type, e);
    return new Response('Error', { status: 500 }); // a Stripe volta a tentar
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
