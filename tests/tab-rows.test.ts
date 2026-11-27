import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';
import { barWidth, fitTabRows, rowBreaks } from '../src/app/tab-rows';

const tex = (body: string) => {
  const s = new alphaTab.Settings();
  return alphaTab.importer.ScoreLoader.loadAlphaTex('\\tuning E1 A1 D2 G2 \\staff{tabs} . ' + body, s);
};
const dense = '0.4.16 0.4 10.4 0.4 0.4 10.4 12.4 0.4 10.4 0.4 0.4 7.4 0.4 8.4 8.4 7.4 |';
const sparse = '0.4.4 3.4 5.4 3.4 |';

describe('quebras de linha da tablatura pela densidade', () => {
  it('um compasso de semicolcheias precisa de muito mais espaço que um de semínimas', () => {
    const score = tex(dense + sparse);
    const t = score.tracks[0];
    expect(barWidth(t, 0)).toBeGreaterThan(3 * barWidth(t, 1));
  });

  it('semicolcheias num ecrã de computador: 2 por linha, não 4', () => {
    const score = tex(dense.repeat(8));
    const t = score.tracks[0];
    const d = new alphaTab.DisplaySettings(); d.scale = 0.95; d.barsPerRow = 4;
    fitTabRows(t, d, 1070);
    expect([...t.lineBreaks!].sort((a, b) => a - b)).toEqual([2, 4, 6]);
  });

  it('compassos leves deixam o máximo escolhido decidir (sem quebras extra)', () => {
    const score = tex(sparse.repeat(8));
    const t = score.tracks[0];
    const d = new alphaTab.DisplaySettings(); d.scale = 0.95; d.barsPerRow = 4;
    expect(fitTabRows(t, d, 1070)).toBe(false);
    expect(t.lineBreaks?.size ?? 0).toBe(0);
  });

  it('conta a partir do início do trecho e respeita as quebras do ficheiro', () => {
    const w = () => 100;
    expect([...rowBreaks(w, 3, 10, 360)]).toEqual([6, 9]);
    expect([...rowBreaks(w, 0, 6, 1000, 0, new Set([2]))]).toEqual([]);
    expect([...rowBreaks(w, 0, 8, 1000, 3)]).toEqual([]);
  });
});
