import { useApp } from '../state';
import { playedFace } from '../../data/names';
import type { DeckList, ScryfallCard } from '../../data/types';
import { TAG_DEFS, type CardTags, type TagKey } from '../../tags/schema';
import { ManaCost } from './ManaCost';

const GROUPS = ['Commander', 'Creature', 'Planeswalker', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Battle', 'Land', 'Other'] as const;
// Shown elsewhere in the row, or too common to be useful as a chip.
const HIDDEN_CHIPS = new Set<TagKey>(['power', 'toughness', 'land', 'produces_colors', 'unmodelled', 'ignored_text']);

function groupOf(card: ScryfallCard): (typeof GROUPS)[number] {
  const t = playedFace(card).type_line;
  if (/Land/.test(t)) return 'Land';
  for (const g of GROUPS) if (t.includes(g)) return g;
  return 'Other';
}

function chipText(key: TagKey, tags: CardTags): string {
  const t = tags[key]!;
  const p = t.params;
  switch (key) {
    case 'ramp_rock':
    case 'ramp_dork':
      return `${TAG_DEFS[key].label} +${p.per_defender ? 'X' : p.per_toughness ? 'T' : p.amount}${p.cost ? ` for ${p.cost}` : ''}`;
    case 'activated_draw':
      return `Draw ${p.n || 'X'} for ${p.cost}${p.tap ? ', T' : ''}`;
    case 'repeat_draw':
      return `Draw each ${String(p.when).replace('_', ' ')}`;
    case 'spot_removal':
      return `Removal (${p.kind})`;
    case 'board_wipe':
      return `Wipe (${p.kind})`;
    case 'untapper':
      return `Untap ${p.scope}${p.cost ? ` for ${p.cost}` : ''}`;
    case 'defender_can_attack':
    case 'grant_toughness_draw':
    case 'unblockable_enabler':
      return `${TAG_DEFS[key].label} ${p.cost}${p.max_power ? ` (pow ≤${p.max_power})` : ''}`;
    case 'team_toughness_pump':
      return `Team +0/+${p.amount}`;
    case 'team_pump':
      return `Team +${p.power}/+${p.toughness}${p.min_lands ? ` (${p.min_lands}+ lands)` : ''}`;
    case 'counterspell':
      return `Counter ${String(p.scope).replace('_', '/')}`;
    case 'ward':
      return `Ward ${p.cost}`;
    default:
      return TAG_DEFS[key].label;
  }
}

export function TagChips({ tags }: { tags: CardTags }) {
  const keys = (Object.keys(tags) as TagKey[]).filter((k) => !HIDDEN_CHIPS.has(k));
  return (
    <span className="tags">
      {keys.map((k) => (
        <span key={k} className={`chip ${tags[k]!.source === 'manual' ? 'manual' : ''}`} title={TAG_DEFS[k].help}>
          {chipText(k, tags)}
        </span>
      ))}
      {tags.unmodelled && <span className="chip unmodelled" title={String(tags.unmodelled.params.text)}>not modelled</span>}
    </span>
  );
}

export function CardTable({ list, selected, onSelect }: { list: DeckList; selected: string | null; onSelect: (name: string) => void }) {
  const { card, tagsFor } = useApp();
  const rows = [
    ...list.commanders.map((n) => ({ name: n, qty: 1, commander: true })),
    ...list.cards.map((c) => ({ ...c, commander: false })),
  ];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const c = card(r.name);
    const g = r.commander ? 'Commander' : c ? groupOf(c) : 'Other';
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }

  return (
    <div>
      {GROUPS.filter((g) => groups.has(g)).map((g) => {
        const rs = groups.get(g)!.sort((a, b) => (card(a.name)?.cmc ?? 0) - (card(b.name)?.cmc ?? 0) || a.name.localeCompare(b.name));
        const count = rs.reduce((a, r) => a + r.qty, 0);
        return (
          <section key={g} className="card-group">
            <h3>
              {g} ({count})
            </h3>
            {rs.map((r) => {
              const c = card(r.name);
              const face = c ? playedFace(c) : null;
              const tags = tagsFor(r.name);
              return (
                <button
                  key={r.name}
                  className={`card-row ${selected === r.name ? 'selected' : ''}`}
                  onClick={() => c && onSelect(r.name)}
                  disabled={!c}
                >
                  <span className="qty">{r.qty}</span>
                  <span className="name">
                    {c?.name ?? r.name} {face && <ManaCost cost={face.mana_cost} />}
                    {!c && <span className="chip unmodelled">not found</span>}
                  </span>
                  <span className="muted small">
                    {tags?.hand_size_pt ? '*/*' : tags?.toughness ? `${tags.power?.params.value ?? 0}/${tags.toughness.params.value}` : ''}
                  </span>
                  {tags && <TagChips tags={tags} />}
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
