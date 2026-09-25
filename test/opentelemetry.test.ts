import { describe, expect, test } from "bun:test";
import { openTelemetryMetrics, openTelemetryTracer, type OpenTelemetryApiLike } from "../src/kernel/observability/opentelemetry";

describe("OpenTelemetry adapters", () => {
  test("maps spans, parent propagation, status, and outbound headers", () => {
    const spans: Array<{ parent: unknown; status?: number; ended: boolean }> = [];
    const api: OpenTelemetryApiLike = {
      context: { active: () => "active" },
      trace: {
        getTracer: () => ({
          startSpan: (_name, _options, parent) => {
            const state: { parent: unknown; status?: number; ended: boolean } = { parent, ended: false };
            spans.push(state);
            return {
              setAttribute() {},
              recordException() {},
              setStatus: ({ code }) => { state.status = code; },
              end: () => { state.ended = true; },
            };
          },
        }),
        setSpan: (context, span) => `${context}:${span ? "span" : "none"}`,
      },
      propagation: {
        extract: (_context, carrier) => carrier.traceparent,
        inject: (_context, carrier, setter) => setter.set(carrier, "traceparent", "00-trace-span-flags"),
      },
      statusCodes: { ok: 1, error: 2 },
    };
    const tracer = openTelemetryTracer(api);
    const span = tracer.startSpan("http.server", { "http.method": "GET" }, {
      traceparent: "00-12345678901234567890123456789012-1234567890123456-01",
    });
    const headers = new Headers();
    tracer.inject?.(span, headers);
    span.setStatus("ok");
    span.end();

    expect(spans[0]?.parent).toBe("00-12345678901234567890123456789012-1234567890123456-01");
    expect(headers.get("traceparent")).toBe("00-trace-span-flags");
    expect(spans[0]).toMatchObject({ status: 1, ended: true });
  });

  test("caches OpenTelemetry metric instruments by metric name", () => {
    const counters: string[] = [];
    const values: number[] = [];
    const metrics = openTelemetryMetrics({
      getMeter: () => ({
        createCounter: (name) => { counters.push(name); return { add: (value) => values.push(value) }; },
        createHistogram: () => ({ record() {} }),
      }),
    });

    metrics.increment("requests");
    metrics.increment("requests", 2);
    expect(counters).toEqual(["requests"]);
    expect(values).toEqual([1, 2]);
  });
});
