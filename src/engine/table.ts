// The matchup simulator: your deck card by card (same strategies as the goldfish) against three
// opponents played from profiles. Opponents are approximations: they put real creatures from their
// decklist onto the board along their measured curve, hold abstract interaction cards drawn at their
// deck's real counts, attack each other as well as you, and block your attackers.

import { Game, type GameSettings, type OppCreature, type Opponent, type Perm, type WinType } from './game';
import type { CompiledDeck } from './cards';
import { deriveSeed, shuffle } from './rng';
import { chooseBottom, handOk, DEFAULT_RULES, type KeepRules } from './mulligan';
import { strategyById } from './goldfish';
import { defaults, type StrategySettings } from './strategies/types';
import type { InteractionSpec, OpponentProfile } from '../opponents/profile';

/** An opponent's card, reduced to the one thing the model tracks: what kind of interaction it is. */
type Card = { k: 'wipe' | 'removal' | 'counter' | 'aetherize' | 'tax' | 'blank'; spec: InteractionSpec };
const BLANK: Card = { k: 'blank', spec: { name: '', kind: 'blank' } };

interface OppState {
  o: Opponent & { creatures: OppCreature[] };
  p: OpponentProfile;
  lib: Card[];
  hand: Card[];
  tax: number;
  drawAcc: number;
  rng: () => number;
}

export interface TableSettings {
  games: number;
  maxTurns: number;
  seed: number;
  drawOnTurnOne: boolean;
  strategy: string;
  settings: StrategySettings;
  rules: KeepRules;
  combos: { cards: string[]; manaNeeded: number; label: string }[];
  comboWins: boolean;
  /** Keep mana open for your best instant-speed protection. */
  holdProtection: boolean;
}

export type LossReason = 'fliers' | 'ground' | 'decked' | 'timeout' | 'other';

export interface TableStats {
  commanderRemoved: number;
  wipesFaced: number;
  removalFaced: number;
  triumphCast: number;
  triumphCountered: number;
  spellsCountered: number;
  aetherized: number;
  protectionUsed: Record<string, number>;
  damageFliers: number;
  damageGround: number;
}

const DAMAGE_X = 5; // "X" damage / -X/-X wipes when the card doesn't fix X

export class TableGame extends Game {
  os: OppState[];
  myLife = 40;
  stats: TableStats = { commanderRemoved: 0, wipesFaced: 0, removalFaced: 0, triumphCast: 0, triumphCountered: 0, spellsCountered: 0, aetherized: 0, protectionUsed: {}, damageFliers: 0, damageGround: 0 };

