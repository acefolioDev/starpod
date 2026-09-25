import {
  durationMilliseconds,
  type Metrics,
  type Span,
  type SpanAttributes,
  type Tracer,
} from "./observability";

export type OperationTelemetry = {
  readonly tracer?: Tracer;
  readonly metrics?: Metrics;
};

/** Run a framework operation with isolated vendor-neutral span and metric telemetry. */
export async function observeOperation<T>(
  telemetry: OperationTelemetry,
  name: string,
  work: () => T | Promise<T>,
  attributes: SpanAttributes = {},
): Promise<T> {
  const startedAt = performance.now();
  let span: Span | undefined;
  try {
    span = telemetry.tracer?.startSpan(name, attributes);
  } catch {
    span = undefined;
  }

  try {
    const result = await work();
    finish(telemetry, name, span, startedAt, undefined, false);
    return result;
  } catch (error) {
    finish(telemetry, name, span, startedAt, error, true);
    throw error;
  }
}

/** Synchronous counterpart for cache and other non-async framework operations. */
export function observeSyncOperation<T>(
  telemetry: OperationTelemetry,
  name: string,
  work: () => T,
  attributes: SpanAttributes = {},
): T {
  const startedAt = performance.now();
  let span: Span | undefined;
  try {
    span = telemetry.tracer?.startSpan(name, attributes);
  } catch {
    span = undefined;
  }
  try {
    const result = work();
    finish(telemetry, name, span, startedAt, undefined, false);
    return result;
  } catch (error) {
    finish(telemetry, name, span, startedAt, error, true);
    throw error;
  }
}

function finish(
  telemetry: OperationTelemetry,
  name: string,
  span: Span | undefined,
  startedAt: number,
  error: unknown,
  failed: boolean,
) {
  const durationMs = durationMilliseconds(startedAt);
  const outcome = failed ? "error" : "success";
  try {
    if (span) {
      span.setAttribute("operation.duration_ms", durationMs);
      if (failed) {
        span.recordException(error);
        span.setStatus("error");
      } else {
        span.setStatus("ok");
      }
      span.end();
    }
  } catch {
    // Telemetry adapters must never change framework operation semantics.
  }
  try {
    telemetry.metrics?.increment(`${name}.operations`, 1, { outcome });
    telemetry.metrics?.observe(`${name}.duration_ms`, durationMs, { outcome });
  } catch {
    // Metrics adapters must never change framework operation semantics.
  }
}
