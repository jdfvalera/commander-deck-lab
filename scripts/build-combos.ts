// Builds public/combos.json from Commander Spellbook's bulk export (https://commanderspellbook.com).
// The export is ~700 MB, larger than V8's maximum string, so it's streamed and split into one
// object per combo variant. Only what the app needs is kept: card names, what the combo
// produces, color identity, mana needed and the id for linking back to the site.
// Usage: npm run build:combos [-- --input path/to/variants.json]
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';

const SOURCE = 'https://json.commanderspellbook.com/variants.json';
const OUT = 'public/combos.json';

interface Variant {
  id: string;
  status: string;
  uses: { card: { name: string }; mustBeCommander: boolean; quantity: number }[];
  requires: { template: { name: string; scryfallQuery?: string | null }; mustBeCommander: boolean; quantity: number }[];
  produces: { feature: { name: string } }[];
  identity: string;
  manaValueNeeded: number;
  bracketTag: string;
  popularity: number | null;
  legalities: { commander: boolean };
}

/** Yields each top-level object of the "variants" array as raw bytes. */
async function* variantObjects(stream: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let parts: Buffer[] = [];
  let collecting = false;
  for await (const chunk of stream) {
    let start = collecting ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (b === 0x5c) escaped = true; // backslash
        else if (b === 0x22) inString = false; // quote
        continue;
      }
      if (b === 0x22) inString = true;
      else if (b === 0x7b || b === 0x5b) {
        depth++;
        // root object = 1, "variants" array = 2, each variant object = 3
        if (depth === 3 && b === 0x7b) {
          collecting = true;
          start = i;
          parts = [];
        }
      } else if (b === 0x7d || b === 0x5d) {
        depth--;
        if (depth === 2 && collecting && b === 0x7d) {
          parts.push(chunk.subarray(start, i + 1));
          yield Buffer.concat(parts);
          collecting = false;
          start = -1;
        }
      }
    }
    if (collecting) parts.push(chunk.subarray(start));
  }
}

async function main() {
  const inputIdx = process.argv.indexOf('--input');
  let stream: AsyncIterable<Buffer>;
  if (inputIdx > 0) {
    stream = createReadStream(process.argv[inputIdx + 1]);
  } else {
    const res = await fetch(SOURCE, { headers: { 'User-Agent': 'CommanderDeckLab/0.1 (github.com/jdfvalera/commander-deck-lab)' } });
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
    stream = Readable.fromWeb(res.body as never) as AsyncIterable<Buffer>;
  }

  const cardIdx = new Map<string, number>();
  const featureIdx = new Map<string, number>();
  const templateIdx = new Map<string, number>();
  const intern = (m: Map<string, number>, s: string) => {
    let i = m.get(s);
    if (i === undefined) m.set(s, (i = m.size));
    return i;
  };

  // [id, cards, templates, produces, identity, manaValueNeeded, bracketTag, popularity, commanderCards]
  const combos: [string, number[], number[], number[], string, number, string, number, number[]][] = [];
  let seen = 0;
  for await (const raw of variantObjects(stream)) {
    seen++;
    const v = JSON.parse(raw.toString('utf8')) as Variant;
    if (v.status !== 'OK' || !v.legalities?.commander) continue;
    combos.push([
      v.id,
      v.uses.map((u) => intern(cardIdx, u.card.name)),
      v.requires.map((r) => intern(templateIdx, r.template.name)),
      v.produces.map((p) => intern(featureIdx, p.feature.name)),
      v.identity,
      v.manaValueNeeded,
      v.bracketTag,
      v.popularity ?? 0,
      v.uses.filter((u) => u.mustBeCommander).map((u) => intern(cardIdx, u.card.name)),
    ]);
    if (seen % 20000 === 0) console.log(`  read ${seen} variants…`);
  }

  // Most popular first, so the UI can show the best-known lines on top.
  combos.sort((a, b) => b[7] - a[7]);
  const out = {
    source: 'Commander Spellbook (commanderspellbook.com)',
    builtAt: new Date().toISOString(),
    cards: [...cardIdx.keys()],
    features: [...featureIdx.keys()],
    templates: [...templateIdx.keys()],
    combos,
  };
  mkdirSync('public', { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync(OUT, json);
  console.log(`read ${seen}, kept ${combos.length} combos, ${cardIdx.size} cards -> ${OUT} (${(json.length / 1e6).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
