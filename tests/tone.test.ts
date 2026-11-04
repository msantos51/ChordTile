import { describe, expect, it } from 'vitest';
import { TONES, isToneId, roomImpulse, saturationCurve, toneById } from '../src/app/tone';

describe('estilos de som', () => {
  it('tem Original, Pop, Rock e Metal, e Original não muda nada', () => {
    expect(TONES.map(t => t.id)).toEqual(['original', 'pop', 'rock', 'metal']);
    const o = toneById('original');
    expect([o.low.db, o.mid.db, o.high.db, o.drive, o.reverb.mix, o.makeup, o.tighten, o.cabinet]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(o.comp.ratio).toBe(1);
  });
  it('valores dentro de limites razoáveis (sem estragar o som nem o volume)', () => {
    for (const t of TONES) {
      for (const v of [t.low.db, t.mid.db, t.high.db]) expect(Math.abs(v)).toBeLessThanOrEqual(9);
      expect(t.reverb.mix).toBeLessThanOrEqual(0.35);
      expect(t.drive).toBeLessThanOrEqual(16);
      expect(Math.abs(t.makeup)).toBeLessThanOrEqual(24);
    }
  });
  it('só aceita estilos conhecidos', () => {
    expect(isToneId('rock')).toBe(true);
    expect(isToneId('jazz')).toBe(false);
    expect(toneById('jazz' as never).id).toBe('original');
  });
});

describe('saturação', () => {
  it('sem drive é uma linha reta', () => {
    const c = saturationCurve(0, 5);
    expect(Array.from(c)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });
  it('com drive espreme o sinal (mais harmónicos) mas o máximo continua no máximo', () => {
    const c = saturationCurve(6, 2001), at = (x: number) => c[Math.round((x + 1) / 2 * 2000)];
    expect(at(0)).toBeCloseTo(0, 6); expect(at(1)).toBeCloseTo(1, 6); expect(at(-1)).toBeCloseTo(-1, 6);
    expect(at(-0.3)).toBeCloseTo(-at(0.3), 6);   // simétrica
    expect(at(0.3)).toBeGreaterThan(0.9);         // um sinal a 30 % já fica quase no máximo (distorção a sério)
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });
});

describe('reverberação', () => {
  it('dura o tempo pedido, é igual sempre e desvanece', () => {
    const [l, r] = roomImpulse(1000, 1.5);
    expect(l.length).toBe(1500); expect(r.length).toBe(1500);
    expect(Array.from(roomImpulse(1000, 1.5)[0])).toEqual(Array.from(l));
    const energy = (a: Float32Array, from: number, to: number) => a.slice(from, to).reduce((s, x) => s + x * x, 0);
    expect(energy(l, 0, 300)).toBeGreaterThan(energy(l, 1200, 1500) * 10);
    expect(Math.abs(l[0])).toBeLessThan(0.01); // começa sem estalo
  });
});
