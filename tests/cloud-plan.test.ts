import { describe, expect, it } from 'vitest';
import { planSync, storageKey, type RemoteSong } from '../src/app/cloud-plan';
import type { SongMeta } from '../src/app/library';

const local = (id: string, openedAt: number): SongMeta => ({ id, fileName: id + '.gp5', title: id, artist: '', bars: 10, addedAt: 1, openedAt });
const remote = (id: string, openedAt: number, deletedAt: number | null = null): RemoteSong => ({ ...local(id, openedAt), deletedAt });

describe('sincronização de "My songs"', () => {
  it('envia o que só existe aqui e descarrega o que só existe na conta', () => {
    const p = planSync([local('a', 5)], [remote('b', 5)]);
    expect(p.upload).toEqual(['a']);
    expect(p.download).toEqual(['b']);
    expect(p.deleteLocal).toEqual([]);
  });

  it('apaga aqui o que foi apagado noutro dispositivo, e não descarrega apagadas', () => {
    const p = planSync([local('a', 5)], [remote('a', 10, 10), remote('c', 10, 10)]);
    expect(p.deleteLocal).toEqual(['a']);
    expect(p.download).toEqual([]);
    expect(p.upload).toEqual([]);
  });

  it('mantém (e volta a enviar) uma música reimportada depois de ter sido apagada', () => {
    const p = planSync([local('a', 20)], [remote('a', 10, 10)]);
    expect(p.upload).toEqual(['a']);
    expect(p.deleteLocal).toEqual([]);
  });

  it('a data de abertura mais recente ganha', () => {
    const p = planSync([local('a', 20), local('b', 5), local('c', 7)], [remote('a', 10), remote('b', 15), remote('c', 7)]);
    expect(p.pushOpened).toEqual(['a']);
    expect(p.pullOpened).toEqual([{ id: 'b', openedAt: 15 }]);
    expect(p.upload).toEqual([]);
    expect(p.download).toEqual([]);
  });

  it('o nome do ficheiro na nuvem é estável e seguro', async () => {
    const k = await storageKey('Song | Band | 52');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(await storageKey('Song | Band | 52')).toBe(k);
  });
});
