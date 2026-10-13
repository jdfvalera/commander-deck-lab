// Card definitions for the game engine: everything the goldfish knows about a card, compiled from
// Scryfall data + resolved tags. Never from the card's name: a card behaves the way its tags say.

import type { Color, DeckList, ScryfallCard } from '../data/types';
import { COLORS } from '../data/types';
import { playedFace } from '../data/names';
import { CUSTOM_KEYS, type CardTags, type TagKey, type TagParams } from '../tags/schema';
import { modelCard, type ModelCard } from './deckModel';
import { parseManaCost, type ManaCost } from './manaCost';

export interface CustomEffect {
  when: string;
  cost: ManaCost;
  tap: boolean;
  effect: string;
  amount: number;
  colors: Color[];
  power: number;
  toughness: number;
  target: string;
  oncePerTurn: boolean;
}

export interface CardDef extends ModelCard {
  idx: number;
  types: { creature: boolean; land: boolean; artifact: boolean; enchantment: boolean; instant: boolean; sorcery: boolean; planeswalker: boolean; aura: boolean; equipment: boolean };
  permanent: boolean;
  legendary: boolean;
  power: number;
  keywords: { defender: boolean; flying: boolean; reach: boolean; haste: boolean; vigilance: boolean; trample: boolean; shroud: boolean; hexproof: boolean; unblockable: boolean; indestructible: boolean };
  handSizePT: boolean;
  /** Mana an ability-only rock/dork makes, usable just for activated abilities (Enigma Jewel). */
  abilitiesOnlyMana: boolean;
  shrinksForMana: boolean;
  // ---- plan pieces (params straight from tags) ----
  selfCost: { by: string; amount: number } | null;
  grantToughnessDraw: ManaCost | null;
  defenderCanAttack: { cost: ManaCost; haste: boolean; butt: boolean; creatureAbility: boolean; scope: string } | null;
  butt: string | null;
  massInfect: boolean;
  teamPumpEot: { power: number; toughness: number; trample: boolean } | null;
  teamPumpStatic: { power: number; toughness: number; minLands: number } | null;
  teamToughnessPump: { amount: number; reach: boolean; cost: ManaCost | null } | null;
  costReducerAbilities: number;
  drawPing: number;
  drawDoubler: boolean;
  combatDamageDraw: { n: number; scope: string } | null;
  recursion: { filter: string; etb: boolean } | null;
  hasteEnabler: { scope: string; tap: boolean } | null;
  equipment: { equip: number; power: number; toughness: number; haste: boolean; shroud: boolean; hexproof: boolean } | null;
  aura: { power: number; toughness: number; flying: boolean; butt: boolean } | null;
  sacForToken: { cost: ManaCost; flying: boolean } | null;
  etbDig: string | null;
  proliferate: ManaCost | null;
  creatureEtbDraw: boolean;
  tokenMaker: { count: number; power: number; toughness: number; flying: boolean; trigger: string; cost: ManaCost } | null;
  counters: { n: number; scope: string } | null;
  noMaxHandSize: boolean;
  /** Instants and others the goldfish never casts (no opponents to point them at). */
  interaction: boolean;
  protection: boolean;
  drain: { amount: number; trigger: string } | null;
  custom: CustomEffect[];
  unmodelled: boolean;
}

const cost = (s: unknown): ManaCost => parseManaCost(String(s ?? ''));

function customEffects(tags: CardTags, identity: Set<Color>): CustomEffect[] {
  const out: CustomEffect[] = [];
  for (const k of CUSTOM_KEYS) {
    const p = tags[k]?.params;
    if (!p) continue;
    out.push({
      when: String(p.when),
      cost: cost(p.cost),
      tap: !!p.tap,
      effect: String(p.effect),
      amount: Number(p.amount) || 0,
      colors: COLORS.filter((c) => String(p.colors).toUpperCase().includes(c) && identity.has(c)),
      power: Number(p.power) || 0,
      toughness: Number(p.toughness) || 0,
      target: String(p.target),
      oncePerTurn: !!p.once_per_turn,
    });
  }
  return out;
}

