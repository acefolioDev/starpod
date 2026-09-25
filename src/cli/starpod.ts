#!/usr/bin/env bun
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { auditArchitecture, sealArchitecture } from "../kernel/application/architecture";
import { bootstrap, disposeBootstrap } from "../kernel/application/bootstrap";
import { doctor } from "../kernel/diagnostics/doctor";
import { openApiDocument } from "../kernel/http/openapi";
import { routeManifest } from "../kernel/http/routes";
import { generateFeature } from "./generate";
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
      const report = await doctor({
        root: process.cwd(),
        app,
        environment: process.argv.includes("--production") ? "production" : undefined,
      });
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
    case "dev":
      await runProcess(["--watch", "src/main.ts"]);
      return;
    case "start":
      await runProcess(["src/main.ts"]);
      return;
    case "test":
      await runProjectScript("test");
      return;
    case "check":
      await runProjectScript("check");
      return;
    case "build":
      await runProjectScript("build");
      return;
    case "make:feature": {
      const name = process.argv[3];
      if (!name) throw new Error("usage: starpod make:feature <name>");
      const files = await generateFeature(process.cwd(), name);
      console.log(`\n  ✓  feature created: ${files.join(", ")}\n  │  Add ${name} to application({ features }) in src/app.ts.\n`);
      return;
    }
    case "routes": {
      const server = await bootstrap(await loadApp(), { printFeatures: false });
      try {
        const routes = routeManifest(server);
        if (process.argv.includes("--json")) console.log(JSON.stringify(routes, null, 2));
        else for (const route of routes) console.log(`${route.method.padEnd(7)} ${route.path}`);
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
  return JSON.parse(await Bun.file(packagePath).text()) as {
    name?: string;
    version?: string;
    scripts?: Record<string, string>;
  };
}

async function runProjectScript(script: string) {
  const packageJson = await readPackageJson();
  if (typeof packageJson.scripts?.[script] !== "string") {
    throw new Error(`package.json has no "${script}" script`);
  }
  await runProcess(["run", script]);
}

async function runProcess(args: readonly string[]) {
  const child = Bun.spawn(["bun", ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exitCode = exitCode;
}

function usage() {
  return [
    "starpod — simple enterprise structure for Elysia",
    "",
    "Commands:",
    "  starpod init       Create the starter application structure",
    "  starpod seal       Validate architecture and the DI graph",
    "  starpod audit      Report architecture findings (add --json for CI)",
    "  starpod doctor     Check project setup and production hazards (add --production)",
    "  starpod dev        Run src/main.ts with Bun watch mode",
    "  starpod start      Run src/main.ts",
    "  starpod test       Run the project's test script",
    "  starpod check      Run the project's check script",
    "  starpod build      Run the project's build script",
    "  starpod make:feature <name>  Create a controller, pod, and service",
    "  starpod routes     Print routes registered by native Elysia APIs",
    "  starpod routes --json  Print the route manifest as JSON",
    "  starpod openapi    Print an OpenAPI document as JSON",
    "  starpod help       Show this help",
  ].join("\n");
}
