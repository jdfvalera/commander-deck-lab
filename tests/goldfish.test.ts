import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import cardsJson from '../fixtures/scryfall/cards.json';
import wideJson from '../fixtures/scryfall/decks-wide.json';
import corpusJson from '../fixtures/scryfall/corpus.json';
import current from '../fixtures/decks/pride-current.json';
import revised from '../fixtures/decks/pride-revised.json';
import { autoTag } from '../src/tags/autoTag';
import { cardKeys, nameKey } from '../src/data/names';
import type { DeckList, ScryfallCard } from '../src/data/types';
import { compileDeck, type CompiledDeck } from '../src/engine/cards';
import { Game } from '../src/engine/game';
import { DEFAULT_GOLDFISH, alignedOrder, playGame, runGoldfish } from '../src/engine/goldfish';
import { prideStrategy, triumphPlan, prideAbilityCost } from '../src/engine/strategies/prideOfHullClade';
import { defaults } from '../src/engine/strategies/types';
import { formatCost } from '../src/engine/manaCost';
import { guessCommanders } from '../src/data/validateDeck';
import { parseDecklist } from '../src/data/parseDecklist';
import comboSubset from '../fixtures/spellbook/combos-subset.json';
import { findCombos, type ComboDb } from '../src/combos/findCombos';

const byKey = new Map<string, ScryfallCard>();
for (const c of [...(corpusJson as ScryfallCard[]), ...(wideJson as ScryfallCard[]), ...(cardsJson as ScryfallCard[])]) for (const k of cardKeys(c)) byKey.set(k, c);
const lookup = (n: string) => byKey.get(nameKey(n));
const tagsFor = (n: string) => (lookup(n) ? autoTag(lookup(n)!) : undefined);

const pride = compileDeck(current, lookup, tagsFor);
const prideRev = compileDeck(revised, lookup, tagsFor);
const settings = { maxTurns: 20, drawOnTurnOne: true, combos: [], comboWins: true, log: false };
const idx = (deck: CompiledDeck, name: string) => deck.defs.findIndex((d) => d.name === name);

/** An empty-handed game with chosen permanents already in play (not summoning sick). */
function board(deck: CompiledDeck, names: string[], opts: { hand?: string[]; library?: number } = {}) {
  const g = new Game(deck, 1, settings);
  g.hand = [];
  g.turn = 5;
  for (const n of names) {
    const i = idx(deck, n);
    if (i < 0) throw new Error(`${n} not in deck`);
    const p = g.enter(i, { commander: deck.commanders.includes(i), tapped: false });
    p.sick = false;
  }
  for (const n of opts.hand ?? []) g.hand.push(idx(deck, n));
  if (opts.library !== undefined) g.lib = g.lib.slice(0, opts.library);
  return g;
}

describe('The Pride of Hull Clade costs X less, X = total toughness', () => {
  const p = idx(pride, 'The Pride of Hull Clade');
  it('{10}{G} minus the toughness on board, never below {G}', () => {
    expect(formatCost(board(pride, []).castCost(p, true))).toBe('{10}{G}');
    expect(formatCost(board(pride, ['Wall of Junk']).castCost(p, true))).toBe('{3}{G}'); // 0/7
    expect(formatCost(board(pride, ['Wall of Junk', 'Hover Barrier']).castCost(p, true))).toBe('{G}'); // 7 + 6
  });
  it('commander tax adds {2} per earlier cast', () => {
    const g = board(pride, ['Wall of Junk', 'Hover Barrier']);
    g.casts.set(p, 1);
    expect(formatCost(g.castCost(p, true))).toBe('{2}{G}');
  });
});

