import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GoldfishSummary } from '../../../engine/goldfish';
import type { WinType } from '../../../engine/game';

export const WIN_LABELS: Record<WinType, string> = { combat: 'Combat damage', poison: 'Poison (infect)', pings: 'Life loss (pings)', combo: 'Spellbook combo', outlasted: 'Outlasted (opponents died to each other)' };
// Fixed slot order: color follows the win type.
const WIN_COLORS: Record<WinType, string> = { combat: 'var(--series-1)', poison: 'var(--series-2)', pings: 'var(--series-3)', combo: 'var(--series-4)', outlasted: 'var(--series-5)' };
const ORDER: WinType[] = ['combat', 'poison', 'pings', 'combo', 'outlasted'];

function Tip({ active, payload, label }: { active?: boolean; payload?: { dataKey: WinType; value: number }[]; label?: number }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((a, p) => a + p.value, 0);
  return (
    <div className="chart-tooltip">
      <strong>Won on turn {label}</strong>: {(100 * total).toFixed(1)}% of games
      {[...payload].reverse().filter((p) => p.value > 0).map((p) => (
        <div key={p.dataKey}>
          <span style={{ background: WIN_COLORS[p.dataKey], display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 6 }} />
          {WIN_LABELS[p.dataKey]}: {(100 * p.value).toFixed(1)}%
        </div>
      ))}
    </div>
  );
}

/** Share of games won on each turn, stacked by how they won. */
export function WinTurnChart({ s }: { s: GoldfishSummary }) {
  const [table, setTable] = useState(false);
  const types = ORDER.filter((w) => s.winShare[w] > 0);
  const data = Array.from({ length: s.maxTurns }, (_, t) => ({
    turn: t + 1,
    ...Object.fromEntries(types.map((w) => [w, s.winByTurn[w][t] - (t ? s.winByTurn[w][t - 1] : 0)])),
  }));
  const last = data.reduce((m, d, i) => (types.some((w) => (d as Record<string, number>)[w] > 0.001) ? i : m), 0);
  const shown = data.slice(0, Math.max(8, last + 1));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <strong className="small">Win turn (share of games)</strong>
        <div className="legend">
          {types.map((w) => (
            <span key={w}>
              <span className="sw" style={{ background: WIN_COLORS[w] }} />
              {WIN_LABELS[w]} {(100 * s.winShare[w]).toFixed(0)}%
            </span>
          ))}
        </div>
        <span className="spacer" />
        <button className="link small" onClick={() => setTable((x) => !x)}>{table ? 'Show chart' : 'Show table'}</button>
      </div>
      {table ? (
        <div className="table-scroll">
          <table className="plain small">
            <thead>
              <tr><th>Turn</th>{types.map((w) => <th key={w} className="num">{WIN_LABELS[w]}</th>)}<th className="num">Won by then</th></tr>
            </thead>
            <tbody>
              {shown.map((d, i) => (
                <tr key={d.turn}>
                  <td>{d.turn}</td>
                  {types.map((w) => <td key={w} className="num">{(100 * (d as Record<string, number>)[w]).toFixed(1)}%</td>)}
                  <td className="num">{(100 * s.winByTurn.total[i]).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={shown} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap="18%">
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="turn" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} />
              <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} />
              <Tooltip content={<Tip />} cursor={{ fill: 'var(--surface-2)' }} />
              {types.map((w, i) => (
                <Bar key={w} dataKey={w} stackId="w" fill={WIN_COLORS[w]} stroke="var(--surface)" strokeWidth={2} radius={i === types.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
