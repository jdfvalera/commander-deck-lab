import { describe, expect, it } from 'vitest';
import cardsJson from '../fixtures/scryfall/cards.json';
import { autoTag } from '../src/tags/autoTag';
import { applyOverrides, loadOverrides, resetOverride, saveOverrides, setOverride } from '../src/tags/overrides';
import { addVersion, diffLists } from '../src/data/storage';
import type { ScryfallCard, SavedDeck } from '../src/data/types';

const merfolk = (cardsJson as ScryfallCard[]).find((c) => c.name === 'Gray Harbor Merfolk')!;

describe('tag overrides', () => {
  it('manual edits replace auto tags and are marked manual', () => {
    let map = setOverride({}, 'gray harbor merfolk', 'power', { params: { value: 2 } });
    map = setOverride(map, 'gray harbor merfolk', 'unmodelled', null);
    const tags = applyOverrides(autoTag(merfolk), map['gray harbor merfolk']);
    expect(tags.power).toEqual({ source: 'manual', params: { value: 2 } });
    expect(tags.unmodelled).toBeUndefined();
    expect(tags.unblockable?.source).toBe('auto');
  });

  it('reset brings the auto tag back', () => {
    const map = resetOverride(setOverride({}, 'x', 'power', { params: { value: 9 } }), 'x', 'power');
    expect(map).toEqual({});
  });

  it('persists to IndexedDB', async () => {
    await saveOverrides({ 'sol ring': { haste: { params: {} } } });
    expect(await loadOverrides()).toEqual({ 'sol ring': { haste: { params: {} } } });
  });
});

describe('deck versions', () => {
  const deck: SavedDeck = { id: 'd', name: 'D', updatedAt: 0, versions: [] };
  const a = { commanders: ['C'], cards: [{ name: 'Forest', qty: 2 }, { name: 'Sol Ring', qty: 1 }] };
  const b = { commanders: ['C'], cards: [{ name: 'Forest', qty: 1 }, { name: 'Sol Ring', qty: 1 }, { name: 'Counterspell', qty: 1 }] };

  it('skips identical versions', () => {
    const d1 = addVersion(deck, a);
    expect(addVersion(d1, { ...a, cards: [...a.cards].reverse() })).toBe(d1);
    expect(addVersion(d1, b).versions).toHaveLength(2);
  });

  it('diffs two versions', () => {
    expect(diffLists(a, b)).toEqual({ added: ['Counterspell'], removed: ['Forest'] });
  });
});