describe("the Pride's ability", () => {
  it('{2}{U}{U}, reduced to {U}{U} by Training Grounds and floored at one mana', () => {
    expect(formatCost(prideAbilityCost(board(pride, ['The Pride of Hull Clade']))!)).toBe('{2}{U}{U}');
    expect(formatCost(prideAbilityCost(board(pride, ['The Pride of Hull Clade', 'Training Grounds']))!)).toBe('{U}{U}');
  });

  it('can target hexproof creatures but not shroud (Lightning Greaves blocks your own targeting)', () => {
    const g = board(pride, ['The Pride of Hull Clade', 'Angler Turtle', 'Hover Barrier', 'Lightning Greaves', ...Array(8).fill('Island')]);
    const barrier = g.bf.find((x) => g.name(x) === 'Hover Barrier')!;
    g.bf.find((x) => g.name(x) === 'Lightning Greaves')!.attachedTo = barrier.id;
    expect(g.shroud(barrier)).toBe(true);
    prideStrategy.main1(g, { ...defaults(prideStrategy.settings), greavesOnCommander: false, wallsAttack: false });
    const angler = g.bf.find((x) => g.name(x) === 'Angler Turtle')!;
    expect(g.def(angler.def).keywords.hexproof).toBe(true);
    expect(angler.eot.drawOnHit).toBe(true); // hexproof: still a legal target for your own ability
    expect(barrier.eot.drawOnHit).toBe(false); // shroud: not
    // Eight Islands pay for two activations; the second went to another creature, never the shrouded Barrier.
    expect(g.bf.filter((x) => x.eot.drawOnHit).length).toBe(2);
  });

  it('draws cards equal to toughness on combat damage, and respects the library buffer', () => {
    const g = board(pride, ['The Pride of Hull Clade', 'Wall of Junk', 'Island', 'Island', 'Island', 'Island']);
    const before = g.hand.length;
    prideStrategy.main1(g, { ...defaults(prideStrategy.settings), wallsAttack: false });
    prideStrategy.combat(g, defaults(prideStrategy.settings));
    expect(g.hand.length - before).toBe(7);
    const tight = board(pride, ['The Pride of Hull Clade', 'Wall of Junk', 'Island', 'Island', 'Island', 'Island'], { library: 25 });
    prideStrategy.main1(tight, { ...defaults(prideStrategy.settings), wallsAttack: false, minLibrary: 20 });
    expect(tight.bf.some((x) => x.eot.drawOnHit)).toBe(false); // 25 - 7 < 20
  });
});

describe('drawing', () => {
  it('decking: drawing from an empty library ends the game', () => {
    const g = board(pride, [], { library: 1 });
    g.draw(1, 'test');
    expect(g.decked).toBe(false);
    g.draw(1, 'test');
    expect(g.decked).toBe(true);
    expect(g.over()).toBe(true);
  });
  it("Alhammarret's Archive doubles every draw except the draw step's first", () => {
    const g = board(prideRev, ["Alhammarret's Archive"]);
    g.draw(1, 'effect');
    expect(g.hand.length).toBe(2);
    g.draw(1, 'draw step', true);
    expect(g.hand.length).toBe(3);
  });
  it('Psychosis Crawler: each opponent loses 1 life per card drawn', () => {
    const g = board(pride, ['Psychosis Crawler']);
    g.draw(3, 'test');
    expect(g.opps.map((o) => o.life)).toEqual([37, 37, 37]);
  });
});

