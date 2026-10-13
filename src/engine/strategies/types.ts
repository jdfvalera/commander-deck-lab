import type { Game } from '../game';

export interface SettingDef {
  key: string;
  label: string;
  help?: string;
  type: 'number' | 'boolean';
  default: number | boolean;
  min?: number;
  max?: number;
}

export type StrategySettings = Record<string, number | boolean>;

/** How to pilot a deck: one decision function per phase. The engine (game.ts) enforces the rules. */
export interface Strategy {
  id: string;
  label: string;
  description: string;
  settings: SettingDef[];
  main1(g: Game, s: StrategySettings): void;
  combat(g: Game, s: StrategySettings): void;
  main2(g: Game, s: StrategySettings): void;
}

export function defaults(defs: SettingDef[]): StrategySettings {
  return Object.fromEntries(defs.map((d) => [d.key, d.default]));
}
