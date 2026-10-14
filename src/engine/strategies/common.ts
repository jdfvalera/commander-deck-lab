// Building blocks both strategies use: land drops, ramp, draw, threats, equipment, activations.
import type { Color } from '../../data/types';
import type { CardDef } from '../cards';
import type { Game, Opponent, Perm } from '../game';

export function playLand(g: Game, preferColors: Color[] = []): boolean {
  if (g.landPlayed) return false;
  const lands = g.hand.filter((i) => g.def(i).types.land);
  if (!lands.length) return false;
  const have = new Set(g.lands().flatMap((p) => g.def(p.def).produces));
  const untapped = (d: CardDef) => d.entersTapped === 'no' || (d.entersTapped === 'conditional' && g.lands().length >= 2);
  const score = (i: number) => {
    const d = g.def(i);
    let s = 0;
    if (untapped(d)) s += 10;
    s += d.produces.filter((c) => preferColors.includes(c) && !have.has(c)).length * 5;
    s += d.produces.length;
    if (d.fetchesBasic) s -= 3; // fetches enter tapped
    return s;
  };
  const pick = lands.sort((a, b) => score(b) - score(a))[0];
  g.hand.splice(g.hand.indexOf(pick), 1);
  g.landPlayed = true;
  g.enter(pick);
  g.say(`play ${g.def(pick).name}`);
  return true;
}

export function isRamp(d: CardDef): boolean {
  return !d.types.land && (d.sourceKind === 'rock' || d.sourceKind === 'dork' || d.sourceKind === 'aura' || d.rampLands > 0);
}

/** Casts cards matching `pick` while affordable, in the order `score` says (highest first). */
export function castWhile(g: Game, pick: (d: CardDef, i: number) => boolean, score: (d: CardDef) => number, after?: (p: Perm | null, d: CardDef) => void): number {
  let n = 0;
  for (let guard = 0; guard < 30; guard++) {
    const options = [...new Set(g.hand)].filter((i) => pick(g.def(i), i) && hasAuraTarget(g, g.def(i)) && g.canPay(g.castCost(i), 'hand')).sort((a, b) => score(g.def(b)) - score(g.def(a)));
    if (!options.length || g.over()) return n;
    const i = options[0];
    const p = g.cast(i);
    if (p === false) return n;
    after?.(p, g.def(i));
    n++;
  }
  return n;
}

/** An aura can only be cast with something legal to enchant (Utopia Sprawl needs an unenchanted Forest). */
export function hasAuraTarget(g: Game, d: CardDef): boolean {
  if (!d.types.aura) return true;
  if (d.sourceKind === 'aura') {
    const free = g.lands().filter((l) => !g.bf.some((a) => a.attachedTo === l.id));
    return /forest/i.test(d.oracleHint) ? free.some((l) => /Forest/.test(g.def(l.def).subtypes) || g.name(l) === 'Forest') : free.length > 0;
  }
  return g.creatures().length > 0;
}

export function castRamp(g: Game): number {
  return castWhile(g, (d) => isRamp(d), (d) => -d.mv + d.rampAmount, (p, d) => attachIfNeeded(g, p, d));
}

/** Casts the commander from the command zone if affordable. */
export function castCommander(g: Game): boolean {
  for (const c of [...g.commandZone]) {
    if (g.canPay(g.castCost(c, true), 'commander')) {
      g.cast(c, { fromCommandZone: true });
      return true;
    }
  }
  return false;
}

export function castDraw(g: Game, minLibrary = 0): number {
  return castWhile(
    g,
    (d) => !!d.draw && !isRamp(d) && !d.interaction && !d.protection && !d.types.land && (!d.draw.x || g.manaAvailable('hand') > d.mv) && g.lib.length - (d.draw.onCast || 3) >= minLibrary,
    (d) => ((d.draw!.onCast || 0) + d.draw!.perTurn * 3 + (d.draw!.activated ? 2 : 0)) / Math.max(1, d.mv),
  );
}

