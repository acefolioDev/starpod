import { describe, expect, test } from "bun:test";
import { durationMilliseconds, pathFromUrl } from "../src/kernel/observability/observability";

describe("observability", () => {
  test("extracts only the URL path", () => {
    expect(pathFromUrl("https://api.example.test/users?token=secret")).toBe("/users");
  });

  test("normalizes request duration to milliseconds", () => {
    expect(durationMilliseconds(100, 101.234)).toBe(1.23);
    expect(durationMilliseconds(100, 99)).toBe(0);
  });
});
