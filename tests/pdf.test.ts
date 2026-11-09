import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { buildPdf, fitLayout, type PdfChart } from '../src/app/pdf';

/** Uma música do tamanho de "Basket Case": 127 compassos em 12 secções. */
const sizes = [16, 10, 8, 16, 10, 12, 8, 10, 8, 10, 11, 8];
const song = (perRow = 4): PdfChart => {
  let n = 1;
  return {
    title: 'Long song', meta: 'Band · 170 bpm', perRow, colors: true,
    sections: sizes.map((len, s) => ({
      name: 'Section ' + (s + 1), range: '',
      bars: Array.from({ length: len }, () => ({ n: n++, text: 'F#m7', pcs: [6], note: n % 9 ? undefined : 'palm mute here' })),
    })),
  };
};

describe('PDF numa só folha', () => {
  it('uma música longa cabe numa página', () => {
    expect(buildPdf(jsPDF, song()).getNumberOfPages()).toBe(1);
    expect(buildPdf(jsPDF, song(6)).getNumberOfPages()).toBe(1);
  });
  it('uma música curta fica no tamanho normal e nas colunas do site', () => {
    const short = { ...song(), sections: song().sections.slice(0, 2) };
    expect(fitLayout(short, 220, 180)).toEqual({ per: 4, k: 1 });
  });
  it('para caber, usa mais colunas em vez de quadrados minúsculos', () => {
    const { per, k } = fitLayout(song(), 200, 180);
    expect(per).toBeGreaterThan(4);
    expect(per % 4).toBe(0);
    expect(k).toBeGreaterThan(0.4);
    expect(k).toBeLessThan(1);
  });
});
