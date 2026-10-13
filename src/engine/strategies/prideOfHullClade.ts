// The Pride of Hull Clade plan (PROMPT.md): develop walls and ramp, cast the Pride cheaply, aim its
// "draw cards equal to toughness" ability at creatures that connect, hold Triumph of the Hordes until
// the poison is lethal, and keep a library buffer so the draws never deck us.
// Every card is found by its tags (e.g. "mass infect"), never by name.

import type { Color } from '../../data/types';
import type { ManaCost } from '../manaCost';
import type { Game, Opponent, Perm } from '../game';
import type { Strategy, StrategySettings } from './types';
import { activateAbilities, attachIfNeeded, attackAll, castDraw, castRamp, castWhile, equip, isRamp, makeUnblockable, playLand } from './common';

const NO_COST: ManaCost = { generic: 0, pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hybrid: [], x: 0, mv: 0 };

export const prideStrategy: Strategy = {
  id: 'pride',
  label: 'The Pride of Hull Clade',
  description:
    'Walls and ramp first; cast the Pride once its toughness discount makes it cheap; each turn aim its ability at creatures that can connect (4–7 toughness preferred, never below the library buffer); hold Triumph of the Hordes and Tower Defense until the poison is lethal; extra mana pays for walls to attack with damage equal to toughness.',
  settings: [
    { key: 'minLibrary', label: 'Keep at least this many cards in library', help: 'The Pride’s draw is mandatory: a 13-toughness hit draws 13.', type: 'number', default: 20, min: 0, max: 80 },
    { key: 'preferMin', label: 'Preferred draw target toughness: from', type: 'number', default: 4, min: 1, max: 20 },
    { key: 'preferMax', label: 'to', type: 'number', default: 7, min: 1, max: 30 },
    { key: 'greavesOnCommander', label: 'Put Lightning Greaves (shroud equipment) on the Pride', help: 'The Pride targets other creatures, so shroud on it costs nothing.', type: 'boolean', default: true },
    { key: 'useTowerDefense', label: 'Add Tower Defense (+0/+5) on the Triumph turn when it helps', type: 'boolean', default: true },
    { key: 'wallsAttack', label: 'Spend leftover mana letting walls attack (Walking Bulwark / Assault Formation)', type: 'boolean', default: true },
    { key: 'castDrawDoubler', label: 'Cast draw doublers (Alhammarret’s Archive)', help: 'Doubles every Pride draw; raises the decking risk.', type: 'boolean', default: true },
    { key: 'useGeralf', label: 'Use Geralf-style “sacrifice → X/X flier” when Triumph isn’t in hand', type: 'boolean', default: true },
    { key: 'handSlack', label: 'Extra cards it may draw past what fits in hand (without Reliquary Tower)', help: 'Draws past 7 cards in hand are discarded at end of turn.', type: 'number', default: 3, min: 0, max: 30 },
    { key: 'developBeforeCombat', label: 'Also cast creatures before combat once the Pride is out', help: 'Off: leftover mana after the Pride’s ability goes to walls attacking; new cards are cast after combat.', type: 'boolean', default: false },
  ],

  main1(g, s) {
    playLand(g, wantColors(g));
    if (tryTriumph(g, s)) return;
    // Before the Pride: build toward it. Once it's out, its draw engine gets the mana first; what it
    // draws gets cast in the second main phase.
    if (!pride(g)) develop(g, s);
    else {
      castRamp(g);
      castWhile(g, (d) => d.costReducerAbilities > 0 && !isRamp(d), (d) => -d.mv);
    }
    equipGreaves(g, s);
    drawEngine(g, s);
    if (pride(g) && Number(s.developBeforeCombat)) develop(g, s);
    if (s.wallsAttack) wallsAttack(g);
    activateAbilities(g, 0, Number(s.minLibrary) + pendingDraws(g));
    g.checkCombos();
  },
  combat(g) {
    attackAll(g, (p) => p.token !== null || g.def(p.def).sourceKind !== 'dork');
  },
  main2(g, s) {
    playLand(g, wantColors(g));
    develop(g, s);
    equipGreaves(g, s);
    if (s.useGeralf) geralf(g);
    activateAbilities(g, 0, Number(s.minLibrary));
    g.checkCombos();
  },
};

