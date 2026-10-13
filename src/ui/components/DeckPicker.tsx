import { Link } from 'react-router-dom';
import type { ActiveDeck } from '../useActiveDeck';

export function DeckPicker({ active }: { active: ActiveDeck }) {
  const { decks, deck, version, select, loading } = active;
  if (!decks.length) {
    return (
      <div className="notice warn">
        No saved decks yet. <Link to="/">Add one on the Decks page</Link> (or load the example deck there).
      </div>
    );
  }
  return (
    <div className="row deck-picker">
      <label className="field">
        Deck
        <select value={deck?.id} onChange={(e) => select(e.target.value)}>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {deck && (
        <label className="field">
          Version
          <select value={version?.id} onChange={(e) => select(deck.id, e.target.value)}>
            {deck.versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {loading && <span className="muted small">Loading cards…</span>}
    </div>
  );
}
