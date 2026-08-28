import { bootstrap } from "starpod";
import { app } from "./app";

const server = await bootstrap(app);

const port = Number(Bun.env.PORT ?? 3000);
server.listen(port);

console.log(`  listening on http://localhost:${server.server?.port}\n`);
