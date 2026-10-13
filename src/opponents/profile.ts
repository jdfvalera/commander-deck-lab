// Opponent profiles for the matchup simulator: built from a real decklist, every number editable.
// The board curve comes from running the opponent's own list through the goldfish engine.

import type { DeckList, ScryfallCard } from '../data/types';
import type { CardTags } from '../tags/schema';
import { compileDeck } from '../engine/cards';
import { DEFAULT_GOLDFISH, playGame } from '../engine/goldfish';
import { deriveSeed } from '../engine/rng';

export interface CreatureSpec {
  name: string;
  power: number;
  toughness: number;
  flying: boolean;
  reach: boolean;
  trample: boolean;
  unblockable: boolean;
  defender: boolean;
  mv: number;
  count: number;
}

export interface InteractionSpec {
  name: string;
  kind: string;
  x?: number;
  artifacts?: boolean;
  oneSided?: boolean;
  scope?: string;
  per?: number;
}

export interface OpponentProfile {
  id: string;
  name: string;
  commander: string;
  colors: string;
  wipes: InteractionSpec[];
  removal: InteractionSpec[];
  counters: InteractionSpec[];
  aetherize: InteractionSpec[];
  taxes: InteractionSpec[];
  creatures: CreatureSpec[];
  /** Average total creature power on their board at the end of each turn (from their own goldfish). */
  powerCurve: number[];
  /** Share of that power with flying / trample (informational). */
  flyingShare: number;
  trampleShare: number;
  /** Extra cards a turn beyond the draw step. */
  extraDraw: number;
  // ---- behaviour (editable) ----
  /** Share of eligible creatures that attack each turn. */
  aggression: number;
  /** Who their attacks go at: the biggest threat, the lowest life, or spread at random. */
  priority: 'threat' | 'weakest' | 'spread';
  /** Chance they have mana open and use held interaction when it matters. */
  interactionRate: number;
  /** Multiplies the board curve. */
  curveScale: number;
  /** They wipe once you control at least this many creatures (and your board outclasses theirs). */
  wipeAt: number;
}

export function buildProfile(
  id: string,
  name: string,
  list: DeckList,
  lookup: (n: string) => ScryfallCard | undefined,
  tagsFor: (n: string) => CardTags | undefined,
  games = 120,
): OpponentProfile {
  const deck = compileDeck(list, lookup, tagsFor);
  const wipes: InteractionSpec[] = [];
  const removal: InteractionSpec[] = [];
  const counters: InteractionSpec[] = [];
  const aetherize: InteractionSpec[] = [];
  const taxes: InteractionSpec[] = [];
  const pool = new Map<string, CreatureSpec>();
  let draw = 0;
  for (const i of deck.library) {
    const d = deck.defs[i];
    if (d.boardWipe) wipes.push({ name: d.name, kind: d.boardWipe.kind, x: d.boardWipe.x, artifacts: d.boardWipe.artifacts, oneSided: d.boardWipe.oneSided });
    else if (d.spotRemoval) removal.push({ name: d.name, kind: d.spotRemoval.kind, scope: d.spotRemoval.targets });
    if (d.counterspell) counters.push({ name: d.name, kind: 'counter', scope: d.counterspell.scope });
    if (d.aetherize) aetherize.push({ name: d.name, kind: 'aetherize' });
    if (d.attackTax) taxes.push({ name: d.name, kind: 'tax', per: d.attackTax });
    if (d.draw?.perTurn) draw += d.draw.perTurn * 0.4; // engines are only out part of the game
    const add = (c: Omit<CreatureSpec, 'count'>, n = 1) => {
      const prev = pool.get(c.name);
      if (prev) prev.count += n;
      else pool.set(c.name, { ...c, count: n });
    };
    if (d.types.creature && d.power + d.toughness > 0) {
      add({ name: d.name, power: d.power, toughness: Math.max(1, d.toughness), flying: d.keywords.flying, reach: d.keywords.reach, trample: d.keywords.trample, unblockable: d.keywords.unblockable, defender: d.keywords.defender, mv: d.mv });
    }
    if (d.tokenMaker && d.tokenMaker.power + d.tokenMaker.toughness > 0) {
      add({ name: `${d.name} token`, power: d.tokenMaker.power, toughness: Math.max(1, d.tokenMaker.toughness), flying: d.tokenMaker.flying, reach: false, trample: false, unblockable: false, defender: false, mv: d.mv }, Math.max(1, d.tokenMaker.count));
    }
  }
  for (const c of deck.commanders) {
    const d = deck.defs[c];
    if (d.types.creature) pool.set(d.name, { name: d.name, power: d.power, toughness: Math.max(1, d.toughness), flying: d.keywords.flying, reach: d.keywords.reach, trample: d.keywords.trample, unblockable: d.keywords.unblockable, defender: d.keywords.defender, mv: d.mv, count: 3 });
  }
  // Their own goldfish: how much power they put on the board, turn by turn.
  const T = 20;
  const sums = Array.from({ length: T }, () => ({ power: 0, flying: 0, trample: 0 }));
  const opts = { ...DEFAULT_GOLDFISH, games, maxTurns: T, strategy: 'generic', settings: {}, combos: [], comboWins: false };
  for (let g = 0; g < games; g++) {
    const game = playGame(deck, deriveSeed(4242, g), opts);
    for (let t = 0; t < T; t++) {
      const b = game.boardByTurn[Math.min(t, game.boardByTurn.length - 1)] ?? { power: 0, flying: 0, trample: 0 };
      sums[t].power += b.power;
      sums[t].flying += b.flying;
      sums[t].trample += b.trample;
    }
  }
  const powerCurve = sums.map((x) => x.power / games);
  const totalP = sums.reduce((a, x) => a + x.power, 0) || 1;
  return {
    id,
    name,
    commander: list.commanders.join(' + '),
    colors: deck.identity.join(''),
    wipes, removal, counters, aetherize, taxes,
    creatures: [...pool.values()].sort((a, b) => a.mv - b.mv),
    powerCurve,
    flyingShare: sums.reduce((a, x) => a + x.flying, 0) / totalP,
    trampleShare: sums.reduce((a, x) => a + x.trample, 0) / totalP,
    extraDraw: Math.min(1.5, draw),
    aggression: 0.7,
    priority: 'threat',
    interactionRate: 0.75,
    curveScale: 1,
    wipeAt: 6,
  };
}
