// The goldfish game engine: one player, three phantom opponents at 40 life who never act or block.
// Rules live here; decisions live in strategies/. All behaviour comes from compiled tags (cards.ts).

import type { Color } from '../data/types';
import { COLORS } from '../data/types';
import { mulberry32, shuffle } from './rng';
import { reduceGeneric, type ManaCost } from './manaCost';
import type { CardDef, CompiledDeck } from './cards';

export type WinType = 'combat' | 'poison' | 'pings' | 'combo' | 'outlasted';
export type ManaRestriction = 'abilities' | 'nonhand' | null;

export interface Perm {
  id: number;
  def: number;
  tapped: boolean;
  /** Came under control this turn (creatures can't attack or tap). */
  sick: boolean;
  counters: number;
  minusToughness: number;
  /** Aura / equipment: the permanent it's attached to. */
  attachedTo: number | null;
  commander: boolean;
  token: { power: number; toughness: number; flying: boolean; name: string } | null;
  /** Until end of turn. */
  eot: { power: number; toughness: number; canAttack: boolean; butt: boolean; haste: boolean; drawOnHit: boolean; unblockable: boolean; reach: boolean };
  /** Which opponent this creature attacks this turn, if a strategy chose one. */
  attackTarget?: Opponent | null;
  /** Damage marked this turn (blocking / being blocked); Adamantoise keeps its damage. */
  damage: number;
  usedThisTurn: Set<string>;
}

/** An opposing creature (matchups only; goldfish opponents have none). */
export interface OppCreature {
  name: string;
  power: number;
  toughness: number;
  flying: boolean;
  reach: boolean;
  trample: boolean;
  unblockable: boolean;
  defender: boolean;
  lifelink?: boolean;
  tapped: boolean;
  sick: boolean;
}

export interface Opponent {
  life: number;
  poison: number;
  creatures?: OppCreature[];
}

export interface GameSettings {
  maxTurns: number;
  drawOnTurnOne: boolean;
  /** Spellbook combos in this deck: def indices of their cards, and mana they need once assembled. */
  combos: { cards: number[]; manaNeeded: number; label: string }[];
  comboWins: boolean;
  log: boolean;
}

export interface TurnLog {
  turn: number;
  hand: string[];
  events: string[];
  board: string[];
  opponents: string;
}

interface FloatingMana {
  colors: (Color | 'C')[];
  restriction: ManaRestriction;
}

interface SourceUnit {
  perm: Perm;
  amount: number;
  colors: (Color | 'C')[];
  restriction: ManaRestriction;
  dork: boolean;
  /** Wall of Roots: pays by shrinking instead of tapping. */
  shrink: boolean;
}

const EOT = () => ({ power: 0, toughness: 0, canAttack: false, butt: false, haste: false, drawOnHit: false, unblockable: false, reach: false });

export class Game {
  readonly d: CompiledDeck;
  readonly s: GameSettings;
  readonly rng: () => number;
  lib: number[];
  hand: number[] = [];
  gy: number[] = [];
  bf: Perm[] = [];
  commandZone: number[];
  casts = new Map<number, number>();
  opps: Opponent[] = [{ life: 40, poison: 0 }, { life: 40, poison: 0 }, { life: 40, poison: 0 }];
  turn = 0;
  landPlayed = false;
  floating: FloatingMana[] = [];
  treasures = 0;
  nextId = 1;
  /** End-of-turn team effects. */
  team = { infect: false, power: 0, toughness: 0, trample: false };
  // ---- results ----
  decked = false;
  winTurn: number | null = null;
  winType: WinType | null = null;
  commanderTurn: number | null = null;
  commanderCost: number | null = null;
  comboTurn: number | null = null;
  comboLabel: string | null = null;
  extraDrawn = 0;
  extraDrawnByTurn: number[] = [];
  landsByTurn: number[] = [];
  manaByTurn: number[] = [];
  /** End-of-turn board: total power, flying power, trample power, creature count (used to profile opponents). */
  boardByTurn: { power: number; flying: number; trample: number; creatures: number }[] = [];
  firstSeen = new Map<number, number>();
  mulligans = 0;
  cardsSeen = 0;
  landsSeen = 0;
  cardsSeenBy6 = 0;
  landsSeenBy6 = 0;
  usedPoison = false;
  logs: TurnLog[] = [];
  private current: TurnLog | null = null;

  constructor(deck: CompiledDeck, seed: number, settings: GameSettings, libraryOrder?: number[]) {
    this.d = deck;
    this.s = settings;
    this.rng = mulberry32(seed);
    this.lib = shuffle([...(libraryOrder ?? deck.library)], this.rng);
    this.commandZone = [...deck.commanders];
    // Commander stats follow the creature commander (not a Background), else the first.
    this.primaryCommander = deck.commanders.find((c) => deck.defs[c].types.creature) ?? deck.commanders[0] ?? -1;
  }
  readonly primaryCommander: number;

  def(i: number): CardDef {
    return this.d.defs[i];
  }
  name(p: Perm): string {
    return p.token?.name ?? this.def(p.def).name;
  }
  say(msg: string) {
    if (this.current) this.current.events.push(msg);
  }

