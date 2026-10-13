// The tag vocabulary. Tags are what the engine understands about a card. They are auto-detected
// from oracle text (autoTag.ts) and can be edited by the user (overrides.ts). A tag's params are
// plain numbers/booleans/strings so the editor can render them generically.

export type ParamType = 'number' | 'boolean' | 'text' | 'cost' | 'colors' | readonly string[];
export type ParamValue = number | boolean | string;
export type TagParams = Record<string, ParamValue>;

export type TagGroup = 'mana' | 'body' | 'plan' | 'flow' | 'interaction' | 'custom' | 'meta';

export interface TagDef {
  group: TagGroup;
  label: string;
  help: string;
  params?: Record<string, { type: ParamType; default: ParamValue; help?: string }>;
}

function n(d: number, help?: string) {
  return { type: 'number' as const, default: d, help };
}
function b(d = false, help?: string) {
  return { type: 'boolean' as const, default: d, help };
}
function cost(d = '', help?: string) {
  return { type: 'cost' as const, default: d, help };
}
function one<T extends string>(opts: readonly T[], d: T, help?: string) {
  return { type: opts, default: d, help };
}

export const CUSTOM_WHEN = ['cast', 'etb', 'activated', 'upkeep', 'cast_spell', 'attacks', 'combat_damage', 'static'] as const;
export const CUSTOM_EFFECTS = ['draw', 'add_mana', 'token', 'untap', 'pump', 'mill', 'remove', 'protect', 'tutor', 'extra_land'] as const;
export const CUSTOM_TARGETS = ['self', 'attached', 'target_creature', 'your_creatures', 'target_opponent', 'each_opponent'] as const;
const CUSTOM_HELP = 'Describe what this card does when no built-in tag fits. The simulators use it like any other tag.';
const CUSTOM_PARAMS = {
  when: one(CUSTOM_WHEN, 'activated', 'cast = when you cast it; etb = when it enters; activated = an ability you pay for; static = always on.'),
  cost: cost('', 'Mana to activate, e.g. {1} or {2}{U}. Leave empty if free.'),
  tap: b(false, 'Tapping is part of the cost.'),
  effect: one(CUSTOM_EFFECTS, 'draw'),
  amount: n(1, 'Cards, mana, tokens, or counters.'),
  colors: { type: 'colors' as const, default: '', help: 'For mana: which colors (e.g. U, GU, WUBRG). Empty = colorless.' },
  power: n(0, 'Token power, or the +power of a pump.'),
  toughness: n(0, 'Token toughness, or the +toughness of a pump.'),
  target: one(CUSTOM_TARGETS, 'self', '"attached" = the creature this aura or equipment is on.'),
  once_per_turn: b(false),
  note: { type: 'text' as const, default: '', help: 'Anything else you want to remember about this card.' },
};

