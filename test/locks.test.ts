import { describe, expect, test } from "bun:test";
import { MemoryLockStore, withLock } from "../src/kernel/data/locks";

describe("lock stores", () => {
  test("allows one lease, releases it idempotently, and supports a new lease", async () => {
    const store = new MemoryLockStore();
    const first = await store.acquire("users", 100);
    expect(first).not.toBeNull();
    expect(await store.acquire("users", 100)).toBeNull();
    await first?.release();
    await first?.release();
    expect(await store.acquire("users", 100)).not.toBeNull();
  });

  test("expires leases and always releases work locks", async () => {
    let now = 1_000;
    const store = new MemoryLockStore({ now: () => now });
    expect(await store.acquire("expired", 100)).not.toBeNull();
    now = 1_101;
    expect(await store.acquire("expired", 100)).not.toBeNull();

    await withLock(store, "work", () => "done");
    expect(await store.acquire("work", 100)).not.toBeNull();
    await expect(withLock(store, "held", async () => {
      await expect(withLock(store, "held", () => undefined)).rejects.toThrow("already held");
    })).resolves.toBeUndefined();
  });

  test("rejects unsafe keys and invalid lifetimes", () => {
    const store = new MemoryLockStore();
    expect(() => store.acquire("bad\nkey", 100)).toThrow("lock key");
    expect(() => store.acquire("key", 0)).toThrow("ttlMs");
    expect(() => new MemoryLockStore({ maxKeys: 0 })).toThrow("maxKeys");
  });
});
