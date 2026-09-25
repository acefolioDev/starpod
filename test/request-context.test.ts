import { describe, expect, test } from "bun:test";
import { bootstrap, disposeBootstrap } from "../src/kernel/application/bootstrap";
import { application, pod } from "../src/kernel/application/feature";
import { injectHandler } from "../src/kernel/http/handler";
import { REQUEST_CONTEXT, type StarpodElysia, type StarpodRequestContext } from "../src/kernel/http/http";

describe("constructor-injected request context", () => {
  test("provides native request data to request-scoped services", async () => {
    class RequestDetails {
      static readonly lifetime = "request" as const;
      static readonly inject = [REQUEST_CONTEXT] as const;

      constructor(private readonly context: StarpodRequestContext) {}

      read() {
        return {
          method: this.context.request.method,
          route: this.context.route,
          requestId: this.context.requestId,
          correlationId: this.context.correlationId,
          traceparent: this.context.traceContext?.traceparent,
        };
      }
    }

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", injectHandler([RequestDetails], (_, details) => details.read()));
      }
    }

    const server = await bootstrap(application({
      features: [pod({
        name: "context",
        prefix: "/context",
        controller: Controller,
        providers: [RequestDetails],
      })],
    }), { printFeatures: false, seal: false });

    const response = await server.handle(new Request("http://localhost/context/", {
      headers: {
        "x-request-id": "request-1",
        "x-correlation-id": "correlation-1",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "GET",
      route: "/context/",
      requestId: "request-1",
      correlationId: "correlation-1",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    await disposeBootstrap(server);
  });
});
