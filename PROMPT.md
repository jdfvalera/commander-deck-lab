# Claude Code prompt: Commander Deck Lab

> Paste everything below the line into Claude Code, from inside an empty folder. Put `goldfish.py` and `table_sim.py` in a `reference/` folder in that same directory first.

---

## What we're building

Build **Commander Deck Lab**, a static web app hosted on **GitHub Pages**, with three tools for testing a Magic: The Gathering Commander deck:

1. **Goldfish simulator.** Speed and consistency in solo play.
2. **Opening hand & mana analyzer.** Land counts, color sources, mulligans, early plays.
3. **Matchup simulator.** My deck against my playgroup's actual decks in a 4-player game.

I play casual Commander. My main deck is **The Pride of Hull Clade** (green-blue defenders/walls). The tools must work for **any** deck, but they should model my deck especially well. Both decklists are at the bottom of this prompt.

The `reference/` folder has two rough Python prototypes we built in a chat session: `goldfish.py` and `table_sim.py`. Read them first. They show the modelling approach and the numbers they produced, which are your sanity check. Do **not** port them line by line. They have hard-coded card data and shortcuts that this project should replace.

## Hard constraints

- **Static only.** GitHub Pages serves files. There is no server, so all simulation runs in the browser.
- **Stack:** Vite + TypeScript + React. Run simulations in a **Web Worker** so the UI never freezes. Use Vitest for tests.
- **Deploy** with a GitHub Actions workflow that builds and publishes to Pages on every push to `main`. Set Vite's `base` correctly for a project page (`/<repo-name>/`).
- **Card data comes from the Scryfall API, called from the browser.** Use `POST https://api.scryfall.com/cards/collection` (up to 75 identifiers per request) and respect Scryfall's rate guidance (about 10 requests per second, with a delay between calls). Cache results in IndexedDB so a deck loads instantly the second time. Handle double-faced cards (`The Enigma Jewel // Locus of Enlightenment`) and report card names that weren't found.
- **No accounts, no backend.** Decks, tags, and saved results live in the browser (IndexedDB/localStorage, wrapped in try/catch). Add **Export/Import JSON** so I can back up or move my data, and a **shareable URL** that encodes a decklist.
- **Deterministic and seeded.** Every simulation takes a seed, so the same seed gives the same result. This is required for tests and for comparing two deck versions fairly (run both on the same seeds).

## Lessons from the prototype (read carefully)

These mistakes happened during design. Build the app so they can't happen silently.

1. **Never guess card text.** During design I was wrong about several cards: Geralf makes *one* X/X token, not X tokens; Whispersilk Cloak's shroud blocks *your own* abilities too; Fecund Greenshell's +2/+2 only applies with 10+ lands. All behavior must come from Scryfall oracle text plus tags the user can see and edit. Show each card's oracle text next to its tags.
2. **Shroud vs. hexproof matters.** A creature with shroud can't be targeted by the Pride's own ability. Model targeting legality.
3. **Decking is a real risk.** The Pride's draw isn't optional. A 13-toughness wall connecting draws 13. The goldfish showed 0.7–2% of games decking out. Track it, and give the strategy a "keep at least N cards in library" setting.
4. **Mana creatures can't both tap for mana and attack.** Keep them home on the big turn.
5. **The goldfish ignores opponents**, so protection cards look useless there. Label this clearly in the UI so nobody cuts Heroic Intervention because of a goldfish number.
6. **The matchup model is an approximation.** Opponents are profiles built from their decklists, not card-by-card AI. Show a short "how this is modelled" note on every results page, and label comparisons (Version A vs B on the same seeds) as more trustworthy than absolute percentages.

## Architecture

