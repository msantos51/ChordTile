// Tile by Tile: o percurso para tocar a música de cor (módulo puro, testado).
//
// Para cada secção k:
//   1. "learn"  — aprende-se a secção com a tab (em loop);
//   2. "recall" — a tab esconde-se e toca-se a secção só com os quadrados;
//   3. "join"   — (a partir da 2.ª secção) toca-se tudo o que já se sabe, da 1.ª secção até k, sem a tab.
// O último "join" (da 1.ª à última secção) é a música inteira.

export type LearnStep =
  | { kind: 'learn'; sec: number }
  | { kind: 'recall'; sec: number }
  | { kind: 'join'; from: number; to: number };

export function buildSteps(sections: number): LearnStep[] {
  const steps: LearnStep[] = [];
  for (let k = 0; k < sections; k++) {
    steps.push({ kind: 'learn', sec: k }, { kind: 'recall', sec: k });
    if (k > 0) steps.push({ kind: 'join', from: 0, to: k });
  }
  return steps;
}

/** Secções que o passo toca: [primeira, última]. */
export const stepRange = (s: LearnStep): [number, number] => (s.kind === 'join' ? [s.from, s.to] : [s.sec, s.sec]);

/** A secção a que o passo pertence no percurso (o "join" pertence à última secção que junta). */
export const stepSection = (s: LearnStep) => (s.kind === 'join' ? s.to : s.sec);

/** O passo final: tocar a música inteira sem a tab. */
export const isFinal = (steps: LearnStep[], i: number) => steps.length > 0 && i === steps.length - 1;

/** Voltas seguidas (sem espreitar a tab) para o passo ficar "conseguido". A música toda basta uma vez. */
export function runsGoal(steps: LearnStep[], i: number): number {
  const s = steps[i];
  if (!s) return 0;
  if (isFinal(steps, i)) return 1;
  return s.kind === 'join' ? 2 : 3;
}

/** Primeiro passo de uma secção (o "learn"). */
export const firstStepOf = (steps: LearnStep[], sec: number) =>
  Math.max(0, steps.findIndex(s => s.kind === 'learn' && s.sec === sec));

/**
 * Secções já sabidas de cor: as que já se tocaram sem a tab (passou-se o "recall").
 * `recallDone`: o passo atual é um "recall" e já se fizeram as voltas pedidas (acende logo a secção).
 */
export function knownSections(steps: LearnStep[], i: number, recallDone = false): boolean[] {
  const n = steps.reduce((m, s) => Math.max(m, stepSection(s) + 1), 0);
  const known = Array<boolean>(n).fill(false);
  steps.forEach((s, j) => {
    if (s.kind === 'recall' && (j < i || (j === i && recallDone))) known[s.sec] = true;
  });
  return known;
}

/** Até que secção (inclusive) já se tocou tudo seguido, sem a tab. -1 se ainda nenhuma. */
export function connectedTo(steps: LearnStep[], i: number, currentDone = false): number {
  let to = -1;
  steps.forEach((s, j) => {
    if (j > i || (j === i && !currentDone)) return;
    if (s.kind === 'join') to = Math.max(to, s.to);
    // A 1.ª secção "de cor" já é uma ligação (até ela própria)
    if (s.kind === 'recall' && s.sec === 0) to = Math.max(to, 0);
  });
  return to;
}

/** Percentagem da música (em compassos) que já se sabe de cor. */
export function byHeartPct(known: boolean[], barsPerSection: number[]): number {
  const total = barsPerSection.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  const got = barsPerSection.reduce((a, b, k) => a + (known[k] ? b : 0), 0);
  return Math.round((got / total) * 100);
}

/** O passo guardado na conta. Versão 2 = este percurso; sem versão = o antigo (com a tab · quadrados por secção, e a música no fim). */
export interface SavedLearn { v?: number; step: number; /** Já se chegou ao fim (a música toda de cor). */ done?: boolean }
export function restoreStep(saved: SavedLearn | null | undefined, steps: LearnStep[], sections: number): number {
  if (!saved || typeof saved.step !== 'number' || !steps.length) return 0;
  if (saved.v === 2) return Math.max(0, Math.min(Math.round(saved.step), steps.length - 1));
  // Percurso antigo: dois passos por secção e a música toda no fim. Retoma no início da mesma secção.
  if (saved.step >= sections * 2) return steps.length - 1;
  return firstStepOf(steps, Math.max(0, Math.min(Math.floor(saved.step / 2), sections - 1)));
}
