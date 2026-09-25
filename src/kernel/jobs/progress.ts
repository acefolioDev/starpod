import type { JobObserver } from "./contracts";

export type JobProgress = {
  readonly completed: number;
  readonly total?: number;
};

/** Emit bounded progress metadata without exposing job payloads to observers. */
export function emitJobProgress(
  observer: JobObserver | undefined,
  id: string,
  name: string,
  attempt: number,
  progress: JobProgress,
) {
  validateJobProgress(progress);
  try {
    observer?.({
      operation: "progress",
      id,
      name,
      attempt,
      completed: progress.completed,
      ...(progress.total === undefined ? {} : { total: progress.total }),
    });
  } catch {
    // Progress telemetry must not change job execution.
  }
}

function validateJobProgress(progress: JobProgress) {
  if (!Number.isInteger(progress.completed) || progress.completed < 0) {
    throw new Error("job progress completed must be a non-negative integer");
  }
  if (progress.total !== undefined &&
    (!Number.isInteger(progress.total) || progress.total < 1 || progress.completed > progress.total)) {
    throw new Error("job progress total must be a positive integer at least completed");
  }
}
