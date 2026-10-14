// Run on its own (npm run test:perf), not alongside the other suites: the brief's budget is
// 5,000 goldfish games in under ~10 seconds on a mid-range laptop.
import { expect, it } from 'vitest';
import cardsJson from '../fixtures/scryfall/cards.json';
import current from '../fixtures/decks/pride-current.json';
import { autoTag } from '../src/tags/autoTag';
import { cardKeys, nameKey } from '../src/data/names';
import type { ScryfallCard } from '../src/data/types';
import { compileDeck } from '../src/engine/cards';
import { DEFAULT_GOLDFISH, runGoldfish } from '../src/engine/goldfish';

const byKey = new Map<string, ScryfallCard>();
for (const c of cardsJson as ScryfallCard[]) for (const k of cardKeys(c)) byKey.set(k, c);
const lookup = (n: string) => byKey.get(nameKey(n));
const pride = compileDeck(current, lookup, (n) => (lookup(n) ? autoTag(lookup(n)!) : undefined));

it('5,000 Pride goldfish games run in under 10 seconds', () => {
  const t = performance.now();
  runGoldfish(pride, { ...DEFAULT_GOLDFISH, games: 5000, strategy: 'pride', settings: {} });
  const ms = performance.now() - t;
  console.log(`5,000 games: ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(10000);
}, 30000);
