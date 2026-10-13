// A deck reduced to what the mana and hand tools need, built from card data + resolved tags.
// Plain data (no functions) so it can be posted to a Web Worker.

import type { Color, DeckList, ScryfallCard } from '../data/types';
import { COLORS } from '../data/types';
import { playedFace } from '../data/names';
import type { CardTags, TagKey } from '../tags/schema';
import { CUSTOM_KEYS } from '../tags/schema';
import { parseManaCost, reduceGeneric, type ManaCost } from './manaCost';

export type Role = 'land' | 'ramp' | 'draw' | 'interaction' | 'creature' | 'other';
export const ROLES: Role[] = ['land', 'ramp', 'draw', 'interaction', 'creature', 'other'];
export const ROLE_LABELS: Record<Role, string> = {
  land: 'Lands', ramp: 'Ramp', draw: 'Card draw', interaction: 'Interaction', creature: 'Creatures', other: 'Other',
};

export type SourceKind = 'land' | 'rock' | 'dork' | 'aura';

export interface ModelCard {
  name: string;
  qty: number;
  mv: number;
  cost: ManaCost;
  isLand: boolean;
  isCreature: boolean;
  role: Role;
  /** Colors this card can make (within the deck's identity), and how. */
  produces: Color[];
  sourceKind: SourceKind | null;
  entersTapped: 'no' | 'yes' | 'conditional';
  /** Mana a rock/dork adds each turn (after paying its activation cost). 0 for lands. */
  rampAmount: number;
  rampPerDefender: boolean;
  rampPerToughness: boolean;
  /** The mana can't pay for spells from hand (Enigma Jewel, Vhal). */
  rampRestricted: boolean;
  toughness: number;
  defender: boolean;
  /** Extra lands put onto the battlefield when cast (Rampant Growth = 1). */
  rampLands: number;
  rampLandsTapped: boolean;
  fetchesBasic: boolean;
  /** Cost reduces with the board (the Pride): the mana tool can't time it, the goldfish can. */
  boardDependentCost: boolean;
}

export interface CommanderAbility {
  label: string;
  cost: ManaCost;
  /** Cost after the deck's ability-cost reducers (Training Grounds, Biomancer's Familiar). */
  reducedCost: ManaCost | null;
}

export interface DeckModel {
  identity: Color[];
  commanders: ModelCard[];
  /** The 99 (or 98), one entry per distinct card with qty. */
  library: ModelCard[];
  librarySize: number;
  commanderAbilities: CommanderAbility[];
  /** Colors basic lands in the deck can fetch. */
  basicColors: Color[];
}

const BASIC_COLOR: Record<string, Color> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
const RAMP_TAGS: TagKey[] = ['ramp_rock', 'ramp_dork', 'ramp_land_aura', 'ramp_spell', 'ritual', 'treasure', 'extra_land_drop', 'mana_filter', 'mana_grant'];
const DRAW_TAGS: TagKey[] = [
  'draw_n', 'etb_draw', 'activated_draw', 'repeat_draw', 'loot', 'dig', 'impulse', 'wheel', 'creature_etb_draw', 'death_draw',
  'combat_damage_draw', 'grant_toughness_draw', 'draw_doubler', 'play_from_top', 'clue', 'tutor',
];
const INTERACTION_TAGS: TagKey[] = ['spot_removal', 'board_wipe', 'counterspell', 'protection', 'aetherize', 'fog', 'attack_tax'];

function roleOf(tags: CardTags, isLand: boolean, isCreature: boolean): Role {
  if (isLand) return 'land';
  if (RAMP_TAGS.some((t) => tags[t])) return 'ramp';
  if (INTERACTION_TAGS.some((t) => tags[t])) return 'interaction';
  if (DRAW_TAGS.some((t) => tags[t])) return 'draw';
  if (isCreature) return 'creature';
  return 'other';
}

function colorsIn(s: string, identity: Set<Color>): Color[] {
  return COLORS.filter((c) => s.toUpperCase().includes(c) && identity.has(c));
}

