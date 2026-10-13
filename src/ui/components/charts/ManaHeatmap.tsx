import { useState } from 'react';
import { MANA_CAP, type ManaDistribution } from '../../../engine/mulligan';

// Fixed share bins (not relative to the biggest cell), so later turns stay readable and turns compare fairly.
const BINS = [0.002, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5];
const BIN_LABELS = ['<2%', '2–5%', '5–10%', '10–20%', '20–35%', '35–50%', '50%+'];

/** Share of games with each amount of mana on each turn: turns across, mana up, one sequential hue. */
export function ManaHeatmap({ dist, title }: { dist: ManaDistribution; title: string }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<{ t: number; m: number } | null>(null);
  const turns = dist.share.length;
  // Show mana rows up to the highest amount seen in at least 0.5% of games on some turn.
  const top = Math.max(3, ...dist.share.flatMap((row) => row.map((p, m) => (p >= 0.005 ? m : 0))));
  const rows = Array.from({ length: top + 1 }, (_, i) => top - i);
  const step = (p: number) => {
    let s = -1;
    for (let i = 0; i < BINS.length; i++) if (p >= BINS[i]) s = i;
    return s;
  };
  const atLeast = (t: number, k: number) => dist.share[t].slice(k).reduce((a, b) => a + b, 0);
  const label = (m: number) => (m === MANA_CAP ? `${MANA_CAP}+` : String(m));
  const readout = hover
    ? `Turn ${hover.t + 1}: ${label(hover.m)} mana in ${(100 * dist.share[hover.t][hover.m]).toFixed(1)}% of games · at least ${label(hover.m)} in ${(100 * atLeast(hover.t, hover.m)).toFixed(1)}% · median ${dist.median[hover.t]}`
    : 'Hover or tap a cell for its numbers. Ringed cells are each turn’s median.';

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <strong className="small">{title}</strong>
        <span className="spacer" />
        <button className="link small" onClick={() => setTable((x) => !x)}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <div className="table-scroll">
          <table className="plain small">
            <thead>
              <tr>
                <th>Turn</th>
                <th className="num">Median</th>
                <th className="num">Mean</th>
                {[2, 3, 4, 5, 6, 7, 8].map((k) => (
                  <th key={k} className="num">≥{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dist.share.map((_, t) => (
                <tr key={t}>
                  <td>{t + 1}</td>
                  <td className="num">{dist.median[t]}</td>
                  <td className="num">{dist.mean[t].toFixed(1)}</td>
                  {[2, 3, 4, 5, 6, 7, 8].map((k) => (
                    <td key={k} className="num">{(100 * atLeast(t, k)).toFixed(0)}%</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="heatmap" style={{ gridTemplateColumns: `2.2em repeat(${turns}, 1fr)` }} onMouseLeave={() => setHover(null)} role="img" aria-label={`${title}. Use “Show table” for the numbers.`}>
            {rows.map((m) => (
              <div key={`r${m}`} className="heatmap-row" style={{ display: 'contents' }}>
                <span className="heatmap-axis">{label(m)}</span>
                {dist.share.map((row, t) => {
                  const s = step(row[m]);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`heatmap-cell ${dist.median[t] === m ? 'median' : ''} ${hover?.t === t && hover.m === m ? 'hover' : ''}`}
                      style={{ background: s < 0 ? 'transparent' : `var(--seq-${s})` }}
                      onMouseEnter={() => setHover({ t, m })}
                      onFocus={() => setHover({ t, m })}
                      onClick={() => setHover({ t, m })}
                      aria-label={`Turn ${t + 1}, ${label(m)} mana: ${(100 * row[m]).toFixed(1)}%`}
                    />
                  );
                })}
              </div>
            ))}
            <span />
            {dist.share.map((_, t) => (
              <span key={t} className="heatmap-axis x">{t + 1}</span>
            ))}
          </div>
          <div className="row small" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Turn →  · mana ↑</span>
            <span className="heatmap-scale" aria-label="Color scale: share of games">
              {BIN_LABELS.map((l, i) => (
                <span key={l} className="bin">
                  <span className="sw" style={{ background: `var(--seq-${i})` }} />
                  {l}
                </span>
              ))}
            </span>
          </div>
          <div className="small heatmap-readout">{readout}</div>
        </>
      )}
    </div>
  );
}
