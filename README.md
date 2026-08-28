# Elysia Atlas

TypeScript only. Features own folders. Atlas owns paths. No decorators.

## Layout

```
src/
  main.ts
  app.ts                      # application({ features, infra })
  kernel/
  infra/                      # clock, db, redis — never import features
  features/
    hello/
      hello.atlas.ts          # required — stars, not Laravel routes.ts
      hello.controller.ts     # required
      hello.service.ts        # required
      hello.pod.ts            # required — pod()
```

Every file in a feature folder must be `{name}.{role}.ts`. Extra roles (`repository`, `schema`, `policy`, …) are allowed. Nested folders are not. JavaScript sources under `src/` fail the seal.

## Atlas

Stars are operations. `list` / `show` / `create` / `update` / `remove` are not the default. Conventional REST is opt-in:

```ts
stars: {
  ...canon(),
  archive: star.post("/archive"),
}
```

`canon()` expands once when the atlas is built. The request path is a normal Elysia handler.

## DI

```ts
export class HelloController {
  static readonly needs = [HelloService] as const;
  constructor(private readonly hello: HelloService) {}
}
```

Wire the pod in `{name}.pod.ts`:

```ts
export const hello = pod({
  atlas: HelloAtlas,
  controller: HelloController,
  register: [HelloService],
});
```

## Run

```bash
bun install
bun run dev
bun run seal
```