/** Auras attach to the creature that benefits most; land auras just sit on a land. */
export function attachIfNeeded(g: Game, p: Perm | null, d: CardDef, prefer?: (q: Perm) => number) {
  if (!p || !d.types.aura) return;
  if (d.sourceKind === 'aura') {
    // Land auras go on a land without one; "Enchant Forest" (Utopia Sprawl) needs a Forest.
    const lands = g.lands().filter((l) => !g.bf.some((a) => a.attachedTo === l.id));
    const needsForest = /forest/i.test(d.oracleHint);
    const land = lands.find((l) => /Forest/.test(g.def(l.def).subtypes) || g.name(l) === 'Forest') ?? (needsForest ? undefined : lands[0]);
    if (land) {
      p.attachedTo = land.id;
      g.say(`${d.name} on ${g.name(land)}`);
    }
    return;
  }
  const targets = g.creatures().filter((q) => q.id !== p.id);
  if (!targets.length) return;
  const score = prefer ?? ((q: Perm) => g.toughness(q) + g.power(q));
  p.attachedTo = targets.sort((a, b) => score(b) - score(a))[0].id;
  g.say(`${d.name} on ${g.name(g.bf.find((q) => q.id === p.attachedTo)!)}`);
}

/** Attaches equipment that's not on anything yet. */
export function equip(g: Game, choose: (eq: Perm) => Perm | null) {
  for (const eq of g.onBattlefield((d) => !!d.equipment)) {
    if (eq.attachedTo && g.bf.some((p) => p.id === eq.attachedTo)) continue;
    const target = choose(eq);
    if (!target) continue;
    const cost = { generic: g.def(eq.def).equipment!.equip, pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hybrid: [], x: 0, mv: 0 };
    if (!g.pay(cost, 'ability')) continue;
    eq.attachedTo = target.id;
    g.say(`equip ${g.name(eq)} to ${g.name(target)}`);
  }
}

/**
 * Once-a-turn activated draws (Arcane Encyclopedia) and custom activated effects, while mana allows.
 * Never draws below `minLibrary`. Abilities that sacrifice another permanent are left to the user.
 */
export function activateAbilities(g: Game, keep = 0, minLibrary = 0) {
  for (const p of [...g.bf]) {
    if (p.token || g.over()) continue;
    const d = g.def(p.def);
    const a = d.draw?.activated;
    const canTap = !a?.tap || (!p.tapped && (!p.sick || !d.types.creature));
    const libOk = a && g.lib.length - a.n * (g.has((x) => x.drawDoubler) ? 2 : 1) >= minLibrary;
    // "Sacrifice another …" costs: only with cheap fodder (tokens, 0/2s), never the commander or a combo piece.
    const fodder = a?.sacrifice === 'other' ? g.fodder(a.sacrificeWhat, p) : [];
    if (a && fodder && canTap && libOk && !p.usedThisTurn.has('draw') && g.manaAvailable('ability') - a.cost >= keep) {
      const cost = { generic: a.cost, pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hybrid: [], x: 0, mv: a.cost };
      // Paying with the source itself would tap it before its own {T} cost: keep it out of the payment.
      if (g.pay(cost, 'ability', { avoidPerms: a.tap ? new Set([p.id]) : undefined })) {
        if (a.tap) p.tapped = true;
        p.usedThisTurn.add('draw');
        for (const f of fodder) {
          g.say(`sacrifice ${g.name(f)}`);
          g.destroy(f);
        }
        g.draw(a.n, `activate ${d.name}`);
        if (a.discard) g.discardWorst(a.discard);
        if (a.sacrifice === 'self') {
          g.bf.splice(g.bf.indexOf(p), 1);
          g.gy.push(p.def);
          g.say(`sacrifice ${d.name}`);
        }
      }
    }
    d.custom.forEach((c, k) => {
      if (c.when !== 'activated' || g.over()) return;
      const key = `custom${k}`;
      if (p.usedThisTurn.has(key) && (c.oncePerTurn || c.tap)) return;
      if (c.tap && (p.tapped || (p.sick && d.types.creature))) return;
      if (c.effect === 'add_mana') return; // mana abilities are used when paying, below
      if (g.manaAvailable('ability') - c.cost.mv < keep || !g.pay(c.cost, 'ability')) return;
      if (c.tap) p.tapped = true;
      p.usedThisTurn.add(key);
      g.customEffect(p, c);
    });
  }
}

/**
 * Attacks with every creature that can, each at the opponent closest to dying that it can get through to.
 * Against real blockers (matchups), a creature that would only bounce off a blocker stays home to defend.
 */
