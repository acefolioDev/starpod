import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Application, Feature } from "./feature";
import { Container, GraphError, type Injectable } from "./di";

export class ArchitectureError extends Error {
  constructor(violations: string[]) {
    super(
      [
        "",
        "◆  architecture seal failed",
        "│  simple boundaries, explicit dependencies, native Elysia routes.",
        "│",
        ...violations.map((violation) => `│  ✕  ${violation}`),
        "◆",
        "",
      ].join("\n"),
    );
    this.name = "ArchitectureError";
  }
}

const REQUIRED = ["controller.ts", "pod.ts"] as const;

function projectSrc() {
  return join(process.cwd(), "src");
}

export async function sealArchitecture(app?: Application) {
  const violations: string[] = [];
  const src = projectSrc();

  await rejectJavaScript(src, violations);
  const folders = await sealFeatures(join(src, "features"), violations);
  await sealInfra(join(src, "infra"), violations);

  if (app) {
    assertWired(app, folders, violations);
    for (const feature of app.features) assertFeatureGraph(feature, app, violations);
  }

  if (violations.length > 0) throw new ArchitectureError(violations);
}

async function rejectJavaScript(root: string, violations: string[]) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      await rejectJavaScript(path, violations);
      continue;
    }
    if (/\.(js|mjs|cjs)$/.test(entry.name)) violations.push(`${rel(path)} — TypeScript only.`);
  }
}

async function sealFeatures(root: string, violations: string[]): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => {
    violations.push("src/features is missing");
    return [];
  });

  const features: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      violations.push(`src/features may only contain feature folders (found ${entry.name})`);
      continue;
    }
    features.push(entry.name);
  }

  if (features.length === 0 && !violations.some((violation) => violation.includes("src/features is missing"))) {
    violations.push("src/features must contain at least one feature folder");
  }

  for (const name of features.sort()) {
    if (!/^[a-z][a-z0-9]*$/.test(name)) {
      violations.push(`feature folder "${name}" must be a single lowercase word`);
    }

    const dir = join(root, name);
    const children = await readdir(dir, { withFileTypes: true });
    if (children.some((child) => child.isDirectory())) violations.push(`${name}/ must be flat — no nested folders`);

    const files = children.filter((child) => child.isFile()).map((child) => child.name);
    for (const suffix of REQUIRED) {
      const expected = `${name}.${suffix}`;
      if (!files.includes(expected)) violations.push(`${name}/ is missing required file ${expected}`);
    }

    for (const file of files) {
      if (!file.endsWith(".ts")) {
        violations.push(`${name}/ only .ts files are allowed (found ${file})`);
      } else if (!file.startsWith(`${name}.`)) {
        violations.push(`${name}/ every file must start with "${name}." (found ${file})`);
      }
    }
  }

  return features;
}

async function sealInfra(root: string, violations: string[]) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await sealInfra(path, violations);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const source = await Bun.file(path).text();
    if (source.includes("@features/") || source.includes("src/features/")) {
      violations.push(`${rel(path)} (infra) must not import features`);
    }
  }
}

function assertWired(app: Application, folders: string[], violations: string[]) {
  const wired = new Set(app.features.map((feature) => feature.name));
  for (const folder of folders) {
    if (!wired.has(folder)) violations.push(`feature folder "${folder}" is not in application({ features })`);
  }
  for (const name of wired) {
    if (!folders.includes(name)) violations.push(`application wires "${name}" but src/features/${name} does not exist`);
  }
}

function assertFeatureGraph(feature: Feature, app: Application, violations: string[]) {
  if (typeof feature.controller.prototype.routes !== "function") {
    violations.push(`${feature.name}: controller must define routes(app)`);
  }

  const container = new Container(app.providers).scope([
    ...feature.uses,
    ...feature.providers,
    feature.controller,
  ] as readonly Injectable[]);
  try {
    container.resolve(feature.controller);
  } catch (error) {
    const message = error instanceof GraphError || error instanceof Error ? error.message : String(error);
    violations.push(`${feature.name}: ${message}`);
  }
}

function rel(file: string) {
  return relative(process.cwd(), file);
}
