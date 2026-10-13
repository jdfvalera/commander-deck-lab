// Seeded randomness. Every simulation takes a seed; game i of a run uses deriveSeed(seed, i), so two
// deck versions run "on the same seeds" see the same shuffle positions (common random numbers).

/** mulberry32: small, fast, good enough for card shuffling. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** splitmix32-style mix of (seed, index) into an independent per-game seed. */
export function deriveSeed(seed: number, index: number): number {
  let z = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** In-place Fisher–Yates shuffle. */
export function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** A seed from text the user typed: numbers are used as-is, anything else is hashed. */
export function parseSeed(input: string): number {
  const t = input.trim();
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h >>> 0;
}
