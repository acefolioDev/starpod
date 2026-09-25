---
title: "Project structure and the architecture seal: make the map match the city"
label: "Project structure"
description: "As a codebase grows, the hard question is not “where can I put this file?” It is “who owns this idea, and who is allowed to depend on it?” A good project structure answers that question before a pull request turns the answer into archaeology."
section: foundations
order: 20
---

## The idea

As a codebase grows, the hard question is not “where can I put this file?” It is “who owns this idea, and who is allowed to depend on it?” A good project structure answers that question before a pull request turns the answer into archaeology.

## How Starpod provides it

Starpod’s default layout separates shared infrastructure from business features:

```text
src/
  main.ts                  # process entrypoint
  app.ts                   # application composition root
  infra/                   # shared adapters and process-wide providers
    clock.ts
  features/
    users/
      users.controller.ts  # native Elysia routes
      users.pod.ts         # boundary, prefix, providers
      users.service.ts     # application logic
      domain/              # optional nested TypeScript modules
```

The framework kernel itself is organized by capability under `src/kernel/`, but application code should use the package barrel (`starpod`).

## Responsibilities

`main.ts` reads configuration, calls `start()` or `bootstrap()`, adds application-wide native Elysia configuration, and owns process logging. `app.ts` is the composition root: it lists features, application providers, and named plugins. A feature owns one controller and its pod; it can contain repositories, policies, jobs, and domain modules. `infra/` may not import features.

## Architecture rules

The default bootstrap runs `sealArchitecture(app)`. The seal checks that:

- `src/features` exists and contains lowercase feature folders.
- Each feature has `<name>.controller.ts` and `<name>.pod.ts`.
- Feature files are TypeScript-only, including nested modules.
- Every feature folder is wired into `application({ features })`.
- Providers, controller routes, `uses`, exports, imports, and the DI graph are valid.
- `src/infra` does not import feature modules.

```bash
bunx starpod seal
bunx starpod audit --production --strict
```

`auditArchitecture(app, { root })` returns a report; `sealArchitecture(app)` throws an `ArchitectureError`. `bootstrap(..., { seal: false })` is available for unusual embedded or test layouts, but disabling the seal removes a useful safety check.

## When to use this layout

Use it when several teams or domains need clear ownership, when startup wiring should be reviewable, or when tests need replaceable providers. A small one-route service can still use it; the ceremony is intentionally limited to a pod and controller.

## Common mistakes

- Putting a database client in a feature and duplicating it in every pod. Register shared resources in application providers.
- Importing a feature from `infra`, which reverses dependency direction.
- Creating a feature folder without adding its pod to `app.ts`.
- Treating filenames other than the controller and pod as prescribed. Nested TypeScript names are application-owned.

## Production notes

The seal checks structure and graph consistency, not business correctness, database migrations, permissions, dependency vulnerabilities, or cloud configuration. Run it and `audit` in CI, then add your own tests and deployment policy. See [Deployment](/docs/deployment/) and [Testing](/docs/testing/).
