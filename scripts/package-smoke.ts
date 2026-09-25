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
    import { EventConsumer, EventOutbox, HttpClient, JobWorker, apiKeyFrom, clientIp, cookieValue, csrfProtection, csrfToken, doctor, etag, openTelemetryMetrics, openTelemetryTracer, plugin, start } from "starpod";
    if (typeof start !== "function" || typeof plugin !== "function" || typeof HttpClient !== "function" || typeof JobWorker !== "function" || typeof EventConsumer !== "function" || typeof EventOutbox !== "function" || typeof clientIp !== "function" || typeof openTelemetryMetrics !== "function" || typeof openTelemetryTracer !== "function" || typeof csrfProtection !== "function" || typeof csrfToken !== "function" || typeof doctor !== "function" || typeof etag !== "function") throw new Error("runtime exports missing");
    const request = new Request("http://starpod.test", { headers: { "x-api-key": "key", cookie: "session=value" } });
    if (apiKeyFrom(request) !== "key" || cookieValue(request, "session") !== "value") throw new Error("auth exports failed");
    const app = new Elysia().get("/", () => "ok");
    if (typeof app.handle !== "function") throw new Error("Elysia dependency missing");
  `}`.cwd(consumer);

  const cli = join(consumer, "node_modules/starpod/dist/cli/starpod.js");
  await Bun.$`bun ${cli} init`.cwd(consumer);
  await Bun.$`bunx tsc --noEmit -p tsconfig.json`.cwd(consumer);
  if (!(await Bun.file(join(consumer, "Dockerfile")).exists()) || !(await Bun.file(join(consumer, ".dockerignore")).exists())) {
    throw new Error("generated container files are missing");
  }
  if (!(await Bun.file(join(consumer, "Dockerfile")).text()).includes('CMD ["bun", "run", "start"]')) {
    throw new Error("generated Dockerfile does not own the production start command");
  }
  const manifest = await Bun.file(join(consumer, "deploy/kubernetes.yaml")).text();
  if (!manifest.includes("/health/ready") || !manifest.includes("runAsNonRoot: true")) {
    throw new Error("generated Kubernetes manifest is missing production probes or security settings");
  }
  const audit = JSON.parse(await Bun.$`bun ${cli} audit --json`.cwd(consumer).text()) as { ok?: boolean };
  if (audit.ok !== true) throw new Error("generated application architecture audit failed");
  const diagnosis = JSON.parse(await Bun.$`bun ${cli} doctor --json`.cwd(consumer).text()) as { ok?: boolean };
  if (diagnosis.ok !== true) throw new Error("generated application doctor reported blocking findings");
  const productionDiagnosis = JSON.parse(await Bun.$`bun ${cli} doctor --production --json`.cwd(consumer).text()) as { ok?: boolean };
  if (productionDiagnosis.ok !== true) throw new Error("generated production doctor reported blocking findings");
  await Bun.$`bun run seal`.cwd(consumer);

  const routes = JSON.parse(await Bun.$`bun ${cli} routes --json`.cwd(consumer).text()) as unknown[];
  if (!routes.some((route) => typeof route === "object" && route !== null && "path" in route)) {
    throw new Error("packaged CLI route manifest is empty");
  }
  const openapi = JSON.parse(await Bun.$`bun ${cli} openapi`.cwd(consumer).text()) as { openapi?: string };
  if (openapi.openapi !== "3.1.0") throw new Error("packaged CLI OpenAPI output is invalid");

  const help = await Bun.$`bun ${cli} --help`.cwd(consumer).text();
  if (!help.includes("starpod —") || !help.includes("starpod audit") ||
    !help.includes("starpod doctor") || !help.includes("starpod dev") ||
    !help.includes("starpod routes --json") || !help.includes("starpod make:feature")) {
    throw new Error("packaged CLI help is incomplete");
  }

  console.log("package smoke test passed");
} finally {
  await rm(workspace, { recursive: true, force: true });
}
