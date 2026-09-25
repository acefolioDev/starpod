import { describe, expect, test } from "bun:test";
import { Elysia, t } from "elysia";
import { openApiDocument } from "../src/kernel/openapi";

describe("OpenAPI document", () => {
  test("derives paths, parameters, bodies, responses, and native detail", () => {
    const app = new Elysia()
      .get("/users/:id", () => ({ id: "user-1" }), {
        params: t.Object({ id: t.String() }),
        query: t.Object({ include: t.Optional(t.Boolean()) }),
        response: t.Object({ id: t.String() }),
        detail: { operationId: "getUser", tags: ["users"] },
      })
      .post("/users", () => ({ id: "user-1" }), {
        body: t.Object({ name: t.String() }),
        response: { 201: t.Object({ id: t.String() }) },
      })
      .get("/internal", () => "hidden", { detail: { hide: true } });

    const document = openApiDocument(app, {
      title: "Users API",
      version: "1.0.0",
      description: "A test API",
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      security: [{ bearer: [] }],
    });

    expect(document).toMatchObject({
      openapi: "3.1.0",
      info: { title: "Users API", version: "1.0.0", description: "A test API" },
      paths: {
        "/users/{id}": {
          get: {
            operationId: "getUser",
            parameters: [
              { name: "id", in: "path", required: true },
              { name: "include", in: "query", required: false },
            ],
            responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
          },
        },
        "/users": {
          post: {
            requestBody: { required: true },
            responses: { "201": { content: { "application/json": { schema: { type: "object" } } } } },
          },
        },
      },
      components: {
        schemas: {
          ErrorPayload: {
            type: "object",
            properties: { error: { type: "object" } },
          },
        },
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
      security: [{ bearer: [] }],
    });
    expect(document.paths["/users/{id}"]?.get).toMatchObject({
      responses: {
        "400": { description: "Bad request" },
        "422": { description: "Request validation failed" },
        "500": { description: "Internal server error" },
      },
    });
    expect(() => openApiDocument(app, {
      title: "Users API",
      version: "1.0.0",
      standardErrorResponses: [399],
    })).toThrow("integers from 400 through 599");
    expect(document.paths["/internal"]).toBeUndefined();
  });
});
