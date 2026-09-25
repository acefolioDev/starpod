# Minimal API

This is the smallest useful Starpod application. The controller owns a native
Elysia route, the pod owns its prefix, and the application wires the feature.

```bash
bun install
bun run dev
curl http://localhost:3000/hello
```

There is no decorator, generated route metadata, or service locator.
