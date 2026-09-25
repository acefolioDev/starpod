# Observability

Starpod’s observability API is vendor-neutral. Pass a `Logger`, `Tracer`, or `Metrics` adapter to `bootstrap()`/`start()` and keep your vendor SDK in application infrastructure.

```ts
import { bootstrap, consoleLogger } from "starpod";

const server = await bootstrap(app, {
  logger: consoleLogger(),
  tracer: tracerAdapter,
  metrics: metricsAdapter,
});
```

The built-in logger emits safe structured request events with method, path, status, duration, request ID, correlation ID, and error code. It does not log bodies, credentials, headers, or query values. Request spans use `http.server`; metrics include `http.server.requests` and `http.server.duration_ms`.

Valid W3C `traceparent`/`tracestate` headers become parent context. `HttpClient` can inject outbound context. Database, cache, event, job, security, and scheduler boundaries accept optional operation telemetry where implemented.

## OpenTelemetry bridge

`openTelemetryTracer(api)` and `openTelemetryMetrics(provider)` adapt compatible OpenTelemetry API objects without making the framework depend on an SDK.

```ts
import { openTelemetryMetrics, openTelemetryTracer } from "starpod";

const server = await bootstrap(app, {
  tracer: openTelemetryTracer(otelApi, { name: "orders" }),
  metrics: openTelemetryMetrics(otelMeterProvider, { name: "orders" }),
});
```

You still install/configure the SDK, exporters, resource attributes, sampling, and collector. Starpod is not an OpenTelemetry distribution.

## Common mistakes

- Putting full URLs, query values, tokens, email addresses, or payloads in span attributes.
- Assuming telemetry adapters are always available or never fail.
- Creating high-cardinality metric labels from user IDs.
- Using an in-memory inspector endpoint in production without access control.

## Production notes

Use sampling and retention appropriate to your data policy, redact at the adapter boundary, and make telemetry failures non-blocking. Correlate logs, traces, and metrics with request/correlation IDs, but do not make those IDs authorization credentials.

