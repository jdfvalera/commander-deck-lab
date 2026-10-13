import type { DeckList, ScryfallCard } from './types';
import { isBasicLand, nameKey, oracleText } from './names';

export interface DeckIssue {
  level: 'error' | 'warning';
  message: string;
  cards?: string[];
}

export const DECK_SIZE = 100;

function canBeCommander(card: ScryfallCard): boolean {
  const type = card.card_faces?.[0]?.type_line ?? card.type_line;
  return (/Legendary/.test(type) && /Creature/.test(type)) || /can be your commander/i.test(oracleText(card));
}

function allowsPartner(card: ScryfallCard): boolean {
  const kw = card.keywords.map((k) => k.toLowerCase());
  return kw.some((k) => k.startsWith('partner') || k === 'friends forever' || k === "doctor's companion") ||
    /choose a background/i.test(oracleText(card));
}

/** Commander deck rules: 100 cards with commanders, color identity, singleton (basics excepted), legality. */
export function validateDeck(list: DeckList, cards: Map<string, ScryfallCard>): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const lookup = (n: string) => cards.get(nameKey(n));

  const total = list.cards.reduce((a, c) => a + c.qty, 0) + list.commanders.length;
  if (total !== DECK_SIZE) {
    issues.push({ level: 'error', message: `Deck has ${total} cards including commanders; Commander needs exactly ${DECK_SIZE}.` });
  }

  if (!list.commanders.length) {
    issues.push({ level: 'error', message: 'No commander. Put it under a "Commander" heading or mark it with *CMDR*.' });
  } else if (list.commanders.length > 2) {
    issues.push({ level: 'error', message: `Too many commanders (${list.commanders.length}).`, cards: list.commanders });
  }

  const identity = new Set<string>();
  for (const name of list.commanders) {
    const c = lookup(name);
    if (!c) continue;
    c.color_identity.forEach((x) => identity.add(x));
    if (!canBeCommander(c)) issues.push({ level: 'error', message: `${c.name} can't be a commander.`, cards: [c.name] });
  }
  if (list.commanders.length === 2) {
    const both = list.commanders.map(lookup);
    if (both.every(Boolean) && !both.every((c) => allowsPartner(c!))) {
      issues.push({ level: 'warning', message: "Two commanders, but they don't both have Partner (or a similar ability).", cards: list.commanders });
    }
  }

  const missing = [...list.commanders, ...list.cards.map((c) => c.name)].filter((n) => !lookup(n));
  if (missing.length) issues.push({ level: 'error', message: `${missing.length} card(s) not found on Scryfall.`, cards: missing });

  const offColor: string[] = [];
  const duplicates: string[] = [];
  const banned: string[] = [];
  const seen = new Map<string, number>();
  for (const name of list.commanders) seen.set(nameKey(name), 1);
  for (const e of list.cards) {
    const c = lookup(e.name);
    const k = nameKey(e.name);
    seen.set(k, (seen.get(k) ?? 0) + e.qty);
    if (!c) continue;
    if (list.commanders.length && c.color_identity.some((x) => !identity.has(x))) offColor.push(c.name);
    const anyNumber = /a deck can have any number of cards named/i.test(oracleText(c));
    const limit = /a deck can have up to (\w+) cards named/i.exec(oracleText(c));
    const max = isBasicLand(c) || anyNumber ? Infinity : limit ? wordToNumber(limit[1]) : 1;
    if ((seen.get(k) ?? 0) > max) duplicates.push(c.name);
    if (c.legalities?.commander === 'banned') banned.push(c.name);
  }
  for (const name of list.commanders) {
    const c = lookup(name);
    if (c?.legalities?.commander === 'banned') banned.push(c.name);
  }

  if (offColor.length) {
    issues.push({ level: 'error', message: `${offColor.length} card(s) outside the commander's color identity (${[...identity].join('') || 'colorless'}).`, cards: offColor });
  }
  if (duplicates.length) issues.push({ level: 'error', message: 'Singleton rule: more than one copy of a non-basic card.', cards: [...new Set(duplicates)] });
  if (banned.length) issues.push({ level: 'error', message: 'Banned in Commander.', cards: banned });
  return issues;
}

function wordToNumber(w: string): number {
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return words[w.toLowerCase()] ?? (Number(w) || 1);
}
