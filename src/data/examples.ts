import current from '../../fixtures/decks/pride-current.json';
import revised from '../../fixtures/decks/pride-revised.json';
import type { DeckList } from './types';

export interface ExampleDeck {
  id: string;
  name: string;
  versions: { label: string; list: DeckList }[];
}

/** The decks from the project brief, loadable from the Decks page. */
export const EXAMPLE_DECKS: ExampleDeck[] = [
  {
    id: 'pride',
    name: 'The Pride of Hull Clade',
    versions: [
      { label: 'Current', list: { commanders: current.commanders, cards: current.cards } },
      { label: 'Revised (16 swaps)', list: { commanders: revised.commanders, cards: revised.cards } },
    ],
  },
];
