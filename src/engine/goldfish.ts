// Runs goldfish games and summarizes them. Game i always uses deriveSeed(seed, i), and version
// comparisons line up the two libraries so a swapped card sits in the cut card's shuffle slot.

import type { CompiledDeck } from './cards';
import { frontFace, nameKey } from '../data/names';
import { Game, type TurnLog, type WinType } from './game';
import { deriveSeed } from './rng';
import { chooseBottom, handOk, DEFAULT_RULES, type KeepRules } from './mulligan';
import { shuffle } from './rng';
import { genericStrategy } from './strategies/generic';
import { prideStrategy } from './strategies/prideOfHullClade';
import { defaults, type Strategy, type StrategySettings } from './strategies/types';

export const STRATEGIES: Strategy[] = [genericStrategy, prideStrategy];
export const WIN_TYPES: WinType[] = ['combat', 'poison', 'pings', 'combo'];

export interface GoldfishOptions {
  games: number;
  maxTurns: number;
  seed: number;
  drawOnTurnOne: boolean;
  strategy: string;
  settings: StrategySettings;
  rules: KeepRules;
  combos: { cards: string[]; manaNeeded: number; label: string }[];
  comboWins: boolean;
}

export function defaultStrategyFor(deck: CompiledDeck): Strategy {
  return deck.commanders.some((c) => deck.defs[c].grantToughnessDraw) ? prideStrategy : genericStrategy;
}

export function strategyById(id: string): Strategy {
  return STRATEGIES.find((s) => s.id === id) ?? genericStrategy;
}

/** Plays one game. `order` overrides the canonical library order (for aligned version compares). */
export function playGame(deck: CompiledDeck, seed: number, opts: GoldfishOptions, log = false, order?: number[]): Game {
  const strategy = strategyById(opts.strategy);
  const settings = { ...defaults(strategy.settings), ...opts.settings };
  const byName = new Map<string, number>();
  for (const d of deck.defs) {
    byName.set(nameKey(d.name), d.idx);
    byName.set(nameKey(frontFace(d.name)), d.idx);
  }
  const combos = opts.combos
    .map((c) => ({ ...c, cards: c.cards.map((n) => byName.get(nameKey(n)) ?? byName.get(nameKey(frontFace(n))) ?? -1) }))
    .filter((c) => c.cards.every((i) => i >= 0));
  const g = new Game(deck, seed, { maxTurns: opts.maxTurns, drawOnTurnOne: opts.drawOnTurnOne, combos, comboWins: opts.comboWins, log }, order);
  mulligan(g, opts.rules);
  for (let t = 0; t < opts.maxTurns && !g.over(); t++) {
    g.beginTurn();
    if (!g.over()) strategy.main1(g, settings);
    g.endPhase();
    if (!g.over()) strategy.combat(g, settings);
    g.endPhase();
    if (!g.over()) strategy.main2(g, settings);
    g.endTurn();
    g.manaByTurn.push(g.manaAvailable('ability'));
  }
  return g;
}

/** London mulligan with the free first mulligan, using the same keep rules as Mana & Hands. */
function mulligan(g: Game, rules: KeepRules) {
  for (let m = 0; ; m++) {
    const seven = g.lib.splice(0, 7);
    const penalty = Math.max(0, m - (rules.freeFirstMulligan ? 1 : 0));
    const defs = seven.map((i) => g.def(i));
    const { keep, bottom } = chooseBottom(defs, penalty, rules);
    if (handOk(keep, rules) || m >= rules.maxMulligans) {
      // chooseBottom works on definitions; map back to the physical cards.
      const pool = [...seven];
      const take = (d: (typeof defs)[number]) => pool.splice(pool.indexOf(d.idx), 1)[0];
      g.hand = keep.map(take);
      g.lib.push(...bottom.map(take));
      for (const c of g.hand) g.seen(c);
      g.mulligans = m;
      return;
    }
    g.lib.push(...seven);
    shuffle(g.lib, g.rng);
  }
}

