import { describe, expect, test } from "bun:test";
import { MemoryCache } from "../src/kernel/data/cache";

describe("MemoryCache", () => {
  test("emits value-free operation events without affecting cache behavior", async () => {
    const events: import("../src/kernel/data/cache").CacheEvent[] = [];
    const cache = new MemoryCache({
      onEvent: (event) => {
        events.push(event);
        if (event.operation === "get") throw new Error("observer failure");
      },
    });

    expect(cache.get("missing")).toBeUndefined();
    await cache.getOrSet("user", () => "Ada");
    await cache.getOrSet("user", () => "Grace");
    cache.invalidateTag("unused");

    expect(events).toEqual([
      { operation: "get", key: "missing", hit: false },
      { operation: "getOrSet", key: "user", hit: false, coalesced: false },
      { operation: "set", key: "user" },
      { operation: "getOrSet", key: "user", hit: true, coalesced: false },
      { operation: "invalidateTag", tag: "unused", removed: 0 },
    ]);
  });

  test("supports TTL expiration and bounded entries", () => {
    let now = 1_000;
    const cache = new MemoryCache({ now: () => now, maxEntries: 1 });

    cache.set("first", { value: 1 }, { ttlMs: 100 });
    expect(cache.get<{ value: number }>("first")).toEqual({ value: 1 });
    now = 1_101;
    expect(cache.get("first")).toBeUndefined();

    cache.set("first", 1);
    cache.set("second", 2);
    expect(cache.get<number>("first")).toBeUndefined();
    expect(cache.get<number>("second")).toBe(2);
  });

  test("evicts the least recently used entry", () => {
    const cache = new MemoryCache({ maxEntries: 2 });
    cache.set("first", 1);
    cache.set("second", 2);
    expect(cache.get<number>("first")).toBe(1);

    cache.set("third", 3);

    expect(cache.get<number>("first")).toBe(1);
    expect(cache.get<number>("second")).toBeUndefined();
    expect(cache.get<number>("third")).toBe(3);
  });

  test("invalidates entries by tag and keeps namespaces isolated", () => {
    const cache = new MemoryCache();
    const users = cache.namespace("users");

    cache.set("list", ["user-1"], { tags: ["users"] });
    users.set("list", ["user-2"], { tags: ["users"] });

    expect(cache.invalidateTag("users")).toBe(1);
    expect(cache.get("list")).toBeUndefined();
    expect(users.get<string[]>("list")).toEqual(["user-2"]);
    expect(users.invalidateTag("users")).toBe(1);
    expect(users.get<string[]>("list")).toBeUndefined();
  });

  test("coalesces concurrent getOrSet loaders", async () => {
    const cache = new MemoryCache();
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loader = async () => {
      loads += 1;
      await gate;
      return { value: "loaded" };
    };

    const first = cache.getOrSet("config", loader);
    const second = cache.getOrSet("config", loader);
    release();

    expect(await Promise.all([first, second])).toEqual([
      { value: "loaded" },
      { value: "loaded" },
    ]);
    expect(loads).toBe(1);
    expect(await cache.getOrSet("config", loader)).toEqual({ value: "loaded" });
    expect(loads).toBe(1);
  });

  test("validates getOrSet inputs before running the loader", async () => {
    const cache = new MemoryCache();
    let loads = 0;
    const loader = () => { loads += 1; return "value"; };

    await expect(cache.getOrSet("", loader)).rejects.toThrow("cache key");
    await expect(cache.getOrSet("key", loader, { ttlMs: Number.NaN })).rejects.toThrow("ttlMs");
    await expect(cache.getOrSet("key", loader, { tags: ["bad\n tag"] })).rejects.toThrow("cache tag");
    expect(loads).toBe(0);
  });

  test("keeps active loader coalescing when entries are cleared", async () => {
    const cache = new MemoryCache();
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const loader = async () => {
      loads += 1;
      await gate;
      return "loaded";
    };

    const first = cache.getOrSet("config", loader);
    cache.clear();
    const second = cache.getOrSet("config", loader);
    release();

    expect(await Promise.all([first, second])).toEqual(["loaded", "loaded"]);
    expect(loads).toBe(1);
  });

  test("bounds unique in-flight loaders", async () => {
    const cache = new MemoryCache({ maxEntries: 1 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = cache.getOrSet("first", async () => {
      await gate;
      return "loaded";
    });

    await expect(cache.getOrSet("second", async () => "never")).rejects.toThrow("capacity");
    release();
    await first;
  });

  test("keeps getOrSet coalescing and tags inside a namespace", async () => {
    const cache = new MemoryCache();
    const namespaced = cache.namespace("users");
    let loads = 0;

    const first = namespaced.getOrSet("one", async () => {
      loads += 1;
      return { id: "one" };
    }, { tags: ["user"] });
    const second = namespaced.getOrSet("one", async () => {
      loads += 1;
      return { id: "wrong" };
    }, { tags: ["user"] });

    expect(await first).toEqual({ id: "one" });
    expect(await second).toEqual({ id: "one" });
    expect(loads).toBe(1);
    expect(namespaced.invalidateTag("user")).toBe(1);
    expect(namespaced.get<{ id: string }>("one")).toBeUndefined();
  });

  test("retains undefined as a cached value", async () => {
    const cache = new MemoryCache();
    let loads = 0;

    const first = await cache.getOrSet("missing", async () => {
      loads += 1;
      return undefined;
    });
    const second = await cache.getOrSet("missing", async () => {
      loads += 1;
      return "unexpected";
    });

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(loads).toBe(1);
  });

  test("keeps namespace and key components collision-safe", () => {
    const cache = new MemoryCache();
    const first = cache.namespace("a:b");
    const second = cache.namespace("a");

    first.set("c", "first");
    second.set("b:c", "second");

    expect(first.get<string>("c")).toBe("first");
    expect(second.get<string>("b:c")).toBe("second");
  });
});
