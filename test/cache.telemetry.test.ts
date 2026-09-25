import { describe, expect, test } from "bun:test";
import { MemoryCache } from "../src/kernel/data/cache";

describe("MemoryCache operation telemetry", () => {
  test("creates safe operation spans and metrics", async () => {
    const spans: string[] = [];
    const metrics: string[] = [];
    const cache = new MemoryCache({
      tracer: {
        startSpan(name, attributes) {
          spans.push(`${name}:${attributes?.["cache.operation"]}`);
          return { setAttribute() {}, recordException() {}, setStatus() {}, end() {} };
        },
      },
      metrics: {
        increment(name, _value, labels) { metrics.push(`${name}:${labels?.outcome}`); },
        observe() {},
      },
    });

    cache.set("user", "Ada");
    expect(cache.get<string>("user")).toBe("Ada");
    await cache.getOrSet("user", () => "Grace");

    expect(spans).toEqual([
      "cache.set:set",
      "cache.get:get",
      "cache.get_or_set:get_or_set",
    ]);
    expect(metrics).toContain("cache.set.operations:success");
    expect(metrics).toContain("cache.get.operations:success");
    expect(metrics).toContain("cache.get_or_set.operations:success");
  });
});
