export type LogFields = Readonly<Record<string, unknown>>;

export type Logger = {
  info(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

export type SpanAttributeValue = string | number | boolean;

export type SpanAttributes = Readonly<Record<string, SpanAttributeValue | undefined>>;

export type Span = {
  setAttribute(name: string, value: SpanAttributeValue): void;
  recordException(error: unknown): void;
  setStatus(status: "ok" | "error"): void;
  end(): void;
};

export type TraceContext = {
  readonly traceparent?: string;
  readonly tracestate?: string;
};

/** Vendor-neutral boundary for adapters such as OpenTelemetry. */
export type Tracer = {
  startSpan(name: string, attributes?: SpanAttributes, parent?: TraceContext): Span;
  /** Inject the adapter's outbound context into request headers when supported. */
  inject?(span: Span, headers: Headers): void;
};

export type MetricLabels = Readonly<Record<string, string | number | boolean>>;

/** Vendor-neutral boundary for adapters such as OpenTelemetry metrics. */
export type Metrics = {
  increment(name: string, value?: number, labels?: MetricLabels): void;
  observe(name: string, value: number, labels?: MetricLabels): void;
};

export const noopTracer: Tracer = {
  startSpan: () => ({
    setAttribute() {},
    recordException() {},
    setStatus() {},
    end() {},
  }),
};

export const noopMetrics: Metrics = {
  increment() {},
  observe() {},
};

export function consoleLogger(output: Pick<Console, "info" | "error"> = console): Logger {
  return {
    info(event, fields) {
      output.info(JSON.stringify({ level: "info", event, ...fields }));
    },
    error(event, fields) {
      output.error(JSON.stringify({ level: "error", event, ...fields }));
    },
  };
}

export function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Read a validated W3C trace context without trusting arbitrary header text. */
export function traceContextFrom(headers: Headers): TraceContext | undefined {
  const traceparent = headers.get("traceparent")?.trim();
  if (!traceparent || !TRACEPARENT_PATTERN.test(traceparent)) return undefined;
  const [, traceId, spanId] = traceparent.split("-");
  if (!traceId || !spanId || /^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined;
  const tracestate = headers.get("tracestate")?.trim();
  if (tracestate && (tracestate.length > 512 || /[\r\n]/.test(tracestate))) {
    return { traceparent };
  }
  return tracestate ? { traceparent, tracestate } : { traceparent };
}

export function durationMilliseconds(startedAt: number, endedAt = performance.now()): number {
  return Math.max(0, Math.round((endedAt - startedAt) * 100) / 100);
}

const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
