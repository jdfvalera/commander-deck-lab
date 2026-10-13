import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import subset from '../fixtures/spellbook/combos-subset.json';
import expected from '../fixtures/spellbook/vhal-find-my-combos.json';
import { findCombos, groupByMissing, withinIdentity, type ComboDb } from '../src/combos/findCombos';
import { parseDecklist } from '../src/data/parseDecklist';

const db = subset as unknown as ComboDb;
const vhal = parseDecklist(readFileSync('fixtures/decks/vhal.txt', 'utf8'));
const deck = { commanders: vhal.commanders, cards: vhal.cards.map((c) => c.name) };

describe('findCombos', () => {
  const r = findCombos(db, deck, new Set(['U']));

  it("matches Commander Spellbook's own find-my-combos result for the Vhal deck", () => {
    expect([...r.complete, ...r.withRequirements].map((c) => c.id).sort()).toEqual(expected.included);
    expect(r.oneAway.map((c) => c.id).sort()).toEqual(expected.almostIncluded);
  });

  it('finds the Vhal + Staff of Domination loop', () => {
    const staff = r.complete.find((c) => c.cards.includes('Staff of Domination'));
    expect(staff?.cards).toContain('Vhal, Candlekeep Researcher');
    expect(staff?.produces).toContain('Infinite card draw');
    expect(staff?.url).toBe(`https://commanderspellbook.com/combo/${staff?.id}/`);
  });

  it('one-away combos name exactly one missing card', () => {
    for (const c of r.oneAway) expect(c.missing).toHaveLength(1);
    const groups = groupByMissing(r.oneAway);
    expect(groups[0].combos.length).toBeGreaterThanOrEqual(groups[groups.length - 1].combos.length);
  });

  it('respects color identity: no blue combos for a mono-green deck', () => {
    const g = findCombos(db, deck, new Set(['G']));
    expect([...g.complete, ...g.oneAway].every((c) => withinIdentity(c.identity, new Set(['G'])))).toBe(true);
    expect(g.complete.length).toBeLessThan(r.complete.length);
  });

  it('a card that must be the commander does not count from the 99', () => {
    const asNinetyNine = findCombos(db, { commanders: [], cards: [...deck.commanders, ...deck.cards] }, new Set(['U']));
    const needsCmdr = db.combos.filter((c) => c[8].length).map((c) => c[0]);
    expect(asNinetyNine.complete.some((c) => needsCmdr.includes(c.id))).toBe(false);
  });

  it('an empty deck has no complete combos', () => {
    expect(findCombos(db, { commanders: [], cards: [] }, new Set(['U'])).complete).toEqual([]);
  });
});
