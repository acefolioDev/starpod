import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { MemoryCache } from "../src/kernel/data/cache";
import { requireTenant, tenancy, tenantCache, tenantKey, validateTenantId, type TenantElysia } from "../src/kernel/security/tenant";

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
    expect(() => validateTenantId("x".repeat(257))).toThrow("at most 256 characters");
  });

  test("keeps tenant and key components collision-safe", () => {
    expect(tenantKey("a:b", "c")).not.toBe(tenantKey("a", "b:c"));
    expect(tenantKey("tenant-1", "users:42")).toBe("tenant-1:users%3A42");
  });

  test("scopes cache keys and tags to one tenant", async () => {
    const cache = new MemoryCache();
    const first = tenantCache(cache, { id: "tenant-1" });
    const second = tenantCache(cache, { id: "tenant-2" });

    await first.set("profile", { name: "Ada" }, { tags: ["profiles"] });
    expect(await first.get<{ name: string }>("profile")).toEqual({ name: "Ada" });
    expect(await second.get<{ name: string }>("profile")).toBeUndefined();
    await second.set("profile", { name: "Grace" }, { tags: ["profiles"] });
    await first.invalidateTag("profiles");
    expect(await first.get<{ name: string }>("profile")).toBeUndefined();
    expect(await second.get<{ name: string }>("profile")).toEqual({ name: "Grace" });
  });
});