export interface GoldfishSummary {
  games: number;
  seed: number;
  maxTurns: number;
  strategy: string;
  /** Cumulative share of games won by turn t (index t-1), by win type and in total. */
  winByTurn: Record<WinType | 'total', number[]>;
  medianWin: number | null;
  winShare: Record<WinType, number>;
  commander: { byTurn: number[]; median: number | null; avgCost: number | null; never: number };
  extraDrawn: number[];
  landsByTurn: number[];
  failures: { decked: number; noWin: number; flooded: number; screwed: number };
  combo: { byTurn: number[]; top: { label: string; share: number }[] };
  impact: { name: string; seenShare: number; withDrawn: number; without: number; delta: number }[];
  avgMulligans: number;
}

export function summarize(gs: Game[], deck: CompiledDeck, opts: GoldfishOptions): GoldfishSummary {
  const n = gs.length;
  const T = opts.maxTurns;
  const cum = (pred: (g: Game, t: number) => boolean) => Array.from({ length: T }, (_, t) => gs.filter((g) => pred(g, t + 1)).length / n);
  const winByTurn = Object.fromEntries([...WIN_TYPES, 'total'].map((w) => [w, cum((g, t) => g.winTurn !== null && g.winTurn <= t && (w === 'total' || g.winType === w))])) as GoldfishSummary['winByTurn'];
  const allWinTurns = gs.map((g) => g.winTurn ?? Infinity).sort((a, b) => a - b);
  const mid = allWinTurns[Math.floor(n / 2)];
  const cmdTurns = gs.filter((g) => g.commanderTurn !== null);
  const cmdAll = gs.map((g) => g.commanderTurn ?? Infinity).sort((a, b) => a - b);
  const mean = (arr: number[][], t: number) => arr.reduce((a, r) => a + (r[t] ?? r[r.length - 1] ?? 0), 0) / Math.max(1, arr.length);

  // Failure modes. Flooded: 55%+ of cards seen by turn 6 were lands. Screwed: fewer than 4 lands by the end of turn 5.
  const flooded = gs.filter((g) => g.cardsSeenBy6 > 0 && g.landsSeenBy6 / g.cardsSeenBy6 >= 0.55).length / n;
  const screwed = gs.filter((g) => (g.landsByTurn[4] ?? g.landsByTurn[g.landsByTurn.length - 1] ?? 0) < 4).length / n;

  const comboCounts = new Map<string, number>();
  for (const g of gs) if (g.comboLabel) comboCounts.set(g.comboLabel, (comboCounts.get(g.comboLabel) ?? 0) + 1);

  // Per-card impact: average win turn when the card was seen by turn 6 vs not (unwon games count as maxTurns + 1).
  const winT = (g: Game) => g.winTurn ?? T + 1;
  const impact: GoldfishSummary['impact'] = [];
  const counted = new Set<number>();
  for (const i of deck.library) {
    if (counted.has(i)) continue;
    counted.add(i);
    const d = deck.defs[i];
    if (/^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(d.name)) continue;
    const withIt = gs.filter((g) => (g.firstSeen.get(i) ?? 99) <= 6);
    const without = gs.filter((g) => (g.firstSeen.get(i) ?? 99) > 6);
    if (withIt.length < 20 || without.length < 20) continue;
    const a = withIt.reduce((s, g) => s + winT(g), 0) / withIt.length;
    const b = without.reduce((s, g) => s + winT(g), 0) / without.length;
    impact.push({ name: d.name, seenShare: withIt.length / n, withDrawn: a, without: b, delta: a - b });
  }
  impact.sort((x, y) => x.delta - y.delta);

  return {
    games: n,
    seed: opts.seed,
    maxTurns: T,
    strategy: opts.strategy,
    winByTurn,
    medianWin: Number.isFinite(mid) ? mid : null,
    winShare: Object.fromEntries(WIN_TYPES.map((w) => [w, gs.filter((g) => g.winType === w).length / n])) as Record<WinType, number>,
    commander: {
      byTurn: cum((g, t) => g.commanderTurn !== null && g.commanderTurn <= t),
      median: Number.isFinite(cmdAll[Math.floor(n / 2)]) ? cmdAll[Math.floor(n / 2)] : null,
      avgCost: cmdTurns.length ? cmdTurns.reduce((a, g) => a + (g.commanderCost ?? 0), 0) / cmdTurns.length : null,
      never: 1 - cmdTurns.length / n,
    },
    extraDrawn: Array.from({ length: T }, (_, t) => mean(gs.map((g) => g.extraDrawnByTurn), t)),
    landsByTurn: Array.from({ length: T }, (_, t) => mean(gs.map((g) => g.landsByTurn), t)),
    failures: { decked: gs.filter((g) => g.decked).length / n, noWin: gs.filter((g) => g.winTurn === null).length / n, flooded, screwed },
    combo: {
      byTurn: cum((g, t) => g.comboTurn !== null && g.comboTurn <= t),
      top: [...comboCounts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, c]) => ({ label, share: c / n })),
    },
    impact,
    avgMulligans: gs.reduce((a, g) => a + g.mulligans, 0) / n,
  };
}

