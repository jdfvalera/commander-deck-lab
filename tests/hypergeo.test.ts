import { describe, expect, it } from 'vitest';
import { cardsSeen, hypergeomAtLeast, hypergeomPmf, logChoose, sourcesNeeded } from '../src/engine/hypergeo';
import { deriveSeed, mulberry32, parseSeed, shuffle } from '../src/engine/rng';
import { formatCost, parseManaCost, reduceGeneric } from '../src/engine/manaCost';

// From Python: sum(Fraction(comb(K,k)*comb(N-K,7-k), comb(N,7)) for k in range).
const P24_60_24 = 0.7745670429727153;
const P25_99_37 = 0.8038033689679942;

/** Exact reference with BigInt binomials. */
function exactPmf(N: number, K: number, n: number, k: number): number {
  const C = (a: number, b: number): bigint => {
    if (b < 0 || b > a) return 0n;
    let r = 1n;
    for (let i = 0; i < b; i++) r = (r * BigInt(a - i)) / BigInt(i + 1);
    return r;
  };
  return Number((C(K, k) * C(N - K, n - k) * 10n ** 15n) / C(N, n)) / 1e15;
}

describe('hypergeometric', () => {
  it('matches exact BigInt values', () => {
    for (const [N, K, n, k] of [[99, 37, 7, 3], [99, 37, 7, 0], [60, 24, 7, 3], [99, 10, 12, 1], [40, 17, 7, 2]]) {
      expect(hypergeomPmf(N, K, n, k)).toBeCloseTo(exactPmf(N, K, n, k), 10);
    }
  });

  it('known values (exact fractions computed independently with Python math.comb)', () => {
    // 60 cards, 24 lands: P(exactly 3 in 7) = C(24,3)·C(36,4)/C(60,7) = 119223720/386206920.
    expect(hypergeomPmf(60, 24, 7, 3)).toBeCloseTo(119223720 / 386206920, 12);
    const p24 = [2, 3, 4].reduce((a, k) => a + hypergeomPmf(60, 24, 7, k), 0);
    expect(p24).toBeCloseTo(P24_60_24, 10);
    // 37 lands in a 99-card library, 2–5 lands in the opening 7.
    const p25 = [2, 3, 4, 5].reduce((a, k) => a + hypergeomPmf(99, 37, 7, k), 0);
    expect(p25).toBeCloseTo(P25_99_37, 10);
  });

  it('pmf sums to 1 and at-least is consistent', () => {
    const s = Array.from({ length: 8 }, (_, k) => hypergeomPmf(99, 38, 7, k)).reduce((a, b) => a + b, 0);
    expect(s).toBeCloseTo(1, 12);
    expect(hypergeomAtLeast(99, 38, 7, 0)).toBe(1);
    expect(hypergeomAtLeast(99, 38, 7, 2)).toBeCloseTo(1 - hypergeomPmf(99, 38, 7, 0) - hypergeomPmf(99, 38, 7, 1), 12);
    expect(logChoose(5, 6)).toBe(-Infinity);
  });

  it('cards seen: multiplayer draws on turn 1', () => {
    expect(cardsSeen(1)).toBe(8);
    expect(cardsSeen(1, { drawOnTurnOne: false })).toBe(7);
    expect(cardsSeen(4)).toBe(11);
  });

  it('sources needed rises with pips and falls with turn', () => {
    const one = sourcesNeeded(99, 1, 2, 0.9);
    const two = sourcesNeeded(99, 2, 2, 0.9);
    const late = sourcesNeeded(99, 2, 5, 0.9);
    expect(two).toBeGreaterThan(one);
    expect(late).toBeLessThan(two);
    expect(hypergeomAtLeast(99, two, cardsSeen(2), 2)).toBeGreaterThanOrEqual(0.9);
    expect(hypergeomAtLeast(99, two - 1, cardsSeen(2), 2)).toBeLessThan(0.9);
  });
});

describe('rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
  });
  it('derived seeds are distinct and stable', () => {
    const s = new Set(Array.from({ length: 1000 }, (_, i) => deriveSeed(7, i)));
    expect(s.size).toBe(1000);
    expect(deriveSeed(7, 3)).toBe(deriveSeed(7, 3));
  });
  it('shuffle is a permutation and seeded', () => {
    const x = shuffle([...Array(99).keys()], mulberry32(1));
    expect([...x].sort((p, q) => p - q)).toEqual([...Array(99).keys()]);
    expect(shuffle([...Array(99).keys()], mulberry32(1))).toEqual(x);
  });
  it('parses seeds from numbers or text', () => {
    expect(parseSeed('123')).toBe(123);
    expect(parseSeed('pride')).toBe(parseSeed('pride'));
  });
});

describe('mana costs', () => {
  it('parses colored, generic, X and hybrid', () => {
    const c = parseManaCost('{X}{2}{G}{G}{G/U}');
    expect(c).toMatchObject({ generic: 2, x: 1, mv: 5, hybrid: ['G/U'] });
    expect(c.pips.G).toBe(2);
  });
  it("Training Grounds turns the Pride's {2}{U}{U} into {U}{U}", () => {
    const c = reduceGeneric(parseManaCost('{2}{U}{U}'), 2);
    expect(formatCost(c)).toBe('{U}{U}');
    expect(c.mv).toBe(2);
  });
  it("Walking Bulwark's {2} can't drop below one mana", () => {
    expect(formatCost(reduceGeneric(parseManaCost('{2}'), 2))).toBe('{1}');
    expect(formatCost(reduceGeneric(parseManaCost('{2}'), 4))).toBe('{1}');
  });
});
