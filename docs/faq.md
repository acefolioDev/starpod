# FAQ

## Is Starpod a replacement for Elysia?

No. Elysia remains the router, HTTP server, schema system, and native plugin surface. Starpod adds composition, DI scopes, lifecycle, cross-cutting boundaries, and architecture checks.

## Why no decorators?

Explicit static `inject` tuples and `routes(app)` are easy to read, typecheck, test, and run in Bun without reflection or a transform.

## What is a pod compared with a module?

A pod is Starpod’s feature descriptor: name, prefix, controller, providers, and dependency boundaries. It is an in-process composition value, not a process or deployment unit.

## How do features share a service?

Put shared infrastructure in application `providers` and list its token in `uses`. For a genuine feature dependency, `exports` the provider from one pod and `imports` that pod from the other.

## Does Starpod provide a database, broker, or ORM?

No. It provides small lifecycle and orchestration contracts. Driver, ORM, broker, durability, and deployment choices remain application-owned.

## Is `MemoryCache` or `InMemoryJobQueue` production-ready?

They are useful for local and single-process workloads. They do not coordinate replicas or survive restarts. Use shared adapters for distributed guarantees.

## How is Starpod different from Nest?

Starpod intentionally keeps Elysia’s native APIs and uses explicit values and constructors. It does not add decorators, metadata-driven modules, or a parallel controller/router abstraction.

## Can I return a `Response`?

Yes. Native `Response` objects retain their status, headers, body, and streaming lifecycle.

## What does the architecture seal guarantee?

It checks the documented project shape, wiring, imports/exports, route registrar boundary, and DI graph. It does not prove business behavior, security, availability, or deployment correctness.

## Is the alpha API stable?

No. Pin versions, read the changelog, and run `starpod audit` and `starpod doctor` in CI.

