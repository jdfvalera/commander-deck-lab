import { useMemo, useRef, useState } from 'react';
import { useActiveDeck } from '../useActiveDeck';
import { DeckPicker } from '../components/DeckPicker';
import { Progress, ResultsHeader, pct } from '../components/Results';
import { CurveChart, roleCounts } from '../components/charts/CurveChart';
import { TimingChart } from '../components/charts/TimingChart';
import { ManaHeatmap } from '../components/charts/ManaHeatmap';
import { ManaCost } from '../components/ManaCost';
import { cardsSeen, hypergeomAtLeast, hypergeomPmf } from '../../engine/hypergeo';
import { colorReports, DEFAULT_COLOR_OPTIONS, type ColorOptions } from '../../engine/colorReqs';
import { ROLES, ROLE_LABELS, type DeckModel, type Role } from '../../engine/deckModel';
import { DEFAULT_RULES, simulateHand, type KeepRules, type MulliganSummary } from '../../engine/mulligan';
import { formatCost } from '../../engine/manaCost';
import { parseSeed } from '../../engine/rng';
import { CancelledError, startJob } from '../../worker/client';

const COLOR_NAMES: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

export function ManaPage() {
  const active = useActiveDeck();
  const { model, deck, version } = active;
  const [drawOnTurnOne, setDrawOnTurnOne] = useState(true);
  const deckLabel = deck && version ? `${deck.name} · ${version.label}` : '';

  return (
    <div className="stack">
      <div className="card stack">
        <h1 style={{ margin: 0 }}>Mana &amp; Hands</h1>
        <DeckPicker active={active} />
        <label className="small">
          <input type="checkbox" checked={!drawOnTurnOne} onChange={(e) => setDrawOnTurnOne(!e.target.checked)} /> Skip the turn-1 draw (1v1
          rules; multiplayer Commander draws on turn 1)
        </label>
      </div>
      {model && (
        <>
          <LandOdds model={model} deckLabel={deckLabel} drawOnTurnOne={drawOnTurnOne} />
          <DrawOdds model={model} drawOnTurnOne={drawOnTurnOne} />
          <ColorSection model={model} deckLabel={deckLabel} drawOnTurnOne={drawOnTurnOne} />
          <MulliganSection model={model} deckLabel={deckLabel} drawOnTurnOne={drawOnTurnOne} />
          <HandSampler model={model} drawOnTurnOne={drawOnTurnOne} />
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Curve</h2>
            <CurveChart model={model} />
          </div>
        </>
      )}
    </div>
  );
}

