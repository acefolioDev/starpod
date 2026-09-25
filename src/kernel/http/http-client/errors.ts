import type { HttpClientErrorCode, HttpClientErrorOptions } from "./types";

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