function wantColors(g: Game): Color[] {
  return g.d.identity;
}

/** Finds the Pride on the battlefield: the commander whose ability grants "draw cards equal to toughness". */
export function pride(g: Game): Perm | undefined {
  return g.bf.find((p) => !p.token && p.commander && g.def(p.def).grantToughnessDraw);
}

export function prideAbilityCost(g: Game): ManaCost | null {
  const p = pride(g);
  const c = p && g.def(p.def).grantToughnessDraw;
  return c ? g.abilityCost(c, true) : null;
}

/** Cards held for the win turn: mass infect (Triumph) and team toughness pumps (Tower Defense). */
const isWinPiece = (g: Game, i: number) => g.def(i).massInfect || !!g.def(i).teamToughnessPump;

function develop(g: Game, s: StrategySettings) {
  castRamp(g);
  castPrideIfCheap(g);
  // Cost reducers and engines, then creatures by toughness per mana (they also shrink the Pride's cost).
  castWhile(g, (d) => !d.types.creature && (d.costReducerAbilities > 0 || d.creatureEtbDraw || (d.drawDoubler && !!s.castDrawDoubler)) && !isRamp(d), (d) => -d.mv);
  for (let i = 0; i < 12; i++) {
    const cast = castWhile(
      g,
      (d) => d.types.creature && !isRamp(d) && !d.interaction,
      (d) => (d.handSizePT ? 6 : d.toughness + d.costReducerAbilities * 3) / Math.max(1, d.mv),
      (p, d) => attachIfNeeded(g, p, d),
    );
    const cmd = castPrideIfCheap(g);
    if (!cast && !cmd) break;
  }
  castDraw(g, Number(s.minLibrary));
  // Other permanents (Assault Formation, equipment, auras), never the held win pieces or interaction.
  castWhile(
    g,
    (d, i) => d.permanent && !d.types.land && !d.interaction && !d.protection && !isWinPiece(g, i) && (!d.drawDoubler || !!s.castDrawDoubler),
    (d) => d.mv,
    (p, d) => attachIfNeeded(g, p, d, (q) => drawTargetScore(g, q, s)),
  );
  castPrideIfCheap(g);
}

function castPrideIfCheap(g: Game): boolean {
  for (const c of [...g.commandZone]) {
    if (g.canPay(g.castCost(c, true), 'commander')) {
      g.cast(c, { fromCommandZone: true });
      return true;
    }
  }
  return false;
}

function equipGreaves(g: Game, s: StrategySettings) {
  const p = pride(g);
  equip(g, (eq) => {
    const e = g.def(eq.def).equipment!;
    if (e.shroud) return s.greavesOnCommander && p ? p : null; // never on a creature the Pride needs to target
    return null;
  });
}

/** Cards the Pride's targets this turn will draw when they connect (plus per-hit draws like Ohran Frostfang). */
function pendingDraws(g: Game, extraTarget?: Perm): number {
  const doubler = g.has((d) => d.drawDoubler) ? 2 : 1;
  const perHit = g.onBattlefield((d) => d.combatDamageDraw?.scope === 'team').reduce((a, p) => a + g.def(p.def).combatDamageDraw!.n, 0);
  const targets = g.creatures().filter((p) => p.eot.drawOnHit || p === extraTarget);
  const attackers = g.creatures().filter((p) => p.eot.canAttack || p === extraTarget || (!g.defender(p) && g.readyToAttack(p))).length;
  return targets.reduce((a, p) => a + Math.max(0, g.toughness(p)) * doubler, 0) + perHit * attackers * doubler;
}

