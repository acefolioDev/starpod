# Starpod

An enterprise-friendly structure for Elysia applications: explicit constructor DI, feature boundaries, and native Elysia routes in controllers. TypeScript only. No decorators.

> Current status: working alpha. The core runtime, explicit DI, native routes, named native plugin boundary, configuration, error handling, health checks, adapter-based authentication and sessions, password hashing, brute-force protection, signed URLs, optional tenant context, request/correlation identity, request logging, bounded development inspection, vendor-neutral tracing and metrics boundaries, optional OpenTelemetry tracing/metrics bridges, security headers, CSRF protection for cookie-authenticated routes, ETags for finite responses, database lifecycle/transaction boundaries with database events, deterministic migration orchestration, typed in-process and durable-boundary events/jobs, cache primitives, rate-limit primitives, an origin-restricted outbound HTTP client, and CLI diagnostics are implemented. Vendor database adapters, durable queue/event infrastructure, distributed caching/rate limiting, OpenTelemetry SDK/exporter setup, and application deployment hardening remain application-owned or planned. Package release contents are covered by build, type, clean-consumer, scaffold, audit, doctor, and pack smoke checks.

```bash
mkdir my-app && cd my-app
bun init -y
bun add starpod
bunx starpod init
bun run dev
```

The published package contains a Bun ESM runtime bundle, generated TypeScript declarations, and the `starpod` executable. The repository keeps the source TypeScript entrypoints for development; release packaging runs the build automatically before packing.

Project initialization is explicit. Installing Starpod does not modify your application. Run `bunx starpod init` when you want the starter structure.

## Structure

```text
src/
  main.ts
  app.ts
  infra/clock.ts
  features/hello/
    hello.controller.ts
    hello.pod.ts
    hello.service.ts
```

Every feature owns a folder. Controllers own their routes. Pods wire a controller to a URL prefix and its providers. Services contain application logic. Infrastructure is shared through `application({ providers })`.
Feature folders may contain nested TypeScript modules such as `domain/`, `repositories/`, `policies/`, or `jobs/`; only the feature's controller and pod are required entrypoints. The architecture seal keeps feature files TypeScript-only without forcing every filename into one naming pattern.

The framework kernel is organized by capability so each area can grow independently:

```text
src/kernel/
  application/     bootstrap, features, lifecycle, startup, testing
  config/          typed configuration
  data/            cache, database, migrations
  diagnostics/     doctor and project diagnostics
  di/              constructor dependency injection
  errors/          typed HTTP errors and safe serialization
  events/          in-process and durable event boundaries
  http/            native HTTP context, clients, routes, OpenAPI, health, ETags
  jobs/            jobs, queues, schedulers, durable dispatch boundaries
  observability/   logs, metrics, tracing, inspection
  security/        authentication, authorization, CORS, CSRF, rate limits, tenancy
  serialization/   schemas and JSON-safe wire contracts
  index.ts         public Starpod API barrel
```

Application code should import from `starpod`. The folders are the maintainable internal boundaries of the framework and do not create a second public API surface.

## Native Elysia routes

There is no route metadata layer and no decorator. A controller receives a normal Elysia instance and uses every Elysia feature directly:

```ts
import { t } from "elysia";
import type { StarpodElysia } from "starpod";
import { HelloService } from "./hello.service";

export class HelloController {
  static readonly inject = [HelloService] as const;

  constructor(private readonly hello: HelloService) {}

  routes(app: StarpodElysia) {
    return app.get("/", ({ requestId }) => ({
      ...this.hello.greet(),
      requestId,
    }), {
      response: t.Object({ line: t.String(), requestId: t.String() }),
    });
  }
}
```

The controller contract also requires `routes(app)` to return the native Elysia instance at compile time; bootstrap checks the same boundary at runtime.

Use `import { Elysia, t } from "elysia"` anywhere in your application. Starpod does not restrict Elysia imports or wrap its route API. `StarpodElysia` is optional and only adds typed Starpod request context such as `requestId`.

## Native HTTP capabilities

Starpod keeps advanced HTTP behavior in Elysia instead of creating parallel wrappers. Controllers can use Elysia's native APIs for multipart uploads, cookies, redirects, streaming, Server-Sent Events, WebSockets, and any Elysia plugin:

```ts
routes(app: StarpodElysia) {
  return app
    .post("/upload", async ({ request }) => {
      const form = await request.formData();
      return { filename: String(form.get("file")) };
    })
    .get("/stream", () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue("data: ready\\n\\n");
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } }))
    .get("/redirect", () => Response.redirect("/users", 302));
}
```

Use `app.ws(...)` for WebSockets and native Elysia response types for downloads or SSE. Starpod's request identity, DI, errors, observability, and shutdown boundaries remain available around those routes.
Returning or throwing a native `Response` keeps its status, headers, body, and streaming lifecycle intact.

For endpoints that serve more than one representation, use the small content-negotiation helper and keep the response itself native:

```ts
import { negotiateContentType } from "starpod";

const type = negotiateContentType(request, ["application/json", "text/csv"]);
if (!type) return new Response(null, { status: 406 });
return new Response(renderReport(), { headers: { "content-type": type } });
```

## Dependency injection

DI is constructor injection with an explicit provider graph. No service locator, decorators, global singletons, or hidden reflection:

```ts
export class HelloService {
  static readonly inject = [Clock] as const;

  constructor(private readonly clock: Clock) {}
}

export const hello = pod({
  name: "hello",
  prefix: "/hello",
  controller: HelloController,
  providers: [HelloService],
});
```

Infrastructure can use typed value and factory providers without artificial wrapper classes:

