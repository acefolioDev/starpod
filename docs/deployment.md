# Deployment

Starpod targets Bun ESM applications. A minimal production shape is:

```dockerfile
FROM oven/bun:1.4.0
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production
COPY src ./src
USER bun
CMD ["bun", "run", "start"]
```

Use `bun run start` or `bun src/main.ts`, not watch mode. Keep `bun.lock` in the release context, run as a non-root user, and do not copy `.env` files or development dependencies into the image.

Expose health routes and configure the orchestrator to use `/health/live` for liveness and `/health/ready` for readiness. Give the process a termination grace period long enough for native Elysia, request scopes, queues, and providers to drain.

## Production boundary

Starpod provides explicit composition, DI/lifecycle ownership, native HTTP hooks, request identity, structured errors, health routes, diagnostics, and adapters. Your application/deployment still owns:

- database driver, schema, migrations policy, backups, and credentials;
- durable queues, event brokers, outbox storage, and distributed idempotency;
- distributed cache, locks, rate limiting, and brute-force state;
- identity provider, key rotation, MFA, authorization, and tenant isolation;
- OpenTelemetry SDK/exporters, log retention, alerting, and dashboards;
- TLS termination, network egress, secrets injection, image scanning, and rollout policy.

## Checklist

- Pin Bun, Starpod, Elysia, and lockfile dependencies.
- Run `starpod audit --production --strict` and `starpod doctor --production --strict`.
- Run `starpod seal`, typecheck, tests, and migration checks in CI.
- Validate required environment with `defineConfig()`.
- Configure request limits, security headers, authentication, authorization, CORS/CSRF, and rate limits.
- Use shared stores for every cross-replica guarantee.
- Configure structured logs, metrics, traces, alerts, and sensitive-data redaction.
- Test readiness during drain and provider disposal.

## Common mistakes

- Scaling replicas while leaving caches, locks, rate limits, or queues in memory.
- Running migrations independently on every startup without a shared lock.
- Assuming container non-root settings replace application authorization.
- Deploying an unpinned alpha dependency.