  // ---------------- zones ----------------
  onBattlefield(pred: (d: CardDef, p: Perm) => boolean): Perm[] {
    return this.bf.filter((p) => !p.token && pred(this.def(p.def), p));
  }
  has(pred: (d: CardDef) => boolean): boolean {
    return this.bf.some((p) => !p.token && pred(this.def(p.def)));
  }
  creatures(): Perm[] {
    return this.bf.filter((p) => p.token || this.def(p.def).types.creature);
  }
  lands(): Perm[] {
    return this.bf.filter((p) => !p.token && this.def(p.def).types.land);
  }
  alive(): Opponent[] {
    return this.opps.filter((o) => o.life > 0 && o.poison < 10);
  }
  seen(defIdx: number) {
    if (!this.firstSeen.has(defIdx)) this.firstSeen.set(defIdx, this.turn);
    this.cardsSeen++;
    if (this.def(defIdx).types.land) this.landsSeen++;
  }

  // ---------------- creature stats ----------------
  isCreature(p: Perm): boolean {
    return !!p.token || this.def(p.def).types.creature;
  }
  power(p: Perm): number {
    if (p.token) return p.token.power + p.counters + p.eot.power + this.team.power + this.anthem().power;
    const d = this.def(p.def);
    let v = d.handSizePT ? this.hand.length : d.power;
    for (const a of this.attachments(p)) v += this.attachBonus(a).power;
    return v + p.counters + p.eot.power + this.team.power + this.anthem().power;
  }
  toughness(p: Perm): number {
    if (p.token) return p.token.toughness + p.counters + p.eot.toughness + this.team.toughness + this.anthem().toughness;
    const d = this.def(p.def);
    let v = d.handSizePT ? this.hand.length : d.toughness;
    for (const a of this.attachments(p)) v += this.attachBonus(a).toughness;
    return v + p.counters - p.minusToughness + p.eot.toughness + this.team.toughness + this.anthem().toughness;
  }
  attachments(p: Perm): Perm[] {
    // Fast path: with no auras or equipment on the battlefield nothing can be attached.
    if (!this.statics().attachable) return [];
    return this.bf.filter((a) => a.attachedTo === p.id);
  }
  private attachBonus(a: Perm) {
    const d = this.def(a.def);
    return d.aura ?? d.equipment ?? { power: 0, toughness: 0 };
  }
  // Team-wide statics (anthems, "damage = toughness") are scanned once per battlefield change, not per creature.
  private staticKey = -1;
  private staticCache = { power: 0, toughness: 0, buttTeam: false, buttTGtP: false, attachable: false };
  private statics() {
    const key = this.bf.length * 4096 + this.turn;
    if (key === this.staticKey) return this.staticCache;
    const { power, toughness } = this.computeAnthem();
    let buttTeam = false;
    let buttTGtP = false;
    let attachable = false;
    for (const q of this.bf) {
      if (q.token) continue;
      if (this.def(q.def).types.aura || this.def(q.def).types.equipment) attachable = true;
      const b = this.def(q.def).butt;
      if (b === 'team') buttTeam = true;
      if (b === 'team_t_gt_p') buttTGtP = true;
    }
    this.staticKey = key;
    this.staticCache = { power, toughness, buttTeam, buttTGtP, attachable };
    return this.staticCache;
  }
  /** Static team pumps like Fecund Greenshell (+2/+2 with ten or more lands). */
  anthem() {
    const s = this.statics();
    return { power: s.power, toughness: s.toughness };
  }
  private computeAnthem() {
    let power = 0;
    let toughness = 0;
    const lands = this.lands().length;
    for (const p of this.bf) {
      if (p.token) continue;
      const t = this.def(p.def).teamPumpStatic;
      if (t && lands >= t.minLands) {
        power += t.power;
        toughness += t.toughness;
      }
    }
    return { power, toughness };
  }
  totalToughness(): number {
    return this.creatures().reduce((a, p) => a + this.toughness(p), 0);
  }
  shroud(p: Perm): boolean {
    if (p.token) return false;
    if (this.def(p.def).keywords.shroud) return true;
    return this.attachments(p).some((a) => this.def(a.def).equipment?.shroud);
  }
  defender(p: Perm): boolean {
    return !p.token && this.def(p.def).keywords.defender;
  }
  hasHaste(p: Perm): boolean {
    if (p.eot.haste) return true;
    if (!p.token && this.def(p.def).keywords.haste) return true;
    if (this.attachments(p).some((a) => this.def(a.def).equipment?.haste)) return true;
    return false;
  }
  /** Damage it would assign in combat: toughness when a "damage = toughness" effect applies. */
  combatDamage(p: Perm): number {
    const t = this.toughness(p);
    const pw = this.power(p);
    if (this.assignsToughness(p)) return Math.max(0, t);
    return Math.max(0, pw);
  }
  assignsToughness(p: Perm): boolean {
    if (p.eot.butt) return true;
    for (const a of this.attachments(p)) if (this.def(a.def).aura?.butt) return true;
    const s = this.statics();
    if (s.buttTeam) return true;
    return s.buttTGtP && this.toughness(p) > this.power(p);
  }
  canAttack(p: Perm): boolean {
    if (!this.isCreature(p) || p.tapped) return false;
    if (p.sick && !this.hasHaste(p)) return false;
    if (this.defender(p) && !p.eot.canAttack) return false;
    return true;
  }
  /** Could attack this turn if something lets it past defender (ignores defender). */
  readyToAttack(p: Perm): boolean {
    return this.isCreature(p) && !p.tapped && (!p.sick || this.hasHaste(p));
  }

