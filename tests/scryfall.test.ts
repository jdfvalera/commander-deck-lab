import { describe, expect, it } from 'vitest';
import cardsJson from '../fixtures/scryfall/cards.json';
import { BATCH_SIZE, fetchCards, type CardCache } from '../src/data/scryfall';
import { idbCardCache } from '../src/data/cardCache';
import { cardKeys, nameKey } from '../src/data/names';
import type { ScryfallCard } from '../src/data/types';

const all = cardsJson as ScryfallCard[];

/** Fake Scryfall: matches identifiers like the real endpoint (front face or full single-face name). */
function fakeFetch(log: { bodies: { name: string }[][] }, opts: { status?: number[] } = {}) {
  const statuses = [...(opts.status ?? [])];
  return (async (_url: string, init: RequestInit) => {
    const status = statuses.shift() ?? 200;
    if (status !== 200) return new Response('slow down', { status });
    const ids = JSON.parse(String(init.body)).identifiers as { name: string }[];
    log.bodies.push(ids);
    const data: ScryfallCard[] = [];
    const notFound: { name: string }[] = [];
    for (const id of ids) {
      const hit = all.find((c) => nameKey(c.name) === nameKey(id.name) || nameKey(c.card_faces?.[0]?.name ?? '') === nameKey(id.name));
      if (hit) data.push(hit);
      else notFound.push(id);
    }
    return new Response(JSON.stringify({ data, not_found: notFound }), { status: 200 });
  }) as unknown as typeof fetch;
}

const noSleep = async () => {};

function memoryCache(): CardCache & { map: Map<string, ScryfallCard> } {
  const map = new Map<string, ScryfallCard>();
  return {
    map,
    async getMany(keys) {
      return keys.map((k) => map.get(k));
    },
    async putMany(cards) {
      for (const c of cards) for (const k of cardKeys(c)) map.set(k, c);
    },
  };
}

describe('fetchCards', () => {
  it('batches 75 identifiers per request', async () => {
    const log = { bodies: [] as { name: string }[][] };
    const names = all.map((c) => c.name);
    const r = await fetchCards(names, { fetchImpl: fakeFetch(log), sleep: noSleep });
    expect(log.bodies.map((b) => b.length)).toEqual([BATCH_SIZE, names.length - BATCH_SIZE]);
    expect(r.notFound).toEqual([]);
    expect(r.cards.size).toBe(names.length);
  });

  it('requests double-faced cards by front face and maps them back to the full name', async () => {
    const log = { bodies: [] as { name: string }[][] };
    const r = await fetchCards(['The Enigma Jewel // Locus of Enlightenment', 'the enigma jewel'], { fetchImpl: fakeFetch(log), sleep: noSleep });
    expect(log.bodies[0]).toEqual([{ name: 'The Enigma Jewel' }, { name: 'the enigma jewel' }]);
    expect(r.cards.get(nameKey('The Enigma Jewel // Locus of Enlightenment'))?.layout).toBe('transform');
    expect(r.cards.get('the enigma jewel')?.name).toBe('The Enigma Jewel // Locus of Enlightenment');
  });

  it('reports names that were not found, with the user’s spelling', async () => {
    const r = await fetchCards(['Sol Ring', 'Sol Rnig'], { fetchImpl: fakeFetch({ bodies: [] }), sleep: noSleep });
    expect(r.notFound).toEqual(['Sol Rnig']);
  });

  it('serves the second load from cache without a request', async () => {
    const cache = memoryCache();
    const log = { bodies: [] as { name: string }[][] };
    await fetchCards(['Sol Ring', 'Counterspell'], { cache, fetchImpl: fakeFetch(log), sleep: noSleep });
    const r = await fetchCards(['sol ring', 'Counterspell'], { cache, fetchImpl: fakeFetch(log), sleep: noSleep });
    expect(log.bodies).toHaveLength(1);
    expect(r.fromCache).toBe(2);
    expect(r.fetched).toBe(0);
  });

  it('retries once after a 429', async () => {
    const log = { bodies: [] as { name: string }[][] };
    const r = await fetchCards(['Sol Ring'], { fetchImpl: fakeFetch(log, { status: [429] }), sleep: noSleep });
    expect(r.cards.size).toBe(1);
  });

  it('waits between batches', async () => {
    const waits: number[] = [];
    await fetchCards(all.map((c) => c.name), { fetchImpl: fakeFetch({ bodies: [] }), sleep: async (ms) => void waits.push(ms) });
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThanOrEqual(100);
  });

  it('works with the IndexedDB cache', async () => {
    await fetchCards(['Sol Ring'], { cache: idbCardCache, fetchImpl: fakeFetch({ bodies: [] }), sleep: noSleep });
    const [hit] = await idbCardCache.getMany(['sol ring']);
    expect(hit?.name).toBe('Sol Ring');
  });
});
