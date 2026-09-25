import { describe, expect, test } from "bun:test";
import { createSignedUrl, verifySignedUrl } from "../src/kernel/security/signed-url";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("signed URLs", () => {
  test("signs and verifies canonical query parameters until expiry", async () => {
    let now = 1_000;
    const signed = await createSignedUrl("https://cdn.example/file?a=1&b=two", SECRET, {
      expiresAt: 2_000,
      now: () => now,
    });

    expect(await verifySignedUrl(signed, SECRET, { now: () => now })).toBe(true);
    expect(await verifySignedUrl(signed.replace("a=1", "a=2"), SECRET, { now: () => now })).toBe(false);
    now = 2_000;
    expect(await verifySignedUrl(signed, SECRET, { now: () => now })).toBe(false);
  });

  test("rejects reserved parameters, credentials, malformed signatures, and weak secrets", async () => {
    await expect(createSignedUrl("https://cdn.example/file?_starpod_expires=1", SECRET, {
      expiresAt: 2_000,
      now: () => 1_000,
    })).rejects.toThrow("already contains");
    await expect(createSignedUrl("https://user:pass@cdn.example/file", SECRET, {
      expiresAt: 2_000,
      now: () => 1_000,
    })).rejects.toThrow("credentials");
    await expect(createSignedUrl("https://cdn.example/file", "short", {
      expiresAt: 2_000,
      now: () => 1_000,
    })).rejects.toThrow("32 UTF-8 bytes");
    expect(await verifySignedUrl("https://cdn.example/file?_starpod_expires=2000&_starpod_signature=bad", SECRET, {
      now: () => 1_000,
    })).toBe(false);
  });
});
