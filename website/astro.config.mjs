import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://starpod.dev",
  output: "static",
  build: { inlineStylesheets: "auto" },
});
