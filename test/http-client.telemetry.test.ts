import { describe, expect, test } from "bun:test";
import { HttpClient } from "../src/kernel/http/http-client";
import { traceContextFrom, type Span, type Tracer } from "../src/kernel/observability/observability";

describe("HttpClient telemetry", () => {
  test("creates safe client spans for successful and failed attempts", async () => {
    const spans: Array<{
      name: string;
      attributes: Record<string, string | number | boolean>;
      status?: "ok" | "error";
      exception?: unknown;
      ended: boolean;
    }> = [];
    const tracer: Tracer = {
      startSpan(name, initialAttributes): Span {
        const record: {
          name: string;
          attributes: Record<string, string | number | boolean>;
          status?: "ok" | "error";
          exception?: unknown;
          ended: boolean;
        } = {
          name,
          attributes: Object.fromEntries(
            Object.entries(initialAttributes ?? {}).filter((entry): entry is [string, string | number | boolean] =>
              entry[1] !== undefined,
            ),
          ),
          ended: false,
        };
        spans.push(record);
        return {
          setAttribute(key, value) { record.attributes[key] = value; },
          recordException(error) { record.exception = error; },
          setStatus(status) { record.status = status; },
          end() { record.ended = true; },
        };
      },
    };
    const client = new HttpClient({
      tracer,
      fetch: async (input) => input.toString().includes("failure")
        ? new Response("failed", { status: 503 })
        : new Response("ok"),
    });

    await client.text("https://api.example.test/success");
    const failure = await client.request("https://api.example.test/failure");

    expect(failure.status).toBe(503);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({
      name: "http.client",
      attributes: {
        "http.method": "GET",
        "http.url": "https://api.example.test/success",
        "http.retry_attempt": 1,
        "http.status_code": 200,
      },
      status: "ok",
      ended: true,
    });
    expect(spans[1]).toMatchObject({
      attributes: { "http.status_code": 503 },
      status: "error",
      ended: true,
      exception: expect.any(Error),
    });
  });

  test("passes validated trace context to outbound span adapters", async () => {
    const incoming = new Headers({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
    });
    const parent = traceContextFrom(incoming);
    const parents: unknown[] = [];
    let propagated = "";
    const tracer: Tracer = {
      startSpan(_name, _attributes, spanParent) {
        parents.push(spanParent);
        return {
          setAttribute() {},
          recordException() {},
          setStatus() {},
          end() {},
        };
      },
      inject(_span, headers) {
        headers.set("traceparent", "outbound-trace");
      },
    };
    const client = new HttpClient({
      tracer,
      traceContext: parent,
      fetch: async (_input, init) => {
        propagated = new Headers(init?.headers).get("traceparent") ?? "";
        return new Response("ok");
      },
    });

    await client.text("https://api.example.test/value");

    expect(parents).toEqual([parent]);
    expect(propagated).toBe("outbound-trace");
    expect(traceContextFrom(new Headers({ traceparent: "invalid" }))).toBeUndefined();
    expect(traceContextFrom(new Headers({
      traceparent: "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
    }))).toBeUndefined();
  });
});

