import type { Color } from '../data/types';

export interface ManaCost {
  generic: number;
  /** Colored pips by color, plus C for {C}. Hybrid and Phyrexian pips are listed separately. */
  pips: Record<Color | 'C', number>;
  hybrid: string[];
  x: number;
  mv: number;
}

const ZERO = () => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });

/** Parses "{2}{U}{U}", "{X}{G}", "{G/U}", "{2/W}", "{U/P}". */
export function parseManaCost(cost: string | undefined): ManaCost {
  const out: ManaCost = { generic: 0, pips: ZERO(), hybrid: [], x: 0, mv: 0 };
  for (const sym of cost?.match(/\{[^}]+\}/g) ?? []) {
    const v = sym.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(v)) {
      out.generic += Number(v);
      out.mv += Number(v);
    } else if (v === 'X' || v === 'Y' || v === 'Z') {
      out.x++;
    } else if (/^[WUBRGC]$/.test(v)) {
      out.pips[v as Color | 'C']++;
      out.mv++;
    } else if (v.includes('/')) {
      out.hybrid.push(v);
      const [a] = v.split('/');
      out.mv += /^\d+$/.test(a) ? Number(a) : 1;
    }
  }
  return out;
}

/** Applies a generic-mana reduction, keeping at least `floor` mana in the cost (Training Grounds: one). */
export function reduceGeneric(cost: ManaCost, by: number, floor = 1): ManaCost {
  const colored = Object.values(cost.pips).reduce((a, b) => a + b, 0) + cost.hybrid.length;
  const maxCut = Math.max(0, cost.generic - Math.max(0, floor - colored));
  const cut = Math.min(by, maxCut);
  return { ...cost, generic: cost.generic - cut, mv: cost.mv - cut };
}

export function formatCost(c: ManaCost): string {
  const parts: string[] = [];
  if (c.x) parts.push('{X}'.repeat(c.x));
  if (c.generic) parts.push(`{${c.generic}}`);
  for (const k of ['W', 'U', 'B', 'R', 'G', 'C'] as const) parts.push(`{${k}}`.repeat(c.pips[k]));
  for (const h of c.hybrid) parts.push(`{${h}}`);
  return parts.join('') || '{0}';
}
