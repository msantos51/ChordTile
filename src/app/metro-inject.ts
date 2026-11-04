// Metrónomo e contagem misturados no próprio fluxo de áudio da música, na amostra exata.
//
// O alphaTab sintetiza a música num worker e envia os blocos de áudio (`addSamples`) para a página, que os
// toca. Os avisos de cada batida (`midiEventsPlayed`) só chegam depois de o bloco já ter tocado, com
// alguns milissegundos de irregularidade, e o relógio de outro AudioContext nunca está alinhado com o da
// música. Por isso, tocar o metrónomo a partir desses avisos não pode ser exato.
//
// Aqui o som é somado aos blocos antes de entrarem no leitor, na amostra calculada pela grelha do próprio
// alphaTab (metro-grid.ts): fica sempre alinhado com a música, mesmo que o áudio engasgue, sem atrasos
// e sem variações. Só usa nomes públicos do alphaTab e, se não os encontrar, não faz nada (o chamador
// volta ao método antigo).

import { beatFrame, buildBeatGrid, countInGrid, firstBeatFrom, type Beat, type GridEvent } from './metro-grid';
import { fitWord, type MetroSamples, type MetroSound } from './metronome';

/** Saída de áudio do alphaTab (a que recebe os blocos já sintetizados). */
interface OutputLike {
  addSamples(samples: Float32Array): void;
  resetSamples(): void;
  play(): void;
  sampleRate?: number;
  context?: { sampleRate: number } | null;
}
interface PositionArgs { currentTime: number; currentTick: number; isSeek: boolean }
interface PlayerLike { positionChanged: { on(cb: (e: PositionArgs) => void): unknown } }

/** A música vista pelo metrónomo: eventos de tempo e compasso do MIDI. */
export interface GridSource { division: number; tickShift: number; endTick: number; events: GridEvent[] }

export interface InjectorDeps {
  /** O leitor do alphaTab (`api.player`). */
  player: unknown;
  /** Eventos do MIDI da música aberta (null se ainda não há música). */
  source(): GridSource | null;
  /** Velocidade do leitor (1 = 100 %). */
  speed(): number;
  /** Volume da contagem do alphaTab: se for > 0, a contagem vai tocar quando se carregar em play. */
  countInVolume(): number;
  sound(): MetroSound;
  metroOn(): boolean;
  countInOn(): boolean;
  /** Amostras do som escolhido (a geração é assíncrona, por isso pede-se antes de tocar). */
  samples(sound: MetroSound, sampleRate: number): Promise<MetroSamples>;
  /** Pede ao leitor uma procura para o ponto atual (recomeça o fluxo com a posição conhecida). */
  resync(): void;
}

type Kind = 'main' | 'countin' | 'unknown';
interface Segment {
  kind: Kind;
  /** Amostras já recebidas deste fluxo. */
  frames: number;
  beats: Beat[];
  /** Instante (ms da música a 100 %) em que o fluxo começa. */
  startTime: number;
  speed: number;
  /** Próxima batida por tratar. */
  next: number;
}
interface Playing { data: Float32Array; pos: number; gain: number }

/** A saída de áudio do leitor: o acessor público `output` ou, em último caso, o objeto com a forma certa. */
export function findOutput(player: unknown): OutputLike | null {
  if (!player || typeof player !== 'object') return null;
  const fits = (o: unknown): o is OutputLike => !!o && typeof o === 'object' && typeof (o as OutputLike).addSamples === 'function'
    && typeof (o as OutputLike).resetSamples === 'function' && typeof (o as OutputLike).play === 'function';
  const direct = (player as { output?: unknown }).output;
  if (fits(direct)) return direct;
  for (const v of Object.values(player as Record<string, unknown>)) if (fits(v)) return v;
  return null;
}

export class MetroInjector {
  private seg: Segment = { kind: 'unknown', frames: 0, beats: [], startTime: 0, speed: 1, next: 0 };
  private playing: Playing[] = [];
  private pendingTime: number | null = null;
  private lastTime: number | null = null;
  private lastTick = 0;
  private grid: { source: GridSource; beats: Beat[] } | null = null;
  private loaded: { sound: MetroSound; rate: number; data: MetroSamples } | null = null;
  private rate = 44100;
  private out: OutputLike | null = null;
  /** Verdadeiro depois de instalado: o resto da aplicação deixa de agendar os sons por avisos. */
  active = false;

  constructor(private deps: InjectorDeps) {}

  install(): boolean {
    const out = findOutput(this.deps.player);
    const player = this.deps.player as Partial<PlayerLike> | null;
    if (!out || !player?.positionChanged || typeof player.positionChanged.on !== 'function') return false;
    this.out = out;
    this.rate = out.sampleRate ?? out.context?.sampleRate ?? 44100;
    const add = out.addSamples.bind(out), reset = out.resetSamples.bind(out), play = out.play.bind(out);
    out.addSamples = (f: Float32Array) => { try { this.mix(f); } catch { /* nunca estragar o áudio */ } add(f); };
    out.resetSamples = () => { reset(); this.onReset(); };
    out.play = () => {
      // Retomar depois de uma pausa: o fluxo continua num ponto que a página não conhece. Pede-se uma procura
      // ao ponto atual (antes de tocar) para recomeçar com a posição certa.
      const resume = this.deps.countInVolume() <= 0 && !(this.seg.kind === 'main' && this.seg.frames === 0);
      if (resume) this.deps.resync();
      play();
      this.onPlay(resume);
    };
    player.positionChanged.on(e => {
      this.lastTick = e.currentTick;
      if (e.isSeek) { this.pendingTime = e.currentTime; this.lastTime = e.currentTime; }
    });
    this.active = true;
    return true;
  }

