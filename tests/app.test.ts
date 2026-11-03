import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';
import { pitchClassesOf, tokenPc } from '../src/app/notes';
import { buildPdf, pdfFileName, type PdfChart } from '../src/app/pdf';

describe('tokenPc', () => {
  it('aceita letras e Dó Ré Mi, com e sem acentos', () => {
    expect(tokenPc('C')).toBe(0);
    expect(tokenPc('F#m')).toBe(6);
    expect(tokenPc('Dó')).toBe(0);
    expect(tokenPc('Re')).toBe(2);
    expect(tokenPc('Sib')).toBe(10);
    expect(tokenPc('Lá#')).toBe(10);
    expect(tokenPc('–')).toBeNull();
  });
});

describe('pitchClassesOf', () => {
  it('lê até dois acordes por compasso', () => {
    expect(pitchClassesOf('A')).toEqual([9]);
    expect(pitchClassesOf('C G')).toEqual([0, 7]);
    expect(pitchClassesOf('C G D')).toEqual([0, 7]);
    expect(pitchClassesOf('')).toEqual([]);
  });
});

describe('PDF do esquema', () => {
  const bars = (start: number, chords: string[]) =>
    chords.map((text, j) => ({ n: start + j, text, pcs: pitchClassesOf(text) }));
  const chart: PdfChart = {
    title: 'Exemplo',
    meta: 'Baixo · 100 bpm · 4/4',
    perRow: 4,
    colors: true,
    sections: [
      { name: 'INTRO', range: 'c. 1–4', bars: bars(1, ['A', 'B', 'A', 'B']) },
      { name: 'REFRÃO', range: 'c. 5–8', bars: bars(5, ['A', 'B', 'G D', '–']) },
    ],
  };

  it('cria um PDF com o esquema', () => {
    const doc = buildPdf(jsPDF, chart);
    expect(doc.getNumberOfPages()).toBe(1);
    const out = doc.output();
    expect(out.startsWith('%PDF')).toBe(true);
    expect(out).toContain('INTRO');
  });

  it('no plano Free leva marca de água; no Premium não', () => {
    const free = buildPdf(jsPDF, { ...chart, watermark: 'FREE PLAN' }).output();
    expect(free).toContain('FREE PLAN');
    expect(free).toContain('Made with ChordTile');
    expect(buildPdf(jsPDF, chart).output()).not.toContain('FREE PLAN');
  });

  it('escreve o texto pessoal de cada compasso por baixo do acorde', () => {
    const withNote: PdfChart = { ...chart, sections: [{ name: 'INTRO', range: '', bars: [{ n: 1, text: 'A', pcs: [9], note: 'palm mute' }] }] };
    expect(buildPdf(jsPDF, withNote).output()).toContain('palm mute');
  });

  it('passa para a página seguinte quando a música é longa', () => {
    const long: PdfChart = { ...chart, sections: Array.from({ length: 12 }, (_, k) => ({ name: 'S' + k, range: '', bars: bars(1, Array(16).fill('C')) })) };
    expect(buildPdf(jsPDF, long).getNumberOfPages()).toBeGreaterThan(1);
  });

  it('dá um nome de ficheiro limpo', () => {
    expect(pdfFileName('Refrão da Música!')).toBe('refrao-da-musica-chart.pdf');
    expect(pdfFileName('')).toBe('song-chart.pdf');
  });
});
