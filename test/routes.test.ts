import { describe, expect, test } from "bun:test";
import { Elysia, t } from "elysia";
import { routeManifest } from "../src/kernel/routes";

describe("route manifest", () => {
  test("reflects native Elysia routes and documentation metadata", () => {
    const app = new Elysia()
      .get("/users", () => [], {
        response: t.Array(t.String()),
        detail: { tags: ["users"] },
      })
      .post("/users", () => "created");

    expect(routeManifest(app)).toEqual([
      { method: "GET", path: "/users", detail: { tags: ["users"] } },
      { method: "POST", path: "/users" },
    ]);
  });
});
