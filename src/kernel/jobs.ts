import { assertJsonValue, type JsonValue } from "./wire";

export type JobContext = {
  readonly id: string;
  readonly name: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
};

export type JobPayloadValue = JsonValue;

export type JobCodec<TPayload> = {
  readonly encode: (payload: TPayload) => JobPayloadValue;
  readonly decode: (value: JobPayloadValue) => TPayload;
};

export type JobWireOptions = {
  readonly id?: string;
  readonly delayMs?: number;
  readonly priority?: number;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly deduplicationKey?: string;
};

export type JobEnvelope = {
  readonly name: string;
  readonly payload: JobPayloadValue;
  readonly options: JobWireOptions;
};

export type JobDefinition<TPayload> = {
  readonly name: string;
  readonly handle: (payload: TPayload, context: JobContext) => void | Promise<void>;
  /** Optional wire contract for queues that persist payloads outside this process. */
  readonly codec?: JobCodec<TPayload>;
};

export type JobOptions = {
  readonly id?: string;
  readonly delayMs?: number;
  readonly priority?: number;
  readonly maxAttempts?: number;
  readonly backoffMs?: (attempt: number) => number;
  readonly timeoutMs?: number;
  readonly deduplicationKey?: string;
};

export type JobReceipt = {
  readonly id: string;
  readonly name: string;
};

export type JobEvent =
  | { readonly operation: "dispatch"; readonly id: string; readonly name: string }
  | { readonly operation: "start"; readonly id: string; readonly name: string; readonly attempt: number }
  | { readonly operation: "success"; readonly id: string; readonly name: string; readonly attempt: number }
  | { readonly operation: "retry"; readonly id: string; readonly name: string; readonly attempt: number; readonly delayMs: number }
  | { readonly operation: "dead-letter"; readonly id: string; readonly name: string; readonly attempts: number }
  | { readonly operation: "cancel"; readonly id: string; readonly name: string };

export type JobObserver = (event: JobEvent) => void;

export type DeadLetter = {
  readonly id: string;
  readonly name: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly error: unknown;
};

export type JobQueue = {
  dispatch<TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    options?: JobOptions,
  ): Promise<JobReceipt>;
  /** Cancel a pending or running job. Running handlers must honor JobContext.signal. */
  cancel?(id: string): boolean | Promise<boolean>;
  awaitIdle(): Promise<void>;
  close(options?: { readonly drain?: boolean }): Promise<void>;
};

/**
 * Registry used by workers that receive a job name and serialized payload
 * from a durable queue. The in-memory queue does not need a registry because
 * it executes the definition passed to dispatch directly.
 */
export class JobRegistry {
  private readonly definitions = new Map<string, JobDefinition<unknown>>();

  register<TPayload>(job: JobDefinition<TPayload>): JobDefinition<TPayload> {
    validateJobName(job.name);
    if (this.definitions.has(job.name)) {
      throw new Error("job \"" + job.name + "\" is already registered");
    }
    this.definitions.set(job.name, job as unknown as JobDefinition<unknown>);
    return job;
  }

  resolve(name: string): JobDefinition<unknown> {
    const job = this.definitions.get(name);
    if (!job) {
      const available = [...this.definitions.keys()].sort().join(", ") || "none";
      throw new Error("unknown job \"" + name + "\" (registered jobs: " + available + ")");
    }
    return job;
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  names(): readonly string[] {
    return Object.freeze([...this.definitions.keys()].sort());
  }
}

export function encodeJob<TPayload>(
  job: JobDefinition<TPayload>,
  payload: TPayload,
  options: JobOptions = {},
): JobEnvelope {
  validateJob(job, options);
  if (!job.codec) {
    throw new Error("job \"" + job.name + "\" must define a codec before crossing a persistence boundary");
  }

  const encodedPayload = job.codec.encode(payload);
  assertJsonValue(encodedPayload, "job payload");

  return Object.freeze({
    name: job.name,
    payload: encodedPayload,
    options: Object.freeze(toWireOptions(options)),
  });
}

export function decodeJob<TPayload>(
  job: JobDefinition<TPayload>,
  payload: JobPayloadValue,
): TPayload {
  if (!job.codec) {
    throw new Error("job \"" + job.name + "\" must define a codec before decoding a persisted payload");
  }
  return job.codec.decode(payload);
}

export type ScheduleOptions = {
  readonly intervalMs: number;
  readonly initialDelayMs?: number;
  readonly runImmediately?: boolean;
  readonly jobOptions?: JobOptions;
};

export type ScheduledTask = {
  readonly cancel: () => void;
  readonly active: () => boolean;
};

export type InMemorySchedulerOptions = {
  readonly onError?: (error: unknown) => void | Promise<void>;
};

/** Fixed-delay in-process scheduling over a typed JobQueue. */
export class InMemoryScheduler {
  private readonly tasks = new Set<InMemoryScheduledTask>();
  private readonly onError: ((error: unknown) => void | Promise<void>) | undefined;
  private disposed = false;

