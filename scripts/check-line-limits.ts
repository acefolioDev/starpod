import { readdir } from "node:fs/promises";
import { join } from "node:path";

const glob = new Bun.Glob("**/*.ts");
const violations: string[] = [];
let checked = 0;

for (const directory of ["src", "test", "scripts", "template"]) {
  await checkDirectory(join(import.meta.dir, "..", directory), directory);
}

const examples = await readdir(join(import.meta.dir, "..", "examples"), { withFileTypes: true });
for (const example of examples) {
  if (example.isDirectory()) {
    await checkDirectory(join(import.meta.dir, "..", "examples", example.name, "src"), `examples/${example.name}/src`);
  }
}

if (violations.length > 0) {
  console.error("Source line limit failed:");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`Source line limit passed for ${checked} TypeScript files.`);

async function checkDirectory(root: string, label: string) {
  for await (const relative of glob.scan({ cwd: root, onlyFiles: true, followSymlinks: false })) {
    const path = join(root, relative);
    const text = await Bun.file(path).text();
    const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n").length : text.split("\n").length;
    checked += 1;
    if (lines > 250) violations.push(`${label}/${relative}: ${lines} lines (maximum 250)`);
  }
}
