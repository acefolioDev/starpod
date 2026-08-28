const METHOD_GLYPH: Record<string, string> = {
  get: "GET   ",
  post: "POST  ",
  put: "PUT   ",
  patch: "PATCH ",
  delete: "DELETE",
};

export type AtlasPrintRow = {
  name: string;
  prefix: string;
  stars: Array<{ key: string; method: string; path: string }>;
};

export function printAtlas(rows: AtlasPrintRow[]) {
  const lines: string[] = [
    "",
    "  ┌─────────────────────────────────────────────┐",
    "  │  ATLAS                                      │",
    "  │  contract-first routes · sealed at boot     │",
    "  └─────────────────────────────────────────────┘",
    "",
  ];

  for (const row of rows) {
    lines.push(`  ◆  ${row.name}  ${row.prefix}`);
    for (const s of row.stars) {
      const glyph = METHOD_GLYPH[s.method] ?? s.method.toUpperCase();
      const full = `${row.prefix}${s.path === "/" ? "" : s.path}`.replace(/\/+/g, "/");
      lines.push(`  │    ${glyph}  ${full.padEnd(22)}  ←  ${s.key}`);
    }
    lines.push("  ◆");
    lines.push("");
  }

  console.log(lines.join("\n"));
}
