import type {
  MetricLabels,
  Metrics,
  Span,
  SpanAttributes,
  SpanAttributeValue,
  TraceContext,
  Tracer,
} from "./observability";

export type OpenTelemetrySpanLike = {
  setAttribute(name: string, value: SpanAttributeValue): void;
  recordException(error: unknown): void;
  setStatus(status: { readonly code: number }): void;
  end(): void;
};

export type OpenTelemetryApiLike<TContext = unknown> = {
  context: { active(): TContext };
  trace: {
    getTracer(name: string, version?: string): {
      startSpan(
        name: string,
        options?: { readonly attributes?: Readonly<Record<string, SpanAttributeValue>> },
        context?: TContext,
      ): OpenTelemetrySpanLike;
    };
    setSpan(context: TContext, span: OpenTelemetrySpanLike): TContext;
  };
  propagation: {
    extract(context: TContext, carrier: Record<string, string>): TContext;
    inject(
      context: TContext,
      carrier: Record<string, string>,
      setter: { set(carrier: Record<string, string>, key: string, value: string): void },
    ): void;
  };
  readonly statusCodes?: { readonly ok?: number; readonly error?: number };
};

export type OpenTelemetryTracerOptions = {
  readonly name?: string;
  readonly version?: string;
};

/** Adapt an installed OpenTelemetry API object without making it a Starpod dependency. */
export function openTelemetryTracer<TContext>(
  api: OpenTelemetryApiLike<TContext>,
  options: OpenTelemetryTracerOptions = {},
): Tracer {
  const tracer = api.trace.getTracer(options.name ?? "starpod", options.version);
  const spans = new WeakMap<Span, OpenTelemetrySpanLike>();
  const okCode = api.statusCodes?.ok ?? 1;
  const errorCode = api.statusCodes?.error ?? 2;

  return {
    startSpan(name, attributes, parent) {
      const context = parent
        ? api.propagation.extract(api.context.active(), traceCarrier(parent))
        : api.context.active();
      const raw = tracer.startSpan(name, { attributes: compactAttributes(attributes) }, context);
      const span: Span = {
        setAttribute: (key, value) => raw.setAttribute(key, value),
        recordException: (error) => raw.recordException(error),
        setStatus: (status) => raw.setStatus({ code: status === "ok" ? okCode : errorCode }),
        end: () => raw.end(),
      };
      spans.set(span, raw);
      return span;
    },
    inject(span, headers) {
      const raw = spans.get(span);
      if (!raw) return;
      const carrier: Record<string, string> = {};
      const context = api.trace.setSpan(api.context.active(), raw);
      api.propagation.inject(context, carrier, {
        set(target, key, value) {
          target[key] = value;
        },
      });
      for (const [key, value] of Object.entries(carrier)) headers.set(key, value);
    },
  };
}

export type OpenTelemetryInstrumentLike = {
  add(value: number, labels?: MetricLabels): void;
  record(value: number, labels?: MetricLabels): void;
};

export type OpenTelemetryMeterLike = {
  createCounter(name: string): Pick<OpenTelemetryInstrumentLike, "add">;
  createHistogram(name: string): Pick<OpenTelemetryInstrumentLike, "record">;
};

export type OpenTelemetryMeterProviderLike = {
  getMeter(name: string, version?: string): OpenTelemetryMeterLike;
};

/** Adapt OpenTelemetry counters and histograms to Starpod's metrics boundary. */
export function openTelemetryMetrics(
  provider: OpenTelemetryMeterProviderLike,
  options: OpenTelemetryTracerOptions = {},
): Metrics {
  const meter = provider.getMeter(options.name ?? "starpod", options.version);
  const counters = new Map<string, Pick<OpenTelemetryInstrumentLike, "add">>();
  const histograms = new Map<string, Pick<OpenTelemetryInstrumentLike, "record">>();
  return {
    increment(name, value = 1, labels) {
      const counter = counters.get(name) ?? meter.createCounter(name);
      counters.set(name, counter);
      counter.add(value, labels);
    },
    observe(name, value, labels) {
      const histogram = histograms.get(name) ?? meter.createHistogram(name);
      histograms.set(name, histogram);
      histogram.record(value, labels);
    },
  };
}

function traceCarrier(parent: TraceContext): Record<string, string> {
  return {
    ...(parent.traceparent ? { traceparent: parent.traceparent } : {}),
    ...(parent.tracestate ? { tracestate: parent.tracestate } : {}),
  };
}

function compactAttributes(attributes: SpanAttributes | undefined): Readonly<Record<string, SpanAttributeValue>> {
  const output: Record<string, SpanAttributeValue> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value !== undefined) output[key] = value;
  }
  return output;
}
