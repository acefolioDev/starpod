import { describe, expect, test } from "bun:test";
import { bootstrap, disposeBootstrap } from "../src/kernel/application/bootstrap";
import { application, pod } from "../src/kernel/application/feature";
import type { StarpodElysia } from "../src/kernel/http/http";

describe("native request DI", () => {
  test("keeps root-mounted routes inside their feature scope", async () => {
    class RootRequestContext {
      static readonly lifetime = "request" as const;
      readonly value = "feature-scope";
    }

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/nested", ({ resolve }) => resolve(RootRequestContext).value);
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({
          name: "root",
          prefix: "/",
          controller: Controller,
          providers: [RootRequestContext],
        })],
      }),
      { printFeatures: false, seal: false },
    );

    const response = await server.handle(new Request("http://localhost/nested"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("feature-scope");
    await disposeBootstrap(server);
  });

  test("keeps dynamic feature prefixes inside their feature scope", async () => {
    class DynamicRequestContext {
      static readonly lifetime = "request" as const;
      readonly value = "dynamic-feature-scope";
    }

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", ({ resolve }) => resolve(DynamicRequestContext).value);
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({
          name: "users",
          prefix: "/users/:userId",
          controller: Controller,
          providers: [DynamicRequestContext],
        })],
      }),
      { printFeatures: false, seal: false },
    );

    const response = await server.handle(new Request("http://localhost/users/user-1/"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("dynamic-feature-scope");
    await disposeBootstrap(server);
  });

  test("resolves request providers through native Elysia context and disposes them", async () => {
    const disposed: string[] = [];
    const created: string[] = [];

    class RequestContext {
      static readonly lifetime = "request" as const;
      readonly id = crypto.randomUUID();

      constructor() {
        created.push(this.id);
      }

      dispose() {
        disposed.push(this.id);
      }
    }

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", ({ resolve }) => {
          const first = resolve(RequestContext);
          const second = resolve(RequestContext);
          return { id: first.id, same: first === second };
        }).get("/error", ({ resolve }) => {
          resolve(RequestContext);
          throw new Error("request failed");
        });
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({ name: "scope", prefix: "/scope", controller: Controller, providers: [RequestContext] })],
      }),
      { printFeatures: false, seal: false },
    );

    const firstResponse = await server.handle(new Request("http://localhost/scope/"));
    const secondResponse = await server.handle(new Request("http://localhost/scope/"));
    const errorResponse = await server.handle(new Request("http://localhost/scope/error"));

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(errorResponse.status).toBe(500);
    const first = (await firstResponse.json()) as { id: string; same: boolean };
    const second = (await secondResponse.json()) as { id: string; same: boolean };
    expect(first.same).toBe(true);
    expect(second.same).toBe(true);
    expect(first.id).not.toBe(second.id);
    expect(created).toHaveLength(3);
    expect(disposed).toEqual(created);
  });

  test("accepts request providers declared at application scope", async () => {
    class ApplicationRequestContext {
      static readonly lifetime = "request" as const;
      readonly id = crypto.randomUUID();
    }

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", ({ resolve }) => resolve(ApplicationRequestContext).id);
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({ name: "appscope", prefix: "/appscope", controller: Controller })],
        providers: [ApplicationRequestContext],
      }),
      { printFeatures: false, seal: false },
    );

    const response = await server.handle(new Request("http://localhost/appscope/"));

    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("initializes request resources through the async resolver", async () => {
    const events: string[] = [];

    class RequestTransaction {
      static readonly lifetime = "request" as const;

      initialize() {
        events.push("initialize");
      }

      dispose() {
        events.push("dispose");
      }
    }

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", async ({ resolveAsync }) => {
          await resolveAsync(RequestTransaction);
          return { initialized: events.includes("initialize") };
        });
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({ name: "lifecycle", prefix: "/lifecycle", controller: Controller, providers: [RequestTransaction] })],
      }),
      { printFeatures: false, seal: false },
    );

    const response = await server.handle(new Request("http://localhost/lifecycle/"));

    expect(await response.json()).toEqual({ initialized: true });
    expect(events).toEqual(["initialize", "dispose"]);
  });

  test("keeps request resources alive while a native stream is being consumed", async () => {
    const events: string[] = [];

    class StreamResource {
      static readonly lifetime = "request" as const;

      dispose() {
        events.push("dispose");
      }
    }

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", async function* ({ resolve }) {
          resolve(StreamResource);
          yield "first";
          await new Promise((done) => setTimeout(done, 5));
          yield "second";
        });
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({ name: "stream", prefix: "/stream", controller: Controller, providers: [StreamResource] })],
      }),
      { printFeatures: false, seal: false },
    );

    const response = await server.handle(new Request("http://localhost/stream/"));
    expect(events).toEqual([]);
    expect(await response.text()).toContain("first");
    expect(events).toEqual(["dispose"]);
  });
});
