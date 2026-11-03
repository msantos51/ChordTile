// Planos: Free (com limites) e Premium (experiência de 14 dias, subscrição ou vitalícia).
// A mesma regra está em supabase/migrations/002_entitlements.sql (private.is_premium), que é
// quem manda de facto na sincronização; aqui decide só o que o site mostra.

/** Músicas guardadas em "My songs" no plano Free. */
export const FREE_SONG_LIMIT = 3;
export const TRIAL_DAYS = 14;

/** Linha da tabela `entitlements` (datas em milissegundos). */
export interface Entitlement {
  plan: 'trial' | 'monthly' | 'yearly' | 'lifetime';
  trialEndsAt: number;
  premiumUntil: number | null;
}

export type PlanKind = 'guest' | 'free' | 'trial' | 'monthly' | 'yearly' | 'lifetime';
export interface PlanState {
  kind: PlanKind;
  premium: boolean;
  /** Fim da experiência ou do período pago (para mostrar "faltam N dias"). */
  until: number | null;
}

export const GUEST: PlanState = { kind: 'guest', premium: false, until: null };

export function planState(e: Entitlement | null, now = Date.now()): PlanState {
  if (!e) return { kind: 'free', premium: false, until: null };
  if (e.plan === 'lifetime') return { kind: 'lifetime', premium: true, until: null };
  if (e.premiumUntil !== null && e.premiumUntil > now && e.plan !== 'trial') return { kind: e.plan, premium: true, until: e.premiumUntil };
  if (e.trialEndsAt > now) return { kind: 'trial', premium: true, until: e.trialEndsAt };
  return { kind: 'free', premium: false, until: null };
}

/** Pode guardar esta música em "My songs"? (reabrir uma que já lá está é sempre possível) */
export function canSaveSong(plan: PlanState, savedIds: string[], id: string): boolean {
  return plan.premium || savedIds.includes(id) || savedIds.length < FREE_SONG_LIMIT;
}

export function daysLeft(until: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((until - now) / 86_400_000));
}

/** "Premium trial · 12 days left", "Premium · yearly", "Free"… */
export function planLabel(p: PlanState, now = Date.now()): string {
  switch (p.kind) {
    case 'guest': return 'Free';
    case 'free': return 'Free';
    case 'trial': { const d = daysLeft(p.until!, now); return 'Premium trial · ' + (d === 1 ? '1 day' : d + ' days') + ' left'; }
    case 'monthly': return 'Premium · monthly';
    case 'yearly': return 'Premium · yearly';
    case 'lifetime': return 'Premium · lifetime';
  }
}
