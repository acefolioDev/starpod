import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function generateFeature(root: string, name: string) {
  validateFeatureName(name);
  const directory = join(root, "src/features", name);
  if (await pathExists(directory)) {
    throw new Error(`feature directory already exists: src/features/${name}`);
  }

  await mkdir(directory, { recursive: true });
  const files = new Map([
    [`${name}.controller.ts`, controllerSource(name)],
    [`${name}.pod.ts`, podSource(name)],
    [`${name}.service.ts`, serviceSource(name)],
  ]);
  try {
    for (const [file, source] of files) {
      await writeFile(join(directory, file), source, { flag: "wx" });
    }
  } catch (error) {
    throw new Error(`could not create feature "${name}" completely`, { cause: error });
  }

  return [...files.keys()].map((file) => join("src/features", name, file));
}

function validateFeatureName(name: string) {
  if (!/^[a-z][a-z0-9]*$/.test(name)) {
    throw new Error("feature name must be a single lowercase word, such as users");
  }
}

function controllerSource(name: string) {
  const className = pascal(name);
  return `import type { StarpodElysia } from "starpod";
import { ${className}Service } from "./${name}.service";

export class ${className}Controller {
  static readonly inject = [${className}Service] as const;

  constructor(private readonly service: ${className}Service) {}

  routes(app: StarpodElysia) {
    return app.get("/", () => ({ status: "ok", feature: "${name}" }));
  }
}
`;
}

function podSource(name: string) {
  const className = pascal(name);
  return `import { pod } from "starpod";
import { ${className}Controller } from "./${name}.controller";
import { ${className}Service } from "./${name}.service";

export const ${name} = pod({
  name: "${name}",
  prefix: "/${name}",
  controller: ${className}Controller,
  providers: [${className}Service],
});
`;
}

function serviceSource(name: string) {
  const className = pascal(name);
  return `export class ${className}Service {}
`;
}

function pascal(name: string) {
  return name[0]!.toUpperCase() + name.slice(1);
}

async function pathExists(path: string) {
  return Boolean(await stat(path).catch(() => undefined));
}
