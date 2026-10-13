import { describe, expect, it } from 'vitest';
import corpusJson from '../fixtures/scryfall/corpus.json';
import { autoTag } from '../src/tags/autoTag';
import { nameKey } from '../src/data/names';
import type { ScryfallCard } from '../src/data/types';

// Common Commander cards outside the Pride deck, from the top-1000 corpus snapshot.
const byName = new Map((corpusJson as ScryfallCard[]).map((c) => [nameKey(c.name), c]));
const tagsOf = (name: string) => {
  const c = byName.get(nameKey(name));
  if (!c) throw new Error(`${name} missing from corpus fixture`);
  return autoTag(c);
};

describe('autoTag on general Commander staples', () => {
  it('mana rocks: free, paid (Signets) and filters', () => {
    expect(tagsOf('Arcane Signet').ramp_rock?.params).toMatchObject({ amount: 1, cost: '' });
    expect(tagsOf('Dimir Signet').ramp_rock?.params).toMatchObject({ amount: 2, cost: '{1}' });
    expect(tagsOf('Prismite').mana_filter).toBeDefined();
    expect(tagsOf('Prismite').ramp_rock).toBeUndefined();
  });

  it('Vhal makes colorless equal to its toughness, not spendable on spells from hand', () => {
    expect(tagsOf('Vhal, Candlekeep Researcher').ramp_dork?.params).toMatchObject({ per_toughness: true, restricted: true });
  });

  it('card draw: activated, repeating, opponent-tax', () => {
    expect(tagsOf('Arcane Encyclopedia').activated_draw?.params).toMatchObject({ cost: '{3}', n: 1, tap: true });
    expect(tagsOf('Phyrexian Arena').repeat_draw?.params.when).toBe('upkeep');
    expect(tagsOf('Rhystic Study').repeat_draw?.params.when).toBe('opponent_casts');
  });

  it('removal, bounce, tuck and wipes', () => {
    expect(tagsOf('Swords to Plowshares').spot_removal?.params).toMatchObject({ kind: 'exile', targets: 'creature' });
    expect(tagsOf('Capsize').spot_removal?.params).toMatchObject({ kind: 'bounce', targets: 'permanent' });
    expect(tagsOf('Cyclonic Rift').spot_removal?.params).toMatchObject({ kind: 'bounce', targets: 'nonland' });
    expect(tagsOf('Chaos Warp').spot_removal?.params.kind).toBe('tuck');
    expect(tagsOf('Wash Out').board_wipe?.params.kind).toBe('bounce');
    expect(tagsOf('Toxic Deluge').board_wipe?.params.kind).toBe('minus');
  });

  it('opponent consolation text is ignored, not tagged as ours', () => {
    const p = tagsOf('Path to Exile');
    expect(p.ramp_spell).toBeUndefined();
    expect(String(p.ignored_text?.params.text)).toMatch(/Its controller may search/);
    expect(tagsOf('Swords to Plowshares').unmodelled).toBeUndefined();
  });

  it('ramp, tutors, treasure, shocklands', () => {
    expect(tagsOf('Cultivate').ramp_spell?.params).toMatchObject({ lands: 1, tapped: true });
    expect(tagsOf('Demonic Tutor').tutor?.params.to).toBe('hand');
    expect(tagsOf('Smothering Tithe').treasure).toBeDefined();
    const crypt = tagsOf('Blood Crypt');
    expect(crypt.enters_tapped?.params.conditional).toBe(true);
    expect(crypt.unmodelled).toBeUndefined();
  });

  it('untappers and play-from-top (combo and value pieces)', () => {
    expect(tagsOf('Staff of Domination').untapper?.params).toMatchObject({ cost: '{3}', scope: 'target creature' });
    expect(tagsOf('Mystic Forge').play_from_top).toBeDefined();
    expect(tagsOf("Mm'menon, the Right Hand").mana_grant?.params.restricted).toBe(true);
  });

  it('protection', () => {
    expect(tagsOf("Teferi's Protection").protection).toBeDefined();
  });
});
