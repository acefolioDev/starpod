import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const docs = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    label: z.string(),
    description: z.string(),
    section: z.enum(["foundations", "runtime", "security", "operations"]),
    order: z.number().int().nonnegative(),
  }),
});

export const collections = { docs };
