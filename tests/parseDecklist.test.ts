import { describe, expect, it } from 'vitest';
import { formatDecklist, parseDecklist } from '../src/data/parseDecklist';
import current from '../fixtures/decks/pride-current.json';

const total = (r: ReturnType<typeof parseDecklist>) => r.cards.reduce((a, c) => a + c.qty, 0) + r.commanders.length;

describe('parseDecklist', () => {
  it('reads the Arena/Moxfield "Commander" + "Deck" sections from the prompt', () => {
    const r = parseDecklist(formatDecklist(current));
    expect(r.commanders).toEqual(['The Pride of Hull Clade']);
    expect(total(r)).toBe(100);
    expect(r.cards.find((c) => c.name === 'Island')?.qty).toBe(14);
    expect(r.cards.find((c) => c.name === 'The Enigma Jewel // Locus of Enlightenment')).toBeDefined();
    expect(r.unparsed).toEqual([]);
  });

  it('accepts "1x", bare names and merges duplicates case-insensitively', () => {
    const r = parseDecklist('1x Sol Ring\nCounterspell\n2 island\n3 Island');
    expect(r.cards).toEqual([
      { name: 'Sol Ring', qty: 1 },
      { name: 'Counterspell', qty: 1 },
      { name: 'island', qty: 5 },
    ]);
  });

  it('ignores set codes, collector numbers and foil markers (Moxfield export)', () => {
    const r = parseDecklist('1 Sol Ring (C21) 263 *F*\n1 Counterspell (MKM) 172\n1 Arcane Signet (PLST) M3C-123');
    expect(r.cards.map((c) => c.name)).toEqual(['Sol Ring', 'Counterspell', 'Arcane Signet']);
  });

  it('reads the MTGO *CMDR* marker', () => {
    const r = parseDecklist('1 The Pride of Hull Clade *CMDR*\n1 Sol Ring');
    expect(r.commanders).toEqual(['The Pride of Hull Clade']);
    expect(r.cards).toEqual([{ name: 'Sol Ring', qty: 1 }]);
  });

  it('reads Archidekt categories, including [Commander{top}] and skipping Maybeboard', () => {
    const r = parseDecklist(
      '1x The Pride of Hull Clade (blc) 1 [Commander{top}]\n1x Sol Ring (c21) 263 [Ramp]\n1x Cultivate (m21) 177 [Maybeboard{noDeck}{noPrice},Ramp]',
    );
    expect(r.commanders).toEqual(['The Pride of Hull Clade']);
    expect(r.cards).toEqual([{ name: 'Sol Ring', qty: 1 }]);
  });

  it('accepts header variants and skips sideboard/maybeboard sections', () => {
    const r = parseDecklist('// Commander\n1 Atraxa, Praetors\' Voice\n\nMainboard (2)\n1 Sol Ring\n1 Forest\n\nSideboard\n1 Cultivate');
    expect(r.commanders).toEqual(["Atraxa, Praetors' Voice"]);
    expect(r.cards.map((c) => c.name)).toEqual(['Sol Ring', 'Forest']);
  });

  it('guesses the commander from a final single-card block when nothing is marked (MTGO)', () => {
    const r = parseDecklist('1 Sol Ring\n1 Forest\n\n1 The Pride of Hull Clade');
    expect(r.commanders).toEqual(['The Pride of Hull Clade']);
    expect(r.warnings[0]).toMatch(/last block/);
    expect(r.cards.map((c) => c.name)).toEqual(['Sol Ring', 'Forest']);
  });

  it('normalises split-card slashes and curly apostrophes stay readable', () => {
    const r = parseDecklist('1 Fire//Ice\n1 An Offer You Can’t Refuse');
    expect(r.cards[0].name).toBe('Fire // Ice');
    expect(r.cards[1].name).toBe('An Offer You Can’t Refuse');
  });

  it('reports lines it cannot read', () => {
    const r = parseDecklist('1 Sol Ring\n12345\n# comment');
    expect(r.unparsed).toEqual([{ line: 2, text: '12345' }]);
  });

  it('round-trips through formatDecklist', () => {
    const r = parseDecklist(formatDecklist(current));
    expect(parseDecklist(formatDecklist(r)).cards).toEqual(r.cards);
  });
});
