import { describe, expect, test } from "bun:test";
import { correlationIdFrom, requestIdFrom } from "../src/kernel/http";

describe("HTTP request identity", () => {
  test("accepts safe caller-provided request IDs", () => {
    const value = requestIdFrom(new Headers({ "x-request-id": "trace-2026-09-24.1" }));

    expect(value).toBe("trace-2026-09-24.1");
  });

  test("rejects header injection characters and oversized IDs", () => {
    const unsafe = (value: string) => ({ get: () => value }) as unknown as Headers;

    expect(requestIdFrom(unsafe("trace\nforged-header"))).not.toBe("trace\nforged-header");
    expect(requestIdFrom(unsafe("x".repeat(129)))).not.toBe("x".repeat(129));
  });

  test("accepts a safe upstream correlation ID and falls back to the request ID", () => {
    const unsafe = (value: string) => ({ get: () => value }) as unknown as Headers;

    expect(correlationIdFrom(new Headers({ "x-correlation-id": "trace-group-1" }), "request-1"))
      .toBe("trace-group-1");
    expect(correlationIdFrom(new Headers(), "request-1")).toBe("request-1");
    expect(correlationIdFrom(unsafe("bad\nvalue"), "request-1"))
      .toBe("request-1");
  });
});
