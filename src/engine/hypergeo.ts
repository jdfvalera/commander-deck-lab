// Exact hypergeometric probabilities (drawing without replacement), no simulation.
// population N, successes K in the population, n draws, k successes drawn.

const logFact: number[] = [0];
function lf(n: number): number {
  for (let i = logFact.length; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  return logFact[n];
}

export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return lf(n) - lf(k) - lf(n - k);
}

/** P(X = k). */
export function hypergeomPmf(N: number, K: number, n: number, k: number): number {
  if (k < Math.max(0, n - (N - K)) || k > Math.min(n, K)) return 0;
  return Math.exp(logChoose(K, k) + logChoose(N - K, n - k) - logChoose(N, n));
}

/** P(X >= k). */
export function hypergeomAtLeast(N: number, K: number, n: number, k: number): number {
  if (k <= 0) return 1;
  let p = 0;
  for (let i = k; i <= Math.min(n, K); i++) p += hypergeomPmf(N, K, n, i);
  return Math.min(1, p);
}

/** Cards seen by the start of turn `turn` (after that turn's draw). Commander multiplayer: everyone draws on turn 1. */
export function cardsSeen(turn: number, opts: { handSize?: number; drawOnTurnOne?: boolean } = {}): number {
  const hand = opts.handSize ?? 7;
  return hand + turn - (opts.drawOnTurnOne === false ? 1 : 0);
}

/**
 * Fewest sources (out of a library of N) that give at least `target` probability of having
 * `pips` of them among the cards seen by `turn`. Frank Karsten's method, without his mulligan model.
 */
export function sourcesNeeded(N: number, pips: number, turn: number, target: number, opts: { drawOnTurnOne?: boolean } = {}): number {
  const seen = cardsSeen(turn, opts);
  for (let S = pips; S <= N; S++) if (hypergeomAtLeast(N, S, seen, pips) >= target) return S;
  return N;
}
