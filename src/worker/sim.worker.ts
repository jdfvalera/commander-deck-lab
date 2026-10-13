/// <reference lib="webworker" />
import { runJob, type Job, type WorkerMessage } from './jobs';

const post = (m: WorkerMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (e: MessageEvent<Job>) => {
  try {
    const result = runJob(e.data, (done, total) => post({ type: 'progress', done, total }));
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
