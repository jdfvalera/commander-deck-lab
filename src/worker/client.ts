import { runJob, type Job, type JobResult, type WorkerMessage } from './jobs';

export interface RunningJob<T> {
  promise: Promise<T>;
  cancel: () => void;
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

/**
 * Runs a job in a fresh Web Worker so the page never freezes; Cancel terminates the worker.
 * Falls back to running inline where workers aren't available (tests).
 */
export function startJob(job: Job, onProgress: (done: number, total: number) => void): RunningJob<JobResult> {
  if (typeof Worker === 'undefined') {
    let cancelled = false;
    const promise = new Promise<JobResult>((resolve, reject) =>
      setTimeout(() => {
        if (cancelled) return reject(new CancelledError());
        try {
          resolve(runJob(job, onProgress));
        } catch (e) {
          reject(e);
        }
      }, 0),
    );
    return { promise, cancel: () => (cancelled = true) };
  }
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  let rejectFn: (e: unknown) => void = () => {};
  const promise = new Promise<JobResult>((resolve, reject) => {
    rejectFn = reject;
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.done, m.total);
      else if (m.type === 'done') {
        resolve(m.result);
        worker.terminate();
      } else {
        reject(new Error(m.message));
        worker.terminate();
      }
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || 'simulation worker failed'));
      worker.terminate();
    };
    worker.postMessage(job);
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      rejectFn(new CancelledError());
    },
  };
}
