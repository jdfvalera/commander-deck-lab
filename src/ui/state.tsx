import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SavedDeck, ScryfallCard } from '../data/types';
import { fetchCards } from '../data/scryfall';
import { idbCardCache } from '../data/cardCache';
import { loadDecks, saveDecks } from '../data/storage';
import { nameKey } from '../data/names';
import { autoTag } from '../tags/autoTag';
import { applyOverrides, loadOverrides, saveOverrides, type OverrideMap } from '../tags/overrides';
import type { CardTags } from '../tags/schema';

interface LoadProgress {
  done: number;
  total: number;
}

interface AppState {
  ready: boolean;
  decks: SavedDeck[];
  updateDecks: (fn: (prev: SavedDeck[]) => SavedDeck[]) => void;
  /** False when the browser refused to store data (private mode etc.). */
  storageOk: boolean;
  overrides: OverrideMap;
  updateOverrides: (fn: (prev: OverrideMap) => OverrideMap) => void;
  cards: Map<string, ScryfallCard>;
  /** Loads card data for these names (cache, then Scryfall). Resolves to the names not found. */
  ensureCards: (names: string[]) => Promise<string[]>;
  cardProgress: LoadProgress | null;
  cardError: string | null;
  card: (name: string) => ScryfallCard | undefined;
  tagsFor: (name: string) => CardTags | undefined;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [storageOk, setStorageOk] = useState(true);
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [cards, setCards] = useState(() => new Map<string, ScryfallCard>());
  const [cardProgress, setCardProgress] = useState<LoadProgress | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const cardsRef = useRef(cards);

  useEffect(() => {
    let live = true;
    Promise.all([loadDecks(), loadOverrides()]).then(([d, o]) => {
      if (!live) return;
      setDecks(d);
      setOverrides(o);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const updateDecks = useCallback((fn: (prev: SavedDeck[]) => SavedDeck[]) => {
    setDecks((prev) => {
      const next = fn(prev);
      saveDecks(next).then(setStorageOk);
      return next;
    });
  }, []);

  const updateOverrides = useCallback((fn: (prev: OverrideMap) => OverrideMap) => {
    setOverrides((prev) => {
      const next = fn(prev);
      saveOverrides(next);
      return next;
    });
  }, []);

  const ensureCards = useCallback(async (names: string[]) => {
    const missing = [...new Set(names)].filter((n) => !cardsRef.current.has(nameKey(n)));
    if (!missing.length) return [];
    setCardError(null);
    try {
      const res = await fetchCards(missing, {
        cache: idbCardCache,
        onProgress: (done, total) => setCardProgress(total ? { done, total } : null),
      });
      const next = new Map(cardsRef.current);
      for (const [k, c] of res.cards) next.set(k, c);
      cardsRef.current = next;
      setCards(next);
      return res.notFound;
    } catch (e) {
      setCardError(`Couldn't reach Scryfall: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    } finally {
      setCardProgress(null);
    }
  }, []);

  const autoTags = useMemo(() => {
    const m = new Map<string, CardTags>();
    for (const [k, c] of cards) m.set(k, autoTag(c));
    return m;
  }, [cards]);

  const value = useMemo<AppState>(() => {
    const card = (name: string) => cards.get(nameKey(name));
    const tagsFor = (name: string) => {
      const c = card(name);
      if (!c) return undefined;
      const k = nameKey(c.name);
      return applyOverrides(autoTags.get(nameKey(name)) ?? autoTag(c), overrides[k]);
    };
    return { ready, decks, updateDecks, storageOk, overrides, updateOverrides, cards, ensureCards, cardProgress, cardError, card, tagsFor };
  }, [ready, decks, updateDecks, storageOk, overrides, updateOverrides, cards, ensureCards, cardProgress, cardError, autoTags]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
