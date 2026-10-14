// Oracle text -> tags. Each oracle line ("ability") is run through the rules below, first as a whole
// and then sentence by sentence. A sentence no rule understands goes into `unmodelled` when it could
// change a game, or `ignored_text` when it can't (life gain, creature types, peeking at cards), so the
// UI can show exactly what the simulator ignores. Heuristics only need to be good, not perfect: the
// tag editor fixes the rest.

import type { ScryfallCard } from '../data/types';
import { playedFace } from '../data/names';
import { TAG_DEFS, withDefaults, type CardTags, type TagKey, type TagParams } from './schema';

// Keywords that map straight to a tag.
const KEYWORD_TAGS: Record<string, TagKey> = {
  flying: 'flying', reach: 'reach', vigilance: 'vigilance', trample: 'trample', haste: 'haste',
  defender: 'defender', hexproof: 'hexproof', shroud: 'shroud', indestructible: 'indestructible',
  flash: 'flash', deathtouch: 'deathtouch', ward: 'ward',
};
// Keywords that don't change how a game plays out in this simulator.
// "Enchant" only says what an aura can attach to; the aura's own tag covers the effect.
const IRRELEVANT_KEYWORDS = new Set([
  'devoid', 'partner', 'friends forever', 'choose a background', 'enchant', 'changeling', "doctor's companion",
  // Life gain and small combat or cost tweaks: real, but they don't move goldfish or matchup numbers much.
  'lifelink', 'extort', 'prowess', 'exalted', 'cycling', 'landcycling', 'basic landcycling', 'flashback', 'convoke',
  'affinity', 'delve', 'improvise', 'kicker', 'multikicker', 'buyback', 'retrace', 'escape', 'level up', 'hideaway',
  'evolve', 'transmute', 'reconfigure', 'mentor', 'training', 'menace', 'first strike', 'double strike',
  'plainscycling', 'islandcycling', 'swampcycling', 'mountaincycling', 'forestcycling', 'encore', 'wither', 'demonstrate',
  'gift', 'gift a card', 'gift a tapped fish', 'gift an extra turn', 'gift a food', 'gift a treasure', 'bushido', 'battle cry',
  'myriad', 'melee', 'afflict', 'dethrone', 'riot', 'unearth', 'embalm', 'eternalize', 'blitz', 'dash', 'plot', 'disguise', 'foretell',
]);

const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, x: 0,
};
const num = (s: string) => NUM_WORDS[s] ?? (Number(s) || 0);
const NUM = '(a|an|one|two|three|four|five|six|seven|x|\\d+)';
const costOf = (s: string) => (s.match(/\{[^}]+\}/g) ?? []).filter((x) => x !== '{t}').join('').toUpperCase();

interface Ctx {
  tags: CardTags;
  card: ScryfallCard;
  type: string; // played face type line, lowercased
  line: string; // the whole ability line being read, lowercased
  set(key: TagKey, params?: TagParams): void;
}

/** `apply` may return false to say "this matched, but isn't what it looks like": the text stays unmodelled. */
type Rule = { re: RegExp; apply?: (m: RegExpMatchArray, ctx: Ctx) => void | false };

/** Text that doesn't matter to a goldfish or matchup simulation. Checked only when no rule understood it. */
const IGNORE: RegExp[] = [
  /^(?:(?:when|whenever|at) [^,]+, )?(?:you |each player |target player |its controller )?(?:gains?|loses?) (?:\d+|x|that much|twice that much|half [^.]*) life\b[^.]*\.?$/,
  /\bgains? life equal to\b/,
  /^(?:\{[^}]+\}(?:, )?)+(?:, \{t\})?: (?:you )?gain \d+ life\.?$/,
  /^if you would gain life, you gain twice that much life instead\.?$/,
  /^~ is also an? /,
  /\bis every creature type\b/,
  /^you may look at the top card of your library any time\.?$/,
  /^play with the top card of your library revealed\.?$/,
  /^(?:its controller|that spell's controller|its owner|that player) /,
  /^when ~ enters, return a land you control to its owner's hand\.?$/,
  /^(?:(?:when ~ enters|(?:\{[^}]+\})+(?:, \{t\})?|\{t\}), )?(?:scry|surveil) \d+\.?$/,
  /^(?:(?:\{[^}]+\})+(?:, \{t\})?|\{t\}): (?:scry|surveil) \d+\.?$/,
  /^(?:\{[^}]+\})+: ~ gets \+\d+\/\+\d+ until end of turn\.?$/,
  /^(?:if it's a [a-z]+ card, )?they put it onto the battlefield\.?$/,
  /^(?:when ~ enters, )?you become the monarch\.?$/,
  /^(?:•\s*)?regenerate (?:target creature|~)\.?$/,
  /^as ~ enters, you may pay \d+ life\.?$/,
  /^~ (?:can't block|attacks each combat if able)\.?$/,
  /^~ gets [+-]\d+\/[+-]\d+ until end of turn\.?$/,
  /^draw a card if an opponent has cast a [a-z ]+ spell this turn\.?$/,
  /\bfood tokens?\b/,
  /^(?:\{[^}]+\}(?:, )?)*\{t\}, sacrifice ~: you gain \d+ life\.?$/,
];

/** Structural text: understood, carries no effect of its own. */
const STRUCTURAL: RegExp[] = [
  /^choose (?:one|two|three|one or both|one or more|any number)(?: —| -)?(?: [^.]*)?\.?$/,
  /^activate (?:only|no more than) [^.]*\.?$/,
  /^this effect can't reduce the mana in that cost to less than one mana\.?$/,
  /^spend this mana only [^.]*\.?$/,
  /^as (?:~|this [a-z]+) enters, choose a (?:creature type|color|card type|basic land type|creature|opponent)\.?$/,
  /^choose a (?:creature type|color)\.?$/,
  /^(?:this ability|it) triggers only once each turn\.?$/,
  /^(?:it|they) can't be regenerated\.?$/,
  /^you may choose new targets for the copy\.?$/,
  /^as an additional cost to cast this spell, (?:sacrifice|discard|exile|pay|tap|return) [^.]*\.?$/,
  /^if you control a commander as you cast this spell, you may choose [^.]*\.?$/,
  /^exile ~\.?$/,
  /^enchant [a-z, ]+$/,
  /^[^"]*: choose (?:one|two|one or both)(?: —)?$/,
  /^if that spell is countered this way, [^.]*\.?$/,
  /^then if you control (?:four|\w+) or more lands, untap that land\.?$/,
  /^if this spell was cast from a graveyard, [^.]*\.?$/,
  /^then shuffle\.?$/,
  /^put the rest (?:on the bottom of your library in (?:a|any) (?:random )?order|into your graveyard|back in any order)\.?$/,
  /^when ~ enters, sacrifice it\.?$/,
  /^it's still a land\.?$/,
  /^as (?:~|it) enters, choose a (?:color|creature type)[^.]*\.?$/,
  /^as ~ enters, choose [a-z]+ or [a-z]+\.?$/,
  /^as ~ enters, you may reveal an? [a-z ]+ card from your hand\.?$/,
  /^(?:sacrifice|exile) (?:it|that creature|the token|them) at the beginning of the next end step\.?$/,
  /^(?:it|they|that creature|the token|that token) gains? haste(?: until end of turn)?\.?$/,
  /^do this only once each turn\.?$/,
  /^(?:\{[^}]+\})+: level \d+$/,
  /^~ is (?:the chosen type|every creature type) in addition to its other types\.?$/,
];

