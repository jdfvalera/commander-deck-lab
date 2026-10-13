import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state';
import { useActiveDeck } from '../useActiveDeck';
import { DeckPicker } from '../components/DeckPicker';
import { RulesForm } from '../components/RulesForm';
import { Progress, ResultsHeader, pct } from '../components/Results';
import { TimingChart } from '../components/charts/TimingChart';
import { WIN_LABELS, WinTurnChart } from '../components/charts/WinTurnChart';
import { compileDeck, type CompiledDeck } from '../../engine/cards';
import { DEFAULT_GOLDFISH, STRATEGIES, WIN_TYPES, defaultStrategyFor, sampleGame, strategyById, type GoldfishOptions, type GoldfishSummary } from '../../engine/goldfish';
import { defaults, type StrategySettings } from '../../engine/strategies/types';
import { DEFAULT_RULES } from '../../engine/mulligan';
import { parseSeed } from '../../engine/rng';
import { guessCommanders } from '../../data/validateDeck';
import { loadComboDb } from '../../combos/comboDb';
import { deckIdentityOf, findCombos } from '../../combos/findCombos';
import { CancelledError, startJob } from '../../worker/client';
import type { DeckList } from '../../data/types';

/** Combos that end games (or loop something infinitely), as the engine's win condition. */
const WINNING = /infinite|win the game|each opponent loses/i;

