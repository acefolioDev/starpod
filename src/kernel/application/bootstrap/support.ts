import { pathFromUrl, durationMilliseconds, type Logger, type Metrics, type Span } from "../../observability/observability";
import type { Inspector } from "../../observability/inspector";
import { Container, GraphError } from "../../di/di";

export function validateMaxRequestBodyBytes(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("maxRequestBodyBytes must be a non-negative integer");
  }
}

export function durationFor(request: Request, startedAt: WeakMap<Request, number>) {
  const start = startedAt.get(request);
  return start === undefined ? undefined : durationMilliseconds(start);
}

export function isStreamingResponse(value: unknown): boolean {
  if (typeof Response !== "undefined" && value instanceof Response) return value.body !== null;
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) return true;
  if (typeof value !== "object" || value === null) return false;
  return Symbol.asyncIterator in value || Symbol.iterator in value;
}

export function responseStatus(value: unknown, configured: unknown): number {
  if (typeof Response !== "undefined" && value instanceof Response && value.status > 0) {
    return value.status;
  }
  return typeof configured === "number" ? configured : 200;
}

export function logSafely(
  logger: Logger | undefined,
  level: "info" | "error",
  event: string,
  fields: Readonly<Record<string, unknown>>,
) {
  if (!logger) return;
  try {
    if (level === "info") logger.info(event, fields);
    else logger.error(event, fields);
  } catch {
    // Logging must never alter request or shutdown behavior.
  }
}

export async function disposeScopes(scopes: readonly Container[], root: Container, parent?: Container) {
  const failures: unknown[] = [];
  for (const scope of [...scopes].reverse()) {
    try {
      await scope.dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await root.dispose();
  } catch (error) {
    failures.push(error);
  }
  if (parent && parent !== root) {
    try {
      await parent.dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "application disposal failed");
}

export function flattenErrors(error: unknown): unknown[] {
  if (error instanceof AggregateError) return error.errors.flatMap(flattenErrors);
  return [error];
}

export function finishSpan(
  request: Request,
  status: number,
  error: unknown,
  spans: WeakMap<Request, Span>,
  ended: WeakSet<Request>,
  startedAt: WeakMap<Request, number>,
  logger: Logger | undefined,
  requestId: string | undefined,
) {
  if (ended.has(request)) return;
  ended.add(request);
  const span = spans.get(request);
  if (!span) return;

  try {
    span.setAttribute("http.status_code", status);
    const durationMs = durationFor(request, startedAt);
    if (durationMs !== undefined) span.setAttribute("http.response.duration_ms", durationMs);
    if (error !== undefined) {
      span.recordException(error);
      span.setStatus("error");
    } else {
      span.setStatus(status >= 500 ? "error" : "ok");
    }
    span.end();
  } catch (spanError) {
    logSafely(logger, "error", "telemetry.span.end.error", {
      ...(requestId ? { requestId } : {}),
      error: spanError instanceof Error ? spanError.message : String(spanError),
    });
  }
}

export function recordRequestMetrics(
  request: Request,
  status: number,
  startedAt: WeakMap<Request, number>,
  recorded: WeakSet<Request>,
  metrics: Metrics | undefined,
  logger: Logger | undefined,
  requestId: string | undefined,
) {
  if (!metrics || recorded.has(request)) return;
  recorded.add(request);

  const labels = {
    method: request.method,
    status_code: status,
  } as const;
  try {
    metrics.increment("http.server.requests", 1, labels);
    const durationMs = durationFor(request, startedAt);
    if (durationMs !== undefined) metrics.observe("http.server.duration_ms", durationMs, labels);
  } catch (error) {
    logSafely(logger, "error", "telemetry.metrics.error", {
      ...(requestId ? { requestId } : {}),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function recordRequestInspector(
  request: Request,
  status: number,
  startedAt: WeakMap<Request, number>,
  routes: WeakMap<Request, string>,
  recorded: WeakSet<Request>,
  inspector: Inspector | undefined,
  logger: Logger | undefined,
  requestId: string | undefined,
  correlationId: string | undefined,
  errorCode?: string,
) {
  if (!inspector || recorded.has(request)) return;
  recorded.add(request);

  try {
    const durationMs = durationFor(request, startedAt);
    inspector.record({
      type: "http.request",
      ...(requestId ? { requestId } : {}),
      ...(correlationId ? { correlationId } : {}),
      method: request.method,
      route: routes.get(request) ?? "unknown",
      status,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(errorCode ? { errorCode } : {}),
    });
  } catch (error) {
    logSafely(logger, "error", "inspector.record.error", {
      ...(requestId ? { requestId } : {}),
      ...(correlationId ? { correlationId } : {}),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function disposeRequestScope(
  request: Request,
  scopes: WeakMap<Request, Container>,
  activeScopes: Set<Container>,
  logger: Logger | undefined,
  requestId: string | undefined,
) {
  const scope = scopes.get(request);
  if (!scope) return;

  scopes.delete(request);
  activeScopes.delete(scope);
  try {
    await scope.dispose();
  } catch (error) {
    logSafely(logger, "error", "http.request.scope.error", {
      ...(requestId ? { requestId } : {}),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function parentForRequest(
  route: string,
  features: readonly { readonly prefix: string; readonly container: Container }[],
  root: Container | undefined,
) {
  const path = pathFromUrl(route);
  const feature = [...features]
    .sort((left, right) => right.prefix.length - left.prefix.length)
    .find(({ prefix }) => prefix === "/" || path === prefix || path.startsWith(`${prefix}/`));
  if (feature) return feature.container;
  if (root) return root;
  throw new GraphError("request dependency scope is not available before bootstrap completes");
}
