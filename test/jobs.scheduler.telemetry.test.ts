import { describe, expect, test } from "bun:test";
import { InMemoryJobQueue, InMemoryScheduler } from "../src/kernel/jobs/jobs";

describe("InMemoryScheduler operation telemetry", () => {
  test("creates safe schedule execution spans and metrics", async () => {
    const spans: string[] = [];
    const metrics: string[] = [];
    const queue = new InMemoryJobQueue();
    const scheduler = new InMemoryScheduler(queue, {
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
    let done!: () => void;
    const finished = new Promise<void>((resolve) => { done = resolve; });
    const task = scheduler.schedule({ name: "scheduled-telemetry", handle: () => done() }, {}, {
      intervalMs: 1,
      runImmediately: true,
    });

    await finished;
    task.cancel();
    await scheduler.dispose();
    await queue.awaitIdle();
    await queue.close();

    expect(spans).toContain("jobs.scheduler:scheduled-telemetry");
    expect(metrics).toContain("jobs.scheduler.operations:success");
  });
});
