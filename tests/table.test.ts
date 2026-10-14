import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import wideJson from '../fixtures/scryfall/decks-wide.json';
import cardsJson from '../fixtures/scryfall/cards.json';
import revised from '../fixtures/decks/pride-revised.json';
import { autoTag } from '../src/tags/autoTag';
import { cardKeys, nameKey } from '../src/data/names';
import type { DeckList, ScryfallCard } from '../src/data/types';
import { compileDeck, type CompiledDeck } from '../src/engine/cards';
import { buildProfile, type OpponentProfile } from '../src/opponents/profile';
import { DEFAULT_TABLE, TableGame, runTable } from '../src/engine/table';
import type { OppCreature } from '../src/engine/game';

const byKey = new Map<string, ScryfallCard>();
for (const c of [...(wideJson as ScryfallCard[]), ...(cardsJson as ScryfallCard[])]) for (const k of cardKeys(c)) byKey.set(k, c);
const lookup = (n: string) => byKey.get(nameKey(n));
const tagsFor = (n: string) => (lookup(n) ? autoTag(lookup(n)!) : undefined);
const precon = (f: string) => {
  const d = JSON.parse(readFileSync(`fixtures/decks/precons/${f}.json`, 'utf8')) as DeckList & { name: string };
  return buildProfile(f, d.name, d, lookup, tagsFor);
};
const rex = precon('tramplesaurusrex-fdc');
const angels = precon('callingallangels-fdc');
const keen = precon('keenengineering-fdc');
const dragons = precon('reignofdragons-fdc');
const pride = compileDeck(revised, lookup, tagsFor);
const opts = { ...DEFAULT_TABLE, strategy: 'pride', settings: {} };
const settings = { maxTurns: 20, drawOnTurnOne: true, combos: [], comboWins: true, log: true };
const idx = (deck: CompiledDeck, name: string) => deck.defs.findIndex((d) => d.name === name);

function table(profiles: OpponentProfile[], mine: string[], hand: string[] = []) {
  const g = new TableGame(pride, 1, settings, profiles);
  g.hand = hand.map((n) => idx(pride, n));
  g.turn = 6;
  for (const n of mine) {
    const i = idx(pride, n);
    const p = g.enter(i, { commander: pride.commanders.includes(i), tapped: false });
    p.sick = false;
    if (p.commander) g.commandZone.splice(g.commandZone.indexOf(i), 1);
  }
  return g;
}
const opp = (o: Partial<OppCreature>): OppCreature => ({ name: 'Test', power: 3, toughness: 3, flying: false, reach: false, trample: false, unblockable: false, defender: false, tapped: false, sick: false, ...o });

describe('opponent profiles come from the decklists', () => {
  it('Foundations interaction suites', () => {
    expect(angels.wipes.map((w) => w.name).sort()).toEqual(['Austere Command', 'Cleansing Nova', 'Day of Judgment']);
    expect(keen.counters.map((c) => c.name)).toEqual(expect.arrayContaining(['Counterspell', 'Negate']));
    expect(keen.aetherize.map((c) => c.name)).toEqual(['Aetherize']);
    expect(keen.taxes.map((c) => c.name)).toEqual(['Propaganda']);
    expect(keen.wipes.map((w) => w.name).sort()).toEqual(["All Is Dust", "Nevinyrral's Disk"]);
    expect(rex.wipes.map((w) => w.name)).toEqual(["Ezuri's Predation"]);
    expect(dragons.wipes.find((w) => w.name === 'Blasphemous Act')?.x).toBe(13);
  });
  it('fliers and tramplers show up in the board curve', () => {
    expect(angels.flyingShare).toBeGreaterThan(0.8);
    expect(dragons.flyingShare).toBeGreaterThan(0.7);
    expect(rex.flyingShare).toBe(0);
    expect(rex.trampleShare).toBeGreaterThan(0.25);
    expect(rex.powerCurve[7]).toBeGreaterThan(rex.powerCurve[3]);
  });
});

describe('blocking rules', () => {
  it('fliers can only be blocked by flying or reach; unblockable by nothing', () => {
    const g = table([rex, rex, rex], ['Hover Barrier', 'Wall of Junk', 'Elusive Krasis']);
    const barrier = g.bf.find((p) => g.name(p) === 'Hover Barrier')!;
    const junk = g.bf.find((p) => g.name(p) === 'Wall of Junk')!;
    const krasis = g.bf.find((p) => g.name(p) === 'Elusive Krasis')!;
    expect(g.canBlock(barrier, opp({}))).toBe(false); // flying attacker vs ground blocker
    expect(g.canBlock(barrier, opp({ flying: true }))).toBe(true);
    expect(g.canBlock(barrier, opp({ reach: true }))).toBe(true);
    expect(g.canBlock(junk, opp({}))).toBe(true);
    expect(g.canBlock(krasis, opp({ flying: true }))).toBe(false);
    expect(g.canBlock(junk, opp({ tapped: true }))).toBe(false);
  });
});

