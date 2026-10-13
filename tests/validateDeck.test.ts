import { describe, expect, it } from 'vitest';
import cardsJson from '../fixtures/scryfall/cards.json';
import current from '../fixtures/decks/pride-current.json';
import revised from '../fixtures/decks/pride-revised.json';
import { validateDeck } from '../src/data/validateDeck';
import { cardKeys } from '../src/data/names';
import type { DeckList, ScryfallCard } from '../src/data/types';

const cards = new Map<string, ScryfallCard>();
for (const c of cardsJson as ScryfallCard[]) for (const k of cardKeys(c)) cards.set(k, c);

const errors = (list: DeckList) => validateDeck(list, cards).filter((i) => i.level === 'error');

describe('validateDeck', () => {
  it('both Pride lists are legal 100-card decks', () => {
    expect(validateDeck(current, cards)).toEqual([]);
    expect(validateDeck(revised, cards)).toEqual([]);
  });

  it('flags the wrong card count', () => {
    const list = { ...current, cards: current.cards.filter((c) => c.name !== 'Sol Ring') };
    expect(errors(list)[0].message).toMatch(/99 cards/);
  });

  it('flags duplicates of non-basics but not basics', () => {
    const list = {
      ...current,
      cards: current.cards.map((c) => (c.name === 'Sol Ring' ? { ...c, qty: 2 } : c)).filter((c) => c.name !== 'Counterspell'),
    };
    const e = errors(list);
    expect(e).toHaveLength(1);
    expect(e[0].cards).toEqual(['Sol Ring']);
  });

  it('flags cards outside the color identity', () => {
    // Swap in a commander that is mono-green: every blue card becomes illegal.
    const greenOnly: ScryfallCard = {
      name: 'Test Elf', layout: 'normal', cmc: 1, type_line: 'Legendary Creature — Elf', color_identity: ['G'], keywords: [],
    };
    const m = new Map(cards);
    m.set('test elf', greenOnly);
    const issues = validateDeck({ ...current, commanders: ['Test Elf'] }, m);
    const off = issues.find((i) => /color identity/.test(i.message));
    expect(off?.cards).toContain('Counterspell');
    expect(off?.cards).not.toContain('Sol Ring');
  });

  it('reports unknown cards and a missing commander', () => {
    const e = errors({ commanders: [], cards: [{ name: 'Not A Real Card', qty: 1 }] });
    expect(e.map((x) => x.message).join(' ')).toMatch(/No commander/);
    expect(e.find((x) => /not found/.test(x.message))?.cards).toEqual(['Not A Real Card']);
  });

  it('rejects a non-legendary commander', () => {
    expect(errors({ ...current, commanders: ['Aegis Turtle'] }).some((e) => /can't be a commander/.test(e.message))).toBe(true);
  });
});
