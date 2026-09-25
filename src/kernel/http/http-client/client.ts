import type { Span, TraceContext, Tracer } from "../../observability/observability";
import { HttpClientError } from "./errors";
import {
  fetchAttempt,
  httpExponentialBackoff,
  parseAllowedOrigins,
  parseBaseUrl,
  readText,
  safeTarget,
  safeInput,
  safeUrl,
  statusError,
  waitForRetry,
  validateNonNegativeInteger,
  validatePositiveInteger,
  validatePositiveNumber,
  validateRetryDelay,
} from "./utils";
import { durationMilliseconds } from "../../observability/observability";
import { finishHttpSpan, startHttpSpan } from "./telemetry";
import type {
  FetchImplementation,
  HttpClientErrorCode,
  HttpClientEvent,
  HttpClientObserver,
  HttpClientOptions,
  HttpRequestOptions,
} from "./types";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const;
const DEFAULT_RETRY_METHODS = ["GET", "HEAD", "OPTIONS"] as const;
/**
 * Small dependency-free outbound HTTP boundary around standard fetch.
 * It does not hide fetch: callers still control method, headers, body, and signal.
 */
export class HttpClient {
  private readonly baseUrl: URL | undefined;
  private readonly allowedOrigins: ReadonlySet<string> | undefined;
  private readonly defaultHeaders: Headers;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly traceContext: TraceContext | undefined;
  private readonly retries: number;
  private readonly retryDelayMs: number | ((attempt: number) => number);
  private readonly retryMethods: ReadonlySet<string>;
  private readonly retryStatuses: ReadonlySet<number>;
  private readonly onEvent: HttpClientObserver | undefined;
  private readonly tracer: Tracer | undefined;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl === undefined ? undefined : parseBaseUrl(options.baseUrl);
    this.allowedOrigins = parseAllowedOrigins(options.allowedOrigins, this.baseUrl);
    this.defaultHeaders = new Headers(options.headers);
    this.fetchImplementation = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.traceContext = options.traceContext;
    this.retries = options.retries ?? 0;
    this.retryDelayMs = options.retryDelayMs ?? httpExponentialBackoff();
    this.retryMethods = new Set((options.retryMethods ?? DEFAULT_RETRY_METHODS).map((method) => method.toUpperCase()));
    this.retryStatuses = new Set(options.retryStatuses ?? DEFAULT_RETRY_STATUSES);
    this.onEvent = options.onEvent;
    this.tracer = options.tracer;

