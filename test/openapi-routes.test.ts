import { describe, expect, test } from "bun:test";
import { Elysia, t } from "elysia";
import { openApiDocument, openApiRoutes } from "../src/kernel";

describe("OpenAPI routes", () => {
  test("serves the document through a native hidden Elysia route", async () => {
    const app = new Elysia().get("/users", () => ({ id: "user-1" }), {
      response: t.Object({ id: t.String() }),
      detail: { operationId: "getUser" },
    });

    openApiRoutes(app, { title: "Users API", version: "1.0.0" });
    const response = await app.handle(new Request("http://localhost/openapi.json"));
    const document = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(document).toMatchObject({
      openapi: "3.1.0",
      paths: { "/users": { get: { operationId: "getUser" } } },
    });
    expect(document.paths).not.toHaveProperty("/openapi.json");
    expect(openApiDocument(app, { title: "Users API", version: "1.0.0" }).paths)
      .not.toHaveProperty("/openapi.json");
  });

  test("rejects unsafe document paths", () => {
    const app = new Elysia();
    expect(() => openApiRoutes(app, { title: "API", version: "1", path: "docs" as `/${string}` }))
      .toThrow("absolute path");
    expect(() => openApiRoutes(app, { title: "API", version: "1", path: "/openapi.json?raw" as `/${string}` }))
      .toThrow("query or fragment");
  });
});
