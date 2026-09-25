import { Elysia, type AnyElysia } from "elysia";
import { PayloadTooLarge, serializeError } from "../../errors/errors";
import {
  correlationIdFrom,
  CORRELATION_ID_HEADER,
  requestIdFrom,
  REQUEST_ID_HEADER,
} from "../../http/http";
import type { Container } from "../../di/di";
import { registerRequestResolver } from "../../http/request-dependencies";
import type { Inspector } from "../../observability/inspector";
import { pathFromUrl, traceContextFrom, type Logger, type Metrics, type Span } from "../../observability/observability";
import { applySecurityHeaders, type SecurityHeadersOptions } from "../../security/security";
import {
  disposeRequestScope,
  durationFor,
  deferResponseDisposal,
  finishSpan,
  isStreamingResponse,
  logSafely,
  recordRequestInspector,
  recordRequestMetrics,
  responseStatus,
} from "./support";
import type { BootstrapOptions, RuntimeEnvironment } from "./types";

type BootstrapHookContext = {
  readonly requestIds: WeakMap<Request, string>;
  readonly correlationIds: WeakMap<Request, string>;
  readonly requestStartedAt: WeakMap<Request, number>;
  readonly requestRoutes: WeakMap<Request, string>;
  readonly requestScopes: WeakMap<Request, Container>;
  readonly requestSpans: WeakMap<Request, Span>;
  readonly endedSpans: WeakSet<Request>;
  readonly recordedMetrics: WeakSet<Request>;
  readonly recordedInspector: WeakSet<Request>;
  readonly activeRequestScopes: Set<Container>;
  readonly requestContainerFor: (request: Request, route: string) => Container;
};

export function createBootstrapElysia(
  options: BootstrapOptions,
  maxRequestBodyBytes: number,
  environment: RuntimeEnvironment,
  context: BootstrapHookContext,
) {
  const {
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
  } = context;
  return new Elysia({
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
      const correlationId = correlationIdFrom(request.headers, requestId);
      requestIds.set(request, requestId);
      correlationIds.set(request, correlationId);
      requestRoutes.set(request, route);
      requestStartedAt.set(request, performance.now());
      set.headers[REQUEST_ID_HEADER] = requestId;
      set.headers[CORRELATION_ID_HEADER] = correlationId;
      registerRequestResolver(request, (token) => requestContainerFor(request, route).resolveAsync(token));
      if (options.securityHeaders !== false) {
        applySecurityHeaders(set.headers, options.securityHeaders);
      }
      if (options.tracer) {
        try {
          requestSpans.set(request, options.tracer.startSpan("http.server", {
            "http.method": request.method,
            "http.route": route,
            "starpod.request.id": requestId,
            "starpod.correlation.id": correlationId,
          }, traceContextFrom(request.headers)));
        } catch (error) {
          logSafely(options.logger, "error", "telemetry.span.start.error", {
            requestId,
            correlationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return {
        requestId,
        correlationId,
      };
    })
    .onError(async ({ error, request, set }) => {
      const requestId = requestIds.get(request) ?? requestIdFrom(request.headers);
      const correlationId = correlationIds.get(request) ?? correlationIdFrom(request.headers, requestId);
      const nativeResponse = typeof Response !== "undefined" && error instanceof Response ? error : undefined;
      const serialized = nativeResponse ? undefined : serializeError(error, {
        development: environment !== "production",
        requestId,
      });
      const status = nativeResponse?.status ?? serialized?.status ?? 500;
      set.status = status;
      set.headers[REQUEST_ID_HEADER] = requestId;
      set.headers[CORRELATION_ID_HEADER] = correlationId;
      logSafely(options.logger, nativeResponse ? "info" : "error", nativeResponse ? "http.request" : "http.request.error", {
        requestId,
        correlationId,
        method: request.method,
        path: pathFromUrl(request.url),
        status,
        durationMs: durationFor(request, requestStartedAt),
        ...(serialized ? { errorCode: serialized.payload.error.code } : {}),
      });
      finishSpan(request, status, nativeResponse ? undefined : error, requestSpans, endedSpans, requestStartedAt, options.logger, requestId);
      recordRequestMetrics(
        request,
        status,
        requestStartedAt,
        recordedMetrics,
        options.metrics,
        options.logger,
        requestId,
      );
      recordRequestInspector(
        request,
        status,
        requestStartedAt,
        requestRoutes,
        recordedInspector,
        options.inspector,
        options.logger,
        requestId,
        correlationId,
        serialized?.payload.error.code,
      );
      if (nativeResponse && isStreamingResponse(nativeResponse)) {
        return deferResponseDisposal(nativeResponse, () => disposeRequestScope(
          request,
          requestScopes,
          activeRequestScopes,
          options.logger,
          requestId,
        ));
      }
      await disposeRequestScope(request, requestScopes, activeRequestScopes, options.logger, requestId);
      return nativeResponse ?? serialized!.payload;
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
    .onAfterHandle(async ({ request, set, responseValue }) => {
      const status = responseStatus(responseValue, set.status);
      if (!isStreamingResponse(responseValue)) {
        await disposeRequestScope(
          request,
          requestScopes,
          activeRequestScopes,
          options.logger,
          requestIds.get(request),
        );
      }
      finishSpan(
        request,
        status,
        undefined,
        requestSpans,
        endedSpans,
        requestStartedAt,
        options.logger,
        requestIds.get(request),
      );
      recordRequestMetrics(
        request,
        status,
        requestStartedAt,
        recordedMetrics,
        options.metrics,
        options.logger,
        requestIds.get(request),
      );
      recordRequestInspector(
        request,
        status,
        requestStartedAt,
        requestRoutes,
        recordedInspector,
        options.inspector,
        options.logger,
        requestIds.get(request),
        correlationIds.get(request),
      );
      const requestId = requestIds.get(request);
      const correlationId = correlationIds.get(request);
      logSafely(options.logger, "info", "http.request", {
        ...(requestId ? { requestId } : {}),
        ...(correlationId ? { correlationId } : {}),
        method: request.method,
        path: pathFromUrl(request.url),
        status,
        durationMs: durationFor(request, requestStartedAt),
      });
    });
}
