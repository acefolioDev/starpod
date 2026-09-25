import { describe, expect, test } from "bun:test";
import { bootstrap, disposeBootstrap } from "../src/kernel/application/bootstrap";
import { application, pod } from "../src/kernel/application/feature";
import type { StarpodElysia } from "../src/kernel/http/http";
import type { Metrics, Span, TraceContext, Tracer } from "../src/kernel/observability/observability";

describe("request telemetry", () => {
  test("creates and closes success and error spans", async () => {
    type SpanRecord = {
      readonly name: string;
      readonly attributes: Record<string, string | number | boolean>;
      status?: "ok" | "error";
      exception?: unknown;
      parent?: TraceContext;
      ended: boolean;
    };
    const records: SpanRecord[] = [];
    const tracer: Tracer = {
      startSpan(name, initialAttributes, parent): Span {
        const record: SpanRecord = {
          name,
          attributes: Object.fromEntries(
            Object.entries(initialAttributes ?? {}).filter((entry): entry is [string, string | number | boolean] =>
              entry[1] !== undefined,
            ),
          ),
          parent,
          ended: false,
        };
        records.push(record);
        return {
          setAttribute(attribute, value) {
            record.attributes[attribute] = value;
          },
          recordException(error) {
            record.exception = error;
          },
          setStatus(status) {
            record.status = status;
          },
          end() {
            record.ended = true;
          },
        };
      },
    };

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/users/:id", () => "ok").get("/error", () => {
          throw new Error("handler failed");
        });
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({ name: "telemetry", prefix: "/telemetry", controller: Controller })],
      }),
      { printFeatures: false, seal: false, tracer },
    );

    const success = await server.handle(new Request("http://localhost/telemetry/users/7", {
      headers: {
        "x-request-id": "trace-1",
        "x-correlation-id": "group-1",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
    }));
    const failure = await server.handle(new Request("http://localhost/telemetry/error", {
      headers: { "x-request-id": "trace-2" },
    }));

    expect(success.status).toBe(200);
    expect(failure.status).toBe(500);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      name: "http.server",
      attributes: {
        "http.method": "GET",
        "http.route": "/telemetry/users/:id",
        "starpod.request.id": "trace-1",
        "starpod.correlation.id": "group-1",
        "http.status_code": 200,
      },
      parent: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
      status: "ok",
      ended: true,
    });
    expect(records[1]).toMatchObject({
      attributes: {
        "http.route": "/telemetry/error",
        "starpod.request.id": "trace-2",
        "http.status_code": 500,
      },
      status: "error",
      ended: true,
      exception: expect.any(Error),
    });
  });

  test("records request counts and durations without affecting requests", async () => {
    const measurements: Array<{
      readonly kind: "increment" | "observe";
      readonly name: string;
      readonly labels?: Readonly<Record<string, string | number | boolean>>;
    }> = [];
    const metrics: Metrics = {
      increment(name, _value, labels) {
        measurements.push({ kind: "increment", name, labels });
      },
      observe(name, _value, labels) {
        measurements.push({ kind: "observe", name, labels });
      },
    };

    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", () => "ok");
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({ name: "metrics", prefix: "/metrics", controller: Controller })],
      }),
      { printFeatures: false, seal: false, metrics },
    );

    const response = await server.handle(new Request("http://localhost/metrics/"));

    expect(response.status).toBe(200);
    expect(measurements).toEqual([
      {
        kind: "increment",
        name: "http.server.requests",
        labels: { method: "GET", status_code: 200 },
      },
      {
        kind: "observe",
        name: "http.server.duration_ms",
        labels: { method: "GET", status_code: 200 },
      },
    ]);
  });

  test("records the status of an explicit native Response", async () => {
    const measurements: Array<Readonly<Record<string, string | number | boolean>>> = [];
    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/response", () => new Response("missing", { status: 404 }));
      }
    }
    const server = await bootstrap(
      application({
        features: [pod({ name: "nativeresponse", prefix: "/native", controller: Controller })],
      }),
      {
        printFeatures: false,
        seal: false,
        metrics: {
          increment(_name, _value, labels) {
            if (labels) measurements.push(labels);
          },
          observe() {},
        },
      },
    );

    const response = await server.handle(new Request("http://localhost/native/response"));

    expect(response.status).toBe(404);
    expect(measurements).toEqual([{ method: "GET", status_code: 404 }]);
  });

  test("isolates metrics adapter failures from request handling", async () => {
    const errors: string[] = [];
    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", () => "ok");
      }
    }

    const server = await bootstrap(
      application({
        features: [pod({ name: "metricfailure", prefix: "/metricfailure", controller: Controller })],
      }),
      {
        printFeatures: false,
        seal: false,
        metrics: {
          increment() {
            throw new Error("metrics unavailable");
          },
          observe() {},
        },
        logger: {
          info() {},
          error(event) {
            errors.push(event);
          },
        },
      },
    );

    const response = await server.handle(new Request("http://localhost/metricfailure/"));

    expect(response.status).toBe(200);
    expect(errors).toContain("telemetry.metrics.error");
  });

  test("isolates logger failures from request handling", async () => {
    class Controller {
      routes(app: StarpodElysia) {
        return app.get("/", () => "ok");
      }
    }
    const server = await bootstrap(
      application({
        features: [pod({ name: "loggerfailure", prefix: "/loggerfailure", controller: Controller })],
      }),
      {
        printFeatures: false,
        seal: false,
        logger: {
          info() { throw new Error("logger unavailable"); },
          error() { throw new Error("logger unavailable"); },
        },
      },
    );

    const response = await server.handle(new Request("http://localhost/loggerfailure/"));

    expect(response.status).toBe(200);
    await disposeBootstrap(server);
  });
});
