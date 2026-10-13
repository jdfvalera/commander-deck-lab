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
    const options = [...new Set(g.hand)].filter((i) => pick(g.def(i), i) && g.canPay(g.castCost(i), 'hand')).sort((a, b) => score(g.def(b)) - score(g.def(a)));
    if (!options.length || g.over()) return n;
    const i = options[0];
    const p = g.cast(i);
    if (p === false) return n;
    after?.(p, g.def(i));
    n++;
  }
  return n;
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
  if (!p || !d.types.aura || d.sourceKind === 'aura') return;
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
    if (a && a.sacrifice !== 'other' && canTap && libOk && !p.usedThisTurn.has('draw') && g.manaAvailable('ability') - a.cost >= keep) {
      const cost = { generic: a.cost, pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hybrid: [], x: 0, mv: a.cost };
      // Paying with the source itself would tap it before its own {T} cost: keep it out of the payment.
      if (g.pay(cost, 'ability', { avoidPerms: a.tap ? new Set([p.id]) : undefined })) {
        if (a.tap) p.tapped = true;
        p.usedThisTurn.add('draw');
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

/** Attacks with every creature that can, each at the opponent closest to dying. */
export function attackAll(g: Game, filter: (p: Perm) => boolean = () => true) {
  const attackers = g.creatures().filter((p) => g.canAttack(p) && filter(p) && g.combatDamage(p) > 0);
  const plan: { perm: Perm; target: Opponent }[] = [];
  const pending = new Map<Opponent, number>();
  for (const p of attackers.sort((a, b) => g.combatDamage(b) - g.combatDamage(a))) {
    const alive = g.alive().filter((o) => (g.team.infect ? 10 - o.poison : o.life) - (pending.get(o) ?? 0) > 0);
    if (!alive.length) break;
    const remaining = (o: Opponent) => (g.team.infect ? 10 - o.poison : o.life) - (pending.get(o) ?? 0);
    const target = alive.sort((a, b) => remaining(a) - remaining(b))[0];
    pending.set(target, (pending.get(target) ?? 0) + g.combatDamage(p));
    plan.push({ perm: p, target });
  }
  g.combat(plan);
}
