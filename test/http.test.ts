import { describe, expect, test } from "bun:test";
import { clientIp } from "../src/kernel/http/client-address";
import { correlationIdFrom, requestIdFrom } from "../src/kernel/http/http";

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

  test("uses the peer address unless an explicit trusted proxy forwards a valid chain", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.2" },
    });

    expect(clientIp(request, { peerAddress: "198.51.100.4" })).toBe("198.51.100.4");
    expect(clientIp(request, {
      peerAddress: "10.0.0.3",
      trustProxy: (address) => address.startsWith("10."),
    })).toBe("203.0.113.10");
  });

  test("ignores malformed forwarding chains and rejects invalid peer addresses", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.10, forged" },
    });

    expect(clientIp(request, { peerAddress: "10.0.0.3", trustProxy: true })).toBe("10.0.0.3");
    expect(() => clientIp(request, { peerAddress: "not-an-ip" })).toThrow("valid IPv4 or IPv6");
  });
});
