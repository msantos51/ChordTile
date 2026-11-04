import { describe, expect, it } from 'vitest';
import { cleanPoints, formatMs, nearestRate, parseYouTubeId, toFlat, withPoint } from '../src/app/video';

describe('endereço do YouTube', () => {
  const id = 'dQw4w9WgXcQ';
  it('aceita os formatos mais comuns e só o identificador', () => {
    for (const u of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'http://youtube.com/watch?v=dQw4w9WgXcQ&t=43s&list=PL1',
      'https://youtu.be/dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'youtube.com/watch?v=dQw4w9WgXcQ', '  dQw4w9WgXcQ  ',
    ]) expect(parseYouTubeId(u), u).toBe(id);
  });
  it('recusa o que não é um vídeo', () => {
    for (const u of ['', 'olá', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/', 'https://www.youtube.com/watch?v=curto',
      'https://www.youtube.com/@canal', 'javascript:alert(1)']) expect(parseYouTubeId(u), u).toBeNull();
  });
});

describe('pontos de sincronização', () => {
  it('formata o tempo com milésimos', () => {
    expect(formatMs(0)).toBe('0:00.000');
    expect(formatMs(65250)).toBe('1:05.250');
    expect(formatMs(-5)).toBe('0:00.000');
  });
  it('ordena por compasso e o último a ser marcado substitui o anterior', () => {
    let p = withPoint([], 8, 20000);
    p = withPoint(p, 0, 1500);
    p = withPoint(p, 8, 20250);
    expect(p).toEqual([{ bar: 0, ms: 1500 }, { bar: 8, ms: 20250 }]);
  });
  it('ignora valores inválidos', () => {
    expect(cleanPoints([{ bar: -1, ms: 5 }, { bar: 2, ms: NaN }, { bar: 3, ms: 100 }])).toEqual([{ bar: 3, ms: 100 }]);
  });
  it('converte para o formato do alphaTab', () => {
    expect(toFlat([{ bar: 4, ms: 9000 }, { bar: 0, ms: 1000 }])).toEqual([
      { barIndex: 0, barPosition: 0, barOccurence: 0, millisecondOffset: 1000 },
      { barIndex: 4, barPosition: 0, barOccurence: 0, millisecondOffset: 9000 },
    ]);
  });
  it('escolhe a velocidade que o YouTube aceita mais perto', () => {
    const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    expect(nearestRate(rates, 0.75)).toBe(0.75);
    expect(nearestRate(rates, 0.9)).toBe(1);
    expect(nearestRate([1], 0.5)).toBe(1);
    expect(nearestRate([], 0.5)).toBe(0.5);
  });
});
