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

/** Vendor-neutral boundary for adapters such as OpenTelemetry. */
export type Tracer = {
  startSpan(name: string, attributes?: SpanAttributes): Span;
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

export function durationMilliseconds(startedAt: number, endedAt = performance.now()): number {
  return Math.max(0, Math.round((endedAt - startedAt) * 100) / 100);
}
