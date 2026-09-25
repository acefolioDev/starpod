# Typed configuration

`defineConfig()` parses a definition at startup. The `env` helpers make required values, defaults, ranges, URLs, durations, and secrets explicit.

```ts
import { defineConfig, env, inspectConfig } from "starpod";

export const config = defineConfig({
  port: env.number("PORT", { default: 3000, min: 1, max: 65_535 }),
  environment: env.enum("NODE_ENV", ["development", "test", "production"] as const, {
    default: "development",
  }),
  paymentsUrl: env.url("PAYMENTS_URL", { required: true }),
  timeoutMs: env.duration("REQUEST_TIMEOUT", { default: 5_000 }),
  databaseUrl: env.secret("DATABASE_URL", { required: true }),
});
```

`env.url` accepts absolute HTTP(S) URLs without embedded credentials. `env.duration` requires a unit such as `250ms`, `5s`, or `2m` and returns milliseconds. Invalid values are reported together in a `ConfigError`, before the server should listen.

Pass a source object as the second argument in tests instead of mutating `process.env`:

```ts
const testConfig = defineConfig(
  { port: env.number("PORT", { min: 1 }) },
  { PORT: "3001" },
);
```

`inspectConfig(definition)` returns parsed values with `env.secret` values replaced by `[REDACTED]`.

## When to use it

Use it for all startup choices that change behavior: ports, URLs, timeouts, credentials, feature flags, and environment mode. Keep the resulting object typed and pass selected values into providers rather than reading environment variables deep inside business logic.

## Common mistakes

- Using `env.string` for a value that needs URL, duration, or numeric validation.
- Logging the raw config object when it contains secrets.
- Adding defaults for production credentials that should be required.
- Reading `process.env` in every service, producing inconsistent parsing.

## Production notes

Configuration validation confirms shape, not connectivity or authorization. A URL can be reachable but point at the wrong tenant or environment. Use readiness checks for dependencies and keep secret injection in your deployment system.
