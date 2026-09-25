import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auditProject } from "../src/kernel/diagnostics/audit";

describe("project audit", () => {
  test("combines architecture and deployment findings", async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "starpod-audit-"));
    try {
      await mkdir(join(root, "src/features/hello"), { recursive: true });
      await mkdir(join(root, "src/infra"), { recursive: true });
      await writeFile(join(root, "src/features/hello/hello.controller.ts"), "");
      await writeFile(join(root, "src/features/hello/hello.pod.ts"), "");
      await writeFile(join(root, "src/app.ts"), "export {};");
      await writeFile(join(root, "src/main.ts"), "export {};");
      await writeFile(join(root, "package.json"), JSON.stringify({
        type: "module",
        dependencies: { elysia: "^1.4.0" },
        scripts: { start: "bun --watch src/main.ts" },
      }));
      await writeFile(join(root, ".gitignore"), ".env\n.env.*\n");

      const report = await auditProject({ root, environment: "production" });

      expect(report.ok).toBe(true);
      expect(report.architecture.ok).toBe(true);
      expect(report.doctor.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "LOCKFILE", severity: "warning" }),
        expect.objectContaining({ code: "WATCH_START", severity: "warning" }),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
