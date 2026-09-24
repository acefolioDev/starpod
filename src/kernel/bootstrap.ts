import { Elysia, type AnyElysia } from "elysia";
import { sealArchitecture } from "./architecture";
import {
  Container,
  GraphError,
  providerLifetime,
  providerToken,
  type InjectionToken,
  type Provider,
} from "./di";
import type { Application } from "./feature";
import { PayloadTooLarge, serializeError } from "./errors";
import { requestIdFrom, REQUEST_ID_HEADER } from "./http";
import type { Inspector } from "./inspector";
import {
  durationMilliseconds,
  pathFromUrl,
  type Logger,
  type Metrics,
  type Span,
  type Tracer,
} from "./observability";
import { printFeatures } from "./print";
import { applySecurityHeaders, type SecurityHeadersOptions } from "./security";

export type RuntimeEnvironment = "development" | "test" | "production";

const bootstrapDisposals = new WeakMap<AnyElysia, () => Promise<void>>();

export type BootstrapOptions = {
  readonly environment?: RuntimeEnvironment;
  readonly printFeatures?: boolean;
  /** Disable the filesystem architecture check for embedded or in-memory runtimes. */
  readonly seal?: boolean;
  /** Replace application providers in tests with explicit child-scope providers. */
  readonly overrides?: readonly Provider[];
  readonly configure?: (app: AnyElysia) => AnyElysia;
  readonly logger?: Logger;
  readonly tracer?: Tracer;
  readonly metrics?: Metrics;
  readonly inspector?: Inspector;
  readonly securityHeaders?: false | SecurityHeadersOptions;
  /** Maximum request body size in bytes. Defaults to 10 MiB. */
  readonly maxRequestBodyBytes?: number;
};

const DEFAULT_MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