// Order doesn't matter: every rule runs on every line, and any match marks the line as understood.
const RULES: Rule[] = [
  // ---- mana abilities ----
  {
    re: /^\{t\}(?:, pay \d+ life)?: add (.+)$/,
    apply: (m, ctx) => manaAbility(m[1], ctx),
  },
  {
    re: /^\{[a-z0-9/]+\}, \{t\}: add \{[gu]\}\{[gu]\}, \{[gu]\}\{[gu]\}, or \{[gu]\}\{[gu]\}\.?$/, // filter lands
  },
  {
    re: /^put a -0\/-1 counter on ~: add \{(\w)\}\. activate only once each turn\.?$/,
    apply: (_m, ctx) => ctx.set('ramp_dork', { amount: 1, shrinks: true }),
  },
  { re: /^~ enters tapped\.?$/, apply: (_m, ctx) => ctx.set('enters_tapped') },
  { re: /^~ enters tapped unless /, apply: (_m, ctx) => ctx.set('enters_tapped', { conditional: true }) },
  {
    re: /whenever enchanted (?:land|forest|plains|island|swamp|mountain) is tapped for mana, its controller adds an additional/,
    apply: (_m, ctx) => ctx.set('ramp_land_aura', { amount: 1 }),
  },
  { re: /^enchant (?:land|forest|creature|creature you control|permanent)\.?$/ },
  { re: /^as ~ enters, choose a color\.?$/ },
  { re: /^(?:you have|players have) no maximum hand size\.?$/, apply: (_m, ctx) => ctx.set('no_max_hand_size') },
  {
    // Fetch lands and land-ramp spells/abilities alike: "search your library for ... land/Forest ... onto the battlefield".
    re: /search your library for ([^.]*?)(?:basic land|land|forest|plains|island|swamp|mountain) cards?[^.]*?(?:put (one|them|it|that card|those cards|one of them) onto the battlefield( tapped)?)/,
    apply: (m, ctx) => {
      if (/ their library/.test(m[0])) return false;
      const tapped = !!m[3];
      if (ctx.type.includes('land')) return ctx.set('land_fetch', { tapped });
      const upTo = m[1].match(/up to (\w+)/);
      const lands = m[2] === 'them' || m[2] === 'those cards' ? num(upTo?.[1] ?? 'two') : 1;
      ctx.set('ramp_spell', { lands, tapped });
    },
  },
  { re: /(?:if you don't|unless [^,]+), (?:~|it) enters tapped\.?$/, apply: (_m, ctx) => ctx.set('enters_tapped', { conditional: true }) },
  {
    re: /^((?:\{[^}]+\})+)(, \{t\})?(?:, [^:]+)?: add (.+)$/,
    apply: (m, ctx) => {
      const c = costOf(m[1]);
      if (!c) return; // plain {T}: add, handled above
      if (ctx.type.includes('land')) return;
      const tap = !!m[2] || m[1].includes('{t}');
      const { amount } = manaAmount(m[3]);
      if (!tap) return ctx.set('mana_filter', { cost: c });
      if (ctx.tags.ramp_rock || ctx.tags.ramp_dork) return;
      ctx.set(isCreature(ctx) ? 'ramp_dork' : 'ramp_rock', { amount, cost: c });
    },
  },
  { re: /^remove (?:a|one) [a-z]+ counter from ~: add /, apply: (_m, ctx) => mergeParams(ctx, 'mana_filter', {}) },
  { re: /^\{\d+\}(?:, \{t\})?: put a [a-z]+ counter on ~\.?$/, apply: (_m, ctx) => mergeParams(ctx, 'mana_filter', {}) },
  { re: /^add ((?:\{[wubrgc]\})+)\.?$/, apply: (m, ctx) => ctx.set('ritual', { amount: m[1].split('}{').length }) },
  {
    re: /^sacrifice (?:a|an|another) (?:creature|artifact|permanent): add ((?:\{[wubrgc]\})+)\.?$/,
    apply: (m, ctx) => ctx.set('ritual', { amount: m[1].split('}{').length }),
  },
  { re: /^whenever you cast a spell, add ((?:\{[wubrgc]\})+)\.?$/, apply: (_m, ctx) => ctx.set('ritual', { amount: 1 }) },
  { re: /^exile this card from your hand: add ((?:\{[wubrgc]\})+)\.?$/, apply: (m, ctx) => ctx.set('ritual', { amount: m[1].split('}{').length }) },
  { re: /^add (one|two|three|four|five|x) mana\b/, apply: (m, ctx) => ctx.set('ritual', { amount: num(m[1]) }) },
  {
    re: new RegExp(`\\bcreate ${NUM} (?:tapped )?treasure tokens?`),
    apply: (m, ctx) => {
      const t = triggerOf(ctx.line);
      ctx.set('treasure', { n: num(m[1]) || 1, trigger: t === 'etb' ? 'etb' : t === 'activated' ? 'activated' : t === 'cast' ? 'cast' : 'repeating' });
    },
  },
  {
    re: /you may (?:play (?:an|two) additional lands?|put a land card from your hand onto the battlefield)/,
    apply: (_m, ctx) => ctx.set('extra_land_drop'),
  },
  {
    re: /^(?:[a-z]+ )?(?:artifacts|creatures|lands|permanents) you control have "\{t\}: add ([^"]+)"/,
    apply: (m, ctx) => ctx.set('mana_grant', { scope: ctx.line.match(/^([a-z ]+?) you control/)?.[1] ?? '', restricted: /spend this mana only/.test(m[1]) }),
  },

  // ---- body ----
  { re: /^~(?:'s)? power and toughness are each equal to the number of cards in your hand\.?$/, apply: (_m, ctx) => ctx.set('hand_size_pt') },
  { re: /^~ can't be blocked\.?$/, apply: (_m, ctx) => ctx.set('unblockable') },
  { re: /^\{(\w)\}: ~ gains reach until end of turn\.?$/, apply: (m, ctx) => ctx.set('reach', { cost: `{${m[1].toUpperCase()}}` }) },
  { re: /^during your turn, creatures you control have hexproof\.?$/, apply: (_m, ctx) => ctx.set('team_hexproof', { when: 'your_turn' }) },
  { re: /^creatures you control have hexproof\.?$/, apply: (_m, ctx) => ctx.set('team_hexproof', { when: 'always' }) },

  // ---- the Pride and other plan pieces ----
  {
    re: /^this spell costs \{x\} less to cast, where x is the total toughness of creatures you control\.?$/,
    apply: (_m, ctx) => ctx.set('self_cost_reduction', { by: 'total_toughness' }),
  },
  {
    re: /^this spell costs \{(\d+)\} less to cast if you control a turtle\.?$/,
    apply: (m, ctx) => ctx.set('self_cost_reduction', { by: 'control_turtle', amount: Number(m[1]) }),
  },
  {
    re: /^((?:\{[^}]+\})+): until end of turn, target creature you control gets \+1\/\+0, gains "whenever (?:this creature|~) deals combat damage to a player, draw cards equal to its toughness," and can attack as though it didn't have defender\.?$/,
    apply: (m, ctx) => {
      const c = costOf(m[1]);
      ctx.set('grant_toughness_draw', { cost: c, creature_ability: isCreature(ctx) });
      ctx.set('defender_can_attack', { cost: c, scope: 'target', creature_ability: isCreature(ctx) });
    },
  },
  {
    re: /^((?:\{[^}]+\})+): (?:until end of turn, )?target creature with defender (gains haste, )?can attack (?:this turn )?as though it didn't have defender(, and assigns combat damage equal to its toughness rather than its power)?\.?( activate only as a sorcery\.?)?$/,
    apply: (m, ctx) =>
      ctx.set('defender_can_attack', {
        cost: costOf(m[1]), scope: 'target', haste: !!m[2], butt: !!m[3], creature_ability: isCreature(ctx), sorcery: !!m[4],
      }),
  },
  {
    re: /^each creature you control( with toughness greater than its power)? assigns combat damage equal to its toughness rather than its power\.?$/,
    apply: (m, ctx) => ctx.set('butt_damage', { scope: m[1] ? 'team_t_gt_p' : 'team' }),
  },
  {
    re: /^enchanted creature gets \+(\d+)\/\+(\d+)(?: and has (flying))?(, and assigns combat damage equal to its toughness rather than its power| and assigns combat damage equal to its toughness rather than its power)?\.?$/,
    apply: (m, ctx) => {
      ctx.set('aura', { power: Number(m[1]), toughness: Number(m[2]), flying: !!m[3], butt: !!m[4] });
      if (m[4]) ctx.set('butt_damage', { scope: 'enchanted' });
    },
  },
  { re: /^umbra armor$/, apply: (_m, ctx) => mergeParams(ctx, 'aura', { umbra_armor: true }) },
  {
    re: /^(?:until end of turn, )?creatures you control get \+(\d+)\/\+(\d+)(?: and gain ([a-z, ]+?))?(?: until end of turn)?\.?$/,
    apply: (m, ctx) => teamPump(Number(m[1]), Number(m[2]), m[3] ?? '', '', ctx),
  },
  {
    re: /^((?:\{[^}]+\})+): creatures you control get \+(\d+)\/\+(\d+)(?: and gain ([a-z, ]+?))? until end of turn\.?$/,
    apply: (m, ctx) => teamPump(Number(m[2]), Number(m[3]), m[4] ?? '', costOf(m[1]), ctx),
  },
  {
    re: /^as long as you control (\w+) or more lands, creatures you control get \+(\d+)\/\+(\d+)\.?$/,
    apply: (m, ctx) => ctx.set('team_pump', { power: Number(m[2]), toughness: Number(m[3]), until_eot: false, min_lands: num(m[1]) }),
  },
  {
    re: /^activated abilities of creatures you control cost \{(\d+)\} less to activate\.?/,
    apply: (m, ctx) => ctx.set('cost_reducer_abilities', { amount: Number(m[1]) }),
  },
  { re: /^this effect can't reduce the mana in that cost to less than one mana\.?$/ },
  {
    re: /^whenever you draw a card, each opponent loses (\d+) life\.?$/,
    apply: (m, ctx) => ctx.set('draw_payoff_ping', { amount: Number(m[1]) }),
  },
  {
    re: /^if you would draw a card except the first one you draw in each of your draw steps, draw two cards instead\.?$/,
    apply: (_m, ctx) => ctx.set('draw_doubler'),
  },
  {
    re: /^whenever a creature you control deals combat damage to a player, draw (a|one|two) cards?\.?$/,
    apply: (m, ctx) => ctx.set('combat_damage_draw', { n: num(m[1]) }),
  },
  {
    re: /^\{t\}: creatures you control gain haste until end of turn\.?$/,
    apply: (_m, ctx) => ctx.set('haste_enabler', { scope: 'team', tap: true }),
  },
  {
    re: /^equipped creature has ([a-z, ]+?)\.?$/,
    apply: (m, ctx) => {
      const has = m[1];
      mergeParams(ctx, 'equipment', { haste: has.includes('haste'), shroud: has.includes('shroud'), hexproof: has.includes('hexproof') });
      if (has.includes('haste')) ctx.set('haste_enabler', { scope: 'equipped', tap: false });
      if (has.includes('shroud') || has.includes('hexproof')) ctx.set('protection', { kind: 'equip_shroud' });
    },
  },
  { re: /^equip(?: [a-z ]+?)? \{(\d+)\}\.?$/, apply: (m, ctx) => mergeParams(ctx, 'equipment', { equip: Number(m[1]) }) },
  {
    re: /^equipped creature gets ([+-]\d+)\/([+-]\d+)(?: and (?:has|gains) ([a-z, ]+?))?(?:\.|$| and ")/,
    apply: (m, ctx) => {
      const has = m[3] ?? '';
      mergeParams(ctx, 'equipment', { power: Number(m[1]), toughness: Number(m[2]), haste: has.includes('haste'), hexproof: has.includes('hexproof'), shroud: has.includes('shroud') });
    },
  },
  {
    re: /^enchanted creature gets ([+-]\d+)\/([+-]\d+)(?: and has ([a-z, ]+?))?\.?$/,
    apply: (m, ctx) => mergeParams(ctx, 'aura', { power: Number(m[1]), toughness: Number(m[2]), flying: (m[3] ?? '').includes('flying') }),
  },
  {
    re: /^(?:([^:"]+): )?(?:you may )?untap (target [a-z ]+?|all [a-z ]+?|enchanted creature|equipped creature|~|up to [a-z ]+?)\.?$/,
    apply: (m, ctx) => ctx.set('untapper', { cost: costOf(m[1] ?? ''), scope: m[2] }),
  },
  {
    re: /^(?:([^:"]+): )?(?:you may )?tap (target [a-z ]+?|enchanted creature|equipped creature|up to [a-z ]+?)\.?$/,
    apply: (m, ctx) => (/you control/.test(m[2]) ? false : ctx.set('tapper', { cost: costOf(m[1] ?? ''), scope: m[2] })),
  },
  {
    re: /^(?:([^:"]+): )?(?:you may )?tap or untap (target [a-z ]+?|enchanted creature|equipped creature|~)\.?$/,
    apply: (m, ctx) => {
      ctx.set('untapper', { cost: costOf(m[1] ?? ''), scope: m[2] });
      ctx.set('tapper', { cost: costOf(m[1] ?? ''), scope: m[2] });
    },
  },
  {
    re: /^creatures you control get ([+-]\d+)\/([+-]\d+)\.?$/,
    apply: (m, ctx) => ctx.set('team_pump', { power: Number(m[1]), toughness: Number(m[2]), until_eot: false }),
  },
  {
    re: /^(?:[a-z]+ )?creatures you control get \+(\d+)\/\+(\d+)\.?$/,
    apply: (m, ctx) => ctx.set('team_pump', { power: Number(m[1]), toughness: Number(m[2]), until_eot: false }),
  },
  {
    re: new RegExp(`\\bcreate ${NUM} (?:tapped )?(\\d+|x)\\/(\\d+|x) ([^.]*?)creature tokens?([^.]*)`),
    apply: (m, ctx) => {
      if (/^(?:its controller|that player|each opponent|target opponent)/.test(ctx.line)) return false;
      if (/sacrificed creature's|where x is/.test(ctx.line)) return; // variable-size token: covered by a specific tag or left to the user
      if (num(m[3]) === 0) return false; // 0/0 tokens grown by counters: size depends on the game
      const t = triggerOf(ctx.line);
      ctx.set('token_maker', {
        count: num(m[1]) || 1, power: num(m[2]), toughness: num(m[3]),
        flying: /flying/.test(m[4] + m[5]) || /^[^.]*with flying/.test(m[5]),
        trigger: t === 'repeating' ? 'upkeep' : t, cost: t === 'activated' ? costOf(ctx.line.split(':')[0]) : '',
      });
    },
  },

  // ---- evasion enablers ----
  {
    re: /^(.*?): (?:up to one )?target creature(?: with power (\d+) or less)? can't be blocked this turn\.?$/,
    apply: (m, ctx) => {
      const c = m[1];
      ctx.set('unblockable_enabler', {
        cost: costOf(c) || '{0}',
        kind: ctx.type.includes('land') ? 'land' : 'activated',
        max_power: m[2] ? Number(m[2]) : 0,
        tap: c.includes('{t}'),
        discard: c.includes('discard'),
        sacrifice: c.includes('sacrifice'),
      });
    },
  },
  {
    re: /^(?:equipped|enchanted) creature can't be blocked( except by walls)?\.?$/,
    apply: (m, ctx) => {
      ctx.set('unblockable_enabler', { kind: 'equip', tap: false, walls_can_block: !!m[1] });
      mergeParams(ctx, 'equipment', {});
    },
  },
  {
    re: /^whenever ~ attacks, another target attacking (?:non-human )?creature can't be blocked this turn\.?$/,
    apply: (_m, ctx) => ctx.set('unblockable_enabler', { cost: '{0}', kind: 'attack_trigger', tap: false }),
  },
  {
    re: /^creatures you control with power or toughness (\d+) or less can't be blocked\.?$/,
    apply: (m, ctx) => ctx.set('small_unblockable_grant', { max: Number(m[1]) }),
  },

  // ---- specific engines (still read from text, never assumed) ----
  {
    re: /^((?:\{[^}]+\})+), \{t\}, sacrifice another nontoken creature: create an x\/x .*zombie creature token, where x is the sacrificed creature's toughness\.?$/,
    apply: (m, ctx) => mergeParams(ctx, 'sac_for_toughness_token', { cost: costOf(m[1]) }),
  },
  { re: /^zombies you control have flying\.?$/, apply: (_m, ctx) => mergeParams(ctx, 'sac_for_toughness_token', { flying: true }) },
  {
    re: /^at the beginning of combat on your turn, you may have ~ become a copy of another target creature until end of turn, except it's 1\/4 and has "~ can't be blocked\."\.?"?$/,
    apply: (_m, ctx) => ctx.set('copy_unblockable'),
  },
  { re: /^damage isn't removed from ~ during cleanup steps\.?$/, apply: (_m, ctx) => ctx.set('damage_redirect') },
  { re: /^all damage that would be dealt to you and other permanents you control is dealt to ~ instead\.?$/, apply: (_m, ctx) => ctx.set('damage_redirect') },
  {
    re: /^whenever ~ or another creature you control( with toughness greater than its power)? enters, look at the top card of your library\. if it's a land card, you may put it onto the battlefield tapped\. otherwise, put it into your hand\.?$/,
    apply: (m, ctx) => ctx.set('etb_dig', { condition: m[1] ? 't_gt_p' : 'any' }),
  },
  { re: /^((?:\{[^}]+\})+), \{t\}: proliferate\.?$/, apply: (m, ctx) => ctx.set('proliferate', { cost: costOf(m[1]) }) },
  { re: /^proliferate\.?$/, apply: (_m, ctx) => ctx.set('proliferate', { cost: '' }) },
  {
    re: /^spells your opponents cast that target (~|one or more commanders you control) cost \{(\d+)\} more to cast\.?$/,
    apply: (m, ctx) => ctx.set('target_tax', { amount: Number(m[2]), scope: m[1] === '~' ? 'self' : 'commanders' }),
  },

  // ---- card flow ----
  { re: /^draw (a|one|two|three|four|\d+) cards?\.?$/, apply: (m, ctx) => ctx.set('draw_n', { n: num(m[1]) }) },
  { re: /^when ~ enters, draw (a|one|two|three) cards?\.?$/, apply: (m, ctx) => ctx.set('etb_draw', { n: num(m[1]) }) },
  {
    re: /^whenever a nontoken creature you control enters, if it doesn't have the same name as another creature you control or a creature card in your graveyard, draw a card\.?$/,
    apply: (_m, ctx) => ctx.set('creature_etb_draw'),
  },
  { re: /^return target card from your graveyard to your hand\.?$/, apply: (_m, ctx) => ctx.set('recursion', { filter: 'any' }) },
  {
    re: /^return (?:up to (?:one|two) )?target ((?:[a-z]+ )*?)cards? from your graveyard to your hand\.?$/,
    apply: (m, ctx) => ctx.set('recursion', { filter: /instant|sorcery/.test(m[1]) ? 'instant_sorcery' : /creature/.test(m[1]) ? 'creature' : /permanent|artifact|enchantment/.test(m[1]) ? 'permanent' : 'any', etb: /^when ~ enters/.test(ctx.line) }),
  },
  {
    re: /return target [a-z ]*?card from (?:your|a) graveyard to the battlefield|put target [a-z ]*?card from a graveyard onto the battlefield under your control/,
    apply: (_m, ctx) => ctx.set('reanimate'),
  },
  {
    re: /^((?:(?:\{[^}]+\})+|sacrifice [^,:]+|discard [^,:]+|pay \d+ life|exile [^,:]+)(?:, (?:(?:\{[^}]+\})+|sacrifice [^,:]+|discard [^,:]+|pay \d+ life|exile [^,:]+))*): (?:you )?draw (a|one|two|three|x) cards?(?:, then discard (a|one|two|three) cards?)?(?:\.|$)/,
    apply: (m, ctx) =>
      ctx.set('activated_draw', {
        cost: costOf(m[1]), n: num(m[2]) || 1, tap: m[1].includes('{t}'), sacrifice: /sacrifice/.test(m[1]), sacrifice_self: /sacrifice ~/.test(m[1]),
        sacrifice_what: sacrificeWhat(m[1]), discard: m[3] ? num(m[3]) : 0,
      }),
  },
  { re: new RegExp(`^draw ${NUM} cards?, then discard ${NUM} cards?`), apply: (m, ctx) => ctx.set('loot', { draw: num(m[1]), discard: num(m[2]) }) },
  { re: new RegExp(`^discard ${NUM} cards?, then draw ${NUM} cards?`), apply: (m, ctx) => ctx.set('loot', { draw: num(m[2]), discard: num(m[1]) }) },
  {
    re: new RegExp(`^(?:•\\s*)?(?:target player|you) draws? ${NUM} cards?\\.?$`),
    apply: (m, ctx) => ctx.set('draw_n', { n: num(m[1]) }),
  },
  {
    re: /^you draw (a|one|two) cards? at the beginning of the next turn's upkeep\.?$/,
    apply: (m, ctx) => ctx.set('draw_n', { n: num(m[1]) }),
  },
  {
    re: /draw cards equal to the number of opponents you have/,
    apply: (_m, ctx) => ctx.set(/^when ~ enters/.test(ctx.line) ? 'etb_draw' : 'draw_n', { n: 3 }),
  },
  {
    re: /^when ~ enters, (?:you )?(?:may )?draw (a|one|two|three) cards?/,
    apply: (m, ctx) => ctx.set('etb_draw', { n: num(m[1]) }),
  },
  {
    re: /^at the beginning of (your upkeep|your draw step|your end step|each end step|each upkeep|your precombat main phase)[^,]*, (?:you )?(?:may )?draw (a|an additional|one|two) cards?/,
    apply: (m, ctx) => ctx.set('repeat_draw', { n: m[2] === 'two' ? 2 : 1, when: /end step/.test(m[1]) ? 'end_step' : 'upkeep' }),
  },
  {
    re: /^whenever you cast (?:or copy )?(?:an? |your )?(?:[a-z, ]+ )?spell[^,]*, (?:you may )?draw (a|one|two) cards?/,
    apply: (m, ctx) => ctx.set('repeat_draw', { n: num(m[1]), when: 'cast_spell' }),
  },
  {
    re: /^whenever an opponent casts a spell, you may draw a card unless that player pays/,
    apply: (_m, ctx) => ctx.set('repeat_draw', { n: 1, when: 'opponent_casts' }),
  },
  {
    re: /^whenever (~|equipped creature|enchanted creature|one or more artifact creatures you control) deals? combat damage to a player, (?:you may )?draw (a|one|two) cards?/,
    apply: (m, ctx) => ctx.set('combat_damage_draw', { n: num(m[2]), scope: m[1] === '~' ? 'self' : m[1].startsWith('one or more') ? 'artifact_creatures' : 'equipped' }),
  },
  {
    re: /each player (?:discards|shuffles) their hand[^.]*(?:,|then|\.) (?:then )?(?:each player )?draws? (seven|\w+) cards/,
    apply: (m, ctx) => ctx.set('wheel', { n: num(m[1]) || 7 }),
  },
  { re: new RegExp(`\\bcreate ${NUM} clue tokens?`), apply: (m, ctx) => ctx.set('clue', { n: num(m[1]) || 1 }) },
  {
    re: /you may (play lands and cast spells|cast spells|play cards|play lands and cast [a-z ]+? spells|cast [a-z ]+? spells|play lands) (?:[a-z ]+ )?from the top of your library/,
    apply: (m, ctx) => ctx.set('play_from_top', { scope: m[1] }),
  },
  {
    re: /^([a-z ,]*?)spells you cast(?: [a-z ]+?)? cost \{(\d+)\} less to cast/,
    apply: (m, ctx) => ctx.set('spell_cost_reducer', { amount: Number(m[2]), filter: m[1].trim() }),
  },
  {
    re: /^this spell costs \{(\d+)\} less to cast\b/,
    apply: (m, ctx) => {
      if (ctx.tags.self_cost_reduction) return;
      ctx.set('self_cost_reduction', { by: 'other', amount: Number(m[1]) });
    },
  },
  {
    re: /search your library for (?:a|an|up to one) ((?:[a-z]+,? )*?)cards?(?: with [^,.]+)?,? (?:reveal (?:it|that card), )?(?:then shuffle and )?(put (?:it|that card) into your hand|put (?:that card|it) on top|put (?:it|that card) onto the battlefield)/,
    apply: (m, ctx) => {
      if (/land|forest|plains|island|swamp|mountain/.test(m[1]) && /battlefield/.test(m[2])) return;
      ctx.set('tutor', { filter: m[1].trim(), to: /top/.test(m[2]) ? 'top' : /battlefield/.test(m[2]) ? 'battlefield' : 'hand' });
    },
  },
  {
    re: /(target player|each opponent|target opponent|each player) mills (?:twice )?(?:(x|a|one|two|three|four|five|ten|\d+|\w+) cards?|cards equal to)/,
    apply: (m, ctx) => ctx.set('mill', { n: num(m[2] ?? 'x'), target: m[1].startsWith('each opponent') ? 'opponents' : 'player' }),
  },
  {
    re: /^((?:\{[^}]+\})+)(?:, \{t\})?: each player draws (x|a|one|two|three) cards?\.?$/,
    apply: (m, ctx) => ctx.set('activated_draw', { cost: costOf(m[1]), n: num(m[2]), tap: ctx.line.includes('{t}') }),
  },
  { re: /^then discard a card unless /, apply: (_m, ctx) => mergeParams(ctx, 'activated_draw', { discard: 1 }) },
  {
    re: /^(?:(?:\{[^}]+\})+|\{t\})(?:, (?:\{t\}|pay \d+ life))*: exile the top card of your library\.?$/,
    apply: (_m, ctx) => (ctx.tags.play_from_top ? undefined : false),
  },
  {
    re: /^((?:\{[^}]+\})+): (?:equipped|enchanted) creature gains (hexproof|shroud|indestructible)(?: and [a-z]+)? until end of turn\.?$/,
    apply: (_m, ctx) => ctx.set('protection', { kind: 'single_hexproof_indestructible' }),
  },
  {
    re: /^when ~ enters, you may return target (instant or sorcery|creature|permanent) card from your graveyard to your hand\.?$/,
    apply: (m, ctx) => ctx.set('recursion', { filter: m[1] === 'instant or sorcery' ? 'instant_sorcery' : m[1], etb: true }),
  },

  {
    re: /^if you control a commander, you may cast this spell without paying its mana cost\.?$/,
    apply: (_m, ctx) => ctx.set('self_cost_reduction', { by: 'other', amount: ctx.card.cmc }),
  },
  {
    re: /^(?:when ~ enters, )?(?:you may )?return (?:up to (?:one|two) )?target ((?:[a-z]+ )*?)cards? from your graveyard to your hand\.?$/,
    apply: (m, ctx) => ctx.set('recursion', { filter: /instant|sorcery/.test(m[1]) ? 'instant_sorcery' : /creature/.test(m[1]) ? 'creature' : /permanent|artifact|enchantment/.test(m[1]) ? 'permanent' : 'any', etb: /^when ~ enters/.test(ctx.line) }),
  },
  {
    re: /^whenever a creature you control deals combat damage to a player, (?:you may )?draw (a|one|two) cards?\.?$/,
    apply: (m, ctx) => ctx.set('combat_damage_draw', { n: num(m[1]) }),
  },
  {
    re: /^(?:landfall — )?whenever (?:a|an|another|one or more)(?: other)? (?:nontoken )?(creatures?|lands?|artifacts?)[^,]*? you control[^,]*? enters?, (?:you may )?draw a card/,
    apply: (m, ctx) => ctx.set(m[1].startsWith('creature') ? 'creature_etb_draw' : 'repeat_draw', m[1].startsWith('creature') ? {} : { n: 1, when: 'other' }),
  },
  { re: /^(?:when ~ enters, )?mill (a|one|two|three|four|five|\d+) cards?\.?$/, apply: (m, ctx) => ctx.set('mill', { n: num(m[1]), target: 'self' }) },
  {
    re: /^(?:when ~ enters, )?each (?:player|opponent) sacrifices (?:a|an) (?:nontoken )?creature/,
    apply: (_m, ctx) => ctx.set('spot_removal', { kind: 'edict', targets: 'creature' }),
  },
  {
    re: /^(?:([^:"]+): )?target creature (?:an opponent controls )?gets -(\d+|x)\/-(\d+|x) until end of turn\.?$/,
    apply: (_m, ctx) => ctx.set('spot_removal', { kind: 'damage', targets: 'creature' }),
  },
  {
    re: /^creatures you control (?:of the chosen (?:type|color) )?get \+(\d+)\/\+(\d+)\.?$/,
    apply: (m, ctx) => ctx.set('team_pump', { power: Number(m[1]), toughness: Number(m[2]), until_eot: false }),
  },
  {
    re: /^(?:other )?creatures you control have ([a-z, ]+?)\.?$/,
    apply: (m, ctx) => {
      if (m[1].includes('haste')) return ctx.set('haste_enabler', { scope: 'team', tap: false });
      if (/hexproof/.test(m[1])) return ctx.set('team_hexproof', { when: 'always' });
      return false;
    },
  },
  { re: /^spells you control can't be countered\.?$/, apply: (_m, ctx) => ctx.set('protection', { kind: 'uncounterable' }) },
  {
    re: /^(?:when ~ enters, )?(?:look at|reveal) the top (two|three|four|five|six|seven|x|\d+) cards of your library/,
    apply: (m, ctx) => mergeParams(ctx, 'dig', { look: num(m[1]) }),
  },
  {
    re: /^(?:you may )?put (?:(a|one|two|up to (?:one|two|three)) )?(?:[a-z ,/-]+?)?cards? (?:from among them|of them) (?:into your hand|onto the battlefield( tapped)?)/,
    apply: (m, ctx) => mergeParams(ctx, 'dig', { lands_to_battlefield: /land/.test(ctx.line) && /battlefield/.test(m[0]) }),
  },
  { re: /^(?:you may )?put (?:one|two) of them into your hand and the rest/, apply: (_m, ctx) => mergeParams(ctx, 'dig', {}) },
  {
    re: /exile the top (a|one|two|three|four|five|x|\d+) cards? of your library/,
    apply: (m, ctx) => {
      if (/^[^:]*\{t\}[^:]*: exile the top card/.test(ctx.line) && ctx.tags.play_from_top) return;
      mergeParams(ctx, 'impulse', { n: num(m[1]) || 1 });
    },
  },
  { re: /^(?:until (?:the )?end of (?:your next )?turn, |until end of turn, )?you may play (?:those cards|that card|them|the exiled cards?)(?: this turn| until [^.]+)?\.?$/, apply: (_m, ctx) => mergeParams(ctx, 'impulse', {}) },
  {
    re: /^when ~ dies, (?:you may )?draw (a|one|two) cards?\.?$/,
    apply: (m, ctx) => ctx.set('death_draw', { n: num(m[1]), scope: 'self' }),
  },
  {
    re: /^whenever (?:a|another|one or more(?: other)?) (?:nontoken )?creatures?(?: you control)? dies?, (?:you may )?draw (a|one) cards?/,
    apply: (m, ctx) => ctx.set('death_draw', { n: num(m[1]), scope: /you control/.test(ctx.line) ? 'yours' : 'any' }),
  },
  {
    re: /^(?:whenever|when|at) ([^,]+), (?:~ deals (\d+|x) damage to each opponent|each opponent loses (\d+|x) life)/,
    apply: (m, ctx) => (/^you draw/.test(m[1]) ? undefined : ctx.set('drain', { amount: num(m[2] ?? m[3]) || 1, trigger: m[1] })), // draw pings: draw_payoff_ping
  },
  { re: /^~ deals (\d+) damage to (?:target opponent|each opponent|target player)\.?$/, apply: (m, ctx) => ctx.set('drain', { amount: Number(m[1]), trigger: 'cast' }) },
  {
    re: /^when ~ enters, (?:it|~) deals (\d+) damage to (?:target opponent|each opponent|target player|any target)\.?$/,
    apply: (m, ctx) => ctx.set('drain', { amount: Number(m[1]), trigger: 'etb' }),
  },
  { re: /^crew (\d+)$/, apply: (m, ctx) => ctx.set('vehicle', { crew: Number(m[1]) }) },
  { re: /^station$/, apply: (_m, ctx) => ctx.set('vehicle', { crew: 0 }) },
  { re: /^\d+\+ \| (.+)$/, apply: () => false },
  {
    re: /^(?:(other|all) )?creatures you control (have|gain) ([a-z, ]+?)( until end of turn)?\.?$/,
    apply: (m, ctx) => {
      if (/hexproof|indestructible|protection|shroud/.test(m[3])) return false; // protection rule
      if (m[3].includes('haste')) ctx.set('haste_enabler', { scope: 'team', tap: false });
      ctx.set('team_keywords', { keywords: m[3], until_eot: !!m[4] });
    },
  },
  {
    re: /^~ enters with (a|an|one|two|three|four|five|x|\d+) \+1\/\+1 counters? on it/,
    apply: (m, ctx) => ctx.set('etb_counters', { n: num(m[1]) }),
  },
  { re: /exile (?:target player's|each opponent's|all|target card from a) graveyards?/, apply: (_m, ctx) => ctx.set('graveyard_hate') },
  { re: /^(?:when ~ enters, )?exile target card from a graveyard\.?$/, apply: (_m, ctx) => ctx.set('graveyard_hate') },
  {
    re: /^this spell costs \{x\} less to cast, where x is the total power of creatures you control\.?$/,
    apply: (_m, ctx) => ctx.set('self_cost_reduction', { by: 'total_power' }),
  },
  { re: /^you draw (two|three|a) cards? and (?:you )?lose (\d+) life\.?$/, apply: (m, ctx) => ctx.set('draw_n', { n: num(m[1]) }) },
  { re: /^you and target opponent each draw (a|two|three) cards?\.?$/, apply: (m, ctx) => ctx.set('draw_n', { n: num(m[1]) }) },
  {
    re: /^((?:\{[^}]+\})+)(?:, \{t\})?: mill (a|one|two|three|\d+) cards?\.?$/,
    apply: (m, ctx) => ctx.set('mill', { n: num(m[2]), target: 'self' }),
  },
  {
    re: /put (a|one|two|three|four|x|\d+) \+1\/\+1 counters? on (each of up to (?:one|two|three) target creatures|up to (?:one|two|three) target creatures?|target creature(?: you control)?|each (?:other )?creature you control|~|each creature target player controls|it|that creature)/,
    apply: (m, ctx) => {
      if (/^ for each/.test((m.input ?? "").slice((m.index ?? 0) + m[0].length))) return false; // variable count
      const t = m[2];
      const scope = /each (?:other )?creature you control/.test(t) ? 'team' : t === '~' || t === 'it' ? 'self' : /up to (?:two|three)/.test(t) ? 'up_to_two' : /target player/.test(t) ? 'team' : 'target';
      ctx.set('counters', { n: num(m[1]) || 1, scope });
    },
  },
  { re: /^(?:when ~ enters, )?support (\d+)\.?$/, apply: (m, ctx) => ctx.set('counters', { n: 1, scope: Number(m[1]) > 2 ? 'team' : 'up_to_two' }) },
  { re: /^each player may put two \+1\/\+1 counters on a creature they control\.?$/, apply: (_m, ctx) => ctx.set('counters', { n: 2, scope: 'each_player' }) },
  {
    re: /^if you would put one or more counters on a (?:creature|permanent)[^,]* you control[^,]*, (?:put that many plus one|put twice that many|it gets that many plus one|instead put twice)/,
    apply: (_m, ctx) => ctx.set('counter_doubler'),
  },
  { re: /^whenever [^,]+, proliferate\.?$/, apply: (_m, ctx) => ctx.set('proliferate', { cost: '' }) },
  {
    re: /creatures can't attack you(?: or (?:a )?planeswalkers? you control)? unless their controller pays \{(\d+)\} for each/,
    apply: (m, ctx) => ctx.set('attack_tax', { per: Number(m[1]) }),
  },
  { re: /^whenever you attack with (?:two|three) or more creatures, draw a card\.?$/, apply: (_m, ctx) => ctx.set('repeat_draw', { n: 1, when: 'other' }) },
  { re: /^each opponent draws a card, then you draw a card for each opponent who drew a card this way\.?$/, apply: (_m, ctx) => ctx.set('draw_n', { n: 3 }) },
  {
    re: /^(?:([^:"]+): )?you and target opponent each draw (a|two|three) cards?\.?$/,
    apply: (m, ctx) => (m[1] ? ctx.set('activated_draw', { cost: costOf(m[1]), n: num(m[2]), tap: m[1].includes('{t}') }) : ctx.set('draw_n', { n: num(m[2]) })),
  },
  {
    re: /put target (?:attacking |blocking |attacking or blocking )?(?:creature|nonland permanent|permanent) on (?:the bottom|top) of its owner's library/,
    apply: (_m, ctx) => ctx.set('spot_removal', { kind: 'tuck', targets: 'creature' }),
  },
  {
    re: /^each creature you control with (?:a \+1\/\+1 counter|one or more counters|a counter) on it (?:has|gains) ([a-z, ]+?)\.?$/,
    apply: (m, ctx) => ctx.set('team_keywords', { keywords: `${m[1]} (with counters)` }),
  },
  // ---- interaction ----
  {
    re: /(?:^|\. )counter target ((?:[a-z]+(?:,| or)? )*?)spell( unless its controller pays \{[^}]+\})?/,
    apply: (m, ctx) => {
      const t = m[1].trim();
      const scope = !t ? 'any' : t.includes('noncreature') ? 'noncreature' : t === 'instant or sorcery' ? 'instant_sorcery' : t === 'instant' ? 'instant' : t === 'creature' ? 'creature' : 'noncreature';
      ctx.set('counterspell', { scope, soft: !!m[2] });
    },
  },
  { re: /^counter target (?:activated|triggered) (?:or triggered )?ability/, apply: (_m, ctx) => ctx.set('counterspell', { scope: 'ability' }) },
  { re: /^(?:this spell|~) can't be countered\.?$/, apply: (_m, ctx) => ctx.set('uncounterable') },
  { re: /spells you control can't be countered this turn/, apply: (_m, ctx) => ctx.set('protection', { kind: 'uncounterable' }) },
  {
    re: /^(?:all )?(?:other )?(?:permanents|creatures) you control (?:gain|have) ([a-z, ]+?)(?: until end of turn| until your next turn)?\.?$/,
    apply: (m, ctx) => {
      if (!/hexproof|indestructible|protection|shroud/.test(m[1])) return false;
      ctx.set('protection', { kind: 'team_hexproof_indestructible' });
    },
  },
  { re: /^you and permanents you control gain hexproof from [a-z]+(?: and from [a-z]+)? until end of turn\.?$/, apply: (_m, ctx) => mergeParams(ctx, 'protection', {}) },
  { re: /^all permanents you control phase out\.?$/, apply: (_m, ctx) => ctx.set('protection', { kind: 'team_hexproof_indestructible' }) },
  {
    re: /(?:put a \+1\/\+1 counter on )?target (?:creature|permanent) you control(?:\. it)? gains ([a-z, ]+?) until end of turn\.?$/,
    apply: (m, ctx) => {
      if (!/hexproof|indestructible|protection|shroud/.test(m[1])) return false;
      ctx.set('protection', { kind: 'single_hexproof_indestructible' });
    },
  },
  {
    re: /^(?:([^:"]+): )?(?:when ~ enters(?: or attacks)?, |whenever ~ enters or attacks, )?(?:.*\. )?(destroy|exile) (?:up to (?:one|two|three) )?target ((?:[a-z]+(?:,| or| and| and\/or)? )*?(?:creature|permanent|artifact|enchantment|planeswalker|land))s?\b/,
    apply: (m, ctx) => {
      if (/^(?:whenever (?!~ enters)|at the beginning)/.test(ctx.line) || / you control$/.test(m[3])) return false;
      ctx.set('spot_removal', { kind: m[2], targets: removalTargets(m[3]), cost: m[1] && m[1].includes('{') ? costOf(m[1]) : '' });
    },
  },
  {
    re: /^(?:([^:"]+): )?(?:.*\. )?return (?:up to (?:one|two) )?target ((?:[a-z]+(?:,| or)? )*?(?:creature|permanent|artifact|enchantment|planeswalker))s?( you control| you don't control| an opponent controls)? to (?:its|their) owners?'s? hands?/,
    apply: (m, ctx) => {
      // Bouncing your own permanent is a save or a reset, not removal.
      if (/^(?:whenever|at the beginning)/.test(ctx.line) || m[3] === ' you control') return false;
      ctx.set('spot_removal', { kind: 'bounce', targets: removalTargets(m[2]), cost: m[1] && m[1].includes('{') ? costOf(m[1]) : '' });
    },
  },
  { re: /the owner of target (?:nonland )?permanent shuffles it into their library/, apply: (_m, ctx) => ctx.set('spot_removal', { kind: 'tuck', targets: 'permanent' }) },
  {
    re: /^(?:target player|each opponent|target opponent) sacrifices (?:a|an|one) (?:nontoken )?(creature|creature or planeswalker|attacking creature|permanent)/,
    apply: (_m, ctx) => ctx.set('spot_removal', { kind: 'edict', targets: 'creature' }),
  },
  {
    re: /^enchanted (?:creature|permanent) (?:can't attack or block|is a colorless land|loses all abilities|is an? \d+\/\d+|is an? [a-z ]+creature with base power)/,
    apply: (_m, ctx) => ctx.set('spot_removal', { kind: 'neutralize', targets: 'creature' }),
  },
  {
    re: /^(?!when|whenever|at )(?:([^:"]+): )?~ deals (\d+|x) damage to (?:any target|target (?:attacking or blocking |attacking |blocking )?creature|target creature or planeswalker)/,
    apply: (_m, ctx) => ctx.set('spot_removal', { kind: 'damage', targets: 'creature' }),
  },
  {
    re: /(?:^|\. |• |: )destroy all (other )?((?:[a-z]+(?:,| and| or)? )*?(?:creatures|permanents|artifacts|enchantments|planeswalkers))( you don't control| your opponents control)?\b/,
    apply: (m, ctx) => mergeParams(ctx, 'board_wipe', { kind: 'destroy', artifacts: /artifact|nonland permanents/.test(m[2]), one_sided: !!m[3] }),
  },
  {
    re: /(?:^|\. |• |: )destroy each (?:other )?((?:[a-z]+(?:,| and| or)? )*?(?:artifact|creature|enchantment|planeswalker|nonland permanent)s?)\b(.*)$/,
    apply: (m, ctx) => {
      if (/with mana value|whose controller|that player controls|dealt (?:combat )?damage/.test(m[2])) return false; // conditional, not a wipe
      mergeParams(ctx, 'board_wipe', { kind: 'destroy', artifacts: /artifact|nonland permanent/.test(m[1]) });
    },
  },
  {
    re: /^each player sacrifices all permanents they control that are one or more colors\.?$/,
    apply: (_m, ctx) => ctx.set('board_wipe', { kind: 'sacrifice_colored', artifacts: true }),
  },
  {
    re: /^for each creature your opponents control, create an? (\d+)\/(\d+) [^.]*token\. each of those tokens fights (?:up to one target creature you don't control|a different one of those creatures)\.?$/,
    apply: (m, ctx) => ctx.set('board_wipe', { kind: 'toughness_le', x: Number(m[1]), one_sided: true }),
  },
  {
    re: /(?:^|\. |• )exile all (other )?((?:[a-z]+(?:,| and| or)? )*?(?:creatures|permanents|artifacts|enchantments|planeswalkers))( you don't control| your opponents control)?\b/,
    apply: (m, ctx) => ctx.set('board_wipe', { kind: 'exile', artifacts: /artifact|nonland permanents/.test(m[2]), one_sided: !!m[3] }),
  },
  {
    re: /(?:^|\. )return all (?!attacking)(.+?) to their owners'? hands?/,
    apply: (m, ctx) => ctx.set('board_wipe', { kind: 'bounce', artifacts: !/creatures$/.test(m[1]), one_sided: /you don't control|your opponents control/.test(m[1]) }),
  },
  {
    re: /^(?:.*\. )?all (other )?creatures( your opponents control)? get -(\d+|x)\/-(\d+|x) until end of turn( for each)?/,
    apply: (m, ctx) => ctx.set('board_wipe', { kind: 'minus', x: m[5] ? 0 : num(m[3]), one_sided: !!m[2] }),
  },
  {
    re: /^(?:.*\. )?~ deals (\d+|x) damage to each creature\b/,
    apply: (m, ctx) => ctx.set('board_wipe', { kind: 'damage', x: m[1] === 'x' ? 0 : Number(m[1]) }),
  },
  { re: /^return all attacking creatures to their owner's hand\.?$/, apply: (_m, ctx) => ctx.set('aetherize') },
  {
    re: /^creatures can't attack you unless their controller pays \{(\d+)\} for each creature they control that's attacking you\.?$/,
    apply: (m, ctx) => ctx.set('attack_tax', { per: Number(m[1]) }),
  },
  { re: /^prevent all combat damage that would be dealt this turn\.?$/, apply: (_m, ctx) => ctx.set('fog') },
];

/** "{2}, {T}, Sacrifice two artifacts" -> "2 artifact"; "sacrifice another creature with defender" -> "1 creature with defender". */
function sacrificeWhat(cost: string): string {
  const m = cost.match(/sacrifice (?:another |a |an |(two|three) )?(?!~)([a-z ]+?)s?(?:,|$)/);
  if (!m) return '';
  return `${m[1] ? num(m[1]) : 1} ${m[2].trim()}`;
}

function isCreature(ctx: Ctx) {
  return ctx.type.includes('creature');
}

function removalTargets(t: string): string {
  if (/nonland|noncreature/.test(t)) return 'nonland';
  if (/permanent|land/.test(t)) return 'permanent';
  if (/creature|planeswalker/.test(t)) return 'creature';
  return 'artifact_enchantment';
}

/** How an effect on this line happens: cast, enters, an activated ability, or a trigger. */
function triggerOf(line: string): 'cast' | 'etb' | 'activated' | 'repeating' | 'cast_trigger' | 'other' {
  if (/^[^"]*?:/.test(line) && /^(?:\{|sacrifice|discard|tap|pay|remove|exile|put)/.test(line)) return 'activated';
  if (/^when ~ enters/.test(line)) return 'etb';
  if (/^at the beginning of/.test(line)) return 'repeating';
  if (/^whenever you cast/.test(line)) return 'cast_trigger';
  if (/^(?:when|whenever)/.test(line)) return 'other';
  return 'cast';
}

/** Splits a line into sentences, keeping quoted abilities whole. Returns [start, end) offsets. */
function sentenceSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '.' && line[i + 1] === ' ' && i + 2 < line.length) {
      spans.push([start, i + 1]);
      start = i + 2;
    }
  }
  spans.push([start, line.length]);
  return spans.filter(([a, b]) => line.slice(a, b).trim());
}

function runRules(text: string, ctx: Ctx): [number, number][] {
  const covered: [number, number][] = [];
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (!m || m.index === undefined) continue;
    if (rule.apply?.(m, ctx) === false) continue;
    covered.push([m.index, m.index + m[0].length]);
  }
  return covered;
}

/** Reads one ability line: whole-line rules first, then any sentence they didn't cover. */
function readLine(rawLine: string, ctx: Ctx): { unknown: string[]; skipped: string[] } {
  // Ability words ("Landfall —", "Magecraft —"), modal labels ("• Buy information —"), spree costs
  // ("+ {1} —") and planeswalker loyalty costs ("+1:", "−3:") carry no effect of their own.
  const line = rawLine
    .replace(/^(•\s*)?[A-Za-z' ]+ — (?=[A-Za-z{~])/, '$1')
    .replace(/^\+ (?:\{[^}]+\})+ — /, '')
    .replace(/^(?:[+−-]\d+|[+−-]?X|0): /, '');
  const lower = line.toLowerCase();
  ctx.line = lower;
  const covered = runRules(lower, ctx);
  const unknown: string[] = [];
  const skipped: string[] = [];
  for (const [a, b] of sentenceSpans(lower)) {
    const inside = covered.some(([ca, cb]) => ca <= a + 1 && cb >= b - 1);
    if (inside) continue;
    const sentence = lower.slice(a, b).trim().replace(/^•\s*/, '');
    if (STRUCTURAL.some((re) => re.test(sentence))) continue;
    if (runRules(sentence, ctx).length) continue;
    const original = line.slice(a, b).trim();
    if (IGNORE.some((re) => re.test(sentence))) skipped.push(original);
    else unknown.push(original);
  }
  return { unknown, skipped };
}

/** Amount of mana an "add ..." clause makes. */
function manaAmount(text: string): { amount: number; perDefender: boolean; perToughness: boolean } {
  let amount = 1;
  const symbols = text.match(/^((?:\{[wubrgc]\})+)[ .,]?/);
  if (symbols && !/ or /.test(text.split('.')[0])) amount = symbols[1].split('}{').length;
  const words = text.match(/^(one|two|three|four|five|x) mana\b/);
  if (words) amount = num(words[1]);
  const perDefender = /for each creature you control with defender|where x is the number of creatures you control with defender/.test(text);
  const perToughness = /equal to ~'s toughness|equal to its toughness/.test(text);
  return { amount: perToughness ? 0 : amount, perDefender, perToughness };
}

function mergeParams(ctx: Ctx, key: TagKey, params: TagParams) {
  ctx.set(key, { ...(ctx.tags[key]?.params ?? {}), ...params });
}

function teamPump(p: number, t: number, gains: string, cost: string, ctx: Ctx) {
  if (gains.includes('infect')) ctx.set('mass_infect');
  if (p === 0) ctx.set('team_toughness_pump', { amount: t, reach: gains.includes('reach'), cost });
  else ctx.set('team_pump', { power: p, toughness: t, trample: gains.includes('trample'), until_eot: true });
}

function manaAbility(text: string, ctx: Ctx) {
  const { amount, perDefender, perToughness } = manaAmount(text.replace(/^an amount of /, ''));
  const abilitiesOnly = /spend this mana only to activate abilities/.test(text);
  const restricted = abilitiesOnly || /can't be spent to cast spells from your hand/.test(text);
  if (ctx.type.includes('land')) return;
  if (ctx.type.includes('creature')) ctx.set('ramp_dork', { amount, per_defender: perDefender, per_toughness: perToughness, restricted });
  else ctx.set('ramp_rock', { amount, abilities_only: abilitiesOnly });
}

function stripReminder(text: string): string {
  return text.replace(/\s*\([^)]*\)/g, '').trim();
}

/** Lines of oracle text for the face that is played, with card names replaced by "~". */
export function abilityLines(card: ScryfallCard): string[] {
  const face = playedFace(card);
  const names = [card.name, ...(card.card_faces ?? []).map((f) => f.name)];
  const shortNames = names.map((nm) => nm.split(',')[0]).filter((s) => s.length > 3);
  let text = face.oracle_text;
  for (const nm of [...names, ...shortNames].sort((a, b) => b.length - a.length)) {
    text = text.split(nm).join('~');
  }
  return text
    .split('\n')
    .map(stripReminder)
    .map((l) => l.replace(/\bthis (creature|land|artifact|enchantment|aura|equipment|spell's? creature)\b/gi, '~'))
    .filter(Boolean);
}

/** Splits a "Flying, vigilance, ward {3}" line into keyword pieces if every piece is a keyword. */
function keywordLine(line: string, card: ScryfallCard): string[] | null {
  const known = card.keywords.map((k) => k.toLowerCase());
  const parts = line.toLowerCase().split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  const ok = parts.every((p) => known.some((k) => p === k || p.startsWith(k + ' ') || p.startsWith(k + '—')));
  return ok ? parts : null;
}

/** Auto-detects tags for a card from Scryfall data. Every tag returned has source "auto". */
export function autoTag(card: ScryfallCard): CardTags {
  const face = playedFace(card);
  const tags: CardTags = {};
  const ctx: Ctx = {
    tags,
    card,
    type: face.type_line.toLowerCase(),
    line: '',
    set(key, params = {}) {
      tags[key] = { source: 'auto', params: withDefaults(key, params) };
    },
  };

  if (ctx.type.includes('land')) ctx.set('land');
  if (ctx.type.includes('creature')) {
    const p = Number(face.power);
    const t = Number(face.toughness);
    ctx.set('power', { value: Number.isFinite(p) ? p : 0 });
    ctx.set('toughness', { value: Number.isFinite(t) ? t : 0 });
  }

  const unmodelled: string[] = [];
  const ignored: string[] = [];
  for (const line of abilityLines(card)) {
    const kws = keywordLine(line, card);
    if (kws) {
      for (const kw of kws) {
        const base = kw.split(/[\s—]/)[0];
        const tag = KEYWORD_TAGS[base];
        if (tag === 'ward') {
          const wc = kw.match(/\{(\d+)\}/);
          ctx.set('ward', { cost: wc ? Number(wc[1]) : 2 });
        } else if (tag) ctx.set(tag);
        else if (kw === 'umbra armor') mergeParams(ctx, 'aura', { umbra_armor: true });
        else if (kw.startsWith('equip')) mergeParams(ctx, 'equipment', { equip: Number(kw.match(/\{(\d+)\}/)?.[1] ?? 0) });
        else if (base === 'crew') ctx.set('vehicle', { crew: Number(kw.match(/\d+/)?.[0] ?? 1) });
        else if (kw === 'station') ctx.set('vehicle', { crew: 0 });
        else if (base === 'outlast') ctx.set('counters', { n: 1, scope: 'self' });
        else if (kw === 'spree' || base === 'entwine') ignored.push(line);
        else if (base === 'enchant') continue; // what an aura attaches to; the aura's own tag covers the effect
        else if (IRRELEVANT_KEYWORDS.has(kw) || IRRELEVANT_KEYWORDS.has(base) || kw.startsWith('partner')) ignored.push(line);
        else unmodelled.push(line);
      }
      continue;
    }
    const { unknown, skipped } = readLine(line, ctx);
    unmodelled.push(...unknown);
    ignored.push(...skipped);
  }

  // The keywords array also covers keywords granted inside text we already parsed.
  for (const kw of card.keywords) {
    const tag = KEYWORD_TAGS[kw.toLowerCase()];
    if (tag && !tags[tag] && tag !== 'ward' && new RegExp(`^${kw}\\b`, 'im').test(face.oracle_text)) ctx.set(tag);
  }

  // Only cards the engine can actually tap for mana count as color sources.
  const colors = (card.produced_mana ?? []).join('');
  if (colors && (tags.land || tags.ramp_rock || tags.ramp_dork || tags.ramp_land_aura)) ctx.set('produces_colors', { colors });

  if (unmodelled.length) ctx.set('unmodelled', { text: [...new Set(unmodelled)].join('\n') });
  if (ignored.length) ctx.set('ignored_text', { text: [...new Set(ignored)].join('\n') });
  return tags;
}

export function tagLabel(key: TagKey): string {
  return TAG_DEFS[key].label;
}
