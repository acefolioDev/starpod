import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { auditArchitecture } from "../application/architecture";
import type { Application } from "../application/feature";

export type DoctorSeverity = "error" | "warning" | "info";

export type DoctorFinding = {
  readonly severity: DoctorSeverity;
  readonly code: string;
  readonly message: string;
};

export type DoctorReport = {
  readonly ok: boolean;
  readonly findings: readonly DoctorFinding[];
};

export type DoctorOptions = {
  readonly root?: string;
  readonly app?: Application;
  readonly environment?: string;
  /** Treat warnings as blocking findings for release or deployment gates. */
  readonly strict?: boolean;
};

type PackageJson = {
  readonly type?: unknown;
  readonly scripts?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly peerDependencies?: unknown;
};

/** Inspect a Starpod application for common setup and deployment hazards. */
export async function doctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const root = options.root ?? process.cwd();
  const findings: DoctorFinding[] = [];
  const packageJson = await readPackage(root, findings);

  if (packageJson) checkPackage(packageJson, findings);
  await checkProjectFiles(root, findings);
  const environment = options.environment ?? process.env.NODE_ENV;
  checkEnvironment(environment, findings);
  await checkSecretsIgnore(root, findings);
  if (environment === "production") await checkProductionFiles(root, packageJson, findings);

  if (options.app) {
    const architecture = await auditArchitecture(options.app, { root });
    for (const violation of architecture.violations) {
      findings.push({ severity: "error", code: "ARCHITECTURE", message: violation });
    }
  }

  const runtime = (globalThis as { Bun?: { version?: string } }).Bun?.version;
  if (runtime && !supportsBun(runtime)) {
    findings.push({
      severity: "error",
      code: "BUN_VERSION",
      message: `Bun ${runtime} is unsupported; Starpod requires Bun 1.4 or newer`,
    });
  }

  return Object.freeze({
    ok: !findings.some((finding) => finding.severity === "error" || (options.strict && finding.severity === "warning")),
    findings: Object.freeze(findings),
  });
}

async function readPackage(root: string, findings: DoctorFinding[]) {
  try {
    return JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageJson;
  } catch (error) {
    findings.push({
      severity: "error",
      code: "PACKAGE_JSON",
      message: `package.json is missing or invalid (${error instanceof Error ? error.message : String(error)})`,
    });
    return undefined;
  }
}

function checkPackage(pkg: PackageJson, findings: DoctorFinding[]) {
  if (pkg.type !== "module") {
    findings.push({ severity: "error", code: "PACKAGE_MODULES", message: 'package.json must set "type" to "module"' });
  }

  const dependencyGroups = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies].filter(isRecord);
  if (!dependencyGroups.some((group) => typeof group.elysia === "string")) {
    findings.push({
      severity: "error",
      code: "ELYSIA_DEPENDENCY",
      message: "package.json must declare Elysia in dependencies, devDependencies, or peerDependencies",
    });
  }

  const scripts = isRecord(pkg.scripts) ? pkg.scripts : undefined;
  if (!scripts || typeof scripts.start !== "string") {
    findings.push({
      severity: "warning",
      code: "START_SCRIPT",
      message: 'package.json has no "start" script; production process ownership is not explicit',
    });
  }
}

async function checkProjectFiles(root: string, findings: DoctorFinding[]) {
  for (const file of ["src/app.ts", "src/main.ts"] as const) {
    if (!(await Bun.file(join(root, file)).exists())) {
      findings.push({ severity: "error", code: "PROJECT_FILE", message: `${file} is missing` });
    }
  }
  try {
    await readdir(join(root, "src/features"));
  } catch {
    findings.push({ severity: "error", code: "FEATURES_DIRECTORY", message: "src/features is missing" });
  }
}

function checkEnvironment(value: string | undefined, findings: DoctorFinding[]) {
  if (value === undefined || value === "") return;
  if (value !== "development" && value !== "test" && value !== "production") {
    findings.push({
      severity: "error",
      code: "NODE_ENV",
      message: `NODE_ENV must be development, test, or production (received "${value}")`,
    });
  }
}

async function checkSecretsIgnore(root: string, findings: DoctorFinding[]) {
  let text: string;
  try {
    text = await readFile(join(root, ".gitignore"), "utf8");
  } catch {
    findings.push({ severity: "warning", code: "GITIGNORE", message: ".gitignore is missing; verify local environment files are not committed" });
    return;
  }

  const ignoresEnv = text.split(/\r?\n/).some((line) => [".env", ".env.*", ".env/"].includes(line.trim()));
  if (!ignoresEnv) {
    findings.push({ severity: "warning", code: "ENV_IGNORE", message: ".gitignore does not ignore .env files; confirm secrets cannot be committed" });
  }
}

async function checkProductionFiles(root: string, pkg: PackageJson | undefined, findings: DoctorFinding[]) {
  if (!(await Bun.file(join(root, "bun.lock")).exists())) {
    findings.push({ severity: "warning", code: "LOCKFILE", message: "bun.lock is missing; production dependency installs are not reproducible" });
  }
  const dockerfilePath = join(root, "Dockerfile");
  const dockerfile = await Bun.file(dockerfilePath).exists();
  if (!dockerfile) {
    findings.push({ severity: "warning", code: "CONTAINER_FILE", message: "Dockerfile is missing; verify the deployment artifact is defined elsewhere" });
  } else {
    if (!(await Bun.file(join(root, ".dockerignore")).exists())) {
      findings.push({ severity: "warning", code: "CONTAINER_IGNORE", message: ".dockerignore is missing; verify secrets and development files are excluded from images" });
    }
    const dockerSource = await readFile(dockerfilePath, "utf8");
    if (!/^\s*USER\s+\S+/im.test(dockerSource)) {
      findings.push({ severity: "warning", code: "CONTAINER_ROOT", message: "Dockerfile does not set a non-root USER; verify the process cannot run as root" });
    }
  }
  const start = isRecord(pkg?.scripts) && typeof pkg.scripts.start === "string" ? pkg.scripts.start : undefined;
  if (start?.includes("--watch")) {
    findings.push({ severity: "warning", code: "WATCH_START", message: 'production start script enables Bun watch mode; use a stable process command' });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function supportsBun(version: string) {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  return Number(match[1]) > 1 || (Number(match[1]) === 1 && Number(match[2]) >= 4);
}
