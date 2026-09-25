import { describe, expect, test } from "bun:test";
import { safeRedirect } from "../src/kernel/security/redirect";

describe("safe redirects", () => {
  test("allows relative application paths", () => {
    const response = safeRedirect("/users?page=2", { status: 303 });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/users?page=2");
  });

  test("requires an explicit allowlist for absolute targets", () => {
    expect(() => safeRedirect("https://evil.example/users")).toThrow("not allowed");
    const response = safeRedirect("https://app.example/users", {
      allowedOrigins: ["https://app.example"],
    });
    expect(response.headers.get("location")).toBe("https://app.example/users");
  });

  test("rejects protocol-relative, credentialed, and unsafe targets", () => {
    expect(() => safeRedirect("//evil.example")).toThrow("not allowed");
    expect(() => safeRedirect("https://user:pass@app.example/users", {
      allowedOrigins: ["https://app.example"],
    })).toThrow("without credentials");
    expect(() => safeRedirect("/users\\\\evil.example")).toThrow("unsafe characters");
  });
});
