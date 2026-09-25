import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auditArchitecture } from "../src/kernel/application/architecture";
import { application, pod } from "../src/kernel/application/feature";
import type { StarpodElysia } from "../src/kernel/http/http";

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

  test("allows nested TypeScript module folders inside a feature", async () => {
    const root = await mkdtemp(join(tmpdir(), "starpod-audit-"));
    try {
      await mkdir(join(root, "src/features/users/domain"), { recursive: true });
      await writeFile(join(root, "src/features/users/users.controller.ts"), "");
      await writeFile(join(root, "src/features/users/users.pod.ts"), "");
      await writeFile(join(root, "src/features/users/domain/repository.ts"), "");

      const report = await auditArchitecture(undefined, { root });

      expect(report).toEqual({ ok: true, features: ["users"], violations: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports an invalid application provider before bootstrap", async () => {
    const root = await mkdtemp(join(tmpdir(), "starpod-audit-"));
    try {
      await mkdir(join(root, "src/features/hello"), { recursive: true });
      await writeFile(join(root, "src/features/hello/hello.controller.ts"), "");
      await writeFile(join(root, "src/features/hello/hello.pod.ts"), "");

      class Missing {}
      class Broken {
        static readonly inject = [Missing] as const;
        constructor(_missing: Missing) {}
      }

      class Controller {
        routes(app: StarpodElysia) {
          return app;
        }
      }

      const report = await auditArchitecture(application({
        features: [pod({ name: "hello", prefix: "/hello", controller: Controller })],
        providers: [Broken],
      }), { root });

      expect(report.ok).toBe(false);
      expect(report.violations).toContain(
        "application: Missing is not registered. Add it to feature.providers or application.providers.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports a feature use that is not application-owned", async () => {
    const root = await mkdtemp(join(tmpdir(), "starpod-audit-"));
    try {
      await mkdir(join(root, "src/features/hello"), { recursive: true });
      await writeFile(join(root, "src/features/hello/hello.controller.ts"), "");
      await writeFile(join(root, "src/features/hello/hello.pod.ts"), "");

      class Missing {}
      class Controller {
        routes(app: StarpodElysia) {
          return app;
        }
      }

      const report = await auditArchitecture(application({
        features: [pod({ name: "hello", prefix: "/hello", controller: Controller, uses: [Missing] })],
      }), { root });

      expect(report.ok).toBe(false);
      expect(report.violations).toContain(
        "hello: used provider Missing is not registered at application scope",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("accepts a valid exported and imported feature graph", async () => {
    const root = await mkdtemp(join(tmpdir(), "starpod-audit-"));
    try {
      for (const name of ["users", "billing"]) {
        await mkdir(join(root, "src/features", name), { recursive: true });
        await writeFile(join(root, "src/features", name, `${name}.controller.ts`), "");
        await writeFile(join(root, "src/features", name, `${name}.pod.ts`), "");
      }

      class UserService {}
      class UsersController {
        routes(app: StarpodElysia) {
          return app;
        }
      }
      class BillingController {
        static readonly inject = [UserService] as const;

        constructor(_users: UserService) {}

        routes(app: StarpodElysia) {
          return app;
        }
      }
      const users = pod({
        name: "users",
        prefix: "/users",
        controller: UsersController,
        providers: [UserService],
        exports: [UserService],
      });
      const billing = pod({
        name: "billing",
        prefix: "/billing",
        controller: BillingController,
        imports: [users],
      });

      const report = await auditArchitecture(application({ features: [billing, users] }), { root });

      expect(report.ok).toBe(true);
      expect(report.violations).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
