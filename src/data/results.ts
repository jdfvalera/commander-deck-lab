// Saved simulation runs: kept in this browser (IndexedDB), newest first, included in backups.
import { createStore, get, set } from 'idb-keyval';

export interface SavedRun<T = unknown> {
  id: string;
  kind: 'goldfish' | 'matchup';
  createdAt: number;
  /** "Deck · version (vs other version)". */
  label: string;
  /** One line for the list, e.g. "median T11 · 48% by T10". */
  headline: string;
  data: T;
}

const MAX_RUNS = 30;
let store: ReturnType<typeof createStore> | null = null;
const dataStore = () => (store ??= createStore('cdl-data', 'kv'));

export async function loadRuns(): Promise<SavedRun[]> {
  try {
    return (await get<SavedRun[]>('runs', dataStore())) ?? [];
  } catch {
    return [];
  }
}

export async function saveRuns(runs: SavedRun[]): Promise<void> {
  try {
    await set('runs', runs.slice(0, MAX_RUNS), dataStore());
  } catch {
    // not saved: storage blocked
  }
}

export async function addRun(run: SavedRun): Promise<SavedRun[]> {
  const runs = [run, ...(await loadRuns())].slice(0, MAX_RUNS);
  await saveRuns(runs);
  return runs;
}

export async function deleteRun(id: string): Promise<SavedRun[]> {
  const runs = (await loadRuns()).filter((r) => r.id !== id);
  await saveRuns(runs);
  return runs;
}
