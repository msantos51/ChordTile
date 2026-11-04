import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';
import { parseScore } from '../src/analysis/parse';
import { MICRO_BUFFER, beatFrame, buildBeatGrid, countInGrid, firstBeatFrom, stateAt, type GridEvent } from '../src/app/metro-grid';
import { fitWord, resample } from '../src/app/metronome';

const D = 960; // ticks por semínima
const tempo = (tick: number, bpm: number): GridEvent => ({ kind: 'tempo', tick, bpm });
const sig = (tick: number, numerator: number, denominatorIndex: number): GridEvent => ({ kind: 'signature', tick, numerator, denominatorIndex });

describe('grelha do metrónomo (igual à do alphaTab)', () => {
  it('4/4 a 120 bpm: uma batida a cada 500 ms, a contar 0 a 3', () => {
    const beats = buildBeatGrid([sig(0, 4, 2), tempo(0, 120)], D, 0, 8 * D);
    expect(beats).toHaveLength(8);
    expect(beats.map(b => b.time)).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500].map(x => expect.closeTo(x, 6)));
    expect(beats.map(b => b.count)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(beats[0].ms).toBeCloseTo(500, 6);
  });

  it('6/8: seis batidas por compasso, uma por colcheia', () => {
    const beats = buildBeatGrid([tempo(0, 120), sig(0, 6, 3)], D, 0, 6 * 480);
    expect(beats).toHaveLength(6);
    expect(beats.map(b => b.time)).toEqual([0, 250, 500, 750, 1000, 1250].map(x => expect.closeTo(x, 6)));
    expect(beats.map(b => b.count)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('mudança de andamento: as batidas seguintes ficam mais espaçadas', () => {
    const beats = buildBeatGrid([sig(0, 4, 2), tempo(0, 120), tempo(2 * D, 60)], D, 0, 4 * D);
    expect(beats.map(b => b.time)).toEqual([0, 500, 1000, 2000].map(x => expect.closeTo(x, 6)));
    expect(beats.map(b => b.ms)).toEqual([500, 500, 1000, 1000].map(x => expect.closeTo(x, 6)));
  });

  it('mudança de compasso a meio recomeça a contagem do compasso', () => {
    const beats = buildBeatGrid([tempo(0, 120), sig(0, 4, 2), sig(4 * D, 3, 2)], D, 0, 7 * D);
    expect(beats.map(b => b.count)).toEqual([0, 1, 2, 3, 1, 2, 0]);
  });

  it('só gera batidas até ao último evento do ficheiro', () => {
    expect(buildBeatGrid([sig(0, 4, 2), tempo(0, 120)], D, 0, 2 * D + 1)).toHaveLength(3);
    expect(buildBeatGrid([sig(0, 4, 2), tempo(0, 120)], D, 0, 0)).toHaveLength(0);
  });

  it('batidas da música de exemplo: 4 por compasso, todas a 600 ms (100 bpm)', () => {
    const bytes = readFileSync(fileURLToPath(new URL('./fixtures/exemplo.gp5', import.meta.url)));
    const score = parseScore(alphaTab, new Uint8Array(bytes));
    const file = new alphaTab.midi.MidiFile();
    new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), new alphaTab.midi.AlphaSynthMidiFileHandler(file, false)).generate();
    const events: GridEvent[] = [];
    let abs = 0, prev = 0;
    for (const e of file.events) {
      abs += e.tick - prev; prev = e.tick;
      if (e.type === alphaTab.midi.MidiEventType.TempoChange) events.push({ kind: 'tempo', tick: abs, bpm: (e as alphaTab.midi.TempoChangeEvent).beatsPerMinute });
      else if (e.type === alphaTab.midi.MidiEventType.TimeSignature) {
        const t = e as alphaTab.midi.TimeSignatureEvent;
        events.push({ kind: 'signature', tick: abs, numerator: t.numerator, denominatorIndex: t.denominatorIndex });
      }
    }
    const beats = buildBeatGrid(events, file.division, file.tickShift, abs);
    const expected = score.masterBars.reduce((n, b) => n + b.timeSignatureNumerator, 0);
    expect(beats.length).toBeGreaterThanOrEqual(expected - 4);
    expect(beats.length).toBeLessThanOrEqual(expected);
    const bpm = score.tempo;
    for (let i = 1; i < beats.length; i++) expect(beats[i].time - beats[i - 1].time).toBeCloseTo(60000 / bpm, 6);
    expect(beats[0].count).toBe(0);
  });
});

