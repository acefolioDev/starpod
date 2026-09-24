import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { cors } from "../src/kernel/cors";

describe("CORS", () => {
  test("applies an explicit allowlist and handles preflight natively", async () => {
    const app = cors({
      origin: ["https://app.example.com"],
      credentials: true,
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization"],
      maxAgeSeconds: 600,
    })(new Elysia().get("/users", () => ({ ok: true })));

    const response = await app.handle(new Request("http://localhost/users", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "GET",
        "access-control-request-headers": "Authorization",
      },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST");
    expect(response.headers.get("access-control-max-age")).toBe("600");
  });

  test("does not allow disallowed origins and rejects wildcard credentials", async () => {
    const app = cors({ origin: ["https://app.example.com"] })(new Elysia().get("/users", () => "ok"));
    const response = await app.handle(new Request("http://localhost/users", {
      headers: { origin: "https://evil.example.com" },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(() => cors({ origin: ["*"], credentials: true })).toThrow(
      "CORS credentials cannot be used with a wildcard origin",
    );
  });

  test("supports a wildcard origin without credentials", async () => {
    const app = cors({ origin: ["*"] })(new Elysia().get("/users", () => "ok"));
    const response = await app.handle(new Request("http://localhost/users", {
      headers: { origin: "https://any.example.com" },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("vary")).toBeNull();
  });
});