function LandOdds({ model, deckLabel, drawOnTurnOne }: { model: DeckModel; deckLabel: string; drawOnTurnOne: boolean }) {
  const N = model.librarySize;
  const L = model.library.filter((c) => c.isLand).reduce((a, c) => a + c.qty, 0);
  const rows = Array.from({ length: 8 }, (_, k) => ({ k, p: hypergeomPmf(N, L, 7, k), atLeast: hypergeomAtLeast(N, L, 7, k) }));
  const p25 = rows.filter((r) => r.k >= 2 && r.k <= 5).reduce((a, r) => a + r.p, 0);
  const max = Math.max(...rows.map((r) => r.p));
  const landDrop = (t: number) => hypergeomAtLeast(N, L, cardsSeen(t, { drawOnTurnOne }), t);
  const text = () =>
    [`Lands in opening 7 — ${deckLabel} (${L} lands in ${N})`, ...rows.map((r) => `${r.k} lands: ${pct(r.p, 1)} (≥${r.k}: ${pct(r.atLeast, 1)})`), `2–5 lands: ${pct(p25, 1)}`,
      ...[2, 3, 4, 5].map((t) => `Land drop on turn ${t}: ${pct(landDrop(t), 1)}`)].join('\n');
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Lands in your opening hand</h2>
      <ResultsHeader deckLabel={deckLabel} copyText={text}>
        <p>Exact hypergeometric odds (no simulation) for {L} lands in a {N}-card library, 7-card hand. Modal double-faced cards count as lands only if tagged “Land”.</p>
      </ResultsHeader>
      <div className="stat-row">
        <div className="stat"><div className="v">{L}</div><div className="l">lands in the {N}</div></div>
        <div className="stat"><div className="v">{pct(p25)}</div><div className="l">opening 7 with 2–5 lands</div></div>
        {[3, 4].map((t) => (
          <div key={t} className="stat"><div className="v">{pct(landDrop(t))}</div><div className="l">hit land drop {t} on turn {t}</div></div>
        ))}
      </div>
      <table className="plain">
        <thead><tr><th>Lands in 7</th><th className="num">Exactly</th><th className="num">At least</th><th style={{ width: '40%' }} /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <td>{r.k}</td>
              <td className="num">{pct(r.p, 1)}</td>
              <td className="num">{pct(r.atLeast, 1)}</td>
              <td><div className="bar-cell"><div className="b" style={{ width: `${(100 * r.p) / max}%` }} /></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DrawOdds({ model, drawOnTurnOne }: { model: DeckModel; drawOnTurnOne: boolean }) {
  const [group, setGroup] = useState<string>('role:ramp');
  const [picked, setPicked] = useState<string[]>([]);
  const [turn, setTurn] = useState(3);
  const N = model.librarySize;
  const counts = roleCounts(model);
  const names = model.library.filter((c) => !c.isLand).map((c) => c.name).sort();
  const K = group.startsWith('role:')
    ? counts[group.slice(5) as Role]
    : model.library.filter((c) => picked.includes(c.name)).reduce((a, c) => a + c.qty, 0);
  const seen = cardsSeen(turn, { drawOnTurnOne });
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Odds of drawing a card</h2>
      <div className="row">
        <label className="field">
          Card group
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={`role:${r}`}>{ROLE_LABELS[r]} ({counts[r]})</option>
            ))}
            <option value="pick">Specific cards…</option>
          </select>
        </label>
        <label className="field">
          By turn {turn} ({seen} cards seen)
          <input type="range" min={1} max={10} value={turn} onChange={(e) => setTurn(Number(e.target.value))} />
        </label>
      </div>
      {group === 'pick' && (
        <select multiple size={6} value={picked} onChange={(e) => setPicked([...e.target.selectedOptions].map((o) => o.value))} aria-label="Cards">
          {names.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      )}
      <div className="stat-row">
        <div className="stat"><div className="v">{pct(hypergeomAtLeast(N, K, seen, 1), 1)}</div><div className="l">at least one of {K} by turn {turn}</div></div>
        <div className="stat"><div className="v">{pct(hypergeomAtLeast(N, K, seen, 2), 1)}</div><div className="l">at least two</div></div>
        <div className="stat"><div className="v">{pct(hypergeomAtLeast(N, K, seen, 3), 1)}</div><div className="l">at least three</div></div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Exact odds, before mulligans and extra card draw. The goldfish (coming next) includes those.</p>
    </div>
  );
}

