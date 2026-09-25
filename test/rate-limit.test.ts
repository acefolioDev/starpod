import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { bootstrap } from "../src/kernel/application/bootstrap";
import { application, pod } from "../src/kernel/application/feature";
import type { StarpodElysia } from "../src/kernel/http/http";
import { MemoryRateLimitStore, rateLimit } from "../src/kernel/security/rate-limit";

describe("rate limiting", () => {
  test("uses bounded fixed windows and resets after expiry", () => {
    let now = 1_000;
    const store = new MemoryRateLimitStore({ now: () => now, maxKeys: 1 });

    expect(store.consume("client", 2, 100)).toMatchObject({ allowed: true, remaining: 1, resetAt: 1_100 });
    expect(store.consume("client", 2, 100)).toMatchObject({ allowed: true, remaining: 0 });
    expect(store.consume("client", 2, 100)).toMatchObject({ allowed: false, remaining: 0 });

    now = 1_101;
    expect(store.consume("client", 2, 100)).toMatchObject({ allowed: true, remaining: 1, resetAt: 1_201 });
  });

  test("integrates with bootstrap as a native Elysia hook", async () => {
    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", () => ({ status: "ok" }));
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({ name: "limited", prefix: "/limited", controller: Controller })],
      }),
      {
        printFeatures: false,
        seal: false,
        configure: (app) =>
          rateLimit({ limit: 1, windowMs: 10_000, key: () => "client" })(app),
      },
    );

    const first = await server.handle(new Request("http://localhost/limited/"));
    const second = await server.handle(new Request("http://localhost/limited/"));

    expect(first.status).toBe(200);
    expect(first.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(first.headers.get("ratelimit-limit")).toBe("1");
    expect(first.headers.get("ratelimit-remaining")).toBe("0");
    expect(first.headers.get("ratelimit-reset")).toBe("10");
    expect(second.status).toBe(429);
    expect(second.headers.get("ratelimit-reset")).toBe("10");
    expect(second.headers.get("retry-after")).toBe("10");
    expect(await second.json()).toEqual({
      error: {
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests",
        requestId: expect.any(String),
      },
    });
  });

  test("uses the configured clock for retry headers and rejects blank identities", async () => {
    let now = 1_000;
    const store: MemoryRateLimitStore = new MemoryRateLimitStore({ now: () => now });
    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", () => "ok");
      }
    }
    const app = await bootstrap(
      application({
        features: [pod({ name: "clocked", prefix: "/clocked", controller: Controller })],
      }),
      {
        printFeatures: false,
        seal: false,
        configure: (elysia) => rateLimit({
          limit: 1,
          windowMs: 100,
          now: () => now,
          store,
          key: () => "client",
        })(elysia),
      },
    );

    await app.handle(new Request("http://localhost/clocked/"));
    const rejected = await app.handle(new Request("http://localhost/clocked/"));
    expect(rejected.headers.get("retry-after")).toBe("1");

    const blank = rateLimit({ limit: 1, windowMs: 100, key: () => "   " })(
      new Elysia(),
    ).get("/", () => "ok");
    expect((await blank.handle(new Request("http://localhost/"))).status).toBe(500);
  });

  test("keeps policy names and identities collision-safe and bounded", async () => {
    const keys: string[] = [];
    const app = rateLimit({
      name: "tenant:api",
      limit: 1,
      windowMs: 100,
      key: () => "tenant:api",
      store: {
        consume(key, limit, windowMs) {
          keys.push(key);
          return { allowed: true, limit, remaining: 0, resetAt: Date.now() + windowMs };
        },
      },
    })(new Elysia()).get("/", () => "ok");

    expect((await app.handle(new Request("http://localhost/"))).status).toBe(200);
    expect(keys).toEqual(["tenant%3Aapi:tenant%3Aapi"]);

    const oversized = rateLimit({
      limit: 1,
      windowMs: 100,
      key: () => "x".repeat(513),
    })(new Elysia()).get("/", () => "ok");
    expect((await oversized.handle(new Request("http://localhost/"))).status).toBe(500);
  });

  test("emits safe decisions and rejects malformed store responses", async () => {
    const events: import("../src/kernel/security/rate-limit").RateLimitEvent[] = [];
    const app = rateLimit({
      limit: 2,
      windowMs: 100,
      key: () => "client",
      onEvent: (event) => {
        events.push(event);
        throw new Error("observer failure");
      },
    })(new Elysia()).get("/", () => "ok");

    expect((await app.handle(new Request("http://localhost/"))).status).toBe(200);
    expect(events).toEqual([expect.objectContaining({
      operation: "decision",
      name: "default",
      allowed: true,
      limit: 2,
      remaining: 1,
    })]);

    const malformed = rateLimit({
      limit: 1,
      windowMs: 100,
      key: () => "client",
      store: { consume: () => ({ allowed: true, limit: 1, remaining: 2, resetAt: Date.now() }) },
    })(new Elysia()).get("/", () => "ok");
    expect((await malformed.handle(new Request("http://localhost/"))).status).toBe(500);
  });
});
