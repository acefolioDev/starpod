import type { JobDefinition, JobOptions, JobQueue } from "./contracts";

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
function validateSchedule(options: ScheduleOptions) {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error("schedule intervalMs must be a positive number");
  }
  if (options.initialDelayMs !== undefined &&
    (!Number.isFinite(options.initialDelayMs) || options.initialDelayMs < 0)) {
    throw new Error("schedule initialDelayMs must be a finite non-negative number");
  }
}
