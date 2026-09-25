# Outbound HTTP client: make the network say “not today” safely

## The idea

Every outbound call can be slow, huge, redirected, unavailable, or aimed at the wrong place. A production client needs boundaries around those possibilities, while still letting you use the familiar `fetch` model.

## How Starpod provides it

`HttpClient` wraps native `fetch` with per-attempt timeouts, bounded body reads, safe retries, structured errors, and optional telemetry. It remains an application provider; it is not a service-discovery or network policy system.

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

`request()` returns non-2xx responses as native `Response` objects. `json()` throws `HttpClientError` for non-2xx responses or invalid JSON. Text and JSON reads are capped by `maxResponseBytes` (5 MiB by default).

## Origin and SSRF rules

With `baseUrl`, requests are restricted to that origin by default. Use `allowedOrigins` for an explicit multi-service allowlist. Redirects are blocked by default; opt into native `redirect: "follow"` or `"manual"` per request only when the policy allows it.

Retries default to `GET`, `HEAD`, and `OPTIONS` and transient status codes. Writes are not retried unless `retryMethods` explicitly includes them. URLs in errors and events omit credentials, query values, and fragments.

## Common mistakes

- Building a URL from user input and assuming `baseUrl` makes every request safe.
- Retrying POST or payment writes without idempotency support.
- Treating an HTTP 500 response as a network exception without reading the response policy.
- Using an allowlist as a substitute for network egress controls and DNS/IP protections.

## Production notes

Keep `allowedOrigins` narrow, set timeouts, bound response sizes, and instrument attempts without logging secrets. SSRF defense is layered: validate application input, restrict origins, control redirects, and enforce network egress policy.
