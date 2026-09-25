import { describe, expect, test } from "bun:test";
import { BruteForceGuard } from "../src/kernel/security/brute-force";

describe("BruteForceGuard operation telemetry", () => {
  test("creates safe authentication-attempt spans and metrics", async () => {
    const spans: string[] = [];
    const metrics: string[] = [];
    const guard = new BruteForceGuard({
      maxFailures: 3,
      windowMs: 10_000,
      lockoutMs: 10_000,
      tracer: {
        startSpan(name) {
          spans.push(name);
          return { setAttribute() {}, recordException() {}, setStatus() {}, end() {} };
        },
      },
      metrics: {
        increment(name, _value, labels) { metrics.push(`${name}:${labels?.outcome}`); },
        observe() {},
      },
    });

    await guard.run("secret-account-key", () => "authenticated");

    expect(spans).toEqual(["security.brute_force"]);
    expect(metrics).toContain("security.brute_force.operations:success");
    expect(JSON.stringify(spans)).not.toContain("secret-account-key");
  });
});
