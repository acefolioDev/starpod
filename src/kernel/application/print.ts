import type { Feature } from "./feature";

export function printFeatures(features: readonly Feature[]) {
  const lines = [
    "",
    "  ┌─────────────────────────────────────────────┐",
    "  │  FEATURES                                   │",
    "  │  controllers own native Elysia routes      │",
    "  └─────────────────────────────────────────────┘",
    "",
  ];

  for (const feature of features) {
    lines.push(`  ◆  ${feature.name}  ${feature.prefix}`);
    lines.push(`  │    controller  ${feature.controller.name}`);
    lines.push("  ◆");
    lines.push("");
  }

  console.log(lines.join("\n"));
}
