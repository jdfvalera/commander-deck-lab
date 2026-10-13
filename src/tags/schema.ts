// The tag vocabulary. Tags are what the engine understands about a card. They are auto-detected
// from oracle text (autoTag.ts) and can be edited by the user (overrides.ts). A tag's params are
// plain numbers/booleans/strings so the editor can render them generically.

export type ParamType = 'number' | 'boolean' | 'text' | 'cost' | 'colors' | readonly string[];
export type ParamValue = number | boolean | string;
export type TagParams = Record<string, ParamValue>;

export type TagGroup = 'mana' | 'body' | 'plan' | 'flow' | 'interaction' | 'meta';

export interface TagDef {
  group: TagGroup;
  label: string;
  help: string;
  params?: Record<string, { type: ParamType; default: ParamValue; help?: string }>;
}

const n = (d: number, help?: string) => ({ type: 'number' as const, default: d, help });
const b = (d = false, help?: string) => ({ type: 'boolean' as const, default: d, help });
const cost = (d = '', help?: string) => ({ type: 'cost' as const, default: d, help });
const one = <T extends string>(opts: readonly T[], d: T, help?: string) => ({ type: opts, default: d, help });

export const TAG_DEFS = {
  // ---- mana ----
  land: { group: 'mana', label: 'Land', help: 'Played as a land drop.' },
  enters_tapped: { group: 'mana', label: 'Enters tapped', help: 'Can’t be used the turn it enters.', params: { conditional: b(false, 'Only sometimes (e.g. "unless you control two or more other lands").') } },
  produces_colors: { group: 'mana', label: 'Produces colors', help: 'Which colors of mana this source can make. WUBRG and C.', params: { colors: { type: 'colors', default: '' } } },
  ramp_rock: { group: 'mana', label: 'Mana rock', help: 'Noncreature artifact that taps for mana.', params: { amount: n(1), abilities_only: b(false, 'Mana can only be spent on activated abilities.') } },
  ramp_dork: { group: 'mana', label: 'Mana creature', help: 'Creature that taps for mana. Summoning sick the turn it enters; can’t attack and tap for mana.', params: { amount: n(1), per_defender: b(false, 'Makes one mana per creature with defender you control.'), shrinks: b(false, 'Pays by shrinking its own toughness (Wall of Roots); doesn’t tap.') } },
  ramp_land_aura: { group: 'mana', label: 'Land aura ramp', help: 'Aura that adds extra mana when the enchanted land taps.', params: { amount: n(1) } },
  ramp_spell: { group: 'mana', label: 'Ramp spell', help: 'Puts extra lands onto the battlefield.', params: { lands: n(1), tapped: b(true) } },
  land_fetch: { group: 'mana', label: 'Fetch land', help: 'Sacrifices itself to fetch a basic land.', params: { tapped: b(true) } },
  no_max_hand_size: { group: 'mana', label: 'No max hand size', help: 'You keep every card at cleanup.' },

  // ---- body ----
  power: { group: 'body', label: 'Power', help: 'Printed power (edit to model static bonuses).', params: { value: n(0) } },
  toughness: { group: 'body', label: 'Toughness', help: 'Printed toughness.', params: { value: n(0) } },
  hand_size_pt: { group: 'body', label: 'P/T = hand size', help: 'Power and toughness equal the number of cards in your hand.' },
  defender: { group: 'body', label: 'Defender', help: 'Can’t attack unless something lets it.' },
  flying: { group: 'body', label: 'Flying', help: 'Only blockable by flying or reach.' },
  reach: { group: 'body', label: 'Reach', help: 'Can block fliers.', params: { cost: cost('', 'If set, reach must be bought each turn with this activation.') } },
  vigilance: { group: 'body', label: 'Vigilance', help: 'Doesn’t tap to attack.' },
  trample: { group: 'body', label: 'Trample', help: 'Excess combat damage goes through blockers.' },
  haste: { group: 'body', label: 'Haste', help: 'Can attack and tap the turn it enters.' },
  flash: { group: 'body', label: 'Flash', help: 'Can be cast at instant speed.' },
  deathtouch: { group: 'body', label: 'Deathtouch', help: 'Any damage it deals is lethal.' },
  shroud: { group: 'body', label: 'Shroud', help: 'Can’t be the target of ANY spell or ability, including yours (the Pride can’t target it).' },
  hexproof: { group: 'body', label: 'Hexproof', help: 'Can’t be targeted by opponents. Your own abilities still work.' },
  ward: { group: 'body', label: 'Ward', help: 'Opponents’ spells targeting it are countered unless they pay.', params: { cost: n(2) } },
  indestructible: { group: 'body', label: 'Indestructible', help: 'Not destroyed by damage or “destroy” effects.' },
  unblockable: { group: 'body', label: 'Can’t be blocked', help: 'This creature can’t be blocked.' },

  // ---- plan pieces ----
  self_cost_reduction: { group: 'plan', label: 'Self cost reduction', help: 'This spell costs less (the Pride: X = total toughness of your creatures).', params: { by: one(['total_toughness', 'control_turtle'] as const, 'total_toughness'), amount: n(0, 'Fixed reduction, when not by total toughness.') } },
  grant_toughness_draw: { group: 'plan', label: 'Grants “draw = toughness”', help: 'Activated: target creature gets +1/+0, can attack despite defender, and draws cards equal to its toughness on combat damage to a player.', params: { cost: cost('{2}{U}{U}'), creature_ability: b(true, 'Reduced by Training Grounds / Biomancer’s Familiar.') } },
  butt_damage: { group: 'plan', label: 'Damage = toughness', help: 'Creatures assign combat damage equal to toughness.', params: { scope: one(['self', 'team', 'team_t_gt_p', 'enchanted', 'target'] as const, 'team') } },
  defender_can_attack: { group: 'plan', label: 'Lets defenders attack', help: 'Pays to let a creature with defender attack.', params: { cost: cost('{2}'), scope: one(['target', 'team'] as const, 'target'), haste: b(false), butt: b(false, 'Also assigns damage equal to toughness.'), creature_ability: b(false), sorcery: b(false) } },
  mass_infect: { group: 'plan', label: 'Mass infect', help: 'Your creatures gain infect: combat damage to players is poison counters (10 kills).' },
  team_pump: { group: 'plan', label: 'Team pump', help: 'Your creatures get +P/+T.', params: { power: n(1), toughness: n(1), trample: b(false), until_eot: b(true), min_lands: n(0, 'Only while you control at least this many lands.') } },
  team_toughness_pump: { group: 'plan', label: 'Team toughness pump', help: 'Your creatures get +0/+X (e.g. Tower Defense).', params: { amount: n(5), reach: b(false), cost: cost('', 'Activation cost, if it’s an ability rather than a spell.') } },
  unblockable_enabler: { group: 'plan', label: 'Unblockable enabler', help: 'Makes a creature unblockable.', params: { cost: cost('{0}'), kind: one(['activated', 'land', 'equip', 'attack_trigger'] as const, 'activated'), max_power: n(0, '0 = no limit.'), tap: b(true), discard: b(false), sacrifice: b(false), walls_can_block: b(false) } },
  small_unblockable_grant: { group: 'plan', label: 'Small creatures unblockable', help: 'Your creatures with power or toughness ≤ N can’t be blocked (Tetsuko).', params: { max: n(1) } },
  cost_reducer_abilities: { group: 'plan', label: 'Ability cost reducer', help: 'Creature activated abilities cost less (never below one mana).', params: { amount: n(2) } },
  draw_payoff_ping: { group: 'plan', label: 'Draw → opponents lose life', help: 'Whenever you draw, each opponent loses life.', params: { amount: n(1) } },
  draw_doubler: { group: 'plan', label: 'Draw doubler', help: 'Draws (except the first in your draw step) become two.' },
  combat_damage_draw: { group: 'plan', label: 'Combat damage → draw', help: 'Whenever a creature you control deals combat damage to a player, draw.', params: { n: n(1) } },
  recursion: { group: 'plan', label: 'Recursion', help: 'Returns a card from graveyard to hand.', params: { filter: one(['any', 'instant_sorcery', 'creature', 'permanent'] as const, 'any'), etb: b(false) } },
  haste_enabler: { group: 'plan', label: 'Haste enabler', help: 'Gives creatures haste.', params: { scope: one(['team', 'equipped'] as const, 'team'), tap: b(true) } },
  equipment: { group: 'plan', label: 'Equipment', help: 'Attaches to a creature (sorcery speed).', params: { equip: n(2), haste: b(false), shroud: b(false), hexproof: b(false) } },
  aura: { group: 'plan', label: 'Aura bonus', help: 'Enchanted creature gets these.', params: { power: n(0), toughness: n(0), flying: b(false), butt: b(false), umbra_armor: b(false) } },
  sac_for_toughness_token: { group: 'plan', label: 'Sac → X/X token', help: 'Sacrifice another creature to make ONE X/X token, X = its toughness (Geralf).', params: { cost: cost('{U}'), flying: b(true) } },
  copy_unblockable: { group: 'plan', label: 'Copy, stays unblockable', help: 'Becomes a copy of another creature but stays 1/4 unblockable (Cephalid Facetaker). Copying a legend loses one to the legend rule.' },
  damage_redirect: { group: 'plan', label: 'Damage redirect', help: 'All damage to you and your other permanents is dealt to this instead; damage stays on it (Ancient Adamantoise).' },
  etb_dig: { group: 'plan', label: 'ETB dig', help: 'When a qualifying creature enters, top card: land onto battlefield tapped, otherwise to hand (Fecund Greenshell).', params: { condition: one(['t_gt_p', 'any'] as const, 't_gt_p') } },
  proliferate: { group: 'plan', label: 'Proliferate', help: 'Adds one more of each counter (finishes 8–9 poison).', params: { cost: cost('{4}') } },
  target_tax: { group: 'plan', label: 'Targeting tax', help: 'Opponents’ spells that target it cost more.', params: { amount: n(2), scope: one(['self', 'commanders'] as const, 'self') } },
  team_hexproof: { group: 'plan', label: 'Team hexproof', help: 'Your creatures have hexproof.', params: { when: one(['always', 'your_turn'] as const, 'your_turn') } },

  // ---- card flow ----
  draw_n: { group: 'flow', label: 'Draw N', help: 'Draws cards when cast.', params: { n: n(1) } },
  etb_draw: { group: 'flow', label: 'ETB draw', help: 'Draws when it enters.', params: { n: n(1) } },
  creature_etb_draw: { group: 'flow', label: 'Creature ETB draw', help: 'Draw whenever a (differently named) nontoken creature enters under your control.' },

  // ---- interaction ----
  board_wipe: { group: 'interaction', label: 'Board wipe', help: 'Removes many creatures at once.', params: { kind: one(['destroy', 'damage', 'exile', 'bounce', 'toughness_le', 'minus'] as const, 'destroy'), x: n(0, 'Damage / toughness threshold, 0 = all.'), artifacts: b(false, 'Also hits noncreature artifacts.') } },
  spot_removal: { group: 'interaction', label: 'Spot removal', help: 'Removes one target.', params: { kind: one(['destroy', 'exile', 'bounce', 'damage', 'tuck'] as const, 'destroy'), targets: one(['creature', 'permanent', 'nonland', 'artifact_enchantment'] as const, 'creature') } },
  counterspell: { group: 'interaction', label: 'Counterspell', help: 'Counters a spell.', params: { scope: one(['any', 'noncreature', 'instant', 'instant_sorcery', 'creature'] as const, 'any'), soft: b(false, 'Opponent can pay to avoid it.') } },
  protection: { group: 'interaction', label: 'Protection', help: 'Saves your board or a key piece.', params: { kind: one(['team_hexproof_indestructible', 'single_hexproof_indestructible', 'uncounterable', 'equip_shroud'] as const, 'team_hexproof_indestructible') } },
  aetherize: { group: 'interaction', label: 'Aetherize effect', help: 'Returns all attacking creatures to hand.' },
  attack_tax: { group: 'interaction', label: 'Attack tax', help: 'Creatures can’t attack you unless their controller pays per creature (Propaganda).', params: { per: n(2) } },
  fog: { group: 'interaction', label: 'Fog', help: 'Prevents combat damage this turn.' },

  // ---- meta ----
  unmodelled: { group: 'meta', label: 'Unmodelled text', help: 'Oracle text the simulator ignores. Edit tags if this matters.', params: { text: { type: 'text', default: '' } } },
} satisfies Record<string, TagDef>;

export type TagKey = keyof typeof TAG_DEFS;
export const TAG_KEYS = Object.keys(TAG_DEFS) as TagKey[];

export interface TagValue {
  source: 'auto' | 'manual';
  params: TagParams;
}
export type CardTags = Partial<Record<TagKey, TagValue>>;

export function isTagKey(k: string): k is TagKey {
  return k in TAG_DEFS;
}

/** Fills in default params for a tag. */
export function withDefaults(key: TagKey, params: TagParams = {}): TagParams {
  const defs = (TAG_DEFS[key] as TagDef).params ?? {};
  const out: TagParams = {};
  for (const [p, d] of Object.entries(defs)) out[p] = params[p] ?? d.default;
  return out;
}
