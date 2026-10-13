import { createStore, get, set } from 'idb-keyval';
import type { DeckList, DeckVersion, SavedDeck } from './types';

let store: ReturnType<typeof createStore> | null = null;
const dataStore = () => (store ??= createStore('cdl-data', 'kv'));

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export async function loadDecks(): Promise<SavedDeck[]> {
  try {
    return (await get<SavedDeck[]>('decks', dataStore())) ?? [];
  } catch {
    return [];
  }
}

export async function saveDecks(decks: SavedDeck[]): Promise<boolean> {
  try {
    await set('decks', decks, dataStore());
    return true;
  } catch {
    return false;
  }
}

export function sameList(a: DeckList, b: DeckList): boolean {
  const norm = (l: DeckList) =>
    JSON.stringify([
      [...l.commanders].sort(),
      [...l.cards].map((c) => `${c.qty} ${c.name}`).sort(),
    ]);
  return norm(a) === norm(b);
}

/** Adds a version unless it's identical to the latest one. Returns the updated deck. */
export function addVersion(deck: SavedDeck, list: DeckList, label?: string): SavedDeck {
  const latest = deck.versions[deck.versions.length - 1];
  if (latest && sameList(latest.list, list)) return deck;
  const version: DeckVersion = {
    id: newId(),
    label: label || `v${deck.versions.length + 1}`,
    createdAt: Date.now(),
    list,
  };
  return { ...deck, updatedAt: version.createdAt, versions: [...deck.versions, version] };
}

/** Cards added and removed going from version a to b. */
export function diffLists(a: DeckList, b: DeckList): { added: string[]; removed: string[] } {
  const count = (l: DeckList) => {
    const m = new Map<string, number>();
    for (const c of [...l.commanders.map((n) => ({ name: n, qty: 1 })), ...l.cards]) m.set(c.name, (m.get(c.name) ?? 0) + c.qty);
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [n, q] of cb) for (let i = ca.get(n) ?? 0; i < q; i++) added.push(n);
  for (const [n, q] of ca) for (let i = cb.get(n) ?? 0; i < q; i++) removed.push(n);
  return { added, removed };
}
