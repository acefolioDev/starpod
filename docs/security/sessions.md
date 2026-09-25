# Sessions

`sessions()` provides secure opaque-cookie plumbing around an application-owned `SessionStore`. The cookie contains a random session ID, not the session object.

```ts
import { sessions, requireSession, type Session } from "starpod";

type UserSession = Session & { userId: string };
const sessionAuth = sessions<UserSession>({
  required: true,
  store: {
    get: (id) => sessionStore.find(id),
    delete: (id) => sessionStore.delete(id),
  },
});

const server = await bootstrap(app, {
  configure: (elysia) => sessionAuth(elysia),
});
```

Cookie defaults are `HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/`. Expired sessions are deleted and cleared. Use `requireSession(session)` close to a protected operation.

## Common mistakes

- Storing user data or bearer tokens directly in the cookie.
- Using a process-local store for a multi-replica service.
- Forgetting session rotation after login or privilege changes.
- Using `SameSite=None` without TLS and an explicit CSRF strategy.

## Production notes

The store owns persistence, atomic deletion, revocation, idle/absolute expiry, session rotation, and multi-instance consistency. Add CSRF protection for cookie-authenticated state changes and never log session IDs.

