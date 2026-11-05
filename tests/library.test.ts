import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { readLegacyData, readLegacySongs, relativeDay, wipeLegacy } from '../src/app/library';

/** Cria a base que as versões antigas do site deixavam no browser. */
function legacyDb(idb: IDBFactory, songs: object[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = idb.open('mapa-de-compassos', 2);
    req.onupgradeneeded = () => { req.result.createObjectStore('songs', { keyPath: 'id' }); req.result.createObjectStore('pending'); };
    req.onsuccess = () => {
      const t = req.result.transaction('songs', 'readwrite');
      for (const s of songs) t.objectStore('songs').put(s);
      t.oncomplete = () => { req.result.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
  });
}
class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}
const song = (id: string, openedAt: number) => ({ id, fileName: id + '.gp5', title: id, artist: '', bars: 10, addedAt: 1, openedAt, bytes: new Uint8Array([1, 2]).buffer });

describe('dados antigos deixados no browser (passam para a conta uma vez)', () => {
  it('lê as músicas antigas, da mais recente para a mais antiga', async () => {
    const idb = new IDBFactory();
    await legacyDb(idb, [song('a', 5), song('b', 9)]);
    const list = await readLegacySongs(idb);
    expect(list.map(s => s.id)).toEqual(['b', 'a']);
    expect(Array.from(list[0].bytes)).toEqual([1, 2]);
  });

  it('sem dados antigos não cria nada no browser', async () => {
    const idb = new IDBFactory();
    expect(await readLegacySongs(idb)).toEqual([]);
    expect((await idb.databases()).length).toBe(0);
  });

  it('lê as chaves "mapa:" do localStorage e depois apaga tudo', async () => {
    const idb = new IDBFactory(), ls = new MemStorage();
    await legacyDb(idb, [song('a', 5)]);
    ls.setItem('mapa:theme', '"light"'); ls.setItem('mapa:x|y|3', '{"texts":{"1":"slide"}}'); ls.setItem('outra', '1');
    expect(readLegacyData(ls)).toEqual({ 'mapa:theme': 'light', 'mapa:x|y|3': { texts: { 1: 'slide' } } });
    await wipeLegacy(idb, ls);
    expect(readLegacyData(ls)).toEqual({});
    expect(ls.getItem('outra')).toBe('1'); // só apaga o que é do ChordTile
    expect(await readLegacySongs(idb)).toEqual([]);
  });

  it('mostra datas relativas', () => {
    const now = Date.UTC(2026, 10, 1, 12);
    expect(relativeDay(now, now)).toBe('today');
    expect(relativeDay(now - 86_400_000, now)).toBe('yesterday');
    expect(relativeDay(now - 5 * 86_400_000, now)).toBe('5 days ago');
    expect(relativeDay(now - 65 * 86_400_000, now)).toBe('2 months ago');
  });
});
