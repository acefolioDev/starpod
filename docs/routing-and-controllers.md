# Routing and controllers

Starpod controllers are thin native Elysia route registrars. The `routes(app)` method receives a grouped Elysia instance and must return it. `StarpodElysia` adds typed request identity fields while preserving Elysia’s route API.

```ts
import { t } from "elysia";
import type { StarpodElysia } from "starpod";

export class UsersController {
  routes(app: StarpodElysia) {
    return app
      .get("/", () => ({ users: [] }), {
        response: t.Object({ users: t.Array(t.Object({ id: t.String() })) }),
      })
      .post("/", ({ body, requestId }) => ({ id: body.id, requestId }), {
        body: t.Object({ id: t.String({ minLength: 1 }) }),
      });
  }
}
```

Use Elysia’s `t` schemas, params, query, headers, cookies, response maps, lifecycle hooks, `app.ws`, multipart, redirects, streams, and plugins directly. Starpod does not create route decorators or a second router. Native `Response` values retain status, headers, body, and streaming behavior.

The request context includes `requestId` and `correlationId`, and Starpod returns both headers. Request-scoped services can receive the richer `REQUEST_CONTEXT` token through constructor injection.

## When to use a controller

Use one controller as the HTTP entrypoint for a feature. Keep parsing and transport concerns in the route, then call a service for business logic. Keep route schemas close to routes so Elysia validation and OpenAPI reflect what is actually registered.

## Common mistakes

- Returning a plain object from `routes()` instead of the Elysia instance.
- Adding business authorization only in a route hook and forgetting service-level calls from jobs or events.
- Using a route prefix as a tenancy or permission boundary.
- Hiding route registration behind metadata that `routeManifest()` cannot inspect.

## Production notes

Validate request input and response output with Elysia schemas. Set a deliberate request-body limit in `bootstrap({ maxRequestBodyBytes })`, handle native streaming cleanup, and use `Native Response` only when its headers/status are intentional. See [OpenAPI](./openapi-and-routes.md) and [Errors](./errors.md).

