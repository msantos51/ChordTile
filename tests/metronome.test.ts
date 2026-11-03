import { describe, expect, it } from 'vitest';
import { countWord, isMetroSound, nextTickTime } from '../src/app/metronome';

describe('metrónomo', () => {
  it('diz one…twelve e recomeça', () => {
    expect([0, 1, 3, 11, 12].map(countWord)).toEqual([1, 2, 4, 12, 1]);
  });
  it('mantém o ritmo certo apesar de avisos irregulares', () => {
    // Avisos a chegar com ±50 ms de irregularidade, tempo de 0,6 s
    const arrivals = [0.819, 1.366, 1.927, 2.576, 3.226, 3.786];
    let t: number | null = null; const times: number[] = [];
    for (const a of arrivals) { t = nextTickTime(t, a, 0.6); times.push(t); }
    const gaps = times.slice(1).map((x, i) => x - times[i]);
    for (const g of gaps) expect(Math.abs(g - 0.6)).toBeLessThan(0.02);
  });
  it('realinha depois de um salto ou pausa', () => {
    expect(nextTickTime(1, 5, 0.6)).toBe(5);
    expect(nextTickTime(null, 2, 0.6)).toBe(2);
  });
  it('só aceita sons conhecidos', () => {
    expect(isMetroSound('voice-f')).toBe(true);
    expect(isMetroSound('tambourine')).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as alphaTab from '@coderline/alphatab';
import { rhythmOnsets } from '../src/analysis/bar';
import { parseScore } from '../src/analysis/parse';

describe('só o ritmo', () => {
  it('dá um golpe por cada nota atacada do compasso, por ordem e sem repetir', () => {
    const bytes = readFileSync(fileURLToPath(new URL('./fixtures/exemplo.gp5', import.meta.url)));
    const score = parseScore(alphaTab, new Uint8Array(bytes));
    const track = score.tracks.findIndex(t => t.staves.some(s => !s.isPercussion));
    const on = rhythmOnsets(score, 4, track);
    expect(on.length).toBeGreaterThan(0);
    expect(on).toEqual([...new Set(on)].sort((a, b) => a - b));
    expect(on[0]).toBeGreaterThanOrEqual(0);
    expect(on[on.length - 1]).toBeLessThan(score.masterBars[4].calculateDuration());
  });
});
