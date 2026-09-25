# Authentication: who is knocking?

## The idea

Authentication answers “who are you?” It does not answer “may you edit this invoice?” That second question belongs to authorization. Keeping those questions separate prevents a verified identity from becoming accidental permission.

## How Starpod provides it

Authentication turns a request into a principal. Starpod supplies extractors and an adapter-friendly middleware; your authenticator verifies the credential with your identity provider.

```ts
import { authentication, bearerToken, requireUser, type Principal } from "starpod";

const auth = authentication<Principal>(async (request) => {
  const token = bearerToken(request);
  return token ? verifyWithYourIdentityProvider(token) : null;
});

const server = await bootstrap(app, {
  configure: (elysia) => auth(elysia),
});
```

Use `apiKeyFrom(request)` for header-based API keys or `cookieValue(request, name)` for an exact cookie name. `requireUser`, `requireRole`, and `requirePermission` throw structured `UNAUTHORIZED` or `FORBIDDEN` errors near the route/business boundary.

For password-based accounts, use the password service at the account boundary:

```ts
import { bunPasswordHasher, passwordService } from "starpod";

const passwords = passwordService(bunPasswordHasher(), {
  minLength: 12,
  maxLength: 1_024,
});

const storedHash = await passwords.hash(password);
const valid = await passwords.verify(password, storedHash);
```

The Bun adapter uses Argon2id by default. A false result covers an invalid password or malformed stored hash without exposing hashing details. Account lockout, breached-password checks, reset flows, MFA, and identity-provider integration remain application-owned.

## When to use it

Use bearer authentication for APIs backed by an external issuer, API keys for service integrations, and [sessions](./sessions.md) for browser cookie workflows. Keep verification in one adapter and pass only the verified principal forward.

## Common mistakes

- Decoding a JWT without verifying its signature, issuer, audience, and expiry.
- Using an API key as a user session without rotation and revocation policy.
- Checking authentication at the route but not when the same service is called by a job or event.
- Putting the principal or credential in telemetry.

## Production notes

Starpod does not implement a token format, key rotation, OAuth, MFA, revocation, or user lookup. Use your provider’s verified SDK, validate claims, enforce authorization with policies, and protect secret material.
