# Glossary: the Starpod map

These are the words you will see on the map. The metaphor is optional; the boundaries are not.

**Application** — The composition value returned by `application({ features, providers, plugins })`.

**Bootstrap** — The operation that creates the native Elysia server, applies plugins/configuration, builds DI scopes, registers feature routes, and optionally seals architecture.

**Controller** — A class with `routes(app)` that registers native Elysia routes for one feature.

**Feature** — A business boundary represented by a pod; it owns a controller, prefix, and provider scope.

**Inject** — A static tuple such as `static readonly inject = [Clock] as const` that declares constructor dependencies.

**Imports** — Feature descriptors whose exported providers are visible to another feature.

**Plugin** — A named Starpod extension with optional providers and a native Elysia `configure` function.

**Pod** — The `pod({...})` factory result that describes a feature. `Pod` and `Feature` are aliases in the public API.

**Provider** — A class, value, factory, or async factory that the DI container can resolve.

**Request scope** — A child DI container owned by one HTTP request; request-scoped values are disposed after the response or stream.

**Seal** — The architecture and graph validation performed by `sealArchitecture()` or `starpod seal`.

**Uses** — A feature declaration that documents consumption of an application-owned provider. It does not register a provider.

**Exports** — Feature-owned provider tokens intentionally made visible to importing features.

**Native Elysia** — Elysia’s actual route, hook, schema, WebSocket, streaming, and plugin API, preserved by Starpod.

**Production boundary** — The line between framework-provided composition/HTTP primitives and application-owned infrastructure, security policy, data, and deployment guarantees.
