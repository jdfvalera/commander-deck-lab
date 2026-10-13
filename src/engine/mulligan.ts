// London mulligan with Commander's free first mulligan, plus a small mana-development model that
// estimates the turn the commander can be cast. The model only plays lands and ramp: the full
// goldfish (M3) replaces it, including board-dependent costs like the Pride's.

import type { Color } from '../data/types';
import { deriveSeed, mulberry32, shuffle } from './rng';
import { expandLibrary, type DeckModel, type ModelCard } from './deckModel';

export interface KeepRules {
  minLands: number;
  maxLands: number;
  /** Nonland cards with mana value ≤ 2 (plays for the first two turns). */
  minEarlyPlays: number;
  /** Count cheap mana rocks/creatures (MV ≤ 2) toward the land minimum. */
  rampCountsAsLand: boolean;
  /** Mulligans allowed before keeping whatever comes. */
  maxMulligans: number;
  freeFirstMulligan: boolean;
}

export const DEFAULT_RULES: KeepRules = {
  minLands: 2,
  maxLands: 5,
  minEarlyPlays: 1,
  rampCountsAsLand: false,
  maxMulligans: 3,
  freeFirstMulligan: true,
};

export interface HandOptions {
  turns: number;
  drawOnTurnOne: boolean;
  /** Keep the first 7 no matter what (baseline for "how much do mulligans help?"). */
  neverMulligan?: boolean;
  /** Spend leftover mana on card draw (default true). */
  cardDraw?: boolean;
  log?: boolean;
}

export interface HandResult {
  mulligans: number;
  /** Every 7 seen, in order, with what was bottomed from the final one. */
  hands: ModelCard[][];
  kept: ModelCard[];
  bottomed: ModelCard[];
  forced: boolean;
  landsKept: number;
  earlyKept: number;
  /** First turn the commander is castable, null if not within `turns`, undefined if the model can't tell. */
  commanderTurn: number | null | undefined;
  manaByTurn: number[];
  extraDrawnByTurn: number[];
  /** The next cards drawn after keeping (for the hand sampler). */
  nextDraws: ModelCard[];
  log: string[];
}

const isEarlyPlay = (c: ModelCard) => !c.isLand && c.mv <= 2;
const isCheapRamp = (c: ModelCard) => !c.isLand && c.mv <= 2 && (c.sourceKind === 'rock' || c.sourceKind === 'dork') && !c.rampRestricted;

function landCount(hand: ModelCard[], rules: KeepRules) {
  return hand.filter((c) => c.isLand || (rules.rampCountsAsLand && isCheapRamp(c))).length;
}

export function handOk(hand: ModelCard[], rules: KeepRules): boolean {
  const lands = landCount(hand, rules);
  return lands >= rules.minLands && lands <= rules.maxLands && hand.filter(isEarlyPlay).length >= rules.minEarlyPlays;
}

/** London mulligan: choose `n` cards to bottom from a 7-card hand, trying to make it keepable. */
export function chooseBottom(hand: ModelCard[], n: number, rules: KeepRules): { keep: ModelCard[]; bottom: ModelCard[] } {
  if (n <= 0) return { keep: [...hand], bottom: [] };
  const byWorstSpell = (a: ModelCard, b: ModelCard) => b.mv - a.mv;
  const lands = hand.filter((c) => c.isLand).sort((a, b) => (a.entersTapped === 'yes' ? -1 : 0) - (b.entersTapped === 'yes' ? -1 : 0));
  const spells = hand.filter((c) => !c.isLand).sort(byWorstSpell);
  const candidates: ModelCard[][] = [];
  for (let fromLands = 0; fromLands <= n; fromLands++) {
    const fromSpells = n - fromLands;
    if (fromLands > lands.length || fromSpells > spells.length) continue;
    candidates.push([...lands.slice(0, fromLands), ...spells.slice(0, fromSpells)]);
  }
  // Prefer a keepable result with 3–4 lands, then any keepable one, then the most lands-balanced.
  const score = (bottom: ModelCard[]) => {
    const keep = hand.filter((c) => !bottom.includes(c));
    const l = landCount(keep, rules);
    return (handOk(keep, rules) ? 100 : 0) - Math.abs(l - 3.5) * 10 + keep.filter(isEarlyPlay).length;
  };
  const bottom = candidates.sort((a, b) => score(b) - score(a))[0] ?? hand.slice(0, n);
  return { keep: hand.filter((c) => !bottom.includes(c)), bottom };
}

