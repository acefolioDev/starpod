import { describe, expect, test } from "bun:test";
import {
  InMemoryJobQueue,
  InMemoryScheduler,
  JobRegistry,
  decodeJob,
  encodeJob,
  type JobPayloadValue,
} from "../src/kernel/jobs";

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

describe("InMemoryJobQueue", () => {
  test("dispatches typed payloads and exposes job context", async () => {
    const queue = new InMemoryJobQueue({ idFactory: () => "job-1" });
    const seen: unknown[] = [];

    const receipt = await queue.dispatch(
      {
        name: "send-welcome-email",
        handle: (payload: { readonly userId: string }, context) => {
          seen.push({ payload, id: context.id, attempt: context.attempt, name: context.name });
        },
      },
      { userId: "user-1" },
    );
    await queue.awaitIdle();

    expect(receipt).toEqual({ id: "job-1", name: "send-welcome-email" });
    expect(seen).toEqual([
      {
        payload: { userId: "user-1" },
        id: "job-1",
        attempt: 1,
        name: "send-welcome-email",
      },
    ]);
    await queue.close();
  });

  test("emits value-free lifecycle events and isolates observer failures", async () => {
    const events: import("../src/kernel/jobs").JobEvent[] = [];
    const queue = new InMemoryJobQueue({
      idFactory: () => "observed-job",
      onEvent: (event) => {
        events.push(event);
        if (event.operation === "dispatch") throw new Error("observer failure");
      },
    });

    await queue.dispatch({
      name: "observed-task",
      handle: () => undefined,
    }, {});
    await queue.awaitIdle();

    expect(events).toEqual([
      { operation: "dispatch", id: "observed-job", name: "observed-task" },
      { operation: "start", id: "observed-job", name: "observed-task", attempt: 1 },
      { operation: "success", id: "observed-job", name: "observed-task", attempt: 1 },
    ]);
    await queue.close();
  });

  test("retries with the next attempt and records dead letters", async () => {
    const queue = new InMemoryJobQueue();
    const attempts: number[] = [];

    await queue.dispatch(
      {
        name: "retryable-task",
        handle: (_, context) => {
          attempts.push(context.attempt);
          throw new Error(`attempt ${context.attempt}`);
        },
      },
      {},
      { maxAttempts: 3, backoffMs: () => 0 },
    );
    await queue.awaitIdle();

    expect(attempts).toEqual([1, 2, 3]);
    expect(queue.deadLetters()).toHaveLength(1);
    expect(queue.deadLetters()[0]).toMatchObject({ name: "retryable-task", attempts: 3 });
    await queue.close();
  });

  test("deduplicates active jobs and allows a key after completion", async () => {
    const queue = new InMemoryJobQueue({ idFactory: (() => {
      let next = 0;
      return () => `job-${++next}`;
    })() });
    let calls = 0;

    const job = {
      name: "rebuild-search-index",
      handle: async () => {
        calls += 1;
      },
    };
    const first = await queue.dispatch(job, {}, { deduplicationKey: "users" });
    const duplicate = await queue.dispatch(job, {}, { deduplicationKey: "users" });
    await queue.awaitIdle();
    const afterCompletion = await queue.dispatch(job, {}, { deduplicationKey: "users" });
    await queue.awaitIdle();

    expect(duplicate).toEqual(first);
    expect(afterCompletion.id).not.toBe(first.id);
    expect(calls).toBe(2);
    await queue.close();
  });

  test("aborts timed-out work and records the failure", async () => {
    const queue = new InMemoryJobQueue();

    await queue.dispatch(
      {
        name: "slow-task",
        handle: (_, { signal }) => new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
      },
      {},
      { timeoutMs: 5 },
    );
    await queue.awaitIdle();

    expect(queue.deadLetters()[0]?.error).toMatchObject({ message: "job timed out after 5ms" });
    await queue.close();
  });

  test("cancels pending and running jobs without retrying or dead-lettering them", async () => {
    const queue = new InMemoryJobQueue({ concurrency: 1 });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const runningReceipt = await queue.dispatch({
      name: "cancellable-task",
      handle: async (_, context) => {
        markStarted();
        await new Promise<void>((release) => {
          context.signal.addEventListener("abort", () => release(), { once: true });
        });
      },
    }, {});
    await started;
    const pendingReceipt = await queue.dispatch(
      { name: "pending-task", handle: async () => undefined },
      {},
      { delayMs: 1_000 },
    );
    expect(queue.cancel(pendingReceipt.id)).toBe(true);
    expect(queue.cancel(runningReceipt.id)).toBe(true);
    expect(queue.cancel("missing-job")).toBe(false);
    await queue.awaitIdle();

    expect(queue.deadLetters()).toHaveLength(0);
    await queue.close({ drain: false });
  });

  test("cancels a delayed job before it starts", async () => {
    const queue = new InMemoryJobQueue();
    let calls = 0;
    const receipt = await queue.dispatch(
      { name: "delayed-cancel", handle: () => { calls += 1; } },
      {},
      { delayMs: 10_000 },
    );

    expect(queue.cancel(receipt.id)).toBe(true);
    await queue.awaitIdle();
    expect(calls).toBe(0);
    await queue.close();
  });

  test("participates in container disposal", async () => {
    const { Container } = await import("../src/kernel/di");
    const container = new Container([InMemoryJobQueue]);
    const queue = container.resolve(InMemoryJobQueue);

    await container.dispose();
    await expect(queue.dispatch({ name: "after-close", handle: () => undefined }, {})).rejects.toThrow(
      "job queue has already been closed",
    );
  });
});

