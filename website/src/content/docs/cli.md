---
title: "CLI: the launch console"
label: "CLI"
description: "The CLI is the launch console for the conventions in your repository."
section: operations
order: 10
---

## The idea

The CLI is the launch console for the conventions in your repository. It can create the starter shape, inspect what is wired, and stop a risky deployment before it leaves the hangar.

## How Starpod provides it

The `starpod` executable is included in the package. Run it with `bunx starpod ...` or through project scripts.

| Command | Purpose |
| --- | --- |
| `starpod init` | Create the starter application structure. |
| `starpod dev` | Run `src/main.ts` with Bun watch mode. |
| `starpod start` | Run `src/main.ts`. |
| `starpod make:feature <name>` | Generate controller, pod, and service files. |
| `starpod seal` | Validate architecture and the DI graph. |
| `starpod audit` | Combine architecture and project-risk checks. |
| `starpod doctor` | Check project setup and production hazards. |
| `starpod routes [--json]` | Print native registered routes. |
| `starpod openapi` | Print the generated OpenAPI JSON. |
| `starpod test` | Run the project’s `test` script. |
| `starpod check` | Run the project’s `check` script. |
| `starpod build` | Run the project’s `build` script. |

Useful release checks:

```bash
starpod audit --production --strict --json
starpod doctor --production --strict
starpod routes --json > routes.json
starpod openapi > openapi.json
```

`--strict` turns warnings into blocking findings. `--json` is intended for CI tooling. `audit` checks architecture plus project risks such as lockfiles, secret ignores, container files, unsafe watch-mode starts, and non-root container users.

## Common mistakes

- Running commands outside the project root; route/openapi commands load `src/app.ts`.
- Treating `doctor` as a vulnerability scanner.
- Using `dev` for a production start.
- Forgetting to add a generated feature to `src/app.ts`.

## Production notes

Make `seal`, `audit --production --strict`, typecheck, tests, and your deployment-specific checks release gates. Read findings rather than suppressing them; warnings often identify missing ownership decisions.