/** The commander the mana model times: a creature over a Background, then the cheapest. */
export function timedCommander(model: DeckModel): ModelCard | undefined {
  return [...model.commanders]
    .filter((c) => !c.boardDependentCost)
    .sort((a, b) => Number(b.isCreature) - Number(a.isCreature) || a.mv - b.mv)[0];
}

interface Permanent {
  card: ModelCard;
  readyTurn: number;
}

export interface ManaDevelopment {
  /** First turn the commander is castable; null if not within the turns; undefined if the model can't time it. */
  commanderTurn: number | null | undefined;
  /** Mana available on each turn 1..turns, after that turn's land drop (ramp cast this turn counts from next turn). */
  manaByTurn: number[];
  /** Cards drawn beyond the normal draw step, cumulative by end of each turn. */
  extraDrawnByTurn: number[];
}

/** Plays out lands, ramp and card draw from a kept hand for every turn: mana each turn, and when the commander fits. */
export function developMana(
  model: DeckModel,
  kept: ModelCard[],
  library: ModelCard[],
  opts: HandOptions,
  log: string[],
): ManaDevelopment {
  const commander = timedCommander(model);
  let commanderTurn: number | null | undefined = commander ? null : undefined;
  const manaByTurn: number[] = [];
  const extraDrawnByTurn: number[] = [];
  const say = (s: string) => opts.log && log.push(s);
  const hand = [...kept];
  const lib = [...library];
  const lands: Permanent[] = [];
  const rocks: Permanent[] = [];
  const dorks: Permanent[] = [];
  const engines: { n: number; readyTurn: number; name: string }[] = [];
  const activators: Permanent[] = [];
  let auras = 0;
  let extraDrawn = 0;
  const cardDraw = opts.cardDraw !== false;
  const needColors = commander ? (['W', 'U', 'B', 'R', 'G'] as Color[]).filter((c) => commander.cost.pips[c] > 0) : [];

  const drawExtra = (n: number, why: string) => {
    const got: string[] = [];
    for (let i = 0; i < n; i++) {
      const d = lib.shift();
      if (!d) break;
      hand.push(d);
      got.push(d.name);
      extraDrawn++;
    }
    if (got.length) say(`  ${why}: draw ${got.join(', ')}`);
  };
  // Looting discards the card the mana model needs least: a land when flush with them, else the priciest spell.
  const discard = (n: number) => {
    for (let i = 0; i < n && hand.length; i++) {
      const handLands = hand.filter((c) => c.isLand);
      const priciest = [...hand].filter((c) => !c.isLand).sort((a, b) => b.mv - a.mv)[0];
      const flush = handLands.length >= 3 || lands.length >= 6;
      const pick = (flush && handLands[0]) || priciest || hand[0];
      hand.splice(hand.indexOf(pick), 1);
      say(`  discard ${pick.name}`);
    }
  };

  for (let turn = 1; turn <= opts.turns; turn++) {
    if (turn > 1 || opts.drawOnTurnOne) {
      const d = lib.shift();
      if (d) hand.push(d);
      say(`T${turn}: draw ${d?.name ?? '(empty library)'}`);
    }
    if (cardDraw) for (const e of engines) if (e.readyTurn <= turn) drawExtra(e.n, e.name);

    let landPlayed = false;
    const untapped = (c: ModelCard) => c.entersTapped === 'no' || (c.entersTapped === 'conditional' && lands.length >= 2);
    // Land drop: an untapped land that adds a missing commander color, else any untapped, else anything.
    const playLand = () => {
      if (landPlayed) return false;
      const haveColors = new Set(lands.flatMap((l) => l.card.produces));
      const handLands = hand.filter((c) => c.isLand);
      const land =
        handLands.find((c) => untapped(c) && !c.fetchesBasic && c.produces.some((x) => needColors.includes(x) && !haveColors.has(x))) ??
        handLands.find((c) => untapped(c) && !c.fetchesBasic) ??
        handLands[0];
      if (!land) return false;
      hand.splice(hand.indexOf(land), 1);
      const ready = land.fetchesBasic || !untapped(land) ? turn + 1 : turn;
      lands.push({ card: land, readyTurn: ready });
      landPlayed = true;
      say(`  play ${land.name}${ready > turn ? ' (tapped)' : ''}`);
      return true;
    };
    playLand();

    // Only mana creatures are on this model's battlefield, so per-defender dorks count those (at least themselves).
    const defenders = () => dorks.filter((d) => d.card.defender).length;
    const dorkMana = (d: Permanent) => (d.card.rampPerDefender ? Math.max(1, defenders()) : d.card.rampPerToughness ? d.card.toughness : d.card.rampAmount);
    const mana = () => {
      const l = lands.filter((x) => x.readyTurn <= turn).length;
      const r = rocks.filter((x) => x.readyTurn <= turn && !x.card.rampRestricted).reduce((a, x) => a + x.card.rampAmount, 0);
      const dk = dorks.filter((x) => x.readyTurn <= turn && !x.card.rampRestricted).reduce((a, x) => a + dorkMana(x), 0);
      return l + r + dk + (l > 0 ? auras : 0);
    };
    const colorsReady = () =>
      new Set([...lands, ...rocks, ...dorks].filter((x) => x.readyTurn <= turn && !x.card.rampRestricted).flatMap((x) => x.card.produces));
    let spent = 0;
    const left = () => mana() - spent;
    manaByTurn.push(mana());
    const canCastCommander = () => !!commander && commanderTurn === null && left() >= commander.mv && needColors.every((c) => colorsReady().has(c));
    if (canCastCommander()) {
      say(`  ${left()} mana: ${commander!.name} is castable`);
      commanderTurn = turn;
    }

    // Cast ramp, cheapest first, while it fits.
    const castRamp = () => {
      let cast = false;
      const ramp = hand
        .filter((c) => !c.isLand && (c.sourceKind === 'rock' || c.sourceKind === 'dork' || c.sourceKind === 'aura' || c.rampLands > 0))
        .sort((a, b) => a.mv - b.mv);
      for (const c of ramp) {
        if (c.mv > left()) continue;
        spent += c.mv;
        hand.splice(hand.indexOf(c), 1);
        if (c.sourceKind === 'rock') rocks.push({ card: c, readyTurn: c.entersTapped === 'yes' ? turn + 1 : turn });
        else if (c.sourceKind === 'dork') dorks.push({ card: c, readyTurn: turn + 1 });
        else if (c.sourceKind === 'aura') auras += c.rampAmount;
        if (c.rampLands > 0) {
          for (let i = 0; i < c.rampLands; i++) {
            const basic = lib.find((x) => x.isLand && x.fetchesBasic === false && x.produces.length === 1 && /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(x.name));
            if (basic) lib.splice(lib.indexOf(basic), 1);
            lands.push({ card: basic ?? { ...c, produces: model.basicColors.slice(0, 1) }, readyTurn: c.rampLandsTapped ? turn + 1 : turn });
          }
        }
        say(`  cast ${c.name}`);
        if (cardDraw && c.draw) castDrawEffects(c);
        cast = true;
      }
      return cast;
    };
    // A card's draw on cast, plus any engine or activation it leaves behind.
    const castDrawEffects = (c: ModelCard, xMana = 0) => {
      const d = c.draw!;
      const n = d.onCast + (d.x ? xMana : 0);
      if (n) drawExtra(n, c.name);
      if (d.discard) discard(d.discard);
      if (d.permanent && d.perTurn) engines.push({ n: d.perTurn, readyTurn: turn + 1, name: c.name });
      if (d.permanent && d.activated) activators.push({ card: c, readyTurn: d.activated.tap && c.isCreature ? turn + 1 : turn });
    };
    // Spend what's left on card draw: the most cards per mana first.
    const castDraw = () => {
      let cast = false;
      for (;;) {
        const value = (c: ModelCard) => (c.draw!.onCast + (c.draw!.x ? Math.max(0, Math.min(3, left() - c.mv)) : 0) + c.draw!.perTurn * 3 + (c.draw!.activated ? 2 : 0)) / Math.max(1, c.mv);
        const options = hand.filter((c) => !c.isLand && c.draw && !c.sourceKind && c.rampLands === 0 && c.mv <= left() && (!c.draw.x || left() > c.mv));
        if (!options.length) return cast;
        const c = options.sort((a, b) => value(b) - value(a))[0];
        const xMana = c.draw!.x ? Math.min(3, left() - c.mv) : 0;
        spent += c.mv + xMana;
        hand.splice(hand.indexOf(c), 1);
        say(`  cast ${c.name}`);
        castDrawEffects(c, xMana);
        cast = true;
      }
    };
    // Up to three passes, so draws can find a land drop or more ramp this turn.
    for (let pass = 0; pass < 3; pass++) {
      const progressed = [castRamp(), cardDraw && castDraw(), playLand()].some(Boolean);
      if (!progressed) break;
    }
    if (cardDraw) {
      for (const a of activators) {
        const act = a.card.draw!.activated!;
        if (a.readyTurn > turn || act.cost > left()) continue;
        spent += act.cost;
        drawExtra(act.n, `activate ${a.card.name}`);
        if (act.discard) discard(act.discard);
      }
      playLand();
    }
    if (canCastCommander()) {
      say(`  ${left()} mana left: ${commander!.name} is castable`);
      commanderTurn = turn;
    }
    extraDrawnByTurn.push(extraDrawn);
    say(`  ${manaByTurn[turn - 1]} mana this turn`);
  }
  return { commanderTurn, manaByTurn, extraDrawnByTurn };
}

