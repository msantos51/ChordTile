// Notas de um compasso de uma pista, prontas a desenhar em grande (vista "compasso expandido"),
// com as técnicas de cada nota (hammer-on, bend, slide…) e de cada tempo (slap, dinâmicas…).
import type { model } from '@coderline/alphatab';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Técnicas que o compasso expandido mostra. */
export type TechKind =
  | 'hammer' | 'pull' | 'slideUp' | 'slideDown' | 'slideIn' | 'slideOut' | 'bend' | 'release' | 'prebend'
  | 'vibrato' | 'palmMute' | 'letRing' | 'harmonic' | 'ghost' | 'dead' | 'tie' | 'accent' | 'staccato'
  | 'tap' | 'trill' | 'slap' | 'pop' | 'tremolo' | 'whammy' | 'brushUp' | 'brushDown' | 'pickUp' | 'pickDown';

export interface Tech { kind: TechKind; text: string }

/** Nome de cada técnica, para a legenda. */
export const TECH_NAMES: Record<TechKind, string> = {
  hammer: 'Hammer-on', pull: 'Pull-off', slideUp: 'Slide up', slideDown: 'Slide down', slideIn: 'Slide in', slideOut: 'Slide out',
  bend: 'Bend', release: 'Release', prebend: 'Pre-bend', vibrato: 'Vibrato', palmMute: 'Palm mute', letRing: 'Let ring',
  harmonic: 'Harmonic', ghost: 'Ghost note', dead: 'Dead (muted) note', tie: 'Tied note (held from before)', accent: 'Accent',
  staccato: 'Staccato', tap: 'Tapping', trill: 'Trill', slap: 'Slap', pop: 'Pop', tremolo: 'Tremolo picking', whammy: 'Whammy bar',
  brushUp: 'Strum up', brushDown: 'Strum down', pickUp: 'Upstroke', pickDown: 'Downstroke',
};

/** Dinâmicas do alphaTab (DynamicValue), pela ordem do enum. */
const DYNAMICS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'pppp', 'ppppp', 'pppppp', 'ffff', 'fffff', 'ffffff',
  'sf', 'sfp', 'sfpp', 'fp', 'rf', 'rfz', 'sfz', 'sffz', 'fz', 'n', 'pf', 'sfzp'];
export const DYNAMIC_NAMES: Record<string, string> = {
  pppp: 'pianississimo', ppp: 'pianississimo', pp: 'pianissimo', p: 'piano', mp: 'mezzo-piano', mf: 'mezzo-forte',
  f: 'forte', ff: 'fortissimo', fff: 'fortississimo', ffff: 'fortississimo', sf: 'sforzando', sfz: 'sforzando', fp: 'forte-piano',
};

export interface BarNote {
  /** Início dentro do compasso, em ticks (semínima = 960). */
  start: number;
  /** Linha da tablatura, de cima (0 = corda mais aguda) para baixo. */
  line: number;
  fret: number;
  /** Identificador do tempo (beat) do alphaTab, para acender a nota durante a reprodução. */
  beatId: number;
  dead: boolean;
  /** Nota "fantasma" (tocada muito suave): desenha-se entre parênteses. */
  ghost: boolean;
  /** Continuação de uma nota anterior (ligadura): não se volta a tocar. */
  tied: boolean;
  /** Técnicas desta nota (etiquetas junto à nota). */
  tech: Tech[];
}

/** Técnicas e dinâmica de um tempo (valem para todas as notas desse tempo). */
export interface BarBeat {
  start: number;
  tech: Tech[];
  /** Dinâmica (pp, mf, f…), só quando muda ou no primeiro tempo do compasso. */
  dynamic: string | null;
}

export interface BarView {
  index: number;
  numerator: number;
  denominator: number;
  /** Duração do compasso em ticks. */
  duration: number;
  /** Nomes das cordas, de cima para baixo (ex.: G D A E no baixo). */
  strings: string[];
  notes: BarNote[];
  beats: BarBeat[];
}