  constructor(
    private readonly queue: JobQueue,
    options: InMemorySchedulerOptions = {},
  ) {
    this.onError = options.onError;
  }

  schedule<TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    options: ScheduleOptions,
  ): ScheduledTask {
    return this.createSchedule(job, () => payload, options);
  }

  scheduleFactory<TPayload>(
    job: JobDefinition<TPayload>,
    factory: () => TPayload | Promise<TPayload>,
    options: ScheduleOptions,
  ): ScheduledTask {
    return this.createSchedule(job, factory, options);
  }

  private createSchedule<TPayload>(
    job: JobDefinition<TPayload>,
    factory: () => TPayload | Promise<TPayload>,
    options: ScheduleOptions,
  ): ScheduledTask {
    if (this.disposed) throw new Error("scheduler has already been disposed");
    validateSchedule(options);

    const task = new InMemoryScheduledTask(
      async () => {
        const value = await factory();
        await this.queue.dispatch(job, value, options.jobOptions);
      },
      options,
      async (error) => {
        try {
          await this.onError?.(error);
        } catch {
          // A scheduler error handler must not terminate the scheduling loop.
        }
      },
      () => this.tasks.delete(task),
    );
    this.tasks.add(task);
    task.start();
    return task;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const tasks = [...this.tasks];
    for (const task of tasks) task.cancel();
    await Promise.all(tasks.map((task) => task.idle()));
    this.tasks.clear();
  }
}

class InMemoryScheduledTask implements ScheduledTask {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private cancelled = false;

  constructor(
    private readonly run: () => Promise<void>,
    private readonly options: ScheduleOptions,
    private readonly onError: (error: unknown) => Promise<void>,
    private readonly onComplete: () => void,
  ) {}

  start() {
    const delay = this.options.runImmediately ? 0 : this.options.initialDelayMs ?? this.options.intervalMs;
    this.timer = setTimeout(() => void this.execute(), delay);
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running) this.onComplete();
  }

  active() {
    return !this.cancelled;
  }

  async idle() {
    await this.running;
  }

  private async execute() {
    if (this.cancelled) return;
    this.running = (async () => {
      try {
        await this.run();
      } catch (error) {
        await this.onError(error);
      } finally {
        this.running = undefined;
        if (this.cancelled) {
          this.onComplete();
        } else {
          this.timer = setTimeout(() => void this.execute(), this.options.intervalMs);
        }
      }
    })();
    await this.running;
  }
}

export type InMemoryJobQueueOptions = {
  readonly concurrency?: number;
  readonly idFactory?: () => string;
  readonly now?: () => number;
  readonly onEvent?: JobObserver;
};

