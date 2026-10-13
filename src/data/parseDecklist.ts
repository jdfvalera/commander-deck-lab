import type { DeckEntry, DeckList } from './types';
import { nameKey } from './names';

export interface ParseResult extends DeckList {
  /** Lines that couldn't be read as a card. */
  unparsed: { line: number; text: string }[];
  /** Non-fatal notes, e.g. "commander guessed from the last block". */
  warnings: string[];
}

type Section = 'main' | 'commander' | 'ignore';

const SECTION_HEADERS: [RegExp, Section][] = [
  [/^(commanders?|command zone)$/i, 'commander'],
  [/^(deck|main|mainboard|main deck|library)$/i, 'main'],
  [/^(sideboard|side|maybeboard|maybe|considering|tokens?|companion)$/i, 'ignore'],
];

// "1", "1x", "1 x", "x1"
const QTY = /^(?:(\d+)\s*x?|x(\d+))\s+/i;
// Moxfield/Arena set + collector number: "(MKM) 172", "(c21) 263a", "(PLST) LRW-123"
const SET_CODE = /\s+\([A-Za-z0-9]{2,6}\)(?:\s+[A-Za-z0-9★-]+)?/;
// Foil/etched markers and Archidekt categories: "*F*", "*E*", "[Ramp]", "[Commander{top}]"
const FOIL = /\s+\*[FE]\*/gi;
const CATEGORY = /\s+\[([^\]]*)\]/g;
const CMDR_MARK = /\s*\*CMDR\*\s*/i;

function headerOf(line: string): Section | null {
  const t = line
    .replace(/^\/\/\s*/, '')
    .replace(/^#+\s*/, '')
    .replace(/:$/, '')
    .replace(/\s*\(\d+\)$/, '')
    .trim();
  for (const [re, s] of SECTION_HEADERS) if (re.test(t)) return s;
  return null;
}

/**
 * Parses pasted decklists: "1 Card", "1x Card", bare "Card", Arena/Moxfield exports with
 * "Commander"/"Deck" sections, Archidekt "[Commander{top}]" categories, MTGO "*CMDR*" markers,
 * and set codes like "(MKM) 172", which are ignored.
 */
export function parseDecklist(text: string): ParseResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const main: DeckEntry[] = [];
  const commanders: string[] = [];
  const unparsed: ParseResult['unparsed'] = [];
  const warnings: string[] = [];
  let section: Section = 'main';
  let sawCommanderSection = false;
  // Blocks separated by blank lines, for the MTGO "commander last" guess.
  const blocks: DeckEntry[][] = [[]];

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      if (blocks[blocks.length - 1].length) blocks.push([]);
      return;
    }
    const header = headerOf(line);
    if (header) {
      section = header;
      if (header === 'commander') sawCommanderSection = true;
      if (blocks[blocks.length - 1].length) blocks.push([]);
      return;
    }
    if (line.startsWith('//') || line.startsWith('#')) return;

    let rest = line;
    let qty = 1;
    const q = rest.match(QTY);
    if (q) {
      qty = Number(q[1] ?? q[2]);
      rest = rest.slice(q[0].length);
    }
    let isCommander = section === 'commander';
    if (CMDR_MARK.test(rest)) {
      isCommander = true;
      rest = rest.replace(CMDR_MARK, ' ');
    }
    for (const m of rest.matchAll(CATEGORY)) {
      const cats = m[1].split(',').map((c) => c.replace(/\{.*\}/, '').trim().toLowerCase());
      if (cats.includes('commander')) isCommander = true;
      if (cats.some((c) => c === 'maybeboard' || c === 'sideboard')) return;
    }
    rest = rest.replace(CATEGORY, '').replace(FOIL, '').replace(SET_CODE, '').trim();
    rest = rest.replace(/\s*\/\/?\s*/g, ' // ');

    if (!rest || !/[A-Za-z]/.test(rest) || qty < 1) {
      unparsed.push({ line: i + 1, text: raw });
      return;
    }
    if (section === 'ignore' && !isCommander) return;
    if (isCommander) {
      commanders.push(rest);
      return;
    }
    const entry = { name: rest, qty };
    main.push(entry);
    blocks[blocks.length - 1].push(entry);
  });

  // MTGO-style exports put the commander(s) alone in a final block after a blank line.
  if (!commanders.length && !sawCommanderSection) {
    const nonEmpty = blocks.filter((b) => b.length);
    const last = nonEmpty[nonEmpty.length - 1];
    if (nonEmpty.length > 1 && last.length <= 2 && last.every((e) => e.qty === 1)) {
      for (const e of last) {
        commanders.push(e.name);
        main.splice(main.indexOf(e), 1);
      }
      warnings.push(`No commander was marked, so the last block was used: ${last.map((e) => e.name).join(', ')}.`);
    }
  }

  return { commanders, cards: mergeEntries(main), unparsed, warnings };
}

/** Combines duplicate names (case-insensitive), keeping the first spelling and the original order. */
export function mergeEntries(entries: DeckEntry[]): DeckEntry[] {
  const byKey = new Map<string, DeckEntry>();
  for (const e of entries) {
    const k = nameKey(e.name);
    const prev = byKey.get(k);
    if (prev) prev.qty += e.qty;
    else byKey.set(k, { ...e });
  }
  return [...byKey.values()];
}

/** Serialises a decklist back to the Arena-style text the parser reads. */
export function formatDecklist(list: DeckList): string {
  const out: string[] = [];
  if (list.commanders.length) out.push('Commander', ...list.commanders.map((c) => `1 ${c}`), '');
  out.push('Deck', ...list.cards.map((c) => `${c.qty} ${c.name}`));
  return out.join('\n');
}
