import { describe, expect, test } from "bun:test";
import { definePolicy } from "../src/kernel/policy";

type User = { readonly id: string; readonly roles: readonly string[] };
type Post = { readonly ownerId: string; readonly published: boolean };

describe("policies", () => {
  test("supports typed resource rules and async authorization", async () => {
    const policy = definePolicy<User, Post>({
      read: ({ user, resource }) => resource.published || resource.ownerId === user.id,
      update: async ({ user, resource }) => resource.ownerId === user.id,
    });
    const user = { id: "user-1", roles: [] } as const;
    const post = { ownerId: "user-1", published: false } as const;

    expect(await policy.can("read", { user, resource: post })).toBe(true);
    await expect(policy.enforce("update", { user, resource: post })).resolves.toBeUndefined();
    await expect(policy.enforce("read", {
      user: { id: "user-2", roles: [] },
      resource: post,
    })).rejects.toThrow("You do not have permission");
  });

  test("reports unknown policy actions clearly", async () => {
    const policy = definePolicy<User, Post>({ read: () => true });

    await expect(policy.can("read", {
      user: { id: "user-1", roles: [] },
      resource: { ownerId: "user-1", published: false },
    })).resolves.toBe(true);
    await expect(policy.can("write", {
      user: { id: "user-1", roles: [] },
      resource: { ownerId: "user-1", published: false },
    })).rejects.toThrow("Unknown policy action: write");
  });
});
