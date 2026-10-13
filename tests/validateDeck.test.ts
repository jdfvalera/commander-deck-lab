import { describe, expect, it } from 'vitest';
import cardsJson from '../fixtures/scryfall/cards.json';
import current from '../fixtures/decks/pride-current.json';
import revised from '../fixtures/decks/pride-revised.json';
import pairingJson from '../fixtures/scryfall/pairing.json';
import wideJson from '../fixtures/scryfall/decks-wide.json';
import { readdirSync, readFileSync } from 'node:fs';
import { parseDecklist } from '../src/data/parseDecklist';
import { guessCommanders, pairing, pairProblem, validateDeck } from '../src/data/validateDeck';
import { cardKeys, nameKey } from '../src/data/names';
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

describe('commander pairs', () => {
  const pairCards = new Map<string, ScryfallCard>();
  for (const c of pairingJson as ScryfallCard[]) pairCards.set(nameKey(c.name), c);
  const get = (n: string) => pairCards.get(nameKey(n))!;
  const deckWith = (commanders: string[]) =>
    validateDeck({ commanders, cards: [{ name: 'Wastes', qty: 98 }] }, new Map([...pairCards, ['wastes', wastes]]));
  const wastes: ScryfallCard = { name: 'Wastes', layout: 'normal', cmc: 0, type_line: 'Basic Land', color_identity: [], keywords: [] };
  const commanderErrors = (commanders: string[]) =>
    deckWith(commanders).filter((i) => i.level === 'error' && !/color identity/.test(i.message)).map((i) => i.message);

  it('Choose a Background + Background is legal, either order', () => {
    expect(commanderErrors(['Clan Crafter', 'Vhal, Candlekeep Researcher'])).toEqual([]);
    expect(commanderErrors(['Vhal, Candlekeep Researcher', 'Clan Crafter'])).toEqual([]);
  });

  it('a Background alone, or with a non-background commander, is not', () => {
    expect(commanderErrors(['Clan Crafter']).join()).toMatch(/Choose a Background/);
    expect(commanderErrors(['Clan Crafter', 'Thrasios, Triton Hero']).join()).toMatch(/Background can only/);
  });

  it('Partner pairs with Partner', () => {
    expect(commanderErrors(['Thrasios, Triton Hero', 'Rograkh, Son of Rohgahh'])).toEqual([]);
  });

  it('Partner with only pairs with the named card', () => {
    expect(commanderErrors(['Pir, Imaginative Rascal', 'Toothy, Imaginary Friend'])).toEqual([]);
    expect(commanderErrors(['Pir, Imaginative Rascal', 'Thrasios, Triton Hero']).join()).toMatch(/only partner with Toothy/);
  });

  it('Partner—group only pairs within the same group', () => {
    expect(commanderErrors(['Atreus, Impulsive Son', 'Kratos, Stoic Father'])).toEqual([]);
    expect(commanderErrors(['Atreus, Impulsive Son', 'Bjorna, Nightfall Alchemist'])).not.toEqual([]);
    expect(commanderErrors(['Atreus, Impulsive Son', 'Thrasios, Triton Hero'])).not.toEqual([]);
  });

  it("Doctor's companion pairs with a Time Lord Doctor", () => {
    expect(commanderErrors(['Clara Oswald', 'The Tenth Doctor'])).toEqual([]);
    expect(commanderErrors(['Clara Oswald', 'Thrasios, Triton Hero'])).not.toEqual([]);
  });

  it('pairing helper reads the abilities from text', () => {
    expect(pairing(get('Vhal, Candlekeep Researcher')).choosesBackground).toBe(true);
    expect(pairing(get('Clan Crafter')).background).toBe(true);
    expect(pairing(get('Pir, Imaginative Rascal'))).toMatchObject({ partner: false, partnerWith: 'Toothy, Imaginary Friend' });
    expect(pairProblem(get('Thrasios, Triton Hero'), get('Rograkh, Son of Rohgahh'))).toBeNull();
  });
});

describe('commanders without a heading (Moxfield/Archidekt text exports)', () => {
  const wideCards = new Map<string, ScryfallCard>();
  for (const c of [...(wideJson as ScryfallCard[]), ...(pairingJson as ScryfallCard[])]) for (const k of cardKeys(c)) wideCards.set(k, c);
  const lookup = (n: string) => wideCards.get(nameKey(n));

  it('uses the first card when it can be a commander, and the deck then validates', () => {
    const parsed = parseDecklist(readFileSync('fixtures/decks/user/tatsunari-moxfield-export.txt', 'utf8'));
    expect(parsed.commanders).toEqual([]);
    const { list, guessed } = guessCommanders(parsed, lookup);
    expect(guessed).toEqual(['Tatsunari, Toad Rider']);
    expect(list.cards.some((c) => c.name === 'Crystal Chimes')).toBe(false); // sideboard skipped
    expect(validateDeck(list, wideCards).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('takes the first two when they are a legal pair', () => {
    const { guessed } = guessCommanders({ commanders: [], cards: [{ name: 'Thrasios, Triton Hero', qty: 1 }, { name: 'Rograkh, Son of Rohgahh', qty: 1 }] }, lookup);
    expect(guessed).toEqual(['Thrasios, Triton Hero', 'Rograkh, Son of Rohgahh']);
  });

  it('does not guess when the first card cannot lead, or a commander is already marked', () => {
    expect(guessCommanders({ commanders: [], cards: [{ name: 'Sol Ring', qty: 1 }] }, lookup).guessed).toEqual([]);
    expect(guessCommanders({ commanders: ['X'], cards: [{ name: 'Thrasios, Triton Hero', qty: 1 }] }, lookup).guessed).toEqual([]);
  });
});

describe('official precons and real decks validate', () => {
  const wideCards = new Map<string, ScryfallCard>();
  for (const c of wideJson as ScryfallCard[]) for (const k of cardKeys(c)) wideCards.set(k, c);
  const decks = ['fixtures/decks/precons', 'fixtures/decks/user'].flatMap((d) =>
    readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${d}/${f}`, 'utf8')) as DeckList & { name: string }),
  );
  it('has the fixture decks', () => expect(decks.length).toBeGreaterThanOrEqual(35));
  for (const d of decks) {
    it(d.name, () => expect(validateDeck(d, wideCards).filter((i) => i.level === 'error')).toEqual([]));
  }
});
