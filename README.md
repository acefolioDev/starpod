# Starpod

Atlas-owned routes. Pods, not modules. TypeScript only. No decorators.

```bash
mkdir my-app && cd my-app
bun init -y
bun add --trust starpod
bun run dev
```

Bun does not run install scripts unless the package is trusted, so `--trust` is required for the hello app to appear. That copies **your** app only — atlas, pods, hello. There is no `kernel/` in your project. You import from `"starpod"`.

If you already added the package without `--trust`:

```bash
bunx starpod init
```

Repo: [acefolioDev/starpod](https://github.com/acefolioDev/starpod)

## What you get

```
src/
  main.ts
  app.ts
  infra/clock.ts
  features/hello/
    hello.atlas.ts
    hello.controller.ts
    hello.service.ts
    hello.pod.ts
```

GET `/hello` — the atlas is lit.

## Layout rules

Every feature file is `{name}.{role}.ts`. Atlas, controller, service, and pod are required. Extra roles are allowed. Nested folders and JavaScript sources fail the seal.

## Atlas

Stars are operations. Conventional REST is opt-in via `canon()`:

```ts
stars: {
  ...canon(),
  archive: star.post("/archive"),
}
```

## DI

```ts
import { pod } from "starpod";

export class HelloController {
  static readonly needs = [HelloService] as const;
  constructor(private readonly hello: HelloService) {}
}

export const hello = pod({
  atlas: HelloAtlas,
  controller: HelloController,
  register: [HelloService],
});
```

## Run

```bash
bun run dev
bun run seal
```
