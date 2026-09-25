# Errors and native responses

Throw `StarpodError` (or its helpers) for expected HTTP failures. Bootstrap serializes it into a stable payload and keeps unexpected details out of production responses.

```ts
import { NotFound } from "starpod";

const user = await users.find(id);
if (!user) throw NotFound("User");
return user;
```

The wire shape is:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "requestId": "..."
  }
}
```

Available helpers include `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `TooManyRequests`, `PayloadTooLarge`, and `InternalServerError`. Use `new StarpodError({ status, code, message, details, exposeDetails })` when a domain-specific code is needed.

Details are exposed only when requested, then sanitized: common secret-shaped keys, cycles, non-JSON values, deep objects, and oversized collections are bounded or redacted. In non-production, unexpected errors can include limited diagnostic data; do not use development serialization as an API contract.

## Native `Response`

Returning or throwing a native `Response` preserves its status, headers, body, and streaming lifecycle.

```ts
return new Response(csv, {
  status: 200,
  headers: { "content-type": "text/csv; charset=utf-8" },
});
```

Use native responses for downloads, redirects, SSE, and streams. Use `StarpodError` for structured application failures.

## Common mistakes

- Putting passwords, SQL, tokens, or stack traces in `details` and assuming sanitization is a substitute for care.
- Returning an HTTP error object as a normal success payload instead of throwing.
- Catching every error and converting it to `BadRequest`, which hides server failures and corrupts metrics.
- Assuming a native `Response` receives the JSON error envelope; it intentionally remains native.

## Production notes

Map errors to stable codes and document them in OpenAPI. Log internal causes through a controlled logger, not in the response. The serializer is a safety boundary, not a domain error taxonomy or a replacement for redaction in your own logs.

