import { describe, expect, it } from 'vitest';
import { storageKey } from '../src/app/cloud-plan';

describe('ficheiros das músicas na conta', () => {
  it('o nome do ficheiro na nuvem é estável e seguro', async () => {
    const k = await storageKey('Song | Band | 52');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(await storageKey('Song | Band | 52')).toBe(k);
  });
});
