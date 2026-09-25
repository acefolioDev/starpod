import type {
  DeadLetter,
  JobContext,
  JobDefinition,
  JobEvent,
  JobObserver,
  JobReceipt,
} from "./contracts";
import { emitJobProgress } from "./progress";

export type QueuedJob = {
  readonly id: string;
  readonly definition: JobDefinition<unknown>;
  readonly payload: unknown;
  readonly priority: number;
  readonly maxAttempts: number;
  readonly backoffMs: (attempt: number) => number;
  readonly timeoutMs: number | undefined;
  readonly deduplicationKey: string | undefined;
  readonly sequence: number;
  readyAt: number;
  attempt: number;
  cancelled: boolean;
};

export type QueueRuntime = {
  readonly concurrency: number;
  readonly idFactory: () => string;
  readonly now: () => number;
  readonly onEvent: JobObserver | undefined;
  readonly pending: QueuedJob[];
  readonly deduplicated: Map<string, JobReceipt>;
  readonly dead: Map<string, DeadLetter>;
  readonly idleWaiters: Array<() => void>;
  readonly runningJobs: Map<string, QueuedJob>;
  readonly controllers: Map<string, AbortController>;
  running: number;
  sequence: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  pumping: boolean;
  accepting: boolean;
  cancelled: boolean;
};

export function createQueueRuntime(
  concurrency: number,
  idFactory: () => string,
  now: () => number,
  onEvent: JobObserver | undefined,
): QueueRuntime {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("InMemoryJobQueue concurrency must be a positive integer");
  }
  return {
    concurrency,
    idFactory,
    now,
    onEvent,
    pending: [],
    deduplicated: new Map(),
    dead: new Map(),
    idleWaiters: [],
    runningJobs: new Map(),
    controllers: new Map(),
    running: 0,
    sequence: 0,
    timer: undefined,
    pumping: false,
    accepting: true,
    cancelled: false,
  };
}

export function cancelQueuedJob(state: QueueRuntime, id: string): boolean {
  const pendingIndex = state.pending.findIndex((job) => job.id === id);
  if (pendingIndex >= 0) {
    const job = state.pending.splice(pendingIndex, 1)[0];
    if (job) {
      job.cancelled = true;
      clearDeduplication(state, job);
      observeEvent(state, { operation: "cancel", id: job.id, name: job.definition.name });
    }
    armTimer(state);
    resolveIdleWaiters(state);
    return true;
  }

  const running = state.runningJobs.get(id);
  if (!running) return false;
  running.cancelled = true;
  state.controllers.get(id)?.abort();
  observeEvent(state, { operation: "cancel", id: running.id, name: running.definition.name });
  return true;
}

export function pumpQueue(state: QueueRuntime) {
  if (state.pumping || state.cancelled) return;
  state.pumping = true;
  try {
    while (state.running < state.concurrency) {
      const next = takeReady(state);
      if (!next) break;
      state.running += 1;
      void executeJob(state, next);
    }
  } finally {
    state.pumping = false;
    armTimer(state);
    resolveIdleWaiters(state);
  }
}

function takeReady(state: QueueRuntime): QueuedJob | undefined {
  const now = state.now();
  let selectedIndex = -1;
  for (let index = 0; index < state.pending.length; index += 1) {
    const candidate = state.pending[index];
    if (!candidate || candidate.readyAt > now) continue;
    const selected = selectedIndex === -1 ? undefined : state.pending[selectedIndex];
    if (!selected || candidate.priority > selected.priority ||
      (candidate.priority === selected.priority && candidate.sequence < selected.sequence)) {
      selectedIndex = index;
    }
  }
  return selectedIndex === -1 ? undefined : state.pending.splice(selectedIndex, 1)[0];
}

async function executeJob(state: QueueRuntime, job: QueuedJob) {
  job.attempt += 1;
  const controller = new AbortController();
  state.runningJobs.set(job.id, job);
  state.controllers.set(job.id, controller);
  observeEvent(state, { operation: "start", id: job.id, name: job.definition.name, attempt: job.attempt });
  let completed = false;
  try {
    await runWithTimeout(state, job, controller);
    completed = true;
    observeEvent(state, { operation: "success", id: job.id, name: job.definition.name, attempt: job.attempt });
  } catch (error) {
    if (job.cancelled || state.cancelled) {
      // Cancellation is a control decision, not a failed delivery.
    } else if (job.attempt < job.maxAttempts) {
      let delay: number | undefined;
      try {
        delay = job.backoffMs(job.attempt + 1);
      } catch (backoffError) {
        recordDeadLetter(state, job, backoffError);
      }
      if (delay !== undefined && Number.isFinite(delay) && delay >= 0) {
        job.readyAt = state.now() + delay;
        state.pending.push(job);
        observeEvent(state, {
          operation: "retry",
          id: job.id,
          name: job.definition.name,
          attempt: job.attempt,
          delayMs: delay,
        });
      } else if (delay !== undefined) {
        recordDeadLetter(state, job, new Error("job backoff must be a finite non-negative number"));
      }
    } else {
      recordDeadLetter(state, job, error);
    }
  } finally {
    state.runningJobs.delete(job.id);
    state.controllers.delete(job.id);
    if (completed && job.deduplicationKey) clearDeduplication(state, job);
    if (job.cancelled || state.cancelled) clearDeduplication(state, job);
    state.running -= 1;
    pumpQueue(state);
  }
}

async function runWithTimeout(state: QueueRuntime, job: QueuedJob, controller: AbortController) {
  const context: JobContext = {
    id: job.id,
    name: job.definition.name,
    attempt: job.attempt,
    signal: controller.signal,
    reportProgress: (progress) => emitJobProgress(
      state.onEvent,
      job.id,
      job.definition.name,
      job.attempt,
      progress,
    ),
  };
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

function recordDeadLetter(state: QueueRuntime, job: QueuedJob, error: unknown) {
  state.dead.set(job.id, Object.freeze({
    id: job.id,
    name: job.definition.name,
    payload: job.payload,
    attempts: job.attempt,
    error,
  }));
  observeEvent(state, { operation: "dead-letter", id: job.id, name: job.definition.name, attempts: job.attempt });
  clearDeduplication(state, job);
}

export function observeEvent(state: QueueRuntime, event: JobEvent) {
  try {
    state.onEvent?.(event);
  } catch {
    // Observability must not change delivery semantics.
  }
}

function clearDeduplication(state: QueueRuntime, job: QueuedJob) {
  if (job.deduplicationKey) state.deduplicated.delete(job.definition.name + ":" + job.deduplicationKey);
}

function armTimer(state: QueueRuntime) {
  clearTimer(state);
  const next = state.pending.reduce<number | undefined>((soonest, job) =>
    soonest === undefined || job.readyAt < soonest ? job.readyAt : soonest,
  undefined);
  if (next === undefined || state.cancelled) return;
  state.timer = setTimeout(() => {
    state.timer = undefined;
    pumpQueue(state);
  }, Math.max(0, next - state.now()));
}

export function clearTimer(state: QueueRuntime) {
  if (state.timer) clearTimeout(state.timer);
  state.timer = undefined;
}

export function resolveIdleWaiters(state: QueueRuntime) {
  if (state.pending.length > 0 || state.running > 0) return;
  for (const resolve of state.idleWaiters.splice(0)) resolve();
}