describe('Triumph of the Hordes lethal math (10 poison each, nobody blocks)', () => {
  const triumphHand = { hand: ['Triumph of the Hordes'] };
  const s = defaults(prideStrategy.settings);
  const withTokens = (g: Game, n: number, p: number, t: number) => {
    for (let i = 0; i < n; i++) g.makeToken(p, t, false, 'test').sick = false;
    return g;
  };
  it('three 9/9s + Triumph (+1/+1) = 10 poison each: lethal', () => {
    const g = withTokens(board(pride, ['Forest', 'Forest', 'Forest', 'Forest'], triumphHand), 3, 9, 9);
    expect(triumphPlan(g, s)).not.toBeNull();
  });
  it('three 8/8s: one short, no plan', () => {
    const g = withTokens(board(pride, ['Forest', 'Forest', 'Forest', 'Forest'], triumphHand), 3, 8, 8);
    expect(triumphPlan(g, s)).toBeNull();
  });
  it('without enough mana for Triumph, no plan', () => {
    const g = withTokens(board(pride, ['Forest', 'Forest', 'Forest'], triumphHand), 3, 20, 20);
    expect(triumphPlan(g, s)).toBeNull();
  });
  it('damage = toughness (Assault Formation) plus Tower Defense makes walls lethal', () => {
    const g = withTokens(board(prideRev, ['Assault Formation', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'], { hand: ['Triumph of the Hordes', 'Tower Defense'] }), 3, 0, 4);
    // 0/4 tokens: with Triumph +1/+1 and Tower +0/+5, each assigns 10 toughness as poison.
    expect(triumphPlan(g, s)).not.toBeNull();
    expect(triumphPlan(g, { ...s, useTowerDefense: false })).toBeNull();
  });
  it('the win turn executes: poison counters and a win', () => {
    const g = withTokens(board(pride, ['Forest', 'Forest', 'Forest', 'Forest'], triumphHand), 3, 9, 9);
    prideStrategy.main1(g, s);
    expect(g.winType).toBe('poison');
    expect(g.opps.every((o) => o.poison >= 10)).toBe(true);
  });
});

describe('goldfish runs', () => {
  const opts = { ...DEFAULT_GOLDFISH, games: 300, strategy: 'pride', settings: {} };

  it('golden: a fixed seed gives exactly the same summary', () => {
    const a = runGoldfish(pride, opts);
    const b = runGoldfish(pride, opts);
    expect(b).toEqual(a);
    expect({ median: a.medianWin, by10: a.winByTurn.total[9], pride4: a.commander.byTurn[3], decked: a.failures.decked }).toMatchSnapshot();
  });

  it('5,000 Pride games run well under 10 seconds', () => {
    const t = performance.now();
    runGoldfish(pride, { ...opts, games: 5000 });
    expect(performance.now() - t).toBeLessThan(10000);
  }, 30000);

  it('version compare lines up the libraries: shared cards keep their slots', () => {
    const order = alignedOrder(pride, prideRev);
    expect(order).toHaveLength(99);
    let same = 0;
    pride.library.forEach((a, i) => (pride.defs[a].name === prideRev.defs[order[i]].name ? same++ : 0));
    expect(same).toBe(99 - 16);
  });

  it('the Pride plan wins by poison most of the time and rarely decks', () => {
    const s = runGoldfish(pride, opts);
    expect(s.winShare.poison).toBeGreaterThan(0.5);
    expect(s.failures.decked).toBeLessThan(0.05);
    expect(s.commander.byTurn[3]).toBeGreaterThan(0.6); // cast by turn 4 most games
  });

  it('the generic strategy runs every deck on the bench without errors', () => {
    const decks = ['fixtures/decks/precons', 'fixtures/decks/user'].flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${d}/${f}`, 'utf8')) as DeckList));
    const vhal = guessCommanders(parseDecklist(readFileSync('fixtures/decks/vhal.txt', 'utf8')), lookup).list;
    let wins = 0;
    for (const d of [...decks, vhal]) {
      const deck = compileDeck(d, lookup, tagsFor);
      const r = runGoldfish(deck, { ...opts, games: 20, strategy: 'generic' });
      wins += r.winByTurn.total[19];
      expect(r.games).toBe(20);
    }
    expect(wins / (decks.length + 1)).toBeGreaterThan(0.3);
  }, 60000);

  it('Vhal: Spellbook combos are assembled and count as wins', () => {
    const vhalList = guessCommanders(parseDecklist(readFileSync('fixtures/decks/vhal.txt', 'utf8')), lookup).list;
    const deck = compileDeck(vhalList, lookup, tagsFor);
    const report = findCombos(comboSubset as unknown as ComboDb, { commanders: vhalList.commanders, cards: vhalList.cards.map((c) => c.name) }, new Set(['U']));
    const combos = report.complete.filter((c) => c.produces.some((p) => /infinite|win the game/i.test(p))).map((c) => ({ cards: c.cards, manaNeeded: c.manaValueNeeded, label: c.cards.join(' + ') }));
    expect(combos.length).toBeGreaterThan(10);
    const r = runGoldfish(deck, { ...opts, games: 300, strategy: 'generic', combos, comboWins: true });
    expect(r.winShare.combo).toBeGreaterThan(0.3);
    expect(r.combo.top[0].label).toContain('Vhal');
    const off = runGoldfish(deck, { ...opts, games: 300, strategy: 'generic', combos: [], comboWins: false });
    expect(off.winShare.combo).toBe(0);
  }, 60000);

  it('sample game logs every turn', () => {
    const g = playGame(pride, 12345, opts, true);
    expect(g.logs.length).toBe(g.turn);
    expect(g.logs[0].hand.length).toBeGreaterThan(0);
  });
});
