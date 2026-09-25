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
    const queue: import("../src/kernel/jobs/jobs").JobQueue = {
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