// Valores dos enums do alphaTab (o tipo é importado só como tipo, por isso comparam-se números)
const SLIDE_OUT = { Shift: 1, Legato: 2, OutUp: 3, OutDown: 4, PickSlideDown: 5, PickSlideUp: 6 };
const BEND = { Bend: 2, Release: 3, BendRelease: 4, Hold: 5, Prebend: 6, PrebendBend: 7, PrebendRelease: 8 };
const HARMONIC = ['', 'NH', 'AH', 'PH', 'TH', 'SH', 'FH'];

/** Valor de um bend em meios-tons, como se escreve na tab: ½, full, 1½… (os pontos vêm em quartos de tom). */
function bendText(quarterTones: number): string {
  const half = Math.round(quarterTones / 2); // meios-tons
  if (half <= 0) return '¼';
  if (half === 1) return '½';
  if (half === 2) return 'full';
  return (half % 2 ? Math.floor(half / 2) + '½' : String(half / 2));
}

function noteTech(note: model.Note): Tech[] {
  const t: Tech[] = [];
  if (note.isHammerPullOrigin) {
    const to = note.hammerPullDestination;
    t.push(!to || to.fret >= note.fret ? { kind: 'hammer', text: 'H' } : { kind: 'pull', text: 'P' });
  }
  const so = note.slideOutType as number;
  if (so === SLIDE_OUT.Shift || so === SLIDE_OUT.Legato) {
    const to = note.slideTarget;
    t.push(!to || to.fret >= note.fret ? { kind: 'slideUp', text: '/' } : { kind: 'slideDown', text: '\\' });
  } else if (so === SLIDE_OUT.OutUp || so === SLIDE_OUT.PickSlideUp) t.push({ kind: 'slideOut', text: '↗' });
  else if (so === SLIDE_OUT.OutDown || so === SLIDE_OUT.PickSlideDown) t.push({ kind: 'slideOut', text: '↘' });
  if ((note.slideInType as number) > 0) t.push({ kind: 'slideIn', text: (note.slideInType as number) === 1 ? '↗' : '↘' });
  if (note.hasBend) {
    const max = note.maxBendPoint?.value ?? 0, bt = note.bendType as number;
    if (bt === BEND.Release) t.push({ kind: 'release', text: '↓' });
    else if (bt === BEND.Prebend || bt === BEND.PrebendRelease) t.push({ kind: 'prebend', text: 'PB ' + bendText(max) });
    else t.push({ kind: 'bend', text: '↑ ' + bendText(max) + (bt === BEND.BendRelease ? ' ↓' : '') });
  }
  if ((note.vibrato as number) > 0) t.push({ kind: 'vibrato', text: (note.vibrato as number) === 2 ? '≈' : '~' });
  if ((note.harmonicType as number) > 0) t.push({ kind: 'harmonic', text: HARMONIC[note.harmonicType as number] || 'H' });
  if (note.isLeftHandTapped) t.push({ kind: 'tap', text: 'T' });
  if (note.isTrill) t.push({ kind: 'trill', text: 'tr' });
  if ((note.accentuated as number) === 1 || (note.accentuated as number) === 2) t.push({ kind: 'accent', text: (note.accentuated as number) === 2 ? '^' : '>' });
  if (note.isStaccato) t.push({ kind: 'staccato', text: '·' });
  if (note.isPalmMute) t.push({ kind: 'palmMute', text: 'PM' });
  if (note.isLetRing) t.push({ kind: 'letRing', text: 'LR' });
  if (note.isGhost) t.push({ kind: 'ghost', text: '( )' });
  if (note.isDead) t.push({ kind: 'dead', text: 'x' });
  if (note.isTieDestination) t.push({ kind: 'tie', text: '⌒' });
  return t;
}

function beatTech(beat: model.Beat): Tech[] {
  const t: Tech[] = [];
  if (beat.slap) t.push({ kind: 'slap', text: 'S' });
  if (beat.pop) t.push({ kind: 'pop', text: 'P' });
  if (beat.tap) t.push({ kind: 'tap', text: 'T' });
  if (beat.isTremolo) t.push({ kind: 'tremolo', text: 'trem.' });
  if (beat.hasWhammyBar) t.push({ kind: 'whammy', text: 'w/bar' });
  if ((beat.vibrato as number) > 0) t.push({ kind: 'vibrato', text: (beat.vibrato as number) === 2 ? '≈' : '~' });
  const brush = beat.brushType as number;
  if (brush === 1 || brush === 3) t.push({ kind: 'brushUp', text: '↑' });
  else if (brush === 2 || brush === 4) t.push({ kind: 'brushDown', text: '↓' });
  const pick = beat.pickStroke as number;
  if (pick === 1) t.push({ kind: 'pickUp', text: 'V' });
  else if (pick === 2) t.push({ kind: 'pickDown', text: '⊓' });
  return t;
}

