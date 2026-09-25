# Features and pods

A **feature** is a business boundary: users, billing, reports, or another cohesive capability. A **pod** is the `pod({...})` value that describes that feature to Starpod. It supplies a lowercase name, URL prefix, controller, local providers, and optional dependency boundaries.

```ts
import { pod } from "starpod";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

export const users = pod({
  name: "users",
  prefix: "/users",
  controller: UsersController,
  providers: [UsersService],
});
```

During bootstrap Starpod creates a feature scope, resolves the controller, creates an Elysia group at `prefix`, and calls `controller.routes(group)`. The controller must return the same native Elysia instance.

## Prefixes and routes

Names are single lowercase words such as `users` or `billing`. Prefixes start with `/` and cannot contain a query, fragment, control character, or `//`. Application prefixes must be unique. A `/` prefix is allowed for a feature that intentionally owns root routes.

```ts
routes(app: StarpodElysia) {
  return app
    .get("/", () => ({ ok: true }))
    .get("/:id", ({ params }) => this.find(params.id));
}
```

## One controller per feature

One controller is the pod entrypoint and keeps route ownership obvious. It can register many native Elysia routes. If a domain grows, split internal services or create a second feature with its own prefix rather than hiding multiple unrelated controllers behind magic discovery.

## Common mistakes

- Using a URL prefix to imply authorization. A prefix is routing, not a security boundary.
- Registering the same prefix twice; composition rejects duplicate prefixes.
- Returning `undefined` from `routes()` instead of the Elysia instance.
- Treating `uses` as a provider registration; it only declares consumption.

## Production notes

Pods give you composition and DI boundaries, not process isolation or tenant isolation. A feature can still make unsafe queries or leak data. Keep authorization near domain actions and use [policies](./security/policies.md). Use explicit feature imports and exports when one feature consumes another feature’s public provider.

Next: [Dependency injection](./dependency-injection.md) and [Providers, uses, exports, and imports](./providers-uses-exports.md).

