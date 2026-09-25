import type { JobContext } from "./contracts";
import type { QueueRuntime, QueuedJob } from "./queue-runtime";
import { createJobContext } from "./context";

export async function runWithTimeout(state: QueueRuntime, job: QueuedJob, controller: AbortController) {
  const context: JobContext = createJobContext({
    id: job.id,
    name: job.definition.name,
    attempt: job.attempt,
    signal: controller.signal,
    tenantId: job.tenantId,
    onEvent: state.onEvent,
  });
  const work = Promise.resolve(job.definition.handle(job.payload, context));
  if (job.timeoutMs === undefined) return await work;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`job timed out after ${job.timeoutMs}ms`));
      }, job.timeoutMs);
      work.then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
