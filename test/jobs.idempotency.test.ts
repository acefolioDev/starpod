import { describe, expect, test } from "bun:test";
import {
  JobRegistry,
  JobWorker,
  MemoryJobIdempotencyStore,
  type JobPayloadValue,
} from "../src/kernel/jobs/jobs";

describe("JobWorker idempotency", () => {
  test("coalesces duplicate deliveries and keeps tenant IDs isolated", async () => {
    const registry = new JobRegistry();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    registry.register({
      name: "tenant-job",
      codec: { encode: (value: string) => value, decode: (value: JobPayloadValue) => String(value) },
      handle: async (_, context) => {
        calls += 1;
        if (context.tenantId === "tenant-a") {
          started();
          await gate;
        }
      },
    });
    const worker = new JobWorker(registry, { idempotency: new MemoryJobIdempotencyStore() });
    const first = worker.run({ id: "delivery-1", name: "tenant-job", payload: "payload", tenantId: "tenant-a" });
    await firstStarted;
    const duplicate = worker.run({ id: "delivery-1", name: "tenant-job", payload: "payload", tenantId: "tenant-a" });
    const otherTenant = worker.run({ id: "delivery-1", name: "tenant-job", payload: "payload", tenantId: "tenant-b" });
    await otherTenant;
    expect(calls).toBe(2);
    release();
    await Promise.all([first, duplicate]);
    await worker.run({ id: "delivery-1", name: "tenant-job", payload: "payload", tenantId: "tenant-a" });
    expect(calls).toBe(2);
  });

  test("allows a failed delivery to retry with the same id", async () => {
    const registry = new JobRegistry();
    let calls = 0;
    registry.register({
      name: "retryable-job",
      codec: { encode: (value: string) => value, decode: (value: JobPayloadValue) => String(value) },
      handle: () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary failure");
      },
    });
    const worker = new JobWorker(registry, { idempotency: new MemoryJobIdempotencyStore() });
    await expect(worker.run({ id: "delivery-2", name: "retryable-job", payload: "payload" }))
      .rejects.toThrow("temporary failure");
    await expect(worker.run({ id: "delivery-2", name: "retryable-job", payload: "payload" })).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  test("skips decoding an already completed duplicate delivery", async () => {
    const registry = new JobRegistry();
    let decodes = 0;
    registry.register({
      name: "decode-once-job",
      codec: {
        encode: (value: string) => value,
        decode: (value: JobPayloadValue) => { decodes += 1; return String(value); },
      },
      handle: () => undefined,
    });
    const worker = new JobWorker(registry, { idempotency: new MemoryJobIdempotencyStore() });
    const delivery = { id: "delivery-3", name: "decode-once-job", payload: "payload" as const };

    await worker.run(delivery);
    await worker.run({ ...delivery, payload: { changed: true } as JobPayloadValue });

    expect(decodes).toBe(1);
  });
});