describe('em que amostra cai cada batida', () => {
  it('cai no início da micro-janela de 64 amostras onde o sintetizador a dispara', () => {
    // 44100 Hz: cada janela dura 64/44100 s = 1,4512 ms
    expect(beatFrame(0, 0, 1, 44100)).toBe(0);
    expect(beatFrame(600, 0, 1, 44100)).toBe(413 * MICRO_BUFFER);
    for (const t of [1, 123.4, 599.99, 600, 1234.5]) expect((beatFrame(t, 0, 1, 44100) as number) % MICRO_BUFFER).toBe(0);
  });

  it('a velocidade encurta ou alonga as janelas (em tempo da música)', () => {
    // a 50 % cada janela cobre metade do tempo da música: a mesma batida cai o dobro das amostras mais tarde
    expect(beatFrame(600, 0, 0.5, 44100)).toBe(826 * MICRO_BUFFER);
    expect(beatFrame(600, 0, 2, 44100)).toBe(206 * MICRO_BUFFER);
  });

  it('conta a partir do ponto onde o fluxo começa e ignora o que já passou', () => {
    expect(beatFrame(1000, 1000, 1, 44100)).toBe(0);
    expect(beatFrame(999.9, 1000, 1, 44100)).toBeNull();
    expect(beatFrame(1600, 1000, 1, 44100)).toBe(beatFrame(600, 0, 1, 44100));
  });

  it('a primeira batida por tratar é a que não passou antes do ponto de partida', () => {
    const beats = buildBeatGrid([sig(0, 4, 2), tempo(0, 120)], D, 0, 16 * D);
    expect(firstBeatFrom(beats, 0)).toBe(0);
    expect(firstBeatFrom(beats, 500)).toBe(1);
    expect(firstBeatFrom(beats, 501)).toBe(2);
    expect(firstBeatFrom(beats, 1e9)).toBe(beats.length);
  });
});

describe('contagem', () => {
  const events: GridEvent[] = [tempo(0, 100), sig(0, 4, 2), tempo(4 * D, 80), sig(4 * D, 3, 2)];
  it('no início usa o andamento e o compasso do início', () => {
    const b = countInGrid(events, D, 0);
    expect(b.map(x => x.time)).toEqual([0, 600, 1200, 1800].map(x => expect.closeTo(x, 6)));
    expect(b.map(x => x.count)).toEqual([0, 1, 2, 3]);
  });
  it('a meio da música usa o andamento e o compasso que estão em vigor nesse ponto', () => {
    const b = countInGrid(events, D, 5 * D);
    expect(b).toHaveLength(3);
    expect(b[1].time).toBeCloseTo(750, 6);
    expect(stateAt(events, 5 * D)).toEqual({ bpm: 80, numerator: 3, denominator: 4 });
    expect(stateAt(events, 2 * D)).toEqual({ bpm: 100, numerator: 4, denominator: 4 });
  });
  it('compasso de colcheias: a contagem tem uma batida por colcheia', () => {
    const b = countInGrid([tempo(0, 120), sig(0, 6, 3)], D, 0);
    expect(b).toHaveLength(6);
    expect(b[1].time).toBeCloseTo(250, 6);
  });
});

describe('amostras da voz', () => {
  it('mudar a taxa de amostragem mantém a duração', () => {
    const one = new Float32Array(48000).fill(0.5);
    expect(resample(one, 48000, 44100).length).toBe(44100);
    expect(resample(one, 48000, 48000)).not.toBe(one);
  });
  it('a palavra acelera se for mais comprida que o tempo e nunca passa do fim dele', () => {
    const word = new Float32Array(44100 * 0.5).fill(0.5); // meio segundo
    expect(fitWord(word, 1, 44100).length).toBe(word.length);        // cabe: fica igual
    const fast = fitWord(word, 0.3, 44100);                         // não cabe: acelera e corta
    expect(fast.length).toBeLessThanOrEqual(Math.floor(0.3 * 44100));
    expect(fast[fast.length - 1]).toBe(0);                          // acaba em silêncio, sem estalo
  });
});
