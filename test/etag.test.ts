import { describe, expect, test } from "bun:test";
import { Elysia, t } from "elysia";
import { etag } from "../src/kernel/http/etag";

describe("ETag responses", () => {
  test("adds a stable validator and returns 304 for a matching request", async () => {
    const app = new Elysia().use(etag({ cacheControl: "private, max-age=30" })).get(
      "/value",
      () => ({ value: "hello" }),
      { response: t.Object({ value: t.String() }) },
    );

    const first = await app.handle(new Request("http://localhost/value"));
    const validator = first.headers.get("etag");

    expect(first.status).toBe(200);
    expect(validator).toMatch(/^"[0-9a-f]{64}"$/);
    expect(first.headers.get("cache-control")).toBe("private, max-age=30");

    const second = await app.handle(new Request("http://localhost/value", {
      headers: { "if-none-match": validator ?? "" },
    }));

    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(validator);
    expect(await second.text()).toBe("");
  });

  test("supports wildcard and weak conditional validators", async () => {
    const app = new Elysia().use(etag({ weak: true })).get("/value", () => "hello");

    const response = await app.handle(new Request("http://localhost/value", {
      headers: { "if-none-match": "W/\"different\", \"other\", *" },
    }));

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toMatch(/^W\/"[0-9a-f]{64}"$/);
  });

  test("does not consume streams or large responses", async () => {
    const app = new Elysia()
      .use(etag({ maxBodyBytes: 4 }))
      .get("/stream", () => new ReadableStream({
        start(controller) {
          controller.enqueue("stream");
          controller.close();
        },
      }))
      .get("/large", () => "large");

    const stream = await app.handle(new Request("http://localhost/stream"));
    const large = await app.handle(new Request("http://localhost/large"));

    expect(stream.headers.has("etag")).toBe(false);
    expect(large.headers.has("etag")).toBe(false);
  });

  test("rejects unsafe configuration", () => {
    expect(() => etag({ methods: [] })).toThrow();
    expect(() => etag({ maxBodyBytes: 0 })).toThrow();
    expect(() => etag({ cacheControl: "public\r\nX-Evil: true" })).toThrow();
  });
});
