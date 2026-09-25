import { durationMilliseconds, type Span, type TraceContext, type Tracer } from "../../observability/observability";

export function startHttpSpan(
  tracer: Tracer | undefined,
  method: string,
  url: string,
  attempt: number,
  parent: TraceContext | undefined,
): Span | undefined {
  if (!tracer) return undefined;
  try {
    return tracer.startSpan("http.client", {
      "http.method": method,
      "http.url": url,
      "http.retry_attempt": attempt,
    }, parent);
  } catch {
    return undefined;
  }
}

export function finishHttpSpan(span: Span | undefined, status: number | undefined, error: unknown, startedAt: number) {
  if (!span) return;
  try {
    if (status !== undefined) span.setAttribute("http.status_code", status);
    span.setAttribute("http.response.duration_ms", durationMilliseconds(startedAt));
    if (error !== undefined) {
      span.recordException(error);
      span.setStatus("error");
    } else {
      span.setStatus("ok");
    }
    span.end();
  } catch {
    // A telemetry adapter must never change outbound request behavior.
  }
}
