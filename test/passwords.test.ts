import { describe, expect, test } from "bun:test";
import { passwordService, type PasswordHasher } from "../src/kernel/security/passwords";

describe("password service", () => {
  test("enforces the application password policy and delegates hashing", async () => {
    const calls: string[] = [];
    const hasher: PasswordHasher = {
      async hash(password) { calls.push(`hash:${password}`); return `stored:${password}`; },
      async verify(password, hash) { calls.push(`verify:${password}:${hash}`); return hash === `stored:${password}`; },
    };
    const service = passwordService(hasher, { minLength: 8, maxLength: 32 });

    expect(await service.hash("correct horse")).toBe("stored:correct horse");
    expect(await service.verify("correct horse", "stored:correct horse")).toBe(true);
    expect(await service.verify("short", "stored:short")).toBe(false);
    expect(calls).toEqual(["hash:correct horse", "verify:correct horse:stored:correct horse"]);
  });

  test("rejects invalid policy and malformed stored hashes safely", async () => {
    expect(() => passwordService({ hash: async () => "", verify: async () => false }, { minLength: 0 })).toThrow("minLength");
    const service = passwordService({
      hash: async () => "hash",
      verify: async () => { throw new Error("malformed hash"); },
    });
    await expect(service.verify("valid password", "bad")).resolves.toBe(false);
    await expect(service.hash("short")).rejects.toThrow("password");
  });
});
