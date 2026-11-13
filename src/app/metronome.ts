// Sons do metrónomo, tocados com Web Audio a par do leitor.
// O alphaTab avisa cada tempo do metrónomo (também com o som dele desligado), mas os avisos chegam
// em blocos, com alguns ms de irregularidade. Por isso cada som é agendado no relógio de áudio
// a intervalos certos, corrigindo devagar o desvio (nextTickTime), em vez de tocar à chegada.

// Três sons, todos gravados em ficheiro (public/sounds; gerados por scripts/metro-sounds.py): o woodblock,
// o hi-hat e a voz que conta. Cada um tem o tempo forte (o 1) diferente dos outros.
export type MetroSound = 'wood' | 'hihat' | 'voice-f' | 'voice-m';

export const METRO_SOUNDS: { id: MetroSound; label: string }[] = [
  { id: 'wood', label: 'Woodblock' },
  { id: 'hihat', label: 'Hi-hat' },
  { id: 'voice-f', label: 'Voice “one, two…” · female' },
  { id: 'voice-m', label: 'Voice “one, two…” · male' },
];
export const DEFAULT_METRO_SOUND: MetroSound = 'wood';

export const isMetroSound = (v: unknown): v is MetroSound => METRO_SOUNDS.some(s => s.id === v);

/** Palavra a dizer em cada tempo (0 = "one"); há gravações de 1 a 12. */
export const countWord = (beat: number) => (beat % 12) + 1;

/**
 * Quando tocar o tempo seguinte (em segundos do relógio de áudio).
 * `prev`: quando foi agendado o anterior (null no primeiro); `arrival`: quando chegou o aviso;
 * `interval`: duração do tempo. Segue o ritmo certo e corrige 15 % do desvio; se o desvio for grande
 * (salto, pausa, mudança de velocidade) volta a alinhar pelo aviso.
 */
export function nextTickTime(prev: number | null, arrival: number, interval: number): number {
  if (prev === null) return arrival;
  const expected = prev + interval;
  const drift = arrival - expected;
  if (Math.abs(drift) > Math.max(0.12, interval * 0.35)) return arrival;
  return expected + drift * 0.15;
}

/** Amostras de um som: tempo acentuado, tempo normal, ou (voz) uma palavra por tempo. */
export interface MetroSamples { accent: Float32Array | null; normal: Float32Array | null; words: Float32Array[] }

/** Muda a taxa de amostragem (interpolação linear). */
export function resample(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return Float32Array.from(data);
  const n = Math.max(1, Math.round(data.length * to / from)), out = new Float32Array(n), k = from / to;
  for (let i = 0; i < n; i++) { const x = i * k, i0 = Math.floor(x), f = x - i0; out[i] = data[i0] * (1 - f) + (data[Math.min(i0 + 1, data.length - 1)] ?? 0) * f; }
  return out;
}

/**
 * A palavra da voz para caber no tempo: acelera um pouco se for mais comprida (como o `tick`, até 1,6x) e
 * corta no fim do tempo, com uma descida curta para não estalar.
 */
