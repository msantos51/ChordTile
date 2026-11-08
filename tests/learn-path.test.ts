import { describe, expect, it } from 'vitest';
import {
  buildSteps, byHeartPct, connectedTo, firstStepOf, isFinal, knownSections, restoreStep, runsGoal, stepRange,
} from '../src/app/learn-path';

describe('Tile by Tile: percurso', () => {
  it('aprende cada secção, toca-a de cor e junta-a às anteriores até à música toda', () => {
    const s = buildSteps(3);
    expect(s).toEqual([
      { kind: 'learn', sec: 0 }, { kind: 'recall', sec: 0 },
      { kind: 'learn', sec: 1 }, { kind: 'recall', sec: 1 }, { kind: 'join', from: 0, to: 1 },
      { kind: 'learn', sec: 2 }, { kind: 'recall', sec: 2 }, { kind: 'join', from: 0, to: 2 },
    ]);
    expect(isFinal(s, s.length - 1)).toBe(true);
    expect(stepRange(s[s.length - 1])).toEqual([0, 2]);
  });

  it('com uma só secção, tocá-la de cor é a música toda', () => {
    const s = buildSteps(1);
    expect(s).toHaveLength(2);
    expect(isFinal(s, 1)).toBe(true);
    expect(runsGoal(s, 1)).toBe(1);
  });

  it('voltas pedidas: 3 por secção, 2 ao juntar, 1 na música toda', () => {
    const s = buildSteps(3);
    expect(runsGoal(s, 0)).toBe(3);
    expect(runsGoal(s, 1)).toBe(3);
    expect(runsGoal(s, 4)).toBe(2);
    expect(runsGoal(s, 7)).toBe(1);
  });

  it('secções de cor e ligadas', () => {
    const s = buildSteps(3);
    expect(knownSections(s, 0)).toEqual([false, false, false]);
    expect(knownSections(s, 1, true)).toEqual([true, false, false]);
    expect(knownSections(s, 4)).toEqual([true, true, false]);
    expect(connectedTo(s, 3)).toBe(0);
    expect(connectedTo(s, 4)).toBe(0);
    expect(connectedTo(s, 4, true)).toBe(1);
    expect(byHeartPct([true, true, false], [4, 4, 8])).toBe(50);
  });

  it('retoma o passo guardado, também no formato antigo', () => {
    const s = buildSteps(3);
    expect(restoreStep(null, s, 3)).toBe(0);
    expect(restoreStep({ v: 2, step: 4 }, s, 3)).toBe(4);
    expect(restoreStep({ v: 2, step: 99 }, s, 3)).toBe(7);
    expect(restoreStep({ step: 3 }, s, 3)).toBe(firstStepOf(s, 1));
    expect(restoreStep({ step: 6 }, s, 3)).toBe(7);
  });
});