describe("InMemoryScheduler", () => {
  test("dispatches fixed-delay jobs without overlapping and supports cancellation", async () => {
    const queue = new InMemoryJobQueue();
    const scheduler = new InMemoryScheduler(queue);
    let calls = 0;
    let release!: () => void;
    const twice = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = scheduler.schedule(
      {
        name: "scheduled-task",
        handle: async () => {
          calls += 1;
          if (calls === 2) release();
        },
      },
      {},
      { intervalMs: 1, runImmediately: true },
    );

    await twice;
    task.cancel();
    await scheduler.dispose();
    await queue.awaitIdle();

    expect(calls).toBe(2);
    expect(task.active()).toBe(false);
    await queue.close();
  });

  test("reports scheduling failures and validates intervals", async () => {
    const queue: import("../src/kernel/jobs").JobQueue = {
      dispatch: async () => {
        throw new Error("queue unavailable");
      },
      awaitIdle: async () => undefined,
      close: async () => undefined,
    };
    const errors: unknown[] = [];
    const scheduler = new InMemoryScheduler(queue, {
      onError: (error) => {
        errors.push(error);
      },
    });

    expect(() => scheduler.schedule(
      { name: "invalid-schedule", handle: () => undefined },
      {},
      { intervalMs: 0 },
    )).toThrow("schedule intervalMs must be a positive number");

    const task = scheduler.schedule(
      { name: "failing-schedule", handle: () => undefined },
      {},
      { intervalMs: 1, runImmediately: true },
    );
    while (errors.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    task.cancel();
    await scheduler.dispose();
    expect(errors[0]).toMatchObject({ message: "queue unavailable" });
  });

  test("keeps function payloads distinct from explicit payload factories", async () => {
    const queue = new InMemoryJobQueue();
    const scheduler = new InMemoryScheduler(queue);
    let received: (() => string) | undefined;
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const payload = () => "payload";
    const task = scheduler.schedule(
      {
        name: "function-payload",
        handle: (value: () => string) => {
          received = value;
          release();
        },
      },
      payload,
      { intervalMs: 1, runImmediately: true },
    );

    await done;
    task.cancel();
    await scheduler.dispose();
    await queue.awaitIdle();

    expect(received).toBe(payload);
    await queue.close();
  });

  test("supports an explicit asynchronous payload factory", async () => {
    const queue = new InMemoryJobQueue();
    const scheduler = new InMemoryScheduler(queue);
    let received: string | undefined;
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = scheduler.scheduleFactory(
      {
        name: "factory-payload",
        handle: (value: string) => {
          received = value;
          release();
        },
      },
      async () => "generated",
      { intervalMs: 1, runImmediately: true },
    );

    await done;
    task.cancel();
    await scheduler.dispose();
    await queue.awaitIdle();

    expect(received).toBe("generated");
    await queue.close();
  });
});
