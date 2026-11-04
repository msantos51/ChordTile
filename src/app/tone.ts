// Estilos de som ("Sound style"): pop, rock e metal aplicados à mistura que o sintetizador do alphaTab produz,
// para soar mais a banda e menos a MIDI. O alphaTab mistura todos os instrumentos num só sinal, por isso os efeitos
// são da mistura inteira (não há distorção só na guitarra). "Original" deixa o som exatamente como era.
//
// Cadeia: corte de graves → distorção (tanh) → "coluna" (corta o chiado da distorção) → EQ de 3 bandas →
// compressor → reverberação de sala → volume → limitador.

export type ToneId = 'original' | 'pop' | 'rock' | 'metal';

export interface TonePreset {
  id: ToneId;
  label: string;
  /** Corte de graves antes da distorção (Hz; 0 = nenhum): sem ele a distorção fica "lamacenta". */
  tighten: number;
  /** Distorção: 0 = nenhuma; 6 já é crunch de rock; 14 é distorção de metal. */
  drive: number;
  /** Filtro de coluna depois da distorção (Hz; 0 = nenhum). */
  cabinet: number;
  /** Graves (dB) e frequência da prateleira. */
  low: { db: number; hz: number };
  /** Médios (dB), frequência e largura. */
  mid: { db: number; hz: number; q: number };
  /** Agudos (dB) e frequência da prateleira. */
  high: { db: number; hz: number };
  /** Compressor (dB, razão, s). */
  comp: { threshold: number; ratio: number; attack: number; release: number };
  /** Reverberação: quanto (0 a 1) e quanto tempo dura (s). */
  reverb: { mix: number; seconds: number };
  /**
   * Volume final (dB): compensa o ganho da distorção e do compressor para todos os estilos soarem tão alto
   * como "Original" (medido com a música de exemplo; um estilo mais alto parece sempre melhor).
   */
  makeup: number;
}

export const TONES: TonePreset[] = [
  { id: 'original', label: 'Original', tighten: 0, drive: 0, cabinet: 0,
    low: { db: 0, hz: 120 }, mid: { db: 0, hz: 800, q: 1 }, high: { db: 0, hz: 6000 },
    comp: { threshold: 0, ratio: 1, attack: 0.01, release: 0.2 }, reverb: { mix: 0, seconds: 1 }, makeup: 0 },
  // Limpo, brilhante e com espaço: muito "ar" em cima, médios recolhidos, reverb de placa
  { id: 'pop', label: 'Pop', tighten: 30, drive: 0, cabinet: 0,
    low: { db: 4, hz: 110 }, mid: { db: -4, hz: 350, q: 0.8 }, high: { db: 7, hz: 5000 },
    comp: { threshold: -26, ratio: 3, attack: 0.012, release: 0.25 }, reverb: { mix: 0.32, seconds: 2.4 }, makeup: -3.3 },
  // Crunch: médios à frente (onde vive a guitarra de rock), sala curta
  { id: 'rock', label: 'Rock', tighten: 60, drive: 6, cabinet: 7000,
    low: { db: 3, hz: 100 }, mid: { db: 6, hz: 1200, q: 0.7 }, high: { db: 2, hz: 4000 },
    comp: { threshold: -22, ratio: 4, attack: 0.006, release: 0.16 }, reverb: { mix: 0.14, seconds: 1.1 }, makeup: -11.8 },
  // Distorção forte, graves apertados, médios escavados e agudos agressivos
  { id: 'metal', label: 'Metal', tighten: 90, drive: 14, cabinet: 6000,
    low: { db: 7, hz: 90 }, mid: { db: -8, hz: 700, q: 0.8 }, high: { db: 6, hz: 3500 },
    comp: { threshold: -28, ratio: 8, attack: 0.003, release: 0.12 }, reverb: { mix: 0.08, seconds: 0.8 }, makeup: -9.4 },
];

export const isToneId = (v: unknown): v is ToneId => TONES.some(t => t.id === v);
export const toneById = (id: ToneId): TonePreset => TONES.find(t => t.id === id) ?? TONES[0];