type QueuedJob = {
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

export class InMemoryJobQueue implements JobQueue {
  private readonly concurrency: number;
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private readonly onEvent: JobObserver | undefined;
  private readonly pending: QueuedJob[] = [];
  private readonly deduplicated = new Map<string, JobReceipt>();
  private readonly dead = new Map<string, DeadLetter>();
  private readonly idleWaiters: Array<() => void> = [];
  private readonly runningJobs = new Map<string, QueuedJob>();
  private readonly controllers = new Map<string, AbortController>();
  private running = 0;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pumping = false;
  private accepting = true;
  private cancelled = false;
  private closing: Promise<void> | undefined;

  constructor(options: InMemoryJobQueueOptions = {}) {
    this.concurrency = options.concurrency ?? 1;
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.now = options.now ?? Date.now;
    this.onEvent = options.onEvent;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) {
      throw new Error("InMemoryJobQueue concurrency must be a positive integer");
    }
  }

  async dispatch<TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    options: JobOptions = {},
  ): Promise<JobReceipt> {
    if (!this.accepting) throw new Error("job queue has already been closed");
    validateJob(job, options);

    if (options.deduplicationKey) {
      const existing = this.deduplicated.get(`${job.name}:${options.deduplicationKey}`);
      if (existing) return existing;
    }

    const receipt = Object.freeze({ id: options.id ?? this.idFactory(), name: job.name });
    const queued: QueuedJob = {
      id: receipt.id,
      definition: job as unknown as JobDefinition<unknown>,
      payload,
      priority: options.priority ?? 0,
      maxAttempts: options.maxAttempts ?? 1,
      backoffMs: options.backoffMs ?? exponentialBackoff(),
      timeoutMs: options.timeoutMs,
      deduplicationKey: options.deduplicationKey,
      sequence: this.sequence++,
      readyAt: this.now() + (options.delayMs ?? 0),
      attempt: 0,
      cancelled: false,
    };

    this.pending.push(queued);
    this.observe({ operation: "dispatch", id: receipt.id, name: job.name });
    if (queued.deduplicationKey) {
      this.deduplicated.set(`${job.name}:${queued.deduplicationKey}`, receipt);
    }
    this.pump();
    return receipt;
  }

  awaitIdle(): Promise<void> {
    if (this.pending.length === 0 && this.running === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  cancel(id: string): boolean {
    const pendingIndex = this.pending.findIndex((job) => job.id === id);
    if (pendingIndex >= 0) {
      const job = this.pending.splice(pendingIndex, 1)[0];
      if (job) {
        job.cancelled = true;
        this.clearDeduplication(job);
        this.observe({ operation: "cancel", id: job.id, name: job.definition.name });
      }
      this.armTimer();
      this.resolveIdleWaiters();
      return true;
    }

    const running = this.runningJobs.get(id);
    if (!running) return false;
    running.cancelled = true;
    this.controllers.get(id)?.abort();
    this.observe({ operation: "cancel", id: running.id, name: running.definition.name });
    return true;
  }

  async close(options: { readonly drain?: boolean } = {}) {
    if (this.closing) return this.closing;
    this.accepting = false;
    this.closing = (async () => {
      if (options.drain ?? true) {
        this.pump();
        await this.awaitIdle();
      } else {
        this.cancelled = true;
        for (const job of this.pending) {
          job.cancelled = true;
          this.clearDeduplication(job);
        }
        this.pending.length = 0;
        for (const job of this.runningJobs.values()) {
          job.cancelled = true;
          this.controllers.get(job.id)?.abort();
        }
        this.clearTimer();
        this.resolveIdleWaiters();
      }
    })();
    return this.closing;
  }

  /** Allows the queue to be registered as a Starpod singleton provider. */
  async dispose() {
    await this.close({ drain: true });
  }

  deadLetters(): readonly DeadLetter[] {
    return Object.freeze([...this.dead.values()]);
  }

  clearDeadLetters() {
    this.dead.clear();
  }

  private pump() {
    if (this.pumping || this.cancelled) return;
    this.pumping = true;
    try {
      while (this.running < this.concurrency) {
        const next = this.takeReady();
        if (!next) break;
        this.running += 1;
        void this.execute(next);
      }
    } finally {
      this.pumping = false;
      this.armTimer();
      this.resolveIdleWaiters();
    }
  }

  private takeReady(): QueuedJob | undefined {
    const now = this.now();
    let selectedIndex = -1;
    for (let index = 0; index < this.pending.length; index += 1) {
      const candidate = this.pending[index];
      if (!candidate || candidate.readyAt > now) continue;
      const selected = selectedIndex === -1 ? undefined : this.pending[selectedIndex];
      if (
        !selected ||
        candidate.priority > selected.priority ||
        (candidate.priority === selected.priority && candidate.sequence < selected.sequence)
      ) {
        selectedIndex = index;
      }
    }
    return selectedIndex === -1 ? undefined : this.pending.splice(selectedIndex, 1)[0];
  }

  private async execute(job: QueuedJob) {
    job.attempt += 1;
    const controller = new AbortController();
    this.runningJobs.set(job.id, job);
    this.controllers.set(job.id, controller);
    this.observe({ operation: "start", id: job.id, name: job.definition.name, attempt: job.attempt });
    let completed = false;
    try {
      await this.runWithTimeout(job, controller);
      completed = true;
      this.observe({ operation: "success", id: job.id, name: job.definition.name, attempt: job.attempt });
    } catch (error) {
      if (job.cancelled || this.cancelled) {
        // Cancellation is a control decision, not a failed delivery.
      } else if (job.attempt < job.maxAttempts) {
        const delay = job.backoffMs(job.attempt + 1);
        if (!Number.isFinite(delay) || delay < 0) {
          this.recordDeadLetter(job, new Error("job backoff must be a finite non-negative number"));
        } else {
          job.readyAt = this.now() + delay;
          this.pending.push(job);
          this.observe({
            operation: "retry",
            id: job.id,
            name: job.definition.name,
            attempt: job.attempt,
            delayMs: delay,
          });
        }
      } else {
        this.recordDeadLetter(job, error);
      }
    } finally {
      this.runningJobs.delete(job.id);
      this.controllers.delete(job.id);
      if (completed && job.deduplicationKey) {
        this.deduplicated.delete(`${job.definition.name}:${job.deduplicationKey}`);
      }
      if (job.cancelled || this.cancelled) this.clearDeduplication(job);
      this.running -= 1;
      this.pump();
    }
  }

  private async runWithTimeout(job: QueuedJob, controller: AbortController) {
    const context: JobContext = {
      id: job.id,
      name: job.definition.name,
      attempt: job.attempt,
      signal: controller.signal,
    };
    const work = Promise.resolve(job.definition.handle(job.payload, context));
    if (job.timeoutMs === undefined) {
      await work;
      return;
    }

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

  private recordDeadLetter(job: QueuedJob, error: unknown) {
    this.dead.set(job.id, Object.freeze({
      id: job.id,
      name: job.definition.name,
      payload: job.payload,
      attempts: job.attempt,
      error,
    }));
    this.observe({
      operation: "dead-letter",
      id: job.id,
      name: job.definition.name,
      attempts: job.attempt,
    });
    if (job.deduplicationKey) this.deduplicated.delete(`${job.definition.name}:${job.deduplicationKey}`);
  }

  private observe(event: JobEvent) {
    try {
      this.onEvent?.(event);
    } catch {
      // Observability must not change delivery semantics.
    }
  }

  private clearDeduplication(job: QueuedJob) {
    if (job.deduplicationKey) {
      this.deduplicated.delete(job.definition.name + ":" + job.deduplicationKey);
    }
  }

  private armTimer() {
    this.clearTimer();
    const next = this.pending.reduce<number | undefined>((soonest, job) =>
      soonest === undefined || job.readyAt < soonest ? job.readyAt : soonest,
    undefined);
    if (next === undefined || this.cancelled) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pump();
    }, Math.max(0, next - this.now()));
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private resolveIdleWaiters() {
    if (this.pending.length > 0 || this.running > 0) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

export function exponentialBackoff(baseMs = 100, maxMs = 30_000) {
  if (!Number.isFinite(baseMs) || baseMs < 0) throw new Error("backoff baseMs must be non-negative");
  if (!Number.isFinite(maxMs) || maxMs < baseMs) throw new Error("backoff maxMs must be at least baseMs");
  return (attempt: number) => Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 2));
}

function validateJob<TPayload>(job: JobDefinition<TPayload>, options: JobOptions) {
  if (!job.name || !/^[a-z][a-z0-9._-]*$/.test(job.name)) {
    throw new Error(`job name must start with a lowercase letter: ${job.name}`);
  }
  if (options.delayMs !== undefined && (!Number.isFinite(options.delayMs) || options.delayMs < 0)) {
    throw new Error("job delayMs must be a finite non-negative number");
  }
  if (options.maxAttempts !== undefined && (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1)) {
    throw new Error("job maxAttempts must be a positive integer");
  }
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error("job timeoutMs must be a positive number");
  }
}

function validateSchedule(options: ScheduleOptions) {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error("schedule intervalMs must be a positive number");
  }
  if (options.initialDelayMs !== undefined &&
    (!Number.isFinite(options.initialDelayMs) || options.initialDelayMs < 0)) {
    throw new Error("schedule initialDelayMs must be a finite non-negative number");
  }
}

function validateJobName(name: string) {
  if (!name || !/^[a-z][a-z0-9._-]*$/.test(name)) {
    throw new Error("job name must start with a lowercase letter: " + name);
  }
}

function toWireOptions(options: JobOptions): JobWireOptions {
  return {
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }),
    ...(options.priority === undefined ? {} : { priority: options.priority }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.deduplicationKey === undefined ? {} : { deduplicationKey: options.deduplicationKey }),
  };
}
