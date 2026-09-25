# Petcare production-shaped example

This example demonstrates how a larger Starpod application stays explicit:
the feature owns its controller and service, while shared cache and event
adapters are application providers. It also installs native Elysia-compatible
health, CORS, rate-limit, and ETag plugins.

The adapters are process-local so the example runs without infrastructure.
Replace `MemoryCache`, `MemoryRateLimitStore`, and `EventBus` with shared
PostgreSQL, Redis, and broker-backed adapters before deploying multiple
instances. The application-owned boundaries are intentional.

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run dev
```

Try the API:

```bash
curl http://localhost:3000/pets
curl -X POST http://localhost:3000/pets \
  -H 'content-type: application/json' \
  -d '{"name":"Milo","species":"cat"}'
```
