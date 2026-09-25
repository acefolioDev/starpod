import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/kernel/events/events";

describe("EventBus operation telemetry", () => {
  test("creates event spans and metrics without changing delivery", async () => {
    const spans: string[] = [];
    const metrics: string[] = [];
    const bus = new EventBus<{ created: { readonly id: string } }>({
      tracer: {
        startSpan(name, attributes) {
          spans.push(`${name}:${attributes?.["event.name"]}`);
          return { setAttribute() {}, recordException() {}, setStatus() {}, end() {} };
        },
      },
      metrics: {
        increment(name, _value, labels) { metrics.push(`${name}:${labels?.outcome}`); },
        observe() {},
      },
    });
    bus.on("created", () => undefined);

    await bus.emit("created", { id: "user-1" });

    expect(spans).toEqual(["events.emit:created"]);
    expect(metrics).toContain("events.emit.operations:success");
  });
});