/** How good a creature is as the Pride's draw target right now (higher is better; -Infinity = don't). */
function drawTargetScore(g: Game, p: Perm, s: StrategySettings): number {
  const t = g.toughness(p);
  if (t <= 0) return -Infinity;
  // Every draw already queued this turn counts against the library buffer, not just this one.
  if (g.lib.length - pendingDraws(g, p) < Number(s.minLibrary)) return -Infinity;
  // Without a "no maximum hand size" card, cards drawn past what you can keep are discarded at end of turn.
  if (!g.has((d) => d.noMaxHandSize)) {
    const keepable = 7 - g.hand.length + Math.ceil(g.manaAvailable('hand') / 2) + Number(s.handSlack);
    if (pendingDraws(g, p) > Math.max(keepable, Number(s.preferMin))) return -Infinity;
  }
  const lo = Number(s.preferMin);
  const hi = Number(s.preferMax);
  if (t >= lo && t <= hi) return 100 + t;
  if (t < lo) return 50 + t;
  return 30 + Math.min(t, 20) / 2; // big: only once the buffer allows it
}

/** Aims the Pride's ability at the best targets while mana lasts. */
function drawEngine(g: Game, s: StrategySettings) {
  const cost = prideAbilityCost(g);
  if (!cost) return;
  for (let i = 0; i < 10 && !g.over(); i++) {
    if (!g.canPay(cost, 'ability')) return;
    const targets = g
      .creatures()
      .filter((p) => g.readyToAttack(p) && !g.shroud(p) && !p.eot.drawOnHit && !(p.token === null && g.def(p.def).sourceKind === 'dork'))
      .map((p) => ({ p, score: drawTargetScore(g, p, s) }))
      .filter((x) => x.score > -Infinity)
      .sort((a, b) => b.score - a.score);
    if (!targets.length) return;
    // Against blockers, only aim at a creature that will connect: evasive, or made unblockable.
    let chosen: Perm | null = null;
    let target: Opponent | null = null;
    let needsEnabler = false;
    for (const { p } of targets) {
      const open = g.alive().filter((o) => g.connects(p, o)).sort((a, b) => b.life - a.life);
      if (open.length) {
        chosen = p;
        target = open[0];
        break;
      }
      if (makeUnblockable(g, p, { dryRun: true }) && g.manaAvailable('ability') >= cost.mv + 2) {
        chosen = p;
        needsEnabler = true;
        break;
      }
    }
    if (!chosen) return;
    g.pay(cost, 'ability');
    chosen.eot.canAttack = true;
    chosen.eot.drawOnHit = true;
    chosen.eot.power += 1;
    if (needsEnabler && !makeUnblockable(g, chosen)) g.say(`couldn't make ${g.name(chosen)} unblockable`);
    if (g.isTable) chosen.attackTarget = target ?? g.alive().sort((a, b) => b.life - a.life)[0] ?? null;
    g.say(`Pride ability on ${g.name(chosen)} (toughness ${g.toughness(chosen)})`);
  }
}

/** Ways to let a defender attack this turn, cheapest first: {G} Assault Formation, {2}→{1} Walking Bulwark, the Pride. */
function enablers(g: Game): { cost: ManaCost; butt: boolean; haste: boolean; kind: string; source: Perm }[] {
  const out: { cost: ManaCost; butt: boolean; haste: boolean; kind: string; source: Perm }[] = [];
  for (const p of g.bf) {
    if (p.token) continue;
    const d = g.def(p.def);
    if (d.defenderCanAttack && !d.grantToughnessDraw) {
      out.push({ cost: g.abilityCost(d.defenderCanAttack.cost, d.defenderCanAttack.creatureAbility), butt: d.defenderCanAttack.butt, haste: d.defenderCanAttack.haste, kind: d.name, source: p });
    }
  }
  return out.sort((a, b) => a.cost.mv - b.cost.mv);
}

