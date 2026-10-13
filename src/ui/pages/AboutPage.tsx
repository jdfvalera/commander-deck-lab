export function AboutPage() {
  return (
    <div className="card stack" style={{ maxWidth: 760 }}>
      <h1>How it works</h1>
      <p>
        Commander Deck Lab runs entirely in your browser. There is no account and no server: decks, tag edits and results are
        stored in this browser only (IndexedDB). Card data comes from{' '}
        <a href="https://scryfall.com/docs/api" target="_blank" rel="noreferrer">
          Scryfall
        </a>{' '}
        and is cached after the first load.
      </p>
      <h2>Tags, not guesses</h2>
      <p>
        The simulator never assumes what a card does. Each card’s oracle text is read into <strong>tags</strong> (for
        example “Defender”, “Damage = toughness”, “Unblockable enabler, power ≤ 3”). You can see the oracle text next to the
        tags on the Decks page and edit any of them. Text the tagger doesn’t understand is listed as <em>unmodelled</em>, so
        you always know what the simulator is ignoring.
      </p>
      <h2>Tools</h2>
      <ul>
        <li><strong>Goldfish</strong>: solo speed and consistency. Ignores opponents, so protection and interaction look useless there.</li>
        <li><strong>Mana &amp; Hands</strong>: exact hypergeometric odds, color sources, London mulligan with the free first mulligan.</li>
        <li><strong>Matchups</strong>: your deck card by card against opponent <em>profiles</em> built from their decklists. An approximation: compare versions on the same seeds rather than trusting absolute win rates.</li>
      </ul>
      <h2>Combos</h2>
      <p>
        The Combos panel on the Decks page checks your list against{' '}
        <a href="https://commanderspellbook.com" target="_blank" rel="noreferrer">
          Commander Spellbook
        </a>
        ’s community-maintained combo database, refreshed weekly. Each combo links back to Spellbook for the full steps.
      </p>
      <p className="muted small">
        Card data and text © Wizards of the Coast, provided by Scryfall. This site is unofficial Fan Content and is not
        approved or endorsed by Wizards.
      </p>
    </div>
  );
}
