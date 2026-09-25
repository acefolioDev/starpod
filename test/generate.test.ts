import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateFeature } from "../src/cli/generate";

describe("feature generator", () => {
  test("creates the documented controller, pod, and service files", async () => {
    const root = await mkdtemp(join(tmpdir(), "starpod-generate-"));
    try {
      const files = await generateFeature(root, "billing");
      expect(files).toHaveLength(3);
      expect(await readFile(join(root, "src/features/billing/billing.controller.ts"), "utf8"))
        .toContain("class BillingController");
      expect(await readFile(join(root, "src/features/billing/billing.pod.ts"), "utf8"))
        .toContain('prefix: "/billing"');
      expect(await readFile(join(root, "src/features/billing/billing.service.ts"), "utf8"))
        .toContain("class BillingService");
      await expect(generateFeature(root, "billing")).rejects.toThrow("already exists");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects names that do not match the architecture convention", async () => {
    await expect(generateFeature("/tmp", "user-profile")).rejects.toThrow("single lowercase word");
  });
});
