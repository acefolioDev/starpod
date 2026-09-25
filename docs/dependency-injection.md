# Dependency injection: bring the right tools to the work

## The idea

Picture a workshop. A repair job should receive the wrench, diagnostic reader, and spare parts it needs. It should not wander through a global cupboard, guess where tools live, or secretly create a new database connection. That is dependency injection: give an object its collaborators from the outside.

## How Starpod provides it

Starpod uses explicit constructor injection. A provider is a class, value, or factory registered in a container. A class declares dependencies with a static `inject` tuple—or the readable `needs` alias. There is no reflection, service locator, decorator, or hidden global singleton.

```ts
import { token, provideFactory, provideValue } from "starpod";

export class Clock {
  now() { return new Date(); }
}

export class ReportService {
  static readonly inject = [Clock] as const;
  constructor(private readonly clock: Clock) {}
}

const API_URL = token<string>("API_URL");
const client = provideFactory(API_URL, [], () => "https://api.example.test");
const appConfig = provideValue(API_URL, "https://api.example.test");
```

`inject` remains the canonical name used by the generator. Classes may use `needs` instead, with identical behavior:

```ts
export class ReportService {
  static readonly needs = [Clock] as const;

  constructor(private readonly clock: Clock) {}
}
```

If both names are present, Starpod accepts them only when the tuples contain the same tokens in the same order. Factory helpers still use their existing `inject` argument; `injectHandler()` is a separate route-boundary API.

Register classes in `providers`, and use `provideValue`, `provideFactory`, or `provideAsyncFactory` for tokens and resources. An async factory is resolved during bootstrap and its resulting resource is still disposed normally.

## Lifetimes: who owns the tool?

Providers are singleton by default. A singleton is a shared workshop tool. A request-scoped provider is a clipboard that belongs to one visitor. A transient provider is a fresh disposable tool for one job. A singleton belongs to its application or feature container. Set `static readonly lifetime = "request" as const` for one instance per HTTP request, or `"transient"` for a new instance per resolution.

```ts
export class RequestAudit {
  static readonly lifetime = "request" as const;
  constructor() {}
}
```

Use `injectHandler([Token], handler)` when a native route needs request-scoped dependencies. The handler receives normal Elysia context first, followed by resolved dependencies.

```ts
import { injectHandler, type StarpodElysia } from "starpod";

class Controller {
  routes(app: StarpodElysia) {
    return app.get("/", injectHandler([RequestAudit], (context, audit) => ({
      path: context.request.url,
      startedAt: audit,
    })));
  }
}
```

`REQUEST_CONTEXT` is the explicit token for the native `Request`, route template, request ID, correlation ID, and incoming trace context. Singleton providers cannot depend on request-scoped providers; the graph rejects that lifetime leak.

## Overrides and disposal

Tests can shadow providers without editing production composition:

```ts
const server = await bootstrap(app, {
  environment: "test",
  overrides: [provideValue(API_URL, "http://fake.test")],
});
```

Use `disposeBootstrap(server)` or `TestApplication.dispose()` exactly once at the end of a test. Starpod disposes request resources after the response, keeping native streaming resources alive until the stream completes.

## Common mistakes

- Omitting both `static readonly inject` and `static readonly needs`; a constructor with dependencies then has no explicit graph declaration.
- Registering a value with `uses` instead of application `providers`.
- Making a singleton depend on request state.
- Creating a second database connection in each feature rather than sharing one application provider.

## Production notes

DI manages object ownership and startup order; it does not pool connections, retry transactions, or make a provider thread-safe. Choose lifetimes based on actual state and concurrency. For external resources, make close behavior explicit and test disposal.
