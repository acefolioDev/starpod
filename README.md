# Starpod

An enterprise-friendly structure for Elysia applications: explicit constructor DI, feature boundaries, and native Elysia routes in controllers. TypeScript only. No decorators.

```bash
mkdir my-app && cd my-app
bun init -y
bun add --trust starpod
bun run dev
```

The install script copies a small working app into `src/`. If the package was installed without trust, run `bunx starpod init`.

## Structure

```text
src/
  main.ts
  app.ts
  infra/clock.ts
  features/hello/
    hello.controller.ts
    hello.pod.ts
    hello.service.ts
```

Every feature owns a folder. Controllers own their routes. Pods wire a controller to a URL prefix and its providers. Services contain application logic. Infrastructure is shared through `application({ providers })`.

## Native Elysia routes

There is no route metadata layer and no decorator. A controller receives a normal Elysia instance and uses every Elysia feature directly:

```ts
import { t, type AnyElysia } from "elysia";
import { HelloService } from "./hello.service";

export class HelloController {
  static readonly inject = [HelloService] as const;

  constructor(private readonly hello: HelloService) {}

  routes(app: AnyElysia) {
    return app.get("/", () => this.hello.greet(), {
      response: t.Object({ line: t.String() }),
    });
  }
}
```

Use `import { Elysia, t } from "elysia"` anywhere in your application. Starpod does not restrict Elysia imports or wrap its route API.

## Dependency injection

DI is constructor injection with an explicit provider graph. No service locator, decorators, global singletons, or hidden reflection:

```ts
export class HelloService {
  static readonly inject = [Clock] as const;

  constructor(private readonly clock: Clock) {}
}

export const hello = pod({
  name: "hello",
  prefix: "/hello",
  controller: HelloController,
  providers: [HelloService],
});
```

The application composes features and shared providers in one readable place:

```ts
export const app = application({
  features: [hello],
  providers: [Clock],
});
```

The architecture seal checks feature wiring and the complete constructor graph before the server starts. Run it with `bun run seal`.
