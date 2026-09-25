# Providers, `uses`, `exports`, and `imports`: the doors in your house

## The idea

Think of an application as a house. The application owns the shared boiler and electricity. A feature owns its private rooms. `uses` is a request to use something the house owns. `exports` is a doorway a feature intentionally opens. `imports` is the list of doors another feature is allowed to walk through.

These four terms describe who owns a dependency and who may consume it.

```text
application.providers
        │ owns shared instances
        ├── uses ──> feature A
        └── uses ──> feature B

feature A.providers ── exports ──> feature B.imports
        │                              │
        └── private dependencies       └── only exported tokens are visible
```

## How Starpod provides it: application providers and `uses`

Put process-wide resources such as a Prisma client, clock, logger, or HTTP client in `application({ providers })`. A feature lists the tokens it intentionally consumes with `uses`.

```ts
import { provideFactory, token } from "starpod";
import { PrismaClient } from "@prisma/client";

class PrismaDatabase {
  readonly client = new PrismaClient();

  initialize() {
    return this.client.$connect();
  }

  dispose() {
    return this.client.$disconnect();
  }
}

const DATABASE = token<PrismaDatabase>("DATABASE");
const database = provideFactory(DATABASE, [], () => new PrismaDatabase());

export const users = pod({
  name: "users",
  prefix: "/users",
  controller: UsersController,
  providers: [UsersService],
  uses: [DATABASE],
});

export const app = application({
  features: [users],
  providers: [database],
});
```

`uses` does not register a second provider. The application-owned singleton is shared and disposed once.

## Feature exports and imports

Use feature-to-feature wiring only for a deliberate public dependency.

```ts
export const users = pod({
  name: "users",
  prefix: "/users",
  controller: UsersController,
  providers: [UsersService],
  exports: [UsersService],
});

export const billing = pod({
  name: "billing",
  prefix: "/billing",
  controller: BillingController,
  imports: [users],
  providers: [BillingService],
});

export const app = application({ features: [users, billing] });
```

Only tokens listed in `users.exports` are visible to `billing`. The exported provider remains owned by the users feature container, including its private dependencies and lifetime. Imports must be listed in `application.features`; import cycles and duplicate exports fail during composition.

## When to choose which

Use application providers for shared infrastructure. Use feature providers for feature-private services. Use `uses` for an application-owned dependency. Use `exports` and `imports` when a feature’s public service is the right boundary and promoting it to application scope would be misleading.

## Common mistakes

- Exporting every repository, which turns feature internals into a public API.
- Importing a feature without adding both features to `application.features`.
- Expecting `uses` to instantiate a missing provider; the architecture audit reports it as an error.
- Creating circular feature imports. Extract a shared application provider or redesign the boundary.

## Production notes

These are in-process module boundaries, not network or security boundaries. Keep authorization in the called service/policy, not only in the importing feature. Shared singletons must be safe for concurrent requests and multiple tenants.
