import type { AnyElysia } from "elysia";

export type CorsOrigin =
  | readonly string[]
  | ((origin: string, request: Request) => boolean | Promise<boolean>);

export type CorsOptions = {
  readonly origin: CorsOrigin;
  readonly methods?: readonly string[];
  readonly allowedHeaders?: readonly string[];
  readonly exposedHeaders?: readonly string[];
  readonly credentials?: boolean;
  readonly maxAgeSeconds?: number;
};

const DEFAULT_METHODS = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"] as const;
const DEFAULT_ALLOWED_HEADERS = ["Content-Type", "Authorization"] as const;

/** Apply an explicit CORS policy through native Elysia request handling. */
export function cors(options: CorsOptions) {
  validateOptions(options);
  const methods = options.methods ?? DEFAULT_METHODS;
  const allowedHeaders = options.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS;
  const allowsAnyOrigin = Array.isArray(options.origin) && options.origin.includes("*");

  return (app: AnyElysia) => app.onRequest(async ({ request, set }) => {
    const origin = request.headers.get("origin");
    if (!origin || (!allowsAnyOrigin && !(await isAllowed(options.origin, origin, request)))) return;

    set.headers["access-control-allow-origin"] = allowsAnyOrigin ? "*" : origin;
    if (!allowsAnyOrigin) set.headers["vary"] = appendVary(set.headers["vary"], "Origin");
    if (options.credentials) set.headers["access-control-allow-credentials"] = "true";
    if (options.exposedHeaders?.length) {
      set.headers["access-control-expose-headers"] = options.exposedHeaders.join(", ");
    }

    if (request.method !== "OPTIONS") return;

    const requestedMethod = request.headers.get("access-control-request-method");
    const requestedHeaders = request.headers.get("access-control-request-headers");
    if (requestedMethod && !methods.some((method) => method.toUpperCase() === requestedMethod.toUpperCase())) {
      set.status = 403;
      return { error: "CORS method is not allowed" };
    }
    if (requestedHeaders && !requestedHeaders.split(",").every((header: string) =>
      allowedHeaders.some((allowed) => allowed.toLowerCase() === header.trim().toLowerCase()),
    )) {
      set.status = 403;
      return { error: "CORS header is not allowed" };
    }

    set.status = 204;
    set.headers["access-control-allow-methods"] = methods.join(", ");
    set.headers["access-control-allow-headers"] = allowedHeaders.join(", ");
    if (options.maxAgeSeconds !== undefined) {
      set.headers["access-control-max-age"] = String(options.maxAgeSeconds);
    }
    return "";
  }) as AnyElysia;
}

async function isAllowed(policy: CorsOrigin, origin: string, request: Request) {
  return typeof policy === "function" ? policy(origin, request) : policy.includes(origin);
}

function appendVary(current: string | number | undefined, value: string) {
  if (!current) return value;
  const values = String(current).split(",").map((item) => item.trim());
  return values.includes(value) ? String(current) : `${current}, ${value}`;
}

function validateOptions(options: CorsOptions) {
  if (options.credentials && Array.isArray(options.origin) && options.origin.includes("*")) {
    throw new Error("CORS credentials cannot be used with a wildcard origin");
  }
  if (options.maxAgeSeconds !== undefined &&
    (!Number.isInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 0)) {
    throw new Error("CORS maxAgeSeconds must be a non-negative integer");
  }
}
