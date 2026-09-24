import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auditArchitecture } from "../src/kernel/architecture";
import { application, pod } from "../src/kernel/feature";
import type { StarpodElysia } from "../src/kernel/http";

describe("architecture audit", () => {
  test("returns a structured report for an isolated valid project", async () => {
    const root = await mkdtemp(join(tmpdir(), "starpod-audit-"));
    try {
      await mkdir(join(root, "src/features/hello"), { recursive: true });
      await mkdir(join(root, "src/infra"), { recursive: true });
      await writeFile(join(root, "src/features/hello/hello.controller.ts"), "");
      await writeFile(join(root, "src/features/hello/hello.pod.ts"), "");

      class Controller {
        routes(app: StarpodElysia) {
          return app;
        }
      }

      const report = await auditArchitecture(
        application({ features: [pod({ name: "hello", prefix: "/hello", controller: Controller })] }),
        { root },
      );

      expect(report).toEqual({
        ok: true,
        features: ["hello"],
        violations: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports filesystem and wiring violations without throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "starpod-audit-"));
    try {
      await mkdir(join(root, "src/features/hello"), { recursive: true });
      await writeFile(join(root, "src/features/hello/hello.controller.ts"), "");
      await writeFile(join(root, "src/features/hello/extra.js"), "");

      const report = await auditArchitecture(undefined, { root });

      expect(report.ok).toBe(false);
      expect(report.violations).toEqual(expect.arrayContaining([
        "hello/ is missing required file hello.pod.ts",
        "src/features/hello/extra.js — TypeScript only.",
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
