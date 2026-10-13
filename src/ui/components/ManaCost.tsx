/** Renders "{2}{U}{U}" as pips. Hybrid/phyrexian symbols are shown as text inside a neutral pip. */
export function ManaCost({ cost }: { cost?: string }) {
  if (!cost) return null;
  const symbols = cost.match(/\{[^}]+\}/g) ?? [];
  return (
    <span aria-label={cost}>
      {symbols.map((s, i) => {
        const v = s.slice(1, -1);
        const cls = /^[WUBRG]$/.test(v) ? v : 'C';
        return (
          <span key={i} className={`pip ${cls}`} aria-hidden>
            {v.replace('/', '')}
          </span>
        );
      })}
    </span>
  );
}
