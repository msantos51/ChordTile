// Grelha do metrónomo, calculada exatamente como o sintetizador do alphaTab a calcula
// (MidiFileSequencer.createStateFromFile e generateCountInMidi). Módulo puro, sem DOM nem áudio.
//
// Porquê: o metrónomo só é exato ao milissegundo se for misturado no próprio fluxo de áudio da música,
// na amostra certa. Para isso é preciso saber, sem esperar pelos avisos do alphaTab (que chegam depois
// de o som já ter tocado), em que amostra do fluxo cai cada batida. Esta grelha dá essa resposta.

/** Tamanho da micro-janela do sintetizador do alphaTab (SynthConstants.MicroBufferSize), em amostras. */
export const MICRO_BUFFER = 64;

/** Eventos do MIDI que interessam ao metrónomo (de `midiFile.events`, já por ordem). */
export type GridEvent =
  | { kind: 'tempo'; tick: number; bpm: number }
  | { kind: 'signature'; tick: number; numerator: number; denominatorIndex: number };

export interface Beat {
  /** Instante da batida, em ms da música a 100 % de velocidade. */
  time: number;
  /** Qual é o tempo dentro do compasso (0 = primeiro, o acentuado). */
  count: number;
  /** Duração do tempo, em ms a 100 %. */
  ms: number;
}

const sanitizeBpm = (bpm: number) => Math.max(bpm, 1);

/**
 * Todas as batidas da música, pela mesma regra do alphaTab: uma por tempo (do denominador do compasso),
 * desde o início, e só até ao último evento do ficheiro (`endTick`: o tick do último evento de todos, notas incluídas).
 */
export function buildBeatGrid(events: GridEvent[], division: number, tickShift = 0, endTick = 0): Beat[] {
  const beats: Beat[] = [];
  let bpm = 120, absTick = 0, previousTick = 0;
  let count = 0, lenTicks = 0, lenMs = 0, mTick = tickShift, mTime = 0;
  for (const e of events) {
    absTick += e.tick - previousTick;
    previousTick = e.tick;
    if (lenTicks > 0) {
      while (mTick < absTick) {
        beats.push({ time: mTime, count: Math.floor(mTick / lenTicks) % count, ms: lenMs });
        mTick += lenTicks; mTime += lenMs;
      }
    }
    if (e.kind === 'tempo') {
      bpm = sanitizeBpm(e.bpm);
      lenMs = lenTicks * (6e4 / (bpm * division));
    } else {
      count = e.numerator;
      lenTicks = (division * (4 / Math.pow(2, e.denominatorIndex))) | 0;
      lenMs = lenTicks * (6e4 / (bpm * division));
    }
  }
  // Os eventos que não são de tempo nem de compasso (notas) também fazem avançar o relógio do alphaTab
  if (lenTicks > 0) {
    while (mTick < endTick) {
      beats.push({ time: mTime, count: Math.floor(mTick / lenTicks) % count, ms: lenMs });
      mTick += lenTicks; mTime += lenMs;
    }
  }
  return beats;
}

/** Tempo (bpm) e compasso em vigor num ponto da música: é o que a contagem usa. */
export function stateAt(events: GridEvent[], tick: number): { bpm: number; numerator: number; denominator: number } {
  let bpm: number | null = null, numerator: number | null = null, den = 4;
  for (const e of events) {
    if (e.kind === 'tempo') { if (bpm === null || e.tick <= tick) bpm = e.bpm; }
    else if (numerator === null || e.tick <= tick) { numerator = e.numerator; den = Math.pow(2, e.denominatorIndex); }
    if (e.tick > tick && bpm !== null && numerator !== null) break;
  }
  return { bpm: bpm ?? 120, numerator: numerator ?? 4, denominator: den };
}

/** A contagem: um compasso de batidas à velocidade do ponto onde se começa (alphaTab: generateCountInMidi). */
export function countInGrid(events: GridEvent[], division: number, tick: number): Beat[] {
  const { bpm, numerator, denominator } = stateAt(events, tick);
  const lenTicks = (division * (4 / denominator)) | 0;
  const ms = lenTicks * (6e4 / (sanitizeBpm(bpm) * division));
  const beats: Beat[] = [];
  let t = 0;
  for (let i = 0; i < numerator; i++) { beats.push({ time: t, count: i, ms }); t += ms; }
  return beats;
}

/**
 * Amostra (dentro do fluxo que começa em `startTime`) em que o sintetizador dispara um evento do instante `time`.
 * O alphaTab trabalha em micro-janelas de 64 amostras e dispara na primeira janela cujo fim ultrapassa o
 * instante do evento; por isso a batida cai na mesma amostra que cairia uma nota nesse instante.
 * `speed`: velocidade (1 = 100 %). Devolve null se o evento é anterior ao início (já passou).
 */
export function beatFrame(time: number, startTime: number, speed: number, sampleRate: number): number | null {
  if (time < startTime) return null;
  const msPerWindow = MICRO_BUFFER / sampleRate * 1e3 * speed;
  return Math.floor((time - startTime) / msPerWindow) * MICRO_BUFFER;
}

/** Primeira batida que ainda não passou (pesquisa binária; `beats` está por ordem de tempo). */
export function firstBeatFrom(beats: Beat[], time: number): number {
  let lo = 0, hi = beats.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (beats[mid].time < time) lo = mid + 1; else hi = mid; }
  return lo;
}
