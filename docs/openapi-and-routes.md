# Route inspection and OpenAPI: let the running app describe itself

## The idea

Documentation drifts when it is written beside the application instead of from it. The most trustworthy route list is the one Elysia actually registered, with the schemas and metadata attached to those routes.

## How Starpod provides it

Because Starpod registers native Elysia routes, it can inspect the routes that actually exist. `routeManifest(server)` returns method, path, and native Elysia `detail` metadata.

```ts
import { routeManifest } from "starpod";

const routes = routeManifest(server);
console.log(routes);
```

The CLI exposes the same view:

```bash
starpod routes
starpod routes --json
```

## Generate OpenAPI

`openApiDocument()` derives an OpenAPI 3.1 document from registered routes and Elysia schemas. It preserves `detail`, path/query/header/cookie parameters, request bodies, response maps, hidden routes, and a reusable error schema.

```ts
import { openApiRoutes } from "starpod";

const server = await bootstrap(app, {
  configure: (elysia) => openApiRoutes(elysia, {
    title: "Users API",
    version: "1.0.0",
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    security: [{ bearer: [] }],
  }),
});
```

This registers native `GET /openapi.json` by default. Pass `path` to change it. The document route is hidden from the document. `standardErrorResponses` can be set to `[]` or a chosen list of 4xx/5xx statuses.

## Common mistakes

- Forgetting schemas and assuming OpenAPI can infer business semantics.
- Declaring a security scheme in OpenAPI without enforcing authentication in Elysia.
- Publishing an internal OpenAPI endpoint without access control.
- Assuming generated output documents routes that are never registered.

## Production notes

Treat the document as a contract artifact: review it, version it, and add examples/descriptions with Elysia `detail`. OpenAPI generation does not validate authorization, data classification, or backwards compatibility.