/** One opening-hand sequence: draw 7, mulligan by the rules (London), then develop mana. */
export function simulateHand(model: DeckModel, seed: number, rules: KeepRules, opts: HandOptions): HandResult {
  const rand = mulberry32(seed);
  const cards = expandLibrary(model);
  const hands: ModelCard[][] = [];
  const log: string[] = [];
  let mulligans = 0;
  for (;;) {
    const deck = shuffle([...cards], rand);
    const seven = deck.slice(0, 7);
    hands.push(seven);
    const penalty = Math.max(0, mulligans - (rules.freeFirstMulligan ? 1 : 0));
    const { keep, bottom } = chooseBottom(seven, penalty, rules);
    const ok = handOk(keep, rules);
    const forced = !ok && (opts.neverMulligan || mulligans >= rules.maxMulligans);
    if (ok || forced || opts.neverMulligan) {
      const library = [...deck.slice(7), ...bottom];
      if (opts.log) {
        log.push(`Kept ${keep.length} after ${mulligans} mulligan${mulligans === 1 ? '' : 's'}${forced ? ' (forced)' : ''}: ${keep.map((c) => c.name).join(', ')}`);
        if (bottom.length) log.push(`Bottomed: ${bottom.map((c) => c.name).join(', ')}`);
      }
      const { commanderTurn, manaByTurn, extraDrawnByTurn } = developMana(model, keep, library, opts, log);
      return {
        mulligans, hands, kept: keep, bottomed: bottom, forced,
        landsKept: keep.filter((c) => c.isLand).length,
        earlyKept: keep.filter(isEarlyPlay).length,
        commanderTurn, manaByTurn, extraDrawnByTurn, nextDraws: library.slice(0, 4), log,
      };
    }
    mulligans++;
  }
}

