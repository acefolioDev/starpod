#!/usr/bin/env bun
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { auditArchitecture, sealArchitecture } from "../kernel/application/architecture";
import { bootstrap, disposeBootstrap } from "../kernel/application/bootstrap";
import { doctor } from "../kernel/diagnostics/doctor";
import { openApiDocument } from "../kernel/http/openapi";
import { routeManifest } from "../kernel/http/routes";
import { scaffold } from "./scaffold";

const command = process.argv[2] ?? "init";

try {
  await run(command);
} catch (error) {
  console.error(`\n  ✕  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function run(value: string) {
  switch (value) {
    case "help":
    case "--help":
    case "-h":
      console.log(usage());
      return;
    case "init":
      await scaffold(process.cwd());
      return;
    case "seal": {
      const app = await loadApp();
      await sealArchitecture(app);
      console.log("\n  ◆  architecture sealed — explicit DI, native Elysia routes.\n");
      return;
    }
    case "audit": {
      const report = await auditArchitecture(await loadApp());
      if (process.argv.includes("--json")) {
        console.log(JSON.stringify(report, null, 2));
      } else if (report.ok) {
        const label = report.features.length === 1 ? "feature" : "features";
        console.log("\n  ✓  architecture audit passed (" + report.features.length + " " + label + ")\n");
      } else {
        const label = report.violations.length === 1 ? "violation" : "violations";
        console.log(
          "\n  ✕  architecture audit found " + report.violations.length + " " + label +
          "\n" + report.violations.map((violation) => "  - " + violation).join("\n") + "\n",
        );
      }
      if (!report.ok) process.exitCode = 1;
      return;
    }
    case "doctor": {
      const appPath = join(process.cwd(), "src/app.ts");
      const app = await Bun.file(appPath).exists() ? await loadApp() : undefined;
      const report = await doctor({ root: process.cwd(), app });
      if (process.argv.includes("--json")) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        for (const finding of report.findings) {
          const symbol = finding.severity === "error" ? "✕" : finding.severity === "warning" ? "!" : "·";
          console.log(`  ${symbol}  [${finding.code}] ${finding.message}`);
        }
        console.log(report.ok ? "\n  ✓  doctor found no blocking issues\n" : "\n  ✕  doctor found blocking issues\n");
      }
      if (!report.ok) process.exitCode = 1;
      return;
    }
    case "routes": {
      const server = await bootstrap(await loadApp(), { printFeatures: false });
      try {
        for (const route of routeManifest(server)) {
          console.log(`${route.method.padEnd(7)} ${route.path}`);
        }
      } finally {
        await disposeBootstrap(server);
      }
      return;
    }
    case "openapi": {
      const server = await bootstrap(await loadApp(), { printFeatures: false });
      try {
        const packageJson = await readPackageJson();
        console.log(JSON.stringify(openApiDocument(server, {
          title: packageJson.name ?? "Starpod API",
          version: packageJson.version ?? "0.0.0",
        }), null, 2));
      } finally {
        await disposeBootstrap(server);
      }
      return;
    }
    default:
      throw new Error(`unknown command "${value}"\n\n${usage()}`);
  }
}

async function loadApp() {
  const appPath = join(process.cwd(), "src/app.ts");
  if (!(await Bun.file(appPath).exists())) {
    throw new Error("src/app.ts not found — run this in a Starpod app");
  }
  const mod = (await import(pathToFileURL(appPath).href)) as {
    app: Parameters<typeof bootstrap>[0];
  };
  return mod.app;
}

async function readPackageJson() {
  const packagePath = join(process.cwd(), "package.json");
  if (!(await Bun.file(packagePath).exists())) return {};
  return JSON.parse(await Bun.file(packagePath).text()) as { name?: string; version?: string };
}

function usage() {
  return [
    "starpod — simple enterprise structure for Elysia",
    "",
    "Commands:",
    "  starpod init       Create the starter application structure",
    "  starpod seal       Validate architecture and the DI graph",
    "  starpod audit      Report architecture findings (add --json for CI)",
    "  starpod doctor     Check project setup and production hazards",
    "  starpod routes     Print routes registered by native Elysia APIs",
    "  starpod openapi    Print an OpenAPI document as JSON",
    "  starpod help       Show this help",
  ].join("\n");
}