```ts
import { provideFactory, provideValue, token } from "starpod";

const DATABASE_URL = token<string>("DATABASE_URL");
const DATABASE = token<Database>("DATABASE");

const database = provideFactory(DATABASE, [DATABASE_URL] as const, (url) => new Database(url));

export const app = application({
  features: [hello],
  providers: [provideValue(DATABASE_URL, config.databaseUrl), database],
});
```

Class providers, values, and factories all use the same explicit container graph.

For clients that connect asynchronously, use an async factory. Starpod resolves it once, initializes dependent providers in order, and still disposes the resulting resource through the normal provider lifecycle:

```ts
import { provideAsyncFactory, token } from "starpod";

const DATABASE = token<Database>("DATABASE");
const database = provideAsyncFactory(DATABASE, [], () => Database.connect(config.databaseUrl));
```

Async providers are resolved with `resolveAsync()` internally during bootstrap. Calling synchronous `resolve()` on one fails with an actionable graph error instead of returning a promise as a dependency.

Providers are singleton by default. Use a request scope when state must belong to one HTTP request, or a transient provider when each resolution must create a new instance:

```ts
import { injectHandler, type StarpodElysia } from "starpod";

class RequestContext {
  static readonly lifetime = "request" as const;

  constructor(readonly startedAt = Date.now()) {}
}

class ExpensiveParser {
  static readonly lifetime = "transient" as const;
}

class Controller {
  routes(app: StarpodElysia) {
    return app.get("/", injectHandler([RequestContext], (_, context) => context.startedAt));
  }
}
```

Starpod rejects singleton providers that depend on request-scoped providers, preventing request state from being captured and reused across requests.

Use `injectHandler([Token], handler)` when a native route needs request-scoped dependencies. The token list is the route boundary's explicit dependency declaration; Starpod resolves each token from the request's real child container and passes the instances to the handler. The handler receives the normal Elysia context as its first argument, so schemas, params, bodies, responses, and native Elysia features remain available. The resolver is intentionally not exposed as a route-context service locator.

Request-scoped instances and lifecycle-aware transient instances are disposed by their owning scope; request resources remain alive until native streams or iterators finish, while singleton instances remain owned by their application or feature container. Tests can override application or feature providers with a real child scope at bootstrap:

Request-scoped services can receive native request data through ordinary constructor injection with `REQUEST_CONTEXT`; this is explicit DI, not ambient state:

```ts
import { REQUEST_CONTEXT, type StarpodRequestContext } from "starpod";

class RequestAudit {
  static readonly lifetime = "request" as const;
  static readonly inject = [REQUEST_CONTEXT] as const;

  constructor(private readonly context: StarpodRequestContext) {}

  route() {
    return this.context.route;
  }
}
```

The context contains the native `Request`, route template, request ID, correlation ID, and validated incoming W3C trace context.

```ts
const server = await bootstrap(app, {
  overrides: [provideValue(DATABASE, fakeDatabase)],
});
```

Overrides shadow application providers without changing the production graph or lifetime rules.

The application composes features and shared providers in one readable place:

```ts
export const app = application({
  features: [hello],
  providers: [Clock],
});
```

Use `uses` when a feature intentionally consumes an application-level provider:

```ts
export const users = pod({
  name: "users",
  prefix: "/users",
  controller: UsersController,
  uses: [DATABASE],
  providers: [UsersService],
});
```

`uses` documents and validates the dependency boundary; it does not register a second
provider. The application-owned singleton is shared by the feature and disposed once.

Feature-to-feature dependencies use the same explicit rule. Feature `users` can export
its service, and feature `billing` can import the `users` feature:

```ts
export const users = pod({
  name: "users",
  prefix: "/users",
  controller: UsersController,
  providers: [UsersService],
  exports: [UsersService],
});

export const billing = pod({
  name: "billing",
  prefix: "/billing",
  controller: BillingController,
  imports: [users],
  providers: [BillingService],
});

export const app = application({ features: [users, billing] });
```

Only tokens listed in `exports` are visible to an importing feature. Imported providers
are resolved from the original feature container, including that provider's private
constructor dependencies, so module internals do not leak into the importer. Singleton,
request, and lifecycle ownership are shared rather than duplicated. Import cycles and
undeclared imports fail during composition or the architecture seal. A feature also
cannot silently shadow an imported export; use a distinct token or make an explicit
application-level override in tests.

## Plugins

Use a named plugin when native Elysia configuration and the providers it needs belong together:

```ts
import { application, plugin } from "starpod";

const requestLogging = plugin({
  name: "request-logging",
  providers: [RequestLogger],
  configure: (elysia) => elysia.onRequest(({ request }) => {
    console.log(request.method, request.url);
  }),
});

export const app = application({
  features: [hello],
  plugins: [requestLogging],
});
```

Plugin providers are normal application providers: constructor injection, lifecycle management, and test overrides continue to work. Plugin configuration receives and returns native Elysia. Use the bootstrap `configure` option for one-off application wiring or when a plugin does not need a name or providers.

Use `providers` for new applications. The deprecated `infra` option is kept for migration compatibility, but combining `providers` and `infra` is rejected so a provider cannot be silently discarded.

The architecture seal checks feature wiring and the complete constructor graph before the server starts. Run it with `bun run seal`.

## Route inspection

Because routes remain native Elysia routes, Starpod can inspect the routes Elysia has actually registered:

```bash
starpod routes
```

The same manifest is available programmatically through `routeManifest(server)` and includes native Elysia `detail` metadata when provided.

Run the project audit before CI or deployment:

```bash
starpod audit --production --strict --json
```

The audit combines the architecture seal with project checks for module setup,
environment handling, secret-file ignores, lockfiles, container files, unsafe
watch-mode production starts, and missing non-root container users.
Use `--strict` for a deployment or release gate: warnings become blocking findings.
Without `--strict`, warnings remain visible but do not fail the command. `starpod doctor`
remains available when only project diagnostics are needed.

