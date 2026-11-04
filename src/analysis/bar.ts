// Notas de um compasso de uma pista, prontas a desenhar em grande (vista "compasso expandido").
import type { model } from '@coderline/alphatab';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface BarNote {
  /** Início dentro do compasso, em ticks (semínima = 960). */
  start: number;
  /** Linha da tablatura, de cima (0 = corda mais aguda) para baixo. */
  line: number;
  fret: number;
  /** Identificador do tempo (beat) do alphaTab, para acender a nota durante a reprodução. */
  beatId: number;
  dead: boolean;
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
}

/** Extrai as notas do compasso `barIndex` da pista `trackIndex` (todas as vozes da primeira pauta). */
export function barView(score: model.Score, barIndex: number, trackIndex: number): BarView {
  const mb = score.masterBars[barIndex];
  const staff = score.tracks[trackIndex]?.staves[0];
  const tuning = staff?.tuning ?? [];
  const n = tuning.length;
  const notes: BarNote[] = [];
  const bar = staff?.bars[barIndex];
  for (const voice of bar?.voices ?? []) {
    for (const beat of voice.beats) {
      if (beat.isRest) continue;
      for (const note of beat.notes) {
        if (!note.isStringed) continue;
        // No alphaTab a corda 1 é a mais grave (linha de baixo); a afinação vem da mais aguda para a mais grave.
        notes.push({ start: beat.playbackStart, line: n - note.string, fret: note.fret, beatId: beat.id, dead: note.isDead });
      }
    }
  }
  notes.sort((a, b) => a.start - b.start || a.line - b.line);
  return {
    index: barIndex,
    numerator: mb.timeSignatureNumerator,
    denominator: mb.timeSignatureDenominator,
    duration: mb.calculateDuration(),
    strings: tuning.map(v => NAMES[((v % 12) + 12) % 12]),
    notes,
  };
}