  // ---------------- mana ----------------
  private defendersCount(): number {
    return this.creatures().filter((p) => this.defender(p)).length;
  }
  sources(): SourceUnit[] {
    const out: SourceUnit[] = [];
    // Land auras by the land they enchant (one pass, not one per land).
    const auraOn = new Map<number, { amount: number; colors: (Color | 'C')[] }>();
    for (const a of this.bf) {
      if (a.token || a.attachedTo === null || this.def(a.def).sourceKind !== 'aura') continue;
      const prev = auraOn.get(a.attachedTo) ?? { amount: 0, colors: [] };
      auraOn.set(a.attachedTo, { amount: prev.amount + this.def(a.def).rampAmount, colors: [...prev.colors, ...this.def(a.def).produces] });
    }
    for (const p of this.bf) {
      if (p.token) continue;
      const d = this.def(p.def);
      if (!d.sourceKind) continue;
      if (d.sourceKind === 'aura') continue; // its mana comes with the enchanted land, below
      if (d.sourceKind === 'land' || d.sourceKind === 'rock') {
        if (p.tapped) continue;
        let amount = d.sourceKind === 'land' ? 1 : d.rampAmount;
        let colors: (Color | 'C')[] = d.produces.length ? d.produces : ['C'];
        // Land auras (Utopia Sprawl, Wild Growth): tapping the enchanted land adds their extra mana.
        const aura = auraOn.get(p.id);
        if (aura) {
          amount += aura.amount;
          colors = [...new Set([...colors, ...aura.colors])];
        }
        if (amount <= 0) continue;
        out.push({ perm: p, amount, colors, restriction: d.abilitiesOnlyMana ? 'abilities' : null, dork: false, shrink: false });
      } else if (d.sourceKind === 'dork') {
        if (d.shrinksForMana) {
          if (!p.usedThisTurn.has('mana') && this.toughness(p) > 1) out.push({ perm: p, amount: 1, colors: d.produces.length ? d.produces : ['C'], restriction: null, dork: true, shrink: true });
          continue;
        }
        if (p.tapped || (p.sick && !this.hasHaste(p))) continue;
        const amount = d.rampPerDefender ? Math.max(1, this.defendersCount()) : d.rampPerToughness ? Math.max(0, this.toughness(p)) : d.rampAmount;
        if (amount <= 0) continue;
        out.push({ perm: p, amount, colors: d.produces.length ? d.produces : ['C'], restriction: d.rampRestricted ? (d.abilitiesOnlyMana ? 'abilities' : 'nonhand') : null, dork: true, shrink: false });
      }
    }
    return out;
  }
  /** Mana you could make right now for this kind of payment. */
  manaAvailable(kind: 'hand' | 'commander' | 'ability' = 'hand', opts: { keepDorksHome?: Set<number> } = {}): number {
    const usable = (r: ManaRestriction) => r === null || (r === 'nonhand' && kind !== 'hand') || (r === 'abilities' && kind === 'ability');
    let n = this.floating.filter((f) => usable(f.restriction)).length + this.treasures;
    for (const u of this.sources()) if (usable(u.restriction) && !opts.keepDorksHome?.has(u.perm.id)) n += u.amount;
    return n;
  }

  /**
   * Pays a cost from floating mana first, then by tapping sources: colored pips first (sources with the fewest
   * colors, lands before creatures), then generic. Excess from multi-mana sources floats until the phase ends.
   * Returns false (changing nothing) if it can't be paid.
   */
  /** Mana held back for instant-speed protection (matchups). Main-phase payments won't dip into it. */
  reserve = 0;

