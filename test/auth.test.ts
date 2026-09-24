import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import {
  authentication,
  bearerToken,
  requirePermission,
  requireRole,
  requireUser,
} from "../src/kernel/auth";

describe("authentication", () => {
  test("extracts only a well-formed bearer token", () => {
    const request = new Request("http://localhost", {
      headers: { authorization: "Bearer token-123" },
    });

    expect(bearerToken(request)).toBe("token-123");
    expect(bearerToken(new Request("http://localhost"))).toBeUndefined();
    expect(
      bearerToken(new Request("http://localhost", { headers: { authorization: "Basic abc" } })),
    ).toBeUndefined();
  });

  test("resolves an authenticated principal through native Elysia context", async () => {
    const app = authentication(async (request) =>
      bearerToken(request) === "valid" ? { id: "user-1" } : null,
    )(new Elysia()).get("/me", ({ user }) => user);

    const response = await app.handle(
      new Request("http://localhost/me", { headers: { authorization: "Bearer valid" } }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "user-1" });
  });

  test("returns an authentication error when required auth is absent", async () => {
    const app = authentication(() => null, { required: true })(new Elysia()).get("/private", () => "ok");
    const response = await app.handle(new Request("http://localhost/private"));

    expect(response.status).toBe(401);
  });

  test("provides explicit authorization guards", () => {
    const user = { id: "user-1", roles: ["admin"], permissions: ["users:read"] } as const;

    expect(requireUser(user)).toBe(user);
    expect(requireRole(user, "admin")).toBe(user);
    expect(requirePermission(user, "users:read")).toBe(user);
    expect(() => requireRole(user, "owner")).toThrow("You do not have permission");
    expect(() => requirePermission(user, "users:write")).toThrow("You do not have permission");
  });
});
