import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { deleteSong, getSong, listSongs, relativeDay, saveSong, touchSong } from '../src/app/library';

const meta = (id: string, title: string) => ({ id, fileName: title + '.gp5', title, artist: 'Banda', bars: 52 });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('biblioteca de músicas', () => {
  it('guarda, lista, abre e apaga', async () => {
    const idb = new IDBFactory();
    await saveSong(meta('a', 'Primeira'), new Uint8Array([1, 2, 3]), idb);
    await wait(5);
    await saveSong(meta('b', 'Segunda'), new Uint8Array([4, 5]), idb);

    const list = await listSongs(idb);
    expect(list.map(s => s.title)).toEqual(['Segunda', 'Primeira']); // a mais recente primeiro
    expect(list[0]).not.toHaveProperty('bytes');

    const song = await getSong('a', idb);
    expect(Array.from(song!.bytes)).toEqual([1, 2, 3]);

    await deleteSong('b', idb);
    expect((await listSongs(idb)).map(s => s.id)).toEqual(['a']);
    expect(await getSong('b', idb)).toBeNull();
  });

  it('abrir uma música põe-na no topo e voltar a importá-la não a duplica', async () => {
    const idb = new IDBFactory();
    await saveSong(meta('a', 'Primeira'), new Uint8Array([1]), idb);
    await wait(5);
    await saveSong(meta('b', 'Segunda'), new Uint8Array([2]), idb);
    await wait(5);
    await touchSong('a', idb);
    expect((await listSongs(idb))[0].id).toBe('a');

    const added = (await getSong('a', idb))!.addedAt;
    await wait(5);
    await saveSong(meta('a', 'Primeira'), new Uint8Array([9]), idb);
    const list = await listSongs(idb);
    expect(list).toHaveLength(2);
    const again = await getSong('a', idb);
    expect(again!.addedAt).toBe(added);
    expect(Array.from(again!.bytes)).toEqual([9]);
  });

  it('mostra datas relativas', () => {
    const now = Date.UTC(2026, 10, 1, 12);
    expect(relativeDay(now, now)).toBe('hoje');
    expect(relativeDay(now - 86_400_000, now)).toBe('ontem');
    expect(relativeDay(now - 5 * 86_400_000, now)).toBe('há 5 dias');
    expect(relativeDay(now - 65 * 86_400_000, now)).toBe('há 2 meses');
  });
});

describe('ficheiro escolhido na página inicial', () => {
  it('fica à espera até o leitor o abrir, uma só vez', async () => {
    const { setPendingFile, takePendingFile } = await import('../src/app/library');
    const idb = new IDBFactory();
    expect(await takePendingFile(idb)).toBeNull();
    await setPendingFile('musica.gp5', new Uint8Array([7, 8, 9]), idb);
    const f = await takePendingFile(idb);
    expect(f?.name).toBe('musica.gp5');
    expect(Array.from(f!.bytes)).toEqual([7, 8, 9]);
    expect(await takePendingFile(idb)).toBeNull();
    expect(await listSongs(idb)).toEqual([]); // não aparece em "As minhas músicas" antes de abrir
  });
});
