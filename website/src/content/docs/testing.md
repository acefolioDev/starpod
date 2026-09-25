---
title: "Testing: rehearse the mission before launch"
label: "Testing"
description: "Unit tests inspect one tool at a time."
section: runtime
order: 100
---

## The idea

Unit tests inspect one tool at a time. Application tests rehearse the whole scene: routes, validation, request scopes, plugins, errors, and cleanup. You want both kinds of rehearsal before launch.

## How Starpod provides it

`createTestApplication()` boots the application in memory and exposes native `Request`/`Response` integration. It is useful for route tests that should exercise the same composition and error hooks as production.

```ts
import { afterEach, expect, test } from "bun:test";
import { createTestApplication } from "starpod";
import { app } from "../src/app";

test("lists users", async () => {
  const testApp = await createTestApplication(app, {
    environment: "test",
    overrides: [fakeDatabaseProvider],
  });

  try {
    const response = await testApp.request("/users");
    expect(response.status).toBe(200);
  } finally {
    await testApp.dispose();
  }
});
```

`request(path, init)` creates a native `Request`; `dispose()` closes the bootstrapped graph and is idempotent. Use provider overrides for fakes, not mutable global state. `baseUrl` defaults to `http://starpod.test`.

For a focused unit test, instantiate a service with explicit fakes directly. Use a test application when you need route validation, request-scoped DI, native responses, error serialization, health hooks, or plugin composition.

## Common mistakes

- Reusing one bootstrapped server across tests that mutate state.
- Forgetting `dispose()` and leaking timers, queues, or connections.
- Disabling `seal` broadly instead of fixing the test fixture layout.
- Testing only HTTP status and not response shape, request IDs, cleanup, and auth failures.

## Production notes

Use deterministic fake providers and an isolated database/schema. Add integration tests against your real database adapter and broker adapter; an in-memory queue or cache cannot prove distributed guarantees.