/**
 * Curva de distorção (tanh): `drive` 0 é uma linha reta; quanto maior, mais o sinal fica "espremido" e cheio de
 * harmónicos. O máximo continua no máximo (o volume é acertado depois, em `makeup`).
 */
export function saturationCurve(drive: number, size = 4097): Float32Array {
  const c = new Float32Array(size), k = Math.max(0, drive), norm = k > 0 ? Math.tanh(k) : 1;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    c[i] = k > 0 ? Math.tanh(k * x) / norm : x;
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

/** A cadeia de efeitos, num AudioContext: o som entra em `input` e sai para os altifalantes. */
export class ToneChain {
  readonly input: GainNode;
  private tight: BiquadFilterNode; private shaper: WaveShaperNode; private cab: BiquadFilterNode;
  private low: BiquadFilterNode; private mid: BiquadFilterNode; private high: BiquadFilterNode;
  private comp: DynamicsCompressorNode;
  private dry: GainNode; private wet: GainNode; private verb: ConvolverNode;
  private out: GainNode; private limiter: DynamicsCompressorNode;
  private impulses = new Map<number, AudioBuffer>();
  private destination: AudioNode | null = null;
  current: ToneId = 'original';

  constructor(private ctx: BaseAudioContext) {
    const c = ctx;
    this.input = c.createGain();
    this.tight = c.createBiquadFilter(); this.tight.type = 'highpass'; this.tight.Q.value = 0.7;
    this.shaper = c.createWaveShaper(); this.shaper.oversample = '4x';
    this.cab = c.createBiquadFilter(); this.cab.type = 'lowpass'; this.cab.Q.value = 0.8;
    this.low = c.createBiquadFilter(); this.low.type = 'lowshelf';
    this.mid = c.createBiquadFilter(); this.mid.type = 'peaking';
    this.high = c.createBiquadFilter(); this.high.type = 'highshelf';
    this.comp = c.createDynamicsCompressor(); this.comp.knee.value = 6;
    this.dry = c.createGain(); this.wet = c.createGain(); this.verb = c.createConvolver();
    this.out = c.createGain();
    // Limitador no fim: nenhum estilo satura a saída
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.08;
    this.tight.connect(this.shaper).connect(this.cab).connect(this.low).connect(this.mid).connect(this.high).connect(this.comp);
    this.comp.connect(this.dry).connect(this.out);
    this.comp.connect(this.verb).connect(this.wet).connect(this.out);
  }

  /** Liga a saída aos altifalantes. */
  connect(destination: AudioNode): void { this.destination = destination; this.route(); }

  /** "Original" vai direto aos altifalantes (som e atraso exatamente como antes); os outros passam pelos efeitos. */
  private route(): void {
    const d = this.destination; if (!d) return;
    this.input.disconnect(); this.out.disconnect(); this.limiter.disconnect();
    if (this.current === 'original') this.input.connect(d);
    else { this.input.connect(this.tight); this.out.connect(this.limiter).connect(d); }
  }

  /** Muda de estilo (com uma transição curta, para não estalar). */
  set(id: ToneId): void {
    const p = toneById(id), t = this.ctx.currentTime, ramp = (a: AudioParam, v: number) => a.setTargetAtTime(v, t, 0.03);
    const wasOriginal = this.current === 'original';
    this.current = p.id;
    this.tight.frequency.value = p.tighten > 0 ? p.tighten : 10;
    this.shaper.curve = p.drive > 0 ? saturationCurve(p.drive) : null;
    this.cab.frequency.value = p.cabinet > 0 ? p.cabinet : 20000;
    this.low.frequency.value = p.low.hz; ramp(this.low.gain, p.low.db);
    this.mid.frequency.value = p.mid.hz; this.mid.Q.value = p.mid.q; ramp(this.mid.gain, p.mid.db);
    this.high.frequency.value = p.high.hz; ramp(this.high.gain, p.high.db);
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
