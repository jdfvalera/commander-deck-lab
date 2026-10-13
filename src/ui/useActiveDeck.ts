import { useEffect, useMemo, useState } from 'react';
import { useApp } from './state';
import { guessCommanders } from '../data/validateDeck';
import { buildDeckModel, type DeckModel } from '../engine/deckModel';
import type { DeckList, DeckVersion, SavedDeck } from '../data/types';

const KEY = 'cdl-active-deck';

function readActive(): { deckId?: string; versionId?: string } {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export interface ActiveDeck {
  decks: SavedDeck[];
  deck?: SavedDeck;
  version?: DeckVersion;
  select: (deckId: string, versionId?: string) => void;
  /** The list with a guessed commander applied, once card data is loaded. */
  list?: DeckList;
  model?: DeckModel;
  loading: boolean;
}

/** The deck and version the tools pages work on; remembered in localStorage per browser. */
export function useActiveDeck(): ActiveDeck {
  const { decks, ready, ensureCards, card, tagsFor, cards } = useApp();
  const [sel, setSel] = useState(readActive);
  const [loading, setLoading] = useState(false);

  const deck = decks.find((d) => d.id === sel.deckId) ?? decks[0];
  const version = deck?.versions.find((v) => v.id === sel.versionId) ?? deck?.versions[deck.versions.length - 1];

  useEffect(() => {
    if (!version) return;
    let live = true;
    const names = [...version.list.commanders, ...version.list.cards.map((c) => c.name)];
    Promise.resolve()
      .then(() => live && setLoading(true))
      .then(() => ensureCards(names))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [version, ensureCards]);

  const loaded = !!version && [...version.list.commanders, ...version.list.cards.map((c) => c.name)].every((n) => card(n));
  const list = useMemo(() => (loaded && version ? guessCommanders(version.list, card).list : undefined), [loaded, version, card]);
  // `cards` changes when new card data arrives; tag overrides change `tagsFor`.
  const model = useMemo(() => (list ? buildDeckModel(list, card, tagsFor) : undefined), [list, card, tagsFor, cards]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (deckId: string, versionId?: string) => {
    const next = { deckId, versionId };
    setSel(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // not remembered across visits
    }
  };

  return { decks: ready ? decks : [], deck, version, select, list, model, loading: loading || (!!version && !loaded) };
}
