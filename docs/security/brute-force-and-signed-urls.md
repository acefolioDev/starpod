# Brute-force protection and signed URLs

Use `BruteForceGuard` to track repeated failures at a login or sensitive-operation boundary. The memory store is bounded and process-local; a shared atomic store is needed across replicas.

```ts
import { BruteForceGuard, MemoryBruteForceStore, TooManyRequests } from "starpod";

const guard = new BruteForceGuard({
  maxFailures: 5,
  windowMs: 15 * 60_000,
  lockoutMs: 15 * 60_000,
  store: new MemoryBruteForceStore(),
});
const decision = await guard.check(`login:${normalizedEmail}`);
if (!decision.allowed) throw TooManyRequests("Try again later");
```

Record failures only after a real verification failure, clear state after successful authentication according to your policy, and avoid exposing whether an account exists.

Signed URLs provide an integrity and expiry boundary for links such as downloads:

```ts
import { createSignedUrl, verifySignedUrl } from "starpod";

const url = await createSignedUrl("https://example.test/download", secret, {
  expiresAt: Date.now() + 60_000,
});
const verified = await verifySignedUrl(url, secret);
```

## Common mistakes

- Keying lockout only by email or only by IP.
- Creating signed URLs with secrets in query parameters.
- Treating a valid signature as authorization to every resource.
- Using server-local time without clock discipline across instances.

## Production notes

Use a shared store for lockout state, protect signing keys, set short expiries, include resource and tenant context in the signed material, and authorize the resource after verification. Signed URLs do not encrypt data or revoke a link before expiry.
