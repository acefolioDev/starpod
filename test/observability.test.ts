import { describe, expect, test } from "bun:test";
import { durationMilliseconds, pathFromUrl } from "../src/kernel/observability/observability";
import { observeOperation } from "../src/kernel/observability/operation";

describe("observability", () => {
  test("extracts only the URL path", () => {
    expect(pathFromUrl("https://api.example.test/users?token=secret")).toBe("/users");
  });

  test("normalizes request duration to milliseconds", () => {
    expect(durationMilliseconds(100, 101.234)).toBe(1.23);
    expect(durationMilliseconds(100, 99)).toBe(0);
  });

  test("records an error when work throws undefined", async () => {
    const outcomes: string[] = [];
    await expect(observeOperation({
      metrics: {
        increment(_name, _value, labels) { outcomes.push(String(labels?.outcome)); },
        observe() {},
      },
    }, "test.operation", () => { throw undefined; })).rejects.toBeUndefined();

    expect(outcomes).toEqual(["error"]);
  });
});