Export the same route contracts as OpenAPI from the CLI:

```bash
starpod openapi > openapi.json
```

## API documentation

Starpod can build a basic OpenAPI 3.1 document from the routes and schemas already registered by Elysia:

```ts
import { openApiRoutes } from "starpod";

const server = await bootstrap(app);
openApiRoutes(server, {
  title: "Users API",
  version: "1.0.0",
  securitySchemes: {
    bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
  },
  security: [{ bearer: [] }],
});
```

`openApiRoutes` registers a native `GET /openapi.json` route by default; pass `path` to change it. The route is hidden from the generated document so the spec describes the application API, not the documentation endpoint. The document preserves native Elysia `detail` metadata, TypeBox-compatible schemas, path/query/header/cookie parameters, request bodies, response status maps, and hidden routes. It also adds a reusable `ErrorPayload` schema and standard Starpod error responses (400, 401, 403, 404, 409, 413, 422, 429, and 500) when a route has not declared those statuses. Pass `standardErrorResponses: []` to omit them. It does not introduce a second route contract; OpenAPI is derived from the Elysia routes that actually exist.

## Errors

Application code can throw typed HTTP errors:

```ts
import { NotFound } from "starpod";

const user = await users.find(id);
if (!user) throw NotFound("User");
```

Bootstrap serializes these into a consistent response shape and hides unexpected error details from production responses:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "requestId": "..."
  }
}
```

Details are sanitized at the HTTP boundary as well: common secret-shaped fields such as passwords, tokens, authorization headers, cookies, SQL, queries, stacks, and causes are replaced with `[REDACTED]`. Cyclic or non-JSON values are converted to safe markers, so validation diagnostics cannot accidentally break response serialization.
Exposed detail objects and arrays are bounded to keep malformed validation input from creating oversized error responses.

Every request receives a validated `x-request-id` (or a generated one). It is returned on the response and is available to native Elysia handlers as `requestId` through Elysia's derived context. `x-correlation-id` is propagated independently for tracing a related group of requests; when it is absent, it falls back to the request ID and is available as `correlationId`.

## Database integration

Starpod does not bundle an ORM or hide a database driver's query API. `DatabaseConnection` provides the small framework-owned part that every production integration needs: one connection lifecycle, graceful cleanup, readiness probing, and transaction delegation:

```ts
import { DatabaseConnection, provideFactory, token } from "starpod";

const DATABASE = token<DatabaseConnection<DbClient, DbTransaction>>("DATABASE");
const database = provideFactory(DATABASE, [], () => new DatabaseConnection({
  connect: () => postgres.connect(config.databaseUrl),
  close: (client) => client.close(),
  transaction: (client, work) => client.transaction(work),
  ping: (client) => client.query("select 1"),
}));

export const app = application({
  features: [users],
  providers: [database],
});
```

Repositories still use the native client or query builder through `database.use(...)`; migration policy, models, locking, replicas, and SQL remain explicit application or driver concerns. Readiness checks can call `database.ping(signal)` without creating a second connection lifecycle. Pass `onEvent` to observe connection, transaction, and close timings. Optional `tracer` and `metrics` adapters create isolated `db.*` operation spans and counters/histograms without coupling Starpod to a telemetry vendor.

Migration ordering and journal persistence are also explicit:

```ts
import { MigrationRunner } from "starpod";

const runner = new MigrationRunner(migrations, migrationStore, database);
await runner.up();
```

`MigrationRunner` sorts migration IDs, detects duplicate or unknown applied IDs, runs pending migrations under the store's deployment-specific lock, records each successful step, and rolls back in reverse order. The application-owned `MigrationStore` is responsible for durable journaling and database/advisory-lock semantics.

## Configuration

Configuration is explicit and validated at startup:

```ts
import { defineConfig, env } from "starpod";

export const config = defineConfig({
  port: env.number("PORT", { default: 3000, min: 1, max: 65535 }),
  environment: env.enum("NODE_ENV", ["development", "test", "production"] as const, {
    default: "development",
  }),
  paymentsUrl: env.url("PAYMENTS_URL", { required: true }),
  requestTimeoutMs: env.duration("REQUEST_TIMEOUT", { default: 5_000 }),
  databaseUrl: env.secret("DATABASE_URL", { required: true }),
});
```

Missing or invalid values are reported together in one startup error. Tests can pass an explicit source instead of mutating process environment variables.

`env.url` accepts only absolute HTTP(S) URLs without embedded credentials. `env.duration` requires an explicit unit such as `250ms`, `5s`, or `2m` and resolves to milliseconds.

Use `inspectConfig(definition)` for diagnostics. Values declared with `env.secret(...)` are returned as `[REDACTED]`, so configuration inspection can be logged safely.

## Graceful shutdown

For the normal server entrypoint, `start` composes bootstrap, native Elysia `listen()`, and signal cleanup:

```ts
import { start } from "starpod";

const { server } = await start(app, {
  listen: config.port,
});
```

`start` still returns the native Elysia server. It is a convenience boundary, not a replacement for Elysia.

For embedded runtimes or when startup ownership must remain completely manual, keep bootstrap and use Elysia's native `stop()` method directly:

```ts
import { bootstrap, installGracefulShutdown } from "starpod";

