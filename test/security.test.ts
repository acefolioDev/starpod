import { describe, expect, test } from "bun:test";
import { applySecurityHeaders } from "../src/kernel/security/security";

describe("security headers", () => {
  test("applies conservative API defaults", () => {
    const headers: Record<string, string | number> = {};
    applySecurityHeaders(headers);

    expect(headers).toEqual({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    });
  });

  test("requires explicit HSTS configuration", () => {
    const headers: Record<string, string | number> = {};
    applySecurityHeaders(headers, { hsts: { maxAge: 3600, preload: true } });

    expect(headers["strict-transport-security"]).toBe("max-age=3600; includeSubDomains; preload");
  });

  test("rejects invalid HSTS lifetimes", () => {
    expect(() => applySecurityHeaders({}, { hsts: { maxAge: -1 } })).toThrow(
      "Security header HSTS maxAge must be a non-negative integer",
    );
    expect(() => applySecurityHeaders({}, { hsts: { maxAge: 1.5 } })).toThrow(
      "Security header HSTS maxAge must be a non-negative integer",
    );
  });
});
