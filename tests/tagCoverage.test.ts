import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import corpusJson from '../fixtures/scryfall/corpus.json';
import { readFileSync } from 'node:fs';
import { autoTag } from '../src/tags/autoTag';
import { parseDecklist } from '../src/data/parseDecklist';
import { nameKey } from '../src/data/names';
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