    validatePositiveNumber(this.timeoutMs, "HttpClient timeoutMs");
    validatePositiveInteger(this.maxResponseBytes, "HttpClient maxResponseBytes");
    validateNonNegativeInteger(this.retries, "HttpClient retries");
    validateRetryDelay(this.retryDelayMs);
    for (const status of this.retryStatuses) {
      if (!Number.isInteger(status) || status < 400 || status > 599) {
        throw new Error("HttpClient retryStatuses must contain HTTP status integers from 400 through 599");
      }
    }
  }

  async request(target: string | URL, options: HttpRequestOptions = {}): Promise<Response> {
    const url = this.resolve(target);
    const method = (options.method ?? "GET").toUpperCase();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const retries = options.retries ?? this.retries;
    const maxAttempts = retries + 1;
    validatePositiveNumber(timeoutMs, "HttpClient request timeoutMs");
    validateNonNegativeInteger(retries, "HttpClient request retries");

    const headers = new Headers(this.defaultHeaders);
    for (const [key, value] of new Headers(options.headers)) headers.set(key, value);

    let lastError: HttpClientError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = performance.now();
      const span = startHttpSpan(this.tracer, method, safeUrl(url), attempt, options.traceContext ?? this.traceContext);
      if (span && this.tracer?.inject) {
        try {
          this.tracer.inject(span, headers);
        } catch {
          // Trace propagation must never change outbound request behavior.
        }
      }
      try {
        const response = await fetchAttempt(this.fetchImplementation, url, {
          ...options,
          headers,
          method,
          signal: options.signal,
        }, timeoutMs, method, attempt);
        const retryable = this.retryMethods.has(method) &&
          attempt < maxAttempts && this.retryStatuses.has(response.status);

        finishHttpSpan(
          span,
          response.status,
          response.status >= 400 ? new Error(`HTTP ${response.status}`) : undefined,
          startedAt,
        );

        this.observe({
          operation: "attempt",
          method,
          url: safeUrl(url),
          attempt,
          status: response.status,
          durationMs: durationMilliseconds(startedAt),
          outcome: retryable ? "retry" : "response",
        });

        if (!retryable) return response;
        await response.body?.cancel();
        await waitForRetry(this.retryDelayMs, attempt, response.headers.get("retry-after"), options.signal);
      } catch (error) {
        const clientError = error instanceof HttpClientError
          ? error
          : new HttpClientError({
              code: "NETWORK_ERROR",
              method,
              url: safeUrl(url),
              attempt,
              cause: error,
            });
        lastError = clientError;
        const retryable = this.retryMethods.has(method) && attempt < maxAttempts &&
          (clientError.code === "NETWORK_ERROR" || clientError.code === "TIMEOUT");
        this.observe({
          operation: "attempt",
          method,
          url: safeUrl(url),
          attempt,
          durationMs: durationMilliseconds(startedAt),
          outcome: retryable ? "retry" : "error",
          errorCode: clientError.code,
        });
        finishHttpSpan(span, undefined, clientError, startedAt);
        if (!retryable) throw clientError;
        await waitForRetry(this.retryDelayMs, attempt, undefined, options.signal);
      }
    }

    throw lastError ?? new HttpClientError({
      code: "NETWORK_ERROR",
      method,
      url: safeUrl(url),
    });
  }

  async text(target: string | URL, options: HttpRequestOptions = {}): Promise<string> {
    const response = await this.request(target, options);
    return readText(
      response,
      options.maxResponseBytes ?? this.maxResponseBytes,
      response.status,
      target,
      (options.method ?? "GET").toUpperCase(),
      this.baseUrl,
    );
  }

  async json<T>(target: string | URL, options: HttpRequestOptions = {}): Promise<T> {
    const response = await this.request(target, options);
    const method = (options.method ?? "GET").toUpperCase();
    if (!response.ok) {
      await response.body?.cancel();
      throw statusError(response, target, method, this.baseUrl);
    }

    const raw = await readText(
      response,
      options.maxResponseBytes ?? this.maxResponseBytes,
      response.status,
      target,
      method,
      this.baseUrl,
    );
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      throw new HttpClientError({
        code: "INVALID_JSON",
        method,
        url: safeTarget(target, this.baseUrl),
        status: response.status,
        cause: error,
      });
    }
  }

  private resolve(target: string | URL): URL {
    try {
      const url = new URL(target.toString(), this.baseUrl);
      if (url.username || url.password) {
        throw new HttpClientError({
          code: "INVALID_URL",
          method: "GET",
          url: safeUrl(url),
        });
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new HttpClientError({
          code: "INVALID_URL",
          method: "GET",
          url: safeUrl(url),
        });
      }
      if (this.allowedOrigins && !this.allowedOrigins.has(url.origin)) {
        throw new HttpClientError({
          code: "INVALID_URL",
          method: "GET",
          url: safeUrl(url),
        });
      }
      return url;
    } catch (error) {
      if (error instanceof HttpClientError) throw error;
      throw new HttpClientError({
        code: "INVALID_URL",
        method: "GET",
        url: safeInput(target),
        cause: error,
      });
    }
  }
  private observe(event: HttpClientEvent) {
    try {
      this.onEvent?.(event);
    } catch {
      // Observability must never change outbound request behavior.
    }
  }
}
