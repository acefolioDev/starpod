import type { AnyElysia, DocumentDecoration } from "elysia";
export type OpenApiSchema = Readonly<Record<string, unknown>>;

export type OpenApiSecurityScheme =
  | Readonly<{
      readonly type: "apiKey";
      readonly name: string;
      readonly in: "header" | "query" | "cookie";
      readonly description?: string;
    }>
  | Readonly<{
      readonly type: "http";
      readonly scheme: string;
      readonly bearerFormat?: string;
      readonly description?: string;
    }>
  | Readonly<{
      readonly type: "oauth2";
      readonly flows: Readonly<Record<string, unknown>>;
      readonly description?: string;
    }>
  | Readonly<{
      readonly type: "openIdConnect";
      readonly openIdConnectUrl: string;
      readonly description?: string;
    }>
  | Readonly<{
      readonly type: "mutualTLS";
      readonly description?: string;
    }>;

export type OpenApiSecurityRequirement = Readonly<Record<string, readonly string[]>>;

export type OpenApiDocumentOptions = {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly servers?: readonly { readonly url: string; readonly description?: string }[];
  readonly securitySchemes?: Readonly<Record<string, OpenApiSecurityScheme>>;
  readonly security?: readonly OpenApiSecurityRequirement[];
  /** Standard Starpod error statuses to add when a route has not declared them. */
  readonly standardErrorResponses?: readonly number[];
};

export type OpenApiDocument = {
  readonly openapi: "3.1.0";
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description?: string;
  };
  readonly servers?: readonly { readonly url: string; readonly description?: string }[];
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly components?: {
    readonly schemas?: Readonly<Record<string, OpenApiSchema>>;
    readonly securitySchemes?: Readonly<Record<string, OpenApiSecurityScheme>>;
  };
  readonly security?: readonly OpenApiSecurityRequirement[];
};

const DEFAULT_ERROR_STATUSES = [400, 401, 403, 404, 406, 409, 413, 422, 429, 500] as const;
const ERROR_SCHEMA: OpenApiSchema = Object.freeze({
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
        requestId: { type: "string" },
      },
      required: ["code", "message"],
      additionalProperties: false,
    },
  },
  required: ["error"],
  additionalProperties: false,
});

/** Build an OpenAPI document from routes already registered through native Elysia APIs. */
export function openApiDocument(app: AnyElysia, options: OpenApiDocumentOptions): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const errorStatuses = options.standardErrorResponses ?? DEFAULT_ERROR_STATUSES;
  validateErrorStatuses(errorStatuses);

  for (const route of app.routes) {
    const detail = route.hooks.detail as DocumentDecoration | undefined;
    if (detail?.hide) continue;

    const path = openApiPath(route.path);
    const method = route.method.toLowerCase();
    const operation = operationFor(route.hooks, detail, errorStatuses);
    const pathItem = paths[path] ?? {};
    pathItem[method] = operation;
    paths[path] = pathItem;
  }

  const components = {
    ...(errorStatuses.length > 0 ? { schemas: Object.freeze({ ErrorPayload: ERROR_SCHEMA }) } : {}),
    ...(options.securitySchemes
      ? { securitySchemes: Object.freeze({ ...options.securitySchemes }) }
      : {}),
  };

  return Object.freeze({
    openapi: "3.1.0",
    info: Object.freeze({
      title: options.title,
      version: options.version,
      ...(options.description ? { description: options.description } : {}),
    }),
    ...(options.servers ? { servers: Object.freeze([...options.servers]) } : {}),
    paths: Object.freeze(
      Object.fromEntries(
        Object.entries(paths).map(([path, operations]) => [path, Object.freeze(operations)]),
      ),
    ),
    ...(Object.keys(components).length > 0 ? { components: Object.freeze(components) } : {}),
    ...(options.security ? { security: Object.freeze([...options.security]) } : {}),
  });
}

function operationFor(
  hooks: {
    readonly params?: unknown;
    readonly query?: unknown;
    readonly headers?: unknown;
    readonly cookie?: unknown;
    readonly body?: unknown;
    readonly response?: unknown;
  },
  detail: DocumentDecoration | undefined,
  errorStatuses: readonly number[],
) {
  const { hide: _hide, ...decoration } = detail ?? {};
  const operation: Record<string, unknown> = { ...decoration };
  const parameters = [
    ...parametersForSchema(hooks.params, "path", true),
    ...parametersForSchema(hooks.query, "query", false),
    ...parametersForSchema(hooks.headers, "header", false),
    ...parametersForSchema(hooks.cookie, "cookie", false),
  ];

  if (!("parameters" in operation) && parameters.length > 0) operation.parameters = parameters;
  if (!("requestBody" in operation) && hooks.body !== undefined) {
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: hooks.body } },
    };
  }
  const declaredResponses = "responses" in operation ? operation.responses : responsesForSchema(hooks.response);
  operation.responses = withStandardErrors(declaredResponses, errorStatuses);
  return Object.freeze(operation);
}

function parametersForSchema(
  schema: unknown,
  location: "path" | "query" | "header" | "cookie",
  forceRequired: boolean,
) {
  const record = asRecord(schema);
  const properties = asRecord(record?.properties);
  if (!properties) return [];
  const required = new Set(Array.isArray(record?.required) ? record.required.filter(isString) : []);

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: location,
    required: forceRequired || required.has(name),
    schema: propertySchema,
  }));
}

function responsesForSchema(schema: unknown) {
  const record = asRecord(schema);
  if (!record) return { "200": { description: "Success" } };

  const numericStatuses = Object.entries(record).filter(([key]) => /^\d{3}$/.test(key));
  if (numericStatuses.length > 0) {
    return Object.fromEntries(numericStatuses.map(([status, responseSchema]) => [
      status,
      responseFor(status, responseSchema),
    ]));
  }

  return { "200": responseFor("200", schema) };
}

function withStandardErrors(schema: unknown, statuses: readonly number[]) {
  const responses = asRecord(schema) ?? {};
  const result: Record<string, unknown> = { ...responses };
  for (const status of statuses) {
    const key = String(status);
    if (key in result) continue;
    result[key] = {
      description: errorDescription(status),
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ErrorPayload" },
        },
      },
    };
  }
  return result;
}

function errorDescription(status: number) {
  return {
    400: "Bad request",
    401: "Authentication required",
    403: "Forbidden",
    404: "Resource not found",
    406: "Response representation not available",
    409: "Conflict",
    413: "Request body is too large",
    422: "Request validation failed",
    429: "Too many requests",
    500: "Internal server error",
  }[status] ?? "Request failed";
}

function responseFor(status: string, schema: unknown) {
  return {
    description: status === "200" ? "Success" : `Response ${status}`,
    ...(schema === undefined ? {} : { content: { "application/json": { schema } } }),
  };
}

function openApiPath(path: string) {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function validateErrorStatuses(statuses: readonly number[]) {
  for (const status of statuses) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new Error("OpenAPI standard error statuses must be integers from 400 through 599");
    }
  }
}
