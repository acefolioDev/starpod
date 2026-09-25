import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { csrfProtection, csrfToken } from "../src/kernel/csrf";

describe("CSRF protection", () => {
  test("creates URL-safe tokens and validates double-submit cookies", async () => {
    const token = csrfToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const app = csrfProtection()(new Elysia()).post("/write", () => "ok");
    const valid = await app.handle(new Request("http://localhost/write", {
      method: "POST",
      headers: { cookie: `csrf-token=${token}`, "x-csrf-token": token },
    }));
    const invalid = await app.handle(new Request("http://localhost/write", {
      method: "POST",
      headers: { cookie: `csrf-token=${token}`, "x-csrf-token": csrfToken() },
    }));

    expect(valid.status).toBe(200);
    expect(invalid.status).toBe(403);
  });

  test("does not require a token for safe methods", async () => {
    const app = csrfProtection()(new Elysia()).get("/read", () => "ok");
    const response = await app.handle(new Request("http://localhost/read"));

    expect(response.status).toBe(200);
  });

  test("rejects invalid token sizes and names", () => {
    expect(() => csrfToken(15)).toThrow("16 through 64");
    expect(() => csrfProtection({ cookieName: "bad name" })).toThrow("valid token name");
    expect(() => csrfProtection({ headerName: "bad header" })).toThrow("valid HTTP header name");
  });
});
