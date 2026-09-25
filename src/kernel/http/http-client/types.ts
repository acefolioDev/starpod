import type { TraceContext, Tracer } from "../../observability/observability";

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
  /** Restrict requests to these HTTP(S) origins. With baseUrl, the default is its origin. */
  readonly allowedOrigins?: readonly (string | URL)[];
  readonly headers?: RequestInit["headers"];
  readonly fetch?: FetchImplementation;
  /** Per-attempt timeout. Defaults to 10 seconds. */
  readonly timeoutMs?: number;
  /** Maximum bytes read by text() and json(). Defaults to 5 MiB. */
  readonly maxResponseBytes?: number;
  /** Optional incoming W3C context used as the parent of outbound spans. */
  readonly traceContext?: TraceContext;
  /** Additional attempts after the first request. Defaults to zero. */
  readonly retries?: number;
  readonly retryDelayMs?: number | ((attempt: number) => number);
  /** Defaults to GET, HEAD, and OPTIONS to avoid retrying unsafe writes. */
  readonly retryMethods?: readonly string[];
  /** Defaults to transient HTTP statuses only. */
  readonly retryStatuses?: readonly number[];
  readonly onEvent?: HttpClientObserver;
  /** Optional vendor-neutral span adapter for each outbound attempt. */
  readonly tracer?: Tracer;
};

export type HttpRequestOptions = Omit<RequestInit, "headers" | "signal"> & {
  readonly headers?: RequestInit["headers"];
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly maxResponseBytes?: number;
  readonly traceContext?: TraceContext;
};

export type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;
