import { useMemo, useState } from 'react';
import type { TurnLog } from '../../engine/game';

export interface SampleRun {
  logs: TurnLog[];
  seed: number;
  summary: string;
}

/** Step through one seeded game turn by turn: hand after the draw, every decision, the board, the life totals. */
export function SampleGame({ play, games, title = 'Sample game' }: { play: (gameIndex: number) => SampleRun; games: number; title?: string }) {
  const [gameIndex, setGameIndex] = useState(0);
  const [turn, setTurn] = useState(0);
  const sample = useMemo(() => play(gameIndex), [play, gameIndex]);
  const log = sample.logs[Math.min(turn, sample.logs.length - 1)];
  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="spacer" />
        <label className="small">
          Game # <input type="number" min={0} max={games - 1} value={gameIndex} onChange={(e) => { setGameIndex(Number(e.target.value)); setTurn(0); }} style={{ width: 80 }} />
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Game {gameIndex} of the run above (seed <code>{sample.seed}</code>): {sample.summary}
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
          <div className="small"><span className="muted">Your battlefield at end of turn:</span> {log.board.join(' · ') || 'nothing'}</div>
        </>
      )}
    </div>
  );
}
