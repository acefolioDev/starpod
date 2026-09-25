---
title: "Security overview: trust is earned at the boundary"
label: "Security overview"
description: "Security is not one lock on the front door."
section: security
order: 10
---

## The idea

Security is not one lock on the front door. It is a sequence of questions: who is this, what may they do, which tenant owns the data, how fast may they try, and what should we reveal when something fails?

## How Starpod provides it

Starpod provides small, explicit security boundaries: authentication middleware, sessions, password hashing, CORS, CSRF, rate limiting, brute-force state, signed URLs, tenancy context, security headers, and policies. It does not choose your identity provider, authorization model, database isolation, key management, or deployment network policy.

Start with these layers:

1. Validate configuration and request bodies.
2. Establish identity with [authentication](/docs/security/authentication/) or [sessions](/docs/security/sessions/).
3. Enforce resource permissions with [policies](/docs/security/policies/).
4. Resolve and authorize the tenant with [tenancy](/docs/security/tenancy/).
5. Add [CORS/CSRF](/docs/security/cors-csrf/), [rate limits](/docs/security/rate-limiting/), and brute-force controls where the threat model needs them.
6. Log safe request IDs and monitor failures through [observability](/docs/observability/).

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
