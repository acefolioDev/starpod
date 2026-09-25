import { describe, expect, test } from "bun:test";
import { InMemoryJobQueue } from "../src/kernel/jobs/queue";

describe("InMemoryJobQueue shutdown", () => {
  test("waits for active handlers when closing without a drain", async () => {
    const queue = new InMemoryJobQueue();
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });

    await queue.dispatch({
      name: "shutdown-task",
      handle: async () => {
        markStarted();
        await gate;
      },
    }, {});
    await started;

    let closed = false;
    const closing = queue.close({ drain: false }).then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await closing;
    expect(closed).toBe(true);
  });
});
