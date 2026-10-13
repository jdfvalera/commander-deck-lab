import { describe, expect, it } from 'vitest';
import cardsJson from '../fixtures/scryfall/cards.json';
import current from '../fixtures/decks/pride-current.json';
import revised from '../fixtures/decks/pride-revised.json';
import { autoTag } from '../src/tags/autoTag';
import { nameKey } from '../src/data/names';
import type { ScryfallCard } from '../src/data/types';

const cards = cardsJson as ScryfallCard[];
const byName = new Map(cards.map((c) => [nameKey(c.name), c]));
const tagsOf = (name: string) => autoTag(byName.get(nameKey(name))!);

// Every non-basic card in both Pride lists, with the tag keys the tagger must produce from its
// real oracle text (power/toughness/produces_colors are checked separately). Reviewed by hand
// against Scryfall; a card whose text changes or a new card in the fixtures fails here.
const EXPECTED: Record<string, string[]> = {
  "Access Tunnel": ['land', 'unblockable_enabler'],
  "Aegis Turtle": [],
  "Alhammarret's Archive": ['draw_doubler', 'unmodelled'],
  "An Offer You Can't Refuse": ['counterspell'],
  "Ancient Adamantoise": ['vigilance', 'ward', 'damage_redirect', 'unmodelled'],
  "Angler Turtle": ['hexproof', 'unmodelled'],
  "Armored Scrapgorger": ['ramp_dork', 'unmodelled'],
  "Assault Formation": ['butt_damage', 'defender_can_attack', 'team_toughness_pump'],
  "Axebane Guardian": ['defender', 'ramp_dork'],
  "Beast Within": ['spot_removal'],
  "Bedrock Tortoise": ['team_hexproof', 'butt_damage'],
  "Biomancer's Familiar": ['cost_reducer_abilities', 'unmodelled'],
  "Carpet of Flowers": ['unmodelled'],
  "Cephalid Facetaker": ['unblockable', 'copy_unblockable'],
  "Charix, the Raging Isle": ['target_tax', 'unmodelled'],
  "Command Tower": ['land'],
  "Counterspell": ['counterspell'],
  "Crashing Drawbridge": ['defender', 'haste_enabler'],
  "Dispel": ['counterspell'],
  "Dreamroot Cascade": ['land', 'enters_tapped'],
  "Drift of Phantasms": ['defender', 'flying', 'unmodelled'],
  "Elusive Krasis": ['unblockable', 'unmodelled'],
  "Energy Tap": ['unmodelled'],
  "Escape Tunnel": ['land', 'land_fetch', 'unblockable_enabler'],
  "Esior, Wardwing Familiar": ['flying', 'target_tax'],
  "Excavated Wall": ['defender', 'unmodelled'],
  "Exotic Orchard": ['land'],
  "Fabled Passage": ['land', 'land_fetch'],
  "Fae Flight": ['flash', 'aura', 'unmodelled'],
  "Fecund Greenshell": ['reach', 'team_pump', 'etb_dig'],
  "Fertile Ground": ['ramp_land_aura'],
  "Final-Word Phantom": ['flash', 'flying', 'unmodelled'],
  "Flooded Grove": ['land'],
  "Geralf, Visionary Stitcher": ['sac_for_toughness_token'],
  "Gilded Goose": ['flying', 'unmodelled'],
  "Gray Harbor Merfolk": ['unblockable', 'unmodelled'],
  "Guardian Project": ['creature_etb_draw'],
  "Heroic Intervention": ['protection'],
  "Hinterland Harbor": ['land', 'enters_tapped'],
  "Horizon Chimera": ['flash', 'flying', 'trample', 'unmodelled'],
  "Hover Barrier": ['defender', 'flying'],
  "Intrude on the Mind": ['unmodelled'],
  "Ivory Tower": ['unmodelled'],
  "Karn's Bastion": ['land', 'proliferate'],
  "Key to the City": ['unblockable_enabler', 'unmodelled'],
  "Leafkin Druid": ['ramp_dork'],
  "Lightning Greaves": ['equipment', 'haste_enabler', 'protection'],
  "Lost in the Maze": ['flash', 'unmodelled'],
  "Miscast": ['counterspell'],
  "Mistford River Turtle": ['unblockable_enabler'],
  "Mnemonic Wall": ['defender', 'recursion'],
  "Ohran Frostfang": ['combat_damage_draw', 'unmodelled'],
  "Ornithopter": ['flying'],
  "Ornithopter of Paradise": ['flying', 'ramp_dork'],
  "Overgrown Battlement": ['defender', 'ramp_dork'],
  "Portcullis Vine": ['defender', 'unmodelled'],
  "Prowler's Helm": ['unblockable_enabler', 'equipment'],
  "Psychosis Crawler": ['hand_size_pt', 'draw_payoff_ping'],
  "Reality Shift": ['spot_removal'],
  "Regrowth": ['recursion'],
  "Reliquary Tower": ['land', 'no_max_hand_size'],
  "Riptide Turtle": ['flash', 'defender'],
  "Rogue's Passage": ['land', 'unblockable_enabler'],
  "Saved by the Shell": ['self_cost_reduction', 'protection'],
  "Shield Sphere": ['defender', 'unmodelled'],
  "Snapping Voidcraw": ['ramp_dork', 'unmodelled'],
  "Sol Ring": ['ramp_rock'],
  "Suspicious Bookcase": ['defender', 'unblockable_enabler'],
  "Sylvan Caryatid": ['defender', 'hexproof', 'ramp_dork'],
  "Tetsuko Umezawa, Fugitive": ['small_unblockable_grant'],
  "The Enigma Jewel // Locus of Enlightenment": ['enters_tapped', 'ramp_rock', 'unmodelled'],
  "The Pride of Hull Clade": ['self_cost_reduction', 'defender', 'grant_toughness_draw', 'defender_can_attack'],
  "The Reality Chip": ['unmodelled'],
  "Tower Defense": ['team_toughness_pump'],
  "Training Grounds": ['cost_reducer_abilities'],
  "Tree of Redemption": ['defender', 'unmodelled'],
  "Treefolk Umbra": ['aura', 'butt_damage'],
  "Triumph of the Hordes": ['mass_infect', 'team_pump'],
  "Trygon Predator": ['flying', 'unmodelled'],
  "Utopia Sprawl": ['ramp_land_aura'],
  "Veil of Summer": ['protection'],
  "Vine Trellis": ['defender', 'ramp_dork'],
  "Walking Bulwark": ['defender', 'defender_can_attack'],
  "Wall of Blossoms": ['defender', 'etb_draw'],
  "Wall of Frost": ['defender', 'unmodelled'],
  "Wall of Junk": ['defender', 'unmodelled'],
  "Wall of Roots": ['defender', 'ramp_dork'],
  "Wall of Tanglecord": ['defender', 'reach'],
  "Waterlogged Grove": ['land', 'unmodelled'],
  "Wild Growth": ['ramp_land_aura'],
  "Yavimaya Coast": ['land'],};

