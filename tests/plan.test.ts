import { describe, expect, it } from 'vitest';
import { FREE_SONG_LIMIT, GUEST, access, canSaveSong, planLabel, planState, songLimit } from '../src/app/plan';
import { addLoop, addTime, cleanTrainer, isMastered, nextSpeed, progressText, songSummary } from '../src/app/practice';

const DAY = 86_400_000, now = 1_000 * DAY;

describe('planos', () => {
  it('experiência de 14 dias, depois Free', () => {
    const e = { plan: 'trial' as const, trialEndsAt: now + 3 * DAY, premiumUntil: null };
    expect(planState(e, now)).toEqual({ kind: 'trial', premium: true, until: now + 3 * DAY });
    expect(planLabel(planState(e, now), now)).toBe('Premium trial · 3 days left');
    expect(planState(e, now + 4 * DAY).premium).toBe(false);
  });

  it('subscrição vale até ao fim do período pago; vitalícia vale sempre', () => {
    const sub = { plan: 'yearly' as const, trialEndsAt: 0, premiumUntil: now + DAY };
    expect(planState(sub, now)).toMatchObject({ kind: 'yearly', premium: true });
    expect(planState(sub, now + 2 * DAY)).toMatchObject({ kind: 'free', premium: false });
    expect(planState({ plan: 'lifetime', trialEndsAt: 0, premiumUntil: null }, now + 9999 * DAY).premium).toBe(true);
  });

  it('sem conta 1 música, conta grátis 3, Premium sem limite; reabrir uma guardada é sempre possível', () => {
    const FREE = { kind: 'free' as const, premium: false, until: null };
    const ids = Array.from({ length: FREE_SONG_LIMIT }, (_, i) => 's' + i);
    expect([songLimit(GUEST), songLimit(FREE)]).toEqual([1, 3]);
    expect(canSaveSong(GUEST, [], 'novo')).toBe(true);
    expect(canSaveSong(GUEST, ['s0'], 'novo')).toBe(false);
    expect(canSaveSong(FREE, ids.slice(0, 2), 'novo')).toBe(true);
    expect(canSaveSong(FREE, ids, 'novo')).toBe(false);
    expect(canSaveSong(FREE, ids, 's1')).toBe(true);
    expect(canSaveSong({ kind: 'trial', premium: true, until: now }, ids, 'novo')).toBe(true);
  });
});

describe('cadeados', () => {
  it('sem conta: tudo pede conta; conta grátis: só Expand, PDF e extras pedem Premium', () => {
    const FREE = { kind: 'free' as const, premium: false, until: null }, PRO = { kind: 'yearly' as const, premium: true, until: 1 };
    expect(access(GUEST, 'tools')).toBe('account');
    expect(access(GUEST, 'expand')).toBe('account');
    expect(access(FREE, 'tools')).toBe('ok');
    expect(access(FREE, 'notes')).toBe('ok');
    expect(access(FREE, 'expand')).toBe('premium');
    expect(access(FREE, 'pdf')).toBe('premium');
    expect(access(PRO, 'pdf')).toBe('ok');
  });
});

describe('treino de velocidade', () => {
  it('sobe um passo por volta até ao alvo', () => {
    const t = { start: 60, step: 15, target: 100 };
    expect(nextSpeed(60, t)).toBe(75);
    expect(nextSpeed(90, t)).toBe(100);
    expect(nextSpeed(100, t)).toBe(100);
  });
  it('valores inválidos voltam aos predefinidos e o alvo nunca fica abaixo do início', () => {
    expect(cleanTrainer(null)).toEqual({ start: 60, step: 5, target: 100 });
    expect(cleanTrainer({ start: 90, target: 70, step: 7 })).toEqual({ start: 90, step: 5, target: 90 });
  });
});

describe('progresso por secção', () => {
  it('conta tempo, voltas e a melhor velocidade, e marca como dominada', () => {
    let p = addTime({}, 4, 3 * 60_000 - 1000);
    expect(p[4].ms).toBe(5000); // pausas longas não contam
    for (let i = 0; i < 40; i++) p = addTime(p, 4, 4000);
    p = addLoop(p, 4, 80);
    expect(progressText(p[4])).toBe('3 min · best 80%');
    p = addLoop(addLoop(addLoop(p, 4, 100), 4, 100), 4, 105);
    expect(isMastered(p[4])).toBe(true);
    expect(progressText(p[4])).toBe('Mastered · 3 min');
    expect(songSummary(p, [0, 4, 12])).toEqual({ mastered: 1, total: 3, minutes: 3 });
    expect(progressText(undefined)).toBe('');
  });
});
