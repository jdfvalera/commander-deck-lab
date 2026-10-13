// Matches a decklist against Commander Spellbook's combo database (built by scripts/build-combos.ts).
// Runs entirely in the browser: Spellbook's API doesn't allow calls from other sites (CORS).

import { frontFace, nameKey } from '../data/names';

/** [id, cards, templates, produces, identity, manaValueNeeded, bracketTag, popularity, mustBeCommander] */
export type RawCombo = [string, number[], number[], number[], string, number, string, number, number[]];

export interface ComboDb {
  source: string;
  builtAt: string;
  cards: string[];
  features: string[];
  templates: string[];
  combos: RawCombo[];
}

export interface ComboMatch {
  id: string;
  cards: string[];
  /** Generic requirements like "Creature with Persist or Undying": check these yourself. */
  requirements: string[];
  produces: string[];
  identity: string;
  manaValueNeeded: number;
  bracket: string;
  popularity: number;
  /** Cards in the combo that aren't in the deck (empty for complete combos). */
  missing: string[];
  url: string;
}

export interface ComboReport {
  /** Every card is in the deck and nothing else is needed. */
  complete: ComboMatch[];
  /** Every named card is in the deck, plus a generic requirement to check. */
  withRequirements: ComboMatch[];
  /** One card short, and that card fits the deck's color identity. */
  oneAway: ComboMatch[];
}

export const comboUrl = (id: string) => `https://commanderspellbook.com/combo/${id}/`;

const COLOR_ORDER = 'WUBRG';

/** "C" (colorless) or a subset of WUBRG. */
export function withinIdentity(comboIdentity: string, deckIdentity: Set<string>): boolean {
  if (comboIdentity === 'C' || comboIdentity === '') return true;
  return [...comboIdentity].every((c) => deckIdentity.has(c));
}

export function findCombos(
  db: ComboDb,
  deck: { commanders: string[]; cards: string[] },
  deckIdentity: Set<string>,
): ComboReport {
  const inDeck = new Set<string>();
  const isCommander = new Set<string>();
  for (const n of [...deck.commanders, ...deck.cards]) {
    inDeck.add(nameKey(n));
    inDeck.add(nameKey(frontFace(n)));
  }
  for (const n of deck.commanders) {
    isCommander.add(nameKey(n));
    isCommander.add(nameKey(frontFace(n)));
  }
  const has = db.cards.map((c) => inDeck.has(nameKey(c)) || inDeck.has(nameKey(frontFace(c))));
  const commanderOk = db.cards.map((c) => isCommander.has(nameKey(c)) || isCommander.has(nameKey(frontFace(c))));

  const report: ComboReport = { complete: [], withRequirements: [], oneAway: [] };
  for (const [id, cards, templates, produces, identity, mv, bracket, popularity, mustBeCommander] of db.combos) {
    if (!withinIdentity(identity, deckIdentity)) continue;
    let missing = 0;
    let missingIdx = -1;
    for (const c of cards) {
      if (!has[c]) {
        missing++;
        missingIdx = c;
        if (missing > 1) break;
      }
    }
    if (missing > 1) continue;
    // A card that must be the commander but is in the 99 doesn't count.
    if (mustBeCommander.some((c) => has[c] && !commanderOk[c])) continue;
    if (missing === 1 && mustBeCommander.includes(missingIdx)) continue;

    const match: ComboMatch = {
      id,
      cards: cards.map((c) => db.cards[c]),
      requirements: templates.map((t) => db.templates[t]),
      produces: produces.map((p) => db.features[p]),
      identity,
      manaValueNeeded: mv,
      bracket,
      popularity,
      missing: missing ? [db.cards[missingIdx]] : [],
      url: comboUrl(id),
    };
    if (missing) report.oneAway.push(match);
    else if (templates.length) report.withRequirements.push(match);
    else report.complete.push(match);
  }
  return report;
}

/** Groups one-away combos by the card you'd add, most combos first. */
export function groupByMissing(oneAway: ComboMatch[]): { card: string; combos: ComboMatch[] }[] {
  const m = new Map<string, ComboMatch[]>();
  for (const c of oneAway) m.set(c.missing[0], [...(m.get(c.missing[0]) ?? []), c]);
  return [...m].map(([card, combos]) => ({ card, combos })).sort((a, b) => b.combos.length - a.combos.length);
}

export function deckIdentityOf(identities: string[][]): Set<string> {
  const s = new Set<string>();
  for (const id of identities) for (const c of id) if (COLOR_ORDER.includes(c)) s.add(c);
  return s;
}
