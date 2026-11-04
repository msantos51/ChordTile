// Progresso por secção (funcionalidade Premium).
// Módulo puro: o leitor diz quando acaba uma volta do loop e quanto tempo se tocou.

/** Progresso de uma secção (identificada pelo compasso onde começa). */
export interface SectionProgress {
  /** Tempo a tocar dentro da secção, em milissegundos. */
  ms: number;
  /** Voltas completas do loop desta secção. */
  loops: number;
  /** Voltas completas a 100 % ou mais. */
  fullSpeedLoops: number;
  /** Maior velocidade a que se completou uma volta. */
  best: number;
  /** Último dia em que se praticou. */
  lastAt: number;
}
export type SongProgress = Record<number, SectionProgress>;

/** Voltas a 100 % para considerar a secção dominada. */
export const MASTERED_LOOPS = 3;

const empty = (): SectionProgress => ({ ms: 0, loops: 0, fullSpeedLoops: 0, best: 0, lastAt: 0 });

export function addTime(p: SongProgress, sectionStart: number, ms: number, now = Date.now()): SongProgress {
  if (!(ms > 0)) return p;
  const s = p[sectionStart] ?? empty();
  // Pausas longas (separador em segundo plano, por exemplo) não contam
  return { ...p, [sectionStart]: { ...s, ms: s.ms + Math.min(ms, 5000), lastAt: now } };
}

export function addLoop(p: SongProgress, sectionStart: number, speed: number, now = Date.now()): SongProgress {
  const s = p[sectionStart] ?? empty();
  return {
    ...p,
    [sectionStart]: {
      ...s, loops: s.loops + 1, fullSpeedLoops: s.fullSpeedLoops + (speed >= 100 ? 1 : 0),
      best: Math.max(s.best, speed), lastAt: now,
    },
  };
}

export const isMastered = (s: SectionProgress | undefined) => !!s && s.fullSpeedLoops >= MASTERED_LOOPS;

/** "12 min · best 85%" ou "Mastered · 40 min". Vazio se ainda não praticou. */
export function progressText(s: SectionProgress | undefined): string {
  if (!s || (s.ms < 30_000 && !s.loops)) return '';
  const min = Math.round(s.ms / 60_000);
  const time = min < 1 ? '<1 min' : min + ' min';
  if (isMastered(s)) return 'Mastered · ' + time;
  return time + (s.best ? ' · best ' + s.best + '%' : '');
}

/** Resumo da música: secções dominadas e tempo total. */
export function songSummary(p: SongProgress, sectionStarts: number[]): { mastered: number; total: number; minutes: number } {
  const minutes = Math.round(Object.values(p).reduce((a, s) => a + s.ms, 0) / 60_000);
  return { mastered: sectionStarts.filter(k => isMastered(p[k])).length, total: sectionStarts.length, minutes };
}
