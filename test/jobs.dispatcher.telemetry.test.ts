import { describe, expect, test } from "bun:test";
import { DurableJobDispatcher } from "../src/kernel/jobs/dispatcher";

describe("DurableJobDispatcher operation telemetry", () => {
  test("creates a safe dispatch span and metric", async () => {
    const spans: string[] = [];
    const metrics: string[] = [];
    const dispatcher = new DurableJobDispatcher({
      publish: async (envelope) => ({ id: "delivery-1", name: envelope.name }),
    }, {
      tracer: {
        startSpan(name, attributes) {
          spans.push(`${name}:${attributes?.["job.name"]}`);
          return { setAttribute() {}, recordException() {}, setStatus() {}, end() {} };
        },
      },
      metrics: {
        increment(name, _value, labels) { metrics.push(`${name}:${labels?.outcome}`); },
        observe() {},
      },
    });

    await dispatcher.dispatch({
      name: "durable-telemetry",
      codec: { encode: (payload: string) => payload, decode: (payload) => String(payload) },
      handle: () => undefined,
    }, "payload");

    expect(spans).toEqual(["jobs.dispatch:durable-telemetry"]);
    expect(metrics).toContain("jobs.dispatch.operations:success");
  });
});
