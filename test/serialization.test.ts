import { describe, expect, test } from "bun:test";
import { assertJsonValue } from "../src/kernel/serialization/wire";

describe("wire serialization", () => {
  test("allows shared nested values", () => {
    const shared = { value: "safe" };

    expect(() => assertJsonValue({ first: shared, second: shared })).not.toThrow();
  });

  test("rejects only actual cycles", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => assertJsonValue(cyclic as never)).toThrow("contains a cyclic payload");
  });
});
