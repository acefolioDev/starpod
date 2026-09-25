# Starpod documentation

> **Experimental / working alpha:** Starpod is early-stage. APIs and conventions may change between versions. Pin Starpod and Bun versions in production, read the changelog before upgrades, and run `starpod audit` and `starpod doctor` in CI.

Starpod is an enterprise-friendly structure for Elysia applications on Bun. It adds explicit constructor dependency injection, feature boundaries called **pods**, provider lifetimes, cross-cutting HTTP boundaries, and architecture checks. Routes remain native Elysia routes. There are no decorators and no parallel router.

The core composition model, native controller routes, request scopes, typed configuration, structured errors, lifecycle handling, health routes, route inspection, and vendor-neutral observability boundaries are solid today. Database drivers, durable queues and event brokers, distributed cache and rate limiting, telemetry SDK/exporter setup, identity providers, and deployment hardening remain application-owned adapters or planned work. Treat the framework as a set of explicit boundaries, not a guarantee that your application is secure or distributed by default.

## Choose a path

- New to Starpod: [Getting started](./getting-started.md), then [Features and pods](./features-and-pods.md) and [Dependency injection](./dependency-injection.md).
- Designing a larger service: [Project structure](./project-structure.md), [Providers, uses, exports, and imports](./providers-uses-exports.md), then [Routing and controllers](./routing-and-controllers.md).
- Hardening a service: [Errors](./errors.md), [Health and shutdown](./health-and-shutdown.md), [Observability](./observability.md), [Security overview](./security/overview.md), and [Deployment](./deployment.md).
- Building async workflows: [Events](./events.md), [Jobs](./jobs.md), [Database and migrations](./database-and-migrations.md), and [Cache and locks](./cache-and-locks.md).
- Looking up a feature: use the [CLI](./cli.md), [OpenAPI and routes](./openapi-and-routes.md), [Testing](./testing.md), or [Glossary](./glossary.md).

## Documentation map

### Foundations

[Getting started](./getting-started.md) · [Project structure](./project-structure.md) · [Features and pods](./features-and-pods.md) · [Dependency injection](./dependency-injection.md) · [Providers and boundaries](./providers-uses-exports.md) · [Routing](./routing-and-controllers.md) · [Plugins](./plugins.md) · [Configuration](./configuration.md)

### Runtime capabilities

[Errors](./errors.md) · [Database](./database-and-migrations.md) · [Cache and locks](./cache-and-locks.md) · [Events](./events.md) · [Jobs](./jobs.md) · [HTTP client](./http-client.md) · [Observability](./observability.md) · [Health and shutdown](./health-and-shutdown.md) · [OpenAPI](./openapi-and-routes.md) · [Testing](./testing.md)

### Security

[Security overview](./security/overview.md) · [Authentication](./security/authentication.md) · [Sessions](./security/sessions.md) · [CORS and CSRF](./security/cors-csrf.md) · [Rate limiting](./security/rate-limiting.md) · [Brute force and signed URLs](./security/brute-force-and-signed-urls.md) · [Tenancy](./security/tenancy.md) · [Policies](./security/policies.md)

### Operations

[CLI](./cli.md) · [Deployment](./deployment.md) · [FAQ](./faq.md) · [Glossary](./glossary.md)

All application examples use Bun ESM and import the public package: `import { ... } from "starpod"`.