const server = await bootstrap(app);
server.listen(config.port);
installGracefulShutdown(server, {
  onError: (error) => console.error("shutdown failed", error),
});
```

The helper listens for `SIGINT` and `SIGTERM`, stops the server once, removes its signal handlers after shutdown, and returns a cleanup function for embedded runtimes and tests. It does not install signal handlers during `bootstrap`.

Providers may expose `initialize()` and `dispose()` for lifecycle management. Starpod initializes shared providers before feature providers, and cleans up feature scopes before shared application providers when Elysia stops.

For native Elysia plugins and application-wide hooks, use the bootstrap configurator:

```ts
const server = await bootstrap(app, {
  configure: (elysia) => elysia.use(myPlugin).onRequest(() => {
    // native Elysia lifecycle behavior
  }),
});
```

The configurator is an escape hatch into Elysia itself; Starpod does not replace Elysia's plugin or middleware model.

Create a new feature without generating hidden wiring:

```bash
starpod make:feature billing
```

This creates `billing.controller.ts`, `billing.pod.ts`, and `billing.service.ts` under `src/features/billing`. Add the exported pod to `application({ features })` yourself so the application graph stays explicit.

## Container deployment

`starpod init` creates a small Bun production baseline with `Dockerfile` and `.dockerignore`. Commit `bun.lock`, then build and run it with:

```bash
docker build -t my-app .
docker run --rm -p 3000:3000 -e NODE_ENV=production my-app
```

The image runs the generated `start` script as the non-root `bun` user. The generated entrypoint includes liveness and readiness routes with no dependency checks; database migrations, readiness policy, secrets, TLS termination, and orchestration policy remain deployment-owned.

`starpod init` also creates `deploy/kubernetes.yaml` with a two-replica Deployment, Service, health probes, non-root settings, and bounded starter resources. Replace the generated image name and resource values for your cluster before applying it:

```bash
kubectl apply -f deploy/kubernetes.yaml
```

## Health endpoints

Use native Elysia health routes for orchestration:

```ts
import { healthRoutes } from "starpod";

const server = await bootstrap(app, {
  configure: (elysia) => healthRoutes(elysia, {
    checks: [
      { name: "database", check: () => database.ping() },
    ],
  }),
});
```

`/health/live` only reports that the process is running. `/health/ready` runs dependency checks and returns `503` when the application is not ready.

When native Elysia shutdown begins, readiness immediately returns `503` while liveness remains available, allowing an orchestrator to drain traffic before the process exits.

Checks may declare `timeoutMs`; timed-out checks fail readiness and receive an `AbortSignal` so database or network probes can stop their work cooperatively.

## Authentication and authorization

Starpod provides adapter-friendly authentication primitives without inventing cryptography or a token format:

```ts
import { authentication, bearerToken } from "starpod";

const auth = authentication(async (request) => {
  const token = bearerToken(request);
  return token ? verifyWithYourIdentityProvider(token) : null;
});

const server = await bootstrap(app, {
  configure: (elysia) => auth(elysia),
});
```

Pass optional `tracer` and `metrics` adapters to `authentication(...)` to record a safe `security.authentication` operation. Principal values and credential material are never added to telemetry.

Use `requireUser`, `requireRole`, and `requirePermission` close to business logic. Applications remain responsible for choosing and securely configuring their identity provider.

For other identity inputs, use the explicit extractors and keep verification in the authenticator:

```ts
import { apiKeyFrom, authentication, cookieValue } from "starpod";

const auth = authentication(async (request) => {
  const key = apiKeyFrom(request) ?? cookieValue(request, "session");
  return key ? verifyWithYourIdentityProvider(key) : null;
});
```

API keys are read from headers only; cookie parsing matches exact names and rejects invalid percent-encoding. Starpod does not invent session storage, token formats, or cryptographic protocols.

For password-based identity, use the password service at the account boundary:

```ts
import { bunPasswordHasher, passwordService } from "starpod";

const passwords = passwordService(bunPasswordHasher(), {
  minLength: 12,
  maxLength: 1_024,
});

const storedHash = await passwords.hash(password);
const valid = await passwords.verify(password, storedHash);
```

The Bun adapter uses Argon2id by default. `verify` returns `false` for an invalid password, an invalid stored hash, or a password outside the configured policy; it does not leak hashing errors through the login boundary. Account lockout, breached-password checks, reset flows, MFA, and identity-provider integration remain application-owned.

For cookie-backed sessions, use an application-owned store with Starpod's secure opaque-cookie boundary:

```ts
import { sessions, type Session } from "starpod";

const sessionAuth = sessions<Session>({
  required: true,
  store: {
    get: (id) => sessionStore.find(id),
    delete: (id) => sessionStore.delete(id),
  },
});

const server = await bootstrap(app, {
  configure: (elysia) => sessionAuth(elysia),
});
```

The cookie contains only a random opaque session ID and defaults to `HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/`. Expired sessions are deleted and cleared. Starpod does not own session persistence, user lookup, OAuth, MFA, or token rotation policy.
Optional `tracer` and `metrics` adapters on `sessions(...)` record `security.session` resolution without recording cookie values or session IDs.

For resource-level rules, define an explicit policy next to the domain logic:

```ts
import { definePolicy, type Principal } from "starpod";

type Post = { ownerId: string; published: boolean };

const postPolicy = definePolicy<Principal, Post>({
  read: ({ user, resource }) => resource.published || resource.ownerId === user.id,
  update: ({ user, resource }) => resource.ownerId === user.id,
});

await postPolicy.enforce("update", { user, resource: post });
```

Policies are explicit functions, support asynchronous checks, and throw the same structured `FORBIDDEN` error as the built-in guards.

## Multi-tenancy

Tenant resolution is optional and explicit. It runs through Elysia's native request pipeline and exposes a typed `tenant` value to controller routes:

```ts
import { tenancy, type TenantElysia } from "starpod";

const tenantPlugin = tenancy((request) => {
  const id = request.headers.get("x-tenant-id");
  return id ? { id } : null;
}, { required: true });

const server = await bootstrap(app, {
  configure: (elysia) => tenantPlugin(elysia),
});

