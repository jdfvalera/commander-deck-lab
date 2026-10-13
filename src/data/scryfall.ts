import type { ScryfallCard } from './types';
import { cardKeys, frontFace, nameKey } from './names';

export const COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
export const BATCH_SIZE = 75;
/** Scryfall asks for 50–100 ms between requests (about 10/s); stay on the polite side. */
export const REQUEST_GAP_MS = 120;

/** Persistent card store; the IndexedDB implementation lives in cardCache.ts. */
export interface CardCache {
  getMany(keys: string[]): Promise<(ScryfallCard | undefined)[]>;
  putMany(cards: ScryfallCard[]): Promise<void>;
}

export interface FetchCardsResult {
  /** Keyed by nameKey() of every requested name that resolved. */
  cards: Map<string, ScryfallCard>;
  notFound: string[];
  fromCache: number;
  fetched: number;
}

export interface FetchCardsOptions {
  cache?: CardCache;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Keeps only the fields the app uses, so the cache stays small. */
export function trimCard(raw: Record<string, unknown>): ScryfallCard {
  const c = raw as unknown as ScryfallCard;
  const out: ScryfallCard = {
    name: c.name,
    layout: c.layout,
    mana_cost: c.mana_cost,
    cmc: c.cmc,
    type_line: c.type_line,
    oracle_text: c.oracle_text,
    power: c.power,
    toughness: c.toughness,
    colors: c.colors,
    color_identity: c.color_identity ?? [],
    keywords: c.keywords ?? [],
    produced_mana: c.produced_mana,
    legalities: c.legalities ? { commander: c.legalities.commander } : undefined,
  };
  if (c.card_faces) {
    out.card_faces = c.card_faces.map((f) => ({
      name: f.name,
      mana_cost: f.mana_cost,
      type_line: f.type_line,
      oracle_text: f.oracle_text,
      power: f.power,
      toughness: f.toughness,
      colors: f.colors,
    }));
  }
  for (const k of Object.keys(out) as (keyof ScryfallCard)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * Resolves card names to Scryfall data: cache first, then POST /cards/collection in batches of 75
 * with a gap between requests. Double-faced cards are requested by front face and matched back by
 * full or face name. Retries once on 429 / network error.
 */
export async function fetchCards(names: string[], opts: FetchCardsOptions = {}): Promise<FetchCardsResult> {
  const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  const sleep = opts.sleep ?? defaultSleep;
  const wanted = new Map<string, string>(); // key -> original spelling
  for (const n of names) if (n.trim()) wanted.set(nameKey(n), n.trim());

  const cards = new Map<string, ScryfallCard>();
  const keys = [...wanted.keys()];
  let fromCache = 0;
  if (opts.cache) {
    try {
      const hits = await opts.cache.getMany(keys);
      hits.forEach((c, i) => {
        if (c) {
          cards.set(keys[i], c);
          fromCache++;
        }
      });
    } catch {
      // A broken cache just means we fetch everything.
    }
  }

  const missing = keys.filter((k) => !cards.has(k));
  const fetchedCards: ScryfallCard[] = [];
  const total = missing.length;
  opts.onProgress?.(0, total);

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(REQUEST_GAP_MS);
    const batch = missing.slice(i, i + BATCH_SIZE);
    const body = JSON.stringify({ identifiers: batch.map((k) => ({ name: frontFace(wanted.get(k)!) })) });
    const json = await postWithRetry(fetchImpl, body, sleep);
    const byKey = new Map<string, ScryfallCard>();
    for (const raw of json.data) {
      const card = trimCard(raw);
      fetchedCards.push(card);
      for (const k of cardKeys(card)) byKey.set(k, card);
    }
    for (const k of batch) {
      const card = byKey.get(k) ?? byKey.get(nameKey(frontFace(wanted.get(k)!)));
      if (card) cards.set(k, card);
    }
    opts.onProgress?.(Math.min(i + BATCH_SIZE, total), total);
  }

  if (opts.cache && fetchedCards.length) {
    try {
      await opts.cache.putMany(fetchedCards);
    } catch {
      // Caching is best-effort.
    }
  }

  const notFound = keys.filter((k) => !cards.has(k)).map((k) => wanted.get(k)!);
  return { cards, notFound, fromCache, fetched: fetchedCards.length };
}

interface CollectionResponse {
  data: Record<string, unknown>[];
  not_found: unknown[];
}

async function postWithRetry(
  fetchImpl: typeof fetch,
  body: string,
  sleep: (ms: number) => Promise<void>,
): Promise<CollectionResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(COLLECTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      });
      if (res.status === 429) {
        lastError = new Error('Scryfall rate limit hit (429).');
        await sleep(1000);
        continue;
      }
      if (!res.ok) throw new Error(`Scryfall returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as CollectionResponse;
    } catch (e) {
      lastError = e;
      if (attempt === 0) await sleep(500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
