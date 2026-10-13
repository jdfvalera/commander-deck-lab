import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ROLES, ROLE_LABELS, type DeckModel, type Role } from '../../../engine/deckModel';

// Fixed slot order: color follows the role, never its rank.
export const ROLE_COLORS: Record<Role, string> = {
  ramp: 'var(--series-1)', draw: 'var(--series-2)', interaction: 'var(--series-3)', creature: 'var(--series-4)', other: 'var(--series-5)', land: 'var(--series-6)',
};
const SPELL_ROLES = ROLES.filter((r) => r !== 'land');
const BUCKETS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

export function curveData(model: DeckModel) {
  const rows = BUCKETS.map((b) => ({ mv: b, ...Object.fromEntries(SPELL_ROLES.map((r) => [r, 0])) }) as Record<string, number | string>);
  for (const c of model.library) {
    if (c.isLand) continue;
    const i = Math.min(7, Math.floor(c.mv));
    rows[i][c.role] = (rows[i][c.role] as number) + c.qty;
  }
  return rows;
}

export function roleCounts(model: DeckModel): Record<Role, number> {
  const out = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  for (const c of model.library) out[c.role] += c.qty;
  return out;
}

function CurveTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((a, p) => a + (p.value || 0), 0);
  return (
    <div className="chart-tooltip">
      <strong>Mana value {label}</strong> · {total} cards
      {[...payload].reverse().filter((p) => p.value).map((p) => (
        <div key={p.dataKey}>
          <span className="sw" style={{ background: ROLE_COLORS[p.dataKey as Role], display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 6 }} />
          {ROLE_LABELS[p.dataKey as Role]}: {p.value}
        </div>
      ))}
    </div>
  );
}

/** Mana curve of the 99, nonland cards stacked by role. */
export function CurveChart({ model }: { model: DeckModel }) {
  const [table, setTable] = useState(false);
  const data = curveData(model);
  const counts = roleCounts(model);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <div className="legend" aria-label="Legend">
          {SPELL_ROLES.map((r) => (
            <span key={r}>
              <span className="sw" style={{ background: ROLE_COLORS[r] }} />
              {ROLE_LABELS[r]} ({counts[r]})
            </span>
          ))}
          <span className="muted">· Lands: {counts.land}</span>
        </div>
        <span className="spacer" />
        <button className="link small" onClick={() => setTable((t) => !t)}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <div className="table-scroll">
          <table className="plain">
            <thead>
              <tr>
                <th>Mana value</th>
                {SPELL_ROLES.map((r) => (
                  <th key={r} className="num">{ROLE_LABELS[r]}</th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.mv}>
                  <td>{row.mv}</td>
                  {SPELL_ROLES.map((r) => (
                    <td key={r} className="num">{row[r] || ''}</td>
                  ))}
                  <td className="num">{SPELL_ROLES.reduce((a, r) => a + (row[r] as number), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="mv" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} />
              <Tooltip content={<CurveTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
              {SPELL_ROLES.map((r, i) => (
                <Bar
                  key={r}
                  dataKey={r}
                  stackId="mv"
                  fill={ROLE_COLORS[r]}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  radius={i === SPELL_ROLES.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