class ReportsController {
  routes(app: TenantElysia) {
    return app.get("/", ({ tenant }) => ({ tenantId: tenant.id }));
  }
}
```

Use `tenantKey(tenant.id, key)` when composing lock or other store keys. For caches, `tenantCache(cache, tenant)` returns the same `CacheStore` API with keys and tags scoped automatically. Starpod makes tenant selection and key namespacing explicit; database row isolation, authorization policy, and cross-tenant guarantees remain application responsibilities.

## External HTTP services

For outbound APIs, `HttpClient` adds only the production concerns that are easy to get wrong around native `fetch`: per-attempt timeouts, bounded parsed responses, safe retries for idempotent methods, structured failures, and value-free telemetry.

```ts
import { HttpClient, httpExponentialBackoff } from "starpod";

const payments = new HttpClient({
  baseUrl: config.paymentsUrl,
  timeoutMs: 5_000,
  retries: 2,
  retryDelayMs: httpExponentialBackoff(100),
});

const payment = await payments.json<Payment>(`/payments/${paymentId}`);
```

`request()` returns non-2xx responses as native `Response` objects. `json()` throws `HttpClientError` for non-2xx responses or invalid JSON. Retries default to `GET`, `HEAD`, and `OPTIONS`; writes are never retried unless `retryMethods` explicitly includes them. Redirects are blocked by default so an allowlisted client cannot silently leave its configured origin; pass native `redirect: "follow"` or `redirect: "manual"` per request when that behavior is an explicit application decision. URLs in errors and telemetry omit credentials, query values, and fragments. Pass a `Tracer` adapter to create one safe `http.client` span per attempt. Register the client as a normal Starpod provider when it is shared by services.

When `baseUrl` is configured, requests are restricted to that origin by default. Use `allowedOrigins` for an explicit multi-service allowlist. This prevents accidental user-controlled absolute URLs from turning a service client into an SSRF primitive; network-level egress controls are still required for complete SSRF defense.

## Typed events

In-process events use an explicit event map:

```ts
import { EventBus } from "starpod";

type Events = {
  "user.created": { userId: string };
};

const events = new EventBus<Events>();
events.on("user.created", ({ userId }) => {
  // typed payload
});

await events.emit("user.created", { userId: user.id });
```

Handlers run in registration order. Delivery failures are aggregated instead of being silently swallowed.

Pass `onEvent` to `EventBus` for value-free emit, handler, and completion telemetry. Observer failures are isolated from event delivery; payloads and handler errors are never included in the events.
`EventBus` also accepts optional vendor-neutral `tracer` and `metrics` adapters and records an `events.emit` operation around ordered delivery.

For broker or outbox delivery, register a versioned codec with `EventRegistry`. It produces a transport-safe envelope and rejects events without an explicit serialization contract:

```ts
const registry = new EventRegistry<Events>();
registry.register("user.created", {
  version: "1",
  encode: (event) => event,
  decode: (payload) => payload as Events["user.created"],
});

const envelope = registry.encode("user.created", { userId: user.id });
```

Distributed adapters still own delivery guarantees such as retries, ordering, consumer groups, and dead letters; the event contract remains shared and typed.

`EventDispatcher` is the durable-transport bridge: it encodes through the registry and publishes an envelope, while the broker owns delivery, retries, consumer groups, and dead letters.
It accepts optional `tracer` and `metrics` adapters and records an `events.dispatch` operation without adding payload data to telemetry.

Events may carry an explicit `tenantId` through dispatch, outbox, and consumer delivery. Handlers receive it in the optional event context; Starpod does not install ambient tenant state, so consumers still choose the database and authorization boundary deliberately.

For broker consumers, register the same codecs and handlers with `EventConsumer`. It validates the envelope version, decodes the payload, and delegates delivery to the normal typed `EventBus`; the broker remains responsible for acknowledgement, retry, ordering, and dead-letter policy. When an envelope has an ID, pass an atomic `EventIdempotencyStore` to make duplicate delivery safe:

```ts
const consumer = new EventConsumer(registry, bus, { idempotency: deduplicationStore });
await consumer.consume(envelopeFromBroker);
```

For local development and tests, `MemoryEventIdempotencyStore` coalesces concurrent deliveries, remembers successful IDs for a bounded TTL, and leaves failed work eligible for retry. Its completed and in-flight entries share a configurable capacity; when full, a new unique delivery fails closed. Tenant-scoped event IDs are isolated automatically when the envelope carries `tenantId`. It is process-local; use a shared atomic store when consumers run on multiple instances.

For a transactional outbox, use `EventOutbox.enqueue(...)` inside the same database transaction as the domain write. Its `EventOutboxStore` must make `append` transactional and `claim` atomic; `publishPending()` publishes claimed records and marks broker failures for a later retry. If marking a successfully published record fails, the record may be delivered again, so consumers must be idempotent:

```ts
const record = await outbox.enqueue("user.created", { id: user.id }, { transaction });
await outbox.publishPending(100);
```

`EventOutbox` can also receive the optional vendor-neutral telemetry adapters. It records `events.outbox.enqueue` and `events.outbox.publish` operations; the store and broker remain responsible for transactional and delivery guarantees.

## Background jobs

Job definitions are typed and can be dispatched through the same application-level contract:

```ts
import { InMemoryJobQueue, exponentialBackoff } from "starpod";

const sendWelcomeEmail = {
  name: "send-welcome-email",
  handle: async (payload: { userId: string }, { attempt, signal }) => {
    await mail.send(payload.userId, { signal });
    console.log(`welcome email attempt ${attempt}`);
  },
};

