import { HttpClientError } from "./errors";
import type {
  FetchImplementation,
  HttpClientErrorCode,
  HttpRequestOptions,
} from "./types";

const MAX_RETRY_DELAY_MS = 60_000;

export function httpExponentialBackoff(baseMs = 100, maxMs = 30_000) {
  validateNonNegativeNumber(baseMs, "HttpClient backoff baseMs");
  validateNonNegativeNumber(maxMs, "HttpClient backoff maxMs");
  if (maxMs < baseMs) throw new Error("HttpClient backoff maxMs must be at least baseMs");
  return (attempt: number) => Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

export function parseBaseUrl(value: string | URL) {
  try {
    const url = new URL(value.toString());
    if (url.username || url.password) throw new Error("credentials are not allowed in baseUrl");
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("baseUrl must use http or https");
    }
    return url;
  } catch (error) {
    throw new Error(`HttpClient baseUrl is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseAllowedOrigins(
  values: readonly (string | URL)[] | undefined,
  baseUrl: URL | undefined,
): ReadonlySet<string> | undefined {
  if (values === undefined) {
    return baseUrl ? new Set([baseUrl.origin]) : undefined;
  }

  const origins = new Set<string>();
  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value.toString());
    } catch {
      throw new Error("HttpClient allowedOrigins must contain valid HTTP(S) origins");
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("HttpClient allowedOrigins must contain credential-free HTTP(S) origins");
    }
    origins.add(url.origin);
  }
  if (origins.size === 0) throw new Error("HttpClient allowedOrigins must contain at least one origin");
  return origins;
}

export function safeTarget(target: string | URL, baseUrl: URL | undefined) {
  try {
    return safeUrl(new URL(target.toString(), baseUrl));
  } catch {
    return String(target).split(/[?#]/, 1)[0] ?? String(target);
  }
}

export function safeUrl(url: URL) {
  const copy = new URL(url.href);
  copy.username = "";
  copy.password = "";
  copy.search = "";
  copy.hash = "";
  return copy.toString();
}

export async function readText(
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

export async function fetchAttempt(
  fetchImplementation: FetchImplementation,
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
      traceContext: _traceContext,
      ...requestInit
    } = options;
    return await fetchImplementation(url, { ...requestInit, signal: controller.signal });
  } catch (error) {
    const code: HttpClientErrorCode = timedOut
      ? "TIMEOUT"
      : options.signal?.aborted
        ? "ABORTED"
        : "NETWORK_ERROR";
    throw new HttpClientError({ code, method, url: safeUrl(url), attempt, cause: error });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function statusError(response: Response, target: string | URL, method: string, baseUrl: URL | undefined) {
  return new HttpClientError({
    code: "HTTP_STATUS",
    method,
    url: safeTarget(target, baseUrl),
    status: response.status,
  });
}

export async function waitForRetry(
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

export function safeInput(value: string | URL) {
  return String(value).split(/[?#]/, 1)[0] ?? String(value);
}

export function validatePositiveNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`);
}

export function validatePositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

export function validateNonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

export function validateNonNegativeNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number`);
}

export function validateRetryDelay(value: number | ((attempt: number) => number)) {
  if (typeof value === "number") validateNonNegativeNumber(value, "HttpClient retryDelayMs");
}
