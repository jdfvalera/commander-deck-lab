// Shareable deck links and JSON backups. Everything stays client-side: a link carries the deck in its
// URL hash (compressed), a backup is a file you download and load back.
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { DeckList, SavedDeck } from './types';
import type { OverrideMap } from '../tags/overrides';
import type { SavedRun } from './results';
import { nameKey } from './names';

export interface SharedDeck {
  v: 1;
  name: string;
  list: DeckList;
  /** Your tag edits for cards in this deck, so the recipient simulates the same deck. */
  overrides?: OverrideMap;
}

export function encodeDeck(d: SharedDeck): string {
  return compressToEncodedURIComponent(JSON.stringify(d));
}

export function decodeDeck(s: string): SharedDeck | null {
  try {
    const json = decompressFromEncodedURIComponent(s);
    if (!json) return null;
    const d = JSON.parse(json) as SharedDeck;
    if (d.v !== 1 || !Array.isArray(d.list?.commanders) || !Array.isArray(d.list?.cards)) return null;
    return d;
  } catch {
    return null;
  }
}

/** The overrides relevant to one deck's cards. */
export function overridesFor(list: DeckList, all: OverrideMap): OverrideMap {
  const keys = new Set([...list.commanders, ...list.cards.map((c) => c.name)].map(nameKey));
  return Object.fromEntries(Object.entries(all).filter(([k]) => keys.has(k)));
}

export function shareUrl(d: SharedDeck, base = `${location.origin}${location.pathname}`): string {
  return `${base}#/share/${encodeDeck(d)}`;
}

export interface Backup {
  app: 'commander-deck-lab';
  version: 1;
  exportedAt: string;
  decks: SavedDeck[];
  tagOverrides: OverrideMap;
  /** Saved simulation runs (optional: older backups don't have them). */
  runs?: SavedRun[];
}

export function makeBackup(decks: SavedDeck[], tagOverrides: OverrideMap, runs: SavedRun[] = []): Backup {
  return { app: 'commander-deck-lab', version: 1, exportedAt: new Date().toISOString(), decks, tagOverrides, runs };
}

export function parseBackup(text: string): Backup {
  const b = JSON.parse(text) as Backup;
  if (b.app !== 'commander-deck-lab' || b.version !== 1 || !Array.isArray(b.decks)) throw new Error('Not a Commander Deck Lab backup file.');
  return { ...b, tagOverrides: b.tagOverrides ?? {} };
}

/**
 * Merges a backup into what's here: decks with the same id keep every version from both (by version id);
 * new decks are added; tag edits from the backup win for the cards they cover.
 */
export function mergeBackup(decks: SavedDeck[], overrides: OverrideMap, b: Backup): { decks: SavedDeck[]; overrides: OverrideMap; added: number; updated: number } {
  const byId = new Map(decks.map((d) => [d.id, d]));
  let added = 0;
  let updated = 0;
  for (const d of b.decks) {
    const mine = byId.get(d.id);
    if (!mine) {
      byId.set(d.id, d);
      added++;
      continue;
    }
    const have = new Set(mine.versions.map((v) => v.id));
    const extra = d.versions.filter((v) => !have.has(v.id));
    if (extra.length) {
      byId.set(d.id, { ...mine, versions: [...mine.versions, ...extra].sort((x, y) => x.createdAt - y.createdAt), updatedAt: Math.max(mine.updatedAt, d.updatedAt) });
      updated++;
    }
  }
  const merged: OverrideMap = { ...overrides };
  for (const [k, v] of Object.entries(b.tagOverrides)) merged[k] = { ...(merged[k] ?? {}), ...v };
  return { decks: [...byId.values()], overrides: merged, added, updated };
}

/** Starts a browser download of a text file. */
export function download(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
