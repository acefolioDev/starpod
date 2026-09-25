import { healthRoutes, start } from "starpod";
import { app } from "./app";

const { server } = await start(app, {
  listen: Number(Bun.env.PORT ?? 3000),
  configure: (elysia) => healthRoutes(elysia),
});

console.log(`listening on http://localhost:${server.server?.port}`);