export function GoldfishPage() {
  const active = useActiveDeck();
  const { card, tagsFor, ensureCards } = useApp();
  const { deck, version, list } = active;
  const compiled = useMemo(() => (list ? compileDeck(list, card, tagsFor) : undefined), [list, card, tagsFor]);

  const [strategyId, setStrategyId] = useState<string | null>(null);
  const strategy = strategyById(strategyId ?? (compiled ? defaultStrategyFor(compiled).id : 'generic'));
  const [settings, setSettings] = useState<StrategySettings>({});
  const s = { ...defaults(strategy.settings), ...settings };
  const [games, setGames] = useState(DEFAULT_GOLDFISH.games);
  const [maxTurns, setMaxTurns] = useState(DEFAULT_GOLDFISH.maxTurns);
  const [seedText, setSeedText] = useState('1');
  const [drawOnTurnOne, setDrawOnTurnOne] = useState(true);
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [useCombos, setUseCombos] = useState(true);
  const [compareId, setCompareId] = useState<string>('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ a: GoldfishSummary; b?: GoldfishSummary; opts: GoldfishOptions; labelA: string; labelB?: string; deckA: CompiledDeck } | null>(null);
  const cancel = useRef<() => void>(() => {});

  const compareVersion = deck?.versions.find((v) => v.id === compareId);
  useEffect(() => {
    if (compareVersion) ensureCards([...compareVersion.list.commanders, ...compareVersion.list.cards.map((c) => c.name)]);
  }, [compareVersion, ensureCards]);

  const run = async () => {
    if (!compiled || !list || !version || !deck) return;
    setError(null);
    let combos: GoldfishOptions['combos'] = [];
    if (useCombos) {
      try {
        const db = await loadComboDb();
        const identity = deckIdentityOf(list.commanders.map((n) => card(n)?.color_identity ?? []));
        combos = findCombos(db, { commanders: list.commanders, cards: list.cards.map((c) => c.name) }, identity)
          .complete.filter((c) => c.produces.some((p) => WINNING.test(p)))
          .map((c) => ({ cards: c.cards, manaNeeded: c.manaValueNeeded, label: c.cards.join(' + ') }));
      } catch {
        setError('Couldn’t load the Commander Spellbook combo list; running without combos.');
      }
    }
    const opts: GoldfishOptions = { ...DEFAULT_GOLDFISH, games, maxTurns, seed: parseSeed(seedText), drawOnTurnOne, strategy: strategy.id, settings: s, rules, combos, comboWins: useCombos };
    const labelA = `${deck.name} · ${version.label}`;
    let bDeck: CompiledDeck | undefined;
    if (compareVersion) {
      const bList: DeckList = guessCommanders(compareVersion.list, card).list;
      bDeck = compileDeck(bList, card, tagsFor);
    }
    setProgress({ done: 0, total: bDeck ? 2 * games : games });
    const job = bDeck ? startJob({ kind: 'compare', a: compiled, b: bDeck, opts }, (done, total) => setProgress({ done, total })) : startJob({ kind: 'goldfish', deck: compiled, opts }, (done, total) => setProgress({ done, total }));
    cancel.current = job.cancel;
    job.promise
      .then((r) => {
        if (r.kind === 'goldfish') setResult({ a: r.result, opts, labelA, deckA: compiled });
        if (r.kind === 'compare') setResult({ a: r.a, b: r.b, opts, labelA, labelB: `${deck.name} · ${compareVersion!.label}`, deckA: compiled });
      })
      .catch((e) => !(e instanceof CancelledError) && setError(String(e)))
      .finally(() => setProgress(null));
  };

  return (
    <div className="stack">
      <div className="card stack">
        <h1 style={{ margin: 0 }}>Goldfish</h1>
        <DeckPicker active={active} />
        {deck && deck.versions.length > 1 && (
          <label className="field" style={{ maxWidth: 360 }}>
            Compare with another version (same seeds)
            <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
              <option value="">No comparison</option>
              {deck.versions.filter((v) => v.id !== version?.id).map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
        )}
        <div className="notice warn small">
          A goldfish has no opponents: nobody blocks, removes or counters anything, so protection and interaction never get cast and
          look useless here. Don’t cut Heroic Intervention or Counterspell because of a goldfish number; the Matchups tool tests those.
        </div>
      </div>

      {compiled && (
        <div className="card stack">
          <div className="row">
            <label className="field">
              Strategy
              <select value={strategy.id} onChange={(e) => { setStrategyId(e.target.value); setSettings({}); }}>
                {STRATEGIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
            <label className="field">Games <input type="number" min={100} max={50000} step={500} value={games} onChange={(e) => setGames(Number(e.target.value))} style={{ width: 90 }} /></label>
            <label className="field">Max turns <input type="number" min={5} max={40} value={maxTurns} onChange={(e) => setMaxTurns(Number(e.target.value))} style={{ width: 70 }} /></label>
            <label className="field">Seed <input value={seedText} onChange={(e) => setSeedText(e.target.value)} style={{ width: 90 }} /></label>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{strategy.description}</p>
          <details>
            <summary className="small">Strategy settings</summary>
            <div className="stack small" style={{ marginTop: 8, gap: 6 }}>
              {strategy.settings.map((d) => (
                <label key={d.key} title={d.help}>
                  {d.type === 'boolean' ? (
                    <><input type="checkbox" checked={Boolean(s[d.key])} onChange={(e) => setSettings({ ...settings, [d.key]: e.target.checked })} /> {d.label}</>
                  ) : (
                    <>{d.label} <input type="number" min={d.min} max={d.max} value={Number(s[d.key])} onChange={(e) => setSettings({ ...settings, [d.key]: Number(e.target.value) })} style={{ width: 60 }} /></>
                  )}
                  {d.help && <span className="muted"> — {d.help}</span>}
                </label>
              ))}
            </div>
          </details>
          <details>
            <summary className="small">Mulligans and turn 1</summary>
            <div className="stack" style={{ marginTop: 8, gap: 6 }}>
              <RulesForm rules={rules} onChange={setRules} />
              <label className="small"><input type="checkbox" checked={!drawOnTurnOne} onChange={(e) => setDrawOnTurnOne(!e.target.checked)} /> Skip the turn-1 draw (1v1 rules)</label>
            </div>
          </details>
          <label className="small"><input type="checkbox" checked={useCombos} onChange={(e) => setUseCombos(e.target.checked)} /> Count assembled Commander Spellbook combos (infinite or game-winning results) as wins</label>
          <div className="row">
            <button className="primary" onClick={run} disabled={!!progress}>{compareVersion ? 'Run both versions' : 'Run'}</button>
          </div>
          {progress && <Progress {...progress} onCancel={() => cancel.current()} />}
          {error && <div className="notice error small">{error}</div>}
        </div>
      )}

      {result && <Results r={result} />}
      {result && <SampleGame deck={result.deckA} opts={result.opts} />}
    </div>
  );
}

function Results({ r }: { r: { a: GoldfishSummary; b?: GoldfishSummary; opts: GoldfishOptions; labelA: string; labelB?: string } }) {
  const { a, b } = r;
  const at = (arr: number[], t: number) => arr[Math.min(t, arr.length) - 1] ?? 0;
  const strat = strategyById(a.strategy);
  const text = () => {
    const lines = (x: GoldfishSummary, label: string) => [
      `${label} — ${x.games} games, seed ${x.seed}, max ${x.maxTurns} turns, strategy ${strat.label}`,
      `Median win turn ${x.medianWin ?? 'n/a'}; won by T8/T10/T12/T15: ${[8, 10, 12, 15].map((t) => pct(at(x.winByTurn.total, t), 1)).join(' / ')}`,
      `Win types: ${WIN_TYPES.filter((w) => x.winShare[w] > 0).map((w) => `${WIN_LABELS[w]} ${pct(x.winShare[w], 1)}`).join(', ')}`,
      `Commander by T3/T4/T5: ${[3, 4, 5].map((t) => pct(at(x.commander.byTurn, t), 1)).join(' / ')}${x.commander.avgCost !== null ? `, average cost paid ${x.commander.avgCost.toFixed(2)}` : ''}`,
      `Extra cards drawn by T4/T6/T8: ${[4, 6, 8].map((t) => at(x.extraDrawn, t).toFixed(1)).join(' / ')}`,
      `Failures: decked ${pct(x.failures.decked, 1)}, no win by T${x.maxTurns} ${pct(x.failures.noWin, 1)}, flooded ${pct(x.failures.flooded, 1)}, screwed ${pct(x.failures.screwed, 1)}`,
      ...(x.combo.top.length ? [`Combos assembled: ${x.combo.top.map((c) => `${c.label} ${pct(c.share, 1)}`).join('; ')}`] : []),
    ];
    return [...lines(a, r.labelA), ...(b ? ['', ...lines(b, r.labelB!), '', '(Version comparison on identical seeds.)'] : [])].join('\n');
  };
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Results</h2>
      <ResultsHeader seed={a.seed} runs={a.games} deckLabel={b ? `${r.labelA} vs ${r.labelB}` : r.labelA} copyText={text}>
        <p>
          Each game: London mulligan by your keep rules, then up to {a.maxTurns} turns of the {strat.label} strategy against three opponents at
          40 life who never block, remove or counter anything. Cards act only through their tags (auto-detected from oracle text or set by you),
          including custom effects. Wins: all three opponents at 0 life or 10 poison
          {r.opts.comboWins ? ', or a Commander Spellbook combo with an infinite or winning result assembled on the battlefield with its mana' : ''}.
        </p>
        <p>Not modelled: anything left as “not modelled” on the Decks page, blockers, and interaction. Card draw from the commander and combat is fully played out.</p>
        {b && <p>Comparisons run both versions on the same seeds with swapped cards in the same shuffle positions, so differences are far more trustworthy than either absolute number.</p>}
      </ResultsHeader>

      {b ? <Compare a={a} b={b} labelA={r.labelA} labelB={r.labelB!} /> : (
        <div className="stat-row">
          <div className="stat"><div className="v">{a.medianWin ? `T${a.medianWin}` : '—'}</div><div className="l">median win turn</div></div>
          <div className="stat"><div className="v">{pct(at(a.winByTurn.total, 10))}</div><div className="l">won by turn 10</div></div>
          <div className="stat"><div className="v">{pct(at(a.commander.byTurn, 4))}</div><div className="l">commander by turn 4{a.commander.avgCost !== null ? ` (avg cost ${a.commander.avgCost.toFixed(1)})` : ''}</div></div>
          <div className="stat"><div className="v">{at(a.extraDrawn, 8).toFixed(1)}</div><div className="l">extra cards drawn by turn 8</div></div>
          <div className="stat"><div className="v">{pct(a.failures.decked, 1)}</div><div className="l">decked themselves</div></div>
        </div>
      )}

      <WinTurnChart s={a} />
      <TimingChart
        title="Won by turn (cumulative)"
        series={b ? [{ label: r.labelA, byTurn: a.winByTurn.total }, { label: r.labelB!, byTurn: b.winByTurn.total }] : [{ label: 'All wins', byTurn: a.winByTurn.total }]}
      />
      <TimingChart
        title="Commander cast by turn"
        series={b ? [{ label: r.labelA, byTurn: a.commander.byTurn.slice(0, 10) }, { label: r.labelB!, byTurn: b.commander.byTurn.slice(0, 10) }] : [{ label: 'Cast by turn', byTurn: a.commander.byTurn.slice(0, 10) }]}
      />

      <div className="table-scroll">
        <table className="plain small">
          <thead><tr><th>By end of turn</th>{[2, 4, 6, 8, 10, 12].map((t) => <th key={t} className="num">{t}</th>)}</tr></thead>
          <tbody>
            <tr><td>Extra cards drawn (avg)</td>{[2, 4, 6, 8, 10, 12].map((t) => <td key={t} className="num">{at(a.extraDrawn, t).toFixed(1)}</td>)}</tr>
            <tr><td>Lands on battlefield (avg)</td>{[2, 4, 6, 8, 10, 12].map((t) => <td key={t} className="num">{at(a.landsByTurn, t).toFixed(1)}</td>)}</tr>
            <tr><td>Won</td>{[2, 4, 6, 8, 10, 12].map((t) => <td key={t} className="num">{pct(at(a.winByTurn.total, t))}</td>)}</tr>
          </tbody>
        </table>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="v">{pct(a.failures.decked, 1)}</div><div className="l">decked</div></div>
        <div className="stat"><div className="v">{pct(a.failures.noWin, 1)}</div><div className="l">no win by turn {a.maxTurns}</div></div>
        <div className="stat"><div className="v">{pct(a.failures.flooded, 1)}</div><div className="l">flooded (55%+ lands seen by T6)</div></div>
        <div className="stat"><div className="v">{pct(a.failures.screwed, 1)}</div><div className="l">screwed (under 4 lands by T5)</div></div>
      </div>

      {a.combo.top.length > 0 && (
        <div className="small">
          <strong>Spellbook combos assembled</strong> (by turn 10: {pct(at(a.combo.byTurn, 10))}):{' '}
          {a.combo.top.map((c) => `${c.label} (${pct(c.share, 1)})`).join(' · ')}
        </div>
      )}

      <Impact s={a} />
    </div>
  );
}

/** "Deck · Revised (16 swaps)" -> "Revised (16 swaps)". */
const short = (label: string) => label.split(' · ').pop() ?? label;

function Compare({ a, b, labelA, labelB }: { a: GoldfishSummary; b: GoldfishSummary; labelA: string; labelB: string }) {
  const at = (arr: number[], t: number) => arr[Math.min(t, arr.length) - 1] ?? 0;
  const rows: { label: string; a: number; b: number; fmt: (x: number) => string; better: 'higher' | 'lower' }[] = [
    { label: 'Median win turn', a: a.medianWin ?? 99, b: b.medianWin ?? 99, fmt: (x) => (x >= 99 ? '—' : `T${x}`), better: 'lower' },
    ...[8, 10, 12, 15].map((t) => ({ label: `Won by turn ${t}`, a: at(a.winByTurn.total, t), b: at(b.winByTurn.total, t), fmt: (x: number) => pct(x, 1), better: 'higher' as const })),
    { label: 'Commander by turn 4', a: at(a.commander.byTurn, 4), b: at(b.commander.byTurn, 4), fmt: (x) => pct(x, 1), better: 'higher' },
    { label: 'Extra cards by turn 8', a: at(a.extraDrawn, 8), b: at(b.extraDrawn, 8), fmt: (x) => x.toFixed(1), better: 'higher' },
    { label: 'Decked', a: a.failures.decked, b: b.failures.decked, fmt: (x) => pct(x, 1), better: 'lower' },
    { label: 'Screwed', a: a.failures.screwed, b: b.failures.screwed, fmt: (x) => pct(x, 1), better: 'lower' },
    ...WIN_TYPES.filter((w) => a.winShare[w] + b.winShare[w] > 0).map((w) => ({ label: `Wins by ${WIN_LABELS[w].toLowerCase()}`, a: a.winShare[w], b: b.winShare[w], fmt: (x: number) => pct(x, 1), better: 'higher' as const })),
  ];
  return (
    <div className="table-scroll">
      <table className="plain">
        <thead><tr><th /><th className="num">{labelA}</th><th className="num">{labelB}</th><th className="num">{short(labelA)} vs {short(labelB)}</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            // From the selected version's point of view: how it does against the one it's compared with.
            const d = r.a - r.b;
            const good = r.better === 'higher' ? d > 0 : d < 0;
            const sign = d > 0 ? '+' : '';
            const delta = r.label.startsWith('Median') ? `${sign}${d} turn${Math.abs(d) === 1 ? '' : 's'}` : r.label.startsWith('Extra') ? `${sign}${d.toFixed(1)}` : `${sign}${(100 * d).toFixed(1)} pts`;
            return (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num">{r.fmt(r.a)}</td>
                <td className="num">{r.fmt(r.b)}</td>
                <td className="num"><span className={`status ${Math.abs(d) < 1e-9 ? '' : good ? 'ok' : 'short'}`}>{Math.abs(d) < 1e-9 ? '—' : `${good ? '▲' : '▼'} ${delta}`}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Impact({ s }: { s: GoldfishSummary }) {
  const [all, setAll] = useState(false);
  if (!s.impact.length) return null;
  const rows = all ? s.impact : [...s.impact.slice(0, 8), ...s.impact.slice(-5)];
  return (
    <details>
      <summary><strong>Per-card impact</strong> <span className="muted small">(correlation, not causation)</span></summary>
      <p className="small muted">
        Average win turn in games where the card was drawn by turn 6, against games where it wasn’t (unwon games count as turn {s.maxTurns + 1}).
        Negative = those games ended sooner. Cards you draw because you drew lots of cards look good for that reason alone.
      </p>
      <table className="plain small">
        <thead><tr><th>Card</th><th className="num">Drawn by T6</th><th className="num">Win turn with</th><th className="num">without</th><th className="num">Δ turns</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className="num">{pct(r.seenShare)}</td>
              <td className="num">{r.withDrawn.toFixed(1)}</td>
              <td className="num">{r.without.toFixed(1)}</td>
              <td className="num">{r.delta > 0 ? '+' : ''}{r.delta.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.impact.length > rows.length && <button className="link small" onClick={() => setAll(true)}>Show all {s.impact.length} cards</button>}
    </details>
  );
}

function SampleGame({ deck, opts }: { deck: CompiledDeck; opts: GoldfishOptions }) {
  const [gameIndex, setGameIndex] = useState(0);
  const [turn, setTurn] = useState(0);
  const sample = useMemo(() => sampleGame(deck, opts, gameIndex), [deck, opts, gameIndex]);
  const log = sample.logs[Math.min(turn, sample.logs.length - 1)];
  const g = sample.game;
  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Sample game</h2>
        <span className="spacer" />
        <label className="small">Game # <input type="number" min={0} max={opts.games - 1} value={gameIndex} onChange={(e) => { setGameIndex(Number(e.target.value)); setTurn(0); }} style={{ width: 80 }} /></label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Game {gameIndex} of the run above (seed <code>{sample.seed}</code>): {g.mulligans} mulligan{g.mulligans === 1 ? '' : 's'},{' '}
        {g.winTurn ? <>won on turn {g.winTurn} by {WIN_LABELS[g.winType!].toLowerCase()}</> : g.decked ? <>decked on turn {g.turn}</> : <>no win in {g.turn} turns</>}.
      </p>
      {log && (
        <>
          <div className="row">
            <button onClick={() => setTurn((t) => Math.max(0, t - 1))} disabled={turn === 0}>← Turn {Math.max(1, log.turn - 1)}</button>
            <strong>Turn {log.turn}</strong>
            <button onClick={() => setTurn((t) => Math.min(sample.logs.length - 1, t + 1))} disabled={turn >= sample.logs.length - 1}>Turn {log.turn + 1} →</button>
            <span className="spacer" />
            <span className="small muted">{log.opponents}</span>
          </div>
          <div className="small"><span className="muted">Hand after the draw ({log.hand.length}):</span> {log.hand.join(', ')}</div>
          <ol className="small event-list">{log.events.map((e, i) => <li key={i}>{e}</li>)}</ol>
          <div className="small"><span className="muted">Battlefield at end of turn:</span> {log.board.join(' · ')}</div>
        </>
      )}
    </div>
  );
}
