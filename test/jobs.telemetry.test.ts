import { describe, expect, test } from "bun:test";
import { JobRegistry, JobWorker, type JobPayloadValue } from "../src/kernel/jobs/jobs";

describe("JobWorker operation telemetry", () => {
  test("creates job spans and metrics without changing execution", async () => {
    const spans: string[] = [];
    const metrics: string[] = [];
    const registry = new JobRegistry();
    registry.register({
      name: "telemetry-job",
      codec: { encode: (value: string) => value, decode: (value: JobPayloadValue) => String(value) },
      handle: () => undefined,
    });
    const worker = new JobWorker(registry, {
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

    await worker.run({ id: "delivery-telemetry", name: "telemetry-job", payload: "payload" });

    expect(spans).toEqual(["jobs.worker:telemetry-job"]);
    expect(metrics).toContain("jobs.worker.operations:success");
  });
});
