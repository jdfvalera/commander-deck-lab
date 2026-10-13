// Oracle text -> tags. Each oracle line ("ability") is run through the rules below. A line no rule
// understands becomes part of the card's `unmodelled` tag, so the UI can show exactly what the
// simulator ignores. Heuristics only need to be good, not perfect: the tag editor fixes the rest.

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
const IRRELEVANT_KEYWORDS = new Set(['devoid', 'partner', 'friends forever', 'choose a background', 'enchant']);

const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };
const num = (s: string) => NUM_WORDS[s] ?? Number(s);
const costOf = (s: string) => (s.match(/\{[^}]+\}/g) ?? []).filter((x) => x !== '{t}').join('').toUpperCase();

interface Ctx {
  tags: CardTags;
  card: ScryfallCard;
  type: string; // played face type line, lowercased
  set(key: TagKey, params?: TagParams): void;
}

type Rule = { re: RegExp; apply?: (m: RegExpMatchArray, ctx: Ctx) => void };

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
  {
    re: /^\{t\}, sacrifice ~: search your library for an? basic land card, put it onto the battlefield( tapped)?/,
    apply: (m, ctx) => ctx.set('land_fetch', { tapped: !!m[1] }),
  },
  { re: /^you have no maximum hand size\.?$/, apply: (_m, ctx) => ctx.set('no_max_hand_size') },
  {
    re: /search your library for (?:up to (\w+) )?basic land cards?,? .*put (?:them|it|those cards) onto the battlefield( tapped)?/,
    apply: (m, ctx) => ctx.set('ramp_spell', { lands: m[1] ? num(m[1]) : 1, tapped: !!m[2] }),
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
  { re: /^equip \{(\d+)\}$/, apply: (m, ctx) => mergeParams(ctx, 'equipment', { equip: Number(m[1]) }) },

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
    re: /^equipped creature can't be blocked( except by walls)?\.?$/,
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
    re: /^when ~ enters, you may return target (instant or sorcery|creature|permanent) card from your graveyard to your hand\.?$/,
    apply: (m, ctx) => ctx.set('recursion', { filter: m[1] === 'instant or sorcery' ? 'instant_sorcery' : m[1], etb: true }),
  },

  // ---- interaction ----
  {
    re: /^counter target (noncreature |instant or sorcery |instant |creature )?spell( unless its controller pays \{\d+\})?\./,
    apply: (m, ctx) => {
      const scope = (m[1] ?? 'any').trim().replace(' or ', '_');
      ctx.set('counterspell', { scope, soft: !!m[2] });
    },
  },
  { re: /spells you control can't be countered this turn/, apply: (_m, ctx) => ctx.set('protection', { kind: 'uncounterable' }) },
  {
    re: /^permanents you control gain hexproof and indestructible until end of turn\.?$/,
    apply: (_m, ctx) => ctx.set('protection', { kind: 'team_hexproof_indestructible' }),
  },
  {
    re: /target creature you control\. it gains (?:[a-z]+, )*hexproof,? and indestructible until end of turn\.?$/,
    apply: (_m, ctx) => ctx.set('protection', { kind: 'single_hexproof_indestructible' }),
  },
  {
    re: /^(?!when|whenever|at )(?:.*\. )?(destroy|exile) target (creature|nonland permanent|permanent|artifact or enchantment|artifact|enchantment)\b/,
    apply: (m, ctx) => ctx.set('spot_removal', { kind: m[1], targets: removalTargets(m[2]) }),
  },
  {
    re: /^(?!when|whenever|at )(?:.*\. )?return target (creature|nonland permanent) to its owner's hand\b/,
    apply: (m, ctx) => ctx.set('spot_removal', { kind: 'bounce', targets: removalTargets(m[1]) }),
  },
  {
    re: /^(?!when|whenever|at )~ deals (\d+) damage to (?:any target|target creature)/,
    apply: (_m, ctx) => ctx.set('spot_removal', { kind: 'damage', targets: 'creature' }),
  },
  {
    re: /^(?:.*\. )?destroy all (creatures|nonland permanents|artifacts, creatures, and enchantments|artifacts and creatures)\b/,
    apply: (m, ctx) => ctx.set('board_wipe', { kind: 'destroy', artifacts: m[1] !== 'creatures' }),
  },
  { re: /^(?:.*\. )?exile all (creatures|nonland permanents)\b/, apply: (m, ctx) => ctx.set('board_wipe', { kind: 'exile', artifacts: m[1] !== 'creatures' }) },
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

function isCreature(ctx: Ctx) {
  return ctx.type.includes('creature');
}

function removalTargets(t: string): string {
  if (t === 'creature') return 'creature';
  if (t === 'nonland permanent') return 'nonland';
  if (t === 'permanent') return 'permanent';
  return 'artifact_enchantment';
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
  let amount = 1;
  let perDefender = false;
  const symbols = text.match(/^((?:\{[wubrgc]\})+)[ .]/);
  if (symbols && !/ or /.test(text.split('.')[0])) amount = symbols[1].split('}{').length;
  if (/for each creature you control with defender|where x is the number of creatures you control with defender/.test(text)) {
    perDefender = true;
  }
  const abilitiesOnly = /spend this mana only to activate abilities/.test(text);
  if (ctx.type.includes('land')) return;
  if (ctx.type.includes('creature')) ctx.set('ramp_dork', { amount, per_defender: perDefender });
  else if (ctx.type.includes('artifact')) ctx.set('ramp_rock', { amount, abilities_only: abilitiesOnly });
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
  for (const line of abilityLines(card)) {
    const lower = line.toLowerCase();
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
        else if (!IRRELEVANT_KEYWORDS.has(kw) && !IRRELEVANT_KEYWORDS.has(base)) unmodelled.push(line);
      }
      continue;
    }
    let understood = false;
    for (const rule of RULES) {
      const m = lower.match(rule.re);
      if (m) {
        understood = true;
        rule.apply?.(m, ctx);
      }
    }
    if (!understood) unmodelled.push(line);
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
  return tags;
}

export function tagLabel(key: TagKey): string {
  return TAG_DEFS[key].label;
}
