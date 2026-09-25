# Plugins and bootstrap configuration: add crew without hiding the ship

## The idea

An extension should be easy to answer two questions about: “What does it install?” and “When does it run?” Starpod keeps both answers visible. A reusable plugin is a named crew member; a bootstrap callback is a one-time adjustment made at launch.

## How Starpod provides it

Starpod has two explicit extension points. A **Starpod plugin** is named and can own providers plus a native Elysia `configure` function. The `bootstrap({ configure })` callback is an unnamed, one-off application hook.

```ts
import { application, plugin } from "starpod";

const requestLogging = plugin({
  name: "request-logging",
  providers: [RequestLogger],
  configure: (elysia) => elysia.onRequest(({ request }) => {
    console.log(request.method, request.url);
  }),
});

export const app = application({
  features: [hello],
  plugins: [requestLogging],
});
```

Plugins are applied in declaration order and must return the Elysia instance. Plugin providers participate in the normal application DI graph, lifecycle, and test overrides.

```ts
const server = await bootstrap(app, {
  configure: (elysia) => healthRoutes(elysia),
});
```

Use `configure` for local application wiring such as health routes, OpenAPI routes, or a one-off native hook. Use a named plugin when a reusable extension needs a name, providers, or ordering in the composition root.

## Common mistakes

- Treating a plugin as a separate router. It receives native Elysia.
- Forgetting to return the configured instance.
- Adding provider dependencies in a closure instead of registering them explicitly.
- Applying a security-sensitive plugin after routes when its hook needs to run before them; verify the Elysia lifecycle order.

## Production notes

Starpod does not validate the security or correctness of a plugin’s native Elysia code. Keep plugin order reviewable, test the composed app, and avoid plugins that log credentials or request bodies.