```
src/
  data/scryfall.ts         # fetch + IndexedDB cache, collection batching, errors
  data/parseDecklist.ts    # paste formats: "1 Card Name", "1x Card Name", Moxfield/Archidekt exports,
                           # "Commander" section or *CMDR* marker, set codes "(MKM) 172" ignored
  tags/autoTag.ts          # oracle text -> tags (regex/keyword heuristics)
  tags/overrides.ts        # user edits to tags, stored per card name
  engine/state.ts          # game state types
  engine/rng.ts            # seeded PRNG (e.g. mulberry32)
  engine/goldfish.ts       # solo turn loop
  engine/mana.ts           # hypergeometric math + mulligan simulation
  engine/table.ts          # 4-player matchup loop
  engine/strategies/       # pluggable "how to pilot" logic
    generic.ts             # sensible default for any deck
    prideOfHullClade.ts    # my deck's plan (see below)
  opponents/profile.ts     # build an opponent profile from a decklist via tags
  worker/sim.worker.ts     # runs N games, posts progress + results
  ui/                      # pages, charts, deck editor, tag editor
reference/                 # the two Python prototypes (read-only)
```

### Card tags (the core abstraction)

Every card gets a set of tags, **auto-detected from oracle text** and **editable by the user**. Each tag records its source ("auto" or "manual"), and the tag editor shows the oracle text beside the tags. Start with at least these:

- **Mana:** `land`, `ramp_rock` (artifact that taps for mana, with amount), `ramp_dork` (creature, with amount, `per_defender` for Overgrown Battlement/Axebane Guardian), `ramp_land_aura` (Utopia Sprawl, Wild Growth), `ramp_spell`, `produces_colors[]`, `enters_tapped`.
- **Body:** `power`, `toughness`, `defender`, `flying`, `reach`, `vigilance`, `trample`, `haste`, `shroud`, `hexproof`, `ward`, `indestructible`, `hand_size_pt` (Psychosis Crawler, Body of Knowledge).
- **Plan pieces:** `butt_damage` (assigns damage equal to toughness: Bedrock Tortoise, Assault Formation, Treefolk Umbra), `defender_can_attack` (Walking Bulwark, Assault Formation), `mass_infect` (Triumph of the Hordes), `team_toughness_pump` (Tower Defense), `unblockable_enabler` (Key to the City, Rogue's Passage, Prowler's Helm, tunnels), `cost_reducer_abilities` (Training Grounds, Biomancer's Familiar), `draw_payoff_ping` (Psychosis Crawler), `draw_doubler` (Alhammarret's Archive), `recursion` (Regrowth, Mnemonic Wall).
- **Card flow:** `draw_n`, `etb_draw`.
- **Interaction:** `board_wipe` (with subtype: destroy, damage-X, exile, bounce, toughness-conditional), `spot_removal`, `counterspell` (with scope: any / noncreature / instant), `protection` (Heroic Intervention, Saved by the Shell, Veil of Summer, Lightning Greaves).
- `unmodelled` for anything the engine ignores. List these in the UI so I can see what the sim doesn't understand.

Auto-tagging only needs to be good, not perfect, because the editor fixes the rest. Write unit tests for the auto-tagger against real oracle text for every card in both of my decklists.

## Tool 1: Goldfish simulator

Input: a deck, a strategy, number of games (default 5,000), max turns (default 20), and a seed. **Commander rules:** 40 life, 3 phantom opponents at 40, first draw on turn 1 is allowed in 4-player, commander tax +2 per recast.

Outputs (with charts):
- **Commander cast turn:** distribution, % by turn 3/4/5, and the cost paid (the Pride costs X less based on total toughness).
- **Cards drawn by turn N** (beyond draw steps).
- **Win turn distribution** and cumulative % by turn 8/10/12/15, split by win type (combat damage, poison/Triumph, Crawler pings).
- **Failure modes:** decked, flooded, screwed, no win by max turn.
- **Per-card "impact"**: win turn when the card was drawn by turn 6 vs. not. Flag it as correlation, not causation.
- **Version compare:** load two deck versions (or a decklist plus a list of swaps), run both on identical seeds, and show the deltas side by side.
- **Sample game log:** step through one seeded game turn by turn, showing hand, board, and every decision. This is how I'll debug the strategy.

