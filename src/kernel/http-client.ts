export type HttpClientErrorCode =
  | "INVALID_URL"
  | "TIMEOUT"
  | "ABORTED"
  | "NETWORK_ERROR"
  | "HTTP_STATUS"
  | "INVALID_JSON"
  | "RESPONSE_TOO_LARGE";

export type HttpClientErrorOptions = {
  readonly code: HttpClientErrorCode;
  readonly method: string;
  readonly url: string;
  readonly attempt?: number;
  readonly status?: number;
  readonly cause?: unknown;
};

/** A safe, structured failure from an outbound HTTP request. */
export class HttpClientError extends Error {
  readonly code: HttpClientErrorCode;
  readonly method: string;
  readonly url: string;
  readonly attempt: number;
  readonly status: number | undefined;

  constructor(options: HttpClientErrorOptions) {
    super(messageFor(options), { cause: options.cause });
    this.name = "HttpClientError";
    this.code = options.code;
    this.method = options.method;
    this.url = options.url;
    this.attempt = options.attempt ?? 1;
    this.status = options.status;
  }
}

export type HttpClientEvent = {
  readonly operation: "attempt";
  readonly method: string;
  /** URL without query values or credentials. */
  readonly url: string;
  readonly attempt: number;
  readonly status?: number;
  readonly durationMs: number;
  readonly outcome: "response" | "retry" | "error";
  readonly errorCode?: HttpClientErrorCode;
};

export type HttpClientObserver = (event: HttpClientEvent) => void;

export type HttpClientOptions = {
  readonly baseUrl?: string | URL;
  readonly headers?: RequestInit["headers"];
  readonly fetch?: FetchImplementation;
  /** Per-attempt timeout. Defaults to 10 seconds. */
  readonly timeoutMs?: number;
  /** Maximum bytes read by text() and json(). Defaults to 5 MiB. */
  readonly maxResponseBytes?: number;
  /** Additional attempts after the first request. Defaults to zero. */
  readonly retries?: number;
  readonly retryDelayMs?: number | ((attempt: number) => number);
  /** Defaults to GET, HEAD, and OPTIONS to avoid retrying unsafe writes. */
  readonly retryMethods?: readonly string[];
  /** Defaults to transient HTTP statuses only. */
  readonly retryStatuses?: readonly number[];
  readonly onEvent?: HttpClientObserver;
};

export type HttpRequestOptions = Omit<RequestInit, "headers" | "signal"> & {
  readonly headers?: RequestInit["headers"];
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly maxResponseBytes?: number;
};

export type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const;
const DEFAULT_RETRY_METHODS = ["GET", "HEAD", "OPTIONS"] as const;
const MAX_RETRY_DELAY_MS = 60_000;

/**
 * Small dependency-free outbound HTTP boundary around standard fetch.
 * It does not hide fetch: callers still control method, headers, body, and signal.
 */
export class HttpClient {
  private readonly baseUrl: URL | undefined;
  private readonly defaultHeaders: Headers;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly retries: number;
  private readonly retryDelayMs: number | ((attempt: number) => number);
  private readonly retryMethods: ReadonlySet<string>;
  private readonly retryStatuses: ReadonlySet<number>;
  private readonly onEvent: HttpClientObserver | undefined;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl === undefined ? undefined : parseBaseUrl(options.baseUrl);
    this.defaultHeaders = new Headers(options.headers);
    this.fetchImplementation = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.retries = options.retries ?? 0;
    this.retryDelayMs = options.retryDelayMs ?? httpExponentialBackoff();
    this.retryMethods = new Set((options.retryMethods ?? DEFAULT_RETRY_METHODS).map((method) => method.toUpperCase()));
    this.retryStatuses = new Set(options.retryStatuses ?? DEFAULT_RETRY_STATUSES);
    this.onEvent = options.onEvent;

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
      try {
        const response = await this.fetchAttempt(url, {
          ...options,
          headers,
          method,
          signal: options.signal,
        }, timeoutMs, method, attempt);
        const retryable = this.retryMethods.has(method) &&
          attempt < maxAttempts && this.retryStatuses.has(response.status);

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

  private async fetchAttempt(
    url: URL,
    options: HttpRequestOptions,
    timeoutMs: number,
    method: string,
    attempt: number,
  ) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal) {
      if (options.signal.aborted) controller.abort(options.signal.reason);
      else options.signal.addEventListener("abort", abort, { once: true });
    }

