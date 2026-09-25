# Typed REST API

This example shows a feature that grows without changing its route model:
native Elysia schemas, constructor injection, a repository boundary, and
framework errors.

```bash
bun install
bun run dev
curl http://localhost:3000/users
curl -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Ada"}'
```

`UserRepository` is deliberately an application-owned adapter. Replace its
storage with PostgreSQL or another driver without changing the controller
contract or the feature wiring.
