import { describe, expect, test } from "bun:test";
import { InMemoryJobQueue } from "../src/kernel/jobs/queue";

describe("InMemoryJobQueue operation telemetry", () => {
  test("creates dispatch and delivery spans and metrics", async () => {
    const spans: string[] = [];
    const metrics: string[] = [];
    const queue = new InMemoryJobQueue({
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

    await queue.dispatch({ name: "telemetry-job", handle: () => undefined }, {});
    await queue.awaitIdle();
    await queue.close();

    expect(spans).toEqual(["jobs.queue.dispatch:telemetry-job", "jobs.queue.delivery:telemetry-job"]);
    expect(metrics).toContain("jobs.queue.dispatch.operations:success");
    expect(metrics).toContain("jobs.queue.delivery.operations:success");
  });
});
