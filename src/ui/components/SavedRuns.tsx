import { useEffect, useState } from 'react';
import { deleteRun, loadRuns, type SavedRun } from '../../data/results';

/** Past runs of one kind: reopen or delete. `refresh` changes whenever a new run is saved. */
export function SavedRuns<T>({ kind, refresh, onOpen }: { kind: SavedRun['kind']; refresh: number; onOpen: (run: SavedRun<T>) => void }) {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  useEffect(() => {
    let live = true;
    loadRuns().then((r) => live && setRuns(r.filter((x) => x.kind === kind)));
    return () => {
      live = false;
    };
  }, [kind, refresh]);
  if (!runs.length) return null;
  return (
    <details className="card">
      <summary>
        <strong>Saved runs</strong> <span className="muted small">({runs.length}, kept in this browser)</span>
      </summary>
      <table className="plain small" style={{ marginTop: 8 }}>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.createdAt).toLocaleString()}</td>
              <td>{r.label}<div className="muted">{r.headline}</div></td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>
                <button className="link" onClick={() => onOpen(r as SavedRun<T>)}>Open</button>{' '}
                <button className="link danger" onClick={() => deleteRun(r.id).then((all) => setRuns(all.filter((x) => x.kind === kind)))}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
