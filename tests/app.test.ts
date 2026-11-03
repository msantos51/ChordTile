import { existsSync, readFileSync } from 'node:fs';
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

  it('usa as cores do tema do site no fundo da página', () => {
    // Fundo do tema escuro (#1f2024) e do claro (#f4f2f0), em RGB de 0 a 1 (2 casas decimais)
    expect(buildPdf(jsPDF, chart).output()).toContain('0.12 0.13 0.14 rg');
    expect(buildPdf(jsPDF, { ...chart, theme: 'light' }).output()).toContain('0.96 0.95 0.94 rg');
  });

  it('desenha os sinais de repetição e a legenda das notas', () => {
    const rep: PdfChart = { ...chart, noteKey: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
      sections: [{ name: 'INTRO', range: 'b. 1–2', bars: [{ n: 1, text: 'A', pcs: [9], repeatStart: true }, { n: 2, text: 'B', pcs: [11], repeats: 2 }] }] };
    const out = buildPdf(jsPDF, rep).output();
    expect(out).toContain('CHART');
    expect(out).toContain('G#');
  });

  const fontDir = 'public/vendor/fonts/';
  it.skipIf(!existsSync(fontDir + 'Roboto-Regular.ttf'))('usa a letra Roboto do site quando as fontes estão disponíveis', () => {
    const b64 = (f: string) => readFileSync(fontDir + f).toString('base64');
    const fonts = { regular: b64('Roboto-Regular.ttf'), medium: b64('Roboto-Medium.ttf'), bold: b64('Roboto-Bold.ttf'), mono: b64('RobotoMono-Regular.ttf'), monoMedium: b64('RobotoMono-Medium.ttf') };
    const out = buildPdf(jsPDF, chart, fonts).output();
    expect(out).toContain('/FontName /Roboto');
    expect(out).toContain('/FontName /RobotoMono');
  });

  it('dá um nome de ficheiro limpo', () => {
    expect(pdfFileName('Refrão da Música!')).toBe('refrao-da-musica-chart.pdf');
    expect(pdfFileName('')).toBe('song-chart.pdf');
  });
});