export function compileCard(card: ScryfallCard, tags: CardTags, identity: Set<Color>, basicColors: Color[], idx: number): CardDef {
  const base = modelCard(card, 1, tags, identity, basicColors);
  const type = playedFace(card).type_line;
  const has = (k: TagKey) => !!tags[k];
  const p = (k: TagKey): TagParams => tags[k]?.params ?? {};
  const types = {
    creature: /\bCreature\b/.test(type),
    land: base.isLand,
    artifact: /\bArtifact\b/.test(type),
    enchantment: /\bEnchantment\b/.test(type),
    instant: /\bInstant\b/.test(type),
    sorcery: /\bSorcery\b/.test(type),
    planeswalker: /\bPlaneswalker\b/.test(type),
    aura: /\bAura\b/.test(type),
    equipment: /\bEquipment\b/.test(type),
  };
  const dca = tags.defender_can_attack ? p('defender_can_attack') : null;
  return {
    ...base,
    idx,
    types,
    permanent: !types.instant && !types.sorcery,
    legendary: /\bLegendary\b/.test(type),
    power: Number(p('power').value ?? 0),
    keywords: {
      defender: has('defender'), flying: has('flying'), reach: has('reach') && !p('reach').cost, haste: has('haste'), vigilance: has('vigilance'),
      trample: has('trample'), shroud: has('shroud'), hexproof: has('hexproof'), unblockable: has('unblockable'), indestructible: has('indestructible'),
    },
    handSizePT: has('hand_size_pt'),
    abilitiesOnlyMana: !!p('ramp_rock').abilities_only,
    shrinksForMana: !!p('ramp_dork').shrinks,
    selfCost: tags.self_cost_reduction ? { by: String(p('self_cost_reduction').by), amount: Number(p('self_cost_reduction').amount) } : null,
    grantToughnessDraw: tags.grant_toughness_draw ? cost(p('grant_toughness_draw').cost) : null,
    defenderCanAttack: dca ? { cost: cost(dca.cost), haste: !!dca.haste, butt: !!dca.butt, creatureAbility: !!dca.creature_ability, scope: String(dca.scope) } : null,
    butt: tags.butt_damage ? String(p('butt_damage').scope) : null,
    massInfect: has('mass_infect'),
    teamPumpEot: tags.team_pump && p('team_pump').until_eot ? { power: Number(p('team_pump').power), toughness: Number(p('team_pump').toughness), trample: !!p('team_pump').trample } : null,
    teamPumpStatic: tags.team_pump && !p('team_pump').until_eot ? { power: Number(p('team_pump').power), toughness: Number(p('team_pump').toughness), minLands: Number(p('team_pump').min_lands) } : null,
    teamToughnessPump: tags.team_toughness_pump
      ? { amount: Number(p('team_toughness_pump').amount), reach: !!p('team_toughness_pump').reach, cost: p('team_toughness_pump').cost ? cost(p('team_toughness_pump').cost) : null }
      : null,
    costReducerAbilities: Number(p('cost_reducer_abilities').amount ?? 0),
    drawPing: tags.draw_payoff_ping ? Number(p('draw_payoff_ping').amount) || 1 : 0,
    drawDoubler: has('draw_doubler'),
    combatDamageDraw: tags.combat_damage_draw ? { n: Number(p('combat_damage_draw').n) || 1, scope: String(p('combat_damage_draw').scope) } : null,
    recursion: tags.recursion ? { filter: String(p('recursion').filter), etb: !!p('recursion').etb } : null,
    hasteEnabler: tags.haste_enabler ? { scope: String(p('haste_enabler').scope), tap: !!p('haste_enabler').tap } : null,
    equipment: tags.equipment
      ? { equip: Number(p('equipment').equip), power: Number(p('equipment').power ?? 0), toughness: Number(p('equipment').toughness ?? 0), haste: !!p('equipment').haste, shroud: !!p('equipment').shroud, hexproof: !!p('equipment').hexproof }
      : null,
    aura: tags.aura && types.aura ? { power: Number(p('aura').power), toughness: Number(p('aura').toughness), flying: !!p('aura').flying, butt: !!p('aura').butt } : null,
    sacForToken: tags.sac_for_toughness_token ? { cost: cost(p('sac_for_toughness_token').cost), flying: !!p('sac_for_toughness_token').flying } : null,
    etbDig: tags.etb_dig ? String(p('etb_dig').condition) : null,
    proliferate: tags.proliferate ? cost(p('proliferate').cost) : null,
    creatureEtbDraw: has('creature_etb_draw'),
    tokenMaker: tags.token_maker
      ? { count: Number(p('token_maker').count), power: Number(p('token_maker').power), toughness: Number(p('token_maker').toughness), flying: !!p('token_maker').flying, trigger: String(p('token_maker').trigger), cost: cost(p('token_maker').cost) }
      : null,
    counters: tags.counters ? { n: Number(p('counters').n), scope: String(p('counters').scope) } : null,
    noMaxHandSize: has('no_max_hand_size'),
    interaction: has('counterspell') || has('spot_removal') || has('board_wipe') || has('aetherize') || has('fog'),
    protection: has('protection') && !tags.equipment,
    drain: tags.drain ? { amount: Number(p('drain').amount), trigger: String(p('drain').trigger) } : null,
    custom: customEffects(tags, identity),
    unmodelled: has('unmodelled'),
  };
}

export interface CompiledDeck {
  defs: CardDef[];
  /** Library as def indices, in a canonical order (sorted by name) before shuffling. */
  library: number[];
  commanders: number[];
  identity: Color[];
  basicColors: Color[];
}

const BASIC_COLOR: Record<string, Color> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

export function compileDeck(
  list: DeckList,
  lookup: (name: string) => ScryfallCard | undefined,
  tagsFor: (name: string) => CardTags | undefined,
): CompiledDeck {
  const commanderCards = list.commanders.map(lookup).filter((c): c is ScryfallCard => !!c);
  const identity = new Set<Color>(commanderCards.flatMap((c) => c.color_identity as Color[]));
  const basicColors = [...new Set(list.cards.map((e) => BASIC_COLOR[e.name]).filter((c): c is Color => !!c && identity.has(c)))];
  const defs: CardDef[] = [];
  const byName = new Map<string, number>();
  const def = (name: string) => {
    const c = lookup(name);
    if (!c) return -1;
    let i = byName.get(c.name);
    if (i === undefined) {
      i = defs.length;
      defs.push(compileCard(c, tagsFor(name) ?? {}, identity, basicColors, i));
      byName.set(c.name, i);
    }
    return i;
  };
  const commanders = list.commanders.map(def).filter((i) => i >= 0);
  const library: number[] = [];
  for (const e of [...list.cards].sort((a, b) => a.name.localeCompare(b.name))) {
    const i = def(e.name);
    if (i >= 0) for (let q = 0; q < e.qty; q++) library.push(i);
  }
  return { defs, library, commanders, identity: COLORS.filter((c) => identity.has(c)), basicColors };
}
