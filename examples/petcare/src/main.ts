import {
  cors,
  etag,
  healthRoutes,
  MemoryInspector,
  rateLimit,
  start,
} from "starpod";
import { app } from "./app";

const inspector = new MemoryInspector({ maxEvents: 2_000 });
const { server } = await start(app, {
  listen: Number(Bun.env.PORT ?? 3000),
  inspector,
  securityHeaders: { hsts: { maxAge: 31_536_000 } },
  configure: (elysia) => {
    const healthy = healthRoutes(elysia);
    const corsEnabled = cors({ origin: ["http://localhost:3000"] })(healthy);
    const limited = rateLimit({ limit: 100, windowMs: 60_000 })(corsEnabled);
    return etag({ cacheControl: "private, max-age=30" })(limited);
  },
});

console.log(`listening on http://localhost:${server.server?.port}`);
