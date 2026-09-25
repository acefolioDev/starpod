import { describe, expect, test } from "bun:test";
import { negotiateContentType } from "../src/kernel/http/content";

describe("content negotiation", () => {
  const supported = ["application/json", "text/html"] as const;

  test("uses supported order when no Accept header is supplied", () => {
    expect(negotiateContentType(new Request("http://localhost"), supported)).toBe("application/json");
  });

  test("honors quality and wildcard media ranges", () => {
    const request = new Request("http://localhost", {
      headers: { accept: "text/*;q=0.8, application/json;q=0.9" },
    });
    expect(negotiateContentType(request, supported)).toBe("application/json");
    expect(negotiateContentType(new Request("http://localhost", {
      headers: { accept: "image/png, */*;q=0.1" },
    }), supported)).toBe("application/json");
  });

  test("uses the most specific matching media range", () => {
    const request = new Request("http://localhost", {
      headers: { accept: "text/*;q=1, text/html;q=0" },
    });
    expect(negotiateContentType(request, ["text/html", "text/plain"])).toBe("text/plain");
  });

  test("returns undefined when every supported type is rejected", () => {
    expect(negotiateContentType(new Request("http://localhost", {
      headers: { accept: "application/json;q=0" },
    }), supported)).toBeUndefined();
  });

  test("rejects invalid supported media types", () => {
    expect(() => negotiateContentType(new Request("http://localhost"), ["json"])).toThrow("Invalid media type");
  });
});
