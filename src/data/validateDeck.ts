import type { DeckList, ScryfallCard } from './types';
import { isBasicLand, nameKey, oracleText } from './names';

export interface DeckIssue {
  level: 'error' | 'warning';
  message: string;
  cards?: string[];
}

export const DECK_SIZE = 100;

function typeLine(card: ScryfallCard): string {
  return card.card_faces?.[0]?.type_line ?? card.type_line;
}

function isBackground(card: ScryfallCard): boolean {
  return /Legendary/.test(typeLine(card)) && /\bBackground\b/.test(typeLine(card));
}

function canBeCommander(card: ScryfallCard): boolean {
  const type = typeLine(card);
  return (/Legendary/.test(type) && /Creature/.test(type)) || /can be your commander/i.test(oracleText(card));
}

/** What lets a card share the command zone, read from its rules text (rule 702.124 and friends). */
export function pairing(card: ScryfallCard) {
  const text = oracleText(card);
  const line = (re: RegExp) => text.split('\n').map((l) => l.replace(/\s*\(.*\)\s*$/, '').trim()).find((l) => re.test(l));
  return {
    partner: !!line(/^Partner$/),
    partnerWith: line(/^Partner with /)?.slice('Partner with '.length).trim(),
    partnerGroup: line(/^Partner—/)?.slice('Partner—'.length).trim(),
    friendsForever: !!line(/^Friends forever$/i),
    choosesBackground: !!line(/^Choose a Background$/i),
    background: isBackground(card),
    doctorsCompanion: !!line(/^Doctor's companion$/i),
    doctor: /Legendary/.test(typeLine(card)) && /\bCreature\b.*—\s*Time Lord Doctor$/.test(typeLine(card)),
  };
}

/** Whether two cards may be commanders together. Returns null when they can, else the reason they can't. */
export function pairProblem(a: ScryfallCard, b: ScryfallCard): string | null {
  const pa = pairing(a);
  const pb = pairing(b);
  const either = (f: (x: typeof pa, y: typeof pb) => boolean) => f(pa, pb) || f(pb, pa);
  if (pa.partner && pb.partner) return null;
  if (pa.partnerWith && pb.partnerWith && pa.partnerWith === b.name && pb.partnerWith === a.name) return null;
  if (pa.partnerGroup && pa.partnerGroup === pb.partnerGroup) return null;
  if (pa.friendsForever && pb.friendsForever) return null;
  if (either((x, y) => x.choosesBackground && y.background)) return null;
  if (either((x, y) => x.doctorsCompanion && y.doctor)) return null;
  if (pa.partnerWith || pb.partnerWith) {
    const [c, p] = pa.partnerWith ? [a, pa] : [b, pb];
    return `${c.name} can only partner with ${p.partnerWith}.`;
  }
  if (either((x) => x.background)) return 'A Background can only be a commander alongside a creature with "Choose a Background".';
  return "These two can't be commanders together: they need matching Partner, Friends forever, Choose a Background + Background, or Doctor's companion + the Doctor.";
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
    // A Background is a legal commander only as the second half of a pair, checked below.
    const pairedBackground = isBackground(c) && list.commanders.length === 2;
    if (!canBeCommander(c) && !pairedBackground) {
      const why = isBackground(c) ? ' A Background needs a commander with "Choose a Background" beside it.' : '';
      issues.push({ level: 'error', message: `${c.name} can't be a commander.${why}`, cards: [c.name] });
    }
  }
  if (list.commanders.length === 2) {
    const [a, b] = list.commanders.map(lookup);
    const problem = a && b ? pairProblem(a, b) : null;
    if (problem) issues.push({ level: 'error', message: problem, cards: list.commanders });
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
