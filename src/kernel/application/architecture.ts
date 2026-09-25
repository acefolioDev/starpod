import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Application, Feature } from "./feature";
import { featureImports, orderFeatureImports } from "./imports";
import { Container, GraphError, provideValue, providerLifetime, providerToken } from "../di/di";
import { tokenName } from "../di/helpers";
import { REQUEST_CONTEXT, type StarpodRequestContext } from "../http/http";

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

export type ArchitectureReport = {
  readonly ok: boolean;
  readonly features: readonly string[];
  readonly violations: readonly string[];
};

export type ArchitectureAuditOptions = {
  readonly root?: string;
};

const REQUIRED = ["controller.ts", "pod.ts"] as const;

function projectSrc(root: string) {
  return join(root, "src");
}

export async function sealArchitecture(app?: Application) {
  const report = await auditArchitecture(app);
  if (report.violations.length > 0) {
    throw new ArchitectureError([...report.violations]);
  }
}

export async function auditArchitecture(
  app?: Application,
  options: ArchitectureAuditOptions = {},
): Promise<ArchitectureReport> {
  const violations: string[] = [];
  const root = options.root ?? process.cwd();
  const src = projectSrc(root);

  await rejectJavaScript(src, violations, root);
  const folders = await sealFeatures(join(src, "features"), violations, root);
  await sealInfra(join(src, "infra"), violations, root);

  if (app) {
    assertWired(app, folders, violations);
    assertApplicationGraph(app, violations);
    try {
      const root = new Container(app.providers);
      const containers = new Map<Feature, Container>();
      for (const feature of orderFeatureImports(app.features)) {
        assertFeatureGraph(feature, app, violations, root, containers);
      }
    } catch (error) {
      violations.push(error instanceof Error ? error.message : String(error));
    }
  }

  return Object.freeze({
    ok: violations.length === 0,
    features: Object.freeze([...folders]),
    violations: Object.freeze([...violations]),
  });
}

async function rejectJavaScript(root: string, violations: string[], projectRoot: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      await rejectJavaScript(path, violations, projectRoot);
      continue;
    }
    if (/\.(js|mjs|cjs)$/.test(entry.name)) violations.push(`${rel(path, projectRoot)} — TypeScript only.`);
  }
}

async function sealFeatures(root: string, violations: string[], projectRoot: string): Promise<string[]> {
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
    const files = children.filter((child) => child.isFile()).map((child) => child.name);
    for (const suffix of REQUIRED) {
      const expected = `${name}.${suffix}`;
      if (!files.includes(expected)) violations.push(`${name}/ is missing required file ${expected}`);
    }
    await validateFeatureFiles(dir, name, violations, projectRoot);
  }

  return features;
}

async function validateFeatureFiles(
  directory: string,
  name: string,
  violations: string[],
  projectRoot: string,
) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await validateFeatureFiles(path, name, violations, projectRoot);
      continue;
    }
    if (entry.name.endsWith(".ts") || /\.(js|mjs|cjs)$/.test(entry.name)) continue;
    violations.push(`${name}/ only .ts files are allowed (found ${rel(path, projectRoot)})`);
  }
}

async function sealInfra(root: string, violations: string[], projectRoot: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await sealInfra(path, violations, projectRoot);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const source = await Bun.file(path).text();
    if (source.includes("@features/") || source.includes("src/features/")) {
      violations.push(`${rel(path, projectRoot)} (infra) must not import features`);
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

function assertFeatureGraph(
  feature: Feature,
  app: Application,
  violations: string[],
  root: Container,
  containers: Map<Feature, Container>,
) {
  if (typeof feature.controller.prototype.routes !== "function") {
    violations.push(`${feature.name}: controller must define routes(app)`);
  }

  const container = root.scope([...feature.providers, feature.controller], featureImports(feature, containers));
  containers.set(feature, container);
  const requestContainer = container.requestScope([
    provideValue(REQUEST_CONTEXT, {} as StarpodRequestContext),
  ]);
  try {
    container.validate(feature.controller);
    for (const token of feature.uses) {
      const provider = app.providers.find((candidate) => providerToken(candidate) === token);
      if (!provider) {
        throw new GraphError(`used provider ${tokenName(token)} is not registered at application scope`);
      }
      const scope = providerLifetime(provider) === "singleton" ? container : requestContainer;
      scope.validate(token);
    }
    for (const provider of feature.providers) {
      const scope = providerLifetime(provider) === "singleton" ? container : requestContainer;
      scope.validate(providerToken(provider));
    }
  } catch (error) {
    const message = error instanceof GraphError || error instanceof Error ? error.message : String(error);
    violations.push(`${feature.name}: ${message}`);
  }
}

function assertApplicationGraph(app: Application, violations: string[]) {
  const container = new Container(app.providers);
  const requestContainer = container.requestScope([
    provideValue(REQUEST_CONTEXT, {} as StarpodRequestContext),
  ]);
  for (const provider of app.providers) {
    try {
      const scope = providerLifetime(provider) === "singleton" ? container : requestContainer;
      scope.validate(providerToken(provider));
    } catch (error) {
      const message = error instanceof GraphError || error instanceof Error ? error.message : String(error);
      violations.push(`application: ${message}`);
    }
  }
}

function rel(file: string, root = process.cwd()) {
  return relative(root, file);
}