function ColorSection({ model, deckLabel, drawOnTurnOne }: { model: DeckModel; deckLabel: string; drawOnTurnOne: boolean }) {
  const [opts, setOpts] = useState<ColorOptions>({ ...DEFAULT_COLOR_OPTIONS, drawOnTurnOne });
  const o = { ...opts, drawOnTurnOne };
  const reps = colorReports(model, o);
  const statusText = { ok: '✓ All on curve', close: '▲ Mostly', short: '✕ Short', none: '— No pips' } as const;
  const text = () =>
    [`Color sources — ${deckLabel} (target ${pct(o.target)})`,
      ...reps.map((r) => `${COLOR_NAMES[r.color]}: ${r.weighted.toFixed(1)} weighted sources (${r.sources.land} lands, ${r.sources.rock} rocks, ${r.sources.dork} creatures, ${r.sources.aura} auras); ${r.met}/${r.requirements.length} spells on curve; below target: ${r.unmet.map((q) => `${q.source} (needs ${q.needed})`).join(', ') || 'none'}`),
      ...model.commanderAbilities.map((a) => `Ability ${a.label}${a.reducedCost ? ` (with reducers ${formatCost(a.reducedCost)})` : ''}`)].join('\n');
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Color sources</h2>
      <ResultsHeader deckLabel={deckLabel} copyText={text}>
        <p>
          Targets use Frank Karsten’s method from “How Many Colored Mana Sources Do You Need to Consistently Cast Your Spells?”: the fewest
          sources that give a {pct(o.target)} chance of having a spell’s colored pips among the cards seen by the turn you’d cast it
          (turn = its mana value). Computed exactly for this {model.librarySize}-card library. Karsten’s published tables also model
          mulligans, so they can be a source or two lower.
        </p>
        <p>
          Sources: lands and mana rocks count 1, mana creatures and land auras {o.weights.dork} (they die more often). Any-color lands count
          for every color in the commander’s identity; fetch lands count for the basic types in the deck. Hybrid pips aren’t counted.
          The commander’s colored activated costs are checked by turn {o.abilityTurn}.
        </p>
      </ResultsHeader>
      <div className="row small">
        <label>Target <input type="number" min={50} max={99} value={Math.round(o.target * 100)} onChange={(e) => setOpts({ ...opts, target: Number(e.target.value) / 100 })} style={{ width: 60 }} />%</label>
        <label>Creature/aura weight <input type="number" step={0.1} min={0} max={1} value={o.weights.dork} onChange={(e) => setOpts({ ...opts, weights: { ...opts.weights, dork: Number(e.target.value), aura: Number(e.target.value) } })} style={{ width: 60 }} /></label>
        <label>Commander ability by turn <input type="number" min={1} max={10} value={o.abilityTurn} onChange={(e) => setOpts({ ...opts, abilityTurn: Number(e.target.value) })} style={{ width: 50 }} /></label>
      </div>
      <div className="color-list">
        {reps.map((r) => (
          <div key={r.color} className="color-row">
            <div className="row">
              <strong>
                <ManaCost cost={`{${r.color}}`} /> {COLOR_NAMES[r.color]}
              </strong>
              <span title={`${r.sources.land} lands, ${r.sources.rock} rocks, ${r.sources.dork} creatures, ${r.sources.aura} auras`}>
                {r.weighted.toFixed(1)} sources
              </span>
              <span className="muted">{r.requirements.length ? `${r.met} of ${r.requirements.length} spells castable on curve` : 'no colored pips'}</span>
              <span className={`status ${r.status}`}>{statusText[r.status]}</span>
            </div>
            {r.strictest && (
              <div className="small muted">
                Hardest: {r.strictest.source} ({r.strictest.pips} pip{r.strictest.pips > 1 ? 's' : ''} by turn {r.strictest.turn} needs {r.strictest.needed}) · chance of
                1/2/3 sources by turn 3: {r.byTurn[2].atLeast.map((p) => pct(p)).join(' / ')}
              </div>
            )}
          </div>
        ))}
      </div>
      {model.commanderAbilities.length > 0 && (
        <div className="small stack" style={{ gap: 4 }}>
          <strong>Commander abilities that need colored mana every turn</strong>
          {model.commanderAbilities.map((a) => {
            const short = reps.filter((r) => r.requirements.some((q) => q.kind === 'ability' && q.source === a.label && r.weighted < q.needed));
            return (
              <div key={a.label}>
                {a.label}
                {a.reducedCost && <span className="muted"> → {formatCost(a.reducedCost)} with your ability-cost reducers</span>}
                {short.length > 0 ? (
                  <span className="status short"> ✕ under-supported in {short.map((r) => COLOR_NAMES[r.color]).join(', ')}</span>
                ) : (
                  <span className="status ok"> ✓ supported</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <details className="small">
        <summary>Spells below the target, by color</summary>
        {reps.map((r) => (
          <div key={r.color} style={{ marginTop: 6 }}>
            <strong>{COLOR_NAMES[r.color]}</strong> ({r.weighted.toFixed(1)} sources):{' '}
            {r.unmet.map((q) => `${q.source} (${q.pips} pip${q.pips > 1 ? 's' : ''} by T${q.turn}, needs ${q.needed})`).join(' · ') || 'none — every spell reaches the target on curve'}
          </div>
        ))}
      </details>
    </div>
  );
}

function RulesForm({ rules, onChange }: { rules: KeepRules; onChange: (r: KeepRules) => void }) {
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

function MulliganSection({ model, deckLabel, drawOnTurnOne }: { model: DeckModel; deckLabel: string; drawOnTurnOne: boolean }) {
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [trials, setTrials] = useState(10000);
  const [seedText, setSeedText] = useState('1');
  const [cardDraw, setCardDraw] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<MulliganSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<() => void>(() => {});

  const run = () => {
    setError(null);
    setProgress({ done: 0, total: trials });
    const job = startJob({ kind: 'mulligan', model, seed: parseSeed(seedText), trials, rules, opts: { turns: 10, drawOnTurnOne, cardDraw } }, (done, total) => setProgress({ done, total }));
    cancelRef.current = job.cancel;
    job.promise
      .then((r) => r.kind === 'mulligan' && setResult(r.result))
      .catch((e) => !(e instanceof CancelledError) && setError(String(e)))
      .finally(() => setProgress(null));
  };

  const text = () => {
    if (!result) return '';
    const c = result.commander;
    return [
      `Mulligans — ${deckLabel}, ${result.trials} hands, seed ${result.seed}`,
      `Rules: ${rules.minLands}–${rules.maxLands} lands, ≥${rules.minEarlyPlays} plays with MV≤2, max ${rules.maxMulligans} mulligans, free first: ${rules.freeFirstMulligan}`,
      `Kept first 7: ${pct(result.keepFirst, 1)}; mulligans: ${result.mulliganDist.map((d, i) => `${i}: ${pct(d, 1)}`).join(', ')}`,
      `Average cards kept ${result.avgCardsKept.toFixed(2)}, lands kept ${result.avgLandsKept.toFixed(2)}, forced keeps ${pct(result.forcedKeeps, 1)}`,
      `Mana by turn (median${cardDraw ? ', with card draw' : ', no card draw'}): ${result.mana.median.map((m, i) => `T${i + 1} ${m}`).join(', ')}`,
      `Extra cards drawn by T3/T5/T8 (average): ${[2, 4, 7].map((i) => result.extraDrawn[i].toFixed(1)).join(' / ')}`,
      c ? `${c.name} castable by T3/T4/T5: ${[2, 3, 4].map((i) => pct(c.byTurn[i], 1)).join(' / ')} (always keeping 7: ${[2, 3, 4].map((i) => pct(result.baseline!.byTurn[i], 1)).join(' / ')})` : 'Commander timing: needs the goldfish (cost depends on the board).',
    ].join('\n');
  };

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Mulligans</h2>
      <RulesForm rules={rules} onChange={setRules} />
      <div className="row small">
        <label>Hands <input type="number" min={100} max={100000} step={1000} value={trials} onChange={(e) => setTrials(Number(e.target.value))} style={{ width: 90 }} /></label>
        <label>Seed <input value={seedText} onChange={(e) => setSeedText(e.target.value)} style={{ width: 90 }} /></label>
        <label><input type="checkbox" checked={cardDraw} onChange={(e) => setCardDraw(e.target.checked)} /> include card draw</label>
        <button className="primary" onClick={run} disabled={!!progress}>Run</button>
      </div>
      {progress && <Progress {...progress} onCancel={() => cancelRef.current()} />}
      {error && <div className="notice error">{error}</div>}
      {result && (
        <>
          <ResultsHeader seed={result.seed} runs={result.trials} runsLabel="hands" deckLabel={deckLabel} copyText={text}>
            <p>London mulligan with Commander’s free first mulligan: each mulligan draws a fresh 7 and puts cards on the bottom (none for the free one). Bottoming keeps the hand closest to your rules (excess lands first, else the most expensive spells).</p>
            <p>
              Mana by turn and commander timing use a simple mana model: one land a turn (preferring untapped lands that add a missing color), then mana rocks,
              mana creatures (usable the next turn), land auras and land-ramp spells, cheapest first. It’s pessimistic for draw-heavy decks unless “include card draw” is on: then leftover mana goes to card draw (most cards per mana first): cantrips, creatures that draw when they enter, looting, digging, activated draws like Arcane Encyclopedia (once a turn), and engines like Phyrexian Arena or Rhystic Study (counted as one extra card a turn). Cards drawn can be played as land drops and ramp the same turn. Custom “draw” effects count too. Mana on a turn is what your lands and ramp can make after that turn’s land drop; ramp cast that turn counts from the next. “Always keep 7” replays the same shuffles without mulliganing.
            </p>
          </ResultsHeader>
          <div className="stat-row">
            <div className="stat"><div className="v">{pct(result.keepFirst)}</div><div className="l">keep the first 7</div></div>
            <div className="stat"><div className="v">{result.avgCardsKept.toFixed(2)}</div><div className="l">cards kept on average</div></div>
            <div className="stat"><div className="v">{result.avgLandsKept.toFixed(2)}</div><div className="l">lands in kept hands</div></div>
            <div className="stat"><div className="v">{pct(result.forcedKeeps, 1)}</div><div className="l">forced to keep a bad hand</div></div>
          </div>
          <table className="plain small">
            <thead><tr><th>Mulligans</th>{result.mulliganDist.map((_, i) => <th key={i} className="num">{i}{i === 1 && rules.freeFirstMulligan ? ' (free)' : ''}</th>)}</tr></thead>
            <tbody><tr><td>Share of games</td>{result.mulliganDist.map((d, i) => <td key={i} className="num">{pct(d, 1)}</td>)}</tr></tbody>
          </table>
          <ManaHeatmap title={`Mana available by turn (share of games${result.extraDrawn.some((x) => x > 0) ? ', with card draw' : ''})`} dist={result.mana} />
          <div className="small">
            <span className="muted">Extra cards drawn (average, beyond draw steps): </span>
            {result.extraDrawn.map((x, i) => `T${i + 1} ${x.toFixed(1)}`).join(' · ')}
          </div>
          {result.commander ? (
            <TimingChart
              title={`${result.commander.name} castable by turn`}
              series={[
                { label: 'With mulligans', byTurn: result.commander.byTurn },
                { label: 'Always keep 7', byTurn: result.baseline!.byTurn },
              ]}
            />
          ) : (
            <p className="muted small">This commander’s cost depends on the board (like the Pride’s toughness discount), so its cast turn comes from the goldfish simulator.</p>
          )}
        </>
      )}
    </div>
  );
}

function HandSampler({ model, drawOnTurnOne }: { model: DeckModel; drawOnTurnOne: boolean }) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [mulls, setMulls] = useState(0);
  const rules = useMemo(() => ({ ...DEFAULT_RULES, maxMulligans: mulls }), [mulls]);
  // Force exactly `mulls` mulligans by making every earlier hand unkeepable.
  const r = useMemo(() => {
    const forced = { ...rules, minLands: 99 };
    const res = simulateHand(model, seed, mulls ? forced : { ...rules, minLands: 0, maxLands: 7, minEarlyPlays: 0 }, { turns: 5, drawOnTurnOne, log: true });
    return res;
  }, [model, seed, mulls, rules, drawOnTurnOne]);
  const seven = r.hands[r.hands.length - 1];
  const verdict = useMemo(() => {
    const lands = seven.filter((c) => c.isLand).length;
    const early = seven.filter((c) => !c.isLand && c.mv <= 2).length;
    const ok = lands >= DEFAULT_RULES.minLands && lands <= DEFAULT_RULES.maxLands && early >= DEFAULT_RULES.minEarlyPlays;
    return { lands, early, ok };
  }, [seven]);
  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Hand sampler</h2>
        <span className="spacer" />
        <button onClick={() => { setSeed(Math.floor(Math.random() * 1e9)); setMulls(0); }}>New hand</button>
        <button onClick={() => setMulls((m) => m + 1)} disabled={mulls >= 4}>Mulligan</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Seed <code>{seed}</code> · {mulls === 0 ? 'opening hand' : `after ${mulls} mulligan${mulls > 1 ? 's' : ''} (${mulls === 1 ? 'free, ' : ''}keep ${r.kept.length})`} ·{' '}
        {verdict.lands} lands, {verdict.early} plays with MV ≤ 2 → default rules say <strong>{verdict.ok ? 'keep' : 'mulligan'}</strong>
      </p>
      <div className="hand">
        {seven.map((c, i) => (
          <span key={i} className={`c ${c.isLand ? 'land' : ''} ${r.bottomed.includes(c) ? 'bottom' : ''}`} title={r.bottomed.includes(c) ? 'put on the bottom' : ''}>
            {c.name} {!c.isLand && <ManaCost cost={formatCost(c.cost)} />}
          </span>
        ))}
      </div>
      <div className="small"><span className="muted">Next draws:</span> {r.nextDraws.map((c) => c.name).join(', ')}</div>
      <details>
        <summary className="small">First 5 turns with the simple mana model</summary>
        <div className="mana-log">{r.log.join('\n')}</div>
      </details>
      <p className="muted small" style={{ margin: 0 }}>Full turn-by-turn play of this hand arrives with the goldfish simulator.</p>
    </div>
  );
}