export function modelCard(card: ScryfallCard, qty: number, tags: CardTags, identity: Set<Color>, basicColors: Color[]): ModelCard {
  const face = playedFace(card);
  const type = face.type_line;
  const isLand = !!tags.land || /\bLand\b/.test(type);
  const isCreature = /\bCreature\b/.test(type);
  const cost = parseManaCost(face.mana_cost);
  const p = (k: TagKey) => tags[k]?.params ?? {};

  let sourceKind: SourceKind | null = null;
  let rampAmount = 0;
  if (isLand) sourceKind = 'land';
  else if (tags.ramp_dork) {
    sourceKind = 'dork';
    rampAmount = Number(p('ramp_dork').amount) - parseManaCost(String(p('ramp_dork').cost ?? '')).mv;
  } else if (tags.ramp_rock) {
    sourceKind = 'rock';
    rampAmount = Number(p('ramp_rock').amount) - parseManaCost(String(p('ramp_rock').cost ?? '')).mv;
  } else if (tags.ramp_land_aura) {
    sourceKind = 'aura';
    rampAmount = Number(p('ramp_land_aura').amount);
  }

  let produces = colorsIn(String(p('produces_colors').colors ?? ''), identity);
  if (tags.land_fetch) produces = [...new Set([...produces, ...basicColors])];

  return {
    name: card.name,
    qty,
    mv: card.cmc,
    cost,
    isLand,
    isCreature,
    role: roleOf(tags, isLand, isCreature),
    produces: sourceKind ? produces : [],
    sourceKind,
    entersTapped: tags.enters_tapped ? (p('enters_tapped').conditional ? 'conditional' : 'yes') : 'no',
    rampAmount: Math.max(0, rampAmount),
    rampPerDefender: !!p('ramp_dork').per_defender,
    rampPerToughness: !!p('ramp_dork').per_toughness,
    rampRestricted: !!p('ramp_rock').abilities_only || !!p('ramp_dork').restricted,
    toughness: Number(p('toughness').value ?? 0),
    defender: !!tags.defender,
    rampLands: tags.ramp_spell ? Number(p('ramp_spell').lands) : 0,
    rampLandsTapped: tags.ramp_spell ? !!p('ramp_spell').tapped : true,
    fetchesBasic: !!tags.land_fetch,
    boardDependentCost: !!tags.self_cost_reduction && p('self_cost_reduction').by !== 'control_turtle' && p('self_cost_reduction').by !== 'other',
  };
}

/** Colored activated costs on the commander(s): the ones a mana base has to support every turn. */
function commanderAbilities(cards: ScryfallCard[], tagsOf: (c: ScryfallCard) => CardTags, reducer: number): CommanderAbility[] {
  const out: CommanderAbility[] = [];
  const keys: TagKey[] = ['grant_toughness_draw', 'defender_can_attack', 'activated_draw', 'unblockable_enabler', 'untapper', 'sac_for_toughness_token', ...CUSTOM_KEYS];
  for (const card of cards) {
    const tags = tagsOf(card);
    const seen = new Set<string>();
    for (const k of keys) {
      const t = tags[k];
      const costText = String(t?.params.cost ?? '');
      if (!t || !costText || seen.has(costText)) continue;
      const cost = parseManaCost(costText);
      if (!Object.values(cost.pips).some((x) => x > 0)) continue;
      seen.add(costText);
      const creatureAbility = t.params.creature_ability !== false && /Creature/.test(playedFace(card).type_line);
      out.push({
        label: `${card.name}: ${costText}`,
        cost,
        reducedCost: reducer && creatureAbility ? reduceGeneric(cost, reducer) : null,
      });
    }
  }
  return out;
}

export function buildDeckModel(
  list: DeckList,
  lookup: (name: string) => ScryfallCard | undefined,
  tagsFor: (name: string) => CardTags | undefined,
): DeckModel {
  const commanderCards = list.commanders.map(lookup).filter((c): c is ScryfallCard => !!c);
  const identity = new Set<Color>(commanderCards.flatMap((c) => c.color_identity as Color[]));
  const basicColors = [...new Set(list.cards.map((e) => BASIC_COLOR[e.name]).filter((c): c is Color => !!c && identity.has(c)))];
  const model = (name: string, qty: number) => {
    const c = lookup(name);
    return c ? modelCard(c, qty, tagsFor(name) ?? {}, identity, basicColors) : null;
  };
  const library = list.cards.map((e) => model(e.name, e.qty)).filter((c): c is ModelCard => !!c);
  // Ability cost reducers in the 99 (Training Grounds, Biomancer's Familiar): the biggest one applies.
  const reducer = Math.max(0, ...list.cards.map((e) => Number(tagsFor(e.name)?.cost_reducer_abilities?.params.amount ?? 0)));
  return {
    identity: COLORS.filter((c) => identity.has(c)),
    commanders: list.commanders.map((n) => model(n, 1)).filter((c): c is ModelCard => !!c),
    library,
    librarySize: library.reduce((a, c) => a + c.qty, 0),
    commanderAbilities: commanderAbilities(commanderCards, (c) => tagsFor(c.name) ?? {}, reducer),
    basicColors,
  };
}

/** One entry per physical card, for shuffling. */
export function expandLibrary(m: DeckModel): ModelCard[] {
  return m.library.flatMap((c) => Array.from({ length: c.qty }, () => c));
}
