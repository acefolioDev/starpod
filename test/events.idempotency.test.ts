import { describe, expect, test } from "bun:test";
import { MemoryEventIdempotencyStore } from "../src/kernel/events/idempotency";

describe("MemoryEventIdempotencyStore", () => {
  test("coalesces concurrent work and skips completed duplicate IDs", async () => {
    const store = new MemoryEventIdempotencyStore();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const work = async () => {
      calls += 1;
      await gate;
    };

    const first = store.runOnce("event-1", work);
    const second = store.runOnce("event-1", work);
    release();
    await Promise.all([first, second]);
    await store.runOnce("event-1", work);

    expect(calls).toBe(1);
  });

  test("allows failed work to retry and expires completed IDs", async () => {
    let now = 1_000;
    const store = new MemoryEventIdempotencyStore({ now: () => now, ttlMs: 100 });
    let calls = 0;

    await expect(store.runOnce("event-2", async () => {
      calls += 1;
      throw new Error("broker unavailable");
    })).rejects.toThrow("broker unavailable");
    await store.runOnce("event-2", async () => { calls += 1; });
    await store.runOnce("event-2", async () => { calls += 1; });
    now = 1_101;
    await store.runOnce("event-2", async () => { calls += 1; });

    expect(calls).toBe(3);
  });

  test("keeps tenant event IDs isolated", async () => {
    const store = new MemoryEventIdempotencyStore();
    let calls = 0;

    await store.runOnce("tenant-a:event-1", async () => { calls += 1; });
    await store.runOnce("tenant-b:event-1", async () => { calls += 1; });
    await store.runOnce("tenant-a:event-1", async () => { calls += 1; });

    expect(calls).toBe(2);
  });
});
