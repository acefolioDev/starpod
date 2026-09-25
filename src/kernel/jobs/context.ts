import { emitJobProgress } from "./progress";
import type { JobContext, JobEvent, JobObserver } from "./contracts";

export function createJobContext(options: {
  readonly id: string;
  readonly name: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly tenantId?: string;
  readonly onEvent?: JobObserver;
}): JobContext {
  return {
    id: options.id,
    name: options.name,
    attempt: options.attempt,
    signal: options.signal,
    ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
    reportProgress: (progress) => emitJobProgress(
      options.onEvent,
      options.id,
      options.name,
      options.attempt,
      progress,
    ),
  };
}

export function observeJob(observer: JobObserver | undefined, event: JobEvent) {
  try {
    observer?.(event);
  } catch {
    // Worker and queue telemetry must not change delivery semantics.
  }
}
