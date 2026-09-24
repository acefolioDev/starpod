import { describe, expect, test } from "bun:test";
import { bootstrap } from "../src/kernel/bootstrap";
import { application, pod } from "../src/kernel/feature";
import type { StarpodElysia } from "../src/kernel/http";

describe("native request DI", () => {
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
});
