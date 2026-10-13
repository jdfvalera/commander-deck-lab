import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../state';
import { decodeDeck } from '../../data/share';
import { addVersion, newId } from '../../data/storage';
import type { SavedDeck } from '../../data/types';

/** Opens a shared deck link: preview, then save it to this browser. */
export function SharePage() {
  const { data = '' } = useParams();
  const shared = useMemo(() => decodeDeck(data), [data]);
  const { updateDecks, updateOverrides } = useApp();
  const [withTags, setWithTags] = useState(true);
  const navigate = useNavigate();
  if (!shared) {
    return (
      <div className="card stack">
        <h1 style={{ margin: 0 }}>Shared deck</h1>
        <div className="notice error">This link doesn’t contain a deck (it may have been cut off when it was copied).</div>
        <Link to="/">Go to your decks</Link>
      </div>
    );
  }
  const count = shared.list.cards.reduce((a, c) => a + c.qty, 0) + shared.list.commanders.length;
  const tagCards = Object.keys(shared.overrides ?? {}).length;
  const save = () => {
    let d: SavedDeck = { id: newId(), name: shared.name, updatedAt: Date.now(), versions: [] };
    d = addVersion(d, shared.list, 'Shared');
    updateDecks((prev) => [d, ...prev]);
    if (withTags && shared.overrides) updateOverrides((prev) => ({ ...prev, ...shared.overrides }));
    navigate('/');
  };
  return (
    <div className="card stack" style={{ maxWidth: 640 }}>
      <h1 style={{ margin: 0 }}>Shared deck: {shared.name}</h1>
      <p style={{ margin: 0 }}>
        {shared.list.commanders.join(' + ') || 'No commander'} · {count} cards
      </p>
      {tagCards > 0 && (
        <label className="small">
          <input type="checkbox" checked={withTags} onChange={(e) => setWithTags(e.target.checked)} /> Also use the sharer’s tag edits for {tagCards} card
          {tagCards === 1 ? '' : 's'} (replaces yours for those cards)
        </label>
      )}
      <details className="small">
        <summary>Decklist</summary>
        <div className="mana-log">{[...shared.list.commanders.map((c) => `1 ${c} (commander)`), ...shared.list.cards.map((c) => `${c.qty} ${c.name}`)].join('\n')}</div>
      </details>
      <div className="row">
        <button className="primary" onClick={save}>Save to my decks</button>
        <Link to="/">Cancel</Link>
      </div>
    </div>
  );
}
