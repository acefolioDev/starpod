import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await mkdtemp(join(tmpdir(), "starpod-package-smoke-"));
const consumer = join(workspace, "consumer");
const tarball = join(workspace, "starpod-smoke.tgz");

try {
  await mkdir(consumer, { recursive: true });
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "starpod-package-smoke",
    private: true,
    type: "module",
  }) + "\n");

  await Bun.$`bun pm pack --filename ${tarball} --quiet`.cwd(root);
  if (!(await Bun.file(tarball).exists())) throw new Error("package tarball was not created");

  await Bun.$`bun install ${tarball}`.cwd(consumer);
  await Bun.$`bun -e ${`
    import { Elysia } from "elysia";
    import { HttpClient, apiKeyFrom, cookieValue, csrfProtection, csrfToken, start } from "starpod";
    if (typeof start !== "function" || typeof HttpClient !== "function" || typeof csrfProtection !== "function" || typeof csrfToken !== "function") throw new Error("runtime exports missing");
    const request = new Request("http://starpod.test", { headers: { "x-api-key": "key", cookie: "session=value" } });
    if (apiKeyFrom(request) !== "key" || cookieValue(request, "session") !== "value") throw new Error("auth exports failed");
    const app = new Elysia().get("/", () => "ok");
    if (typeof app.handle !== "function") throw new Error("Elysia dependency missing");
  `}`.cwd(consumer);

  const help = await Bun.$`bun node_modules/starpod/dist/cli/starpod.js --help`.cwd(consumer).text();
  if (!help.includes("starpod —") || !help.includes("starpod audit")) {
    throw new Error("packaged CLI help is incomplete");
  }

  console.log("package smoke test passed");
} finally {
  await rm(workspace, { recursive: true, force: true });
}
