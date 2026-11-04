// Estilos de som ("Sound style"): equalização, saturação suave, compressão e reverberação aplicadas à
// mistura que o sintetizador do alphaTab produz, para soar mais a banda (pop, rock, metal) e menos a MIDI.
// O alphaTab mistura todos os instrumentos num só sinal, por isso os efeitos são da mistura inteira
// (não há distorção só na guitarra). "Original" deixa o som exatamente como era.

export type ToneId = 'original' | 'pop' | 'rock' | 'metal';

export interface TonePreset {
  id: ToneId;
  label: string;
  /** Graves (dB) e frequência da prateleira. */
  low: { db: number; hz: number };
  /** Médios (dB), frequência e largura. */
  mid: { db: number; hz: number; q: number };
  /** Agudos (dB) e frequência da prateleira. */
  high: { db: number; hz: number };
  /** Saturação suave (0 = nenhuma). */
  drive: number;
  /** Compressor (dB, razão, ms). */
  comp: { threshold: number; ratio: number; attack: number; release: number };
  /** Reverberação: quanto (0 a 1) e quanto tempo dura (s). */
  reverb: { mix: number; seconds: number };
  /**
   * Volume final (dB). O compressor do browser junta ganho automático; isto compensa-o para todos os estilos
   * soarem tão alto como "Original" (medido com a música de exemplo: um estilo mais alto parece sempre melhor).
   */
  makeup: number;
}

export const TONES: TonePreset[] = [
  { id: 'original', label: 'Original', low: { db: 0, hz: 120 }, mid: { db: 0, hz: 800, q: 1 }, high: { db: 0, hz: 6000 }, drive: 0,
    comp: { threshold: 0, ratio: 1, attack: 0.01, release: 0.2 }, reverb: { mix: 0, seconds: 1 }, makeup: 0 },
  { id: 'pop', label: 'Pop', low: { db: 2, hz: 110 }, mid: { db: -2, hz: 400, q: 0.9 }, high: { db: 3.5, hz: 6500 }, drive: 0,
    comp: { threshold: -20, ratio: 3, attack: 0.012, release: 0.22 }, reverb: { mix: 0.2, seconds: 1.8 }, makeup: -4.4 },
  { id: 'rock', label: 'Rock', low: { db: 3, hz: 100 }, mid: { db: 2.5, hz: 1600, q: 0.8 }, high: { db: 2, hz: 5000 }, drive: 2.2,
    comp: { threshold: -18, ratio: 4, attack: 0.008, release: 0.18 }, reverb: { mix: 0.12, seconds: 1.2 }, makeup: -6.3 },
  { id: 'metal', label: 'Metal', low: { db: 4.5, hz: 90 }, mid: { db: -4.5, hz: 650, q: 0.9 }, high: { db: 4, hz: 4500 }, drive: 4,
    comp: { threshold: -24, ratio: 6, attack: 0.004, release: 0.14 }, reverb: { mix: 0.07, seconds: 0.9 }, makeup: -6.7 },
];

export const isToneId = (v: unknown): v is ToneId => TONES.some(t => t.id === v);
export const toneById = (id: ToneId): TonePreset => TONES.find(t => t.id === id) ?? TONES[0];

/**
 * Curva de saturação suave (tanh) com ganho 1 nos sons baixos: não muda o volume, só arredonda os picos
 * (que é o que dá "corpo" e harmónicos). Com `drive` 0 é uma linha reta (não muda nada).
 */
export function saturationCurve(drive: number, size = 2049): Float32Array {
  const c = new Float32Array(size), k = 1 + Math.max(0, drive);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    c[i] = drive > 0 ? Math.tanh(x * k) / k : x;
  }
  return c;
}

/** Resposta de uma sala (ruído que se desvanece), estéreo, para a reverberação. Determinística (mesma semente). */
export function roomImpulse(sampleRate: number, seconds: number): [Float32Array, Float32Array] {
  const n = Math.max(1, Math.round(sampleRate * seconds));
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (const ch of out) {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // decaimento exponencial, com um início suave (sem estalo)
      ch[i] = rnd() * Math.pow(1 - t, 3) * Math.min(1, i / (sampleRate * 0.004));
    }
  }
  return out;
}

