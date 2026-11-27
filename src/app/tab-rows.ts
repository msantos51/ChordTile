import type * as AlphaTab from '@coderline/alphatab';

type Track = AlphaTab.model.Track;
type Beat = AlphaTab.model.Beat;

/**
 * Quebras de linha da tablatura calculadas pela densidade das notas.
 *
 * Quando o ficheiro esconde o ritmo na tablatura (sem hastes), o alphaTab acha que cada compasso
 * cabe num espaço mínimo e mete compassos a mais por linha: os números das casas ficam uns em cima
 * dos outros. Aqui estima-se a largura que cada compasso precisa para se ler (cada nota com espaço
 * para o seu número) e parte-se a linha antes de passar da largura disponível.
 *
 * Unidades: as do alphaTab antes da escala (a largura disponível já vem dividida pela escala).
 */

/** Espaço à volta de cada número (unidades sem escala). */
const BEAT_GAP = 14;
/** Largura de cada carácter do número da casa. */
const CHAR_W = 7;
/** Barras e margens de cada compasso. */
const BAR_PAD = 12;
/** Início de cada linha: a clave TAB (e o compasso no primeiro). */
const ROW_PREFIX = 50;
/** Mudança de compasso (4/4, 3/4…) desenhada no próprio compasso. */
const TIME_SIG = 25;

/** Quantos caracteres ocupa o número mais largo de um tempo (acordes ficam empilhados). */
function beatChars(b: Beat): number {
  let w = 1;
  for (const n of b.notes) {
    let c = n.isDead ? 1 : String(Math.max(0, n.fret)).length;
    if (n.isGhost) c += 2; // "(7)"
    if (c > w) w = c;
  }
  return w;
}

/** Largura que o compasso i precisa (o mais denso das pautas e vozes da pista). */
export function barWidth(track: Track, i: number): number {
  let content = 0;
  for (const staff of track.staves) {
    const bar = staff.bars[i];
    if (!bar) continue;
    for (const v of bar.voices) {
      if (v.isEmpty) continue;
      let w = 0;
      for (const b of v.beats) w += BEAT_GAP + CHAR_W * beatChars(b);
      if (w > content) content = w;
    }
  }
  const mb = track.score.masterBars[i];
  const sig = mb && i > 0 && mb.previousMasterBar &&
    (mb.timeSignatureNumerator !== mb.previousMasterBar.timeSignatureNumerator ||
     mb.timeSignatureDenominator !== mb.previousMasterBar.timeSignatureDenominator) ? TIME_SIG : 0;
  return BAR_PAD + content + sig;
}

/**
 * Onde começa cada linha nova (índices dos compassos), entre os compassos [from, to).
 * `maxPerRow` (> 0) é o máximo de compassos por linha escolhido pelo utilizador; o alphaTab já parte
 * aí, por isso aqui só se acompanha a contagem. `fixed` são as quebras que já vinham no ficheiro.
 */
export function rowBreaks(widths: (i: number) => number, from: number, to: number, maxWidth: number,
  maxPerRow = 0, fixed?: ReadonlySet<number>): Set<number> {
  const out = new Set<number>();
  let rowW = 0, count = 0;
  for (let i = from; i < to; i++) {
    const w = widths(i);
    const full = count > 0 && (rowW + w > maxWidth || (maxPerRow > 0 && count >= maxPerRow) || fixed?.has(i));
    if (full) {
      if (rowW + w > maxWidth) out.add(i);
      rowW = 0; count = 0;
    }
    if (count === 0) rowW = ROW_PREFIX + (i === 0 ? TIME_SIG : 0);
    rowW += w; count++;
  }
  return out;
}

/** Quebras que vieram do ficheiro, guardadas antes de as substituirmos. */
const original = new WeakMap<Track, Set<number> | undefined>();

/**
 * Põe na pista as quebras de linha para a largura `width` (px do ecrã). Devolve true se mudaram
 * (é preciso voltar a desenhar). O alphaTab só as vê no próximo render, que lhe envia a música toda.
 */
export function fitTabRows(track: Track, display: AlphaTab.DisplaySettings, width: number): boolean {
  if (!width) return false;
  if (!original.has(track)) original.set(track, track.lineBreaks ? new Set(track.lineBreaks) : undefined);
  const fixed = original.get(track);
  const scale = display.scale || 1;
  const pad = display.padding?.length ? display.padding[0] * 2 : 70;
  const maxWidth = (width - pad) / scale;
  const n = track.score.masterBars.length;
  const from = Math.max(0, (display.startBar || 1) - 1);
  const to = display.barCount > 0 ? Math.min(n, from + display.barCount) : n;
  const ours = rowBreaks(i => barWidth(track, i), from, to, maxWidth, display.barsPerRow, fixed);
  const next = new Set([...(fixed ?? []), ...ours]);
  const prev = track.lineBreaks ?? new Set<number>();
  if (next.size === prev.size && [...next].every(x => prev.has(x))) return false;
  track.lineBreaks = next;
  return true;
}
