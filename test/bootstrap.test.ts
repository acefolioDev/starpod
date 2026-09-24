import { describe, expect, test } from "bun:test";
import { bootstrap, disposeBootstrap, environmentFrom } from "../src/kernel/bootstrap";
import { application, pod } from "../src/kernel/feature";
import { provideAsyncFactory, provideValue, token } from "../src/kernel/di";
import type { StarpodElysia } from "../src/kernel/http";

describe("bootstrap safety", () => {
  test("rejects unknown NODE_ENV values instead of enabling development diagnostics", async () => {
    expect(() => environmentFrom({}, { NODE_ENV: "staging" })).toThrow(
      'NODE_ENV must be development, test, or production (received "staging")',
    );
  });

  test("enforces a conservative request body limit before route handling", async () => {
    class Controller {
      routes(app: StarpodElysia) {
        return app.post("/", () => "handled");
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({ name: "bodylimit", prefix: "/bodylimit", controller: Controller })],
      }),
      { printFeatures: false, seal: false, maxRequestBodyBytes: 8 },
    );

    const response = await server.handle(new Request("http://localhost/bodylimit/", {
      method: "POST",
      headers: { "content-length": "9" },
    }));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
    await disposeBootstrap(server);
  });

  test("supports explicit child-scope provider overrides", async () => {
    class Clock {
      now() {
        return "real";
      }
    }

    class Controller {
      static readonly inject = [Clock] as const;

      constructor(private readonly clock: Clock) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => this.clock.now());
      }
    }

    const fakeClock = { now: () => "fake" };
    const server = await bootstrap(
      application({
        features: [pod({ name: "bootstrap", prefix: "/bootstrap", controller: Controller })],
        providers: [Clock],
      }),
      {
        printFeatures: false,
        seal: false,
        overrides: [provideValue(Clock, fakeClock)],
      },
    );

    const response = await server.handle(new Request("http://localhost/bootstrap/"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("fake");
  });

  test("overrides feature-local providers without changing feature wiring", async () => {
    class FeatureClock {
      now() {
        return "real";
      }
    }

    class Controller {
      static readonly inject = [FeatureClock] as const;

      constructor(private readonly clock: FeatureClock) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => this.clock.now());
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({
          name: "featureoverride",
          prefix: "/featureoverride",
          controller: Controller,
          providers: [FeatureClock],
        })],
      }),
      {
        printFeatures: false,
        seal: false,
        overrides: [provideValue(FeatureClock, { now: () => "fake" })],
      },
    );

    const response = await server.handle(new Request("http://localhost/featureoverride/"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("fake");
  });

  test("preserves startup failures when cleanup also fails", async () => {
    class BrokenProvider {
      initialize() {
        throw new Error("startup failed");
      }

      dispose() {
        throw new Error("cleanup failed");
      }
    }

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", () => "never reached");
      }
    }

    let failure: unknown;
    try {
      await bootstrap(
        application({
          features: [pod({ name: "broken", prefix: "/broken", controller: Controller })],
          providers: [BrokenProvider],
        }),
        { printFeatures: false, seal: false },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).message).toBe("application bootstrap failed");
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect(String((failure as AggregateError).errors[0])).toContain("startup failed");
    expect(String((failure as AggregateError).errors[1])).toContain("cleanup failed");
  });

  test("boots controllers that depend on async infrastructure providers", async () => {
    type AsyncService = { readonly value: string };
    const SERVICE = token<AsyncService>("SERVICE");

    class Controller {
      static readonly inject = [SERVICE] as const;

      constructor(private readonly service: AsyncService) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => this.service.value);
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({ name: "asyncbootstrap", prefix: "/asyncbootstrap", controller: Controller })],
        providers: [provideAsyncFactory(SERVICE, [], async () => ({ value: "ready" }))],
      }),
      { printFeatures: false, seal: false },
    );

    const response = await server.handle(new Request("http://localhost/asyncbootstrap/"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ready");
  });
});