export function fitWord(word: Float32Array, beatSec: number, sampleRate: number): Float32Array {
  const rate = Math.min(1.6, Math.max(1, (word.length / sampleRate / beatSec) * 1.05));
  const fast = rate === 1 ? word : resample(word, sampleRate * rate, sampleRate);
  const max = Math.max(1, Math.floor(beatSec * sampleRate));
  if (fast.length <= max) return fast;
  const out = fast.slice(0, max), fade = Math.min(out.length, Math.floor(sampleRate * 0.006));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

export class Clicker {
  private ctx: AudioContext | null = null;
  private voices = new Map<string, AudioBuffer[]>();
  /** Woodblock e hi-hat: [tempo forte, outros tempos]. */
  private hits = new Map<string, [AudioBuffer, AudioBuffer]>();
  private loading = new Map<string, Promise<void>>();
  private lastVoice: AudioBufferSourceNode | null = null;
  constructor(private base: string) {}

  /** Cria/retoma o contexto de áudio (tem de ser num toque ou clique, por causa dos browsers). */
  ensure(): AudioContext {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx ??= new AC();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }
  now(): number { return this.ensure().currentTime; }

  /** Descarrega as gravações do som (uma vez). */
  load(sound: MetroSound): Promise<void> {
    const ctx = this.ensure();
    const get = (path: string) => fetch(this.base + path).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b));
    if (sound === 'wood' || sound === 'hihat') {
      if (!this.loading.has(sound)) {
        this.loading.set(sound, Promise.all([get('sounds/metro/' + sound + '-accent.wav'), get('sounds/metro/' + sound + '-normal.wav')])
          .then(([a, n]) => { this.hits.set(sound, [a, n]); })
          .catch(() => { this.loading.delete(sound); }));
      }
      return this.loading.get(sound)!;
    }
    const tag = sound === 'voice-f' ? 'f' : 'm';
    if (!this.loading.has(tag)) {
      this.loading.set(tag, Promise.all(Array.from({ length: 12 }, (_, i) => get('sounds/count/' + tag + (i + 1) + '.wav')))
        .then(bufs => { this.voices.set(tag, bufs); })
        .catch(() => { this.loading.delete(tag); }));
    }
    return this.loading.get(tag)!;
  }

  /**
   * Amostras (mono) de um som do metrónomo, para misturar no fluxo de áudio da música (ver metro-inject.ts).
   * Vêm das gravações (convertidas para a taxa de amostragem do leitor), uma vez por som; a voz tem uma palavra por tempo.
   */
  async samples(sound: MetroSound, sampleRate: number): Promise<MetroSamples> {
    const key = sound + '@' + sampleRate;
    const hit = this.bank.get(key); if (hit) return hit;
    const out: MetroSamples = { accent: null, normal: null, words: [] };
    if (sound === 'voice-f' || sound === 'voice-m') {
      await this.load(sound);
      const bufs = this.voices.get(sound === 'voice-f' ? 'f' : 'm') ?? [];
      out.words = bufs.map(b => resample(b.getChannelData(0), b.sampleRate, sampleRate));
    } else {
      await this.load(sound);
      const pair = this.hits.get(sound);
      if (pair) {
        out.accent = resample(pair[0].getChannelData(0), pair[0].sampleRate, sampleRate);
        out.normal = resample(pair[1].getChannelData(0), pair[1].sampleRate, sampleRate);
      }
    }
    this.bank.set(key, out);
    return out;
  }
  private bank = new Map<string, MetroSamples>();

  /** Toca o tempo `beat` (0 = primeiro do compasso, com acento) no instante `when` (relógio de áudio). */
  tick(sound: MetroSound, beat: number, when: number, beatSec: number, volume = 1): void {
    const ctx = this.ensure(), t = Math.max(when, ctx.currentTime), accent = beat === 0;
    const out = ctx.createGain(); out.gain.value = volume; out.connect(ctx.destination);
    if (sound === 'voice-f' || sound === 'voice-m') {
      const bufs = this.voices.get(sound === 'voice-f' ? 'f' : 'm');
      if (!bufs) { void this.load(sound); this.tone(ctx, out, t, accent ? 1600 : 1200, 0.05, 'sine', 0.6); return; }
      const buf = bufs[countWord(beat) - 1];
      const src = ctx.createBufferSource(); src.buffer = buf;
      // Em andamentos rápidos a palavra acelera um pouco para caber no tempo; a anterior é cortada
      src.playbackRate.value = Math.min(1.6, Math.max(1, (buf.duration / beatSec) * 1.05));
      const g = ctx.createGain(); g.gain.value = accent ? 1 : 0.85;
      src.connect(g).connect(out);
      this.lastVoice?.stop(t); this.lastVoice = src;
      src.start(t);
      return;
    }
    const pair = this.hits.get(sound);
    // Ainda a descarregar (só no primeiro tempo, se tanto): um toque curto no lugar do som
    if (!pair) { void this.load(sound); this.tone(ctx, out, t, accent ? 1600 : 1200, 0.04, 'sine', 0.5); return; }
    const src = ctx.createBufferSource(); src.buffer = pair[accent ? 0 : 1];
    src.connect(out); src.start(t);
  }

  private tone(ctx: BaseAudioContext, dest: AudioNode, t: number, freq: number, dur: number, type: OscillatorType, peak: number, attack = 0.001) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
}
