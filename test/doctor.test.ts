import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { doctor } from "../src/kernel/diagnostics/doctor";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project doctor", () => {
  test("reports missing project setup as blocking findings", async () => {
    const root = await makeRoot();
    const report = await doctor({ root, environment: "production" });

    expect(report.ok).toBe(false);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PACKAGE_JSON", severity: "error" }),
      expect.objectContaining({ code: "PROJECT_FILE", severity: "error" }),
      expect.objectContaining({ code: "FEATURES_DIRECTORY", severity: "error" }),
    ]));
  });

  test("accepts a valid project and warns about missing start ownership", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "src", "features", "hello"), { recursive: true });
    await mkdir(join(root, "src", "infra"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module", dependencies: { elysia: "^1.4.0" }, scripts: {} }));
    await writeFile(join(root, "src", "app.ts"), "export {};\n");
    await writeFile(join(root, "src", "main.ts"), "export {};\n");
    await writeFile(join(root, ".gitignore"), ".env\n.env.*\n");

    const report = await doctor({ root, environment: "production" });

    expect(report.ok).toBe(true);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "START_SCRIPT", severity: "warning" }));
  });

  test("reports reproducibility and deployment warnings in explicit production mode", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "src", "features", "hello"), { recursive: true });
    await mkdir(join(root, "src", "infra"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      type: "module",
      dependencies: { elysia: "^1.4.0" },
      scripts: { start: "bun --watch src/main.ts" },
    }));
    await writeFile(join(root, "src", "app.ts"), "export {};");
    await writeFile(join(root, "src", "main.ts"), "export {};");
    await writeFile(join(root, ".gitignore"), ".env\n.env.*\n");

    const report = await doctor({ root, environment: "production" });

    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "LOCKFILE", severity: "warning" }),
      expect.objectContaining({ code: "CONTAINER_FILE", severity: "warning" }),
      expect.objectContaining({ code: "WATCH_START", severity: "warning" }),
    ]));
  });

  test("rejects invalid environments", async () => {
    const report = await doctor({ root: await makeRoot(), environment: "prod" });
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "NODE_ENV", severity: "error" }));
  });
});

async function makeRoot() {
  const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "starpod-doctor-"));
  temporaryRoots.push(root);
  return root;
}
