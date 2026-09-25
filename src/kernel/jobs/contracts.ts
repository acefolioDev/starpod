import { assertJsonValue, type JsonValue } from "../serialization/wire";
import { validateTenantId } from "../security/tenant-id";
import type { JobProgress } from "./progress";

export type JobContext = {
  readonly id: string;
  readonly name: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly tenantId?: string;
  readonly reportProgress: (progress: JobProgress) => void;
};

export type JobPayloadValue = JsonValue;

export type JobCodec<TPayload> = {
  readonly encode: (payload: TPayload) => JobPayloadValue;
  readonly decode: (value: JobPayloadValue) => TPayload;
};

export type JobWireOptions = {
  readonly id?: string;
  readonly tenantId?: string;
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
  readonly tenantId?: string;
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
  | { readonly operation: "progress"; readonly id: string; readonly name: string; readonly attempt: number; readonly completed: number; readonly total?: number }
  | { readonly operation: "retry"; readonly id: string; readonly name: string; readonly attempt: number; readonly delayMs: number }
  | { readonly operation: "dead-letter"; readonly id: string; readonly name: string; readonly attempts: number }
  | { readonly operation: "cancel"; readonly id: string; readonly name: string };

export type JobObserver = (event: JobEvent) => void;

export type DeadLetter = {
  readonly id: string;
  readonly name: string;
  readonly tenantId?: string;
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

/** Transport boundary for a durable queue or broker. */
export type JobEnvelopePublisher = {
  publish(envelope: JobEnvelope): Promise<JobReceipt>;
};

export type DurableJobDispatcherOptions = {
  readonly onEvent?: JobObserver;
};

/**
 * Encode typed jobs before handing them to an application-owned durable
 * transport. Handler closures never cross this boundary; workers resolve the
 * name through JobRegistry and decode the persisted payload.
 */
export class DurableJobDispatcher {
  constructor(
    private readonly publisher: JobEnvelopePublisher,
    private readonly options: DurableJobDispatcherOptions = {},
  ) {}

  async dispatch<TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    options: JobOptions = {},
  ): Promise<JobReceipt> {
    const envelope = encodeJob(job, payload, options);
    const receipt = await this.publisher.publish(envelope);
    if (!receipt || receipt.name !== envelope.name || !receipt.id) {
      throw new Error(`durable publisher returned an invalid receipt for job "${envelope.name}"`);
    }
    try {
      this.options.onEvent?.({ operation: "dispatch", id: receipt.id, name: receipt.name });
    } catch {
      // Durable job telemetry must not change publisher correctness.
    }
    return receipt;
  }
}

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

export function exponentialBackoff(baseMs = 100, maxMs = 30_000) {
  if (!Number.isFinite(baseMs) || baseMs < 0) throw new Error("backoff baseMs must be non-negative");
  if (!Number.isFinite(maxMs) || maxMs < baseMs) throw new Error("backoff maxMs must be at least baseMs");
  return (attempt: number) => Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 2));
}

export function validateJob<TPayload>(job: JobDefinition<TPayload>, options: JobOptions) {
  if (!job.name || !/^[a-z][a-z0-9._-]*$/.test(job.name)) {
    throw new Error(`job name must start with a lowercase letter: ${job.name}`);
  }
  if (options.id !== undefined) validateJobId(options.id);
  if (options.tenantId !== undefined) validateTenantId(options.tenantId);
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

export function validateJobName(name: string) {
  if (!name || !/^[a-z][a-z0-9._-]*$/.test(name)) {
    throw new Error("job name must start with a lowercase letter: " + name);
  }
}

export function validateJobId(id: string) {
  if (!id || id.length > 256 || id.includes("\n") || id.includes("\r")) {
    throw new Error("job id must be a non-empty single-line string of at most 256 characters");
  }
}

export function jobDeduplicationKey(name: string, tenantId: string | undefined, key: string) {
  validateJobName(name);
  validateTenantId(tenantId ?? "anonymous", "job tenant id");
  validateJobId(key);
  return [name, tenantId ?? "anonymous", key].map(encodeURIComponent).join(":");
}

function toWireOptions(options: JobOptions): JobWireOptions {
  return {
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
    ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }),
    ...(options.priority === undefined ? {} : { priority: options.priority }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.deduplicationKey === undefined ? {} : { deduplicationKey: options.deduplicationKey }),
  };
}
