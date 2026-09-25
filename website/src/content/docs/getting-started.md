---
title: "Getting started: your first Starpod mission"
label: "Getting started"
description: "A new web service usually starts as one route and one file."
section: foundations
order: 10
---

> **Experimental / working alpha:** Starpod is early-stage. APIs and conventions may change between versions. Pin versions in production, read the changelog before upgrading, and run `starpod audit` and `starpod doctor` in CI. The composition and native-route boundaries are implemented; production databases, brokers, identity providers, and deployment controls remain application-owned.

## The idea

A new web service usually starts as one route and one file. Then the service grows: routes need shared clients, background work needs the same business rules, tests need fakes, and production needs safe startup and shutdown. Starpod gives that growing service a shape early, without taking Elysia away from you.

The first mental model is simple:

```text
Elysia  = the HTTP engine
Starpod = the wiring, crew manifest, and safety checklist
Your app = the mission itself
```

## Prerequisites

Install Bun 1.4 or newer. Starpod is TypeScript-only and publishes a Bun ESM runtime. You do not need a decorator transform.

## Create and run an application

```bash
mkdir hello-starpod
cd hello-starpod
bun init -y
bun add starpod elysia
bunx starpod init
bun run dev
```

The initializer creates `src/main.ts`, `src/app.ts`, one `hello` feature, shared infrastructure, TypeScript configuration, scripts, and a starter container/deployment shape. Installing the package alone does not modify a project.

Open `http://localhost:3000/hello/`. The starter controller returns a small JSON response. `src/main.ts` uses `start()` to bootstrap the graph, call native Elysia `listen()`, and install graceful shutdown.

## The first feature: give one idea a home

A feature is a piece of product language that deserves a home: “greeting”, “users”, or “billing”. The controller speaks HTTP, the service speaks business logic, and the pod tells Starpod how the two are assembled. This keeps a feature cohesive without hiding its wiring.

```ts
// src/features/greeting/greeting.service.ts
export class GreetingService {
  greet(name: string) {
    return { message: `Hello, ${name}` };
  }
}
```

```ts
// src/features/greeting/greeting.controller.ts
import { t } from "elysia";
import type { StarpodElysia } from "starpod";
import { GreetingService } from "./greeting.service";

export class GreetingController {
  static readonly inject = [GreetingService] as const;

  constructor(private readonly greeting: GreetingService) {}

  routes(app: StarpodElysia) {
    return app.get("/:name", ({ params, requestId }) => ({
      ...this.greeting.greet(params.name),
      requestId,
    }), {
      params: t.Object({ name: t.String({ minLength: 1 }) }),
    });
  }
}
```

```ts
// src/features/greeting/greeting.pod.ts
import { pod } from "starpod";
import { GreetingController } from "./greeting.controller";
import { GreetingService } from "./greeting.service";

export const greeting = pod({
  name: "greeting",
  prefix: "/greeting",
  controller: GreetingController,
  providers: [GreetingService],
});
```

```ts
// src/app.ts
import { application } from "starpod";
import { greeting } from "./features/greeting/greeting.pod";

export const app = application({ features: [greeting] });
```

The route is `GET /greeting/:name`. Elysia still owns path matching, validation, response serialization, WebSockets, streaming, and every other native route capability. Starpod is the stage manager, not a second actor taking over the show.

## Run, test, and inspect

```bash
bun run dev       # Bun watch mode through starpod dev
bun run test      # project tests
bun run check     # line checks, typecheck, examples, and tests
bunx starpod routes
bunx starpod audit --production --strict
bunx starpod doctor --production
```

Use `bunx starpod make:feature users` to generate a controller, pod, and service. Add the generated pod to `application({ features })` yourself; generation does not silently change your application graph.

## A production-shaped entrypoint

```ts
import { defineConfig, env, healthRoutes, start } from "starpod";
import { app } from "./app";

const config = defineConfig({
  port: env.number("PORT", { default: 3000, min: 1, max: 65_535 }),
  environment: env.enum("NODE_ENV", ["development", "test", "production"] as const, {
    default: "development",
  }),
});

const { server } = await start(app, {
  environment: config.environment,
  listen: config.port,
  configure: (elysia) => healthRoutes(elysia),
});

console.log(`listening on http://localhost:${server.server?.port}`);
```

## Common mistakes

- Forgetting to add a pod to `application({ features })`; the architecture seal catches unwired feature folders.
- Importing from internal `src/kernel` paths in an application. Import from `starpod` and use Elysia from `elysia`.
- Expecting decorators, automatic file discovery, or a generated router. Wiring is intentionally explicit.
- Starting with `bun --watch` in a production container. Use `starpod start` or `bun src/main.ts` and run the audit.

## Production notes

Pin `starpod`, `elysia`, and Bun. Keep secrets out of source control and validate environment values at startup. Add readiness checks, request limits, authentication, authorization, logs, metrics, traces, and a deployment-specific database/broker strategy. Starpod supplies boundaries and diagnostics; it does not make those choices for your service.

Next: [Project structure](/docs/project-structure/).