export function runGoldfish(deck: CompiledDeck, opts: GoldfishOptions, onProgress?: (done: number) => void, order?: number[]): GoldfishSummary {
  const gs: Game[] = [];
  for (let i = 0; i < opts.games; i++) {
    gs.push(playGame(deck, deriveSeed(opts.seed, i), opts, false, order));
    if (onProgress && i % 100 === 99) onProgress(i + 1);
  }
  return summarize(gs, deck, opts);
}

/**
 * Library order for deck B aligned to deck A's canonical order: every card B shares with A keeps A's slot,
 * and each card B adds takes the slot of a card B cut. So both versions see the same shuffles.
 */
export function alignedOrder(a: CompiledDeck, b: CompiledDeck): number[] {
  const bByName = new Map(b.defs.map((d) => [d.name, d.idx]));
  const bCounts = new Map<number, number>();
  for (const i of b.library) bCounts.set(i, (bCounts.get(i) ?? 0) + 1);
  const order: (number | null)[] = a.library.map((i) => {
    const j = bByName.get(a.defs[i].name);
    if (j !== undefined && (bCounts.get(j) ?? 0) > 0) {
      bCounts.set(j, bCounts.get(j)! - 1);
      return j;
    }
    return null;
  });
  const added: number[] = [];
  for (const [j, c] of bCounts) for (let k = 0; k < c; k++) added.push(j);
  added.sort((x, y) => b.defs[x].name.localeCompare(b.defs[y].name));
  const out: number[] = [];
  for (const o of order) {
    if (o !== null) out.push(o);
    else if (added.length) out.push(added.shift()!);
  }
  out.push(...added);
  return out;
}

/** Plays the first `turns` turns from a given kept hand and library order (the hand sampler). */
export function playFromHand(deck: CompiledDeck, hand: string[], library: string[], opts: GoldfishOptions, turns: number): Game {
  const strategy = strategyById(opts.strategy);
  const settings = { ...defaults(strategy.settings), ...opts.settings };
  const idx = (n: string) => deck.defs.findIndex((d) => d.name === n);
  const g = new Game(deck, 0, { maxTurns: turns, drawOnTurnOne: opts.drawOnTurnOne, combos: [], comboWins: false, log: true });
  g.hand = hand.map(idx).filter((i) => i >= 0);
  g.lib = library.map(idx).filter((i) => i >= 0);
  for (let t = 0; t < turns && !g.over(); t++) {
    g.beginTurn();
    if (!g.over()) strategy.main1(g, settings);
    g.endPhase();
    if (!g.over()) strategy.combat(g, settings);
    g.endPhase();
    if (!g.over()) strategy.main2(g, settings);
    g.endTurn();
  }
  return g;
}

export function sampleGame(deck: CompiledDeck, opts: GoldfishOptions, gameIndex: number): { logs: TurnLog[]; game: Game; seed: number } {
  const seed = deriveSeed(opts.seed, gameIndex);
  const game = playGame(deck, seed, opts, true);
  return { logs: game.logs, game, seed };
}

export const DEFAULT_GOLDFISH: Omit<GoldfishOptions, 'strategy' | 'settings'> = {
  games: 5000,
  maxTurns: 20,
  seed: 1,
  drawOnTurnOne: true,
  rules: DEFAULT_RULES,
  combos: [],
  comboWins: true,
};