  pay(cost: ManaCost, kind: 'hand' | 'commander' | 'ability', opts: { avoidPerms?: Set<number>; dryRun?: boolean; ignoreReserve?: boolean } = {}): boolean {
    if (this.reserve > 0 && !opts.ignoreReserve) {
      const need = cost.generic + Object.values(cost.pips).reduce((a, b) => a + b, 0) + cost.hybrid.length;
      if (this.manaAvailable(kind) - need < this.reserve) return false;
    }
    const usable = (r: ManaRestriction) => r === null || (r === 'nonhand' && kind !== 'hand') || (r === 'abilities' && kind === 'ability');
    const floating = this.floating.map((f) => ({ ...f }));
    const units = this.sources().filter((u) => usable(u.restriction) && !opts.avoidPerms?.has(u.perm.id));
    // Prefer lands, then rocks, then creatures; restricted mana first so normal mana is saved.
    const order = (u: SourceUnit) => (u.restriction ? 0 : 1) + (u.dork ? 10 : 0) + (u.shrink ? 5 : 0) + u.colors.length * 0.1;
    units.sort((a, b) => order(a) - order(b));
    const tapped: SourceUnit[] = [];
    let treasures = this.treasures;
    const takeFloating = (color: Color | null) => {
      const i = floating.findIndex((f) => usable(f.restriction) && (color === null || f.colors.includes(color)));
      if (i < 0) return false;
      floating.splice(i, 1);
      return true;
    };
    const tapFor = (color: Color | null) => {
      const u = units.find((x) => !tapped.includes(x) && (color === null || x.colors.includes(color)));
      if (!u) return false;
      tapped.push(u);
      for (let i = 1; i < u.amount; i++) floating.push({ colors: u.colors, restriction: u.restriction });
      return true;
    };
    const pips: Color[] = [];
    for (const c of COLORS) for (let i = 0; i < cost.pips[c]; i++) pips.push(c);
    // Rarest color first.
    const supply = (c: Color) => units.filter((u) => u.colors.includes(c)).length;
    pips.sort((a, b) => supply(a) - supply(b));
    for (const c of pips) {
      if (takeFloating(c) || tapFor(c)) continue;
      if (treasures > 0) {
        treasures--;
        continue;
      }
      return false;
    }
    let generic = cost.generic + cost.pips.C + cost.hybrid.length;
    while (generic > 0) {
      if (takeFloating(null) || tapFor(null)) {
        generic--;
        continue;
      }
      if (treasures > 0) {
        treasures--;
        generic--;
        continue;
      }
      return false;
    }
    if (opts.dryRun) return true;
    for (const u of tapped) {
      if (u.shrink) {
        u.perm.minusToughness++;
        u.perm.usedThisTurn.add('mana');
      } else u.perm.tapped = true;
    }
    this.floating = floating;
    this.treasures = treasures;
    return true;
  }
  canPay(cost: ManaCost, kind: 'hand' | 'commander' | 'ability', avoidPerms?: Set<number>, ignoreReserve = false): boolean {
    return this.pay(cost, kind, { dryRun: true, avoidPerms, ignoreReserve });
  }
  endPhase() {
    this.floating = [];
  }
  /** The biggest ability-cost reduction from Training Grounds / Biomancer's Familiar on the battlefield. */
  abilityReducer(): number {
    return Math.max(0, ...this.bf.filter((p) => !p.token).map((p) => this.def(p.def).costReducerAbilities));
  }
  abilityCost(cost: ManaCost, creatureAbility: boolean): ManaCost {
    const r = this.abilityReducer();
    return creatureAbility && r ? reduceGeneric(cost, r) : cost;
  }

