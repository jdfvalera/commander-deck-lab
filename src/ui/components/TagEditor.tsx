import { useEffect } from 'react';
import { useApp } from '../state';
import { nameKey } from '../../data/names';
import { autoTag } from '../../tags/autoTag';
import { resetOverride, setOverride } from '../../tags/overrides';
import { CUSTOM_KEYS, TAG_DEFS, TAG_KEYS, describeCustom, withDefaults, type ParamType, type ParamValue, type TagDef, type TagKey, type TagParams } from '../../tags/schema';
import { ManaCost } from './ManaCost';

const GROUP_LABELS: Record<TagDef['group'], string> = {
  mana: 'Mana', body: 'Body', plan: 'Plan pieces', flow: 'Card flow', interaction: 'Interaction', custom: 'Custom', meta: 'Other',
};

/** Side panel: a card's oracle text next to its tags, with every tag editable. */
export function TagEditor({ name, onClose }: { name: string; onClose: () => void }) {
  const { card, tagsFor, overrides, updateOverrides } = useApp();
  const c = card(name);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!c) return null;
  const key = nameKey(c.name);
  const tags = tagsFor(name) ?? {};
  const auto = autoTag(c);
  const cardOverrides = overrides[key] ?? {};
  const removed = (Object.keys(cardOverrides) as TagKey[]).filter((k) => cardOverrides[k] === null && auto[k]);
  // Unmodelled text is shown as a notice below, not as an editable tag.
  const present = TAG_KEYS.filter((k) => tags[k] && k !== 'unmodelled');
  const addable = TAG_KEYS.filter((k) => !tags[k] && !(CUSTOM_KEYS as readonly TagKey[]).includes(k));
  const nextCustom = CUSTOM_KEYS.find((k) => !tags[k]);

  const edit = (tag: TagKey, params: TagParams) => updateOverrides((m) => setOverride(m, key, tag, { params }));
  const remove = (tag: TagKey) => updateOverrides((m) => (auto[tag] ? setOverride(m, key, tag, null) : resetOverride(m, key, tag)));
  const reset = (tag?: TagKey) => updateOverrides((m) => resetOverride(m, key, tag));

  const faces = c.card_faces ?? [c];
  return (
    <div className="editor-backdrop" onClick={onClose}>
      <aside className="editor" role="dialog" aria-label={`Tags for ${c.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0 }}>{c.name}</h2>
          <span className="spacer" />
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        {faces.map((f, i) => (
          <div key={i} className="stack" style={{ gap: 4 }}>
            <div className="row small">
              {faces.length > 1 && <strong>{f.name}</strong>}
              <ManaCost cost={f.mana_cost} />
              <span className="muted">{f.type_line}</span>
              {f.power !== undefined && <span>{f.power}/{f.toughness}</span>}
            </div>
            <div className="oracle">{f.oracle_text || <span className="muted">(no rules text)</span>}</div>
          </div>
        ))}

        <div className="row">
          <h3 style={{ margin: 0 }}>Tags</h3>
          <span className="spacer" />
          {Object.keys(cardOverrides).length > 0 && (
            <button className="link small" onClick={() => reset()}>
              Reset all to auto
            </button>
          )}
        </div>
        {present.length === 0 && <p className="muted small">No tags. The simulator treats this card as doing nothing.</p>}
        {present.map((k) => {
          const def = TAG_DEFS[k] as TagDef;
          const t = tags[k]!;
          return (
            <div key={k} className={`tag-item ${t.source}`}>
              <div className="tag-head">
                <span className="label">{def.label}</span>
                <span className={`chip ${t.source === 'manual' ? 'manual' : ''}`}>{t.source}</span>
                <span className="muted small">{GROUP_LABELS[def.group]}</span>
                <span className="spacer" />
                {t.source === 'manual' && auto[k] && (
                  <button className="link small" onClick={() => reset(k)}>
                    reset
                  </button>
                )}
                <button className="link small danger" onClick={() => remove(k)}>
                  remove
                </button>
              </div>
              {(CUSTOM_KEYS as readonly TagKey[]).includes(k) ? (
                <div className="custom-summary">{describeCustom(t.params)}</div>
              ) : (
                <div className="muted small">{def.help}</div>
              )}
              {def.params && (
                <div className="tag-params">
                  {Object.entries(def.params).map(([p, pd]) => (
                    <ParamInput
                      key={p}
                      name={p}
                      type={pd.type}
                      value={t.params[p] ?? pd.default}
                      multiline={k === 'unmodelled'}
                      onChange={(v) => edit(k, { ...t.params, [p]: v })}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {removed.length > 0 && (
          <div className="small">
            <span className="muted">Removed auto tags: </span>
            {removed.map((k) => (
              <button key={k} className="link small" style={{ marginRight: 8 }} onClick={() => reset(k)}>
                restore {TAG_DEFS[k].label}
              </button>
            ))}
          </div>
        )}

        {tags.unmodelled && (
          <div className="notice warn small">
            <strong>Not modelled:</strong> {String(tags.unmodelled.params.text)}
            <div>If this matters, add a built-in tag below or describe it as a custom effect.</div>
          </div>
        )}
        {nextCustom && (
          <button onClick={() => edit(nextCustom, withDefaults(nextCustom))}>+ Custom effect</button>
        )}
        <label className="field">
          Add a tag
          <select
            value=""
            onChange={(e) => {
              const k = e.target.value as TagKey;
              if (k) edit(k, withDefaults(k));
            }}
          >
            <option value="">Choose…</option>
            {(Object.keys(GROUP_LABELS) as TagDef['group'][]).map((g) => (
              <optgroup key={g} label={GROUP_LABELS[g]}>
                {addable
                  .filter((k) => TAG_DEFS[k].group === g)
                  .map((k) => (
                    <option key={k} value={k}>
                      {TAG_DEFS[k].label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <p className="muted small">Edits apply to this card in every deck and are saved in this browser.</p>
      </aside>
    </div>
  );
}

function ParamInput({
  name, type, value, multiline, onChange,
}: {
  name: string;
  type: ParamType;
  value: ParamValue;
  multiline?: boolean;
  onChange: (v: ParamValue) => void;
}) {
  const label = name.replace(/_/g, ' ');
  if (type === 'boolean') {
    return (
      <label>
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
    );
  }
  if (type === 'number') {
    return (
      <label>
        {label}
        <input type="number" value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} />
      </label>
    );
  }
  if (Array.isArray(type)) {
    return (
      <label>
        {label}
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {type.map((o: string) => (
            <option key={o} value={o}>
              {o.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (multiline) {
    return <textarea rows={3} value={String(value)} onChange={(e) => onChange(e.target.value)} aria-label={label} />;
  }
  return (
    <label>
      {label}
      <input
        type="text"
        value={String(value)}
        placeholder={type === 'cost' ? '{2}{U}' : type === 'colors' ? 'GU' : ''}
        onChange={(e) => onChange(type === 'colors' ? e.target.value.toUpperCase() : e.target.value)}
      />
    </label>
  );
}
