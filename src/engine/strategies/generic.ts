import type { Strategy } from './types';
import { activateAbilities, attachIfNeeded, attackAll, castCommander, castDraw, castRamp, castWhile, equip, playLand } from './common';

/** A sensible default for any deck: land, ramp, commander, draw, threats; attack when it can; hold interaction. */
export const genericStrategy: Strategy = {
  id: 'generic',
  label: 'Generic',
  description: 'Play a land, cast ramp, the commander, card draw, then the biggest threats that fit. Attack with everything that can. Interaction is held (there are no opponents to use it on).',
  settings: [
    { key: 'castCommanderFirst', label: 'Cast the commander before other spells when possible', type: 'boolean', default: true },
  ],
  main1(g, s) {
    playLand(g, g.d.identity);
    castRamp(g);
    if (s.castCommanderFirst) castCommander(g);
    castDraw(g);
    castThreats(g);
    castCommander(g);
    equip(g, () => g.creatures().filter((p) => g.readyToAttack(p) || p.sick).sort((a, b) => g.power(b) - g.power(a))[0] ?? null);
    activateAbilities(g);
    g.checkCombos();
  },
  combat(g) {
    attackAll(g, (p) => p.token !== null || g.def(p.def).sourceKind !== 'dork');
  },
  main2(g) {
    playLand(g, g.d.identity);
    castRamp(g);
    castCommander(g);
    castDraw(g);
    castThreats(g);
    activateAbilities(g);
    g.checkCombos();
  },
};

function castThreats(g: import('../game').Game) {
  castWhile(
    g,
    (d) => d.permanent && !d.types.land && !d.interaction && !d.protection,
    (d) => d.mv + (d.types.creature ? 0.5 : 0),
    (p, d) => attachIfNeeded(g, p, d),
  );
}
