import { describe, expect, it } from 'vitest';
import current from '../fixtures/decks/pride-current.json';
import { decodeDeck, encodeDeck, makeBackup, mergeBackup, overridesFor, parseBackup } from '../src/data/share';
import type { SavedDeck } from '../src/data/types';

describe('share links', () => {
  it('round-trips a full 100-card deck and stays a sensible URL length', () => {
    const enc = encodeDeck({ v: 1, name: 'Pride', list: current });
    expect(decodeDeck(enc)?.list).toEqual(current);
    expect(enc.length).toBeLessThan(2500);
    expect(enc).toMatch(/^[A-Za-z0-9+\-$]+$/);
  });
  it('rejects garbage', () => {
    expect(decodeDeck('not-a-deck')).toBeNull();
    expect(decodeDeck('')).toBeNull();
  });
  it('carries only the tag edits for cards in the deck', () => {
    const o = overridesFor(current, { 'sol ring': { haste: { params: {} } }, 'black lotus': { haste: { params: {} } } });
    expect(Object.keys(o)).toEqual(['sol ring']);
  });
});

describe('backups', () => {
  const deck = (id: string, versions: string[]): SavedDeck => ({ id, name: id, updatedAt: 1, versions: versions.map((v, i) => ({ id: v, label: v, createdAt: i, list: { commanders: [], cards: [] } })) });
  it('round-trips and validates', () => {
    const b = makeBackup([deck('a', ['v1'])], { x: {} });
    expect(parseBackup(JSON.stringify(b)).decks).toHaveLength(1);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/backup/);
  });
  it('merges: new decks added, missing versions appended, nothing lost', () => {
    const r = mergeBackup([deck('a', ['v1'])], {}, makeBackup([deck('a', ['v1', 'v2']), deck('b', ['v1'])], { 'sol ring': { haste: { params: {} } } }));
    expect(r.added).toBe(1);
    expect(r.updated).toBe(1);
    expect(r.decks.find((d) => d.id === 'a')!.versions.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(r.overrides['sol ring']).toBeDefined();
  });
});

describe('saved runs', () => {
  it('keeps the newest 30, deletes by id, and travels in backups', async () => {
    const { addRun, deleteRun, loadRuns, saveRuns } = await import('../src/data/results');
    await saveRuns([]);
    for (let i = 0; i < 32; i++) await addRun({ id: `r${i}`, kind: 'goldfish', createdAt: i, label: 'x', headline: '', data: {} });
    const runs = await loadRuns();
    expect(runs).toHaveLength(30);
    expect(runs[0].id).toBe('r31');
    expect((await deleteRun('r31')).map((r) => r.id)).not.toContain('r31');
    const b = makeBackup([], {}, await loadRuns());
    expect(parseBackup(JSON.stringify(b)).runs).toHaveLength(29);
  });
});
