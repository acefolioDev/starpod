# Health and graceful shutdown

`healthRoutes()` registers liveness and readiness routes. Liveness answers whether the process is running. Readiness checks dependencies and returns `503` when a check fails or shutdown has begun.

```ts
import { healthRoutes, start } from "starpod";

const { server } = await start(app, {
  listen: config.port,
  configure: (elysia) => healthRoutes(elysia, {
    checks: [
      { name: "database", check: (signal) => database.ping(signal), timeoutMs: 1_000 },
    ],
  }),
});
```

Defaults are `/health/live` and `/health/ready`; both can be changed. Checks receive an `AbortSignal` and may declare a timeout. During Elysia shutdown, readiness becomes `503` while liveness remains available so an orchestrator can drain traffic.

`start()` bootstraps, calls native Elysia `listen()`, installs SIGINT/SIGTERM cleanup, and returns the native server plus an idempotent `stop()` function. For embedded runtimes use `bootstrap()` and own signal handling, then call `disposeBootstrap()` after native `server.stop()`.

## Common mistakes

- Putting a slow or mutating operation in liveness.
- Making readiness check every downstream service synchronously with no timeout.
- Forgetting to close queues, database clients, and request resources.
- Killing the process immediately on SIGTERM and skipping drain.

## Production notes

Configure orchestrator grace periods longer than the expected drain, use readiness to remove instances from traffic, and make checks cheap and bounded. Health routes are not authentication or a full dependency-monitoring system; protect detailed diagnostics and keep responses minimal.

