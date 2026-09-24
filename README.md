# Starpod

An enterprise-friendly structure for Elysia applications: explicit constructor DI, feature boundaries, and native Elysia routes in controllers. TypeScript only. No decorators.

> Current status: working alpha. The core runtime, explicit DI, native routes, configuration, error handling, health checks, adapter-based authentication, optional tenant context, request logging, bounded development inspection, vendor-neutral tracing and metrics boundaries, security headers, database lifecycle/transaction boundaries, deterministic migration orchestration, in-process events, typed in-process jobs and scheduling, cache primitives, and rate-limit primitives are implemented. Vendor database adapters, durable queues/schedulers, distributed event delivery, distributed caching/rate limiting, full OpenTelemetry integration, and release hardening are still application-owned or planned.

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

Use `import { Elysia, t } from "elysia"` anywhere in your application. Starpod does not restrict Elysia imports or wrap its route API. `StarpodElysia` is optional and only adds typed Starpod request context such as `requestId`.

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
import type { StarpodElysia } from "starpod";

class RequestContext {
  static readonly lifetime = "request" as const;

  constructor(readonly startedAt = Date.now()) {}
}

class ExpensiveParser {
  static readonly lifetime = "transient" as const;
}

class Controller {
  routes(app: StarpodElysia) {
    return app.get("/", ({ resolve }) => resolve(RequestContext).startedAt);
  }
}
```

Inside a native controller route, `resolve(Token)` uses the request's real child container. Use `resolveAsync(Token)` when a request-scoped provider exposes asynchronous `initialize()` work; initialization follows dependency order and is retried after a failed attempt. Request-scoped instances are disposed after the handler completes, while singleton instances remain owned by their application or feature container. Tests can override application or feature providers with a real child scope at bootstrap:

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

The architecture seal checks feature wiring and the complete constructor graph before the server starts. Run it with `bun run seal`.

## Route inspection

Because routes remain native Elysia routes, Starpod can inspect the routes Elysia has actually registered:

```bash
starpod routes
```

The same manifest is available programmatically through `routeManifest(server)` and includes native Elysia `detail` metadata when provided.

Export the same route contracts as OpenAPI from the CLI:

```bash
starpod openapi > openapi.json
```

## API documentation

Starpod can build a basic OpenAPI 3.1 document from the routes and schemas already registered by Elysia:

```ts
import { openApiDocument } from "starpod";

const server = await bootstrap(app);
server.get("/openapi.json", () => openApiDocument(server, {
  title: "Users API",
  version: "1.0.0",
}));
```

The document preserves native Elysia `detail` metadata, TypeBox-compatible schemas, path/query/header/cookie parameters, request bodies, response status maps, and hidden routes. It also adds a reusable `ErrorPayload` schema and standard Starpod error responses (400, 401, 403, 404, 409, 413, 422, 429, and 500) when a route has not declared those statuses. Pass `standardErrorResponses: []` to omit them. It does not introduce a second route contract; OpenAPI is derived from the Elysia routes that actually exist.

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

Every request receives a validated `x-request-id` (or a generated one). It is returned on the response and is available to native Elysia handlers as `requestId` through Elysia's derived context.

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

Repositories still use the native client or query builder through `database.use(...)`; migration policy, models, locking, replicas, and SQL remain explicit application or driver concerns. Readiness checks can call `database.ping(signal)` without creating a second connection lifecycle.

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
  databaseUrl: env.secret("DATABASE_URL", { required: true }),
});
```

Missing or invalid values are reported together in one startup error. Tests can pass an explicit source instead of mutating process environment variables.

Use `inspectConfig(definition)` for diagnostics. Values declared with `env.secret(...)` are returned as `[REDACTED]`, so configuration inspection can be logged safely.

## Graceful shutdown

Starpod keeps shutdown explicit and uses Elysia's native `stop()` method:

```ts
import { installGracefulShutdown } from "starpod";

server.listen(config.port);
installGracefulShutdown(server, {
  onError: (error) => console.error("shutdown failed", error),
});
```

The helper listens for `SIGINT` and `SIGTERM`, stops the server once, and returns a cleanup function for embedded runtimes and tests. It does not install signal handlers during `bootstrap`.

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

Use `requireUser`, `requireRole`, and `requirePermission` close to business logic. Applications remain responsible for choosing and securely configuring their identity provider.

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

Use `tenantKey(tenant.id, key)` when composing cache, lock, or other store keys. Starpod makes tenant selection and key namespacing explicit; database row isolation, authorization policy, and cross-tenant guarantees remain application responsibilities.

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

For broker or outbox delivery, register a versioned codec with `EventRegistry`. It produces a transport-safe envelope and rejects events without an explicit serialization contract:

    const registry = new EventRegistry<Events>();
    registry.register("user.created", {
      version: "1",
      encode: (event) => event,
      decode: (payload) => payload as Events["user.created"],
    });

    const envelope = registry.encode("user.created", { userId: user.id });

