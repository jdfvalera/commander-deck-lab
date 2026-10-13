import { describe, expect, it } from 'vitest';
import { describeCustom, withDefaults } from '../src/tags/schema';
import { applyOverrides, setOverride } from '../src/tags/overrides';

describe('custom effects', () => {
  it('defaults describe an activated draw', () => {
    expect(describeCustom(withDefaults('custom_effect'))).toBe('Activated (free): draw 1 card');
  });

  it("describes Pemmin's Aura's toughness shift", () => {
    const p = withDefaults('custom_effect', { when: 'activated', cost: '{1}', effect: 'pump', power: -1, toughness: 1, target: 'attached' });
    expect(describeCustom(p)).toBe('Activated ({1}): the attached creature gets -1/+1');
  });

  it('describes mana, tokens and triggers', () => {
    expect(describeCustom(withDefaults('custom_effect', { when: 'activated', tap: true, effect: 'add_mana', amount: 2, colors: 'U' }))).toBe(
      'Activated ({T}): add 2 mana (U)',
    );
    expect(describeCustom(withDefaults('custom_effect', { when: 'upkeep', effect: 'token', amount: 1, power: 1, toughness: 1 }))).toBe(
      'Each upkeep: create 1 1/1 token',
    );
    expect(describeCustom(withDefaults('custom_effect', { when: 'cast_spell', effect: 'draw', once_per_turn: true }))).toBe(
      'Whenever you cast a spell: draw 1 card (once per turn)',
    );
  });

  it('three slots per card, stored as manual overrides', () => {
    let m = setOverride({}, 'pemmin\'s aura', 'custom_effect', { params: { effect: 'untap', target: 'attached', cost: '{U}' } });
    m = setOverride(m, 'pemmin\'s aura', 'custom_effect_2', { params: { effect: 'pump', power: -1, toughness: 1, cost: '{1}', target: 'attached' } });
    const tags = applyOverrides({}, m["pemmin's aura"]);
    expect(tags.custom_effect?.source).toBe('manual');
    expect(tags.custom_effect?.params).toMatchObject({ when: 'activated', effect: 'untap', amount: 1 });
    expect(tags.custom_effect_2?.params.toughness).toBe(1);
  });
});
