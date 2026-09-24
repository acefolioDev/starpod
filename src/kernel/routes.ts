import type { AnyElysia, DocumentDecoration, HTTPMethod } from "elysia";

export type RouteManifestEntry = {
  readonly method: HTTPMethod;
  readonly path: string;
  readonly detail?: DocumentDecoration;
};

/** Read the routes already registered by native Elysia APIs. */
export function routeManifest(app: AnyElysia): readonly RouteManifestEntry[] {
  return Object.freeze(
    app.routes.map((route) =>
      Object.freeze({
        method: route.method,
        path: route.path,
        ...(route.hooks.detail ? { detail: route.hooks.detail } : {}),
      }),
    ),
  );
}
