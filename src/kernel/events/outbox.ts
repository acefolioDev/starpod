import type { EventEnvelope, EventEnvelopePublisher, EventMap, EventRegistry } from "./events";
import { validateTenantId } from "../security/tenant-id";
import { observeOperation, type OperationTelemetry } from "../observability/operation";

export type OutboxRecord = {
  readonly id: string;
  readonly envelope: EventEnvelope;
  readonly createdAt: number;
  /** The attempt number assigned by the store when it claims the record. */
  readonly attempts: number;
};

export type EventOutboxStore<TTransaction = unknown> = {
  /** Must participate in the caller's transaction when one is supplied. */
  append(record: OutboxRecord, transaction?: TTransaction): void | Promise<void>;
  /** Must atomically claim records and make them invisible to competing workers. */
  claim(limit: number, now: number): readonly OutboxRecord[] | Promise<readonly OutboxRecord[]>;
  markPublished(id: string, publishedAt: number): void | Promise<void>;
  markFailed(id: string, nextAttemptAt: number): void | Promise<void>;
};

export type EventOutboxEvent =
  | { readonly operation: "enqueue" | "published" | "failed"; readonly id: string; readonly name: string; readonly attempt?: number };

export type EventOutboxOptions = OperationTelemetry & {
  readonly idFactory?: () => string;
  readonly now?: () => number;
  readonly retryDelayMs?: (attempt: number) => number;
  readonly onEvent?: (event: EventOutboxEvent) => void;
};

export type OutboxPublishReport = {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
};

/** Coordinates transactional event records without owning persistence or broker semantics. */
export class EventOutbox<TEvents extends EventMap, TTransaction = unknown> {
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private readonly retryDelayMs: (attempt: number) => number;

  constructor(
    private readonly registry: EventRegistry<TEvents>,
    private readonly store: EventOutboxStore<TTransaction>,
    private readonly publisher: EventEnvelopePublisher,
    private readonly options: EventOutboxOptions = {},
  ) {
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.now = options.now ?? Date.now;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelay;
  }

  async enqueue<TKey extends keyof TEvents & string>(
    name: TKey,
    payload: TEvents[TKey],
    options: { readonly transaction?: TTransaction; readonly tenantId?: string } = {},
  ): Promise<OutboxRecord> {
    return observeOperation(this.options, "events.outbox.enqueue", async () => {
      if (options.tenantId !== undefined) validateTenantId(options.tenantId);
      const id = validateId(this.idFactory());
      const envelope = Object.freeze({
        ...this.registry.encode(name, payload),
        id,
        ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
      });
      const record = Object.freeze({
        id,
        envelope,
        createdAt: this.now(),
        attempts: 0,
      });
      await this.store.append(record, options.transaction);
      this.observe({ operation: "enqueue", id: record.id, name });
      return record;
    }, { "event.name": String(name) });
  }

  async publishPending(limit = 100): Promise<OutboxPublishReport> {
    return observeOperation(this.options, "events.outbox.publish", async () => {
      if (!Number.isInteger(limit) || limit < 1) throw new Error("outbox limit must be a positive integer");
      const records = await this.store.claim(limit, this.now());
      let published = 0;
      let failed = 0;
      for (const record of records) {
        try {
          await this.publisher.publish(record.envelope);
        } catch (error) {
          const delay = this.retryDelay(record.attempts + 1);
          if (!Number.isFinite(delay) || delay < 0) throw new Error("outbox retry delay must be finite and non-negative", { cause: error });
          await this.store.markFailed(record.id, this.now() + delay);
          failed += 1;
          this.observe({ operation: "failed", id: record.id, name: record.envelope.name, attempt: record.attempts });
          continue;
        }
        // If acknowledgement fails after publish, do not mark the event failed:
        // the store's lease recovery may deliver it again and the consumer must be idempotent.
        await this.store.markPublished(record.id, this.now());
        published += 1;
        this.observe({ operation: "published", id: record.id, name: record.envelope.name, attempt: record.attempts });
      }
      return Object.freeze({ claimed: records.length, published, failed });
    });
  }

  private retryDelay(attempt: number) {
    try {
      return this.retryDelayMs(attempt);
    } catch (error) {
      throw new Error("outbox retry delay failed", { cause: error });
    }
  }

  private observe(event: EventOutboxEvent) {
    try {
      this.options.onEvent?.(event);
    } catch {
      // Outbox telemetry must not change persistence or publishing semantics.
    }
  }
}

function defaultRetryDelay(attempt: number) {
  return Math.min(30_000, 100 * 2 ** Math.max(0, attempt - 1));
}

function validateId(value: string) {
  if (!value || value.length > 256 || /[\r\n]/.test(value)) {
    throw new Error("outbox id must be a non-empty single-line string of at most 256 characters");
  }
  return value;
}
