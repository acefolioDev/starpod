import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { requireTenant, tenancy, tenantKey, type TenantElysia } from "../src/kernel/tenant";

describe("tenant context", () => {
  test("resolves a tenant through native Elysia context", async () => {
    const app = tenancy(() => ({ id: "tenant-1" }))(new Elysia()).get(
      "/",
      ({ tenant }) => tenant,
    );

    const response = await app.handle(new Request("http://localhost/"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "tenant-1" });
  });

  test("supports typed tenant-owned controller routes", () => {
    class Controller {
      routes(app: TenantElysia) {
        return app.get("/", ({ tenant }) => requireTenant(tenant).id);
      }
    }

    expect(new Controller().routes(new Elysia())).toBeDefined();
  });

  test("rejects missing required tenants and invalid tenant keys", async () => {
    const app = tenancy(() => null, { required: true })(new Elysia()).get("/", () => "ok");
    const response = await app.handle(new Request("http://localhost/"));

    expect(response.status).toBe(403);
    expect(() => tenantKey("tenant-1", "bad\nkey")).toThrow("Invalid tenant key");
    expect(() => requireTenant(null)).toThrow("A tenant is required");
  });

  test("keeps tenant and key components collision-safe", () => {
    expect(tenantKey("a:b", "c")).not.toBe(tenantKey("a", "b:c"));
    expect(tenantKey("tenant-1", "users:42")).toBe("tenant-1:users%3A42");
  });
});
