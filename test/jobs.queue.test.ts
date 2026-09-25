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
    const events: import("../src/kernel/jobs/jobs").JobEvent[] = [];
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

  test("rejects duplicate explicit ids while preserving queue state", async () => {
    const queue = new InMemoryJobQueue({ idFactory: () => "generated" });
    const job = {
      name: "duplicate-id",
      handle: async () => new Promise<void>((resolve) => setTimeout(resolve, 5)),
    };

    await queue.dispatch(job, {}, { id: "same-id" });
    await expect(queue.dispatch(job, {}, { id: "same-id" })).rejects.toThrow("already active");
    await queue.close();
  });

  test("dead-letters jobs when their backoff function throws", async () => {
    const queue = new InMemoryJobQueue({ idFactory: () => "backoff-failure" });
    await queue.dispatch({
      name: "bad-backoff",
      handle: async () => { throw new Error("handler failed"); },
    }, {}, {
      maxAttempts: 2,
      backoffMs: () => { throw new Error("backoff failed"); },
    });

    await queue.awaitIdle();
    expect(queue.deadLetters()).toHaveLength(1);
    expect(queue.deadLetters()[0]?.error).toMatchObject({ message: "backoff failed" });
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
    const { Container } = await import("../src/kernel/di/di");
    const container = new Container([InMemoryJobQueue]);
    const queue = container.resolve(InMemoryJobQueue);

    await container.dispose();
    await expect(queue.dispatch({ name: "after-close", handle: () => undefined }, {})).rejects.toThrow(
      "job queue has already been closed",
    );
  });
});


