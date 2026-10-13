// Refreshes fixtures/scryfall/cards.json: the oracle data for every card in every fixture deck,
// so unit tests run offline against real card text. Usage: npm run snapshot:scryfall
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DECK_DIRS = ['fixtures/decks', 'fixtures/decks/precons'];
const OUT = 'fixtures/scryfall/cards.json';
const BATCH = 75;
const DELAY_MS = 150;

// Fields the app actually uses; everything else is dropped to keep the fixture small.
const KEEP = [
  'name', 'layout', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'power', 'toughness',
  'colors', 'color_identity', 'keywords', 'produced_mana', 'legalities',
] as const;
const FACE_KEEP = ['name', 'mana_cost', 'type_line', 'oracle_text', 'power', 'toughness', 'colors'] as const;

function pick(obj: Record<string, unknown>, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function trim(card: Record<string, unknown>) {
  const out = pick(card, KEEP);
  if (out.legalities) out.legalities = { commander: (card.legalities as Record<string, string>).commander };
  const faces = card.card_faces as Record<string, unknown>[] | undefined;
  if (faces) out.card_faces = faces.map((f) => pick(f, FACE_KEEP));
  return out;
}

const names = new Set<string>();
for (const dir of DECK_DIRS) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const deck = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const c of deck.commanders ?? []) names.add(c);
    for (const c of deck.cards) names.add(c.name);
  }
}

const list = [...names].sort();
const found: Record<string, unknown>[] = [];
const missing: string[] = [];
for (let i = 0; i < list.length; i += BATCH) {
  // The collection endpoint doesn't match "Front // Back" names, so ask for the front face.
  const identifiers = list.slice(i, i + BATCH).map((name) => ({ name: name.split(' // ')[0] }));
  const res = await fetch('https://api.scryfall.com/cards/collection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'CommanderDeckLab/0.1' },
    body: JSON.stringify({ identifiers }),
  });
  if (!res.ok) throw new Error(`Scryfall ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data: Record<string, unknown>[]; not_found: { name: string }[] };
  found.push(...body.data.map(trim));
  missing.push(...body.not_found.map((n) => n.name));
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

found.sort((a, b) => String(a.name).localeCompare(String(b.name)));
writeFileSync(OUT, JSON.stringify(found, null, 1) + '\n');
console.log(`wrote ${found.length} cards to ${OUT}`);
if (missing.length) {
  console.error('NOT FOUND:', missing);
  process.exitCode = 1;
}
