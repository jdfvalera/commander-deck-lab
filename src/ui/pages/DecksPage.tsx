import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { formatDecklist, parseDecklist } from '../../data/parseDecklist';
import { validateDeck } from '../../data/validateDeck';
import { addVersion, diffLists, newId } from '../../data/storage';
import { EXAMPLE_DECKS } from '../../data/examples';
import type { DeckList, SavedDeck } from '../../data/types';
import { CardTable, TagChips } from '../components/CardTable';
import { TagEditor } from '../components/TagEditor';

export function DecksPage() {
  const { ready, decks, updateDecks, storageOk } = useApp();
  const [deckId, setDeckId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);

  const deck = decks.find((d) => d.id === deckId) ?? (deckId === null ? decks[0] : undefined);
  const version = deck?.versions.find((v) => v.id === versionId) ?? deck?.versions[deck.versions.length - 1];

  const loadExample = () => {
    const ex = EXAMPLE_DECKS[0];
    let d: SavedDeck = { id: newId(), name: ex.name, updatedAt: Date.now(), versions: [] };
    for (const v of ex.versions) d = addVersion(d, v.list, v.label);
    updateDecks((prev) => [d, ...prev]);
    setDeckId(d.id);
    setVersionId(null);
  };

  if (!ready) return <p className="muted">Loading…</p>;

  return (
    <div className="decks-layout">
      <aside className="card stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>Decks</h2>
          <span className="spacer" />
          <button
            onClick={() => {
              setDeckId('new');
              setVersionId(null);
            }}
          >
            + New
          </button>
        </div>
        <div className="deck-list">
          {decks.map((d) => (
            <button
              key={d.id}
              className={d.id === deck?.id ? 'active' : ''}
              onClick={() => {
                setDeckId(d.id);
                setVersionId(null);
              }}
            >
              {d.name}
              <span className="muted small"> · {d.versions.length} version{d.versions.length === 1 ? '' : 's'}</span>
            </button>
          ))}
          {decks.length === 0 && <p className="muted small">No saved decks yet.</p>}
        </div>
        <button onClick={loadExample}>Load example: The Pride of Hull Clade</button>
        {!storageOk && <div className="notice warn small">This browser isn’t letting the site save data. Decks last until you close the tab.</div>}
      </aside>

      {deckId === 'new' || !deck ? (
        <DeckEditor
          key="new"
          initialName=""
          initialText=""
          onSave={(name, list, label) => {
            let d: SavedDeck = { id: newId(), name: name || list.commanders[0] || 'Untitled deck', updatedAt: Date.now(), versions: [] };
            d = addVersion(d, list, label);
            updateDecks((prev) => [d, ...prev]);
            setDeckId(d.id);
          }}
        />
      ) : (
        <DeckEditor
          key={`${deck.id}:${version?.id}`}
          deck={deck}
          versionId={version?.id}
          onSelectVersion={setVersionId}
          initialName={deck.name}
          initialText={version ? formatDecklist(version.list) : ''}
          onSave={(name, list, label) => {
            const next = addVersion({ ...deck, name: name || deck.name }, list, label);
            updateDecks((prev) => prev.map((d) => (d.id === deck.id ? next : d)));
            setVersionId(null);
          }}
          onRename={(name) => updateDecks((prev) => prev.map((d) => (d.id === deck.id ? { ...d, name } : d)))}
          onDelete={() => {
            if (!confirm(`Delete “${deck.name}” and all its versions?`)) return;
            updateDecks((prev) => prev.filter((d) => d.id !== deck.id));
            setDeckId(null);
          }}
        />
      )}
    </div>
  );
}

interface EditorProps {
  deck?: SavedDeck;
  versionId?: string;
  onSelectVersion?: (id: string) => void;
  initialName: string;
  initialText: string;
  onSave: (name: string, list: DeckList, label: string) => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
}

