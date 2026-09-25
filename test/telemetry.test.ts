import { describe, expect, test } from "bun:test";
import { bootstrap } from "../src/kernel/bootstrap";
import { application, pod } from "../src/kernel/feature";
import type { StarpodElysia } from "../src/kernel/http";
import type { Metrics, Span, Tracer } from "../src/kernel/observability";

describe("request telemetry", () => {
  test("creates and closes success and error spans", async () => {
    type SpanRecord = {
      readonly name: string;
      readonly attributes: Record<string, string | number | boolean>;
      status?: "ok" | "error";
      exception?: unknown;
      ended: boolean;
    };
    const records: SpanRecord[] = [];
    const tracer: Tracer = {
      startSpan(name, initialAttributes): Span {
        const record: SpanRecord = {
          name,
          attributes: Object.fromEntries(
            Object.entries(initialAttributes ?? {}).filter((entry): entry is [string, string | number | boolean] =>
              entry[1] !== undefined,
            ),
          ),
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
      headers: { "x-request-id": "trace-1", "x-correlation-id": "group-1" },
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
});
