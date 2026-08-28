#!/usr/bin/env bun
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sealArchitecture } from "../kernel/architecture";
import { scaffold } from "./scaffold";

const command = process.argv[2] ?? "init";

if (command === "seal") {
  const appPath = join(process.cwd(), "src/app.ts");
  if (!(await Bun.file(appPath).exists())) {
    throw new Error("src/app.ts not found — run this in a Starpod app");
  }
  const mod = (await import(pathToFileURL(appPath).href)) as {
    app: Parameters<typeof sealArchitecture>[0];
  };
  await sealArchitecture(mod.app);
  console.log("\n  ◆  architecture sealed — TypeScript features, atlas-owned paths.\n");
} else if (command === "init") {
  await scaffold(process.cwd());
} else {
  console.error(`unknown command: ${command}\n  starpod init\n  starpod seal`);
  process.exit(1);
}
