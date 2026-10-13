# Validation: Commander Deck Lab against the Python prototypes

The prototypes in `reference/` (`goldfish.py`, `table_sim.py`) produced the brief's sanity-check numbers. This file
compares them with the app's engine. It explains every difference that matters, and says which differences are
corrections and which are modelling choices.

All app numbers below come from fixed seeds (seed 1). The version compare uses aligned libraries: every card the two
lists share keeps its shuffle slot.

- Goldfish: 5,000 games per list.
- Matchups: 1,000 games per pod.

The tests reproduce them; see `tests/goldfish.test.ts` and `tests/table.test.ts`.

## Goldfish

| Metric | Prototype (current) | App (current) | Prototype (revised) | App (revised) |
|---|---|---|---|---|
| Pride cast by turn 4 | ~76% | **74.2%** | ~77% | **74.8%** |
| Extra cards drawn by turn 8 | ~23 | **22.4** | ~24 | **25.4** |
| Median win turn | 11 | **11** | 11 | **11** |
| Won by turn 10 | ~47% | **34.6%** | ~45% | **48.1%** |
| Decked | ~0.7% | **1.1%** | ~2% | **8.2%** |
| Wins by poison (Triumph) | ~56% | **73%** | ~59% | **68%** |

### Why the numbers differ

1. **The Pride's ability costs {2}{U}{U}, not {2}{G}{U}.** The brief listed it as {2}{G}{U}. Scryfall's oracle text
   says {2}{U}{U}, and with Training Grounds or Biomancer's Familiar it becomes {U}{U}. The prototype ignored colors
   entirely. The app pays real colored mana, so the draw engine often waits a turn or two for a second blue source.
   This is the main reason the current list wins by turn 10 less often (34.6% vs ~47%). The Mana & Hands page flags
   the {U}{U} activation as under-supported in blue (26.8 weighted sources).
2. **Alhammarret's Archive works now.** In the prototype the check `'archive' in s.perms` never matched, because
   `perms` held card names. Every revised-list draw was single. In the app, Archive doubles every draw except the
   first in the draw step. That makes the revised list faster (48% vs 35% by turn 10) and much likelier to deck
   itself: **8.2% vs 1.1%**. That's the cost of the revision, and the "keep at least N cards in library" setting
   is the dial for it.
3. **The library buffer counts every draw already queued that turn.** The prototype checked each target on its own,
   so three 5-toughness hits could each look safe. Decking for the current list went from 6.9% (the early app, with
   the prototype's rule) to 1.1%.
4. **Draws past what fits in hand are avoided.** Without Reliquary Tower, cards beyond seven are discarded at end of
   turn. The strategy now skips targets whose draw would mostly be thrown away. This brought "extra cards by turn 8"
   from an inflated 31 down to 22.4, matching the prototype's ~23.
5. **The Pride needs an enabler to attack in the Triumph turn.** The prototype added it as a free attacker. It has
   defender, so the app pays Walking Bulwark, Assault Formation or its own ability, like any other wall.
6. **Card text is read, not assumed.** Several prototype stats were guesses. For example, Excavated Wall costs {1},
   not 2, and Mistford River Turtle grants unblockable. Sacrifice costs are paid: Waterlogged Grove used to "draw"
   every turn and stay on the battlefield.
7. **More draw engines are modelled.** Guardian Project, Wall of Blossoms, Fecund Greenshell's dig and Ohran
   Frostfang all fire, which helps explain why poison wins are a larger share.

## Matchups (revised list, three copies of each Foundations precon)

| Opponents | Prototype | App | App, opponents "spread" attacks | Losses to fliers (app) |
|---|---|---|---|---|
| 3 × Tramplesaurus Rex | ~94% | **71.5%** | 66.2% | 0% |
| 3 × Keen Engineering | ~42% | **44.7%** | 40.2% | 20% |
| 3 × Reign of Dragons | ~47% | **20.9%** | 18.2% | 75% |
| 3 × Calling All Angels | ~35% | **4.9%** | 3.8% | 92% |

**Fliers are the deck's main weakness in both models.** The app shows it far more sharply.

### Why the numbers differ

1. **Opponents attack whoever their damage gets through to.** The prototype sent each opponent only 1/n of 60% of
   its power at you, regardless of the board. In the app, each opponent picks one player per turn, weighted by the
   square root of the damage that would get through, times how threatening that player looks, with randomness.
   Walls stop ground creatures, so Rex mostly fights the other Rex decks. A flier deck's damage gets through to you
   and not to another flier deck, so three flier decks converge on you. Switching their priority to "spread" changes
   little (table above), so this isn't an artifact of one setting. You can change it per opponent on the Matchups
   page.
2. **Small fliers start early.** In logged games against Angels, 2–3-power fliers attack from turn 2. The list has
   almost no early flying blockers (Hover Barrier and Drift of Phantasms cost 3), so about 30 damage lands by turn 6.
3. **Real blocks, both ways.** Your attackers are blocked by untapped opposing creatures, so the Pride's draw only
   happens when the target connects: evasion, or an unblockable enabler you pay for. Your walls block and, with
   damage = toughness effects, kill attackers. The prototype used a single "absorb" number.
4. **Interaction is played.** Opponents wipe, remove the commander (Lightning Greaves' shroud and Esior's tax are
   respected), counter Triumph (Keen counters about 40% of Triumph casts without Veil), and Aetherize big attacks.
   You hold mana for protection and use it. Greaves on the Pride and smarter blocking were expected to help, and do:
   Rex and Keen land in or near the prototype's range despite the harsher attack model.
5. **The board curve is measured, not hand-set.** Each opponent's board grows along the curve its own decklist
   produced in the goldfish, with real creatures from that list.

### What to trust

Absolute win rates depend on modelling choices (attack targeting, aggression, how often opponents hold up
interaction). **Comparisons on the same seeds are the reliable part.**

- Revised vs Current, same seeds: **+3 points** against Dragons and Angels, **+1** against Rex, **−3** against Keen,
  and **−10** against Wretched Ranks, mostly from decking itself more often (Archive).
- Your pod (Rex · Angels · Keen): **+3 points**.

## Known simplifications

- **Goldfish opponents are passive:** nobody blocks or interacts, so protection looks useless there, and the page
  says so.
- **Opponents in matchups are profiles, not decks played card by card.** Their creatures' triggered abilities,
  combat tricks, lifegain and politics aren't modelled. You always sit in seat 1.
- **Abilities that sacrifice another permanent** (Portcullis Vine) aren't used automatically. Mistford River
  Turtle's attack trigger isn't used either.
- **Spellbook combos are assumed to work** once assembled with their mana: the combo's steps aren't played.
- **Land auras** (Utopia Sprawl, Wild Growth) add one mana a turn without being tied to a specific land.
- **"Unmodelled" text is ignored.** The Decks page lists it, separated from "ignored on purpose" text (life gain,
  creature types). Custom effects let you describe anything that matters.
