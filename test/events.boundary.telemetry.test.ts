import { describe, expect, test } from "bun:test";
import { EventDispatcher, EventRegistry } from "../src/kernel/events/events";
import { EventOutbox, type EventOutboxStore } from "../src/kernel/events/outbox";

type Events = { created: { readonly secret: string } };

const telemetry = (spans: string[], metrics: string[]) => ({
  tracer: {
    startSpan(name: string, attributes?: Readonly<Record<string, string | number | boolean | undefined>>) {
      spans.push(`${name}:${attributes?.["event.name"] ?? ""}`);
      return { setAttribute() {}, recordException() {}, setStatus() {}, end() {} };
    },
  },
  metrics: {
    increment(name: string, _value?: number, labels?: Readonly<Record<string, string | number | boolean>>) {
      metrics.push(`${name}:${labels?.outcome}`);
    },
    observe() {},
  },
});

describe("durable event operation telemetry", () => {
  test("traces dispatch without exposing payloads", async () => {
    const spans: string[] = [];
    const metrics: string[] = [];
    const registry = new EventRegistry<Events>();
    registry.register("created", { encode: (payload) => payload, decode: (payload) => payload as Events["created"] });
    const dispatcher = new EventDispatcher(registry, { publish: async () => undefined }, telemetry(spans, metrics));

    await dispatcher.emit("created", { secret: "hidden" });

    expect(spans).toEqual(["events.dispatch:created"]);
    expect(metrics).toContain("events.dispatch.operations:success");
    expect(JSON.stringify(spans)).not.toContain("hidden");
  });

  test("traces outbox enqueue and publication", async () => {
    const spans: string[] = [];
    const metrics: string[] = [];
    const records: unknown[] = [];
    const store: EventOutboxStore = {
      append: async (record) => { records.push(record); },
      claim: async () => [],
      markPublished: async () => undefined,
      markFailed: async () => undefined,
    };
    const registry = new EventRegistry<Events>();
    registry.register("created", { encode: (payload) => payload, decode: (payload) => payload as Events["created"] });
    const outbox = new EventOutbox(registry, store, { publish: async () => undefined }, telemetry(spans, metrics));

    await outbox.enqueue("created", { secret: "hidden" });
    await outbox.publishPending();

    expect(records).toHaveLength(1);
    expect(spans).toEqual(["events.outbox.enqueue:created", "events.outbox.publish:"]);
    expect(metrics).toContain("events.outbox.enqueue.operations:success");
    expect(metrics).toContain("events.outbox.publish.operations:success");
  });
});
