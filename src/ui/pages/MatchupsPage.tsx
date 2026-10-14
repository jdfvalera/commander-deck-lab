import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state';
import { useActiveDeck } from '../useActiveDeck';
import { DeckPicker } from '../components/DeckPicker';
import { Progress, ResultsHeader, pct } from '../components/Results';
import { TimingChart } from '../components/charts/TimingChart';
import { WIN_LABELS } from '../components/charts/WinTurnChart';
import { compileDeck, type CompiledDeck } from '../../engine/cards';
import { SampleGame, type SampleRun } from '../components/SampleGame';
import { SavedRuns } from '../components/SavedRuns';
import { addRun } from '../../data/results';
import { newId } from '../../data/storage';
import { defaultStrategyFor, STRATEGIES, strategyById } from '../../engine/goldfish';
import { DEFAULT_TABLE, sampleTable, type LossReason, type MatchupSummary, type TableSettings } from '../../engine/table';
import { defaults } from '../../engine/strategies/types';
import { buildProfile, type InteractionSpec, type OpponentProfile } from '../../opponents/profile';
import { PRESETS } from '../../opponents/presets';
import { parseDecklist } from '../../data/parseDecklist';
import { guessCommanders } from '../../data/validateDeck';
import { parseSeed } from '../../engine/rng';
import { loadComboDb } from '../../combos/comboDb';
import { deckIdentityOf, findCombos } from '../../combos/findCombos';
import { CancelledError, startJob } from '../../worker/client';
import type { DeckList } from '../../data/types';

type Slot = { source: string; text: string };
const LOSS_LABELS: Record<LossReason, string> = { fliers: 'Killed mostly by fliers', ground: 'Killed mostly by ground creatures', decked: 'Decked themselves', timeout: 'No result by the turn limit', other: 'Other' };
const WINNING = /infinite|win the game|each opponent loses/i;

