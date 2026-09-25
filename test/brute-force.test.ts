import { describe, expect, test } from "bun:test";
import { BruteForceGuard, MemoryBruteForceStore } from "../src/kernel/security/brute-force";

describe("brute-force guard", () => {
  test("locks repeated failures and resets after a successful authentication", async () => {
    let now = 1_000;
    const guard = new BruteForceGuard({
      maxFailures: 2,
      windowMs: 100,
      lockoutMs: 300,
      now: () => now,
    });

    expect((await guard.check("account" )).allowed).toBe(true);
    expect((await guard.recordFailure("account")).allowed).toBe(true);
    const locked = await guard.recordFailure("account");
    expect(locked).toMatchObject({ allowed: false, failures: 2, retryAfterMs: 300 });
    await expect(guard.assertAllowed("account")).rejects.toMatchObject({ status: 429 });

    now += 101;
    expect(await guard.check("account")).toMatchObject({ allowed: false, retryAfterMs: 199 });
    now += 200;
    expect((await guard.check("account")).allowed).toBe(true);
    await guard.run("account", () => "authenticated");
    expect((await guard.check("account")).failures).toBe(0);
  });

  test("records failed run attempts and expires them by window", async () => {
    let now = 5_000;
    const guard = new BruteForceGuard({ maxFailures: 3, windowMs: 100, lockoutMs: 500, now: () => now });
    await expect(guard.run("account", () => { throw new Error("invalid credentials"); }))
      .rejects.toThrow("invalid credentials");
    expect((await guard.check("account")).failures).toBe(1);
    now += 101;
    expect((await guard.check("account")).failures).toBe(0);
  });

  test("keeps the memory store bounded and validates configuration", () => {
    const store = new MemoryBruteForceStore({ maxKeys: 1 });
    store.set("first", { failures: 1, expiresAt: Date.now() + 100, blockedUntil: 0 });
    store.set("second", { failures: 1, expiresAt: Date.now() + 100, blockedUntil: 0 });
    expect(store.get("first")).toBeUndefined();
    expect(() => new BruteForceGuard({ maxFailures: 0, windowMs: 1, lockoutMs: 1 })).toThrow("maxFailures");
  });
});
