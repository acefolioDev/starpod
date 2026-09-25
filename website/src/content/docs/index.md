---
title: "Starpod documentation"
label: "Overview"
description: "Starpod is an enterprise-friendly structure for Elysia applications on Bun."
section: foundations
order: 0
---

> **Experimental / working alpha:** Starpod is early-stage. APIs and conventions may change between versions. Pin Starpod and Bun versions in production, read the changelog before upgrades, and run `starpod audit` and `starpod doctor` in CI.

Welcome aboard. Think of an Elysia application as a fast ship: Elysia is the engine and steering wheel, while Starpod gives the crew named stations, supply routes, safety checks, and a launch checklist. You still steer the ship with Elysia; Starpod makes a growing codebase easier to navigate.

Starpod is an enterprise-friendly structure for Elysia applications on Bun. It adds explicit constructor dependency injection, feature boundaries called **pods**, provider lifetimes, cross-cutting HTTP boundaries, and architecture checks. Routes remain native Elysia routes. There are no decorators and no parallel router.

The core composition model, native controller routes, request scopes, typed configuration, structured errors, lifecycle handling, health routes, route inspection, and vendor-neutral observability boundaries are solid today. Database drivers, durable queues and event brokers, distributed cache and rate limiting, telemetry SDK/exporter setup, identity providers, and deployment hardening remain application-owned adapters or planned work. Treat the framework as a set of explicit boundaries, not a guarantee that your application is secure or distributed by default.

## Choose a path

This guide teaches the “why” before the “how”. Every page starts with the idea a feature solves, then shows Starpod’s small mechanism for solving it, and ends with the boundary Starpod deliberately leaves to your application.

## The Starpod tour

If you want the scenic route, take the ship around in this order:

1. **Launchpad** — [Getting started](/docs/getting-started/): get a tiny service in orbit.
2. **Neighborhoods** — [Features and pods](/docs/features-and-pods/): give each product idea a home.
3. **Toolbelt** — [Dependency injection](/docs/dependency-injection/): bring collaborators in openly.
4. **Airlocks** — [Providers and boundaries](/docs/providers-uses-exports/): decide what may cross a feature boundary.
5. **Bridge** — [Routing and controllers](/docs/routing-and-controllers/): let native Elysia handle HTTP.
6. **Flight systems** — [Errors](/docs/errors/), [health](/docs/health-and-shutdown/), and [observability](/docs/observability/).
7. **Fleet operations** — [Security](/docs/security/overview/), [testing](/docs/testing/), and [deployment](/docs/deployment/).

- New to Starpod: [Getting started](/docs/getting-started/), then [Features and pods](/docs/features-and-pods/) and [Dependency injection](/docs/dependency-injection/).
- Designing a larger service: [Project structure](/docs/project-structure/), [Providers, uses, exports, and imports](/docs/providers-uses-exports/), then [Routing and controllers](/docs/routing-and-controllers/).
- Hardening a service: [Errors](/docs/errors/), [Health and shutdown](/docs/health-and-shutdown/), [Observability](/docs/observability/), [Security overview](/docs/security/overview/), and [Deployment](/docs/deployment/).
- Building async workflows: [Events](/docs/events/), [Jobs](/docs/jobs/), and [Cache and locks](/docs/cache-and-locks/).
- Looking up a feature: use the [CLI](/docs/cli/), [OpenAPI and routes](/docs/openapi-and-routes/), [Testing](/docs/testing/), or [Glossary](/docs/glossary/).

## Documentation map

### Foundations

[Getting started](/docs/getting-started/) · [Project structure](/docs/project-structure/) · [Features and pods](/docs/features-and-pods/) · [Dependency injection](/docs/dependency-injection/) · [Providers and boundaries](/docs/providers-uses-exports/) · [Routing](/docs/routing-and-controllers/) · [Plugins](/docs/plugins/) · [Configuration](/docs/configuration/)

### Runtime capabilities

[Errors](/docs/errors/) · [Cache and locks](/docs/cache-and-locks/) · [Events](/docs/events/) · [Jobs](/docs/jobs/) · [HTTP client](/docs/http-client/) · [Observability](/docs/observability/) · [Health and shutdown](/docs/health-and-shutdown/) · [OpenAPI](/docs/openapi-and-routes/) · [Testing](/docs/testing/)

### Security

[Security overview](/docs/security/overview/) · [Authentication](/docs/security/authentication/) · [Sessions](/docs/security/sessions/) · [CORS and CSRF](/docs/security/cors-csrf/) · [Rate limiting](/docs/security/rate-limiting/) · [Brute force and signed URLs](/docs/security/brute-force-and-signed-urls/) · [Tenancy](/docs/security/tenancy/) · [Policies](/docs/security/policies/)

### Operations

[CLI](/docs/cli/) · [Deployment](/docs/deployment/) · [FAQ](/docs/faq/) · [Glossary](/docs/glossary/)

All application examples use Bun ESM and import the public package: `import { ... } from "starpod"`.
