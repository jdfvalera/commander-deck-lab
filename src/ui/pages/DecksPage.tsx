import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { formatDecklist, parseDecklist } from '../../data/parseDecklist';
import { guessCommanders, validateDeck } from '../../data/validateDeck';
import { addVersion, diffLists, newId } from '../../data/storage';
import { EXAMPLE_DECKS } from '../../data/examples';
import { download, makeBackup, mergeBackup, overridesFor, parseBackup, shareUrl } from '../../data/share';
import { loadRuns, saveRuns } from '../../data/results';
import type { DeckList, SavedDeck } from '../../data/types';
import { CardTable } from '../components/CardTable';
import { TagEditor } from '../components/TagEditor';
import { ComboPanel } from '../components/ComboPanel';

export function DecksPage() {
  const { ready, decks, updateDecks, storageOk, overrides, updateOverrides } = useApp();
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const restore = async (file: File | undefined) => {
    if (!file) return;
    try {
      const b = parseBackup(await file.text());
      const r = mergeBackup(decks, overrides, b);
      updateDecks(() => r.decks);
      updateOverrides(() => r.overrides);
      if (b.runs?.length) {
        const mine = await loadRuns();
        const have = new Set(mine.map((x) => x.id));
        await saveRuns([...mine, ...b.runs.filter((x) => !have.has(x.id))].sort((x, y) => y.createdAt - x.createdAt));
      }
      setBackupMsg(`Restored: ${r.added} new deck${r.added === 1 ? '' : 's'}, ${r.updated} with new versions, tag edits for ${Object.keys(b.tagOverrides).length} cards.`);
    } catch (e) {
      setBackupMsg(e instanceof Error ? e.message : 'That file could not be read.');
    }
  };
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
        <details className="small">
          <summary>Back up or move your data</summary>
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            <button onClick={async () => download(`commander-deck-lab-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(makeBackup(decks, overrides, await loadRuns()), null, 1))}>
              Download backup (.json)
            </button>
            <label className="button" style={{ textAlign: 'center' }}>
              Restore from backup…
              <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => restore(e.target.files?.[0])} />
            </label>
            <span className="muted">Decks, tag edits and saved runs live only in this browser. A backup merges in without deleting anything.</span>
            {backupMsg && <span>{backupMsg}</span>}
          </div>
        </details>
        {!storageOk && <div className="notice warn small">This browser isn’t letting the site save data. Decks last until you close the tab.</div>}
      </aside>

      {deckId === 'new' || !deck ? (
        <DeckEditor
          key="new"
          initialName=""
          initialText=""
          onSave={(name, list, label) => {
            let d: SavedDeck = { id: newId(), name: name || list.commanders.join(' + ') || 'Untitled deck', updatedAt: Date.now(), versions: [] };
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
  // Exports that put the commander first without a heading: use it once card data says it can lead.
  const { list, guessed } = loaded
    ? guessCommanders({ commanders: parsed.commanders, cards: parsed.cards }, card)
    : { list: { commanders: parsed.commanders, cards: parsed.cards } as DeckList, guessed: [] as string[] };
  const issues = loaded ? validateDeck(list, cards) : [];
  const unique = loaded ? names.filter((n, i) => names.indexOf(n) === i && card(n)) : [];
  const textOf = (n: string, key: 'unmodelled' | 'ignored_text') => String(tagsFor(n)?.[key]?.params.text ?? '');
  const unmodelled = unique.filter((n) => tagsFor(n)?.unmodelled).map((n) => ({ name: n, text: textOf(n, 'unmodelled') }));
  const ignored = unique.filter((n) => tagsFor(n)?.ignored_text).map((n) => ({ name: n, text: textOf(n, 'ignored_text') }));

  const versions = deck?.versions ?? [];
  const vIndex = versions.findIndex((v) => v.id === versionId);
  const version = versions[vIndex];

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
            className="deck-name"
            style={{ fontSize: '1.1rem', fontWeight: 600 }}
          />
          {deck && version && <ShareButton name={name || deck.name} list={version.list} />}
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
            {parsed.cards.reduce((a, c) => a + c.qty, 0) + parsed.commanders.length} cards · {list.commanders.length ? `Commander: ${list.commanders.join(' + ')}` : 'no commander'}
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
        {guessed.length > 0 && (
          <div className="notice warn small">
            No commander was marked, so the first card{guessed.length > 1 ? 's' : ''} ({guessed.join(' + ')}) {guessed.length > 1 ? 'are' : 'is'} used.
            To change it, add a “Commander” heading or *CMDR* in the list.
          </div>
        )}
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

      {loaded && unique.length > 0 && (
        <div className="card stack">
          <div>
            <h2 style={{ margin: 0 }}>What the simulator understands</h2>
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              {unique.length - unmodelled.length} of {unique.length} cards are fully understood from their oracle text. You don’t
              have to tag anything: text the simulator doesn’t understand is simply ignored. Add a tag only when that text is part
              of how your deck wins.
            </p>
          </div>
          {unmodelled.length > 0 && (
            <details>
              <summary>
                <strong>Could matter, not modelled</strong> <span className="muted">({unmodelled.length} cards)</span>
              </summary>
              <TextList rows={unmodelled} onSelect={setSelected} />
            </details>
          )}
          {ignored.length > 0 && (
            <details>
              <summary>
                <strong>Ignored on purpose</strong> <span className="muted">({ignored.length} cards: life gain, creature types, minor keywords…)</span>
              </summary>
              <TextList rows={ignored} onSelect={setSelected} />
            </details>
          )}
        </div>
      )}

      {loaded && list.commanders.length > 0 && <ComboPanel list={list} />}

      {selected && <TagEditor name={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ShareButton({ name, list }: { name: string; list: DeckList }) {
  const { overrides } = useApp();
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = shareUrl({ v: 1, name, list, overrides: overridesFor(list, overrides) });
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };
  return <button onClick={share} title="Copy a link that opens this version of the deck (with your tag edits) in anyone's browser">{copied ? 'Link copied ✓' : 'Share link'}</button>;
}

function TextList({ rows, onSelect }: { rows: { name: string; text: string }[]; onSelect: (name: string) => void }) {
  return (
    <table className="plain" style={{ marginTop: 8 }}>
      <tbody>
        {rows.map((u) => (
          <tr key={u.name}>
            <td style={{ width: '35%' }}>
              <button className="link" onClick={() => onSelect(u.name)}>
                {u.name}
              </button>
            </td>
            <td className="small" style={{ whiteSpace: 'pre-wrap' }}>
              {u.text}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
