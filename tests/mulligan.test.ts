import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import corpus from '../fixtures/scryfall/corpus.json';
import cardsJson from '../fixtures/scryfall/cards.json';
import current from '../fixtures/decks/pride-current.json';
import { autoTag } from '../src/tags/autoTag';
import { cardKeys, nameKey } from '../src/data/names';
import { parseDecklist } from '../src/data/parseDecklist';
import { guessCommanders } from '../src/data/validateDeck';
import type { ScryfallCard } from '../src/data/types';
import { buildDeckModel, type ModelCard } from '../src/engine/deckModel';
import { DEFAULT_RULES, chooseBottom, handOk, simulateHand, summarizeMulligans } from '../src/engine/mulligan';
import { colorReports } from '../src/engine/colorReqs';

const byKey = new Map<string, ScryfallCard>();
for (const c of [...(corpus as ScryfallCard[]), ...(cardsJson as ScryfallCard[])]) for (const k of cardKeys(c)) byKey.set(k, c);
const lookup = (n: string) => byKey.get(nameKey(n));
const tagsFor = (n: string) => (lookup(n) ? autoTag(lookup(n)!) : undefined);

// The Vhal paste has no "Commander" heading: the page guesses the first two cards, as here.
const vhalList = guessCommanders(parseDecklist(readFileSync('fixtures/decks/vhal.txt', 'utf8')), lookup).list;
const vhal = buildDeckModel(vhalList, lookup, tagsFor);
const pride = buildDeckModel(current, lookup, tagsFor);

const land = (name = 'Island'): ModelCard => ({ ...vhal.library.find((c) => c.name === 'Island')!, name });
const spell = (mv: number): ModelCard => ({ ...vhal.library.find((c) => !c.isLand)!, name: `Spell ${mv}`, mv, isLand: false });

describe('deck model', () => {
  it('builds the 99/98 library and identity', () => {
    expect(pride.librarySize).toBe(99);
    expect(pride.identity).toEqual(['U', 'G']);
    expect(vhal.librarySize).toBe(98);
  });

  it("finds the Pride's {2}{U}{U} ability and Training Grounds' reduction to {U}{U}", () => {
    const a = pride.commanderAbilities.find((x) => x.label.includes('{2}{U}{U}'));
    expect(a?.cost.pips.U).toBe(2);
    expect(a?.reducedCost?.generic).toBe(0);
    expect(pride.commanders[0].boardDependentCost).toBe(true);
  });

  it('roles and sources', () => {
    const sol = pride.library.find((c) => c.name === 'Sol Ring')!;
    expect(sol).toMatchObject({ role: 'ramp', sourceKind: 'rock', rampAmount: 2 });
    expect(pride.library.find((c) => c.name === 'Fabled Passage')!.produces.sort()).toEqual(['G', 'U']);
    expect(pride.library.find((c) => c.name === 'Counterspell')!.role).toBe('interaction');
  });
});

describe('keep rules and London bottoming', () => {
  it('2–5 lands and an early play', () => {
    expect(handOk([land(), land(), spell(2), spell(5), spell(6), spell(4), spell(3)], DEFAULT_RULES)).toBe(true);
    expect(handOk([land(), spell(2), spell(5), spell(6), spell(4), spell(3), spell(3)], DEFAULT_RULES)).toBe(false);
    expect(handOk([land(), land(), land(), spell(5), spell(6), spell(4), spell(3)], DEFAULT_RULES)).toBe(false);
  });

  it('bottoms excess lands or the most expensive spells', () => {
    const flood = [land('A'), land('B'), land('C'), land('D'), land('E'), land('F'), spell(2)];
    expect(chooseBottom(flood, 2, DEFAULT_RULES).bottom.every((c) => c.isLand)).toBe(true);
    const top = [land(), land(), land(), spell(2), spell(7), spell(6), spell(3)];
    expect(chooseBottom(top, 1, DEFAULT_RULES).bottom.map((c) => c.mv)).toEqual([7]);
  });

  it('free first mulligan: the second 7 keeps 7 cards; the next keeps 6', () => {
    for (let s = 0; s < 400; s++) {
      const r = simulateHand(vhal, s, DEFAULT_RULES, { turns: 8, drawOnTurnOne: true });
      const expectSize = 7 - Math.max(0, r.mulligans - 1);
      expect(r.kept.length).toBe(expectSize);
      expect(r.bottomed.length).toBe(7 - expectSize);
    }
  });

  it('is deterministic per seed', () => {
    const a = simulateHand(vhal, 99, DEFAULT_RULES, { turns: 8, drawOnTurnOne: true });
    const b = simulateHand(vhal, 99, DEFAULT_RULES, { turns: 8, drawOnTurnOne: true });
    expect(b.kept.map((c) => c.name)).toEqual(a.kept.map((c) => c.name));
    expect(b.commanderTurn).toBe(a.commanderTurn);
  });
});

describe('mulligan summary', () => {
  const sum = summarizeMulligans(vhal, 1, 2000, DEFAULT_RULES, { turns: 8, drawOnTurnOne: true });

  it('prints the numbers', () => {
    if (process.env.SHOW) console.log(JSON.stringify({ keepFirst: sum.keepFirst, dist: sum.mulliganDist, kept: sum.avgCardsKept, lands: sum.avgLandsKept, cmd: sum.commander, base: sum.baseline }));
  });

  it('reports a plausible keep rate and commander timing for Vhal ({3}{U})', () => {
    expect(sum.mulliganDist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(sum.keepFirst).toBeGreaterThan(0.6);
    expect(sum.commander?.name).toBe('Vhal, Candlekeep Researcher');
    // 35 Islands plus rocks: a 4-drop commander should usually be castable by turn 4.
    expect(sum.commander!.byTurn[3]).toBeGreaterThan(0.6);
    expect(sum.commander!.byTurn[7]).toBeGreaterThanOrEqual(sum.commander!.byTurn[3]);
  });

  it('mulligans help commander timing on the same seeds', () => {
    expect(sum.commander!.byTurn[3]).toBeGreaterThanOrEqual(sum.baseline!.byTurn[3]);
  });

  it('golden: same seed gives the same summary', () => {
    const again = summarizeMulligans(vhal, 1, 2000, DEFAULT_RULES, { turns: 8, drawOnTurnOne: true });
    expect(again).toEqual(sum);
  });

  it("the Pride's board-dependent cost is left to the goldfish", () => {
    expect(summarizeMulligans(pride, 1, 50, DEFAULT_RULES, { turns: 8, drawOnTurnOne: true }).commander).toBeNull();
  });
});

describe('color requirements (Karsten method)', () => {
  const reps = colorReports(pride);
  it('one report per identity color', () => expect(reps.map((r) => r.color)).toEqual(['U', 'G']));
  it("blue's strictest requirement includes the Pride's UU ability", () => {
    const u = reps.find((r) => r.color === 'U')!;
    expect(u.requirements.some((r) => r.kind === 'ability' && r.pips === 2)).toBe(true);
    expect(u.weighted).toBeGreaterThan(20);
  });
  it('dorks are weighted lower than lands', () => {
    const g = reps.find((r) => r.color === 'G')!;
    expect(g.weighted).toBeLessThan(g.sources.land + g.sources.rock + g.sources.dork + g.sources.aura);
  });
});
