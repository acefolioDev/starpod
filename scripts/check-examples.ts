import { join } from "node:path";

const root = join(import.meta.dir, "..");
const examples = [
  ["minimal-api", "/hello/"],
  ["rest-api", "/customer/"],
  ["petcare", "/pets/"],
] as const;

for (const [name, path] of examples) {
  const directory = join(root, "examples", name);
  const child = Bun.spawn([process.execPath, "x", "tsc", "--noEmit", "-p", "tsconfig.json"], {
    cwd: directory,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`example typecheck failed: ${name}`);

  const runtime = Bun.spawn([process.execPath, "-e", `
    import { bootstrap, disposeBootstrap } from "starpod";
    import { app } from "./src/app.ts";
    const server = await bootstrap(app, { printFeatures: false });
    const response = await server.handle(new Request("http://example.test${path}"));
    if (!response.ok) throw new Error("example request failed: ${name} " + response.status);
    await disposeBootstrap(server);
  `], {
    cwd: directory,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await runtime.exited !== 0) throw new Error(`example runtime check failed: ${name}`);
}

console.log(`Example typecheck and runtime checks passed for ${examples.length} applications.`);