/** Leftover mana: let high-toughness walls attack (damage = toughness with Bulwark / Formation / Tortoise). */
function wallsAttack(g: Game) {
  const en = enablers(g);
  if (!en.length) return;
  const walls = g
    .creatures()
    .filter((p) => g.defender(p) && !p.eot.canAttack && g.readyToAttack(p) && !(p.token === null && g.def(p.def).sourceKind === 'dork'))
    .sort((a, b) => g.toughness(b) - g.toughness(a));
  for (const w of walls) {
    if (g.over()) return;
    const e = en.find((x) => g.canPay(x.cost, 'ability'));
    if (!e) return;
    const dmgIfEnabled = e.butt || g.assignsToughness(w) ? g.toughness(w) : g.power(w);
    if (dmgIfEnabled <= 0) continue;
    // Against blockers, a wall only attacks where it gets through (and it won't be home to block).
    const open = g.alive().filter((o) => g.connects(w, o));
    if (g.isTable && !open.length) continue;
    if (g.isTable) w.attackTarget = open.sort((a, b) => a.life - b.life)[0];
    g.pay(e.cost, 'ability');
    w.eot.canAttack = true;
    if (e.butt) w.eot.butt = true;
    if (e.haste) w.eot.haste = true;
    g.say(`${e.kind} lets ${g.name(w)} attack (${dmgIfEnabled} damage)`);
  }
}

interface Attacker {
  perm: Perm;
  cost: ManaCost;
  damage: number;
  apply: () => void;
}

/** Triumph of the Hordes turn: is the poison lethal against all three opponents with the mana we have? */
export function triumphPlan(g: Game, s: StrategySettings) {
  const triumph = g.hand.find((i) => g.def(i).massInfect);
  if (triumph === undefined) return null;
  const tower = s.useTowerDefense ? g.hand.find((i) => g.def(i).teamToughnessPump && !g.def(i).teamToughnessPump!.cost) : undefined;
  const triumphDef = g.def(triumph);
  const bonusP = triumphDef.teamPumpEot?.power ?? 1;
  const bonusT = triumphDef.teamPumpEot?.toughness ?? 1;
  const total = g.manaAvailable('ability');
  const spellCost = triumphDef.mv + (tower !== undefined ? g.def(tower).mv : 0);
  if (!g.canPay(triumphDef.cost, 'hand')) return null;

  const prideCost = prideAbilityCost(g);
  const en = enablers(g);
  const towerT = tower !== undefined ? g.def(tower).teamToughnessPump!.amount : 0;
  const attackers: Attacker[] = [];
  for (const p of g.creatures()) {
    if (!g.readyToAttack(p) || (p.token === null && g.def(p.def).sourceKind === 'dork')) continue; // mana creatures stay home
    const dmgWith = (butt: boolean) => (butt || g.assignsToughness(p) ? g.toughness(p) + bonusT + towerT : g.power(p) + bonusP);
    if (!g.defender(p)) {
      attackers.push({ perm: p, cost: NO_COST, damage: dmgWith(false), apply: () => {} });
      continue;
    }
    const opts: Attacker[] = [];
    for (const e of en) opts.push({ perm: p, cost: e.cost, damage: dmgWith(e.butt), apply: () => { p.eot.canAttack = true; if (e.butt) p.eot.butt = true; if (e.haste) p.eot.haste = true; } });
    if (prideCost && !g.shroud(p)) opts.push({ perm: p, cost: prideCost, damage: dmgWith(false) + 1, apply: () => { p.eot.canAttack = true; p.eot.power += 1; } });
    if (!opts.length) continue;
    attackers.push(opts.sort((a, b) => a.cost.mv - b.cost.mv || b.damage - a.damage)[0]);
  }
  // Karn's Bastion-style proliferate after combat finishes anyone at 9.
  const prolif = g.onBattlefield((d, p) => !!d.proliferate && !p.tapped)[0];
  let budget = total - spellCost;
  const useProlif = prolif && budget - g.def(prolif.def).proliferate!.mv >= 0;
  const need = (o: Opponent) => Math.max(0, 10 - o.poison - (useProlif ? 1 : 0));
  if (useProlif) budget -= g.def(prolif.def).proliferate!.mv;

  // Veil of Summer first when an opponent could counter Triumph.
  const veil = g.opponentsMayCounter() ? g.hand.find((i) => g.def(i).protectionKind === 'uncounterable') : undefined;
  if (veil !== undefined) budget -= g.def(veil).mv;

  const remaining = [...attackers].sort((a, b) => b.damage - a.damage);
  const plan: { a: Attacker; target: Opponent }[] = [];
  for (const o of [...g.alive()].sort((a, b) => need(b) - need(a))) {
    let n = need(o);
    // Triumph grants trample: each of their untapped blockers soaks its toughness from one attacker.
    const blockers = (o.creatures ?? []).filter((b) => !b.tapped).map((b) => ({ ...b })).sort((a, b) => b.toughness - a.toughness);
    while (n > 0) {
      const affordable = remaining.filter((a) => a.cost.mv <= budget && a.damage > 0);
      if (!affordable.length) return null;
      // Free attackers first, then the most damage per mana.
      const a = affordable.sort((x, y) => (x.cost.mv === 0 ? -1 : 0) - (y.cost.mv === 0 ? -1 : 0) || y.damage / Math.max(1, y.cost.mv) - x.damage / Math.max(1, x.cost.mv))[0];
      remaining.splice(remaining.indexOf(a), 1);
      budget -= a.cost.mv;
      const bi = blockers.findIndex((b) => g.canBlock(a.perm, b));
      const soak = bi >= 0 ? blockers.splice(bi, 1)[0].toughness : 0;
      n -= Math.max(0, a.damage - soak);
      plan.push({ a, target: o });
    }
  }
  return { triumph, tower, veil, plan, prolif: useProlif ? prolif : null };
}

