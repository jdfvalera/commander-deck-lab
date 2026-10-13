import rex from '../../fixtures/decks/precons/tramplesaurusrex-fdc.json';
import angels from '../../fixtures/decks/precons/callingallangels-fdc.json';
import keen from '../../fixtures/decks/precons/keenengineering-fdc.json';
import dragons from '../../fixtures/decks/precons/reignofdragons-fdc.json';
import ranks from '../../fixtures/decks/precons/wretchedranks-fdc.json';
import type { DeckList } from '../data/types';

export interface PresetDeck {
  id: string;
  name: string;
  blurb: string;
  list: DeckList;
}

/** The Foundations Commander precons (decklists from MTGJSON, stored in the repo). */
export const PRESETS: PresetDeck[] = [
  { id: 'rex', name: 'Tramplesaurus Rex', blurb: 'Green stompy: big tramplers, Ezuri’s Predation', list: rex },
  { id: 'angels', name: 'Calling All Angels', blurb: 'White fliers: three board wipes, lots of removal', list: angels },
  { id: 'keen', name: 'Keen Engineering', blurb: 'Blue artifacts: counterspells, Aetherize, Propaganda, Disk', list: keen },
  { id: 'dragons', name: 'Reign of Dragons', blurb: 'Red dragons: fliers and damage wipes', list: dragons },
  { id: 'ranks', name: 'Wretched Ranks', blurb: 'Black zombies: edicts, removal, Mutilate', list: ranks },
];
