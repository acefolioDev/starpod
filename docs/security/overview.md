# Security overview

Starpod provides small, explicit security boundaries: authentication middleware, sessions, password hashing, CORS, CSRF, rate limiting, brute-force state, signed URLs, tenancy context, security headers, and policies. It does not choose your identity provider, authorization model, database isolation, key management, or deployment network policy.

Start with these layers:

1. Validate configuration and request bodies.
2. Establish identity with [authentication](./authentication.md) or [sessions](./sessions.md).
3. Enforce resource permissions with [policies](./policies.md).
4. Resolve and authorize the tenant with [tenancy](./tenancy.md).
5. Add [CORS/CSRF](./cors-csrf.md), [rate limits](./rate-limiting.md), and brute-force controls where the threat model needs them.
6. Log safe request IDs and monitor failures through [observability](../observability.md).

```ts
const server = await bootstrap(app, {
  securityHeaders: {},
  configure: (elysia) => authentication(verifyRequest)(elysia),
});
```

## Common mistakes

- Believing a route prefix or pod is an authorization boundary.
- Logging credentials, cookies, tokens, or raw request bodies.
- Allowing arbitrary origins with credentials.
- Treating in-memory security stores as shared protection across replicas.

## Production notes

Use TLS at the edge, rotate secrets, keep clocks synchronized for signed URLs, use shared atomic stores for distributed limits/lockouts, and test failure paths. Starpod’s helpers reduce common mistakes but cannot validate your business authorization or infrastructure.

