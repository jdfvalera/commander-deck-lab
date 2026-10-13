import type { KeepRules } from '../../engine/mulligan';

export function RulesForm({ rules, onChange }: { rules: KeepRules; onChange: (r: KeepRules) => void }) {
  const num = (k: keyof KeepRules, label: string, min: number, max: number) => (
    <label>
      {label} <input type="number" min={min} max={max} value={Number(rules[k])} onChange={(e) => onChange({ ...rules, [k]: Number(e.target.value) })} style={{ width: 52 }} />
    </label>
  );
  return (
    <div className="row small">
      <span className="muted">Keep if:</span>
      {num('minLands', 'lands from', 0, 7)}
      {num('maxLands', 'to', 0, 7)}
      {num('minEarlyPlays', 'and plays with MV ≤ 2: at least', 0, 7)}
      <label><input type="checkbox" checked={rules.rampCountsAsLand} onChange={(e) => onChange({ ...rules, rampCountsAsLand: e.target.checked })} /> cheap rocks/dorks count as lands</label>
      {num('maxMulligans', 'max mulligans', 0, 6)}
      <label><input type="checkbox" checked={rules.freeFirstMulligan} onChange={(e) => onChange({ ...rules, freeFirstMulligan: e.target.checked })} /> free first mulligan</label>
    </div>
  );
}
