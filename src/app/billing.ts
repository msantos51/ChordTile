// Pagamentos com Stripe Payment Links (sem servidor próprio para o checkout).
// Cada link leva o id da conta (client_reference_id); a função stripe-webhook do Supabase
// recebe o pagamento e ativa o Premium dessa conta.

import type { Account } from './cloud';

export type Offer = 'monthly' | 'yearly' | 'lifetime';

const LINKS: Record<Offer, string | undefined> = {
  monthly: import.meta.env.VITE_STRIPE_LINK_MONTHLY,
  yearly: import.meta.env.VITE_STRIPE_LINK_YEARLY,
  lifetime: import.meta.env.VITE_STRIPE_LINK_LIFETIME,
};
/** Portal do cliente da Stripe (cancelar, mudar cartão, faturas). */
export const portalUrl: string | null = import.meta.env.VITE_STRIPE_PORTAL_URL || null;

export const OFFERS: { id: Offer; name: string; price: string; per: string; note: string }[] = [
  { id: 'monthly', name: 'Monthly', price: '€3.99', per: '/ month', note: 'Cancel anytime' },
  { id: 'yearly', name: 'Yearly', price: '€29', per: '/ year', note: 'Save 40%' },
  { id: 'lifetime', name: 'Lifetime', price: '€49', per: 'once', note: 'Founder price' },
];

export const paymentsEnabled = (o: Offer) => !!LINKS[o];

/** Link de pagamento para esta conta (ou null se ainda não estiver configurado). */
export function checkoutUrl(o: Offer, a: Account): string | null {
  const link = LINKS[o];
  if (!link) return null;
  const u = new URL(link);
  u.searchParams.set('client_reference_id', a.id);
  if (a.email) u.searchParams.set('prefilled_email', a.email);
  return u.href;
}
