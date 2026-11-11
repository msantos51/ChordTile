import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachAccount, detachAccount, flush, flushOnExit, hasPending, isHydrated, mergeRemote, store } from '../src/app/user-store';

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

  it('os envios vão um de cada vez e por ordem (o valor mais recente é o último a chegar)', async () => {
    const order: string[] = []; let release!: () => void;
    const first = new Promise<void>(r => { release = r; });
    let n = 0;
    attachAccount({}, async e => { const mine = ++n; if (mine === 1) await first; order.push(String(e['mapa:x'])); });
    store.set('mapa:x', 'old'); const a = flush();
    await Promise.resolve(); await Promise.resolve(); // o primeiro envio já saiu (e fica à espera da resposta)
    store.set('mapa:x', 'new'); const b = flush();
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual([]);            // o segundo espera pelo primeiro
    release(); await a; await b;
    expect(order).toEqual(['old', 'new']);
  });

  it('sem rede ao abrir: nada é enviado antes de ler a conta; depois, o que está na conta mantém-se e as alterações feitas seguem', async () => {
    vi.useFakeTimers();
    const sent: Record<string, unknown>[] = [];
    attachAccount(null, async e => { sent.push(e); });
    expect(isHydrated()).toBe(false);
    store.set('mapa:sync', 40);                       // alterado pela pessoa enquanto não havia rede
    await vi.advanceTimersByTimeAsync(5000); await flush();
    expect(sent).toEqual([]);
    const changed = mergeRemote({ 'mapa:theme': 'light', 'mapa:sync': 200 });
    expect(changed).toEqual(['mapa:theme']);          // a alteração local ganha à da conta
    expect(store.get('mapa:theme')).toBe('light');
    expect(store.get('mapa:sync')).toBe(40);
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toEqual([{ 'mapa:sync': 40 }]);
  });

  it('junta o que mudou noutro dispositivo e diz que chaves mudaram', () => {
    attachAccount({ 'mapa:a': { texts: { 1: 'x' } }, 'mapa:b': 1 }, async () => {});
    expect(mergeRemote({ 'mapa:a': { texts: { 1: 'x' } }, 'mapa:b': 2, 'mapa:c': 'novo' })).toEqual(['mapa:b', 'mapa:c']);
    expect(store.get('mapa:b')).toBe(2);
    expect(hasPending()).toBe(false);                 // o que veio da conta não volta a ser enviado
  });

  it('ao fechar a página: envia já; se falhar e a página continuar aberta, volta à fila', async () => {
    const normal = vi.fn(async () => {});
    attachAccount({}, normal);
    store.set('mapa:x', 1);
    const now: Record<string, unknown>[] = [];
    flushOnExit(e => { now.push(e); return Promise.resolve(); });
    expect(now).toEqual([{ 'mapa:x': 1 }]);
    expect(hasPending()).toBe(false);
    store.set('mapa:x', 2);
    flushOnExit(() => Promise.reject(new Error('offline')));
    await Promise.resolve(); await Promise.resolve();
    expect(hasPending()).toBe(true);
    store.set('mapa:y', 3);
    flushOnExit(() => null);                          // não foi possível o envio imediato: segue pelo normal
    await flush();
    expect(normal).toHaveBeenCalledWith({ 'mapa:x': 2, 'mapa:y': 3 });
  });

  it('um envio que falha depois de sair da conta não passa para a conta seguinte', async () => {
    let fail!: () => void;
    attachAccount({}, () => new Promise<void>((_, rej) => { fail = () => rej(new Error('x')); }));
    store.set('mapa:x', 'da conta A'); const f = flush();
    await Promise.resolve();
    detachAccount();
    const sentB: Record<string, unknown>[] = [];
    attachAccount({}, async e => { sentB.push(e); });
    fail(); await f; await flush();
    expect(hasPending()).toBe(false);
    expect(sentB).toEqual([]);
  });
});
