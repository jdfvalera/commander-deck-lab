import { createStore, get, set } from 'idb-keyval';
import { isTagKey, withDefaults, type CardTags, type TagKey, type TagParams } from './schema';

/** A user edit to one tag: new params, or null to remove an auto-detected tag. */
export type TagOverride = { params: TagParams } | null;
export type CardOverrides = Partial<Record<TagKey, TagOverride>>;
/** Keyed by nameKey(card name). */
export type OverrideMap = Record<string, CardOverrides>;

/** Auto tags with the user's edits on top. Edited tags are marked "manual". */
export function applyOverrides(auto: CardTags, overrides?: CardOverrides): CardTags {
  if (!overrides) return auto;
  const out: CardTags = { ...auto };
  for (const [k, ov] of Object.entries(overrides)) {
    if (!isTagKey(k)) continue;
    if (ov === null) delete out[k];
    else if (ov) out[k] = { source: 'manual', params: withDefaults(k, ov.params) };
  }
  return out;
}

export function setOverride(map: OverrideMap, cardKey: string, tag: TagKey, value: TagOverride): OverrideMap {
  return { ...map, [cardKey]: { ...(map[cardKey] ?? {}), [tag]: value } };
}

/** Drops the user's edit so the auto tag (if any) comes back. */
export function resetOverride(map: OverrideMap, cardKey: string, tag?: TagKey): OverrideMap {
  const next = { ...map };
  if (!tag) {
    delete next[cardKey];
    return next;
  }
  const card = { ...(next[cardKey] ?? {}) };
  delete card[tag];
  if (Object.keys(card).length) next[cardKey] = card;
  else delete next[cardKey];
  return next;
}

let store: ReturnType<typeof createStore> | null = null;
const dataStore = () => (store ??= createStore('cdl-data', 'kv'));

export async function loadOverrides(): Promise<OverrideMap> {
  try {
    return (await get<OverrideMap>('tagOverrides', dataStore())) ?? {};
  } catch {
    return {};
  }
}

export async function saveOverrides(map: OverrideMap): Promise<void> {
  try {
    await set('tagOverrides', map, dataStore());
  } catch {
    // Storage blocked (private mode etc.): edits last for this session only.
  }
}