    try {
      const {
        timeoutMs: _timeoutMs,
        retries: _retries,
        maxResponseBytes: _maxResponseBytes,
        ...requestInit
      } = options;
      return await this.fetchImplementation(url, { ...requestInit, signal: controller.signal });
    } catch (error) {
      const code: HttpClientErrorCode = timedOut
        ? "TIMEOUT"
        : options.signal?.aborted
          ? "ABORTED"
          : "NETWORK_ERROR";
      throw new HttpClientError({
        code,
        method,
        url: safeUrl(url),
        attempt,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
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

export function httpExponentialBackoff(baseMs = 100, maxMs = 30_000) {
  validateNonNegativeNumber(baseMs, "HttpClient backoff baseMs");
  validateNonNegativeNumber(maxMs, "HttpClient backoff maxMs");
  if (maxMs < baseMs) throw new Error("HttpClient backoff maxMs must be at least baseMs");
  return (attempt: number) => Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

function parseBaseUrl(value: string | URL) {
  try {
    const url = new URL(value.toString());
    if (url.username || url.password) throw new Error("credentials are not allowed in baseUrl");
    return url;
  } catch (error) {
    throw new Error(`HttpClient baseUrl is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function safeTarget(target: string | URL, baseUrl: URL | undefined) {
  try {
    return safeUrl(new URL(target.toString(), baseUrl));
  } catch {
    return String(target).split(/[?#]/, 1)[0] ?? String(target);
  }
}

function safeUrl(url: URL) {
  const copy = new URL(url.href);
  copy.username = "";
  copy.password = "";
  copy.search = "";
  copy.hash = "";
  return copy.toString();
}

async function readText(
  response: Response,
  maxBytes: number,
  status: number,
  target: string | URL,
  method: string,
  baseUrl: URL | undefined,
) {
  validatePositiveInteger(maxBytes, "HttpClient maxResponseBytes");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new HttpClientError({
      code: "RESPONSE_TOO_LARGE",
      method,
      url: safeTarget(target, baseUrl),
      status,
    });
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpClientError({
          code: "RESPONSE_TOO_LARGE",
          method,
          url: safeTarget(target, baseUrl),
          status,
        });
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function statusError(response: Response, target: string | URL, method: string, baseUrl: URL | undefined) {
  return new HttpClientError({
    code: "HTTP_STATUS",
    method,
    url: safeTarget(target, baseUrl),
    status: response.status,
  });
}

async function waitForRetry(
  delay: number | ((attempt: number) => number),
  attempt: number,
  retryAfter: string | null | undefined,
  signal: AbortSignal | undefined,
) {
  const configured = typeof delay === "function" ? delay(attempt) : delay;
  const retryAfterMs = parseRetryAfter(retryAfter);
  const duration = Math.min(
    MAX_RETRY_DELAY_MS,
    retryAfterMs === undefined ? configured : Math.max(configured, retryAfterMs),
  );
  validateNonNegativeNumber(duration, "HttpClient retry delay");
  if (duration === 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new HttpClientError({ code: "ABORTED", method: "GET", url: "retry" }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, duration);
    const abort = () => {
      clearTimeout(timer);
      reject(new HttpClientError({ code: "ABORTED", method: "GET", url: "retry" }));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function safeInput(value: string | URL) {
  return String(value).split(/[?#]/, 1)[0] ?? String(value);
}

function messageFor(options: HttpClientErrorOptions) {
  const target = `${options.method} ${options.url}`;
  switch (options.code) {
    case "TIMEOUT": return `${target} timed out`;
    case "ABORTED": return `${target} was aborted`;
    case "HTTP_STATUS": return `${target} returned HTTP ${options.status ?? "error"}`;
    case "INVALID_JSON": return `${target} returned invalid JSON`;
    case "RESPONSE_TOO_LARGE": return `${target} returned a response that is too large`;
    case "INVALID_URL": return `${target} has an invalid URL`;
    default: return `${target} failed with a network error`;
  }
}

function validatePositiveNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`);
}

function validatePositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

function validateNonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function validateNonNegativeNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number`);
}

function validateRetryDelay(value: number | ((attempt: number) => number)) {
  if (typeof value === "number") validateNonNegativeNumber(value, "HttpClient retryDelayMs");
}
import { durationMilliseconds } from "./observability";
