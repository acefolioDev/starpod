import {
  exponentialBackoff,
  validateJob,
  validateJobId,
  type DeadLetter,
  type JobDefinition,
  type JobOptions,
  type JobObserver,
  type JobQueue,
  type JobReceipt,
} from "./contracts";
import {
  cancelQueuedJob,
  clearTimer,
  createQueueRuntime,
  observeEvent,
  pumpQueue,
  resolveIdleWaiters,
  type QueueRuntime,
  type QueuedJob,
} from "./queue-runtime";

export type InMemoryJobQueueOptions = {
  readonly concurrency?: number;
  readonly idFactory?: () => string;
  readonly now?: () => number;
  readonly onEvent?: JobObserver;
};

/** Bounded in-process queue for local work and deterministic tests. */
export class InMemoryJobQueue implements JobQueue {
  private readonly state: QueueRuntime;
  private closing: Promise<void> | undefined;

  constructor(options: InMemoryJobQueueOptions = {}) {
    this.state = createQueueRuntime(
      options.concurrency ?? 1,
      options.idFactory ?? (() => crypto.randomUUID()),
      options.now ?? Date.now,
      options.onEvent,
    );
  }

  async dispatch<TPayload>(job: JobDefinition<TPayload>, payload: TPayload, options: JobOptions = {}) {
    const state = this.state;
    if (!state.accepting) throw new Error("job queue has already been closed");
    validateJob(job, options);
    if (options.deduplicationKey) {
      const existing = state.deduplicated.get(`${job.name}:${options.deduplicationKey}`);
      if (existing) return existing;
    }

    const id = options.id ?? state.idFactory();
    validateJobId(id);
    if (state.pending.some((queued) => queued.id === id) || state.runningJobs.has(id) || state.dead.has(id)) {
      throw new Error(`job id "${id}" is already active or dead-lettered`);
    }

    const receipt = Object.freeze({ id, name: job.name });
    const queued: QueuedJob = {
      id,
      definition: job as unknown as JobDefinition<unknown>,
      payload,
      priority: options.priority ?? 0,
      maxAttempts: options.maxAttempts ?? 1,
      backoffMs: options.backoffMs ?? exponentialBackoff(),
      timeoutMs: options.timeoutMs,
      deduplicationKey: options.deduplicationKey,
      sequence: state.sequence++,
      readyAt: state.now() + (options.delayMs ?? 0),
      attempt: 0,
      cancelled: false,
    };
    state.pending.push(queued);
    observeEvent(state, { operation: "dispatch", id, name: job.name });
    if (queued.deduplicationKey) state.deduplicated.set(`${job.name}:${queued.deduplicationKey}`, receipt);
    pumpQueue(state);
    return receipt;
  }

  awaitIdle() {
    const state = this.state;
    if (state.pending.length === 0 && state.running === 0) return Promise.resolve();
    return new Promise<void>((resolve) => state.idleWaiters.push(resolve));
  }

  cancel(id: string) {
    return cancelQueuedJob(this.state, id);
  }

  async close(options: { readonly drain?: boolean } = {}) {
    const state = this.state;
    if (this.closing) return this.closing;
    state.accepting = false;
    this.closing = (async () => {
      if (options.drain ?? true) {
        pumpQueue(state);
        await this.awaitIdle();
        return;
      }
      state.cancelled = true;
      for (const job of state.pending) {
        job.cancelled = true;
        if (job.deduplicationKey) state.deduplicated.delete(`${job.definition.name}:${job.deduplicationKey}`);
      }
      state.pending.length = 0;
      for (const job of state.runningJobs.values()) {
        job.cancelled = true;
        state.controllers.get(job.id)?.abort();
      }
      clearTimer(state);
      resolveIdleWaiters(state);
    })();
    return this.closing;
  }

  async dispose() {
    await this.close({ drain: true });
  }

  deadLetters(): readonly DeadLetter[] {
    return Object.freeze([...this.state.dead.values()]);
  }

  clearDeadLetters() {
    this.state.dead.clear();
  }
}
