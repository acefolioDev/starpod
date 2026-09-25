import { defineConfig, env, healthRoutes, start } from "starpod";
import { app } from "./app";

const config = defineConfig({
  port: env.number("PORT", { default: 3000, min: 1, max: 65_535 }),
});
const { server } = await start(app, {
  listen: config.port,
  configure: (elysia) => healthRoutes(elysia),
});

console.log(`  listening on http://localhost:${server.server?.port}\n`);
