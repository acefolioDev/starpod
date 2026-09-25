import { describe, expect, test } from "bun:test";
import { bootstrap, disposeBootstrap } from "../src/kernel/application/bootstrap";
import { application, pod } from "../src/kernel/application/feature";
import { inspectorRoutes } from "../src/kernel/observability/inspector-routes";
import { MemoryInspector } from "../src/kernel/observability/inspector";
import type { StarpodElysia } from "../src/kernel/http/http";

describe("inspector routes", () => {
  test("serves bounded, filtered native inspector events", async () => {
    const inspector = new MemoryInspector({ now: () => 1 });
    inspector.record({ type: "http.request", requestId: "req-1", value: "safe" });
    inspector.record({ type: "cache.get", requestId: "req-2" });

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", () => "ok");
      }
    }

    const server = await bootstrap(application({
      features: [pod({ name: "inspect", prefix: "/inspect", controller: Controller })],
    }), {
      printFeatures: false,
      seal: false,
      configure: (app) => inspectorRoutes(app, { inspector, path: "/_debug/events", maxLimit: 10 }),
    });

    const response = await server.handle(new Request("http://localhost/_debug/events?requestId=req-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      events: [{ type: "http.request", requestId: "req-1", value: "safe", recordedAt: 1 }],
    });
    await disposeBootstrap(server);
  });

  test("can be disabled without registering a route", async () => {
    const inspector = new MemoryInspector();
    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", () => "ok");
      }
    }
    const server = await bootstrap(application({
      features: [pod({ name: "inspectdisabled", prefix: "/inspect-disabled", controller: Controller })],
    }), {
      printFeatures: false,
      seal: false,
      configure: (app) => inspectorRoutes(app, { inspector, enabled: false }),
    });

    expect((await server.handle(new Request("http://localhost/_starpod/inspect"))).status).toBe(404);
    await disposeBootstrap(server);
  });
});
