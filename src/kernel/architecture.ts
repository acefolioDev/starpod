import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Application, Feature } from "./feature";
import { construct, type Constructor, type Injectable } from "./di";

export class ArchitectureError extends Error {
  constructor(violations: string[]) {
    super(
      [
        "",
        "◆  architecture seal failed",
        "│  this project is easy on purpose — and strict on purpose.",
        "│  TypeScript only. Features own folders. Atlas owns paths.",
        "│",
        ...violations.map((v) => `│  ✕  ${v}`),
        "◆",
        "",
      ].join("\n"),
    );
    this.name = "ArchitectureError";
  }
}

const REQUIRED = ["atlas.ts", "controller.ts", "service.ts", "pod.ts"] as const;

function projectSrc() {
  return join(process.cwd(), "src");
}

export async function sealArchitecture(app?: Application) {
  const violations: string[] = [];
  const SRC = projectSrc();

  await rejectJavaScript(SRC, violations);
  const folders = await sealFeatures(join(SRC, "features"), violations);
  await sealInfra(join(SRC, "infra"), violations);

  if (app) {
    assertWired(app, folders, violations);
    for (const feat of app.features) {
      assertFeatureGraph(feat, app, violations);
    }
  }

  if (violations.length > 0) {
    throw new ArchitectureError(violations);
  }
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
    if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      violations.push(`${rel(path)} — TypeScript only. We are not friends with JavaScript sources.`);
    }
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

  if (features.length === 0 && !violations.some((v) => v.includes("src/features is missing"))) {
    violations.push("src/features must contain at least one feature folder");
  }

  for (const name of features.sort()) {
    if (!/^[a-z][a-z0-9]*$/.test(name)) {
      violations.push(`feature folder "${name}" must be a single lowercase word`);
    }

    const dir = join(root, name);
    const children = await readdir(dir, { withFileTypes: true });
    for (const child of children) {
      if (child.isDirectory()) {
        violations.push(`${name}/ must be flat — no nested folders (found ${child.name}/)`);
      }
    }

    const files = children.filter((c) => c.isFile()).map((c) => c.name);

    for (const suffix of REQUIRED) {
      const expected = `${name}.${suffix}`;
      if (!files.includes(expected)) {
        violations.push(`${name}/ is missing required file ${expected}`);
      }
    }

    for (const file of files) {
      if (!file.endsWith(".ts")) {
        violations.push(`${name}/ only .ts files are allowed (found ${file})`);
        continue;
      }
      if (!file.startsWith(`${name}.`)) {
        violations.push(`${name}/ every file must start with "${name}." (found ${file})`);
      }
    }

    for (const file of files.filter((f) => f.endsWith(".ts"))) {
      const source = await Bun.file(join(dir, file)).text();
      if (/\bfrom\s+["']elysia["']/.test(source) || /\bfrom\s+["']elysia\//.test(source)) {
        violations.push(`${name}/${file} must not import elysia — import from "starpod"`);
      }
      if (/\bnew\s+Elysia\b/.test(source) || /\.listen\(/.test(source)) {
        violations.push(`${name}/${file} must not create or listen on an Elysia app`);
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
  const wired = new Set(app.features.map((f) => f.atlas.name));
  for (const folder of folders) {
    if (!wired.has(folder)) {
      violations.push(`feature folder "${folder}" is not in application({ features })`);
    }
  }
  for (const name of wired) {
    if (!folders.includes(name)) {
      violations.push(`application wires "${name}" but src/features/${name} does not exist`);
    }
  }
}

function assertFeatureGraph(feat: Feature, app: Application, violations: string[]) {
  const prefix = feat.atlas.name;
  const starKeys = Object.keys(feat.atlas.stars);
  const proto = feat.controller.prototype as Record<string, unknown>;
  const handlers = ownHandlers(proto);

  const missing = starKeys.filter((key) => typeof proto[key] !== "function");
  const orphans = handlers.filter((key) => !(key in feat.atlas.stars));
  if (missing.length) {
    violations.push(`${prefix}: stars with no handler: ${missing.join(", ")}`);
  }
  if (orphans.length) {
    violations.push(`${prefix}: handlers with no star: ${orphans.join(", ")}`);
  }

  const infra = app.infra as Injectable[];
  const allowed = new Set<Constructor>([
    feat.controller,
    ...feat.register,
    ...feat.uses,
    ...infra,
  ]);
  const cache = new Map<Constructor, unknown>();
  try {
    for (const ctor of infra) {
      construct(ctor, cache, new Set(infra), []);
    }
    construct(feat.controller, cache, allowed, []);
  } catch (err) {
    violations.push(`${prefix}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function ownHandlers(proto: Record<string, unknown>) {
  const names: string[] = [];
  let current: object | null = proto;
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name === "constructor") continue;
      if (typeof (current as Record<string, unknown>)[name] === "function") {
        names.push(name);
      }
    }
    current = Object.getPrototypeOf(current);
  }
  return names;
}

function rel(file: string) {
  return relative(process.cwd(), file);
}
