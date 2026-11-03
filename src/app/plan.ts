// Planos: Free (com limites) e Premium (experiência de 14 dias, subscrição ou vitalícia).
// A mesma regra está em supabase/migrations/002_entitlements.sql (private.is_premium), que é
// quem manda de facto na sincronização; aqui decide só o que o site mostra.

/** Músicas em "My songs": sem conta 1, conta grátis 3, Premium sem limite. */
export const GUEST_SONG_LIMIT = 1;
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

export const songLimit = (plan: PlanState) => (plan.premium ? Infinity : plan.kind === 'guest' ? GUEST_SONG_LIMIT : FREE_SONG_LIMIT);

/** Pode carregar esta música? (reabrir uma que já está em "My songs" é sempre possível) */
export function canSaveSong(plan: PlanState, savedIds: string[], id: string): boolean {
  return savedIds.includes(id) || savedIds.length < songLimit(plan);
}

/**
 * Funções com cadeado:
 * - tools: loop, velocidade, metrónomo, contagem, play along, solo, praticar secção (precisa de conta)
 * - notes: escrever notas nos quadrados (precisa de conta)
 * - expand, pdf, trainer, progress, sync: Premium
 */
export type Feature = 'tools' | 'notes' | 'expand' | 'pdf' | 'trainer' | 'progress' | 'sync';
const PREMIUM_ONLY: Feature[] = ['expand', 'pdf', 'trainer', 'progress', 'sync'];
/** 'ok' = pode usar; 'account' = precisa de criar conta; 'premium' = precisa do Premium. */
export function access(plan: PlanState, f: Feature): 'ok' | 'account' | 'premium' {
  if (plan.premium) return 'ok';
  if (plan.kind === 'guest') return 'account';
  return PREMIUM_ONLY.includes(f) ? 'premium' : 'ok';
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
