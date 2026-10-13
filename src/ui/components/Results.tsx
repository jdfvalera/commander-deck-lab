import { useState, type ReactNode } from 'react';

/** The strip every results screen carries: what was run, how it's modelled, and copy-as-text. */
export function ResultsHeader({
  seed, runs, runsLabel = 'games', deckLabel, copyText, children,
}: {
  seed?: number;
  runs?: number;
  runsLabel?: string;
  deckLabel: string;
  copyText: () => string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy the results:', copyText());
    }
  };
  return (
    <div className="results-header stack">
      <div className="row small">
        <span className="muted">Deck:</span> <strong>{deckLabel}</strong>
        {runs !== undefined && (
          <>
            <span className="muted">· {runsLabel}:</span> {runs.toLocaleString()}
          </>
        )}
        {seed !== undefined && (
          <>
            <span className="muted">· seed:</span> <code>{seed}</code>
          </>
        )}
        <span className="spacer" />
        <button className="small" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy results as text'}
        </button>
      </div>
      <details className="how-modelled">
        <summary className="small">How this is modelled</summary>
        <div className="small">{children}</div>
      </details>
    </div>
  );
}

export function Progress({ done, total, onCancel }: { done: number; total: number; onCancel: () => void }) {
  return (
    <div className="row">
      <div className="progress" style={{ flex: 1 }} role="progressbar" aria-valuenow={done} aria-valuemax={total}>
        <div style={{ width: `${(100 * done) / Math.max(1, total)}%` }} />
      </div>
      <span className="small muted">
        {done.toLocaleString()}/{total.toLocaleString()}
      </span>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

export const pct = (x: number, digits = 0) => `${(100 * x).toFixed(digits)}%`;
