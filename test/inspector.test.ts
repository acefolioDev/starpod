import { describe, expect, test } from "bun:test";
import { MemoryInspector } from "../src/kernel/inspector";
import { bootstrap } from "../src/kernel/bootstrap";
import { application, pod } from "../src/kernel/feature";
import type { StarpodElysia } from "../src/kernel/http";

describe("inspector", () => {
  test("keeps a bounded, timestamped event history", () => {
    let now = 10;
    const inspector = new MemoryInspector({ maxEvents: 2, now: () => now++ });

    inspector.record({ type: "custom", value: 1 });
    inspector.record({ type: "custom", value: 2 });
    inspector.record({ type: "custom", value: 3 });

    expect(inspector.snapshot()).toEqual([
      { type: "custom", value: 2, recordedAt: 11 },
      { type: "custom", value: 3, recordedAt: 12 },
    ]);
    inspector.clear();
    expect(inspector.snapshot()).toEqual([]);
  });

  test("records safe native HTTP lifecycle events", async () => {
    const inspector = new MemoryInspector({ now: () => 1 });
    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/users/:id", () => "ok").get("/error", () => {
          throw new Error("failed");
        });
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({ name: "inspect", prefix: "/inspect", controller: Controller })],
      }),
      { printFeatures: false, seal: false, environment: "production", inspector },
    );

    await server.handle(new Request("http://localhost/inspect/users/42", {
      headers: { "x-request-id": "inspect-1" },
    }));
    await server.handle(new Request("http://localhost/inspect/error", {
      headers: { "x-request-id": "inspect-2" },
    }));

    expect(inspector.snapshot()).toEqual([
      expect.objectContaining({
        type: "http.request",
        requestId: "inspect-1",
        method: "GET",
        route: "/inspect/users/:id",
        status: 200,
      }),
      expect.objectContaining({
        type: "http.request",
        requestId: "inspect-2",
        method: "GET",
        route: "/inspect/error",
        status: 500,
        errorCode: "INTERNAL_SERVER_ERROR",
      }),
    ]);
    expect(JSON.stringify(inspector.snapshot())).not.toContain("/inspect/users/42");
  });
});
