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
  }

  const gitignoreDest = join(target, ".gitignore");
  const gitignoreSrc = join(templateRoot, "gitignore");
  if (!(await Bun.file(gitignoreDest).exists()) && (await Bun.file(gitignoreSrc).exists())) {
    await cp(gitignoreSrc, gitignoreDest);
  }

  await mergeScripts(pkgPath);
  console.log("\n  ◆  starpod project ready — hello is lit\n  │    bun run dev\n");
}

async function mergeScripts(pkgPath: string) {
  if (!(await Bun.file(pkgPath).exists())) return;
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  pkg.scripts = {
    ...pkg.scripts,
    dev: pkg.scripts?.dev ?? "bun --watch src/main.ts",
    start: pkg.scripts?.start ?? "bun src/main.ts",
    seal: pkg.scripts?.seal ?? "starpod seal",
  };
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
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