describe('autoTag against real oracle text', () => {
  const deckNames = new Set(
    [current, revised].flatMap((d) => [...d.commanders, ...d.cards.map((c) => c.name)]).filter((n) => n !== 'Forest' && n !== 'Island'),
  );

  it('has an expectation for every card in both decklists', () => {
    expect([...deckNames].filter((n) => !(n in EXPECTED))).toEqual([]);
  });

  for (const [name, keys] of Object.entries(EXPECTED)) {
    it(name, () => {
      const got = Object.keys(tagsOf(name)).filter((k) => !['power', 'toughness', 'produces_colors'].includes(k));
      expect(got.sort()).toEqual([...keys].sort());
    });
  }
});

describe('autoTag details that the simulator depends on', () => {
  it('reads the Pride ability cost from oracle text ({2}{U}{U}), reducible as a creature ability', () => {
    const t = tagsOf('The Pride of Hull Clade');
    expect(t.grant_toughness_draw?.params).toMatchObject({ cost: '{2}{U}{U}', creature_ability: true });
    expect(t.self_cost_reduction?.params.by).toBe('total_toughness');
    expect(t.toughness?.params.value).toBe(15);
    expect(t.defender).toBeDefined();
  });

  it('Walking Bulwark: {2}, haste, damage = toughness, sorcery speed', () => {
    expect(tagsOf('Walking Bulwark').defender_can_attack?.params).toMatchObject({ cost: '{2}', haste: true, butt: true, creature_ability: true, sorcery: true });
  });

  it('Assault Formation: {G} per defender, not a creature ability, team damage = toughness', () => {
    const t = tagsOf('Assault Formation');
    expect(t.defender_can_attack?.params).toMatchObject({ cost: '{G}', creature_ability: false });
    expect(t.butt_damage?.params.scope).toBe('team');
  });

  it('Bedrock Tortoise only converts creatures with toughness > power', () => {
    expect(tagsOf('Bedrock Tortoise').butt_damage?.params.scope).toBe('team_t_gt_p');
  });

  it('Fecund Greenshell: +2/+2 only with 10+ lands', () => {
    expect(tagsOf('Fecund Greenshell').team_pump?.params).toMatchObject({ power: 2, toughness: 2, min_lands: 10, until_eot: false });
  });

  it('Geralf makes ONE X/X flier for {U}', () => {
    expect(tagsOf('Geralf, Visionary Stitcher').sac_for_toughness_token?.params).toMatchObject({ cost: '{U}', flying: true });
  });

  it('Lightning Greaves grants shroud (blocks your own targeting) and haste, equip {0}', () => {
    expect(tagsOf('Lightning Greaves').equipment?.params).toMatchObject({ equip: 0, shroud: true, haste: true });
  });

  it('Sylvan Caryatid has hexproof (not shroud)', () => {
    const t = tagsOf('Sylvan Caryatid');
    expect(t.hexproof).toBeDefined();
    expect(t.shroud).toBeUndefined();
  });

  it('per-defender mana creatures', () => {
    expect(tagsOf('Overgrown Battlement').ramp_dork?.params.per_defender).toBe(true);
    expect(tagsOf('Axebane Guardian').ramp_dork?.params.per_defender).toBe(true);
    expect(tagsOf('Wall of Roots').ramp_dork?.params.shrinks).toBe(true);
  });

  it('Sol Ring makes 2, Enigma Jewel makes 2 for abilities only and enters tapped', () => {
    expect(tagsOf('Sol Ring').ramp_rock?.params.amount).toBe(2);
    const j = tagsOf('The Enigma Jewel // Locus of Enlightenment');
    expect(j.ramp_rock?.params).toMatchObject({ amount: 2, abilities_only: true });
    expect(j.enters_tapped).toBeDefined();
  });

  it('unblockable enablers carry their restrictions', () => {
    expect(tagsOf('Access Tunnel').unblockable_enabler?.params).toMatchObject({ cost: '{3}', kind: 'land', max_power: 3 });
    expect(tagsOf('Escape Tunnel').unblockable_enabler?.params).toMatchObject({ max_power: 2, sacrifice: true });
    expect(tagsOf("Rogue's Passage").unblockable_enabler?.params).toMatchObject({ cost: '{4}', max_power: 0 });
    expect(tagsOf('Key to the City').unblockable_enabler?.params).toMatchObject({ discard: true, tap: true });
    expect(tagsOf("Prowler's Helm").unblockable_enabler?.params).toMatchObject({ kind: 'equip', walls_can_block: true });
    expect(tagsOf("Prowler's Helm").equipment?.params.equip).toBe(2);
  });

  it('Psychosis Crawler: P/T = hand size, pings on draw', () => {
    const t = tagsOf('Psychosis Crawler');
    expect(t.hand_size_pt).toBeDefined();
    expect(t.draw_payoff_ping?.params.amount).toBe(1);
  });

  it('Triumph is mass infect + trample; Tower Defense is +0/+5 and reach', () => {
    expect(tagsOf('Triumph of the Hordes').mass_infect).toBeDefined();
    expect(tagsOf('Triumph of the Hordes').team_pump?.params).toMatchObject({ power: 1, toughness: 1, trample: true });
    expect(tagsOf('Tower Defense').team_toughness_pump?.params).toMatchObject({ amount: 5, reach: true });
  });

  it('counterspell scopes', () => {
    expect(tagsOf('Counterspell').counterspell?.params).toMatchObject({ scope: 'any', soft: false });
    expect(tagsOf('Dispel').counterspell?.params.scope).toBe('instant');
    expect(tagsOf('Miscast').counterspell?.params).toMatchObject({ scope: 'instant_sorcery', soft: true });
    expect(tagsOf("An Offer You Can't Refuse").counterspell?.params.scope).toBe('noncreature');
  });

  it('only real mana sources produce colors', () => {
    expect(tagsOf('Carpet of Flowers').produces_colors).toBeUndefined();
    expect(tagsOf('Gilded Goose').produces_colors).toBeUndefined();
    expect(tagsOf('Command Tower').produces_colors?.params.colors).toBe('BGRUW');
    expect(tagsOf('Utopia Sprawl').produces_colors).toBeDefined();
  });

  it('lists the text it does not understand', () => {
    expect(String(tagsOf('Intrude on the Mind').unmodelled?.params.text)).toMatch(/Reveal the top five/);
    expect(tagsOf('Hover Barrier').unmodelled).toBeUndefined();
  });

  it('every tag is marked as auto', () => {
    for (const c of cards) for (const v of Object.values(autoTag(c))) expect(v!.source).toBe('auto');
  });
});
