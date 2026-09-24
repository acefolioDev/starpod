import { bootstrap, installGracefulShutdown } from "starpod";
import { app } from "./app";

const server = await bootstrap(app);

const port = Number(Bun.env.PORT ?? 3000);
server.listen(port);
installGracefulShutdown(server);

console.log(`  listening on http://localhost:${server.server?.port}\n`);
