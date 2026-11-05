import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';
import { barView, techLegend } from '../src/analysis/bar';

const score = (tex: string) => {
  const imp = new alphaTab.importer.AlphaTexImporter();
  imp.initFromString(tex, new alphaTab.Settings());
  return imp.readScore();
};
const s = score(`\\title "T" .
:8 5.3{h} 7.3 7.2{b (0 4)} 5.2{sl} 7.2 5.3 0.6{pm} 0.6{pm} | :4 x.3 3.3{g} 5.3{v} 3.4{nh} | :4 3.3{dy mf} 3.3 3.3{dy f} 3.3`);

describe('técnicas no compasso expandido', () => {
  it('cada nota traz as suas técnicas: hammer-on, bend com o valor, slide, palm mute', () => {
    const v = barView(s, 0, 0);
    expect(v.notes.map(n => n.tech.map(t => t.text))).toEqual([['H'], [], ['↑ full'], ['/'], [], [], ['PM'], ['PM']]);
    expect(techLegend(v).kinds.map(t => t.kind)).toEqual(['hammer', 'bend', 'slideUp', 'palmMute']);
  });
  it('nota morta (x), ghost (entre parênteses), vibrato e harmónico', () => {
    const v = barView(s, 1, 0);
    expect(v.notes.map(n => [n.dead, n.ghost])).toEqual([[true, false], [false, true], [false, false], [false, false]]);
    expect(techLegend(v).kinds.map(t => t.kind)).toEqual(['dead', 'ghost', 'vibrato', 'harmonic']);
  });
  it('dinâmicas: só aparecem quando mudam (o "f" por defeito não se mostra)', () => {
    expect(barView(s, 0, 0).beats.every(b => b.dynamic === null)).toBe(true);
    expect(barView(s, 2, 0).beats.map(b => b.dynamic)).toEqual(['mf', null, 'f', null]);
  });
});
