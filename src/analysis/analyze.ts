// Deteção do tom (acorde) de cada compasso a partir de um score do alphaTab.
// Módulo puro: não toca no DOM, por isso é testado em Node com ficheiros reais.
import type { model } from '@coderline/alphatab';

type Score = model.Score;
type Track = model.Track;

export interface Chord {
  /** Classe de nota da raiz (0 = C/Dó … 11 = B/Si). */
  pc: number;
  minor: boolean;
  /** O acorde veio escrito no ficheiro (e não da deteção). */
  fromFile?: boolean;
  score?: number;
}

export interface AnalyzeOptions {
  useFileChords?: boolean;
  splitBars?: boolean;
}

export interface LabelOptions {
  showMinor?: boolean;
  latin?: boolean;
  accidentals?: 'auto' | 'sharp' | 'flat';
}

export interface Section {
  name: string;
  /** Índice (0-based) do primeiro compasso da secção. */
  start: number;
}

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LATIN: Record<string, string> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** Deteta se uma pista é de baixo (pelo nome, afinação ou instrumento MIDI). */
export function isBassTrack(track: Track): boolean {
  const name = (track.name || '').toLowerCase();
  if (/bass|baixo|bajo/.test(name)) return true;
  const tuning = track.staves[0]?.tuning;
  if (tuning && tuning.length) {
    return Math.min(...tuning) < 36 && tuning.length <= 6 && Math.max(...tuning) < 50;
  }
  const program = track.playbackInfo ? track.playbackInfo.program : -1;
  return program >= 32 && program <= 39;
}

/** Lê um nome de acorde escrito com letras (ex.: "F#m7", "Bb"). */
export function parseChordName(name: string | null | undefined): { pc: number; minor: boolean } | null {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)(.*)$/.exec(name || '');
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  const minor = /^(m(?!aj)|min|-)/.test(m[3] || '');
  return { pc: mod12(pc), minor };
}

interface Collected {
  hist: number[];
  bassHist: number[];
  total: number;
  chordName: string | null;
  firstBass: number | null;
}

/** Recolhe as notas de um compasso (ou de uma fatia dele) para as pistas escolhidas. */
function collect(score: Score, barIndex: number, trackIdx: number[], from: number, to: number): Collected {
  const hist = new Array<number>(12).fill(0);
  const bassHist = new Array<number>(12).fill(0);
  let firstBass: number | null = null;
  let firstBassStart = Infinity;
  let chordName: string | null = null;
  let total = 0;

  for (const ti of trackIdx) {
    const track = score.tracks[ti];
    if (!track) continue;
    const bass = isBassTrack(track);
    for (const staff of track.staves) {
      if (staff.isPercussion) continue;
      const bar = staff.bars[barIndex];
      if (!bar) continue;
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          const s = beat.playbackStart;
          const e = s + beat.playbackDuration;
          if (e <= from || s >= to) continue;
          if (!chordName && beat.chordId != null && staff.chords && staff.chords.has(beat.chordId)) {
            const c = staff.chords.get(beat.chordId);
            if (c && c.name) chordName = c.name;
          }
          if (beat.isRest || !beat.notes.length) continue;
          const dur = Math.min(e, to) - Math.max(s, from);
          let beatLow: number | null = null;
          for (const n of beat.notes) {
            if (n.isDead) continue;
            const v = n.realValue;
            const w = dur * (n.isGhost ? 0.3 : 1);
            hist[mod12(v)] += w;
            total += w;
            if (beatLow === null || v < beatLow) beatLow = v;
          }
          if (beatLow !== null) {
            const pc = mod12(beatLow);
            // A nota mais grave de cada tempo pesa mais, sobretudo no baixo e no início do compasso.
            const startBonus = s <= from + 1 ? 1.5 : 1;
            bassHist[pc] += dur * (bass ? 2 : 0.6) * startBonus;
            if (bass && s < firstBassStart) { firstBassStart = s; firstBass = pc; }
          }
        }
      }
    }
  }
  return { hist, bassHist, total, chordName, firstBass };
}

/** Compara o histograma com modelos de acorde maior, menor e power chord. */
function bestChord(c: Collected): Chord | null {
  if (c.total <= 0) return null;
  const h = c.hist, b = c.bassHist;
  const maxH = Math.max(...h) || 1;
  const maxB = Math.max(...b) || 1;
  let best: Chord | null = null;
  for (let r = 0; r < 12; r++) {
    for (const q of ['maj', 'min', '5'] as const) {
      const third = q === 'maj' ? 4 : q === 'min' ? 3 : null;
      let score = (h[r] / maxH) * 1.0 + (h[(r + 7) % 12] / maxH) * 0.6;
      if (third !== null) {
        score += (h[(r + third) % 12] / maxH) * 0.7;
        score -= (h[(r + (third === 4 ? 3 : 4)) % 12] / maxH) * 0.5; // penaliza a terça oposta
      }
      score += (b[r] / maxB) * 1.6;
      if (c.firstBass === r) score += 0.4;
      if (q === '5') score -= 0.15 + (Math.max(h[(r + 3) % 12], h[(r + 4) % 12]) / maxH) * 0.7;
      if (!best || score > (best.score ?? -Infinity)) best = { pc: r, minor: q === 'min', score };
    }
  }
  return best;
}

/** Devolve um acorde (ou dois, se mudar a meio e `splitBars` estiver ligado) para o compasso. */
export function analyzeBar(score: Score, barIndex: number, trackIdx: number[], opts: AnalyzeOptions = {}): Chord[] {
  const mb = score.masterBars[barIndex];
  const len = mb.calculateDuration();
  const whole = collect(score, barIndex, trackIdx, 0, len);
  if (opts.useFileChords && whole.chordName) {
    const p = parseChordName(whole.chordName);
    if (p) return [{ pc: p.pc, minor: p.minor, fromFile: true }];
  }
  const main = bestChord(whole);
  if (!main) return [];
  if (opts.splitBars) {
    const a = bestChord(collect(score, barIndex, trackIdx, 0, len / 2));
    const z = bestChord(collect(score, barIndex, trackIdx, len / 2, len));
    if (a && z && (a.pc !== z.pc || a.minor !== z.minor)) return [a, z];
  }
  return [main];
}

/** Nome do acorde para mostrar, conforme a notação escolhida. */
export function label(ch: Chord | null | undefined, opts: LabelOptions = {}, keySig = 0): string {
  if (!ch) return '–';
  const acc = opts.accidentals ?? 'auto';
  const useFlats = acc === 'flat' || (acc === 'auto' && keySig < 0);
  let n = (useFlats ? NAMES_FLAT : NAMES_SHARP)[ch.pc];
  if (opts.latin) n = LATIN[n[0]] + n.slice(1);
  return n + (opts.showMinor && ch.minor ? 'm' : '');
}

/** Secções a partir dos marcadores do ficheiro; sem marcadores, uma secção única. */
export function sectionsFromScore(score: Score): Section[] {
  const out: Section[] = [];
  score.masterBars.forEach((mb, i) => {
    const t = mb.section ? (mb.section.text || mb.section.marker || '').trim() : '';
    if (i === 0 || t) out.push({ name: (t || 'Song').toUpperCase(), start: i });
  });
  return out;
}
