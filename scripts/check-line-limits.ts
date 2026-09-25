import { join } from "node:path";

const glob = new Bun.Glob("**/*.ts");
const violations: string[] = [];
let checked = 0;

for (const directory of ["src", "test"]) {
  const root = join(import.meta.dir, "..", directory);
  for await (const relative of glob.scan({ cwd: root, onlyFiles: true })) {
    const path = join(root, relative);
    const text = await Bun.file(path).text();
    const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n").length : text.split("\n").length;
    checked += 1;
    if (lines > 250) violations.push(`${directory}/${relative}: ${lines} lines (maximum 250)`);
  }
}

if (violations.length > 0) {
  console.error("Source line limit failed:");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`Source line limit passed for ${checked} TypeScript files.`);