export interface MulliganSummary {
  trials: number;
  seed: number;
  /** Share of trials that kept the first 7 seen. */
  keepFirst: number;
  /** Share of trials by number of mulligans taken (0..maxMulligans). */
  mulliganDist: number[];
  forcedKeeps: number;
  avgCardsKept: number;
  avgLandsKept: number;
  commander: CommanderTiming | null;
  /** Same seeds, always keeping the first 7: what mulligans buy you. */
  baseline: CommanderTiming | null;
  mana: ManaDistribution;
  /** Average cards drawn beyond draw steps, cumulative by turn. */
  extraDrawn: number[];
}

export const MANA_CAP = 15;

export interface ManaDistribution {
  /** share[t][m]: share of games with exactly m mana on turn t+1 (m = MANA_CAP means MANA_CAP or more). */
  share: number[][];
  median: number[];
  mean: number[];
}

function manaDistribution(rows: number[][], turns: number): ManaDistribution {
  const share = Array.from({ length: turns }, () => new Array(MANA_CAP + 1).fill(0));
  const median: number[] = [];
  const mean: number[] = [];
  for (let t = 0; t < turns; t++) {
    const vals = rows.map((r) => r[t] ?? 0).sort((a, b) => a - b);
    for (const v of vals) share[t][Math.min(MANA_CAP, v)] += 1 / rows.length;
    median.push(vals[Math.floor(vals.length / 2)] ?? 0);
    mean.push(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length));
  }
  return { share, median, mean };
}

