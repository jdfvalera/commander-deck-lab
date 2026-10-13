// Shapes shared by the data layer, the tagger and the UI.

export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];

/** The subset of a Scryfall card object the app keeps (see scripts/snapshot-scryfall.ts). */
export interface ScryfallFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
}

export interface ScryfallCard {
  name: string;
  layout: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  color_identity: string[];
  keywords: string[];
  produced_mana?: string[];
  legalities?: { commander?: string };
  card_faces?: ScryfallFace[];
}

export interface DeckEntry {
  name: string;
  qty: number;
}

/** A decklist as the user wrote it: names only, no card data. */
export interface DeckList {
  commanders: string[];
  cards: DeckEntry[];
}

export interface DeckVersion {
  id: string;
  label: string;
  createdAt: number;
  list: DeckList;
}

export interface SavedDeck {
  id: string;
  name: string;
  updatedAt: number;
  versions: DeckVersion[];
}
