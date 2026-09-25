import { assertJsonValue, type JsonValue } from "../serialization/wire";
import { validateTenantId } from "../security/tenant-id";
import { eventIdempotencyKey } from "./idempotency";
import { observeOperation, type OperationTelemetry } from "../observability/operation";
import type { EventBus } from "./bus";
export { EventBus } from "./bus";
export type { EventBusOptions } from "./bus";
export type EventMap = Record<string, unknown>;

export type EventContext = {
  readonly id?: string;
  readonly name: string;
  readonly version?: string;
  readonly tenantId?: string;
};

export type EventHandler<TPayload> = (payload: TPayload, context?: EventContext) => void | Promise<void>;

export type EventBusEvent =
  | { readonly operation: "emit"; readonly name: string; readonly handlers: number }
  | { readonly operation: "handler-success"; readonly name: string; readonly handlerIndex: number }
  | { readonly operation: "handler-failure"; readonly name: string; readonly handlerIndex: number }
  | { readonly operation: "complete"; readonly name: string; readonly handlers: number; readonly failures: number };

export type EventBusObserver = (event: EventBusEvent) => void;

export type EventCodec<TPayload> = {
  readonly version?: string;
  readonly encode: (payload: TPayload) => JsonValue;
  readonly decode: (value: JsonValue) => TPayload;
};

export type EventEnvelope = {
  readonly id?: string;
  readonly name: string;
  readonly version?: string;
  readonly tenantId?: string;
  readonly payload: JsonValue;
};

/** Atomic duplicate-delivery boundary for a durable event consumer. */
export type EventIdempotencyStore = {
  /** Run only once for an ID; failed work must remain eligible for retry. */
  runOnce(id: string, work: () => Promise<void>): void | Promise<void>;
};

export type EventSubscription = {
  unsubscribe(): void;
};

export type EventEnvelopePublisher = {
  publish(envelope: EventEnvelope): Promise<void>;
};

export type EventDispatcherOptions = OperationTelemetry;

/** Typed event codecs and envelopes for a broker or persisted event transport. */
export class EventRegistry<TEvents extends EventMap> {
  private readonly codecs = new Map<keyof TEvents & string, EventCodec<unknown>>();

  register<TKey extends keyof TEvents & string>(
    name: TKey,
    codec: EventCodec<TEvents[TKey]>,
  ): EventSubscription {
    validateEventName(name);
    validateEventVersion(codec.version);
    if (this.codecs.has(name)) throw new Error("event \"" + name + "\" is already registered");
    this.codecs.set(name, codec as EventCodec<unknown>);
    return {
      unsubscribe: () => this.codecs.delete(name),
    };
  }

  encode<TKey extends keyof TEvents & string>(
    name: TKey,
    payload: TEvents[TKey],
  ): EventEnvelope {
    const codec = this.require(name);
    const encoded = codec.encode(payload);
    assertJsonValue(encoded, "event payload");
    return Object.freeze({
      name,
      ...(codec.version === undefined ? {} : { version: codec.version }),
      payload: encoded,
    });
  }

  decode<TKey extends keyof TEvents & string>(
    name: TKey,
    payload: JsonValue,
    version?: string,
  ): TEvents[TKey] {
    const codec = this.require(name);
    if (version !== undefined && codec.version !== version) {
      throw new Error(
        "event \"" + name + "\" version mismatch (received " + version +
        ", expected " + (codec.version ?? "unversioned") + ")",
      );
    }
    return codec.decode(payload) as TEvents[TKey];
  }

  names(): readonly (keyof TEvents & string)[] {
    return Object.freeze([...this.codecs.keys()].sort() as (keyof TEvents & string)[]);
  }

  private require<TKey extends keyof TEvents & string>(name: TKey) {
    const codec = this.codecs.get(name);
    if (!codec) {
      const available = [...this.codecs.keys()].sort().join(", ") || "none";
      throw new Error("event \"" + name + "\" has no codec (registered events: " + available + ")");
    }
    return codec;
  }
}

/** Publish versioned, encoded events through an application-owned transport. */
export class EventDispatcher<TEvents extends EventMap> {
  constructor(
    private readonly registry: EventRegistry<TEvents>,
    private readonly publisher: EventEnvelopePublisher,
    private readonly options: EventDispatcherOptions = {},
  ) {}

  async emit<TKey extends keyof TEvents & string>(
    name: TKey,
    payload: TEvents[TKey],
    options: { readonly tenantId?: string } = {},
  ) {
    validateEventName(name);
    return observeOperation(this.options, "events.dispatch", async () => {
      if (options.tenantId !== undefined) validateTenantId(options.tenantId);
      const envelope = this.registry.encode(name, payload);
      await this.publisher.publish(Object.freeze({
        ...envelope,
        ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
      }));
    }, { "event.name": String(name) });
  }
}

/** Decode broker-delivered envelopes and pass them through typed handlers. */
export class EventConsumer<TEvents extends EventMap> {
  constructor(
    private readonly registry: EventRegistry<TEvents>,
    private readonly bus: EventBus<TEvents>,
    private readonly options: { readonly idempotency?: EventIdempotencyStore } = {},
  ) {}

  async consume(envelope: EventEnvelope): Promise<void> {
    if (envelope.id !== undefined) validateEventId(envelope.id);
    if (envelope.tenantId !== undefined) validateTenantId(envelope.tenantId);
    const name = envelope.name as keyof TEvents & string;
    const context: EventContext = {
      name,
      ...(envelope.id === undefined ? {} : { id: envelope.id }),
      ...(envelope.version === undefined ? {} : { version: envelope.version }),
      ...(envelope.tenantId === undefined ? {} : { tenantId: envelope.tenantId }),
    };
    const deliver = () => {
      assertJsonValue(envelope.payload, "event payload");
      const payload = this.registry.decode(name, envelope.payload, envelope.version);
      return this.bus.emit(name, payload, context);
    };
    const idempotencyKey = envelope.id === undefined
      ? undefined
      : eventIdempotencyKey(envelope.id, envelope.tenantId);
    if (idempotencyKey !== undefined && this.options.idempotency) {
      await this.options.idempotency.runOnce(idempotencyKey, deliver);
    } else {
      await deliver();
    }
  }
}

function validateEventName(name: string) {
  if (!name || name.length > 128 || name.includes("\n") || name.includes("\r")) {
    throw new Error("event name must be a non-empty single-line string of at most 128 characters");
  }
}

function validateEventVersion(version: string | undefined) {
  if (version !== undefined &&
    (!version || version.length > 32 || !/^[A-Za-z0-9._-]+$/.test(version))) {
    throw new Error("event version must contain only letters, numbers, dots, underscores, or hyphens");
  }
}

function validateEventId(id: string) {
  if (!id || id.length > 256 || /[\r\n]/.test(id)) {
    throw new Error("event id must be a non-empty single-line string of at most 256 characters");
  }
}