## Tool 2: Opening hand & mana analyzer

- **Exact hypergeometric math** (not simulation) for: P(≥k lands in opening 7), P(a card from a chosen group by turn N, on the draw/play), P(≥k sources of each color by turn N).
- **Color requirements:** read pips from my spells' mana costs. Check source counts against a standard guideline (cite Frank Karsten's mana-source tables in the UI, and make the target adjustable). Count dual lands, any-color lands (Command Tower, Exotic Orchard), and mana dorks/auras as sources, with dorks weighted a little lower since they die. Flag when a key activated cost (the Pride's ability needs {U}{U} with Training Grounds) is under-supported.
- **Mulligan simulator:** London mulligan with Commander's **free first mulligan**. Rules are configurable ("keep 2–5 lands and at least one 2-mana play"). Report keep rate, average cards kept, and how mulligans affect commander cast turn.
- **Hand sampler:** draw a random hand, then "keep or mull?" with stats on what that hand does in the goldfish over its next 4 turns.
- **Curve view:** mana value histogram split by role (ramp, wall, payoff, interaction, land).

## Tool 3: Matchup simulator (my deck vs my pod)

- I paste up to **3 opponent decklists** (or pick from presets). Each one becomes an **opponent profile**, built automatically from tags with editable numbers:
  - Counts of board wipes (by subtype), spot removal, counterspells, Aetherize-style effects, and taxes like Propaganda.
  - Evasion: share of fliers, trample, unblockable.
  - Board growth curve (power on board by turn), estimated from creature count and curve. Editable.
  - Speed and aggression slider, and target priority (attacks the biggest threat vs. spreads damage).
- **My side plays card by card** using my strategy, with real blocking checks. Fliers can only be blocked by flying or reach. Trample pushes through. My hand holds protection and spends it on the right threats: Counterspell on a wipe, Saved by the Shell on removal aimed at the commander, Veil of Summer on the Triumph turn.
- **Opponents interact:** they wipe when my board is big, remove my commander or key pieces, counter my key spell, and attack each other as well as me.
- **Outputs:** win rate, win turn, loss reasons (killed by fliers vs. ground, decked, timed out), times my commander was removed, how often Triumph was countered, which protection cards actually got used. Also a matchup matrix showing my deck against each opponent tripled, and against the full pod.
- **Presets:** include profiles for the four Foundations Commander precons (Tramplesaurus Rex, Calling All Angels, Keen Engineering, Reign of Dragons), built by fetching their published decklists. Store the decklists as JSON in the repo, not scraped at runtime.

### Prototype results to sanity-check against

Treat these as ballpark targets, not exact numbers. Explain in a short `VALIDATION.md` why your numbers differ.

- **Goldfish, my current deck:** Pride cast by turn 4 in ~76% of games, ~23 extra cards drawn by turn 8, median win turn 11, ~47% win by turn 10, ~0.7% decked.
- **Goldfish, revised deck:** similar speed, more Triumph wins, decking ~2%.
- **Matchups (revised deck):** ~94% against 3× Tramplesaurus Rex, ~35% against 3× Calling All Angels, ~42% against 3× Keen Engineering, ~47% against 3× Reign of Dragons. **Fliers are my deck's main weakness.** If your model doesn't show that, something is off.
- The prototype did **not** put Lightning Greaves on the commander and didn't block intelligently. Your version should, so expect better matchup numbers.

## Strategy: The Pride of Hull Clade

Implement this as `prideOfHullClade.ts`, with every number as a setting exposed in the UI.

**Card facts (verified from oracle text):**
- **The Pride of Hull Clade** {10}{G}: costs X less, where X is the total toughness of creatures you control. Defender. 2/15. Ability: **{2}{G}{U}**: until end of turn, target creature you control gets +1/+0, gains "whenever this deals combat damage to a player, draw cards equal to its toughness," and can attack as though it didn't have defender. Training Grounds and Biomancer's Familiar reduce the cost (minimum one mana).
- **Walking Bulwark** {1}, 0/3 defender: {2}: target defender gains haste, can attack, and assigns combat damage equal to toughness (sorcery speed).
- **Triumph of the Hordes:** creatures you control get +1/+1 and gain trample and infect until end of turn.
- **Tower Defense:** creatures you control get +0/+5 and gain reach until end of turn.
- **Ancient Adamantoise:** 8/20 vigilance, ward {3}. All damage to you and your other permanents is dealt to it instead. Damage isn't removed from it at cleanup.
- **Charix, the Raging Isle:** 0/17, no defender.
- **Psychosis Crawler:** P/T equal to hand size. Whenever you draw, each opponent loses 1 life.
- **Fecund Greenshell:** +2/+2 to your creatures only while you control 10+ lands.
- **Geralf, Visionary Stitcher:** {U}, tap, sacrifice another nontoken creature → **one** X/X flying Zombie, where X is its toughness.
- **Cephalid Facetaker:** at beginning of combat, may become a copy of another creature until end of turn, but stays a 1/4 unblockable. Copying a legendary creature means one gets lost to the legend rule.

**Plan:**
1. **Develop:** cheap ramp and walls first. Cast the Pride once its cost fits. Put Lightning Greaves on the Pride, since its ability targets other creatures and shroud doesn't get in the way.
2. **Draw engine:** each turn, aim the Pride's ability at the best target that can **actually connect** (evasive vs that opponent, or made unblockable by an enabler you can afford). Prefer 4–7 toughness. Avoid huge-toughness targets unless the hit wins, or library size allows it after the "minimum library" buffer.
3. **Hold the win pieces:** keep Triumph of the Hordes and Tower Defense hidden, and hold butt-damage enablers when possible. The point is that opponents see no poison all game.
4. **Win turn:** cast Triumph when the poison math is lethal against blockers. Each opponent needs 10 poison from unblocked or trampling attackers. Cast Tower Defense after blockers (+5 toughness each). Pay for defenders to attack using Walking Bulwark, Assault Formation, or the Pride's ability, whichever is cheapest. Protect the turn with Veil of Summer, Counterspell, Heroic Intervention.
5. **Backups:** Psychosis Crawler pings, Geralf making one big flier, Karn's Bastion proliferate to finish anyone at 8–9 poison.

The **generic strategy** should cover any deck reasonably: play a land, cast spells by priority (ramp, then card draw, then threats), attack when it's favorable, and hold up interaction when it has instants.

## UI requirements

- Pages: **Decks** (paste, import, save, version history, tag editor), **Goldfish**, **Mana & Hands**, **Matchups**, **About/How it works**.
- Mobile-friendly. I'll check results on my phone.
- Progress bar while sims run, plus a Cancel button.
- Charts: use a small charting library (Recharts or Chart.js). Keep the palette accessible and consistent, with a light and dark mode.
- Every results screen has: the seed, the game count, the deck version, a "how this is modelled" expander, and a "Copy results as text" button so I can paste them into a chat.

## Testing and quality

- **Vitest unit tests** for: decklist parsing (all supported formats), the auto-tagger against real oracle text, the hypergeometric functions (check against known values), the Pride's cost reduction, Training Grounds math, Triumph lethal math, the shroud/hexproof targeting rule, and decking.
- **Golden tests:** a fixed seed and deck must produce exactly the same summary numbers every run.
- **Performance:** 5,000 goldfish games in under ~10 seconds on a mid-range laptop. Use typed arrays or lean state if needed.
- Lint and type-check in CI. A failing test blocks the deploy.

## How to work

1. **Start in plan mode.** Read `reference/`, then propose the file layout, the tag schema, and a milestone plan. Wait for my OK before writing code.
2. **Milestones**, each one deployable:
   - M1: repo scaffold, Pages deploy workflow, decklist parser, Scryfall fetch + cache, deck page with card list and auto-tags.
   - M2: Tool 2 (mana & hands). Pure math, easiest to verify.
   - M3: Tool 1 (goldfish) with the generic strategy, then the Pride strategy and version compare.
   - M4: Tool 3 (matchups) with opponent profiles and Foundations presets.
   - M5: polish: share URLs, export/import, sample game viewer, `VALIDATION.md`.
3. After each milestone: run the tests, deploy, tell me the live URL and what to try, and list what's knowingly simplified.
4. **Ask before** adding a paid service, a backend, or a heavy dependency.
5. Commit in small, clearly described steps. I'll create the GitHub repo (or you can with `gh repo create` if I'm signed in). Name it `commander-deck-lab` unless I say otherwise.