function DeckEditor({ deck, versionId, onSelectVersion, initialName, initialText, onSave, onRename, onDelete }: EditorProps) {
  const { ensureCards, cards, card, cardProgress, cardError, tagsFor } = useApp();
  const [name, setName] = useState(initialName);
  const [text, setText] = useState(initialText);
  const [label, setLabel] = useState('');
  const [notFound, setNotFound] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const parsed = useMemo(() => parseDecklist(text), [text]);
  const list: DeckList = { commanders: parsed.commanders, cards: parsed.cards };
  const dirty = text.trim() !== initialText.trim();
  const names = useMemo(() => [...parsed.commanders, ...parsed.cards.map((c) => c.name)], [parsed]);

  // Saved versions load their cards straight away; pasted text waits for "Check cards".
  useEffect(() => {
    if (!initialText) return;
    let live = true;
    ensureCards(names).then((nf) => live && setNotFound(nf));
    return () => {
      live = false;
    };
    // Only on mount: later edits are checked explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loaded = names.length > 0 && names.every((n) => !!card(n) || notFound.includes(n));
  const issues = loaded ? validateDeck(list, cards) : [];
  const unmodelled = loaded
    ? names.filter((n, i) => names.indexOf(n) === i && tagsFor(n)?.unmodelled).map((n) => ({ name: n, text: String(tagsFor(n)!.unmodelled!.params.text) }))
    : [];

  const versions = deck?.versions ?? [];
  const vIndex = versions.findIndex((v) => v.id === versionId);

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row">
          <input
            aria-label="Deck name"
            placeholder="Deck name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onRename && name.trim() && name !== initialName && onRename(name.trim())}
            style={{ fontSize: '1.1rem', fontWeight: 600, flex: 1, minWidth: 0 }}
          />
          {onDelete && (
            <button className="danger" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>

        {versions.length > 0 && (
          <div className="versions">
            <span className="muted small">Version history (newest last)</span>
            {versions.map((v, i) => {
              const d = i > 0 ? diffLists(versions[i - 1].list, v.list) : null;
              return (
                <div key={v.id} className={`version ${v.id === versionId ? 'active' : ''}`}>
                  <button className="link" onClick={() => onSelectVersion?.(v.id)}>
                    {v.label}
                  </button>
                  <span className="muted small">{new Date(v.createdAt).toLocaleDateString()}</span>
                  {d && (
                    <span className="small">
                      <span className="diff-add">+{d.added.length}</span> / <span className="diff-rem">−{d.removed.length}</span>
                    </span>
                  )}
                </div>
              );
            })}
            {vIndex > 0 && <SwapList from={versions[vIndex - 1].list} to={versions[vIndex].list} />}
          </div>
        )}

        <label className="field">
          Decklist: paste from Moxfield, Archidekt, Arena or MTGO. Mark the commander with a “Commander” heading or *CMDR*.
          <textarea className="mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Commander\n1 The Pride of Hull Clade\n\nDeck\n1 Sol Ring\n…'} />
        </label>

        <div className="row">
          <button className="primary" disabled={!names.length || !!cardProgress} onClick={() => ensureCards(names).then(setNotFound)}>
            Check cards
          </button>
          <span className="muted small">
            {parsed.cards.reduce((a, c) => a + c.qty, 0) + parsed.commanders.length} cards · {parsed.commanders.length ? `Commander: ${parsed.commanders.join(' + ')}` : 'no commander'}
          </span>
          <span className="spacer" />
          {(dirty || !deck) && names.length > 0 && (
            <>
              <input aria-label="Version label" placeholder={`Label (v${versions.length + 1})`} value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 150 }} />
              <button onClick={() => onSave(name.trim(), list, label.trim())}>{deck ? 'Save as new version' : 'Save deck'}</button>
            </>
          )}
        </div>

        {cardProgress && (
          <div className="stack" style={{ gap: 4 }}>
            <span className="small muted">
              Fetching from Scryfall… {cardProgress.done}/{cardProgress.total}
            </span>
            <div className="progress">
              <div style={{ width: `${(100 * cardProgress.done) / Math.max(1, cardProgress.total)}%` }} />
            </div>
          </div>
        )}
        {cardError && <div className="notice error">{cardError}</div>}
        {parsed.warnings.map((w) => (
          <div key={w} className="notice warn">
            {w}
          </div>
        ))}
        {parsed.unparsed.length > 0 && (
          <div className="notice warn">
            Couldn’t read {parsed.unparsed.length} line(s):
            <ul>
              {parsed.unparsed.map((u) => (
                <li key={u.line}>
                  line {u.line}: <code>{u.text}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
        {notFound.length > 0 && (
          <div className="notice error">
            Not found on Scryfall (check the spelling):
            <ul>
              {notFound.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {issues.map((i) => (
          <div key={i.message} className={`notice ${i.level === 'error' ? 'error' : 'warn'}`}>
            {i.message}
            {i.cards && i.cards.length > 0 && <div className="small">{i.cards.join(', ')}</div>}
          </div>
        ))}
        {loaded && issues.length === 0 && <div className="notice ok small">Legal Commander deck: 100 cards, singleton, on color identity.</div>}
      </div>

      {loaded && (
        <div className="card">
          <div className="row">
            <h2 style={{ margin: 0 }}>Cards and tags</h2>
            <span className="spacer" />
            <span className="muted small">Click a card to see its oracle text and edit its tags.</span>
          </div>
          <CardTable list={list} selected={selected} onSelect={setSelected} />
        </div>
      )}

      {unmodelled.length > 0 && (
        <details className="card">
          <summary>
            <strong>What the simulator doesn’t understand</strong> <span className="muted">({unmodelled.length} cards)</span>
          </summary>
          <p className="muted small" style={{ marginTop: 8 }}>
            This oracle text matched no rule, so the simulator ignores it. If it matters, click the card and add a tag.
          </p>
          <table className="plain">
            <tbody>
              {unmodelled.map((u) => (
                <tr key={u.name}>
                  <td>
                    <button className="link" onClick={() => setSelected(u.name)}>
                      {u.name}
                    </button>
                    <div>
                      <TagChips tags={tagsFor(u.name)!} />
                    </div>
                  </td>
                  <td className="small" style={{ whiteSpace: 'pre-wrap' }}>
                    {u.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {selected && <TagEditor name={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function SwapList({ from, to }: { from: DeckList; to: DeckList }) {
  const d = diffLists(from, to);
  if (!d.added.length && !d.removed.length) return null;
  return (
    <details className="small">
      <summary>Changes from the previous version</summary>
      <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
        <div>
          {d.removed.map((n, i) => (
            <div key={i} className="diff-rem">
              − {n}
            </div>
          ))}
        </div>
        <div>
          {d.added.map((n, i) => (
            <div key={i} className="diff-add">
              + {n}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