const jobs = new InMemoryJobQueue({ concurrency: 4 });
await jobs.dispatch(sendWelcomeEmail, { userId: user.id }, {
  maxAttempts: 3,
  backoffMs: exponentialBackoff(250),
});
```

The in-memory runner supports delays, priorities, retries, cooperative timeouts, cancellation through AbortSignal, concurrency, deduplication, and dead letters. When `tenantId` is supplied, deduplication is scoped to that tenant. It is intended for local development and tests; it does not survive process restarts or provide distributed delivery.

Queues may expose cancel(id) for cooperative cancellation. A running handler must honor its JobContext signal; cancellation is treated as a control decision rather than a failed delivery. Long-running handlers can call `context.reportProgress({ completed, total })`; observers receive only bounded progress metadata, never the job payload.

Pass onEvent to InMemoryJobQueue for value-free lifecycle telemetry: dispatch, start, success, retry, dead-letter, and cancel events. Observer failures are isolated from delivery.
Optional `tracer` and `metrics` adapters add `jobs.queue.dispatch` and `jobs.queue.delivery` spans and counters/histograms for the in-process queue. Enqueue remains synchronous internally so deduplication timing and queue semantics are unchanged.
`JobWorker` also accepts the optional vendor-neutral `tracer` and `metrics` adapters and creates a safe `jobs.worker` operation for each delivery.

Job names are stable transport identities. A durable adapter should persist the job name, encoded payload, and delivery options—not the handler closure—and a worker should register the same definitions with `JobRegistry`:

```ts
import { JobRegistry, JobWorker, encodeJob } from "starpod";

const envelope = encodeJob(sendWelcomeEmail, { userId: user.id }, {
  maxAttempts: 3,
});
await durable.publish(envelope);

const registry = new JobRegistry();
registry.register(sendWelcomeEmail);

const worker = new JobWorker(registry);
await worker.run({
  id: brokerDelivery.id,
  name: envelope.name,
  payload: envelope.payload,
  attempt: brokerDelivery.attempt,
  timeoutMs: envelope.options.timeoutMs,
});
```

The broker adapter maps its delivery ID and attempt count into `JobWorker`; Starpod does not acknowledge or retry messages behind the adapter's back. Use a `codec` whenever payloads cross a process or persistence boundary. This keeps local jobs simple while making serialization, worker registration, and failure semantics explicit for production adapters.

Broker redeliveries can be made idempotent with an application-owned atomic store:

```ts
import { JobRegistry, JobWorker, MemoryJobIdempotencyStore } from "starpod";

const worker = new JobWorker(new JobRegistry(), {
  idempotency: new MemoryJobIdempotencyStore(),
});
```

`JobWorker` scopes the delivery key by job name and `tenantId`, coalesces concurrent duplicates, and only remembers successful work. Failed or timed-out work remains eligible for broker retry. The memory store is process-local; use a shared atomic implementation when workers run on multiple instances.

`InMemoryJobQueue` exposes `dispose()`, so registering it as an application singleton lets Starpod drain it during normal shutdown.
Closing with `{ drain: false }` cancels pending work, aborts active handlers through `AbortSignal`, and still waits for those handlers to settle before returning. This prevents provider disposal from racing with cooperative job cleanup.

For a durable broker, use `DurableJobDispatcher`. It requires a job codec and publishes only a transport-safe envelope; the worker registers the same job with `JobRegistry` and never receives a serialized handler closure:

```ts
import { DurableJobDispatcher } from "starpod";

const dispatcher = new DurableJobDispatcher({
  publish: (envelope) => broker.publish(envelope),
});

await dispatcher.dispatch(sendWelcomeEmail, { userId: user.id }, {
  maxAttempts: 3,
  tenantId: tenant.id,
});
```

The dispatcher accepts `onEvent` for value-free dispatch telemetry and optional `tracer`/`metrics` adapters for a safe `jobs.dispatch` operation. The broker adapter remains responsible for durability, visibility timeouts, acknowledgement, retries, consumer groups, and dead-letter storage.

Pass `tenantId` when dispatching tenant-owned work. It is validated, persisted in durable job options, and exposed as `context.tenantId` to both in-memory handlers and `JobWorker` deliveries. This is explicit metadata, not an automatic authorization decision; handlers must still enforce tenant access at their storage boundary.

For local work and tests, `InMemoryScheduler` dispatches typed jobs on a fixed-delay interval through a `JobQueue`:

```ts
const scheduler = new InMemoryScheduler(queue);
const task = scheduler.schedule(refreshSearch, {}, {
  intervalMs: 60_000,
  runImmediately: true,
});

task.cancel();
```

Optional `tracer` and `metrics` adapters record each scheduled execution as a safe `jobs.scheduler` operation. The scheduler remains fixed-delay and never overlaps its own executions.

It prevents overlapping runs, reports dispatch failures through an explicit callback, emits safe schedule/start/success/failure/cancel events, and cleans up timers through `dispose()`. It is not a durable scheduler or a cron engine; use a deployment-specific scheduler adapter when jobs must survive restarts or coordinate across instances.

`schedule` treats its second argument as the payload value, including when that value is a function. Use `scheduleFactory` when a fresh payload should be generated for each run:

```ts
scheduler.scheduleFactory(refreshSearch, () => ({ generatedAt: Date.now() }), {
  intervalMs: 60_000,
});
```

## Caching

Caching is explicit. Starpod does not silently cache route results:

```ts
import { MemoryCache } from "starpod";

const cache = new MemoryCache({ maxEntries: 10_000 });
const user = await cache.getOrSet(`user:${userId}`, () => users.find(userId), {
  ttlMs: 60_000,
  tags: [`user:${userId}`],
});

