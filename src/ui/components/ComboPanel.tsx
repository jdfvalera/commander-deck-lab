import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { loadComboDb } from '../../combos/comboDb';
import { deckIdentityOf, findCombos, groupByMissing, type ComboDb, type ComboMatch } from '../../combos/findCombos';
import type { DeckList } from '../../data/types';

const PAGE = 15;

function ComboRow({ c, deckCards }: { c: ComboMatch; deckCards: Set<string> }) {
  return (
    <li className="combo">
      <div>
        {c.cards.map((n, i) => (
          <span key={n}>
            {i > 0 && ' + '}
            <span className={deckCards.has(n) ? '' : 'combo-missing'}>{n}</span>
          </span>
        ))}
        {c.requirements.map((r) => (
          <span key={r}>
            {' + '}
            <em className="muted">{r}</em>
          </span>
        ))}
      </div>
      <div className="small muted">
        {c.produces.slice(0, 3).join(' · ')}
        {c.produces.length > 3 && ` · +${c.produces.length - 3} more`}
      </div>
      <div className="small">
        {c.manaValueNeeded > 0 && <span className="muted">needs {c.manaValueNeeded}+ mana · </span>}
        <a href={c.url} target="_blank" rel="noreferrer">
          Steps on Commander Spellbook ↗
        </a>
      </div>
    </li>
  );
}

function ComboList({ items, deckCards }: { items: ComboMatch[]; deckCards: Set<string> }) {
  const [shown, setShown] = useState(PAGE);
  return (
    <>
      <ul className="combo-list">
        {items.slice(0, shown).map((c) => (
          <ComboRow key={c.id} c={c} deckCards={deckCards} />
        ))}
      </ul>
      {items.length > shown && (
        <button className="link small" onClick={() => setShown((s) => s + PAGE * 2)}>
          Show more ({items.length - shown} left)
        </button>
      )}
    </>
  );
}

/** Combos in the deck and one card away, from Commander Spellbook's database. */
export function ComboPanel({ list }: { list: DeckList }) {
  const { card } = useApp();
  const [db, setDb] = useState<ComboDb | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const names = useMemo(() => [...list.commanders, ...list.cards.map((c) => c.name)], [list]);
  const identity = deckIdentityOf(list.commanders.map((n) => card(n)?.color_identity ?? []));
  const report = useMemo(
    () => (db ? findCombos(db, { commanders: list.commanders, cards: list.cards.map((c) => c.name) }, identity) : null),
    // identity derives from list + card data, both covered by `names`/`db`
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, names],
  );
  const deckCards = useMemo(() => new Set(names.map((n) => card(n)?.name ?? n)), [names, card]);

  const load = () => {
    setLoading(true);
    setError(null);
    loadComboDb()
      .then(setDb)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const f = filter.trim().toLowerCase();
  const matches = (c: ComboMatch) => !f || c.produces.some((p) => p.toLowerCase().includes(f)) || c.cards.some((n) => n.toLowerCase().includes(f));

  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Combos</h2>
        <span className="spacer" />
        {!db && (
          <button className="primary" onClick={load} disabled={loading || !list.commanders.length}>
            {loading ? 'Loading combo database…' : 'Find combos'}
          </button>
        )}
      </div>
      {!db && (
        <p className="muted small" style={{ margin: 0 }}>
          Checks this deck against Commander Spellbook’s database of {`~110,000`} known combos: the ones you already have, and
          the ones you’re a single card away from. Runs in your browser (about 2 MB to download the first time).
        </p>
      )}
      {error && <div className="notice error">{error}</div>}
      {report && db && (
        <>
          <input placeholder="Filter by result or card (e.g. “infinite mana”, “draw”)" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <details open>
            <summary>
              <strong>In your deck</strong> <span className="muted">({report.complete.length + report.withRequirements.length})</span>
            </summary>
            {report.complete.length + report.withRequirements.length === 0 && <p className="muted small">No complete combos found.</p>}
            <ComboList items={report.complete.filter(matches)} deckCards={deckCards} />
            {report.withRequirements.length > 0 && (
              <>
                <p className="small muted" style={{ margin: '8px 0 0' }}>
                  These also need a generic piece (in italics). Check you have one:
                </p>
                <ComboList items={report.withRequirements.filter(matches)} deckCards={deckCards} />
              </>
            )}
          </details>
          <details>
            <summary>
              <strong>One card away</strong>{' '}
              <span className="muted">
                ({report.oneAway.length} combos from {groupByMissing(report.oneAway).length} different cards)
              </span>
            </summary>
            {groupByMissing(report.oneAway.filter(matches))
              .slice(0, 40)
              .map((g) => (
                <details key={g.card} className="combo-group">
                  <summary>
                    Add <strong>{g.card}</strong> <span className="muted">→ {g.combos.length} combo{g.combos.length === 1 ? '' : 's'}</span>
                  </summary>
                  <ComboList items={g.combos} deckCards={deckCards} />
                </details>
              ))}
          </details>
          <p className="muted small" style={{ margin: 0 }}>
            Combo data from{' '}
            <a href="https://commanderspellbook.com" target="_blank" rel="noreferrer">
              Commander Spellbook
            </a>{' '}
            (updated {new Date(db.builtAt).toLocaleDateString()}). Missing cards are underlined.
          </p>
        </>
      )}
    </div>
  );
}
