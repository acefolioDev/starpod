import {
  decodeJob,
  validateJobId,
  validateJobName,
  type JobContext,
  type JobEvent,
  type JobObserver,
  type JobRegistry,
} from "./contracts";
import { assertJsonValue } from "../serialization/wire";
import { emitJobProgress } from "./progress";

export type JobDelivery = {
  readonly id: string;
  readonly name: string;
  readonly payload: import("../serialization/wire").JsonValue;
  readonly attempt?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

export type JobWorkerOptions = {
  readonly onEvent?: JobObserver;
};

/** Execute serialized job deliveries without coupling Starpod to a broker. */
export class JobWorker {
  constructor(
    private readonly registry: JobRegistry,
    private readonly options: JobWorkerOptions = {},
  ) {}

  async run(delivery: JobDelivery): Promise<void> {
    validateDelivery(delivery);
    const job = this.registry.resolve(delivery.name);
    assertJsonValue(delivery.payload, "job payload");
    const payload = decodeJob(job, delivery.payload);
    const attempt = delivery.attempt ?? 1;
    const controller = new AbortController();
    const removeSignal = linkSignal(delivery.signal, controller);
    const context: JobContext = {
      id: delivery.id,
      name: delivery.name,
      attempt,
      signal: controller.signal,
      reportProgress: (progress) => emitJobProgress(
        this.options.onEvent,
        delivery.id,
        delivery.name,
        attempt,
        progress,
      ),
    };

    this.observe({ operation: "start", id: delivery.id, name: delivery.name, attempt });
    try {
      await runWithTimeout(job.handle(payload, context), controller, delivery.timeoutMs);
      this.observe({ operation: "success", id: delivery.id, name: delivery.name, attempt });
    } finally {
      removeSignal();
    }
  }

  private observe(event: JobEvent) {
    try {
      this.options.onEvent?.(event);
    } catch {
      // Worker telemetry must not change delivery semantics.
    }
  }
}

function validateDelivery(delivery: JobDelivery) {
  validateJobId(delivery.id);
  validateJobName(delivery.name);
  if (delivery.attempt !== undefined && (!Number.isInteger(delivery.attempt) || delivery.attempt < 1)) {
    throw new Error("job delivery attempt must be a positive integer");
  }
  if (delivery.timeoutMs !== undefined && (!Number.isFinite(delivery.timeoutMs) || delivery.timeoutMs <= 0)) {
    throw new Error("job delivery timeoutMs must be a positive number");
  }
}

async function runWithTimeout(
  work: void | Promise<void>,
  controller: AbortController,
  timeoutMs: number | undefined,
) {
  const pending = Promise.resolve(work);
  if (timeoutMs === undefined) return await pending;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`job timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function linkSignal(signal: AbortSignal | undefined, controller: AbortController) {
  if (!signal) return () => undefined;
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}