describe('your protection is spent on the right threat', () => {
  const st = (g: TableGame) => g.os[0];
  it('Counterspell stops a board wipe', () => {
    const g = table([angels, angels, angels], ['Wall of Junk', 'Hover Barrier', 'Island', 'Island'], ['Counterspell']);
    (g as unknown as { resolveWipe: (s: unknown, w: unknown) => void }).resolveWipe(st(g), angels.wipes[0]);
    expect(g.bf.some((p) => g.name(p) === 'Wall of Junk')).toBe(true);
    expect(g.stats.protectionUsed.Counterspell).toBe(1);
  });
  it('Heroic Intervention saves the board from a destroy wipe', () => {
    const g = table([angels, angels, angels], ['Wall of Junk', 'Hover Barrier', 'Forest', 'Forest'], ['Heroic Intervention']);
    (g as unknown as { resolveWipe: (s: unknown, w: unknown) => void }).resolveWipe(st(g), angels.wipes[0]);
    expect(g.creatures().length).toBe(2);
  });
  it('without protection, a wipe kills creatures and sends the commander home', () => {
    const g = table([angels, angels, angels], ['The Pride of Hull Clade', 'Wall of Junk']);
    (g as unknown as { resolveWipe: (s: unknown, w: unknown) => void }).resolveWipe(st(g), angels.wipes[0]);
    expect(g.creatures().length).toBe(0);
    expect(g.commandZone.length).toBe(1);
    expect(g.stats.commanderRemoved).toBe(1);
  });
  it('Lightning Greaves (shroud) keeps the commander from being targeted', () => {
    const g = table([angels, angels, angels], ['The Pride of Hull Clade', 'Lightning Greaves', 'Wall of Junk']);
    const pr = g.bf.find((p) => p.commander)!;
    g.bf.find((p) => g.name(p) === 'Lightning Greaves')!.attachedTo = pr.id;
    st(g).hand = [{ k: 'removal', spec: { name: 'Swords to Plowshares', kind: 'exile', scope: 'creature' } }] as never;
    st(g).rng = () => 0;
    (g as unknown as { maybeRemove: (s: unknown) => void }).maybeRemove(st(g));
    expect(g.bf.includes(pr)).toBe(true);
  });
  it('Veil of Summer stops Triumph being countered; without it Keen counters', () => {
    const g = table([keen, keen, keen], ['Forest', 'Forest', 'Forest', 'Forest']);
    g.hand = [idx(pride, 'Triumph of the Hordes')];
    for (const s of g.os) {
      s.hand = [{ k: 'counter', spec: { name: 'Counterspell', kind: 'counter', scope: 'any' } }] as never;
      s.rng = () => 0;
    }
    g.cast(idx(pride, 'Triumph of the Hordes'));
    expect(g.stats.triumphCountered).toBe(1);
    const v = table([keen, keen, keen], ['Forest', 'Forest', 'Forest', 'Forest']);
    v.hand = [idx(pride, 'Triumph of the Hordes')];
    for (const s of v.os) {
      s.hand = [{ k: 'counter', spec: { name: 'Counterspell', kind: 'counter', scope: 'any' } }] as never;
      s.rng = () => 0;
    }
    v.uncounterableTurn = v.turn;
    v.cast(idx(pride, 'Triumph of the Hordes'));
    expect(v.stats.triumphCountered).toBe(0);
    expect(v.team.infect).toBe(true);
  });
});

describe('matchup runs', () => {
  const n = { ...opts, games: 200 };
  const vsRex = runTable(pride, [rex, rex, rex], n);
  const vsAngels = runTable(pride, [angels, angels, angels], n);
  const vsDragons = runTable(pride, [dragons, dragons, dragons], n);

  it('golden: a fixed seed gives exactly the same summary', () => {
    expect(runTable(pride, [rex, rex, rex], n)).toEqual(vsRex);
  });
  it('fliers are the Pride deck’s main weakness', () => {
    expect(vsRex.winRate).toBeGreaterThan(vsAngels.winRate + 0.3);
    expect(vsRex.winRate).toBeGreaterThan(vsDragons.winRate + 0.2);
    expect(vsAngels.losses.fliers).toBeGreaterThan(0.6);
    expect(vsRex.losses.fliers).toBe(0);
  });
  it('protection actually gets used against interactive decks', () => {
    const vsKeen = runTable(pride, [keen, keen, keen], n);
    expect(vsKeen.protectionUsed.length).toBeGreaterThan(0);
    expect(vsKeen.perGame.spellsCountered).toBeGreaterThan(0);
  });
  it('1,000 games against a pod run in a few seconds', () => {
    const t = performance.now();
    runTable(pride, [rex, angels, keen], { ...opts, games: 1000 });
    expect(performance.now() - t).toBeLessThan(15000);
  }, 30000);
});