Distributed adapters still own delivery guarantees such as retries, ordering, consumer groups, and dead letters; the event contract remains shared and typed.

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

The in-memory runner supports delays, priorities, retries, cooperative timeouts, cancellation through AbortSignal, concurrency, deduplication, and dead letters. It is intended for local development and tests; it does not survive process restarts or provide distributed delivery.

Queues may expose cancel(id) for cooperative cancellation. A running handler must honor its JobContext signal; cancellation is treated as a control decision rather than a failed delivery.

Pass onEvent to InMemoryJobQueue for value-free lifecycle telemetry: dispatch, start, success, retry, dead-letter, and cancel events. Observer failures are isolated from delivery.

Job names are stable transport identities. A durable adapter should persist the job name, encoded payload, and delivery options—not the handler closure—and a worker should register the same definitions with `JobRegistry`:

```ts
import { JobRegistry, decodeJob, encodeJob } from "starpod";

const envelope = encodeJob(sendWelcomeEmail, { userId: user.id }, {
  maxAttempts: 3,
});
await durable.publish(envelope);

const registry = new JobRegistry();
registry.register(sendWelcomeEmail);

const definition = registry.resolve(message.name);
const payload = decodeJob(definition, message.payload);
await definition.handle(payload, context);
```

Use a `codec` whenever payloads cross a process or persistence boundary. This keeps local jobs simple while making serialization, worker registration, and failure semantics explicit for production adapters.

`InMemoryJobQueue` exposes `dispose()`, so registering it as an application singleton lets Starpod drain it during normal shutdown.

For local work and tests, `InMemoryScheduler` dispatches typed jobs on a fixed-delay interval through a `JobQueue`:

```ts
const scheduler = new InMemoryScheduler(queue);
const task = scheduler.schedule(refreshSearch, {}, {
  intervalMs: 60_000,
  runImmediately: true,
});

task.cancel();
```

It prevents overlapping runs, reports dispatch failures through an explicit callback, and cleans up timers through `dispose()`. It is not a durable scheduler or a cron engine; use a deployment-specific scheduler adapter when jobs must survive restarts or coordinate across instances.

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

The memory implementation supports TTLs, bounded storage, namespaces, tags, and concurrent-loader coalescing. It is process-local. A distributed `CacheStore` implementation should provide the same explicit operations over Redis or another shared cache.

Pass `onEvent` to `MemoryCache` for value-free cache telemetry. Events identify hits, misses, writes, deletes, tag invalidations, and loader coalescing; observer failures never change cache behavior.

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

For local debugging, pass a bounded `MemoryInspector`. It records method, registered route template, status, request ID, duration, and safe error codes—never request bodies, credentials, headers, or query values:

```ts
import { MemoryInspector } from "starpod";

const inspector = new MemoryInspector({ maxEvents: 500 });
const server = await bootstrap(app, { inspector });

console.log(inspector.snapshot());
```

Conservative API security headers and a 10 MiB request-body limit are enabled by default. Override the limit explicitly for larger uploads; Elysia's server-level limit also protects requests without a declared Content-Length:

    const server = await bootstrap(app, {
      maxRequestBodyBytes: 50 * 1024 * 1024,
    });

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

## Rate limiting

Rate limiting is an explicit native Elysia hook. The built-in store is bounded and process-local; use a shared atomic store for horizontally scaled deployments:

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

The hook emits standard rate-limit headers and `Retry-After` on rejected requests. A custom `RateLimitStore` must make `consume` atomic for its deployment, such as with Redis or another shared data store.

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

Run the framework checks and release build with:

```bash
bun run check
bun run build

For a project-level architecture report, use the CLI audit command. It exits non-zero when the filesystem conventions or explicit DI graph are invalid, and supports JSON output for CI:

    bunx starpod audit
    bunx starpod audit --json
```

## Production boundary

Starpod is a usable alpha foundation, not a claim that every enterprise concern is finished. It gives applications a small, explicit runtime for composition, HTTP, DI, lifecycle, configuration, and cross-cutting primitives. It does not bundle an ORM, identity provider, queue broker, database migration system, distributed event transport, distributed cache/rate limiter, or telemetry vendor.

Those integrations should be registered as normal Elysia plugins or explicit Starpod providers. This keeps operational guarantees visible: an in-memory event bus is not a durable broker, an in-memory rate limiter is not distributed protection, and an application-provided database provider is not a built-in persistence guarantee.

Before calling an application production-ready, add and verify its deployment-specific database, authentication, authorization, migrations, background processing, rate limits, telemetry, backups, secrets management, load tests, and release process.
