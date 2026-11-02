import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as alphaTab from '@coderline/alphatab';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeBar, isBassTrack, label, parseChordName, sectionsFromScore } from '../src/analysis/analyze';
import { parseScore } from '../src/analysis/parse';

type Score = alphaTab.model.Score;

// Ficheiro gerado por scripts/make-fixture.py com uma progressão conhecida (GP5, Windows-1252).
const EXPECTED: [string, string[]][] = [
  ['INTRO', ['A', 'B', 'A', 'B']],
  ['VERSO', Array(4).fill(['B', 'C', 'B', 'G']).flat()],
  ['REFRÃO', Array(2).fill(['A', 'B', 'G', 'D']).flat()],
  ['VERSO', Array(4).fill(['B', 'C', 'B', 'G']).flat()],
  ['SOLO', ['B', 'C', 'B', 'G', 'A', 'B', 'A', 'B']],
];

let score: Score;
beforeAll(() => {
  const bytes = readFileSync(fileURLToPath(new URL('./fixtures/exemplo.gp5', import.meta.url)));
  score = parseScore(alphaTab, new Uint8Array(bytes));
});

describe('parseScore', () => {
  it('lê ficheiros GP5 com acentos (Windows-1252)', () => {
    expect(score.artist).toBe('Esquema de demonstração');
    expect(score.masterBars).toHaveLength(52);
  });
});

describe('sectionsFromScore', () => {
  it('usa os marcadores do ficheiro como secções', () => {
    expect(sectionsFromScore(score)).toEqual([
      { name: 'INTRO', start: 0 },
      { name: 'VERSO', start: 4 },
      { name: 'REFRÃO', start: 20 },
      { name: 'VERSO', start: 28 },
      { name: 'SOLO', start: 44 },
    ]);
  });
});

describe('analyzeBar', () => {
  const expected = EXPECTED.flatMap(([, bars]) => bars);
  const detect = (tracks: number[]) =>
    score.masterBars.map((_, i) => analyzeBar(score, i, tracks).map(c => label(c)).join(' '));

  it('acerta em todos os compassos com todas as pistas', () => {
    expect(detect([0, 1])).toEqual(expected);
  });
  it('acerta só com o baixo', () => {
    expect(detect([1])).toEqual(expected);
  });
  it('acerta só com a guitarra', () => {
    expect(detect([0])).toEqual(expected);
  });
  it('devolve vazio quando não há pistas', () => {
    expect(analyzeBar(score, 0, [])).toEqual([]);
  });
});

describe('isBassTrack', () => {
  it('reconhece a pista de baixo', () => {
    expect(score.tracks.map(isBassTrack)).toEqual([false, true]);
  });
});

describe('label', () => {
  it('mostra letras, menores, Dó Ré Mi e bemóis', () => {
    expect(label({ pc: 9, minor: true })).toBe('A');
    expect(label({ pc: 9, minor: true }, { showMinor: true })).toBe('Am');
    expect(label({ pc: 0, minor: false }, { latin: true })).toBe('Do');
    expect(label({ pc: 10, minor: false }, { accidentals: 'flat' })).toBe('Bb');
    expect(label({ pc: 10, minor: false }, { accidentals: 'auto' }, -2)).toBe('Bb');
    expect(label({ pc: 10, minor: false }, { accidentals: 'auto' }, 2)).toBe('A#');
    expect(label({ pc: 6, minor: false }, { latin: true, accidentals: 'sharp' })).toBe('Fa#');
    expect(label(null)).toBe('–');
  });
});

describe('parseChordName', () => {
  it('lê raiz e modo de nomes de acordes', () => {
    expect(parseChordName('F#m7')).toEqual({ pc: 6, minor: true });
    expect(parseChordName('Bb')).toEqual({ pc: 10, minor: false });
    expect(parseChordName('Cmaj7')).toEqual({ pc: 0, minor: false });
    expect(parseChordName('x')).toBeNull();
  });
});