describe('Mistford River Turtle', () => {
  it('attacks alongside a Pride target to make it unblockable', async () => {
    const { makeUnblockable } = await import('../src/engine/strategies/common');
    const cur = compileDeck((await import('../fixtures/decks/pride-current.json')).default, lookup, tagsFor);
    const g = new TableGame(cur, 1, settings, [rex, rex, rex]);
    g.hand = [];
    g.turn = 5;
    const enter = (n: string) => {
      const p = g.enter(cur.defs.findIndex((d) => d.name === n), { tapped: false });
      p.sick = false;
      return p;
    };
    const turtle = enter('Mistford River Turtle');
    const wall = enter('Wall of Junk');
    g.os[0].o.creatures.push({ name: 'Blocker', power: 2, toughness: 2, flying: false, reach: false, trample: false, unblockable: false, defender: false, tapped: false, sick: false });
    expect(g.connects(wall, g.os[0].o)).toBe(false);
    expect(makeUnblockable(g, wall)).toBe(true);
    expect(wall.eot.unblockable).toBe(true);
    expect(turtle.attackTarget).toBeTruthy();
    expect(g.connects(wall, g.os[0].o)).toBe(true);
  });
});

describe('opponent lifelink, tricks and protection', () => {
  it('Angels have lifelink creatures and the profile carries them', () => {
    expect(angels.creatures.some((c) => c.lifelink)).toBe(true);
  });
  it('a lifelink attacker that gets through gains its controller life', () => {
    const g = table([angels, angels, angels], []);
    const st = g.os[0];
    const before = st.o.life;
    (g as unknown as { defend: (s: unknown, a: OppCreature[]) => void }).defend(st, [opp({ power: 4, lifelink: true, flying: true })]);
    expect(g.myLife).toBe(36);
    expect(st.o.life).toBe(before + 4);
  });
  it('a combat trick lets their attacker beat your wall', () => {
    const g = table([rex, rex, rex], ['Hover Barrier']);
    const st = g.os[0];
    st.hand = [{ k: 'trick', spec: { name: 'Giant Growth', kind: 'trick', x: 3, per: 3 } }] as never;
    st.rng = () => 0;
    (g as unknown as { defend: (s: unknown, a: OppCreature[]) => void }).defend(st, [opp({ power: 4, toughness: 4, flying: true })]);
    expect(g.bf.some((p) => g.name(p) === 'Hover Barrier')).toBe(false); // 7 damage kills the 0/6
  });
});

describe('seat and combo interaction', () => {
  it('sitting last against fliers is worse than going first (they swing before you each round)', () => {
    const first = runTable(pride, [dragons, dragons, dragons], { ...opts, games: 200, seat: 1 });
    const last = runTable(pride, [dragons, dragons, dragons], { ...opts, games: 200, seat: 4 });
    expect(last.winRate).toBeLessThanOrEqual(first.winRate + 0.02);
  });
  it('opponents with removal answer assembled combos (Vhal vs Wretched Ranks)', async () => {
    const corpus = (await import('../fixtures/scryfall/corpus.json')).default as ScryfallCard[];
    for (const c of corpus) for (const k of cardKeys(c)) if (!byKey.has(k)) byKey.set(k, c);
    const { parseDecklist } = await import('../src/data/parseDecklist');
    const { guessCommanders } = await import('../src/data/validateDeck');
    const { findCombos } = await import('../src/combos/findCombos');
    const subset = (await import('../fixtures/spellbook/combos-subset.json')).default;
    const list = guessCommanders(parseDecklist(readFileSync('fixtures/decks/vhal.txt', 'utf8')), lookup).list;
    const vhal = compileDeck(list, lookup, tagsFor);
    const combos = findCombos(subset as never, { commanders: list.commanders, cards: list.cards.map((c) => c.name) }, new Set(['U']))
      .complete.filter((c) => c.produces.some((p) => /infinite/i.test(p)))
      .map((c) => ({ cards: c.cards, manaNeeded: c.manaValueNeeded, label: c.cards.join(' + ') }));
    const ranks = precon('wretchedranks-fdc');
    const r = runTable(vhal, [ranks, ranks, ranks], { ...DEFAULT_TABLE, games: 200, strategy: 'generic', settings: {}, combos });
    expect(r.perGame.combosDisrupted).toBeGreaterThan(0);
    expect(r.winTypes.combo ?? 0).toBeGreaterThan(0);
  }, 60000);
});
