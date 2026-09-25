import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { healthRoutes } from "../src/kernel/http/health";

describe("health routes", () => {
  test("keeps liveness independent from dependency checks", async () => {
    const app = healthRoutes(new Elysia(), {
      checks: [{ name: "database", check: () => { throw new Error("offline"); } }],
    });

    const live = await app.handle(new Request("http://localhost/health/live"));
    const ready = await app.handle(new Request("http://localhost/health/ready"));

    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "ok" });
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({
      status: "not_ready",
      checks: { database: { status: "failed" } },
    });
  });

  test("rejects duplicate check names", () => {
    expect(() =>
      healthRoutes(new Elysia(), {
        checks: [
          { name: "database", check: () => undefined },
          { name: "database", check: () => undefined },
        ],
      }),
    ).toThrow("Duplicate health check: database");
  });

  test("fails readiness when a dependency check times out", async () => {
    const app = healthRoutes(new Elysia(), {
      checks: [{
        name: "database",
        timeoutMs: 5,
        check: () => new Promise<void>(() => undefined),
      }],
    });

    const response = await app.handle(new Request("http://localhost/health/ready"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "not_ready",
      checks: { database: { status: "failed" } },
    });
  });

  test("runs independent readiness checks concurrently", async () => {
    let active = 0;
    let maximumActive = 0;
    const check = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
    };
    const app = healthRoutes(new Elysia(), {
      checks: [
        { name: "database", check },
        { name: "cache", check },
      ],
    });

    const response = await app.handle(new Request("http://localhost/health/ready"));

    expect(response.status).toBe(200);
    expect(maximumActive).toBe(2);
  });

  test("fails readiness once the native server begins stopping", async () => {
    const app = healthRoutes(new Elysia());
    app.listen(0);
    await app.stop();

    const ready = await app.handle(new Request("http://localhost/health/ready"));
    const live = await app.handle(new Request("http://localhost/health/live"));

    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: "not_ready", checks: {} });
    expect(live.status).toBe(200);
  });

  test("rejects invalid health check timeouts", () => {
    expect(() => healthRoutes(new Elysia(), {
      checks: [{ name: "database", timeoutMs: 0, check: () => undefined }],
    })).toThrow("Health check timeoutMs must be a positive number: database");
  });

  test("rejects unsafe or duplicate health paths", () => {
    expect(() => healthRoutes(new Elysia(), { livenessPath: "/health/live?debug=true" })).toThrow("livenessPath");
    expect(() => healthRoutes(new Elysia(), {
      livenessPath: "/health/status",
      readinessPath: "/health/status",
    })).toThrow("must be different");
  });
});