export function MatchupsPage() {
  const active = useActiveDeck();
  const { card, tagsFor, ensureCards, cards } = useApp();
  const { deck, version, list } = active;
  const compiled = useMemo(() => (list ? compileDeck(list, card, tagsFor) : undefined), [list, card, tagsFor]);
  const strategy = compiled ? defaultStrategyFor(compiled) : STRATEGIES[0];
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const strat = strategyById(strategyId ?? strategy.id);
  const [slots, setSlots] = useState<Slot[]>([
    { source: 'rex', text: '' },
    { source: 'angels', text: '' },
    { source: 'keen', text: '' },
  ]);
  const [missing, setMissing] = useState<string[][]>([[], [], []]);
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<number, Partial<OpponentProfile>>>({});
  const [games, setGames] = useState(DEFAULT_TABLE.games);
  const [seedText, setSeedText] = useState('1');
  const [holdProtection, setHoldProtection] = useState(true);
  const [matrix, setMatrix] = useState(true);
  const [compareId, setCompareId] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ pods: { label: string; a: MatchupSummary; b?: MatchupSummary }[]; labelA: string; labelB?: string; opts: TableSettings; podProfiles: OpponentProfile[] } | null>(null);
  const cancel = useRef<() => void>(() => {});
  const [saved, setSaved] = useState(0);
  const [seat, setSeat] = useState(1);
  const [fromSaved, setFromSaved] = useState(false);

  const slotList = (s: Slot): { name: string; list: DeckList } | null => {
    const preset = PRESETS.find((p) => p.id === s.source);
    if (preset) return { name: preset.name, list: preset.list };
    if (s.source === 'paste' && s.text.trim()) {
      const parsed = parseDecklist(s.text);
      const l = guessCommanders({ commanders: parsed.commanders, cards: parsed.cards }, card).list;
      return { name: l.commanders[0] ?? 'Pasted deck', list: l };
    }
    return null;
  };
  const names = (l: { list: DeckList }) => [...l.list.commanders, ...l.list.cards.map((c) => c.name)];

  // Load every preset's cards (the matrix uses all five) plus any pasted lists, once.
  const slotLists = slots.map(slotList);
  const wanted = [...PRESETS.flatMap((p) => names(p)), ...slotLists.flatMap((l) => (l ? names(l) : []))];
  const wantedKey = wanted.join('|');
  useEffect(() => {
    let live = true;
    ensureCards(wanted).then((notFound) => {
      if (!live) return;
      const lost = new Set(notFound);
      setUnknown(lost);
      setMissing(slotLists.map((l) => (l ? names(l).filter((n) => lost.has(n)) : [])));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  // Profiles are built from card data once it's all here (each runs the opponent's own goldfish: ~50 ms).
  const ready = (l: { list: DeckList }) => names(l).every((n) => card(n) || unknown.has(n));
  const presetProfiles = useMemo(
    () => new Map(PRESETS.filter(ready).map((p) => [p.id, buildProfile(p.id, p.name, p.list, card, tagsFor)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, tagsFor, unknown],
  );
  const profiles = useMemo(
    () => slots.map((s, i) => presetProfiles.get(s.source) ?? (slotLists[i] && ready(slotLists[i]!) ? buildProfile(s.source, slotLists[i]!.name, slotLists[i]!.list, card, tagsFor) : null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots, presetProfiles, cards, tagsFor, unknown],
  );

  const effective = profiles.map((p, i) => (p ? { ...p, ...edits[i] } : null));
  const compareVersion = deck?.versions.find((v) => v.id === compareId);
  useEffect(() => {
    if (compareVersion) ensureCards([...compareVersion.list.commanders, ...compareVersion.list.cards.map((c) => c.name)]);
  }, [compareVersion, ensureCards]);

  const run = async () => {
    if (!compiled || !list || !deck || !version) return;
    const pod = effective.filter((p): p is OpponentProfile => !!p);
    if (!pod.length) return;
    setError(null);
    let combos: TableSettings['combos'] = [];
    try {
      const db = await loadComboDb();
      const identity = deckIdentityOf(list.commanders.map((n) => card(n)?.color_identity ?? []));
      combos = findCombos(db, { commanders: list.commanders, cards: list.cards.map((c) => c.name) }, identity)
        .complete.filter((c) => c.produces.some((p) => WINNING.test(p)))
        .map((c) => ({ cards: c.cards, manaNeeded: c.manaValueNeeded, label: c.cards.join(' + ') }));
    } catch {
      // run without combos
    }
    const opts: TableSettings = { ...DEFAULT_TABLE, games, seed: parseSeed(seedText), strategy: strat.id, settings: defaults(strat.settings), holdProtection, combos, seat };
    const pods = [{ label: `Your pod: ${pod.map((p) => p.name).join(' · ')}`, profiles: pod }];
    if (matrix) {
      for (const p of PRESETS) {
        // Your edits to a preset in the pod carry over to its matrix row.
        const prof = effective.find((x) => x?.id === p.id) ?? presetProfiles.get(p.id);
        if (prof) pods.push({ label: `3 × ${p.name}`, profiles: [prof, prof, prof] });
      }
    }
    const b = compareVersion ? compileDeck(guessCommanders(compareVersion.list, card).list, card, tagsFor) : undefined;
    const total = games * pods.length * (b ? 2 : 1);
    setProgress({ done: 0, total });
    const job = startJob({ kind: 'matchup', deck: compiled, compareWith: b, pods, opts }, (done, t) => setProgress({ done, total: t }));
    cancel.current = job.cancel;
    job.promise
      .then((r) => {
        if (r.kind !== 'matchup') return;
        const res = { pods: r.pods, labelA: `${deck.name} · ${version.label}`, labelB: compareVersion ? `${deck.name} · ${compareVersion.label}` : undefined, opts, podProfiles: pod };
        setResult(res);
        setFromSaved(false);
        addRun({
          id: newId(), kind: 'matchup', createdAt: Date.now(), label: res.labelB ? `${res.labelA} vs ${res.labelB}` : res.labelA,
          headline: r.pods.map((p) => `${p.label.replace('Your pod: ', '')} ${Math.round(100 * p.a.winRate)}%`).join(' · '),
          data: res,
        }).then(() => setSaved((n) => n + 1));
      })
      .catch((e) => !(e instanceof CancelledError) && setError(String(e)))
      .finally(() => setProgress(null));
  };

  return (
    <div className="stack">
      <div className="card stack">
        <h1 style={{ margin: 0 }}>Matchups</h1>
        <DeckPicker active={active} />
        {deck && deck.versions.length > 1 && (
          <label className="field" style={{ maxWidth: 360 }}>
            Compare with another version (same seeds)
            <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
              <option value="">No comparison</option>
              {deck.versions.filter((v) => v.id !== version?.id).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
        )}
        <div className="notice warn small">
          This is an approximation. Your deck is played card by card, but opponents are <em>profiles</em> built from their decklists: real
          creatures from their list arrive along their measured curve, and their removal, wipes, counterspells and Aetherize effects are drawn at
          the deck’s real counts. Trust comparisons (two versions on the same seeds) more than any single win rate.
        </div>
      </div>

      <div className="opp-grid">
        {slots.map((s, i) => (
          <OpponentCard
            key={i}
            index={i}
            slot={s}
            profile={effective[i]}
            missing={missing[i]}
            onSlot={(next) => {
              setSlots(slots.map((x, j) => (j === i ? next : x)));
              setEdits({ ...edits, [i]: {} });
            }}
            onEdit={(e) => setEdits({ ...edits, [i]: { ...edits[i], ...e } })}
          />
        ))}
      </div>

      {compiled && (
        <div className="card stack">
          <div className="row">
            <label className="field">
              Your strategy
              <select value={strat.id} onChange={(e) => setStrategyId(e.target.value)}>
                {STRATEGIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
            <label className="field">Games per pod <input type="number" min={100} max={10000} step={100} value={games} onChange={(e) => setGames(Number(e.target.value))} style={{ width: 90 }} /></label>
            <label className="field">Seed <input value={seedText} onChange={(e) => setSeedText(e.target.value)} style={{ width: 90 }} /></label>
          </div>
          <label className="small">
            Your seat{' '}
            <select value={seat} onChange={(e) => setSeat(Number(e.target.value))}>
              <option value={1}>1 (you go first)</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4 (you go last)</option>
              <option value={0}>Random each game</option>
            </select>
          </label>
          <label className="small"><input type="checkbox" checked={holdProtection} onChange={(e) => setHoldProtection(e.target.checked)} /> Keep mana open for your best protection (Counterspell, Heroic Intervention, Saved by the Shell…)</label>
          <label className="small"><input type="checkbox" checked={matrix} onChange={(e) => setMatrix(e.target.checked)} /> Also run the matchup matrix: your deck against three copies of each Foundations precon</label>
          <div className="row"><button className="primary" onClick={run} disabled={!!progress || !effective.some(Boolean) || (matrix && presetProfiles.size < PRESETS.length)}>Run matchups</button>
            {matrix && presetProfiles.size < PRESETS.length && <span className="small muted">Loading the Foundations decks…</span>}</div>
          {progress && <Progress {...progress} onCancel={() => cancel.current()} />}
          {error && <div className="notice error small">{error}</div>}
        </div>
      )}

      <SavedRuns<NonNullable<typeof result>> kind="matchup" refresh={saved} onOpen={(run) => { setResult(run.data); setFromSaved(true); }} />
      {result && <MatchupResults r={result} />}
      {result && compiled && !fromSaved && <MatchupSample deck={compiled} profiles={result.podProfiles} opts={result.opts} />}
    </div>
  );
}

function OpponentCard({ index, slot, profile, missing, onSlot, onEdit }: { index: number; slot: Slot; profile: OpponentProfile | null; missing: string[]; onSlot: (s: Slot) => void; onEdit: (e: Partial<OpponentProfile>) => void }) {
  const resize = (key: 'wipes' | 'removal' | 'counters' | 'aetherize' | 'taxes', n: number) => {
    if (!profile) return;
    const cur = profile[key];
    const generic: Record<typeof key, InteractionSpec> = {
      wipes: { name: 'Board wipe (destroy)', kind: 'destroy' }, removal: { name: 'Removal (destroy)', kind: 'destroy', scope: 'creature' },
      counters: { name: 'Counterspell', kind: 'counter', scope: 'any' }, aetherize: { name: 'Aetherize', kind: 'aetherize' }, taxes: { name: 'Propaganda', kind: 'tax', per: 2 },
    };
    const next = n <= cur.length ? cur.slice(0, n) : [...cur, ...Array.from({ length: n - cur.length }, () => cur[cur.length - 1] ?? generic[key])];
    onEdit({ [key]: next } as Partial<OpponentProfile>);
  };
  const count = (key: 'wipes' | 'removal' | 'counters' | 'aetherize' | 'taxes', label: string) => (
    <label className="small" title={profile?.[key].map((x) => x.name).join(', ')}>
      {label} <input type="number" min={0} max={20} value={profile?.[key].length ?? 0} onChange={(e) => resize(key, Number(e.target.value))} style={{ width: 50 }} />
    </label>
  );
  return (
    <div className="card stack opp-card">
      <label className="field">
        Opponent {index + 1}
        <select value={slot.source} onChange={(e) => onSlot({ ...slot, source: e.target.value })}>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="paste">Paste a decklist…</option>
          <option value="none">Empty seat</option>
        </select>
      </label>
      {slot.source === 'paste' && (
        <textarea className="mono" rows={5} placeholder="Paste their list (Moxfield / Archidekt / Arena text)" value={slot.text} onChange={(e) => onSlot({ ...slot, text: e.target.value })} />
      )}
      {missing.length > 0 && <div className="notice warn small">Not found on Scryfall (left out): {missing.join(', ')}</div>}
      {profile ? (
        <>
          <div className="small muted">{PRESETS.find((p) => p.id === slot.source)?.blurb ?? profile.commander}</div>
          <div className="small">
            {profile.creatures.reduce((a, c) => a + c.count, 0)} creatures · {pct(profile.flyingShare)} of their power flies · {pct(profile.trampleShare)} tramples ·
            power by T4/T6/T8: {[4, 6, 8].map((t) => Math.round(profile.powerCurve[t - 1] * profile.curveScale)).join(' / ')}
          </div>
          <div className="row">
            {count('wipes', 'Wipes')}
            {count('removal', 'Removal')}
            {count('counters', 'Counters')}
            {count('aetherize', 'Aetherize')}
            {count('taxes', 'Taxes')}
          </div>
          <details className="small">
            <summary>Behaviour</summary>
            <div className="stack" style={{ gap: 6, marginTop: 6 }}>
              <label>Aggression {pct(profile.aggression)} <input type="range" min={0} max={1} step={0.05} value={profile.aggression} onChange={(e) => onEdit({ aggression: Number(e.target.value) })} /></label>
              <label>Uses interaction when it matters {pct(profile.interactionRate)} <input type="range" min={0} max={1} step={0.05} value={profile.interactionRate} onChange={(e) => onEdit({ interactionRate: Number(e.target.value) })} /></label>
              <label>Board size × {profile.curveScale.toFixed(2)} <input type="range" min={0.3} max={2} step={0.05} value={profile.curveScale} onChange={(e) => onEdit({ curveScale: Number(e.target.value) })} /></label>
              <label>Wipes once you have <input type="number" min={2} max={20} value={profile.wipeAt} onChange={(e) => onEdit({ wipeAt: Number(e.target.value) })} style={{ width: 50 }} /> creatures</label>
              <label>
                Attacks{' '}
                <select value={profile.priority} onChange={(e) => onEdit({ priority: e.target.value as OpponentProfile['priority'] })}>
                  <option value="threat">the biggest threat (where damage gets through)</option>
                  <option value="weakest">the lowest life total</option>
                  <option value="spread">spread out at random</option>
                </select>
              </label>
              <div className="muted">Interaction: {[...profile.wipes, ...profile.removal, ...profile.counters, ...profile.aetherize, ...profile.taxes].map((x) => x.name).join(', ') || 'none'}</div>
            </div>
          </details>
        </>
      ) : slot.source !== 'none' ? (
        <div className="small muted">Loading their cards…</div>
      ) : null}
    </div>
  );
}

function MatchupSample({ deck, profiles, opts }: { deck: CompiledDeck; profiles: OpponentProfile[]; opts: TableSettings }) {
  const play = useCallback((i: number): SampleRun => {
    const { game: g, seed } = sampleTable(deck, profiles, opts, i);
    const outcome = g.winTurn ? `won on turn ${g.winTurn} by ${WIN_LABELS[g.winType!].toLowerCase()}` : g.decked ? `decked on turn ${g.turn}` : g.lost === 'timeout' ? `no result in ${g.turn} turns` : `died on turn ${g.turn} (${g.lost === 'fliers' ? 'mostly to fliers' : 'mostly to ground creatures'})`;
    return { logs: g.logs, seed, summary: `${g.mulligans} mulligan${g.mulligans === 1 ? '' : 's'}, ${outcome}.` };
  }, [deck, profiles, opts]);
  return <SampleGame play={play} games={opts.games} title={`Sample game: ${profiles.map((p) => p.name).join(' · ')}`} />;
}

function MatchupResults({ r }: { r: { pods: { label: string; a: MatchupSummary; b?: MatchupSummary }[]; labelA: string; labelB?: string; opts: TableSettings } }) {
  const main = r.pods[0];
  const s = main.a;
  const short = (l: string) => l.split(' · ').pop() ?? l;
  const text = () =>
    [
      `Matchups — ${r.labelA}${r.labelB ? ` vs ${r.labelB}` : ''}, ${s.games} games per pod, seed ${s.seed}`,
      ...r.pods.map((p) => `${p.label}: ${pct(p.a.winRate, 1)}${p.b ? ` vs ${pct(p.b.winRate, 1)} (${short(r.labelB!)})` : ''}; losses: ${Object.entries(p.a.losses).filter(([, v]) => v > 0.005).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`),
      `Your pod per game: commander removed ${s.perGame.commanderRemoved.toFixed(2)}, wipes ${s.perGame.wipesFaced.toFixed(2)}, removal ${s.perGame.removalFaced.toFixed(2)}, spells countered ${s.perGame.spellsCountered.toFixed(2)}; Triumph countered ${pct(s.triumph.countered)}`,
      `Protection used per game: ${s.protectionUsed.map((p) => `${p.name} ${p.perGame.toFixed(2)}`).join(', ') || 'none'}`,
      '(Approximation: opponents are profiles. Same-seed comparisons are the trustworthy part.)',
    ].join('\n');
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Results</h2>
      <ResultsHeader seed={s.seed} runs={s.games} runsLabel="games per pod" deckLabel={r.labelB ? `${r.labelA} vs ${r.labelB}` : r.labelA} copyText={text}>
        <p>
          Your deck plays card by card with its strategy (the same code as the goldfish) and real blocks: fliers can only be blocked by flying or
          reach, trample carries over, tapped creatures can’t block, and creatures that assign damage equal to toughness kill attackers.
          Protection is held (mana kept open) and spent on the right threat: Counterspell or Heroic Intervention on a wipe, Saved by the Shell on
          removal aimed at your commander, Veil of Summer on the Triumph turn, Tower Defense to block fliers in an emergency.
        </p>
        <p>
          Opponents are profiles. Each one adds real creatures from its decklist along the board curve its own goldfish produced, draws
          abstract interaction cards at its deck’s real counts, wipes when your board outgrows theirs, removes your commander and key pieces,
          counters key spells (commander, Triumph, wipes, combo pieces, 6+ mana) and Aetherizes big attacks. Each turn an opponent attacks one
          player, chosen by how much damage gets through and how threatening that player looks, so they also fight each other. You sit in seat 1.
        </p>
        <p>Not modelled: politics and deals, opponents’ triggered abilities beyond tokens, politics and deals.</p>
      </ResultsHeader>

      <div className="table-scroll">
        <table className="plain">
          <thead>
            <tr>
              <th>Pod</th>
              <th className="num">Win rate{r.labelB ? ` (${short(r.labelA)})` : ''}</th>
              {r.labelB && <th className="num">{short(r.labelB)}</th>}
              {r.labelB && <th className="num">{short(r.labelA)} vs {short(r.labelB)}</th>}
              <th className="num">Killed by fliers</th>
              <th className="num">by ground</th>
              <th className="num hide-sm">Decked</th>
              <th className="num hide-sm">Timeout</th>
            </tr>
          </thead>
          <tbody>
            {r.pods.map((p) => {
              const d = p.b ? p.a.winRate - p.b.winRate : 0;
              return (
                <tr key={p.label}>
                  <td>{p.label}</td>
                  <td className="num"><strong>{pct(p.a.winRate, 1)}</strong></td>
                  {r.labelB && <td className="num">{pct(p.b!.winRate, 1)}</td>}
                  {r.labelB && <td className="num"><span className={`status ${Math.abs(d) < 0.005 ? '' : d > 0 ? 'ok' : 'short'}`}>{Math.abs(d) < 0.005 ? '—' : `${d > 0 ? '▲ +' : '▼ '}${(100 * d).toFixed(1)} pts`}</span></td>}
                  <td className="num">{pct(p.a.losses.fliers)}</td>
                  <td className="num">{pct(p.a.losses.ground)}</td>
                  <td className="num hide-sm">{pct(p.a.losses.decked)}</td>
                  <td className="num hide-sm">{pct(p.a.losses.timeout)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ margin: '8px 0 0' }}>{main.label}</h3>
      <div className="stat-row">
        <div className="stat"><div className="v">{pct(s.winRate)}</div><div className="l">win rate{s.medianWin ? `, median win turn ${s.medianWin}` : ''}</div></div>
        <div className="stat"><div className="v">{s.perGame.commanderRemoved.toFixed(2)}</div><div className="l">times your commander was removed, per game</div></div>
        <div className="stat"><div className="v">{s.perGame.wipesFaced.toFixed(2)}</div><div className="l">board wipes faced per game</div></div>
        <div className="stat"><div className="v">{s.triumph.cast ? pct(s.triumph.countered) : '—'}</div><div className="l">of Triumph casts countered</div></div>
      </div>
      <TimingChart
        title="Won by turn"
        series={main.b ? [{ label: short(r.labelA), byTurn: main.a.winByTurn }, { label: short(r.labelB!), byTurn: main.b.winByTurn }] : [{ label: 'Won by turn', byTurn: s.winByTurn }]}
      />
      <div className="row small" style={{ alignItems: 'flex-start', gap: 32 }}>
        <div>
          <strong>How you won</strong>
          {Object.entries(s.winTypes).map(([k, v]) => (
            <div key={k}>{WIN_LABELS[k as keyof typeof WIN_LABELS]}: {pct(v ?? 0, 1)}</div>
          ))}
        </div>
        <div>
          <strong>How you lost</strong>
          {(Object.keys(LOSS_LABELS) as LossReason[]).filter((k) => s.losses[k] > 0.0005).map((k) => (
            <div key={k}>{LOSS_LABELS[k]}: {pct(s.losses[k], 1)}</div>
          ))}
        </div>
        <div>
          <strong>Protection actually used</strong> <span className="muted">(per game)</span>
          {s.protectionUsed.length ? s.protectionUsed.map((p) => <div key={p.name}>{p.name}: {p.perGame.toFixed(2)}</div>) : <div className="muted">none</div>}
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Per game: {s.perGame.removalFaced.toFixed(2)} removal spells aimed at you, {s.perGame.spellsCountered.toFixed(2)} of your spells countered, {s.perGame.aetherized.toFixed(2)} attacks Aetherized, {(s.perGame.combosDisrupted ?? 0).toFixed(2)} combos answered. Average life left at the end: {s.avgLifeAtEnd.toFixed(0)}.
      </p>
    </div>
  );
}