cache.invalidateTag(`user:${userId}`);
```

The memory implementation supports TTLs, bounded LRU storage, namespaces, tags, and concurrent-loader coalescing. Completed entries and unique in-flight loaders share the configured capacity; a new miss fails closed when that bound is full. It is process-local. A distributed `CacheStore` implementation must provide the same `getOrSet` stampede-protection contract over Redis or another shared cache rather than silently falling back to an uncoordinated read-then-write sequence.

Pass `onEvent` to `MemoryCache` for value-free cache telemetry. Events identify hits, misses, writes, deletes, tag invalidations, and loader coalescing; observer failures never change cache behavior.
Optional `tracer` and `metrics` adapters add safe `cache.*` operation spans and counters/histograms; cache keys and values are never added to telemetry.

For stampede protection or other cross-process critical sections, use the explicit `LockStore` boundary:

```ts
import { withLock } from "starpod";

const value = await withLock(redisLocks, `user:${userId}`, () => rebuildUser(userId), {
  ttlMs: 10_000,
});
```

`MemoryLockStore` is bounded and process-local; when full, it rejects a new acquisition instead of evicting an active lease. A distributed implementation must make `acquire` atomic and keep lease ownership safe; Starpod does not claim that an in-memory lock coordinates multiple instances.

## Observability

Request logging is opt-in and vendor-neutral:

```ts
import { consoleLogger } from "starpod";

const server = await bootstrap(app, {
  logger: consoleLogger(),
});
```

The built-in request events include method, path, status, duration, request ID, and safe error codes. Request bodies, headers, credentials, and query values are never logged by the built-in logger.

Bootstrap also accepts a small `Tracer` adapter. Starpod creates an `http.server` span with request identity, route, status, errors, and duration; applications can bridge that contract to OpenTelemetry, another tracer, or a test recorder without adding a telemetry dependency to the framework.

Incoming valid W3C `traceparent`/`tracestate` headers are passed to the adapter as parent context. `HttpClient` accepts the same context per request and can let the tracer inject outbound propagation headers.

```ts
const server = await bootstrap(app, {
  tracer: otelTracerAdapter,
});
```

Request metrics use the same boundary and are emitted once per request as `http.server.requests` and `http.server.duration_ms`. Metric adapter failures are logged but never turn a successful request into a failure:

```ts
const server = await bootstrap(app, {
  metrics: otelMetricsAdapter,
});
```

If the application already installs OpenTelemetry, Starpod includes dependency-free bridges for its tracing and metrics interfaces. SDK/exporter setup remains application-owned:

```ts
import { openTelemetryMetrics, openTelemetryTracer } from "starpod";
import { context, propagation, trace, SpanStatusCode } from "@opentelemetry/api";

const server = await bootstrap(app, {
  tracer: openTelemetryTracer({ context, trace, propagation, statusCodes: {
    ok: SpanStatusCode.OK,
    error: SpanStatusCode.ERROR,
  } }),
  metrics: openTelemetryMetrics(meterProvider),
});
```

The adapter preserves Starpod's safe scalar attribute and metric-label boundary while using the application's configured OpenTelemetry providers. The OpenTelemetry API package and exporters remain optional application dependencies.

For local debugging, pass a bounded `MemoryInspector`. It records method, registered route template, status, request ID, duration, and safe error codes—never request bodies, credentials, headers, or query values:

```ts
import { MemoryInspector } from "starpod";

const inspector = new MemoryInspector({ maxEvents: 500 });
const server = await bootstrap(app, { inspector });

console.log(inspector.snapshot());
console.log(inspector.query({ requestId: "request-id", limit: 20 }));
```

For a small native JSON view during local development, register the route
explicitly and keep it out of production configuration:

```ts
import { inspectorRoutes } from "starpod";

const server = await bootstrap(app, {
  inspector,
  configure: (elysia) => inspectorRoutes(elysia, { inspector }),
});
```

The endpoint is bounded and supports request or correlation filters. It is not
an authentication boundary; protect it or omit it when the application is
reachable by untrusted clients.

Conservative API security headers and a 10 MiB request-body limit are enabled by default. Override the limit explicitly for larger uploads; Elysia's server-level limit also protects requests without a declared Content-Length:

```ts
const server = await bootstrap(app, {
  maxRequestBodyBytes: 50 * 1024 * 1024,
});
```

HSTS is opt-in because it requires a verified HTTPS and proxy setup:

```ts
const server = await bootstrap(app, {
  securityHeaders: {
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
  },
});
```

For browser APIs, apply an explicit CORS policy through the native Elysia pipeline:

```ts
import { cors } from "starpod";

const server = await bootstrap(app, {
  configure: (elysia) => cors({
    origin: ["https://app.example.com"],
    credentials: true,
  })(elysia),
});
```

Wildcard origins cannot be combined with credentials. Unknown origins receive no CORS permission, and preflight methods or headers outside the allowlist are rejected.

For browser routes authenticated with cookies, apply explicit double-submit CSRF protection. Bearer-only APIs do not need this plugin:

```ts
import { csrfProtection, csrfToken } from "starpod";

const token = csrfToken();
// Set token in a non-HttpOnly, Secure, SameSite cookie from your session flow.
const server = await bootstrap(app, {
  configure: (elysia) => csrfProtection()(elysia),
});
```

Mutating requests must send the same token in the configured cookie and `x-csrf-token` header. Starpod validates the comparison; the application remains responsible for setting cookie attributes and associating the token with its session policy.

For finite JSON or text responses, add standard conditional caching with ETags:

```ts
import { etag } from "starpod";

const server = await bootstrap(app, {
  configure: (elysia) => etag({
    cacheControl: "private, max-age=30",
  })(elysia),
});
```

Matching `If-None-Match` requests receive `304 Not Modified`. Streaming responses and explicit `Response` bodies are left untouched, and responses larger than the configured limit are not hashed.

## Rate limiting

Rate limiting is an explicit native Elysia hook. The built-in store is bounded and process-local; when full, it rejects new identities until a window expires instead of evicting active limits. Use a shared atomic store for horizontally scaled deployments:

```ts
import { rateLimit } from "starpod";