function tryTriumph(g: Game, s: StrategySettings): boolean {
  // The win turn spends everything, including mana held for protection.
  const reserve = g.reserve;
  g.reserve = 0;
  const plan = triumphPlan(g, s);
  if (!plan) {
    g.reserve = reserve;
    return false;
  }
  if (plan.veil !== undefined) g.cast(plan.veil);
  // Enablers first (they can use ability-only mana), then the spells.
  for (const { a } of plan.plan) {
    if (a.cost.mv && !g.pay(a.cost, 'ability')) {
      g.say(`couldn't pay to attack with ${g.name(a.perm)}`);
      continue;
    }
    a.apply();
  }
  if (g.cast(plan.triumph) === false) return false;
  if (plan.tower !== undefined) g.cast(plan.tower);
  if (!g.team.infect) return true; // Triumph was countered: no poison alpha strike this turn
  g.combat(plan.plan.filter(({ a }) => g.canAttack(a.perm)).map(({ a, target }) => ({ perm: a.perm, target })));
  if (!g.over() && plan.prolif) {
    const d = g.def(plan.prolif.def);
    if (g.pay(d.proliferate!, 'ability')) {
      plan.prolif.tapped = true;
      g.say(`${d.name}: proliferate`);
      for (const o of g.alive()) if (o.poison > 0) g.addPoison(o, 1);
    }
  }
  return true;
}

/** Sacrifice a big wall to a Geralf-style effect for one X/X flier (only when Triumph isn't available). */
function geralf(g: Game) {
  if (g.hand.some((i) => g.def(i).massInfect)) return;
  for (const src of g.onBattlefield((d, p) => !!d.sacForToken && !p.tapped && !p.sick)) {
    const fodder = g
      .creatures()
      .filter((p) => !p.token && p.id !== src.id && !p.commander && g.def(p.def).sourceKind !== 'dork' && !g.def(p.def).handSizePT)
      .sort((a, b) => g.toughness(b) - g.toughness(a))[0];
    if (!fodder || g.toughness(fodder) < 6) return;
    const d = g.def(src.def);
    if (!g.pay(d.sacForToken!.cost, 'ability')) return;
    src.tapped = true;
    const x = g.toughness(fodder);
    g.bf.splice(g.bf.indexOf(fodder), 1);
    g.gy.push(fodder.def);
    g.makeToken(x, x, d.sacForToken!.flying, `${d.name} Zombie`);
    g.say(`${d.name}: sacrifice ${g.def(fodder.def).name} for one ${x}/${x} flier`);
  }
}
