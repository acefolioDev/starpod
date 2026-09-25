import type { JobDefinition, JobOptions, JobQueue } from "./contracts";
import { observeOperation, type OperationTelemetry } from "../observability/operation";

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

export type InMemorySchedulerOptions = OperationTelemetry & {
  readonly onError?: (error: unknown) => void | Promise<void>;
  readonly onEvent?: (event: SchedulerEvent) => void;
  readonly now?: () => number;
};

export type SchedulerEvent =
  | { readonly operation: "schedule" | "start" | "cancel"; readonly name: string }
  | { readonly operation: "success" | "failure"; readonly name: string; readonly durationMs: number };

/** Fixed-delay in-process scheduling over a typed JobQueue. */
export class InMemoryScheduler {
  private readonly tasks = new Set<InMemoryScheduledTask>();
  private readonly onError: ((error: unknown) => void | Promise<void>) | undefined;
  private readonly onEvent: ((event: SchedulerEvent) => void) | undefined;
  private readonly now: () => number;
  private readonly telemetry: OperationTelemetry;
  private disposed = false;

  constructor(
    private readonly queue: JobQueue,
    options: InMemorySchedulerOptions = {},
  ) {
    this.onError = options.onError;
    this.onEvent = options.onEvent;
    this.now = options.now ?? (() => performance.now());
    this.telemetry = options;
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
      job.name,
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
      (event) => this.observe(event),
      () => this.now(),
      this.telemetry,
    );
    this.tasks.add(task);
    this.observe({ operation: "schedule", name: job.name });
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

  private observe(event: SchedulerEvent) {
    try {
      this.onEvent?.(event);
    } catch {
      // Scheduler telemetry must not terminate the scheduling loop.
    }
  }
}

class InMemoryScheduledTask implements ScheduledTask {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private cancelled = false;

  constructor(
    private readonly name: string,
    private readonly run: () => Promise<void>,
    private readonly options: ScheduleOptions,
    private readonly onError: (error: unknown) => Promise<void>,
    private readonly onComplete: () => void,
    private readonly onEvent: (event: SchedulerEvent) => void,
    private readonly now: () => number,
    private readonly telemetry: OperationTelemetry,
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
    this.onEvent({ operation: "cancel", name: this.name });
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
    const startedAt = this.now();
    this.onEvent({ operation: "start", name: this.name });
    this.running = (async () => {
      try {
        await observeOperation(this.telemetry, "jobs.scheduler", () => this.run(), {
          "job.name": this.name,
        });
        this.onEvent({ operation: "success", name: this.name, durationMs: this.duration(startedAt) });
      } catch (error) {
        this.onEvent({ operation: "failure", name: this.name, durationMs: this.duration(startedAt) });
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

  private duration(startedAt: number) {
    return Math.max(0, Math.round((this.now() - startedAt) * 100) / 100);
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