/** Extrai as notas do compasso `barIndex` da pista `trackIndex` (todas as vozes da primeira pauta). */
export function barView(score: model.Score, barIndex: number, trackIndex: number): BarView {
  const mb = score.masterBars[barIndex];
  const staff = score.tracks[trackIndex]?.staves[0];
  const tuning = staff?.tuning ?? [];
  const n = tuning.length;
  const notes: BarNote[] = [];
  const byStart = new Map<number, BarBeat>();
  const bar = staff?.bars[barIndex];
  for (const voice of bar?.voices ?? []) {
    for (const beat of voice.beats) {
      if (beat.isRest) continue;
      let stringed = false;
      for (const note of beat.notes) {
        if (!note.isStringed) continue;
        stringed = true;
        // No alphaTab a corda 1 é a mais grave (linha de baixo); a afinação vem da mais aguda para a mais grave.
        // As técnicas que já se veem na própria nota (x, parênteses) não levam etiqueta.
        const tech = noteTech(note).filter(x => x.kind !== 'dead' && x.kind !== 'ghost');
        notes.push({ start: beat.playbackStart, line: n - note.string, fret: note.fret, beatId: beat.id, dead: note.isDead,
          ghost: note.isGhost, tied: note.isTieDestination, tech });
      }
      if (!stringed) continue;
      const b = byStart.get(beat.playbackStart) ?? { start: beat.playbackStart, tech: [], dynamic: DYNAMICS[beat.dynamics as number] ?? null };
      for (const x of beatTech(beat)) if (!b.tech.some(y => y.kind === x.kind)) b.tech.push(x);
      byStart.set(beat.playbackStart, b);
    }
  }
  notes.sort((a, b) => a.start - b.start || a.line - b.line);
  // Dinâmica: só quando muda (o Guitar Pro põe "f" em todas as notas por defeito, por isso não se mostra se nunca muda)
  const beats = [...byStart.values()].sort((a, b) => a.start - b.start);
  let last: string | null = previousDynamic(staff, barIndex);
  for (const b of beats) { if (b.dynamic === last) b.dynamic = null; else last = b.dynamic; }
  return {
    index: barIndex,
    numerator: mb.timeSignatureNumerator,
    denominator: mb.timeSignatureDenominator,
    duration: mb.calculateDuration(),
    strings: tuning.map(v => NAMES[((v % 12) + 12) % 12]),
    notes,
    beats,
  };
}

/** Dinâmica em vigor no fim do compasso anterior ("f", o valor por defeito, no início da música). */
function previousDynamic(staff: model.Staff | undefined, barIndex: number): string {
  for (let i = barIndex - 1; i >= 0; i--) {
    for (const voice of staff?.bars[i]?.voices ?? []) {
      for (let k = voice.beats.length - 1; k >= 0; k--) {
        const b = voice.beats[k];
        if (!b.isRest && b.notes.length) return DYNAMICS[b.dynamics as number] ?? 'f';
      }
    }
  }
  return 'f';
}

/** Técnicas usadas no compasso (para a legenda), pela ordem em que aparecem; as dinâmicas à parte. */
export function techLegend(v: BarView): { kinds: Tech[]; dynamics: string[] } {
  const seen = new Map<TechKind, Tech>();
  for (const nt of v.notes) {
    if (nt.dead) seen.set('dead', { kind: 'dead', text: 'x' });
    if (nt.ghost) seen.set('ghost', { kind: 'ghost', text: '(5)' });
    for (const t of nt.tech) if (!seen.has(t.kind)) seen.set(t.kind, t);
  }
  for (const b of v.beats) for (const t of b.tech) if (!seen.has(t.kind)) seen.set(t.kind, t);
  const dynamics = [...new Set(v.beats.map(b => b.dynamic).filter((d): d is string => !!d))];
  return { kinds: [...seen.values()], dynamics };
}