const db = (v: number) => Math.pow(10, v / 20);

/** A cadeia de efeitos, num AudioContext: o som entra em `input` e sai já para os altifalantes. */
export class ToneChain {
  readonly input: GainNode;
  private low: BiquadFilterNode; private mid: BiquadFilterNode; private high: BiquadFilterNode;
  private shaper: WaveShaperNode; private comp: DynamicsCompressorNode;
  private dry: GainNode; private wet: GainNode; private verb: ConvolverNode;
  private out: GainNode; private limiter: DynamicsCompressorNode;
  private impulses = new Map<number, AudioBuffer>();
  current: ToneId = 'original';

  constructor(private ctx: BaseAudioContext) {
    const c = ctx;
    this.input = c.createGain();
    this.low = c.createBiquadFilter(); this.low.type = 'lowshelf';
    this.mid = c.createBiquadFilter(); this.mid.type = 'peaking';
    this.high = c.createBiquadFilter(); this.high.type = 'highshelf';
    this.shaper = c.createWaveShaper(); this.shaper.oversample = '4x';
    this.comp = c.createDynamicsCompressor(); this.comp.knee.value = 8;
    this.dry = c.createGain(); this.wet = c.createGain(); this.verb = c.createConvolver();
    this.out = c.createGain();
    // Limitador no fim: os estilos nunca saturam a saída
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.08;
    this.low.connect(this.mid).connect(this.high).connect(this.shaper).connect(this.comp);
    this.comp.connect(this.dry).connect(this.out);
    this.comp.connect(this.verb).connect(this.wet).connect(this.out);
    this.current = 'original';
    this.set('original');
  }

  /** Liga a saída aos altifalantes. */
  connect(destination: AudioNode): void { this.destination = destination; this.route(); }
  private destination: AudioNode | null = null;
  /** "Original" vai direto aos altifalantes (som e atraso exatamente como antes); os outros passam pelos efeitos. */
  private route(): void {
    const d = this.destination; if (!d) return;
    this.input.disconnect(); this.out.disconnect(); this.limiter.disconnect();
    if (this.current === 'original') this.input.connect(d);
    else { this.input.connect(this.low); this.out.connect(this.limiter).connect(d); }
  }

  /** Muda de estilo (com uma transição curta, para não estalar). */
  set(id: ToneId): void {
    const p = toneById(id), t = this.ctx.currentTime, ramp = (a: AudioParam, v: number) => a.setTargetAtTime(v, t, 0.03);
    const wasOriginal = this.current === 'original';
    this.current = p.id;
    this.low.frequency.value = p.low.hz; ramp(this.low.gain, p.low.db);
    this.mid.frequency.value = p.mid.hz; this.mid.Q.value = p.mid.q; ramp(this.mid.gain, p.mid.db);
    this.high.frequency.value = p.high.hz; ramp(this.high.gain, p.high.db);
    this.shaper.curve = p.drive > 0 ? saturationCurve(p.drive) : null;
    this.comp.threshold.value = p.comp.threshold; this.comp.ratio.value = p.comp.ratio;
    this.comp.attack.value = p.comp.attack; this.comp.release.value = p.comp.release;
    if (p.reverb.mix > 0) this.verb.buffer = this.impulse(p.reverb.seconds);
    ramp(this.wet.gain, p.reverb.mix); ramp(this.dry.gain, 1 - p.reverb.mix * 0.5);
    ramp(this.out.gain, db(p.makeup));
    if (wasOriginal !== (p.id === 'original')) this.route();
  }

  private impulse(seconds: number): AudioBuffer {
    const key = Math.round(seconds * 10);
    let b = this.impulses.get(key);
    if (!b) {
      const [l, r] = roomImpulse(this.ctx.sampleRate, seconds);
      b = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
      b.getChannelData(0).set(l); b.getChannelData(1).set(r);
      this.impulses.set(key, b);
    }
    return b;
  }
}
