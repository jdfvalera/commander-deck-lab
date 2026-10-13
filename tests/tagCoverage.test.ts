import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import corpusJson from '../fixtures/scryfall/corpus.json';
import { readdirSync, readFileSync } from 'node:fs';
import wideJson from '../fixtures/scryfall/decks-wide.json';
import { autoTag } from '../src/tags/autoTag';
import { parseDecklist } from '../src/data/parseDecklist';
import { cardKeys, nameKey } from '../src/data/names';
import type { ScryfallCard } from '../src/data/types';

const corpus = corpusJson as ScryfallCard[];
const byName = new Map(corpus.map((c) => [nameKey(c.name), c]));

function coverage(cards: ScryfallCard[]) {
  const withGaps = cards.filter((c) => autoTag(c).unmodelled);
  return { total: cards.length, withGaps: withGaps.length, pct: (100 * withGaps.length) / cards.length };
}

// Top 1,000 Commander cards by EDHREC rank, plus a real user deck (Vhal) that the tagger wasn't built around.
describe('auto-tag coverage on general Commander cards', () => {
  it('top-1000 corpus: most cards have no game-relevant unmodelled text', () => {
    const c = coverage(corpus);
    if (process.env.COVERAGE_REPORT) {
      const counts = new Map<string, { n: number; ex: string }>();
      for (const card of corpus) {
        const t = autoTag(card).unmodelled;
        if (!t) continue;
        for (const l of String(t.params.text).split('\n')) {
          const k = l.toLowerCase().replace(/\{[^}]+\}/g, '{N}').replace(/\d+/g, 'N').replace(/~/g, '~').slice(0, 90);
          const e = counts.get(k) ?? { n: 0, ex: card.name };
          e.n++;
          counts.set(k, e);
        }
      }
      const top = [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, 150).map(([k, v]) => `${v.n}\t${k}\t(${v.ex})`);
      writeFileSync(process.env.COVERAGE_REPORT, `corpus: ${c.withGaps}/${c.total} = ${c.pct.toFixed(1)}%\n` + top.join('\n'));
    }
    // Was 78% before the general-purpose rules; keep it from drifting back up.
    expect(c.pct).toBeLessThan(52);
  });

  it('Vhal deck', () => {
    const list = parseDecklist(readFileSync('fixtures/decks/vhal.txt', 'utf8'));
    const cards = [...list.commanders, ...list.cards.map((x) => x.name)].map((n) => byName.get(nameKey(n))).filter((x): x is ScryfallCard => !!x);
    const c = coverage(cards);
    if (process.env.COVERAGE_REPORT) {
      const lines = cards.filter((x) => autoTag(x).unmodelled).map((x) => `  ${x.name}: ${String(autoTag(x).unmodelled!.params.text).replace(/\n/g, ' | ')}`);
      writeFileSync(process.env.COVERAGE_REPORT + '.vhal', `vhal: ${c.withGaps}/${c.total} = ${c.pct.toFixed(1)}%\n` + lines.join('\n'));
    }
    expect(cards.length).toBe(65); // 66 lines minus basic Islands
    // Was 56 of 65 before; most of what's left is combo-specific text.
    expect(c.withGaps).toBeLessThanOrEqual(22);
  });
});

// 34 official Commander precons (MTGJSON) plus real user decks from Moxfield/Archidekt.
describe('auto-tag coverage across real decks', () => {
  const cards = new Map<string, ScryfallCard>();
  for (const c of wideJson as ScryfallCard[]) for (const k of cardKeys(c)) cards.set(k, c);
  const decks = ['fixtures/decks/precons', 'fixtures/decks/user'].flatMap((d) =>
    readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${d}/${f}`, 'utf8')) as { name: string; commanders: string[]; cards: { name: string }[] }),
  );
  const perDeck = decks.map((d) => {
    const uniq = [...new Set([...d.commanders, ...d.cards.map((c) => c.name)])].map((n) => cards.get(nameKey(n))!).filter((c) => !/Basic/.test(c.type_line));
    return { name: d.name, ...coverage(uniq) };
  });

  it('overall share of cards with game-relevant gaps stays under 50% (was 57%)', () => {
    const total = perDeck.reduce((a, d) => a + d.total, 0);
    const gaps = perDeck.reduce((a, d) => a + d.withGaps, 0);
    expect((100 * gaps) / total).toBeLessThan(50);
  });

  // Worst today: Creative Energy (M3C) at 64%, an energy deck; energy counters aren't simulated, so they stay flagged.
  it('no deck is worse than 65%', () => {
    expect(perDeck.filter((d) => d.pct >= 65).map((d) => `${d.name} ${d.pct.toFixed(0)}%`)).toEqual([]);
  });
});
