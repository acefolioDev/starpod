# Starpod landing

The marketing homepage lives in `website/` so it can evolve beside the Bun package without changing the future documentation site. It is a static Astro build with a small GSAP + ScrollTrigger animation layer.

```bash
bun install
bun run landing:dev
bun run landing:build
```

The production output is `website/dist/`. Run `bun run dev`, `bun run build`, or `bun run preview` from `website/` when working there directly. The root `landing:*` scripts are the short form.

## Design and animation map

- `src/styles/tokens.css` is the shared blueprint palette and typography contract for the landing and future docs.
- `SceneRequestLifecycle` pins one master timeline: request → scope → injection → response → disposal.
- `ScenePodCutaway` draws a feature boundary and reveals its prefix, controller, providers, and exports.
- `SceneExplicitDI` highlights the declaration, constructor parameter, and one-to-one dependency edge.
- `SceneNativeElysia` keeps the native Elysia band fixed while Starpod composition fades around it.
- `SceneLaunchChecklist` animates only verified CLI and runtime capabilities.

GSAP is dynamically imported by `src/scripts/landing-animations.ts`, registered with the free ScrollTrigger plugin, and cleaned up through `gsap.context()`. Reduced-motion users get readable final states without pinning or scrubbed timelines. No GSAP Club plugins are used.

The docs navigation is intentionally marked “soon”; the repository’s existing `docs/` files are not migrated or rewritten by this site.
