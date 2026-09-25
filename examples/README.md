# Starpod examples

These applications are intentionally small and executable. They show the same
architecture at different sizes without adding decorators or hiding Elysia.

| Example | Purpose |
| --- | --- |
| `minimal-api` | The smallest controller, pod, and native Elysia route. |
| `rest-api` | Typed request/response schemas, constructor DI, and a repository boundary. |
| `petcare` | A production-shaped composition with cache, events, security, health, and deployment files. |

The examples in this repository resolve `starpod` to the checked-out kernel
through `tsconfig.json`, so they exercise the code being developed here. A
published application uses the normal package import after installing
`starpod` from its registry release.

From an example directory:

```bash
bun install
bun run check
bun run dev
```

The `petcare` example uses process-local adapters so it stays runnable without
external services. Its README marks the exact boundaries to replace with
PostgreSQL, Redis, a broker, and an OpenTelemetry SDK in a real deployment.