export function attackAll(g: Game, filter: (p: Perm) => boolean = () => true) {
  const attackers = g.creatures().filter((p) => g.canAttack(p) && filter(p) && g.combatDamage(p) > 0);
  const plan: { perm: Perm; target: Opponent }[] = [];
  const pending = new Map<Opponent, number>();
  for (const p of attackers.sort((a, b) => g.combatDamage(b) - g.combatDamage(a))) {
    const remaining = (o: Opponent) => (g.team.infect ? 10 - o.poison : o.life) - (pending.get(o) ?? 0);
    const alive = g.alive().filter((o) => remaining(o) > 0);
    if (!alive.length) break;
    let target: Opponent | undefined = p.attackTarget && alive.includes(p.attackTarget) ? p.attackTarget : undefined;
    if (!target) {
      const open = alive.filter((o) => g.connects(p, o)).sort((a, b) => remaining(a) - remaining(b));
      target = open[0];
      // Nothing gets through: only big creatures that survive a block still swing.
      if (!target && (g.toughness(p) >= 8 || g.team.infect)) {
        const blockers = (o: Opponent) => (o.creatures ?? []).filter((b) => g.canBlock(p, b)).length;
        target = [...alive].sort((a, b) => blockers(a) - blockers(b))[0];
      }
    }
    if (!target) continue;
    pending.set(target, (pending.get(target) ?? 0) + g.combatDamage(p));
    plan.push({ perm: p, target });
  }
  g.combat(plan);
}

/**
 * Makes a creature unblockable this turn with something on the battlefield (Key to the City, Rogue's
 * Passage, Access/Escape Tunnel, Suspicious Bookcase, Prowler's Helm), cheapest first. Returns true on success.
 */
export function makeUnblockable(g: Game, p: Perm, opts: { dryRun?: boolean } = {}): boolean {
  // Mistford River Turtle: "whenever this attacks, another target attacking non-Human creature can't be blocked".
  if (!(!p.token && /\bHuman\b/.test(g.def(p.def).subtypes))) {
    const turtle = g.onBattlefield((d, q) => d.unblockableEnabler?.kind === 'attack_trigger' && q !== p && !q.usedThisTurn.has('trigger') && g.canAttack(q))[0];
    if (turtle) {
      if (opts.dryRun) return true;
      turtle.usedThisTurn.add('trigger');
      turtle.attackTarget = g.alive().sort((a, b) => b.life - a.life)[0] ?? null; // it has to attack for the trigger
      p.eot.unblockable = true;
      g.say(`${g.name(turtle)} attacks too, making ${g.name(p)} unblockable`);
      return true;
    }
  }
  const sources = g
    .onBattlefield((d, q) => !!d.unblockableEnabler && d.unblockableEnabler.kind !== 'attack_trigger' && (!d.unblockableEnabler.tap || (!q.tapped && !(d.types.creature && q.sick))))
    .sort((a, b) => g.def(a.def).unblockableEnabler!.cost.mv - g.def(b.def).unblockableEnabler!.cost.mv);
  for (const src of sources) {
    const e = g.def(src.def).unblockableEnabler!;
    if (src === p && e.tap) continue; // tapping itself would stop it attacking
    if (e.maxPower && g.power(p) > e.maxPower) continue;
    if (e.discard && !g.hand.length) continue;
    if (e.kind === 'equip') {
      const eq = g.def(src.def).equipment;
      const cost = { generic: eq?.equip ?? 2, pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hybrid: [], x: 0, mv: eq?.equip ?? 2 };
      if (src.attachedTo === p.id) return true;
      // Don't pull it off a creature that's already counting on it this turn.
      const holder = src.attachedTo ? g.bf.find((q) => q.id === src.attachedTo) : undefined;
      if (holder && (holder.eot.drawOnHit || holder.eot.canAttack)) continue;
      if (!g.canPay(cost, 'ability')) continue;
      if (opts.dryRun) return true;
      g.pay(cost, 'ability');
      src.attachedTo = p.id;
      g.say(`equip ${g.name(src)} to ${g.name(p)}`);
      return true;
    }
    if (!g.canPay(e.cost, 'ability', e.tap ? new Set([src.id]) : undefined)) continue;
    if (opts.dryRun) return true;
    g.pay(e.cost, 'ability', { avoidPerms: e.tap ? new Set([src.id]) : undefined });
    if (e.tap) src.tapped = true;
    if (e.discard) g.discardWorst(1);
    if (e.sacrifice) g.destroy(src);
    p.eot.unblockable = true;
    g.say(`${g.name(src)} makes ${g.name(p)} unblockable`);
    return true;
  }
  return false;
}