export function environmentFrom(
  options: BootstrapOptions,
  source: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeEnvironment {
  if (options.environment) return options.environment;
  const value = source.NODE_ENV;
  if (!value || value === "development") return "development";
  if (value === "test" || value === "production") return value;
  throw new Error(`NODE_ENV must be development, test, or production (received "${value}")`);
}

/** Dispose a bootstrapped application without requiring a listening socket. */
export async function disposeBootstrap(app: AnyElysia) {
  await bootstrapDisposals.get(app)?.();
}

export async function bootstrap(app: Application, options: BootstrapOptions = {}) {
  if (options.seal !== false) await sealArchitecture(app);
  const maxRequestBodyBytes = options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  validateMaxRequestBodyBytes(maxRequestBodyBytes);

  const requestIds = new WeakMap<Request, string>();
  const requestStartedAt = new WeakMap<Request, number>();
  const requestRoutes = new WeakMap<Request, string>();
  const requestScopes = new WeakMap<Request, Container>();
  const requestSpans = new WeakMap<Request, Span>();
  const endedSpans = new WeakSet<Request>();
  const recordedMetrics = new WeakSet<Request>();
  const recordedInspector = new WeakSet<Request>();
  const activeRequestScopes = new Set<Container>();
  const featureScopesByPrefix: Array<{ readonly prefix: string; readonly container: Container }> = [];
  let root: Container | undefined;
  const environment = environmentFrom(options);
  const requestContainerFor = (request: Request) => {
    const parent = parentForRequest(request.url, featureScopesByPrefix, root);
    let requestContainer = requestScopes.get(request);
    if (!requestContainer) {
      requestContainer = parent.requestScope();
      requestScopes.set(request, requestContainer);
      activeRequestScopes.add(requestContainer);
    }
    return requestContainer;
  };
  let elysia = new Elysia({
    name: "starpod",
    serve: { maxRequestBodySize: maxRequestBodyBytes },
  })
    .onRequest(({ request }) => {
      const contentLength = request.headers.get("content-length");
      if (contentLength === null) return;
      const declaredLength = Number(contentLength);
      if (Number.isFinite(declaredLength) && declaredLength > maxRequestBodyBytes) {
        throw PayloadTooLarge("Request body exceeds " + maxRequestBodyBytes + " bytes");
      }
    })
    .derive({ as: "global" }, ({ request, set, route }) => {
      const requestId = requestIdFrom(request.headers);
      requestIds.set(request, requestId);
      requestRoutes.set(request, route);
      requestStartedAt.set(request, performance.now());
      set.headers[REQUEST_ID_HEADER] = requestId;
      if (options.securityHeaders !== false) {
        applySecurityHeaders(set.headers, options.securityHeaders);
      }
      if (options.tracer) {
        try {
          requestSpans.set(request, options.tracer.startSpan("http.server", {
            "http.method": request.method,
            "http.route": route,
            "starpod.request.id": requestId,
          }));
        } catch (error) {
          options.logger?.error("telemetry.span.start.error", {
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return {
        requestId,
        resolve: <T>(token: InjectionToken<T>) => {
          return requestContainerFor(request).resolve(token);
        },
        resolveAsync: async <T>(token: InjectionToken<T>) => {
          return requestContainerFor(request).resolveAsync(token);
        },
      };
    })
    .onError(async ({ error, request, set }) => {
      const requestId = requestIds.get(request) ?? requestIdFrom(request.headers);
      const serialized = serializeError(error, {
        development: environment !== "production",
        requestId,
      });
      set.status = serialized.status;
      set.headers[REQUEST_ID_HEADER] = requestId;
      options.logger?.error("http.request.error", {
        requestId,
        method: request.method,
        path: pathFromUrl(request.url),
        status: serialized.status,
        durationMs: durationFor(request, requestStartedAt),
        errorCode: serialized.payload.error.code,
      });
      finishSpan(request, serialized.status, error, requestSpans, endedSpans, requestStartedAt, options.logger, requestId);
      recordRequestMetrics(
        request,
        serialized.status,
        requestStartedAt,
        recordedMetrics,
        options.metrics,
        options.logger,
        requestId,
      );
      recordRequestInspector(
        request,
        serialized.status,
        requestStartedAt,
        requestRoutes,
        recordedInspector,
        options.inspector,
        options.logger,
        requestId,
        serialized.payload.error.code,
      );
      await disposeRequestScope(request, requestScopes, activeRequestScopes, options.logger, requestId);
      return serialized.payload;
    })
    .onAfterResponse(async ({ request }) => {
      await disposeRequestScope(
        request,
        requestScopes,
        activeRequestScopes,
        options.logger,
        requestIds.get(request),
      );
    })
    .onAfterHandle(async ({ request, set }) => {
      await disposeRequestScope(
        request,
        requestScopes,
        activeRequestScopes,
        options.logger,
        requestIds.get(request),
      );
      finishSpan(
        request,
        typeof set.status === "number" ? set.status : 200,
        undefined,
        requestSpans,
        endedSpans,
        requestStartedAt,
        options.logger,
        requestIds.get(request),
      );
      recordRequestMetrics(
        request,
        typeof set.status === "number" ? set.status : 200,
        requestStartedAt,
        recordedMetrics,
        options.metrics,
        options.logger,
        requestIds.get(request),
      );
      recordRequestInspector(
        request,
        typeof set.status === "number" ? set.status : 200,
        requestStartedAt,
        requestRoutes,
        recordedInspector,
        options.inspector,
        options.logger,
        requestIds.get(request),
      );
      const requestId = requestIds.get(request);
      options.logger?.info("http.request", {
        ...(requestId ? { requestId } : {}),
        method: request.method,
        path: pathFromUrl(request.url),
        status: typeof set.status === "number" ? set.status : 200,
        durationMs: durationFor(request, requestStartedAt),
      });
    });
  const configured = options.configure?.(elysia as AnyElysia);
  if (configured) elysia = configured as typeof elysia;
  const applicationRoot = new Container(app.providers);
  const compositionRoot = options.overrides?.length
    ? applicationRoot.scope(options.overrides)
    : applicationRoot;
  const overrideTokens = new Set((options.overrides ?? []).map(providerToken));
  root = compositionRoot;
  const featureScopes: Container[] = [];

  try {
    for (const provider of app.providers) {
      if (providerLifetime(provider) === "singleton") {
        await compositionRoot.resolveAsync(providerToken(provider));
      }
    }

    for (const feature of app.features) {
      const container = compositionRoot.scope([
        ...feature.uses,
        ...feature.providers,
        feature.controller,
      ].filter((provider) => !overrideTokens.has(providerToken(provider))));
      featureScopes.push(container);
      const controller = await container.resolveAsync(feature.controller);
      featureScopesByPrefix.push({ prefix: feature.prefix, container });

      elysia.group(feature.prefix, (group) => {
        const routes = controller.routes as unknown as (app: AnyElysia) => AnyElysia;
        const registered = routes.call(controller, group);
        if (!registered || typeof registered !== "object") {
          throw new Error(`${feature.name}: controller routes(app) must return the Elysia instance`);
        }
        return registered;
      });
    }

    if (compositionRoot !== applicationRoot) await applicationRoot.initialize();
    await compositionRoot.initialize();
    for (const scope of featureScopes) await scope.initialize();
  } catch (error) {
    try {
      await disposeScopes(featureScopes, compositionRoot, applicationRoot);
    } catch (cleanupError) {
      throw new AggregateError(
        [...flattenErrors(error), ...flattenErrors(cleanupError)],
        "application bootstrap failed",
      );
    }
    throw error;
  }

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    const requestFailures: unknown[] = [];
    try {
      for (const scope of [...activeRequestScopes]) {
        try {
          await scope.dispose();
        } catch (error) {
          requestFailures.push(error);
        }
      }
      activeRequestScopes.clear();

      try {
        await disposeScopes(featureScopes, compositionRoot, applicationRoot);
      } catch (error) {
        requestFailures.push(error);
      }

      if (requestFailures.length > 0) {
        throw new AggregateError(requestFailures, "application disposal failed");
      }
    } finally {
      bootstrapDisposals.delete(elysia);
    }
  };
  elysia.onStop(dispose);
  bootstrapDisposals.set(elysia, dispose);

  if (options.printFeatures !== false) printFeatures(app.features);
  return elysia;
}

function validateMaxRequestBodyBytes(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("maxRequestBodyBytes must be a non-negative integer");
  }
}

function durationFor(request: Request, startedAt: WeakMap<Request, number>) {
  const start = startedAt.get(request);
  return start === undefined ? undefined : durationMilliseconds(start);
}

async function disposeScopes(scopes: readonly Container[], root: Container, parent?: Container) {
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

function flattenErrors(error: unknown): unknown[] {
  if (error instanceof AggregateError) return error.errors.flatMap(flattenErrors);
  return [error];
}

function finishSpan(
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
    logger?.error("telemetry.span.end.error", {
      ...(requestId ? { requestId } : {}),
      error: spanError instanceof Error ? spanError.message : String(spanError),
    });
  }
}

function recordRequestMetrics(
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
    logger?.error("telemetry.metrics.error", {
      ...(requestId ? { requestId } : {}),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function recordRequestInspector(
  request: Request,
  status: number,
  startedAt: WeakMap<Request, number>,
  routes: WeakMap<Request, string>,
  recorded: WeakSet<Request>,
  inspector: Inspector | undefined,
  logger: Logger | undefined,
  requestId: string | undefined,
  errorCode?: string,
) {
  if (!inspector || recorded.has(request)) return;
  recorded.add(request);

  try {
    const durationMs = durationFor(request, startedAt);
    inspector.record({
      type: "http.request",
      ...(requestId ? { requestId } : {}),
      method: request.method,
      route: routes.get(request) ?? "unknown",
      status,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(errorCode ? { errorCode } : {}),
    });
  } catch (error) {
    logger?.error("inspector.record.error", {
      ...(requestId ? { requestId } : {}),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function disposeRequestScope(
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
    logger?.error("http.request.scope.error", {
      ...(requestId ? { requestId } : {}),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function parentForRequest(
  url: string,
  features: readonly { readonly prefix: string; readonly container: Container }[],
  root: Container | undefined,
) {
  const path = pathFromUrl(url);
  const feature = [...features]
    .sort((left, right) => right.prefix.length - left.prefix.length)
    .find(({ prefix }) => path === prefix || path.startsWith(`${prefix}/`));
  if (feature) return feature.container;
  if (root) return root;
  throw new GraphError("request dependency scope is not available before bootstrap completes");
}
