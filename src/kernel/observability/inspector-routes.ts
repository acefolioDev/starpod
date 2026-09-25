import { t, type AnyElysia } from "elysia";
import type { InspectorQuery, InspectorRecord } from "./inspector";

export type InspectorReader = {
  query(options?: InspectorQuery): readonly InspectorRecord[];
};

export type InspectorRoutesOptions = {
  readonly inspector: InspectorReader;
  readonly path?: `/${string}`;
  readonly enabled?: boolean;
  readonly maxLimit?: number;
};

/** Register an explicit, bounded JSON view of development inspector events. */
export function inspectorRoutes(app: AnyElysia, options: InspectorRoutesOptions): AnyElysia {
  if (options.enabled === false) return app;
  const path = options.path ?? "/_starpod/inspect";
  const maxLimit = options.maxLimit ?? 100;
  validateOptions(path, maxLimit);

  return app.get(path, ({ query }) => ({
    events: options.inspector.query({
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.requestId === undefined ? {} : { requestId: query.requestId }),
      ...(query.correlationId === undefined ? {} : { correlationId: query.correlationId }),
      limit: query.limit ?? maxLimit,
    }),
  }), {
    query: t.Object({
      type: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
      requestId: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
      correlationId: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
      limit: t.Optional(t.Integer({ minimum: 1, maximum: maxLimit })),
    }),
    response: t.Object({ events: t.Array(t.Record(t.String(), t.Unknown())) }),
  }) as AnyElysia;
}

function validateOptions(path: string, maxLimit: number) {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\r\n]/.test(path)) {
    throw new Error("Inspector route path must be an absolute path without a query or fragment");
  }
  if (!Number.isInteger(maxLimit) || maxLimit < 1 || maxLimit > 1_000) {
    throw new Error("Inspector route maxLimit must be an integer from 1 through 1000");
  }
}