export const TAG_DEFS = {
  // ---- mana ----
  land: { group: 'mana', label: 'Land', help: 'Played as a land drop.' },
  enters_tapped: { group: 'mana', label: 'Enters tapped', help: 'Can’t be used the turn it enters.', params: { conditional: b(false, 'Only sometimes (e.g. "unless you control two or more other lands").') } },
  produces_colors: { group: 'mana', label: 'Produces colors', help: 'Which colors of mana this source can make. WUBRG and C.', params: { colors: { type: 'colors', default: '' } } },
  ramp_rock: { group: 'mana', label: 'Mana rock', help: 'Noncreature permanent that taps for mana.', params: { amount: n(1), cost: cost('', 'Mana paid to activate (Signets: {1}). Net ramp = amount − cost.'), abilities_only: b(false, 'Mana can only be spent on activated abilities.') } },
  ramp_dork: { group: 'mana', label: 'Mana creature', help: 'Creature that taps for mana. Summoning sick the turn it enters; can’t attack and tap for mana.', params: { amount: n(1), cost: cost(''), per_defender: b(false, 'Makes one mana per creature with defender you control.'), per_toughness: b(false, 'Makes mana equal to its own toughness (Vhal).'), shrinks: b(false, 'Pays by shrinking its own toughness (Wall of Roots); doesn’t tap.'), restricted: b(false, 'Mana can’t be spent on spells from your hand.') } },
  mana_filter: { group: 'mana', label: 'Mana filter / storage', help: 'Converts or stores mana (Prismite, Gemstone Array). Fixes colors, adds no net mana.', params: { cost: cost('{2}') } },
  mana_grant: { group: 'mana', label: 'Grants mana abilities', help: 'Gives other permanents a mana ability (Mm’menon: artifacts tap for {U}).', params: { scope: { type: 'text', default: 'artifacts' }, restricted: b(false) } },
  ritual: { group: 'mana', label: 'Ritual', help: 'One-shot mana when cast.', params: { amount: n(1) } },
  treasure: { group: 'mana', label: 'Makes Treasure', help: 'Creates Treasure tokens (one-shot mana).', params: { n: n(1), trigger: one(['cast', 'etb', 'activated', 'repeating'] as const, 'cast') } },
  extra_land_drop: { group: 'mana', label: 'Extra land drop', help: 'Lets you play or put an extra land.' },
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
  self_cost_reduction: { group: 'plan', label: 'Self cost reduction', help: 'This spell costs less (the Pride: X = total toughness of your creatures).', params: { by: one(['total_toughness', 'control_turtle', 'other'] as const, 'total_toughness'), amount: n(0, 'Fixed reduction, when not by total toughness.') } },
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
  combat_damage_draw: { group: 'plan', label: 'Combat damage → draw', help: 'Whenever a creature you control (or this one) deals combat damage to a player, draw.', params: { n: n(1), scope: one(['team', 'self', 'equipped', 'artifact_creatures'] as const, 'team') } },
  token_maker: { group: 'plan', label: 'Makes creature tokens', help: 'Creates creature tokens.', params: { count: n(1), power: n(1), toughness: n(1), flying: b(false), trigger: one(['cast', 'etb', 'activated', 'upkeep', 'cast_trigger', 'other'] as const, 'cast'), cost: cost('') } },
  untapper: { group: 'plan', label: 'Untapper', help: 'Untaps permanents (combo piece with mana creatures).', params: { cost: cost(''), scope: { type: 'text', default: 'target creature' } } },
  tapper: { group: 'plan', label: 'Tapper', help: 'Taps a permanent (e.g. an opposing blocker).', params: { cost: cost(''), scope: { type: 'text', default: 'target creature' } } },
  play_from_top: { group: 'plan', label: 'Play from top of library', help: 'You may play cards from the top of your library (card advantage).', params: { scope: { type: 'text', default: 'lands and spells' } } },
  spell_cost_reducer: { group: 'plan', label: 'Spell cost reducer', help: 'Spells you cast cost less.', params: { amount: n(1), filter: { type: 'text', default: '' } } },
  tutor: { group: 'plan', label: 'Tutor', help: 'Searches your library for a card.', params: { filter: { type: 'text', default: '' }, to: one(['hand', 'top', 'battlefield'] as const, 'hand') } },
  reanimate: { group: 'plan', label: 'Reanimation', help: 'Returns a card from a graveyard to the battlefield.' },
  mill: { group: 'plan', label: 'Mill', help: 'Puts cards from a library into a graveyard.', params: { n: n(0, '0 = variable (X).'), target: one(['player', 'opponents', 'self'] as const, 'player') } },
  recursion: { group: 'plan', label: 'Recursion', help: 'Returns a card from graveyard to hand.', params: { filter: one(['any', 'instant_sorcery', 'creature', 'permanent'] as const, 'any'), etb: b(false) } },
  haste_enabler: { group: 'plan', label: 'Haste enabler', help: 'Gives creatures haste.', params: { scope: one(['team', 'equipped'] as const, 'team'), tap: b(true) } },
  equipment: { group: 'plan', label: 'Equipment', help: 'Attaches to a creature (sorcery speed).', params: { equip: n(2), power: n(0), toughness: n(0), haste: b(false), shroud: b(false), hexproof: b(false) } },
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
  activated_draw: { group: 'flow', label: 'Activated draw', help: 'Pay to draw (Arcane Encyclopedia, Mind Stone).', params: { cost: cost('{3}'), n: n(1), tap: b(true), sacrifice: b(false, 'Sacrifices something (itself or another permanent) as part of the cost.'), discard: n(0, 'Cards discarded after drawing (loot).') } },
  loot: { group: 'flow', label: 'Loot', help: 'Draw, then discard.', params: { draw: n(1), discard: n(1) } },
  repeat_draw: { group: 'flow', label: 'Repeating draw', help: 'Draws every turn or on a trigger.', params: { n: n(1), when: one(['upkeep', 'cast_spell', 'opponent_casts', 'end_step', 'other'] as const, 'upkeep') } },
  wheel: { group: 'flow', label: 'Wheel', help: 'Each player discards/shuffles their hand and draws a new one.', params: { n: n(7) } },
  clue: { group: 'flow', label: 'Makes Clues', help: 'Creates Clue tokens ({2}, sacrifice: draw).', params: { n: n(1) } },

  // ---- interaction ----
  board_wipe: { group: 'interaction', label: 'Board wipe', help: 'Removes many creatures at once.', params: { kind: one(['destroy', 'damage', 'exile', 'bounce', 'toughness_le', 'minus'] as const, 'destroy'), x: n(0, 'Damage / toughness threshold, 0 = all.'), artifacts: b(false, 'Also hits noncreature artifacts.'), one_sided: b(false, 'Only hits opponents’ permanents.') } },
  spot_removal: { group: 'interaction', label: 'Spot removal', help: 'Removes one target.', params: { kind: one(['destroy', 'exile', 'bounce', 'damage', 'tuck', 'edict', 'neutralize'] as const, 'destroy'), targets: one(['creature', 'permanent', 'nonland', 'artifact_enchantment'] as const, 'creature'), cost: cost('', 'Activation cost, if it’s an ability.') } },
  counterspell: { group: 'interaction', label: 'Counterspell', help: 'Counters a spell.', params: { scope: one(['any', 'noncreature', 'instant', 'instant_sorcery', 'creature', 'ability'] as const, 'any'), soft: b(false, 'Opponent can pay to avoid it.') } },
  uncounterable: { group: 'interaction', label: 'Can’t be countered', help: 'This spell can’t be countered.' },
  protection: { group: 'interaction', label: 'Protection', help: 'Saves your board or a key piece.', params: { kind: one(['team_hexproof_indestructible', 'single_hexproof_indestructible', 'uncounterable', 'equip_shroud'] as const, 'team_hexproof_indestructible') } },
  aetherize: { group: 'interaction', label: 'Aetherize effect', help: 'Returns all attacking creatures to hand.' },
  attack_tax: { group: 'interaction', label: 'Attack tax', help: 'Creatures can’t attack you unless their controller pays per creature (Propaganda).', params: { per: n(2) } },
  fog: { group: 'interaction', label: 'Fog', help: 'Prevents combat damage this turn.' },

  // ---- custom effects (user-described; up to three per card) ----
  custom_effect: { group: 'custom', label: 'Custom effect', help: CUSTOM_HELP, params: CUSTOM_PARAMS },
  custom_effect_2: { group: 'custom', label: 'Custom effect 2', help: CUSTOM_HELP, params: CUSTOM_PARAMS },
  custom_effect_3: { group: 'custom', label: 'Custom effect 3', help: CUSTOM_HELP, params: CUSTOM_PARAMS },

  // ---- meta ----
  unmodelled: { group: 'meta', label: 'Unmodelled text', help: 'Oracle text that could change a game but that the simulator doesn’t understand. Add a tag if it matters to you.', params: { text: { type: 'text', default: '' } } },
  ignored_text: { group: 'meta', label: 'Ignored text', help: 'Oracle text that doesn’t affect these simulations (life gain, creature types, looking at cards).', params: { text: { type: 'text', default: '' } } },
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

export const CUSTOM_KEYS = ['custom_effect', 'custom_effect_2', 'custom_effect_3'] as const satisfies readonly TagKey[];

/** A plain-English sentence for a custom effect, e.g. "Activated ({1}): enchanted creature gets +0/+1". */
export function describeCustom(p: TagParams): string {
  const when: Record<string, string> = {
    cast: 'When cast', etb: 'When it enters', upkeep: 'Each upkeep', cast_spell: 'Whenever you cast a spell',
    attacks: 'Whenever it attacks', combat_damage: 'On combat damage to a player', static: 'Always',
  };
  const costText = [p.cost, p.tap ? '{T}' : ''].filter(Boolean).join(', ');
  const head = p.when === 'activated' ? `Activated (${costText || 'free'})` : when[String(p.when)] ?? String(p.when);
  const target: Record<string, string> = {
    self: 'this', attached: 'the attached creature', target_creature: 'target creature', your_creatures: 'your creatures',
    target_opponent: 'target opponent', each_opponent: 'each opponent',
  };
  const t = target[String(p.target)] ?? String(p.target);
  const a = Number(p.amount);
  const sign = (x: unknown) => (Number(x) >= 0 ? `+${x}` : String(x));
  const body: Record<string, string> = {
    draw: `draw ${a} card${a === 1 ? '' : 's'}`,
    add_mana: `add ${a} mana${p.colors ? ` (${p.colors})` : ' (colorless)'}`,
    token: `create ${a} ${p.power}/${p.toughness} token${a === 1 ? '' : 's'}`,
    untap: `untap ${t}`,
    pump: `${t} gets ${sign(p.power)}/${sign(p.toughness)}`,
    mill: `${t === 'this' ? 'you mill' : `${t} mills`} ${a}`,
    remove: `remove ${t}`,
    protect: `protect ${t}`,
    tutor: 'search your library for a card',
    extra_land: 'play an extra land',
  };
  return `${head}: ${body[String(p.effect)] ?? String(p.effect)}${p.once_per_turn ? ' (once per turn)' : ''}`;
}
