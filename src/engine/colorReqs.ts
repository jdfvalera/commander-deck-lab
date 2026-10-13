// Colored-source requirements, Frank Karsten's method: for each spell, the fewest sources that give
// at least `target` probability of having its colored pips among the cards seen by the turn you'd
// cast it. Computed exactly (hypergeometric) for this deck's library size; unlike Karsten's
// published tables it doesn't model mulligans, so it's slightly stricter.

import type { Color } from '../data/types';
import { cardsSeen, hypergeomAtLeast, sourcesNeeded } from './hypergeo';
import type { DeckModel, SourceKind } from './deckModel';

export interface SourceWeights {
  land: number;
  rock: number;
  dork: number;
  aura: number;
}

export interface ColorOptions {
  target: number;
  weights: SourceWeights;
  drawOnTurnOne: boolean;
  /** Turn by which the commander's colored activation should be affordable. */
  abilityTurn: number;
}

export const DEFAULT_COLOR_OPTIONS: ColorOptions = {
  target: 0.9,
  // Mana creatures and land auras die or get removed more often than lands: count them a little lower.
  weights: { land: 1, rock: 1, dork: 0.8, aura: 0.8 },
  drawOnTurnOne: true,
  abilityTurn: 5,
};

export interface Requirement {
  source: string;
  pips: number;
  turn: number;
  needed: number;
  kind: 'spell' | 'commander' | 'ability';
}

export interface ColorReport {
  color: Color;
  sources: Record<SourceKind, number>;
  weighted: number;
  requirements: Requirement[];
  strictest: Requirement | null;
  /** Requirements this color's sources meet / all requirements. */
  met: number;
  /** Requirements that miss the target, strictest first. */
  unmet: Requirement[];
  /** ok = every requirement met; close = at least 80% met; short = fewer. */
  status: 'ok' | 'close' | 'short' | 'none';
  /** P(at least 1, 2, 3 sources seen) by turns 1..6, using the weighted source count. */
  byTurn: { turn: number; atLeast: [number, number, number] }[];
}

export function colorReports(model: DeckModel, opts: ColorOptions = DEFAULT_COLOR_OPTIONS): ColorReport[] {
  const N = model.librarySize;
  const need = (pips: number, turn: number) => sourcesNeeded(N, pips, turn, opts.target, { drawOnTurnOne: opts.drawOnTurnOne });

  return model.identity.map((color) => {
    const sources: Record<SourceKind, number> = { land: 0, rock: 0, dork: 0, aura: 0 };
    for (const c of model.library) if (c.sourceKind && c.produces.includes(color)) sources[c.sourceKind] += c.qty;
    const weighted = (Object.keys(sources) as SourceKind[]).reduce((a, k) => a + sources[k] * opts.weights[k], 0);

    const requirements: Requirement[] = [];
    for (const c of model.library) {
      const pips = c.cost.pips[color];
      if (!pips || c.isLand) continue;
      const turn = Math.min(10, Math.max(1, c.mv));
      requirements.push({ source: c.name, pips, turn, needed: need(pips, turn), kind: 'spell' });
    }
    for (const c of model.commanders) {
      const pips = c.cost.pips[color];
      if (!pips || c.boardDependentCost) continue;
      const turn = Math.min(10, Math.max(1, c.mv));
      requirements.push({ source: `${c.name} (commander)`, pips, turn, needed: need(pips, turn), kind: 'commander' });
    }
    for (const a of model.commanderAbilities) {
      const pips = a.cost.pips[color];
      if (!pips) continue;
      requirements.push({ source: a.label, pips, turn: opts.abilityTurn, needed: need(pips, opts.abilityTurn), kind: 'ability' });
    }
    requirements.sort((a, b) => b.needed - a.needed || b.pips - a.pips);
    const strictest = requirements[0] ?? null;
    const unmet = requirements.filter((r) => weighted < r.needed);
    const met = requirements.length - unmet.length;
    const status: ColorReport['status'] = !requirements.length ? 'none' : !unmet.length ? 'ok' : met / requirements.length >= 0.8 ? 'close' : 'short';

    const S = Math.round(weighted);
    const byTurn = [1, 2, 3, 4, 5, 6].map((turn) => {
      const n = cardsSeen(turn, { drawOnTurnOne: opts.drawOnTurnOne });
      return { turn, atLeast: [1, 2, 3].map((k) => hypergeomAtLeast(N, S, n, k)) as [number, number, number] };
    });
    return { color, sources, weighted, requirements, strictest, met, unmet, status, byTurn };
  });
}