  constructor(deck: CompiledDeck, seed: number, settings: GameSettings, profiles: OpponentProfile[], order?: number[]) {
    super(deck, seed, settings, order);
    this.os = profiles.map((p, i) => {
      const rng = (() => {
        let a = deriveSeed(seed, 1000 + i);
        return () => {
          a = (a + 0x6d2b79f5) >>> 0;
          let t = a;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const lib: Card[] = [
        ...p.wipes.map((spec) => ({ k: 'wipe' as const, spec })),
        ...p.removal.map((spec) => ({ k: 'removal' as const, spec })),
        ...p.counters.map((spec) => ({ k: 'counter' as const, spec })),
        ...p.aetherize.map((spec) => ({ k: 'aetherize' as const, spec })),
        ...p.taxes.map((spec) => ({ k: 'tax' as const, spec })),
      ];
      while (lib.length < 99) lib.push(BLANK);
      shuffle(lib, rng);
      const o = { life: 40, poison: 0, creatures: [] as OppCreature[] };
      return { o, p, lib, hand: lib.splice(0, 7), tax: 0, drawAcc: 0, rng };
    });
    this.opps = this.os.map((x) => x.o);
  }

  private state(o: Opponent): OppState {
    return this.os.find((x) => x.o === o)!;
  }

  override opponentsMayCounter(): boolean {
    return this.os.some((x) => x.o.life > 0 && x.o.poison < 10 && x.p.counters.length > 0);
  }

  // ---------------- your protection ----------------
  private heldProtection(kind: (d: ReturnType<Game['def']>) => boolean): number | undefined {
    return this.hand.find((i) => kind(this.def(i)) && this.canPay(this.def(i).cost, 'hand', undefined, true));
  }
  private useCard(i: number, why: string) {
    const d = this.def(i);
    this.pay(d.cost, 'hand', { ignoreReserve: true });
    this.hand.splice(this.hand.indexOf(i), 1);
    this.gy.push(i);
    this.stats.protectionUsed[d.name] = (this.stats.protectionUsed[d.name] ?? 0) + 1;
    this.say(`${d.name}: ${why}`);
  }
  /** Mana to keep open on your turn: enough for the best protection you're holding. */
  setReserve(on: boolean) {
    if (!on) return void (this.reserve = 0);
    const options = this.hand.map((i) => this.def(i)).filter((d) => d.counterspell || d.protectionKind === 'team_hexproof_indestructible' || d.protectionKind === 'single_hexproof_indestructible');
    const best = options.sort((a, b) => Number(!!b.counterspell) - Number(!!a.counterspell) || a.mv - b.mv)[0];
    this.reserve = best ? best.mv : 0;
  }

  // ---------------- opponents countering your spells ----------------
  protected override countered(defIdx: number, fromCommandZone: boolean): boolean {
    const d = this.def(defIdx);
    const key = fromCommandZone || d.massInfect || !!d.boardWipe || d.mv >= 6 || this.s.combos.some((c) => c.cards.includes(defIdx));
    if (!key) return false;
    if (d.massInfect) this.stats.triumphCast++;
    if (this.uncounterableTurn === this.turn) return false;
    for (const st of this.liveOpps()) {
      const c = st.hand.find((x) => x.k === 'counter' && fits(x.spec.scope ?? 'any', d));
      if (!c || st.rng() > st.p.interactionRate) continue;
      // Counter war: answer their counterspell with yours.
      const mine = this.heldProtection((x) => !!x.counterspell && ['any', 'instant', 'instant_sorcery', 'noncreature'].includes(x.counterspell.scope));
      st.hand.splice(st.hand.indexOf(c), 1);
      if (mine !== undefined) {
        this.useCard(mine, `counters ${st.p.name}'s ${c.spec.name}`);
        return false;
      }
      this.say(`${st.p.name} counters ${d.name} with ${c.spec.name}`);
      this.stats.spellsCountered++;
      if (d.massInfect) this.stats.triumphCountered++;
      return true;
    }
    return false;
  }

  // ---------------- your attacks ----------------
  protected override beforeDamage(attacks: { perm: Perm; target: Opponent }[]) {
    // Attack taxes (Propaganda, Archangel of Tithes): pay per attacker or don't attack that player.
    const kept: typeof attacks = [];
    for (const a of attacks) {
      const st = this.state(a.target);
      if (st.tax && !this.pay({ generic: st.tax, pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hybrid: [], x: 0, mv: st.tax }, 'ability', { ignoreReserve: true })) {
        this.say(`can't pay ${st.p.name}'s attack tax for ${this.name(a.perm)}`);
        continue;
      }
      kept.push(a);
    }
    // Aetherize: an opponent being attacked bounces every attacker when it matters.
    const big = kept.length >= 3 || this.team.infect;
    for (const st of new Set(kept.map((a) => this.state(a.target)))) {
      const aeth = st.hand.find((x) => x.k === 'aetherize');
      if (!aeth || !big || st.rng() > st.p.interactionRate) continue;
      st.hand.splice(st.hand.indexOf(aeth), 1);
      this.stats.aetherized++;
      this.say(`${st.p.name}: ${aeth.spec.name} returns all attackers`);
      for (const a of kept) this.destroy(a.perm, 'hand');
      return [];
    }
    return kept;
  }

  /** Opponent blocks: deny the Pride's draws and lethal poison first, otherwise block when the blocker survives or trades. */
  protected override declareBlocks(attacks: { perm: Perm; target: Opponent }[]) {
    const blocks = new Map<Perm, OppCreature | null>();
    const byTarget = new Map<Opponent, Perm[]>();
    for (const a of attacks) byTarget.set(a.target, [...(byTarget.get(a.target) ?? []), a.perm]);
    for (const [o, perms] of byTarget) {
      const pool = (o.creatures ?? []).filter((c) => !c.tapped);
      const incoming = perms.reduce((s, p) => s + this.combatDamage(p), 0);
      const lethal = this.team.infect ? incoming >= 10 - o.poison : incoming >= o.life;
      const danger = (p: Perm) => (p.eot.drawOnHit ? 100 + this.toughness(p) : 0) + this.combatDamage(p);
      for (const p of [...perms].sort((a, b) => danger(b) - danger(a))) {
        const dmg = this.combatDamage(p);
        const options = pool.filter((b) => this.canBlock(p, b));
        if (!options.length) continue;
        const survive = options.filter((b) => b.toughness > dmg).sort((a, b) => a.power - b.power);
        const kills = options.filter((b) => b.power >= this.toughness(p));
        const chumpWorth = lethal || (p.eot.drawOnHit && this.toughness(p) >= 4) || dmg >= 6;
        const pick = survive[0] ?? kills[0] ?? (chumpWorth ? options.sort((a, b) => a.power + a.toughness - (b.power + b.toughness))[0] : undefined);
        if (!pick) continue;
        pool.splice(pool.indexOf(pick), 1);
        blocks.set(p, pick);
      }
    }
    return blocks;
  }

  protected override afterCombat() {
    for (const st of this.os) st.o.creatures = st.o.creatures.filter((c) => c.toughness > 0);
    for (const p of [...this.bf]) {
      if (!this.isCreature(p) || p.damage <= 0) continue;
      if (!p.token && this.def(p.def).keywords.indestructible) continue;
      if (p.damage >= this.toughness(p)) {
        this.say(`${this.name(p)} dies in combat`);
        this.destroy(p);
      }
    }
  }

  // ---------------- opponents' turns ----------------
  liveOpps(): OppState[] {
    return this.os.filter((x) => x.o.life > 0 && x.o.poison < 10);
  }
  private myCreatures(): Perm[] {
    return this.creatures();
  }
  /** How threatening you look to the table: offense on board, poison dealt, a little for the commander. */
  private myThreat(): number {
    const poison = this.opps.reduce((a, o) => a + o.poison, 0);
    const power = this.creatures().reduce((a, p) => a + Math.max(0, this.power(p)), 0);
    return 1 + poison / 6 + (this.bf.some((p) => p.commander) ? 0.3 : 0) + power / 20;
  }

  override endTurn(maxHand = 7) {
    super.endTurn(maxHand);
    const cur = this.logs[this.logs.length - 1];
    if (cur) cur.opponents = `you ${this.myLife} · ` + cur.opponents;
  }

  opponentTurn(st: OppState) {
    const { o, p } = st;
    for (const c of o.creatures) {
      c.tapped = false;
      c.sick = false;
    }
    // Draw (plus any card advantage the deck has).
    st.drawAcc += 1 + p.extraDraw;
    while (st.drawAcc >= 1 && st.lib.length) {
      st.hand.push(st.lib.shift()!);
      st.drawAcc -= 1;
    }
    for (const c of st.hand.filter((x) => x.k === 'tax')) {
      st.tax = Math.max(st.tax, c.spec.per ?? 2);
      st.hand.splice(st.hand.indexOf(c), 1);
      this.say(`${p.name} plays ${c.spec.name}`);
    }
    this.develop(st);
    this.maybeWipe(st);
    if (this.over()) return;
    this.maybeRemove(st);
    if (this.over()) return;
    this.attack(st);
  }

  /** Grow the board along their measured curve, casting real creatures from their list. */
  private develop(st: OppState) {
    const t = this.turn;
    const curve = st.p.powerCurve;
    const delta = Math.max(0, ((curve[Math.min(t, curve.length) - 1] ?? 0) - (t > 1 ? curve[Math.min(t - 1, curve.length) - 1] : 0)) * st.p.curveScale);
    const castable = st.p.creatures.filter((c) => c.mv <= Math.min(t + 1, 8));
    if (!castable.length || delta <= 0) return;
    const total = castable.reduce((a, c) => a + c.count, 0);
    let added = 0;
    for (let n = 0; n < 4 && added < delta; n++) {
      let r = st.rng() * total;
      const pick = castable.find((c) => (r -= c.count) < 0) ?? castable[0];
      st.o.creatures.push({ name: pick.name, power: pick.power, toughness: pick.toughness, flying: pick.flying, reach: pick.reach, trample: pick.trample, unblockable: pick.unblockable, defender: pick.defender, tapped: false, sick: true });
      added += Math.max(1, pick.power);
    }
  }

  private boardScore(cs: { power: number; toughness: number }[]) {
    return cs.reduce((a, c) => a + c.power + c.toughness / 2, 0);
  }

  private maybeWipe(st: OppState) {
    const w = st.hand.find((x) => x.k === 'wipe');
    if (!w) return;
    const mine = this.myCreatures();
    const myScore = mine.reduce((a, c) => a + Math.max(0, this.power(c)) + Math.max(0, this.toughness(c)) / 2, 0);
    const theirs = this.boardScore(st.o.creatures);
    const others = Math.max(0, ...this.liveOpps().filter((x) => x !== st).map((x) => this.boardScore(x.o.creatures)));
    const triggered = (mine.length >= st.p.wipeAt && myScore > theirs * 1.2) || (others > theirs * 2 && others > 20);
    if (!triggered || st.rng() > st.p.interactionRate) return;
    st.hand.splice(st.hand.indexOf(w), 1);
    this.resolveWipe(st, w.spec);
  }

  private resolveWipe(st: OppState, w: InteractionSpec) {
    this.stats.wipesFaced++;
    this.say(`${st.p.name} casts ${w.name}`);
    // Your answers: a counterspell, else team protection (stops destroy and damage).
    const counter = this.heldProtection((d) => !!d.counterspell && ['any', 'noncreature', 'instant_sorcery'].includes(d.counterspell.scope) && !(d.counterspell.soft && st.rng() < 0.5));
    if (counter !== undefined) return this.useCard(counter, `counters ${w.name}`);
    const protects = w.kind === 'destroy' || w.kind === 'damage' || w.kind === 'toughness_le';
    const team = protects ? this.heldProtection((d) => d.protectionKind === 'team_hexproof_indestructible') : undefined;
    if (team !== undefined) this.useCard(team, `saves your board from ${w.name}`);
    const x = w.x || DAMAGE_X;
    const dies = (p: Perm): boolean => {
      const isC = this.isCreature(p);
      const d = p.token ? null : this.def(p.def);
      if (w.kind === 'sacrifice_colored') return !!d && !d.types.land && d.cost.mv > 0 && Object.values(d.cost.pips).some((v) => v > 0);
      if (!isC) return w.kind === 'destroy' && !!w.artifacts && !!d && !d.types.land && (d.types.artifact || d.types.enchantment);
      if (team !== undefined) return false;
      if (w.kind === 'destroy') return !d?.keywords.indestructible;
      if (w.kind === 'exile' || w.kind === 'bounce') return true;
      if (w.kind === 'minus') return this.toughness(p) <= x;
      if (w.kind === 'toughness_le') return this.toughness(p) <= x;
      if (w.kind === 'damage') return this.toughness(p) <= x && !d?.keywords.indestructible;
      return false;
    };
    // Ancient Adamantoise takes all damage dealt to your other permanents.
    const redirect = w.kind === 'damage' ? this.bf.find((p) => !p.token && this.def(p.def).damageRedirect) : undefined;
    let victims = this.bf.filter(dies);
    if (redirect && team === undefined) {
      const total = victims.filter((p) => p !== redirect).length * x + x;
      redirect.damage += total;
      victims = redirect.damage >= this.toughness(redirect) ? [redirect] : [];
    }
    for (const p of victims) {
      if (p.commander) this.stats.commanderRemoved++;
      this.destroy(p, w.kind === 'bounce' ? 'hand' : 'graveyard');
    }
    if (victims.length) this.say(`${w.name}: you lose ${victims.length} permanent${victims.length === 1 ? '' : 's'}`);
    // Everyone else's board, unless it's one-sided.
    for (const other of this.os) {
      if (w.oneSided && other === st) continue;
      other.o.creatures = other.o.creatures.filter((c) => {
        if (w.kind === 'minus' || w.kind === 'toughness_le' || w.kind === 'damage') return c.toughness > x;
        return false;
      });
    }
  }

  /** Value of one of your permanents as a removal target. */
  private targetValue(p: Perm): number {
    if (p.token) return Math.max(0, this.power(p));
    const d = this.def(p.def);
    let v = Math.max(0, this.power(p)) + Math.max(0, this.toughness(p)) / 3;
    if (p.commander) v += 100;
    if (this.s.combos.some((c) => c.cards.includes(p.def))) v += 50;
    if (d.costReducerAbilities || d.drawDoubler || d.butt === 'team' || d.drawPing || d.defenderCanAttack) v += 25;
    return v;
  }

  private maybeRemove(st: OppState) {
    const r = st.hand.find((x) => x.k === 'removal');
    if (!r || st.rng() > 0.6) return;
    const scope = r.spec.scope ?? 'creature';
    const legal = this.bf.filter((p) => {
      const d = p.token ? null : this.def(p.def);
      if (d?.types.land) return false;
      if (scope === 'creature' && !this.isCreature(p)) return false;
      if (scope === 'artifact_enchantment' && !(d && (d.types.artifact || d.types.enchantment))) return false;
      if (this.shroud(p) || d?.keywords.hexproof) return false;
      return true;
    });
    const target = legal.sort((a, b) => this.targetValue(b) - this.targetValue(a))[0];
    if (!target || this.targetValue(target) < 4) return;
    const d = target.token ? null : this.def(target.def);
    // Ward and "target tax" (Esior, Charix) make them think twice.
    const tax = (d?.ward ?? 0) + this.bf.filter((x) => !x.token && this.def(x.def).targetTax && (this.def(x.def).targetTax!.scope === 'self' ? x === target : target.commander)).reduce((a, x) => a + this.def(x.def).targetTax!.amount, 0);
    if (tax && st.rng() < 0.5) return;
    st.hand.splice(st.hand.indexOf(r), 1);
    this.stats.removalFaced++;
    this.say(`${st.p.name} casts ${r.spec.name} on ${this.name(target)}`);
    // Your answers: single-target protection, then a counterspell, then team protection.
    const important = target.commander || this.targetValue(target) >= 25;
    const shell = important ? this.heldProtection((x) => x.protectionKind === 'single_hexproof_indestructible') : undefined;
    if (shell !== undefined) return this.useCard(shell, `protects ${this.name(target)}`);
    const counter = important ? this.heldProtection((x) => !!x.counterspell && ['any', 'instant', 'instant_sorcery', 'noncreature'].includes(x.counterspell.scope)) : undefined;
    if (counter !== undefined) return this.useCard(counter, `counters ${r.spec.name}`);
    const team = important && r.spec.kind !== 'exile' && r.spec.kind !== 'bounce' ? this.heldProtection((x) => x.protectionKind === 'team_hexproof_indestructible') : undefined;
    if (team !== undefined) return this.useCard(team, `protects ${this.name(target)}`);
    if ((r.spec.kind === 'destroy' || r.spec.kind === 'damage') && d?.keywords.indestructible) return;
    if (r.spec.kind === 'edict') {
      const fodder = this.creatures().sort((a, b) => this.targetValue(a) - this.targetValue(b))[0];
      if (fodder) this.destroy(fodder);
      return;
    }
    if (target.commander) this.stats.commanderRemoved++;
    this.destroy(target, r.spec.kind === 'bounce' ? 'hand' : r.spec.kind === 'tuck' ? 'library' : 'graveyard');
  }

  /**
   * Their attack: pick one player to attack this turn, weighted by how much damage would actually get
   * through their blockers times how threatening that player looks (with some randomness), then attack
   * with the creatures that get through or trade. Walls make you a poor target for ground decks; fliers don't care.
   */
  private attack(st: OppState) {
    const attackers = st.o.creatures.filter((c) => !c.tapped && !c.sick && !c.defender && c.power > 0);
    if (!attackers.length) return;
    const targets: ('me' | OppState)[] = ['me', ...this.liveOpps().filter((x) => x !== st)];
    const evaluate = (t: 'me' | OppState) => {
      const blockers = t === 'me' ? this.myBlockerProfiles() : t.o.creatures.filter((b) => !b.tapped).map((b) => ({ ...b, dmg: b.power }));
      let through = 0;
      const going: OppCreature[] = [];
      const pool = [...blockers];
      for (const c of [...attackers].sort((a, b) => b.power - a.power)) {
        const bi = pool.findIndex((b) => !c.unblockable && (!c.flying || b.flying || b.reach) && (b.toughness > c.power || b.dmg >= c.toughness));
        if (bi < 0) {
          through += c.power;
          going.push(c);
          continue;
        }
        const b = pool.splice(bi, 1)[0];
        const excess = c.trample ? Math.max(0, c.power - b.toughness) : 0;
        through += excess;
        // Attack into a blocker only when it trades or tramples over.
        if (excess > 0 || c.power >= b.toughness) going.push(c);
      }
      return { through, going };
    };
    const threat = (t: 'me' | OppState) => {
      if (st.p.priority === 'spread') return 1;
      if (st.p.priority === 'weakest') return 40 / Math.max(1, t === 'me' ? this.myLife : t.o.life);
      return t === 'me' ? this.myThreat() : 1 + (t.o.poison ? 0.5 : 0) + t.o.creatures.reduce((a, c) => a + c.power, 0) / 20;
    };
    // Square root: more open players get attacked more often, but attacks still spread around the table.
    const scored = targets.map((t) => ({ t, ...evaluate(t) })).map((x) => ({ ...x, score: Math.sqrt(x.through) * threat(x.t) }));
    const total = scored.reduce((a, x) => a + x.score, 0);
    if (total <= 0) return;
    let r = st.rng() * total;
    const pick = scored.find((x) => (r -= x.score) < 0) ?? scored[0];
    const going = pick.going.filter(() => st.rng() < st.p.aggression);
    if (!going.length) return;
    for (const c of going) c.tapped = true;
    if (pick.t === 'me') this.defend(st, going);
    else for (const c of going) this.oppVsOpp(c, pick.t);
    st.o.creatures = st.o.creatures.filter((c) => c.toughness > 0);
    if (this.liveOpps().length === 0 && this.myLife > 0) this.checkWin('outlasted');
  }

  /** Your untapped creatures as blockers, for opponents sizing up an attack on you. */
  private myBlockerProfiles() {
    return this.creatures()
      .filter((p) => !p.tapped)
      .map((p) => ({
        toughness: this.toughness(p),
        dmg: this.combatDamage(p),
        flying: p.token ? p.token.flying : this.def(p.def).keywords.flying,
        reach: !p.token && this.def(p.def).keywords.reach,
      }));
  }

  /** Opponents fighting each other: blocks trade creatures, unblocked damage hits life. */
  private oppVsOpp(c: OppCreature, target: OppState) {
    const can = target.o.creatures.filter((b) => !b.tapped && (!c.flying || b.flying || b.reach) && !c.unblockable);
    const blocker = can.find((b) => b.toughness > c.power) ?? can.find((b) => b.power >= c.toughness);
    if (!blocker) {
      target.o.life -= c.power;
      return;
    }
    blocker.tapped = true; // used up this combat
    if (c.power >= blocker.toughness) blocker.toughness = 0;
    if (blocker.power >= c.toughness) c.toughness = 0;
    if (c.trample) target.o.life -= Math.max(0, c.power - blocker.toughness);
    target.o.creatures = target.o.creatures.filter((x) => x.toughness > 0);
  }

  /** You block. Fliers only by flying/reach; trample goes over; walls with damage = toughness kill attackers. */
  private defend(st: OppState, attackers: OppCreature[]) {
    const incomingAir = attackers.filter((c) => c.flying || c.unblockable).reduce((a, c) => a + c.power, 0);
    const canBlockAir = this.creatures().filter((p) => !p.tapped && ((p.token ? p.token.flying : this.def(p.def).keywords.flying) || (!p.token && this.def(p.def).keywords.reach)));
    // Emergency: Tower Defense (+0/+5 and reach) when fliers would otherwise kill you.
    if (incomingAir >= this.myLife - 2 && canBlockAir.length < attackers.filter((c) => c.flying).length) {
      const tower = this.heldProtection((d) => !!d.teamToughnessPump?.reach && !d.teamToughnessPump.cost);
      if (tower !== undefined) {
        this.useCard(tower, 'gives your creatures reach to block fliers');
        for (const p of this.creatures()) {
          p.eot.reach = true;
          p.eot.toughness += this.def(tower).teamToughnessPump!.amount;
        }
      }
    }
    // Paid reach (Wall of Tanglecord: {G}: gains reach) when fliers are coming.
    if (attackers.some((c) => c.flying)) {
      for (const p of this.creatures()) {
        const reach = p.token ? null : this.def(p.def).reachCost;
        if (!p.tapped && reach && !p.eot.reach && this.pay(reach, 'ability', { ignoreReserve: true })) {
          p.eot.reach = true;
          this.say(`${this.name(p)} gains reach`);
        }
      }
    }
    const blockers = this.creatures().filter((p) => !p.tapped);
    const incoming = attackers.reduce((a, c) => a + c.power, 0);
    const desperate = incoming >= this.myLife - 5;
    for (const c of [...attackers].sort((a, b) => Number(b.flying) - Number(a.flying) || b.power - a.power)) {
      const can = blockers.filter((b) => {
        const flying = b.token ? b.token.flying : this.def(b.def).keywords.flying;
        const reach = b.eot.reach || (!b.token && this.def(b.def).keywords.reach);
        return !c.unblockable && (!c.flying || flying || reach);
      });
      const value = (b: Perm) => this.targetValue(b);
      const good = can.filter((b) => this.toughness(b) > c.power).sort((a, b) => value(a) - value(b));
      const pick = good[0] ?? (desperate ? can.sort((a, b) => value(a) - value(b))[0] : undefined);
      let through = c.power;
      if (pick) {
        blockers.splice(blockers.indexOf(pick), 1);
        pick.damage += c.power;
        if (this.combatDamage(pick) >= c.toughness) c.toughness = 0;
        through = c.trample ? Math.max(0, c.power - this.toughness(pick)) : 0;
        if (pick.damage >= this.toughness(pick) && !(!pick.token && this.def(pick.def).keywords.indestructible)) {
          this.say(`${this.name(pick)} dies blocking ${c.name}`);
          this.destroy(pick);
        }
      }
      if (through > 0) this.takeDamage(through, c.flying);
      if (this.over()) break;
    }
    st.o.creatures = st.o.creatures.filter((c) => c.toughness > 0);
    for (const p of this.bf) if (!(!p.token && this.def(p.def).damageRedirect)) p.damage = 0;
  }

  private takeDamage(n: number, flying: boolean) {
    // Ancient Adamantoise: all damage to you is dealt to it instead.
    const ad = this.bf.find((p) => !p.token && this.def(p.def).damageRedirect);
    if (ad) {
      ad.damage += n;
      if (ad.damage >= this.toughness(ad)) {
        this.say(`${this.name(ad)} dies after soaking ${ad.damage} damage`);
        this.destroy(ad);
      }
      return;
    }
    this.myLife -= n;
    this.say(`you take ${n} from ${flying ? 'fliers' : 'ground creatures'} (life ${this.myLife})`);
    if (flying) this.stats.damageFliers += n;
    else this.stats.damageGround += n;
    if (this.myLife <= 0 && this.winTurn === null) {
      this.lost = this.stats.damageFliers >= this.stats.damageGround ? 'fliers' : 'ground';
      this.say(`you die (${this.lost})`);
    }
  }

  // ---------------- your removal (your turn) ----------------
  /** Points held removal at the opposing creature that threatens you most (fliers first). */
  useRemoval() {
    for (const i of [...this.hand]) {
      const d = this.def(i);
      if (!d.spotRemoval || !['creature', 'permanent', 'nonland'].includes(d.spotRemoval.targets)) continue;
      const threats = this.liveOpps().flatMap((st) => st.o.creatures.map((c) => ({ st, c })));
      const flyBlockers = this.creatures().filter((p) => (p.token ? p.token.flying : this.def(p.def).keywords.flying) || (!p.token && this.def(p.def).keywords.reach)).length;
      const score = (c: OppCreature) => c.power * (c.flying && !flyBlockers ? 2 : 1) + (c.trample ? 1 : 0);
      const best = threats.sort((a, b) => score(b.c) - score(a.c))[0];
      if (!best || score(best.c) < 4 || !this.canPay(d.cost, 'hand')) continue;
      this.cast(i);
      best.st.o.creatures.splice(best.st.o.creatures.indexOf(best.c), 1);
      this.say(`${d.name} removes ${best.st.p.name}'s ${best.c.name}`);
    }
  }
}

function fits(scope: string, d: ReturnType<Game['def']>): boolean {
  if (scope === 'any') return true;
  if (scope === 'noncreature') return !d.types.creature;
  if (scope === 'creature') return d.types.creature;
  if (scope === 'instant') return d.types.instant;
  if (scope === 'instant_sorcery') return d.types.instant || d.types.sorcery;
  return false;
}

/** One matchup game: London mulligan, then you and the three opponents take turns (you go first). */
export function playTable(deck: CompiledDeck, profiles: OpponentProfile[], seed: number, opts: TableSettings, log = false, order?: number[]): TableGame {
  const strategy = strategyById(opts.strategy);
  const settings = { ...defaults(strategy.settings), ...opts.settings };
  const byName = new Map(deck.defs.map((d) => [d.name, d.idx]));
  const combos = opts.combos.map((c) => ({ ...c, cards: c.cards.map((n) => byName.get(n) ?? -1) })).filter((c) => c.cards.every((i) => i >= 0));
  const g = new TableGame(deck, seed, { maxTurns: opts.maxTurns, drawOnTurnOne: opts.drawOnTurnOne, combos, comboWins: opts.comboWins, log }, profiles, order);
  // London mulligan, same rules as the goldfish.
  for (let m = 0; ; m++) {
    const seven = g.lib.splice(0, 7);
    const defs = seven.map((i) => g.def(i));
    const { keep, bottom } = chooseBottom(defs, Math.max(0, m - (opts.rules.freeFirstMulligan ? 1 : 0)), opts.rules);
    if (handOk(keep, opts.rules) || m >= opts.rules.maxMulligans) {
      const pool = [...seven];
      const take = (d: (typeof defs)[number]) => pool.splice(pool.indexOf(d.idx), 1)[0];
      g.hand = keep.map(take);
      g.lib.push(...bottom.map(take));
      g.mulligans = m;
      break;
    }
    g.lib.push(...seven);
    shuffle(g.lib, g.rng);
  }
  for (let t = 0; t < opts.maxTurns && !g.over(); t++) {
    g.beginTurn();
    g.setReserve(opts.holdProtection);
    if (!g.over()) strategy.main1(g, settings);
    g.endPhase();
    if (!g.over()) strategy.combat(g, settings);
    g.endPhase();
    if (!g.over()) {
      strategy.main2(g, settings);
      g.useRemoval();
    }
    g.endTurn();
    // Untapped mana stays available for responses on their turns.
    for (const st of g.liveOpps()) {
      if (g.over()) break;
      g.opponentTurn(st);
    }
  }
  if (!g.over()) g.lost = 'timeout';
  return g;
}

export interface MatchupSummary {
  games: number;
  seed: number;
  opponents: string[];
  winRate: number;
  winByTurn: number[];
  medianWin: number | null;
  winTypes: Partial<Record<WinType, number>>;
  losses: Record<LossReason, number>;
  perGame: { commanderRemoved: number; wipesFaced: number; removalFaced: number; spellsCountered: number; aetherized: number };
  triumph: { cast: number; countered: number };
  protectionUsed: { name: string; perGame: number }[];
  avgLifeAtEnd: number;
}

export function runTable(deck: CompiledDeck, profiles: OpponentProfile[], opts: TableSettings, onProgress?: (done: number) => void, order?: number[]): MatchupSummary {
  const n = opts.games;
  const T = opts.maxTurns;
  const games: TableGame[] = [];
  for (let i = 0; i < n; i++) {
    games.push(playTable(deck, profiles, deriveSeed(opts.seed, i), opts, false, order));
    if (onProgress && i % 50 === 49) onProgress(i + 1);
  }
  const won = games.filter((g) => g.winTurn !== null);
  const sorted = games.map((g) => g.winTurn ?? Infinity).sort((a, b) => a - b);
  const mid = sorted[Math.floor(n / 2)];
  const losses: Record<LossReason, number> = { fliers: 0, ground: 0, decked: 0, timeout: 0, other: 0 };
  for (const g of games) {
    if (g.winTurn !== null) continue;
    const r: LossReason = g.decked ? 'decked' : g.lost === 'fliers' || g.lost === 'ground' || g.lost === 'timeout' ? g.lost : 'other';
    losses[r] += 1 / n;
  }
  const winTypes: Partial<Record<WinType, number>> = {};
  for (const g of won) winTypes[g.winType!] = (winTypes[g.winType!] ?? 0) + 1 / n;
  const sum = (f: (s: TableStats) => number) => games.reduce((a, g) => a + f(g.stats), 0);
  const prot = new Map<string, number>();
  for (const g of games) for (const [k, v] of Object.entries(g.stats.protectionUsed)) prot.set(k, (prot.get(k) ?? 0) + v);
  return {
    games: n,
    seed: opts.seed,
    opponents: profiles.map((p) => p.name),
    winRate: won.length / n,
    winByTurn: Array.from({ length: T }, (_, t) => games.filter((g) => g.winTurn !== null && g.winTurn <= t + 1).length / n),
    medianWin: Number.isFinite(mid) ? mid : null,
    winTypes,
    losses,
    perGame: {
      commanderRemoved: sum((s) => s.commanderRemoved) / n,
      wipesFaced: sum((s) => s.wipesFaced) / n,
      removalFaced: sum((s) => s.removalFaced) / n,
      spellsCountered: sum((s) => s.spellsCountered) / n,
      aetherized: sum((s) => s.aetherized) / n,
    },
    triumph: { cast: sum((s) => s.triumphCast) / n, countered: sum((s) => s.triumphCountered) / Math.max(1, sum((s) => s.triumphCast)) },
    protectionUsed: [...prot].map(([name, v]) => ({ name, perGame: v / n })).sort((a, b) => b.perGame - a.perGame),
    avgLifeAtEnd: games.reduce((a, g) => a + Math.max(0, g.myLife), 0) / n,
  };
}

export const DEFAULT_TABLE: Omit<TableSettings, 'strategy' | 'settings'> = {
  games: 1000,
  maxTurns: 20,
  seed: 1,
  drawOnTurnOne: true,
  rules: DEFAULT_RULES,
  combos: [],
  comboWins: true,
  holdProtection: true,
};