  /** Prepara o som escolhido (gera as amostras); chamar ao mudar de som e antes de tocar. */
  async prepare(): Promise<void> {
    const sound = this.deps.sound();
    if (sound === 'click') return;
    const rate = this.out?.sampleRate ?? this.out?.context?.sampleRate ?? this.rate;
    this.rate = rate;
    const data = await this.deps.samples(sound, rate);
    this.loaded = { sound, rate, data };
  }

  // ---------- Fluxo ----------

  private beatsOfSong(): Beat[] | null {
    const source = this.deps.source();
    if (!source) return null;
    if (!this.grid || this.grid.source !== source) this.grid = { source, beats: buildBeatGrid(source.events, source.division, source.tickShift, source.endTick) };
    return this.grid.beats;
  }

  private onReset() {
    this.playing = [];
    const time = this.pendingTime ?? this.lastTime;
    this.pendingTime = null;
    const beats = this.beatsOfSong();
    if (time === null || !beats) { this.seg = { kind: 'unknown', frames: 0, beats: [], startTime: 0, speed: 1, next: 0 }; return; }
    const speed = this.deps.speed(), startTime = time * speed;
    this.seg = { kind: 'main', frames: 0, beats, startTime, speed, next: firstBeatFrom(beats, startTime) };
  }

  private onPlay(resumed: boolean) {
    this.playing = [];
    if (this.deps.countInVolume() > 0) {
      const source = this.deps.source();
      const beats = source ? countInGrid(source.events, source.division, this.lastTick) : [];
      this.seg = { kind: beats.length ? 'countin' : 'unknown', frames: 0, beats, startTime: 0, speed: this.deps.speed(), next: 0 };
    } else if (resumed) {
      this.seg = { kind: 'unknown', frames: 0, beats: [], startTime: 0, speed: 1, next: 0 };
    }
  }

  /** Soma ao bloco os sons que lhe caem dentro (e o resto dos que vêm de blocos anteriores). */
  private mix(f: Float32Array) {
    const seg = this.seg, frames = f.length >> 1;
    // 1. o que sobra dos sons que começaram em blocos anteriores
    const rest: Playing[] = [];
    for (const p of this.playing) {
      p.pos += this.add(f, p.data, p.pos, 0, p.gain);
      if (p.pos < p.data.length) rest.push(p);
    }
    this.playing = rest;
    // 2. as batidas que caem neste bloco (o que passar do fim do bloco continua no seguinte)
    if (seg.kind !== 'unknown') {
      const data = this.loaded && this.loaded.sound === this.deps.sound() && this.loaded.rate === this.rate ? this.loaded.data : null;
      const enabled = seg.kind === 'main' ? this.deps.metroOn() : this.deps.countInOn();
      while (seg.next < seg.beats.length) {
        const b = seg.beats[seg.next];
        const at = beatFrame(b.time, seg.startTime, seg.speed, this.rate);
        if (at === null) { seg.next++; continue; }
        if (at >= seg.frames + frames) break;               // cai num bloco seguinte
        seg.next++;
        if (at < seg.frames || !enabled || !data) continue; // já passou, ou está desligado
        const s = this.pick(data, b, seg.speed);
        if (s) this.start(f, s.data, s.gain, at - seg.frames);
      }
    }
    seg.frames += frames;
  }

  private start(f: Float32Array, data: Float32Array, gain: number, offset: number) {
    const n = this.add(f, data, 0, offset, gain);
    if (n < data.length) this.playing.push({ data, pos: n, gain });
  }

  /** Soma `data` (mono) a `f` (estéreo intercalado) a partir da amostra `offset`; devolve quantas amostras usou. */
  private add(f: Float32Array, data: Float32Array, from: number, offset: number, gain: number): number {
    const frames = f.length >> 1, n = Math.min(data.length - from, frames - offset);
    for (let i = 0; i < n; i++) {
      const v = data[from + i] * gain, j = (offset + i) << 1;
      f[j] += v; f[j + 1] += v;
    }
    return Math.max(0, n);
  }

  private pick(data: MetroSamples, b: Beat, speed: number): { data: Float32Array; gain: number } | null {
    if (data.words.length) {
      const w = data.words[b.count % data.words.length];
      return w ? { data: fitWord(w, b.ms / 1000 / speed, this.rate), gain: b.count === 0 ? 1 : 0.85 } : null;
    }
    const s = b.count === 0 ? data.accent : data.normal;
    return s ? { data: s, gain: 1 } : null;
  }
}