export interface CommanderTiming {
  name: string;
  /** Cumulative share castable by turn 1..turns. */
  byTurn: number[];
  median: number | null;
}

function timing(name: string, turns: (number | null | undefined)[], maxTurn: number): CommanderTiming | null {
  if (turns.some((t) => t === undefined)) return null;
  const byTurn = Array.from({ length: maxTurn }, (_, i) => turns.filter((t) => t !== null && t! <= i + 1).length / turns.length);
  const sorted = turns.map((t) => (t === null ? Infinity : t!)).sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return { name, byTurn, median: Number.isFinite(mid) ? mid : null };
}

export function summarizeMulligans(
  model: DeckModel,
  seed: number,
  trials: number,
  rules: KeepRules,
  opts: HandOptions,
  onProgress?: (done: number) => void,
): MulliganSummary {
  const dist = new Array(rules.maxMulligans + 1).fill(0);
  let kept = 0;
  let lands = 0;
  let forced = 0;
  const cmd: (number | null | undefined)[] = [];
  const base: (number | null | undefined)[] = [];
  const manaRows: number[][] = [];
  const extraRows: number[][] = [];
  for (let i = 0; i < trials; i++) {
    const s = deriveSeed(seed, i);
    const r = simulateHand(model, s, rules, opts);
    dist[r.mulligans]++;
    kept += r.kept.length;
    lands += r.landsKept;
    if (r.forced) forced++;
    cmd.push(r.commanderTurn);
    manaRows.push(r.manaByTurn);
    extraRows.push(r.extraDrawnByTurn);
    base.push(simulateHand(model, s, rules, { ...opts, neverMulligan: true }).commanderTurn);
    if (onProgress && i % 250 === 249) onProgress(i + 1);
  }
  const name = timedCommander(model)?.name ?? model.commanders[0]?.name ?? '';
  return {
    trials, seed,
    keepFirst: dist[0] / trials,
    mulliganDist: dist.map((d) => d / trials),
    forcedKeeps: forced / trials,
    avgCardsKept: kept / trials,
    avgLandsKept: lands / trials,
    commander: timing(name, cmd, opts.turns),
    baseline: timing(name, base, opts.turns),
    mana: manaDistribution(manaRows, opts.turns),
    extraDrawn: Array.from({ length: opts.turns }, (_, t) => extraRows.reduce((a, r) => a + (r[t] ?? 0), 0) / Math.max(1, trials)),
  };
}
