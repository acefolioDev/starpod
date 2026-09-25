import { observeOperation, type OperationTelemetry } from "../observability/operation";
import type {
  EventBusEvent,
  EventBusObserver,
  EventContext,
  EventHandler,
  EventMap,
  EventSubscription,
} from "./events";

export type EventBusOptions = OperationTelemetry & {
  readonly onEvent?: EventBusObserver;
};

/** Typed in-process event delivery with ordered handlers and isolated telemetry. */
export class EventBus<TEvents extends EventMap> {
  private readonly handlers = new Map<keyof TEvents, Set<EventHandler<unknown>>>();
  private readonly onEvent: EventBusObserver | undefined;
  private readonly telemetry: OperationTelemetry;

  constructor(options: EventBusOptions = {}) {
    this.onEvent = options.onEvent;
    this.telemetry = options;
  }

  on<TKey extends keyof TEvents & string>(name: TKey, handler: EventHandler<TEvents[TKey]>): EventSubscription {
    validateEventName(name);
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

  async emit<TKey extends keyof TEvents & string>(name: TKey, payload: TEvents[TKey], context?: EventContext) {
    validateEventName(name);
    return observeOperation(this.telemetry, "events.emit", async () => {
      const handlers = [...(this.handlers.get(name) ?? [])];
      const failures: unknown[] = [];
      this.observe({ operation: "emit", name, handlers: handlers.length });
      for (const [handlerIndex, handler] of handlers.entries()) {
        try {
          await handler(payload, context);
          this.observe({ operation: "handler-success", name, handlerIndex });
        } catch (error) {
          failures.push(error);
          this.observe({ operation: "handler-failure", name, handlerIndex });
        }
      }
      this.observe({ operation: "complete", name, handlers: handlers.length, failures: failures.length });
      if (failures.length > 0) throw new AggregateError(failures, `event delivery failed: ${name}`);
    }, { "event.name": String(name) });
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

function validateEventName(name: string) {
  if (!name || name.length > 128 || /[\r\n]/.test(name)) {
    throw new Error("event name must be a non-empty single-line string of at most 128 characters");
  }
}
