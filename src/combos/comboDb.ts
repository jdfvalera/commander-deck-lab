import type { ComboDb } from './findCombos';

let pending: Promise<ComboDb> | null = null;

/**
 * Loads the combo database shipped with the site (public/combos.json, ~2 MB gzipped).
 * Fetched once per page load on first use; the browser's HTTP cache covers repeat visits.
 */
export function loadComboDb(fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<ComboDb> {
  pending ??= fetchImpl(`${import.meta.env.BASE_URL}combos.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`combo database unavailable (${res.status})`);
      return res.json() as Promise<ComboDb>;
    })
    .catch((e) => {
      pending = null; // allow a retry
      throw e;
    });
  return pending;
}
