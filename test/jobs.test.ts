import { describe, expect, test } from "bun:test";
import {
  DurableJobDispatcher,
  InMemoryJobQueue,
  InMemoryScheduler,
  JobWorker,
  JobRegistry,
  decodeJob,
  encodeJob,
  type JobPayloadValue,
} from "../src/kernel/jobs/jobs";

describe("JobRegistry", () => {
  test("registers stable job names for durable workers", () => {
    const registry = new JobRegistry();
    const job = {
      name: "send-email",
      codec: {
        encode: (payload: { readonly userId: string }) => payload,
        decode: (payload: JobPayloadValue) => payload as { readonly userId: string },
      },
      handle: () => undefined,
    };

    registry.register(job);

    expect(registry.has("send-email")).toBe(true);
    expect(registry.names()).toEqual(["send-email"]);
    expect(registry.resolve("send-email").name).toBe("send-email");
    expect(() => registry.register(job)).toThrow("already registered");
    expect(() => registry.resolve("unknown-job")).toThrow("registered jobs: send-email");
  });

  test("encodes only durable dispatch data and decodes it through the job codec", () => {
    const job = {
      name: "sync-user",
      codec: {
        encode: (payload: { readonly userId: string }) => ({ userId: payload.userId }),
        decode: (payload: JobPayloadValue) =>
          payload as { readonly userId: string },
      },
      handle: () => undefined,
    };

    const envelope = encodeJob(job, { userId: "user-1" }, {
      id: "job-1",
      delayMs: 100,
      maxAttempts: 3,
      backoffMs: () => 999,
    });

    expect(envelope).toEqual({
      name: "sync-user",
      payload: { userId: "user-1" },
      options: { id: "job-1", delayMs: 100, maxAttempts: 3 },
    });
    expect(decodeJob(job, envelope.payload)).toEqual({ userId: "user-1" });
    expect(() => encodeJob({ name: "local-only", handle: () => undefined }, {}))
      .toThrow("must define a codec");
    expect(() => encodeJob({
      name: "invalid-wire-payload",
      codec: {
        encode: () => new Date() as unknown as JobPayloadValue,
        decode: (payload: JobPayloadValue) => payload,
      },
      handle: () => undefined,
    }, {})).toThrow("plain objects");
  });
});
describe("DurableJobDispatcher", () => {
  test("publishes an encoded envelope without crossing a handler closure", async () => {
    const published: unknown[] = [];
    const dispatcher = new DurableJobDispatcher({
      publish: async (envelope) => {
        published.push(envelope);
        return { id: "receipt-1", name: envelope.name };
      },
    });
    const job = {
      name: "send-email",
      codec: {
        encode: (payload: { userId: string }) => payload,
        decode: (payload: JobPayloadValue) => payload as { userId: string },
      },
      handle: async () => undefined,
    };

    const receipt = await dispatcher.dispatch(job, { userId: "user-1" }, {
      delayMs: 100,
      maxAttempts: 3,
    });

    expect(receipt).toEqual({ id: "receipt-1", name: "send-email" });
    expect(published).toEqual([{
      name: "send-email",
      payload: { userId: "user-1" },
      options: { delayMs: 100, maxAttempts: 3 },
    }]);
  });

  test("rejects a publisher receipt that does not identify the dispatched job", async () => {
    const dispatcher = new DurableJobDispatcher({
      publish: async () => ({ id: "receipt-1", name: "different-job" }),
    });
    const job = {
      name: "send-email",
      codec: { encode: (payload: string) => payload, decode: (payload: JobPayloadValue) => String(payload) },
      handle: async () => undefined,
    };

    await expect(dispatcher.dispatch(job, "payload")).rejects.toThrow("invalid receipt");
  });

  test("emits a value-free dispatch event and isolates observer failures", async () => {
    const events: string[] = [];
    const dispatcher = new DurableJobDispatcher({
      publish: async () => ({ id: "receipt-1", name: "send-email" }),
    }, {
      onEvent: (event) => {
        events.push(`${event.operation}:${event.id}`);
        throw new Error("observer failure");
      },
    });
    const job = {
      name: "send-email",
      codec: { encode: (payload: string) => payload, decode: (payload: JobPayloadValue) => String(payload) },
      handle: async () => undefined,
    };

    await expect(dispatcher.dispatch(job, "payload")).resolves.toEqual({ id: "receipt-1", name: "send-email" });
    expect(events).toEqual(["dispatch:receipt-1"]);
  });
});

describe("JobWorker", () => {
  test("decodes and executes a durable delivery with progress and telemetry", async () => {
    const events: string[] = [];
    const registry = new JobRegistry();
    registry.register({
      name: "rebuild-index",
      codec: {
        encode: (payload: { readonly index: string }) => payload,
        decode: (payload: JobPayloadValue) => payload as { readonly index: string },
      },
      handle: (payload, context) => {
        expect(payload.index).toBe("users");
        context.reportProgress({ completed: 1, total: 1 });
      },
    });
    const worker = new JobWorker(registry, {
      onEvent: (event) => events.push(event.operation),
    });

    await worker.run({
      id: "delivery-1",
      name: "rebuild-index",
      payload: { index: "users" },
      attempt: 2,
    });

    expect(events).toEqual(["start", "progress", "success"]);
  });

  test("rejects malformed deliveries and propagates handler failures", async () => {
    const registry = new JobRegistry();
    registry.register({
      name: "failing-job",
      codec: { encode: (value: string) => value, decode: (value: JobPayloadValue) => String(value) },
      handle: () => { throw new Error("worker failed"); },
    });
    const worker = new JobWorker(registry);

    await expect(worker.run({ id: "delivery-1", name: "failing-job", payload: "payload" }))
      .rejects.toThrow("worker failed");
    await expect(worker.run({ id: "delivery-2", name: "failing-job", payload: "payload", attempt: 0 }))
      .rejects.toThrow("positive integer");
  });

  test("aborts a timed-out delivery so the transport can retry it", async () => {
    const registry = new JobRegistry();
    let aborted = false;
    registry.register({
      name: "slow-job",
      codec: { encode: (value: string) => value, decode: (value: JobPayloadValue) => String(value) },
      handle: (_, context) => new Promise<void>((resolve) => {
        context.signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        }, { once: true });
      }),
    });

    await expect(new JobWorker(registry).run({
      id: "delivery-3",
      name: "slow-job",
      payload: "payload",
      timeoutMs: 5,
    })).rejects.toThrow("timed out after 5ms");
    expect(aborted).toBe(true);
  });
});
