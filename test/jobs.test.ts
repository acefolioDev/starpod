import { describe, expect, test } from "bun:test";
import {
  DurableJobDispatcher,
  InMemoryJobQueue,
  InMemoryScheduler,
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
});
