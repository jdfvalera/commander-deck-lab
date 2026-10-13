import { createStore, getMany, setMany, clear, keys } from 'idb-keyval';
import type { CardCache } from './scryfall';
import type { ScryfallCard } from './types';
import { cardKeys } from './names';

let store: ReturnType<typeof createStore> | null = null;
function cardStore() {
  store ??= createStore('cdl-cards', 'cards');
  return store;
}

/** IndexedDB-backed card cache. Each card is stored under its full name and every face name. */
export const idbCardCache: CardCache = {
  async getMany(names) {
    return (await getMany<ScryfallCard>(names, cardStore())).map((c) => c ?? undefined);
  },
  async putMany(cards) {
    const entries: [string, ScryfallCard][] = [];
    for (const c of cards) for (const k of cardKeys(c)) entries.push([k, c]);
    await setMany(entries, cardStore());
  },
};

export async function cachedCardCount(): Promise<number> {
  try {
    return (await keys(cardStore())).length;
  } catch {
    return 0;
  }
}

export async function clearCardCache(): Promise<void> {
  try {
    await clear(cardStore());
  } catch {
    // nothing to clear
  }
}
