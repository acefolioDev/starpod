import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const templateRoot = join(packageRoot, "template");

export async function scaffold(target: string) {
  if (process.env.STARPOD_SKIP_INIT === "1") return;

  const pkgPath = join(target, "package.json");
  if (await Bun.file(pkgPath).exists()) {
    const pkg = JSON.parse(await Bun.file(pkgPath).text()) as { name?: string };
    if (pkg.name === "starpod") return;
  }

  if (await Bun.file(join(target, "src/app.ts")).exists()) {
    return;
  }

  await mkdir(join(target, "src"), { recursive: true });
  await cp(join(templateRoot, "src"), join(target, "src"), { recursive: true });

  const tsconfigDest = join(target, "tsconfig.json");
  if (!(await Bun.file(tsconfigDest).exists())) {
    await cp(join(templateRoot, "tsconfig.json"), tsconfigDest);
  } else {
    await patchTsconfig(tsconfigDest);
  }

  const gitignoreDest = join(target, ".gitignore");
  const gitignoreSrc = join(templateRoot, "gitignore");
  if (!(await Bun.file(gitignoreDest).exists()) && (await Bun.file(gitignoreSrc).exists())) {
    await cp(gitignoreSrc, gitignoreDest);
  }

  await mergePackage(pkgPath, target);
  console.log("\n  ◆  starpod project ready — hello is lit\n  │    bun run dev\n");
}

function parseJsonc(text: string): unknown {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

async function patchTsconfig(path: string) {
  const raw = parseJsonc(await readFile(path, "utf8")) as {
    compilerOptions?: Record<string, unknown>;
  };
  const opts = raw.compilerOptions;
  if (!opts) return;

  const types = opts.types;
  if (Array.isArray(types) && types.includes("bun-types")) {
    opts.types = ["bun"];
  }
  if ("baseUrl" in opts) {
    delete opts.baseUrl;
  }
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`);
}

async function mergePackage(pkgPath: string, target: string) {
  if (!(await Bun.file(pkgPath).exists())) return;
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  pkg.scripts = {
    ...pkg.scripts,
    dev: pkg.scripts?.dev ?? "bun --watch src/main.ts",
    start: pkg.scripts?.start ?? "bun src/main.ts",
    seal: pkg.scripts?.seal ?? "starpod seal",
  };
  pkg.devDependencies = {
    ...pkg.devDependencies,
    "@types/bun": pkg.devDependencies?.["@types/bun"] ?? "^1.4.0",
    "bun-types": pkg.devDependencies?.["bun-types"] ?? "^1.4.0",
    typescript: pkg.devDependencies?.typescript ?? "^5.9.0",
  };
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const missing: string[] = [];
  for (const name of ["@types/bun", "bun-types", "typescript"] as const) {
    if (!(await Bun.file(join(target, "node_modules", name, "package.json")).exists())) {
      missing.push(name);
    }
  }
  if (missing.length === 0) return;

  await Bun.$`bun add -d ${missing}`.cwd(target);
}

export async function findInstallTarget(starpodRoot: string): Promise<string | null> {
  const init = process.env.INIT_CWD ?? process.env.npm_config_local_prefix;
  if (init && init !== starpodRoot) {
    const pkgPath = join(init, "package.json");
    if (await Bun.file(pkgPath).exists()) {
      const name = (JSON.parse(await Bun.file(pkgPath).text()) as { name?: string }).name;
      if (name !== "starpod") return init;
    }
  }

  const normalized = starpodRoot.replace(/\\/g, "/");
  if (!normalized.includes("/node_modules/")) return null;

  let dir = starpodRoot;
  for (;;) {
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
    if (dir.endsWith("node_modules") || dir.endsWith("/node_modules")) continue;
    const pkgPath = join(dir, "package.json");
    if (!(await Bun.file(pkgPath).exists())) continue;
    const name = (JSON.parse(await Bun.file(pkgPath).text()) as { name?: string }).name;
    if (name === "starpod") return null;
    return dir;
  }
}