const server = await bootstrap(app, {
  configure: (elysia) => rateLimit({
    limit: 100,
    windowMs: 60_000,
    key: (request) => request.headers.get("x-client-id") ?? "anonymous",
  })(elysia),
});
```

The hook emits standard `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers plus `Retry-After` on rejected requests. Legacy `X-RateLimit-*` aliases are also emitted during the alpha period. A custom `RateLimitStore` must make `consume` atomic for its deployment, such as with Redis or another shared data store. Pass `onEvent` for value-free decision telemetry, or `tracer`/`metrics` for a safe `security.rate_limit` operation; identities and keys are never included.

When an application is behind a reverse proxy, resolve the address for an abuse-protection key with `clientIp(request, { peerAddress, trustProxy })`. Forwarded headers are ignored by default; only an explicitly trusted direct peer may contribute a validated `X-Forwarded-For` chain. The hosting adapter must provide the actual socket peer address—never treat an arbitrary request header as that value.

For password or token login endpoints, use `BruteForceGuard` around the authentication operation:

```ts
import { BruteForceGuard } from "starpod";

const loginGuard = new BruteForceGuard({
  maxFailures: 5,
  windowMs: 15 * 60_000,
  lockoutMs: 15 * 60_000,
});

const user = await loginGuard.run(`${email}:${ipAddress}`, () => authenticate(email, password));
```

The built-in store is bounded and process-local. When full, it preserves active lockouts and temporarily fails closed for new identities instead of evicting protection. A custom `BruteForceStore` must implement `recordFailure` atomically; use a shared implementation for multiple instances, and choose a privacy-preserving identity key appropriate to the endpoint. The guard does not replace account lockout policy, CAPTCHA, or identity-provider controls.
Pass optional `tracer` and `metrics` adapters to record each `run()` call as a safe `security.brute_force` operation; the identity key is never included.

For downloads or other temporary capabilities, sign an absolute URL with an application secret:

```ts
import { createSignedUrl, verifySignedUrl } from "starpod";

const url = await createSignedUrl("https://cdn.example/file.pdf", config.urlSecret, {
  expiresAt: Date.now() + 5 * 60_000,
});

if (!(await verifySignedUrl(request.url, config.urlSecret))) throw Unauthorized();
```

The helper signs the complete canonical URL with HMAC-SHA-256, requires a 32-byte secret, rejects URL credentials and duplicate signature parameters, and treats the expiry as exclusive. It does not grant authorization by itself; the application must still check ownership and access policy.

For user-controlled redirect targets, use `safeRedirect`. Relative application paths are allowed by default; absolute destinations require an explicit origin allowlist:

```ts
import { safeRedirect } from "starpod";

return safeRedirect(returnTo, {
  allowedOrigins: ["https://app.example.com"],
});
```

Protocol-relative URLs, URL credentials, unsupported schemes, and control characters are rejected.

## CLI diagnostics

Use the architecture audit for framework boundaries and the doctor for project and deployment hazards:

```bash
starpod audit
starpod audit --json
starpod doctor
starpod doctor --json
```

`doctor` checks the package module/dependency setup, required application files, supported `NODE_ENV`, Bun version, environment-file ignore rules, and the architecture report when `src/app.ts` is available. Warnings are reported without failing CI; blocking findings return a non-zero exit code.

The lifecycle commands stay thin and visible: `starpod dev` runs `bun --watch src/main.ts`, `starpod start` runs `bun src/main.ts`, and `starpod test`, `starpod check`, and `starpod build` delegate to the matching scripts in the application package. `starpod routes --json` exposes the native route manifest for CI or tooling.

## Testing

Use the built-in test harness for in-memory HTTP integration tests. It sends normal Web `Request` objects through the native Elysia handler and supports the same explicit provider overrides used by the runtime:

```ts
import { createTestApplication, provideValue } from "starpod";

const testApp = await createTestApplication(app, {
  overrides: [provideValue(DATABASE, fakeDatabase)],
});

const response = await testApp.request("/users");
await testApp.dispose();
```

`dispose()` is idempotent and works without opening a network port. Tests remain responsible for choosing database, queue, clock, mail, and storage fakes.

Run the reproducible local performance harness with `bun run bench`; use `bun run bench -- --json` for machine-readable output. It measures native Elysia request handling, explicit DI resolution, and memory-cache reads using the current Bun/runtime environment. Results are diagnostic measurements, not universal production claims or a release threshold.

Run the framework checks and release build with:

```bash
bun run check:lines
bun run check
bun run build
```

Maintained TypeScript files under `src`, `test`, `scripts`, and `template` are intentionally limited to 250 lines. Larger areas are split into focused capability modules so the code remains easy to navigate and review.

For a project-level architecture report, use the CLI audit command. It exits non-zero when the filesystem conventions or explicit DI graph are invalid, and supports JSON output for CI:

```bash
bunx starpod audit
bunx starpod audit --json
bunx starpod audit --production --strict
```

## Production boundary

Starpod is a usable alpha foundation, not a claim that every enterprise concern is finished. It gives applications a small, explicit runtime for composition, HTTP, DI, lifecycle, configuration, and cross-cutting primitives. It does not bundle an ORM, identity provider, queue broker, database migration system, distributed event transport, distributed cache/rate limiter, or telemetry vendor.

Those integrations should be registered as normal Elysia plugins or explicit Starpod providers. This keeps operational guarantees visible: an in-memory event bus is not a durable broker, an in-memory rate limiter is not distributed protection, and an application-provided database provider is not a built-in persistence guarantee.

Before calling an application production-ready, add and verify its deployment-specific database, authentication, authorization, migrations, background processing, rate limits, telemetry, backups, secrets management, load tests, and release process.
