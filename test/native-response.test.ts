import { describe, expect, test } from "bun:test";
import { bootstrap, disposeBootstrap } from "../src/kernel/application/bootstrap";
import { application, pod } from "../src/kernel/application/feature";
import { injectHandler } from "../src/kernel/http/handler";
import type { StarpodElysia } from "../src/kernel/http/http";

describe("native Elysia responses", () => {
  test("preserves a Response thrown by a controller", async () => {
    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", () => {
          throw new Response("redirected", {
            status: 302,
            headers: { location: "/target" },
          });
        });
      }
    }

    const server = await bootstrap(
      application({ features: [pod({ name: "native", prefix: "/native", controller: Controller })] }),
      { printFeatures: false, seal: false },
    );

    const response = await server.handle(new Request("http://localhost/native/"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/target");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.text()).toBe("redirected");
    await disposeBootstrap(server);
  });

  test("keeps request resources alive for a thrown streaming Response", async () => {
    const events: string[] = [];
    class Resource {
      static readonly lifetime = "request" as const;

      dispose() {
        events.push("dispose");
      }
    }
    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", injectHandler([Resource], (_, resource) => {
          void resource;
          throw new Response(new ReadableStream({
            start(controller) {
              controller.enqueue("stream");
              controller.close();
            },
          }));
        }));
      }
    }

    const server = await bootstrap(
      application({ features: [pod({ name: "nativestream", prefix: "/native-stream", controller: Controller, providers: [Resource] })] }),
      { printFeatures: false, seal: false },
    );
    const response = await server.handle(new Request("http://localhost/native-stream/"));

    expect(events).toEqual([]);
    expect(await response.text()).toBe("stream");
    expect(events).toEqual(["dispose"]);
    await disposeBootstrap(server);
  });
});
