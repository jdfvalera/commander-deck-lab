# Commander Deck Lab

Goldfish, mana and matchup simulators for Magic: The Gathering Commander decks. Static site on GitHub Pages; everything runs in the browser.

**Live:** https://jdfvalera.github.io/commander-deck-lab/

The full brief is in [PROMPT.md](PROMPT.md). `reference/` holds the Python prototypes the models are checked against.

## Develop

```sh
npm install
npm run dev          # local dev server
npm test             # Vitest (offline: uses fixtures/scryfall/cards.json)
npm run lint && npm run typecheck
npm run snapshot:scryfall   # refresh card fixtures after changing fixtures/decks
```

Card behaviour comes from Scryfall oracle text via `src/tags/autoTag.ts`, plus user edits. Anything the tagger
doesn't understand is shown as "unmodelled" on the Decks page.

> Local note: this folder lives in iCloud-synced Documents, so `node_modules` is a symlink to `node_modules.nosync`
> (iCloud skips `.nosync`). Recreate it with `mkdir node_modules.nosync && ln -s node_modules.nosync node_modules` before `npm install`.

Card data © Wizards of the Coast, via Scryfall. Unofficial Fan Content, not approved or endorsed by Wizards.
