import type { AnyElysia } from "elysia";
import { openApiDocument, type OpenApiDocumentOptions } from "./openapi";

export type OpenApiRoutesOptions = OpenApiDocumentOptions & {
  /** URL at which the generated document is served. Defaults to `/openapi.json`. */
  readonly path?: `/${string}`;
};

/** Register a native Elysia JSON route for the generated OpenAPI document. */
export function openApiRoutes(app: AnyElysia, options: OpenApiRoutesOptions): AnyElysia {
  const path = options.path ?? "/openapi.json";
  validatePath(path);

  app.get(path, () => openApiDocument(app, options), {
    detail: { hide: true },
  });
  return app;
}

function validatePath(path: string) {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#") || /[\r\n]/.test(path)) {
    throw new Error("OpenAPI route path must be an absolute path without a query or fragment");
  }
}
