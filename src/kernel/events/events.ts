import { assertJsonValue, type JsonValue } from "../serialization/wire";

export type EventMap = Record<string, unknown>;

export type EventHandler<TPayload> = (payload: TPayload) => void | Promise<void>;

export type EventBusEvent =
  | { readonly operation: "emit"; readonly name: string; readonly handlers: number }
  | { readonly operation: "handler-success"; readonly name: string; readonly handlerIndex: number }
  | { readonly operation: "handler-failure"; readonly name: string; readonly handlerIndex: number }
  | { readonly operation: "complete"; readonly name: string; readonly handlers: number; readonly failures: number };

export type EventBusObserver = (event: EventBusEvent) => void;

export type EventBusOptions = {
  readonly onEvent?: EventBusObserver;
};

export type EventCodec<TPayload> = {
  readonly version?: string;
  readonly encode: (payload: TPayload) => JsonValue;
  readonly decode: (value: JsonValue) => TPayload;
};

export type EventEnvelope = {
  readonly name: string;
  readonly version?: string;
  readonly payload: JsonValue;
};

export type EventSubscription = {
  unsubscribe(): void;
};

export type EventEnvelopePublisher = {
  publish(envelope: EventEnvelope): Promise<void>;
};

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
  ) {}

  async emit<TKey extends keyof TEvents & string>(name: TKey, payload: TEvents[TKey]) {
    await this.publisher.publish(this.registry.encode(name, payload));
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

export class EventBus<TEvents extends EventMap> {
  private readonly handlers = new Map<keyof TEvents, Set<EventHandler<unknown>>>();
  private readonly onEvent: EventBusObserver | undefined;

  constructor(options: EventBusOptions = {}) {
    this.onEvent = options.onEvent;
  }

  on<TKey extends keyof TEvents & string>(
    name: TKey,
    handler: EventHandler<TEvents[TKey]>,
  ): EventSubscription {
    const handlers = this.handlers.get(name) ?? new Set<EventHandler<unknown>>();
    handlers.add(handler as EventHandler<unknown>);
    this.handlers.set(name, handlers);

    return {
      unsubscribe: () => {
        handlers.delete(handler as EventHandler<unknown>);
        if (handlers.size === 0) this.handlers.delete(name);
      },
    };
  }

  async emit<TKey extends keyof TEvents & string>(name: TKey, payload: TEvents[TKey]) {
    const handlers = [...(this.handlers.get(name) ?? [])];
    const failures: unknown[] = [];
    this.observe({ operation: "emit", name, handlers: handlers.length });

    for (const [handlerIndex, handler] of handlers.entries()) {
      try {
        await handler(payload);
        this.observe({ operation: "handler-success", name, handlerIndex });
      } catch (error) {
        failures.push(error);
        this.observe({ operation: "handler-failure", name, handlerIndex });
      }
    }

    this.observe({ operation: "complete", name, handlers: handlers.length, failures: failures.length });

    if (failures.length > 0) {
      throw new AggregateError(failures, `event delivery failed: ${name}`);
    }
  }

  clear() {
    this.handlers.clear();
  }

  private observe(event: EventBusEvent) {
    try {
      this.onEvent?.(event);
    } catch {
      // Event telemetry must not alter delivery semantics.
    }
  }
}