  // ---------------- drawing ----------------
  /** Draws n cards. Draw doublers turn every draw except the first of the draw step into two. */
  draw(n: number, why: string, drawStep = false) {
    const doubler = this.has((d) => d.drawDoubler);
    const pings = this.bf.filter((p) => !p.token).reduce((a, p) => a + this.def(p.def).drawPing, 0);
    const got: string[] = [];
    for (let i = 0; i < n; i++) {
      const count = doubler && !(drawStep && i === 0) ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const c = this.lib.shift();
        if (c === undefined) {
          this.decked = true;
          this.say(`tried to draw from an empty library: decked`);
          return;
        }
        this.hand.push(c);
        this.seen(c);
        got.push(this.def(c).name);
        if (!drawStep || i > 0 || k > 0) this.extraDrawn++;
        if (pings) this.loseLife(pings, 'pings');
      }
    }
    if (got.length && !drawStep) this.say(`${why}: draw ${got.length > 6 ? `${got.length} cards` : got.join(', ')}`);
  }
  loseLife(amount: number, source: WinType, which?: Opponent) {
    for (const o of which ? [which] : this.alive()) o.life -= amount;
    this.checkWin(source);
  }
  addPoison(o: Opponent, n: number) {
    o.poison += n;
    this.usedPoison = true;
    this.checkWin('poison');
  }
  checkWin(source: WinType) {
    if (this.winTurn === null && !this.decked && this.alive().length === 0) {
      this.winTurn = this.turn;
      this.winType = this.usedPoison ? 'poison' : source;
      this.say(`WIN (${this.winType})`);
    }
  }
  /** Turn on which spells you control can't be countered (Veil of Summer). */
  uncounterableTurn = -1;
  /** Matchups: might an opponent counter a key spell? (goldfish: never) */
  opponentsMayCounter(): boolean {
    return false;
  }
  /** Matchups: you died. */
  lost: string | null = null;
  over(): boolean {
    return this.winTurn !== null || this.decked || this.lost !== null;
  }
  /** Matchups: an opponent may answer an assembled combo by removing a piece. */
  protected comboDisrupted(_pieces: number[]): boolean {
    return false;
  }
  /** Matchups: opponents may counter it. Returns true if the spell was countered. */
  protected countered(_defIdx: number, _fromCommandZone: boolean): boolean {
    return false;
  }

  // ---------------- casting ----------------
  /** What casting this card from hand or the command zone costs right now. */
  castCost(defIdx: number, fromCommandZone = false): ManaCost {
    const d = this.def(defIdx);
    let c = d.cost;
    if (d.selfCost?.by === 'total_toughness') c = { ...c, generic: Math.max(0, c.generic - this.totalToughness()), mv: 0 };
    else if (d.selfCost?.by === 'total_power') c = { ...c, generic: Math.max(0, c.generic - this.creatures().reduce((a, p) => a + Math.max(0, this.power(p)), 0)), mv: 0 };
    else if (d.selfCost && d.selfCost.amount) c = { ...c, generic: Math.max(0, c.generic - d.selfCost.amount) };
    if (fromCommandZone) c = { ...c, generic: c.generic + 2 * (this.casts.get(defIdx) ?? 0) };
    return c;
  }

  /** Casts a card from hand (or the command zone). Returns the new permanent, if any. */
  cast(defIdx: number, opts: { fromCommandZone?: boolean; xMana?: number; avoidPerms?: Set<number> } = {}): Perm | null | false {
    const d = this.def(defIdx);
    const base = this.castCost(defIdx, opts.fromCommandZone);
    const cost = opts.xMana ? { ...base, generic: base.generic + opts.xMana } : base;
    if (!this.pay(cost, opts.fromCommandZone ? 'commander' : 'hand', { avoidPerms: opts.avoidPerms })) return false;
    if (opts.fromCommandZone) {
      this.commandZone.splice(this.commandZone.indexOf(defIdx), 1);
      this.casts.set(defIdx, (this.casts.get(defIdx) ?? 0) + 1);
      if (this.commanderTurn === null && defIdx === this.primaryCommander) {
        this.commanderTurn = this.turn;
        this.commanderCost = cost.generic + Object.values(cost.pips).reduce((a, b) => a + b, 0);
      }
    } else this.hand.splice(this.hand.indexOf(defIdx), 1);
    const paid = cost.generic + Object.values(cost.pips).reduce((a, b) => a + b, 0);
    this.say(`cast ${d.name}${paid !== d.mv || opts.fromCommandZone ? ` for ${paid}` : ''}`);
    if (this.countered(defIdx, !!opts.fromCommandZone)) {
      if (opts.fromCommandZone) this.commandZone.push(defIdx);
      else this.gy.push(defIdx);
      return null;
    }
    if (!d.permanent) {
      this.resolveSpell(d, opts.xMana ?? 0);
      this.gy.push(defIdx);
      return null;
    }
    return this.enter(defIdx, { commander: !!opts.fromCommandZone });
  }

  /** A permanent enters: summoning sickness, enters-tapped, and ETB triggers. */
  enter(defIdx: number, opts: { commander?: boolean; tapped?: boolean } = {}): Perm {
    const d = this.def(defIdx);
    const conditionalUntapped = d.entersTapped === 'conditional' && this.lands().length >= 2;
    const p: Perm = {
      id: this.nextId++, def: defIdx, tapped: opts.tapped ?? (d.entersTapped === 'yes' || (d.entersTapped === 'conditional' && !conditionalUntapped)),
      sick: true, counters: 0, minusToughness: 0, attachedTo: null, commander: !!opts.commander, token: null, eot: EOT(), usedThisTurn: new Set(), damage: 0,
    };
    this.bf.push(p);
    if (d.types.creature) this.creatureEntered(p);
    if (d.draw?.onCast && d.permanent) this.draw(d.draw.onCast, d.name);
    if (d.draw?.discard && d.permanent) this.discardWorst(d.draw.discard);
    if (d.recursion?.etb) this.recur(d.recursion.filter, d.name);
    if (d.tokenMaker && d.tokenMaker.trigger === 'etb') this.makeTokens(d);
    for (const c of d.custom) if (c.when === 'etb') this.customEffect(p, c);
    if (d.drain?.trigger === 'etb') this.loseLife(d.drain.amount, 'pings');
    if (d.fetchesBasic && d.types.land) this.fetchBasic(p);
    return p;
  }
  private creatureEntered(p: Perm) {
    const d = this.def(p.def);
    // Guardian Project: a differently named nontoken creature entering draws a card.
    const guardians = this.onBattlefield((x, q) => x.creatureEtbDraw && q.id !== p.id);
    const sameName = this.bf.some((q) => q.id !== p.id && !q.token && this.def(q.def).name === d.name) || this.gy.some((g) => this.def(g).name === d.name && this.def(g).types.creature);
    if (!p.token && !sameName) for (const g of guardians) this.draw(1, this.def(g.def).name);
    // Fecund Greenshell: a creature with toughness greater than its power enters → top card: land onto the battlefield tapped, else to hand.
    for (const g of this.onBattlefield((x) => x.etbDig !== null)) {
      if (this.def(g.def).etbDig === 't_gt_p' && !(this.toughness(p) > this.power(p))) continue;
      const top = this.lib.shift();
      if (top === undefined) continue;
      this.seen(top);
      if (this.def(top).types.land) {
        this.enter(top, { tapped: true });
        this.say(`${this.def(g.def).name}: ${this.def(top).name} onto the battlefield`);
      } else {
        this.hand.push(top);
        this.say(`${this.def(g.def).name}: ${this.def(top).name} to hand`);
      }
    }
  }
  private resolveSpell(d: CardDef, xMana: number) {
    if (d.draw) {
      const n = d.draw.onCast + (d.draw.x ? xMana : 0);
      if (n) this.draw(n, d.name);
      if (d.draw.discard) this.discardWorst(d.draw.discard);
    }
    if (d.rampLands) for (let i = 0; i < d.rampLands; i++) this.fetchBasic(null, d.rampLandsTapped);
    if (d.recursion && !d.recursion.etb) this.recur(d.recursion.filter, d.name);
    if (d.tokenMaker && d.tokenMaker.trigger === 'cast') this.makeTokens(d);
    if (d.drain?.trigger === 'cast') this.loseLife(d.drain.amount, 'pings');
    if (d.massInfect) this.team.infect = true;
    if (d.protectionKind === 'uncounterable') this.uncounterableTurn = this.turn;
    if (d.teamPumpEot) {
      this.team.power += d.teamPumpEot.power;
      this.team.toughness += d.teamPumpEot.toughness;
      this.team.trample ||= d.teamPumpEot.trample;
    }
    if (d.teamToughnessPump && !d.teamToughnessPump.cost) this.team.toughness += d.teamToughnessPump.amount;
    for (const c of d.custom) if (c.when === 'cast') this.customEffect(null, c);
  }
  /** Puts a basic land from the library onto the battlefield (fetch lands, Rampant Growth). */
  fetchBasic(sacrifice: Perm | null, tapped = true) {
    const basic = this.lib.findIndex((i) => /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(this.def(i).name));
    if (sacrifice) {
      this.bf.splice(this.bf.indexOf(sacrifice), 1);
      this.gy.push(sacrifice.def);
    }
    if (basic < 0) return;
    const [c] = this.lib.splice(basic, 1);
    this.enter(c, { tapped });
    this.say(`fetch ${this.def(c).name}`);
  }
  recur(filter: string, why: string) {
    // Prefer the win piece, then the most expensive card that fits.
    const ok = (i: number) => {
      const d = this.def(i);
      if (filter === 'instant_sorcery') return d.types.instant || d.types.sorcery;
      if (filter === 'creature') return d.types.creature;
      if (filter === 'permanent') return d.permanent;
      return true;
    };
    const options = this.gy.filter(ok).sort((a, b) => Number(this.def(b).massInfect) - Number(this.def(a).massInfect) || this.def(b).mv - this.def(a).mv);
    if (!options.length) return;
    this.gy.splice(this.gy.indexOf(options[0]), 1);
    this.hand.push(options[0]);
    this.say(`${why}: return ${this.def(options[0]).name} to hand`);
  }
  makeTokens(d: CardDef) {
    const t = d.tokenMaker!;
    for (let i = 0; i < t.count; i++) this.makeToken(t.power, t.toughness, t.flying, `${d.name} token`);
  }
  makeToken(power: number, toughness: number, flying: boolean, name: string): Perm {
    const p: Perm = {
      id: this.nextId++, def: -1, tapped: false, sick: true, counters: 0, minusToughness: 0, attachedTo: null, commander: false,
      token: { power, toughness, flying, name }, eot: EOT(), usedThisTurn: new Set(), damage: 0,
    };
    this.bf.push(p);
    this.say(`create ${name} (${power}/${toughness})`);
    return p;
  }
  /** User-described effects (custom effect tags). */
  customEffect(source: Perm | null, c: CardDef['custom'][number]) {
    const target = source && c.target === 'attached' && source.attachedTo ? this.bf.find((p) => p.id === source.attachedTo) ?? null : source;
    switch (c.effect) {
      case 'draw':
        this.draw(c.amount || 1, source ? this.name(source) : 'custom effect');
        break;
      case 'add_mana':
        for (let i = 0; i < c.amount; i++) this.floating.push({ colors: c.colors.length ? c.colors : ['C'], restriction: null });
        break;
      case 'token':
        for (let i = 0; i < Math.max(1, c.amount); i++) this.makeToken(c.power, c.toughness, false, `${source ? this.name(source) : 'custom'} token`);
        break;
      case 'pump':
        for (const p of c.target === 'your_creatures' ? this.creatures() : target ? [target] : []) {
          p.eot.power += c.power;
          p.eot.toughness += c.toughness;
        }
        break;
      case 'untap':
        if (target) target.tapped = false;
        break;
      case 'mill':
        break;
      case 'extra_land':
        this.landPlayed = false;
        break;
      default:
        break;
    }
  }
  /**
   * Picks permanents to sacrifice for "sacrifice N <thing>" costs: tokens first, then the cheapest match.
   * Never the commander, a combo piece, or (unless `cheapOnly` is off) anything worth more than a 0/2-ish body.
   */
  fodder(what: string, exclude: Perm, cheapOnly = true): Perm[] | null {
    const m = what.match(/^(\d+) (.+)$/);
    if (!m) return null;
    const count = Number(m[1]);
    const kind = m[2];
    const combo = new Set(this.s.combos.flatMap((c) => c.cards));
    const matches = (p: Perm) => {
      if (p === exclude || p.commander || (!p.token && combo.has(p.def))) return false;
      const d = p.token ? null : this.def(p.def);
      if (kind.includes('token')) return !!p.token;
      if (kind.startsWith('land')) return !!d?.types.land;
      if (kind.startsWith('artifact')) return !!d?.types.artifact;
      if (kind.startsWith('creature') || kind.endsWith('creature')) {
        if (!this.isCreature(p)) return false;
        if (kind.includes('defender') && !this.defender(p)) return false;
        return true;
      }
      return false;
    };
    // Toughness counts fully: in a deck like the Pride, a big-butted wall is a draw engine, not fodder.
    const value = (p: Perm) => (p.token ? 0 : 1 + this.def(p.def).mv + Math.max(0, this.power(p)) + Math.max(0, this.toughness(p)) + (this.def(p.def).sourceKind ? 5 : 0));
    const options = this.bf.filter(matches).sort((a, b) => value(a) - value(b));
    const picked = options.slice(0, count);
    if (picked.length < count) return null;
    if (cheapOnly && picked.some((p) => value(p) > 4)) return null;
    return picked;
  }

  /** A permanent leaves: commanders go to the command zone, tokens vanish, attachments fall off. */
  destroy(p: Perm, to: 'graveyard' | 'hand' | 'library' = 'graveyard') {
    const i = this.bf.indexOf(p);
    if (i < 0) return;
    this.bf.splice(i, 1);
    for (const a of this.bf.filter((x) => x.attachedTo === p.id)) {
      if (this.def(a.def).types.aura) this.destroy(a);
      else a.attachedTo = null;
    }
    if (p.token) return;
    if (p.commander) this.commandZone.push(p.def);
    else if (to === 'hand') this.hand.push(p.def);
    else if (to === 'library') this.lib.push(p.def);
    else this.gy.push(p.def);
  }

  /** Discards the cards the plan needs least: interaction the goldfish can't use, then excess lands, then the priciest. */
  discardWorst(n: number) {
    for (let i = 0; i < n && this.hand.length; i++) {
      const lands = this.lands().length;
      const score = (c: number) => {
        const d = this.def(c);
        if (d.massInfect || d.teamToughnessPump) return -100;
        if (d.types.land) return lands >= 7 ? 50 : lands >= 5 ? 20 : -50;
        // Interaction is dead weight in a goldfish but your lifeline in a matchup.
        if (d.interaction || d.protection) return this.isTable ? -20 : 40;
        return d.mv;
      };
      const pick = [...this.hand].sort((a, b) => score(b) - score(a))[0];
      this.hand.splice(this.hand.indexOf(pick), 1);
      this.gy.push(pick);
      this.say(`discard ${this.def(pick).name}`);
    }
  }

  // ---------------- combat ----------------
  /** Attacks with these creatures, each at one opponent. Nobody blocks in a goldfish. */
  /** Can this opposing creature block that attacker? (Flying, unblockable, Prowler's Helm, Tetsuko.) */
  canBlock(attacker: Perm, b: OppCreature): boolean {
    if (b.tapped) return false;
    if (attacker.eot.unblockable || (!attacker.token && this.def(attacker.def).keywords.unblockable)) return false;
    const flying = attacker.token ? attacker.token.flying : this.def(attacker.def).keywords.flying || this.attachments(attacker).some((a) => this.def(a.def).aura?.flying);
    if (flying && !b.flying && !b.reach) return false;
    if (this.attachments(attacker).some((a) => this.def(a.def).unblockable === 'walls') && !b.defender) return false;
    const small = this.onBattlefield((d) => d.smallUnblockable > 0)[0];
    if (small) {
      const max = this.def(small.def).smallUnblockable;
      if (this.power(attacker) <= max || this.toughness(attacker) <= max) return false;
    }
    return true;
  }
  /** Matchups have opposing creatures; the goldfish doesn't. */
  get isTable(): boolean {
    return this.opps.some((o) => o.creatures !== undefined);
  }
  /** True when no untapped creature of that opponent could block it. */
  connects(attacker: Perm, o: Opponent): boolean {
    return !(o.creatures ?? []).some((b) => this.canBlock(attacker, b));
  }
  /** Matchups: Aetherize-style responses and blocks. Returns, per attacker, the blocker (if any). */
  protected declareBlocks(_attacks: { perm: Perm; target: Opponent }[]): Map<Perm, OppCreature | null> {
    return new Map();
  }
  protected beforeDamage(attacks: { perm: Perm; target: Opponent }[]): { perm: Perm; target: Opponent }[] {
    return attacks;
  }

  combat(attacks: { perm: Perm; target: Opponent }[]) {
    if (!attacks.length) return;
    for (const { perm } of attacks) {
      const d = perm.token ? null : this.def(perm.def);
      if (!d?.keywords.vigilance) perm.tapped = true;
    }
    attacks = this.beforeDamage(attacks);
    const blocks = this.declareBlocks(attacks);
    const dealt: Perm[] = [];
    for (const { perm, target } of attacks) {
      let dmg = this.combatDamage(perm);
      const blocker = blocks.get(perm);
      if (blocker) {
        const trample = this.team.trample || (!perm.token && this.def(perm.def).keywords.trample);
        const toBlocker = Math.min(dmg, Math.max(1, blocker.toughness));
        if (toBlocker >= blocker.toughness) blocker.toughness = 0; // marked for death
        perm.damage += blocker.power;
        if (blocker.lifelink) target.life += blocker.power;
        this.say(`${this.name(perm)} is blocked by ${blocker.name}`);
        dmg = trample ? dmg - toBlocker : 0;
      }
      if (dmg <= 0) continue;
      if (this.team.infect) {
        target.poison += dmg;
        this.usedPoison = true;
      } else target.life -= dmg;
      dealt.push(perm);
      this.say(`${this.name(perm)} hits for ${dmg}${this.team.infect ? ' poison' : ''}`);
    }
    this.afterCombat(attacks.map((a) => a.target));
    this.checkWin('combat');
    // Combat-damage triggers: the Pride's "draw cards equal to its toughness", Ohran Frostfang.
    for (const p of dealt) {
      if (this.over()) return;
      if (p.eot.drawOnHit) this.draw(Math.max(0, this.toughness(p)), `${this.name(p)} connects`);
    }
    for (const src of this.onBattlefield((x) => !!x.combatDamageDraw)) {
      const c = this.def(src.def).combatDamageDraw!;
      const n = c.scope === 'self' ? (dealt.includes(src) ? c.n : 0) : c.scope === 'team' ? dealt.length * c.n : c.scope === 'artifact_creatures' ? (dealt.some((p) => !p.token && this.def(p.def).types.artifact) ? c.n : 0) : 0;
      if (n && !this.over()) this.draw(n, this.def(src.def).name);
    }
  }

  /** Matchups: remove dead creatures after combat. */
  protected afterCombat(_targets: Opponent[]) {}

  // ---------------- turn structure ----------------
  beginTurn() {
    this.turn++;
    this.landPlayed = false;
    for (const p of this.bf) {
      p.tapped = false;
      p.sick = false;
      p.eot = EOT();
      p.attackTarget = null;
      p.usedThisTurn.clear();
    }
    this.team = { infect: false, power: 0, toughness: 0, trample: false };
    if (this.s.log) {
      this.current = { turn: this.turn, hand: [], events: [], board: [], opponents: '' };
      this.logs.push(this.current);
    }
    // Upkeep: repeating draw engines and token makers, custom upkeep effects.
    for (const p of [...this.bf]) {
      if (p.token) continue;
      const d = this.def(p.def);
      if (d.draw?.perTurn) this.draw(d.draw.perTurn, d.name);
      if (d.tokenMaker?.trigger === 'upkeep') this.makeTokens(d);
      for (const c of d.custom) if (c.when === 'upkeep') this.customEffect(p, c);
      if (this.over()) return;
    }
    if (this.turn > 1 || this.s.drawOnTurnOne) this.draw(1, 'draw step', true);
    if (this.current) this.current.hand = this.hand.map((i) => this.def(i).name);
  }
  endTurn(maxHand = 7) {
    this.endPhase();
    const noMax = this.has((d) => d.noMaxHandSize);
    if (!noMax && this.hand.length > maxHand) this.discardWorst(this.hand.length - maxHand);
    // Damage on creatures and end-of-turn effects wear off at cleanup.
    this.landsByTurn.push(this.lands().length);
    const cs = this.creatures();
    const flies = (p: Perm) => (p.token ? p.token.flying : this.def(p.def).keywords.flying);
    this.boardByTurn.push({
      power: cs.reduce((a, p) => a + Math.max(0, this.power(p)), 0),
      flying: cs.filter(flies).reduce((a, p) => a + Math.max(0, this.power(p)), 0),
      trample: cs.filter((p) => !p.token && this.def(p.def).keywords.trample).reduce((a, p) => a + Math.max(0, this.power(p)), 0),
      creatures: cs.length,
    });
    for (const p of this.bf) if (!(!p.token && this.def(p.def).damageRedirect)) p.damage = 0;
    if (this.turn === 6) {
      this.cardsSeenBy6 = this.cardsSeen;
      this.landsSeenBy6 = this.landsSeen;
    }
    this.extraDrawnByTurn.push(this.extraDrawn);
    if (this.current) {
      this.current.board = this.bf.map((p) => (this.isCreature(p) ? `${this.name(p)} ${this.power(p)}/${this.toughness(p)}` : this.name(p)));
      this.current.opponents = this.opps.map((o) => (o.poison ? `${o.life} life, ${o.poison} poison` : `${o.life} life`)).join(' · ');
    }
  }
  /** Commander Spellbook combos: assembled when every piece is on the battlefield (or an instant/sorcery in hand) with mana to spare. */
  checkCombos() {
    if (this.comboTurn !== null || !this.s.combos.length) return;
    const onBf = new Set(this.bf.filter((p) => !p.token).map((p) => p.def));
    for (const c of this.s.combos) {
      const ready = c.cards.every((i) => onBf.has(i) || (this.hand.includes(i) && !this.def(i).permanent));
      if (!ready || this.manaAvailable('ability') < c.manaNeeded) continue;
      if (this.comboDisrupted(c.cards)) return;
      this.comboTurn = this.turn;
      this.comboLabel = c.label;
      this.say(`combo assembled: ${c.label}`);
      if (this.s.comboWins && this.winTurn === null) {
        this.winTurn = this.turn;
        this.winType = 'combo';
      }
      return;
    }
  }
}
