import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface TimingSeries {
  label: string;
  byTurn: number[];
}

const COLORS = ['var(--series-1)', 'var(--series-2)'];

function TimingTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>By turn {label}</strong>
      {payload.map((p) => (
        <div key={p.name}>
          <span style={{ background: p.color, display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 6 }} />
          {p.name}: {(100 * p.value).toFixed(1)}%
        </div>
      ))}
    </div>
  );
}

/** Cumulative "% of games by turn N" for up to two series, with a table view. */
export function TimingChart({ series, title }: { series: TimingSeries[]; title: string }) {
  const [table, setTable] = useState(false);
  const turns = series[0]?.byTurn.length ?? 0;
  const data = Array.from({ length: turns }, (_, i) => ({ turn: i + 1, ...Object.fromEntries(series.map((s) => [s.label, s.byTurn[i]])) }));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <strong className="small">{title}</strong>
        <div className="legend">
          {series.map((s, i) => (
            <span key={s.label}>
              <span className="sw" style={{ background: COLORS[i] }} />
              {s.label}
            </span>
          ))}
        </div>
        <span className="spacer" />
        <button className="link small" onClick={() => setTable((t) => !t)}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <table className="plain">
          <thead>
            <tr>
              <th>Turn</th>
              {series.map((s) => (
                <th key={s.label} className="num">{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.turn}>
                <td>{d.turn}</td>
                {series.map((s) => (
                  <td key={s.label} className="num">{(100 * (d[s.label as keyof typeof d] as number)).toFixed(1)}%</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="turn" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} />
              <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} tick={{ fill: 'var(--chart-muted)', fontSize: 12 }} />
              <Tooltip content={<TimingTooltip />} cursor={{ stroke: 'var(--chart-axis)' }} />
              {series.map((s, i) => (
                <Line key={s.label} type="linear" dataKey={s.label} name={s.label} stroke={COLORS[i]} strokeWidth={2} dot={{ r: 3, fill: COLORS[i], strokeWidth: 0 }} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
