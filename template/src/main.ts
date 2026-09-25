import { start } from "starpod";
import { app } from "./app";

const port = Number(Bun.env.PORT ?? 3000);
const { server } = await start(app, { listen: port });

console.log(`  listening on http://localhost:${server.server?.port}\n`);
