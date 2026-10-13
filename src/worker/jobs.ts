// Simulation jobs: plain data in, plain data out, so they run the same in a Web Worker or inline.
import type { DeckModel } from '../engine/deckModel';
import type { CompiledDeck } from '../engine/cards';
import { summarizeMulligans, type HandOptions, type KeepRules, type MulliganSummary } from '../engine/mulligan';
import { alignedOrder, runGoldfish, type GoldfishOptions, type GoldfishSummary } from '../engine/goldfish';
import { runTable, type MatchupSummary, type TableSettings } from '../engine/table';
import type { OpponentProfile } from '../opponents/profile';

export type Job =
  | { kind: 'mulligan'; model: DeckModel; seed: number; trials: number; rules: KeepRules; opts: HandOptions }
  | { kind: 'goldfish'; deck: CompiledDeck; opts: GoldfishOptions }
  | { kind: 'compare'; a: CompiledDeck; b: CompiledDeck; opts: GoldfishOptions }
  | { kind: 'matchup'; deck: CompiledDeck; compareWith?: CompiledDeck; pods: { label: string; profiles: OpponentProfile[] }[]; opts: TableSettings };

export type JobResult =
  | { kind: 'mulligan'; result: MulliganSummary }
  | { kind: 'goldfish'; result: GoldfishSummary }
  | { kind: 'compare'; a: GoldfishSummary; b: GoldfishSummary }
  | { kind: 'matchup'; pods: { label: string; a: MatchupSummary; b?: MatchupSummary }[] };

export function runJob(job: Job, onProgress: (done: number, total: number) => void): JobResult {
  switch (job.kind) {
    case 'mulligan':
      return { kind: 'mulligan', result: summarizeMulligans(job.model, job.seed, job.trials, job.rules, job.opts, (d) => onProgress(d, job.trials)) };
    case 'goldfish':
      return { kind: 'goldfish', result: runGoldfish(job.deck, job.opts, (d) => onProgress(d, job.opts.games)) };
    case 'compare': {
      const n = job.opts.games;
      const a = runGoldfish(job.a, job.opts, (d) => onProgress(d, 2 * n));
      // Same seeds, and B's library lined up with A's so each swapped card takes the cut card's shuffle slot.
      const b = runGoldfish(job.b, job.opts, (d) => onProgress(n + d, 2 * n), alignedOrder(job.a, job.b));
      return { kind: 'compare', a, b };
    }
    case 'matchup': {
      // Every pod, each version on the same seeds (B's library lined up with A's).
      const per = job.opts.games * (job.compareWith ? 2 : 1);
      const total = per * job.pods.length;
      const order = job.compareWith ? alignedOrder(job.deck, job.compareWith) : undefined;
      const pods = job.pods.map((pod, i) => {
        const base = i * per;
        const a = runTable(job.deck, pod.profiles, job.opts, (d) => onProgress(base + d, total));
        const b = job.compareWith ? runTable(job.compareWith, pod.profiles, job.opts, (d) => onProgress(base + job.opts.games + d, total), order) : undefined;
        return { label: pod.label, a, b };
      });
      return { kind: 'matchup', pods };
    }
  }
}

export type WorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: JobResult }
  | { type: 'error'; message: string };
