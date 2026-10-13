// Simulation jobs: plain data in, plain data out, so they run the same in a Web Worker or inline.
import type { DeckModel } from '../engine/deckModel';
import { summarizeMulligans, type HandOptions, type KeepRules, type MulliganSummary } from '../engine/mulligan';

export type Job = { kind: 'mulligan'; model: DeckModel; seed: number; trials: number; rules: KeepRules; opts: HandOptions };
export type JobResult = { kind: 'mulligan'; result: MulliganSummary };

export function runJob(job: Job, onProgress: (done: number, total: number) => void): JobResult {
  switch (job.kind) {
    case 'mulligan':
      return { kind: 'mulligan', result: summarizeMulligans(job.model, job.seed, job.trials, job.rules, job.opts, (d) => onProgress(d, job.trials)) };
  }
}

export type WorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: JobResult }
  | { type: 'error'; message: string };
