import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachAccount, detachAccount, flush, hasPending, store } from '../src/app/user-store';

afterEach(() => { detachAccount(); vi.useRealTimers(); });

describe('dados da pessoa (guardados na conta, nunca no browser)', () => {
  it('carrega os dados da conta e junta as alterações num só envio', async () => {
    vi.useFakeTimers();
    const sent: Record<string, unknown>[] = [];
    attachAccount({ 'mapa:theme': 'light' }, async e => { sent.push(e); });
    expect(store.get('mapa:theme')).toBe('light');
    store.set('mapa:sync', 120); store.set('mapa:tabPerRow', 4); store.set('mapa:sync', 130);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1600);
    expect(sent).toEqual([{ 'mapa:sync': 130, 'mapa:tabPerRow': 4 }]);
  });

  it('não reenvia um valor que não mudou', async () => {
    const save = vi.fn(async () => {});
    attachAccount({ 'mapa:theme': 'dark' }, save);
    store.set('mapa:theme', 'dark');
    expect(hasPending()).toBe(false);
  });

  it('sem rede: avisa e volta a tentar mais tarde, sem perder nada', async () => {
    let fail = true; const sent: Record<string, unknown>[] = []; const warn = vi.fn();
    attachAccount({}, async e => { if (fail) throw new Error('offline'); sent.push(e); }, warn);
    store.set('mapa:x', { texts: { 1: 'slide' } });
    await flush();
    expect(warn).toHaveBeenCalled();
    expect(hasPending()).toBe(true);
    fail = false; await flush();
    expect(sent).toEqual([{ 'mapa:x': { texts: { 1: 'slide' } } }]);
  });

  it('sem conta, nada é enviado; ao sair, os dados da conta desaparecem da memória', async () => {
    store.set('mapa:sync', 50);
    expect(hasPending()).toBe(false);
    attachAccount({ 'mapa:sync': 200 }, async () => {});
    expect(store.get('mapa:sync')).toBe(200);
    detachAccount();
    expect(store.get('mapa:sync')).toBeNull();
  });

  it('devolve cópias (mexer no valor lido não altera o guardado)', () => {
    attachAccount({ 'mapa:s': { texts: { 1: 'a' } } }, async () => {});
    const v = store.get<{ texts: Record<number, string> }>('mapa:s')!; v.texts[1] = 'b';
    expect(store.get('mapa:s')).toEqual({ texts: { 1: 'a' } });
  });
});
