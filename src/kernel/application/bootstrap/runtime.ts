import type { AnyElysia } from "elysia";
import { sealArchitecture } from "../architecture";
import {
  Container,
  GraphError,
  type InjectionToken,
} from "../../di/di";
import type { Application } from "../feature";
import { createBootstrapElysia } from "./hooks";
import { composeApplication } from "./composition";
import { applyPlugins } from "../plugins";
import { printFeatures } from "../print";
import { provideValue } from "../../di/di";
import { requestIdFrom, correlationIdFrom, REQUEST_CONTEXT } from "../../http/http";
import { traceContextFrom } from "../../observability/observability";
import {
  disposeRequestScope,
  disposeScopes,
  flattenErrors,
  parentForRequest,
  validateMaxRequestBodyBytes,
} from "./support";
import type { BootstrapOptions, RuntimeEnvironment } from "./types";
export type { BootstrapOptions, RuntimeEnvironment } from "./types";

const bootstrapDisposals = new WeakMap<AnyElysia, () => Promise<void>>();
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

export async function disposeBootstrap(app: AnyElysia) {
  await bootstrapDisposals.get(app)?.();
}

export async function bootstrap(app: Application, options: BootstrapOptions = {}) {
  if (options.seal !== false) await sealArchitecture(app);
  const maxRequestBodyBytes = options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  validateMaxRequestBodyBytes(maxRequestBodyBytes);

  const requestIds = new WeakMap<Request, string>();
  const correlationIds = new WeakMap<Request, string>();
  const requestStartedAt = new WeakMap<Request, number>();
  const requestRoutes = new WeakMap<Request, string>();
  const requestScopes = new WeakMap<Request, Container>();
  const requestSpans = new WeakMap<Request, import("../../observability/observability").Span>();
  const endedSpans = new WeakSet<Request>();
  const recordedMetrics = new WeakSet<Request>();
  const recordedInspector = new WeakSet<Request>();
  const activeRequestScopes = new Set<Container>();
  const featureScopesByPrefix: Array<{ readonly prefix: string; readonly container: Container }> = [];
  let root: Container | undefined;
  const environment = environmentFrom(options);
  const requestContainerFor = (request: Request, route: string) => {
    const parent = parentForRequest(route, featureScopesByPrefix, root);
    let requestContainer = requestScopes.get(request);
    if (!requestContainer) {
      const requestId = requestIds.get(request) ?? requestIdFrom(request.headers);
      const correlationId = correlationIds.get(request) ?? correlationIdFrom(request.headers, requestId);
      requestContainer = parent.requestScope([provideValue(REQUEST_CONTEXT, Object.freeze({
        request,
        route,
        requestId,
        correlationId,
        traceContext: traceContextFrom(request.headers),
      }))]);
      requestScopes.set(request, requestContainer);
      activeRequestScopes.add(requestContainer);
    }
    return requestContainer;
  };

  let elysia = createBootstrapElysia(options, maxRequestBodyBytes, environment, {
    requestIds,
    correlationIds,
    requestStartedAt,
    requestRoutes,
    requestScopes,
    requestSpans,
    endedSpans,
    recordedMetrics,
    recordedInspector,
    activeRequestScopes,
    requestContainerFor,
  });
  elysia = applyPlugins(elysia, app.plugins) as typeof elysia;
  const configured = options.configure?.(elysia as AnyElysia);
  if (configured) elysia = configured as typeof elysia;

  const applicationRoot = new Container(app.providers);
  const compositionRoot = options.overrides?.length
    ? applicationRoot.scope(options.overrides)
    : applicationRoot;
  root = compositionRoot;
  const featureScopes: Container[] = [];

  try {
    await composeApplication(
      elysia,
      app,
      applicationRoot,
      compositionRoot,
      featureScopesByPrefix,
      options.overrides ?? [],
      featureScopes,
    );
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

  let disposal: Promise<void> | undefined;
  const dispose = () => {
    if (disposal) return disposal;
    disposal = (async () => {
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
    })();
    return disposal;
  };
  elysia.onStop(dispose);
  bootstrapDisposals.set(elysia, dispose);
  if (options.printFeatures !== false) printFeatures(app.features);
  return elysia;
}