## My decks (fixtures; save them as JSON in the repo)

### Current deck: The Pride of Hull Clade

```
Commander
1 The Pride of Hull Clade

Deck
1 Access Tunnel
1 Aegis Turtle
1 An Offer You Can't Refuse
1 Ancient Adamantoise
1 Angler Turtle
1 Armored Scrapgorger
1 Assault Formation
1 Beast Within
1 Bedrock Tortoise
1 Biomancer's Familiar
1 Carpet of Flowers
1 Cephalid Facetaker
1 Charix, the Raging Isle
1 Command Tower
1 Counterspell
1 Crashing Drawbridge
1 Dispel
1 Dreamroot Cascade
1 Elusive Krasis
1 Energy Tap
1 Escape Tunnel
1 Esior, Wardwing Familiar
1 Excavated Wall
1 Exotic Orchard
1 Fabled Passage
1 Fae Flight
1 Fecund Greenshell
1 Fertile Ground
1 Final-Word Phantom
1 Flooded Grove
11 Forest
1 Geralf, Visionary Stitcher
1 Gilded Goose
1 Gray Harbor Merfolk
1 Guardian Project
1 Hinterland Harbor
1 Horizon Chimera
1 Hover Barrier
1 Intrude on the Mind
14 Island
1 Ivory Tower
1 Key to the City
1 Leafkin Druid
1 Lightning Greaves
1 Lost in the Maze
1 Miscast
1 Mistford River Turtle
1 Ohran Frostfang
1 Ornithopter
1 Ornithopter of Paradise
1 Overgrown Battlement
1 Portcullis Vine
1 Psychosis Crawler
1 Reality Shift
1 Reliquary Tower
1 Riptide Turtle
1 Snapping Voidcraw
1 Sol Ring
1 Suspicious Bookcase
1 Sylvan Caryatid
1 Tetsuko Umezawa, Fugitive
1 The Enigma Jewel // Locus of Enlightenment
1 The Reality Chip
1 Training Grounds
1 Treefolk Umbra
1 Triumph of the Hordes
1 Trygon Predator
1 Utopia Sprawl
1 Walking Bulwark
1 Wall of Blossoms
1 Wall of Junk
1 Wall of Roots
1 Wall of Tanglecord
1 Waterlogged Grove
1 Wild Growth
1 Yavimaya Coast
```

### Revised deck: same list with these 16 swaps

| Cut | Add |
|---|---|
| Ornithopter | Shield Sphere |
| Gilded Goose | Tree of Redemption |
| Gray Harbor Merfolk | Vine Trellis |
| Snapping Voidcraw | Wall of Frost |
| Fae Flight | Drift of Phantasms |
| Horizon Chimera | Axebane Guardian |
| Angler Turtle | Tower Defense |
| Lost in the Maze | Regrowth |
| Carpet of Flowers | Mnemonic Wall |
| Dispel | Veil of Summer |
| Forest | Heroic Intervention |
| Forest | Karn's Bastion |
| Intrude on the Mind | Prowler's Helm |
| Energy Tap | Saved by the Shell |
| Ivory Tower | Alhammarret's Archive |
| Island | Rogue's Passage |

Both lists must come to exactly 100 cards including the commander. Validate this, and also validate color identity and singleton rules (basic lands excepted). Show any errors on the deck page.
