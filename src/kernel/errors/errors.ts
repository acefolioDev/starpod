export type ErrorDetails = Record<string, unknown> | readonly unknown[];

export type StarpodErrorOptions = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: ErrorDetails;
  readonly exposeDetails?: boolean;
  readonly cause?: unknown;
};

export type ErrorPayload = {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: ErrorDetails;
    readonly requestId?: string;
  };
};

export class StarpodError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetails;
  readonly exposeDetails: boolean;

  constructor(options: StarpodErrorOptions) {
    validateStatus(options.status);
    validateCode(options.code);
    validateMessage(options.message);
    super(options.message, { cause: options.cause });
    this.name = "StarpodError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.exposeDetails = options.exposeDetails ?? false;
  }
}

export function BadRequest(message = "Bad request", details?: ErrorDetails) {
  return new StarpodError({
    status: 400,
    code: "BAD_REQUEST",
    message,
    details,
    exposeDetails: details !== undefined,
  });
}

export function Unauthorized(message = "Authentication required") {
  return new StarpodError({ status: 401, code: "UNAUTHORIZED", message });
}

export function Forbidden(message = "You do not have permission to perform this action") {
  return new StarpodError({ status: 403, code: "FORBIDDEN", message });
}

export function NotFound(resource = "Resource") {
  return new StarpodError({
    status: 404,
    code: "NOT_FOUND",
    message: `${resource} not found`,
  });
}

export function Conflict(message = "The request conflicts with the current state") {
  return new StarpodError({ status: 409, code: "CONFLICT", message });
}

export function TooManyRequests(message = "Too many requests") {
  return new StarpodError({ status: 429, code: "TOO_MANY_REQUESTS", message });
}

export function PayloadTooLarge(message = "Request body is too large") {
  return new StarpodError({ status: 413, code: "PAYLOAD_TOO_LARGE", message });
}

export function InternalServerError(cause?: unknown) {
  return new StarpodError({
    status: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred",
    cause,
  });
}

export type ErrorSerializationOptions = {
  readonly development?: boolean;
  readonly requestId?: string;
};

const MAX_DETAIL_DEPTH = 6;
const MAX_DETAIL_ENTRIES = 100;
const MAX_ERROR_MESSAGE_LENGTH = 2_048;
const REDACTED = "[REDACTED]";
const UNAVAILABLE = "[UNAVAILABLE]";
const TRUNCATED = "[TRUNCATED]";
const CIRCULAR = "[CIRCULAR]";
const SENSITIVE_DETAIL_KEY = /(?:pass(?:word|wd)?|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key|connection[-_]?string|database[-_]?url|sql|query|statement|stack|cause)/i;

type NativeHttpError = {
  readonly code: string;
  readonly status: number;
  readonly message: string;
};

const NATIVE_ERROR_CODES: Readonly<Record<string, { readonly code: string; readonly message: string }>> = {
  VALIDATION: { code: "VALIDATION_ERROR", message: "Request validation failed" },
  PARSE: { code: "PARSE_ERROR", message: "Request could not be parsed" },
  NOT_FOUND: { code: "NOT_FOUND", message: "Route not found" },
  INVALID_COOKIE_SIGNATURE: { code: "INVALID_COOKIE_SIGNATURE", message: "Invalid cookie signature" },
  INTERNAL_SERVER_ERROR: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" },
};

export function serializeError(
  error: unknown,
  options: ErrorSerializationOptions = {},
): { status: number; payload: ErrorPayload } {
  const starpodError = error instanceof StarpodError ? error : undefined;
  const nativeError = isNativeHttpError(error) ? NATIVE_ERROR_CODES[error.code] : undefined;
  const status = starpodError?.status ?? (nativeError ? (error as NativeHttpError).status : 500);
  const code = starpodError?.code ?? nativeError?.code ?? "INTERNAL_SERVER_ERROR";
  const message = starpodError?.message ?? nativeError?.message ?? "An unexpected error occurred";
  const details = starpodError?.exposeDetails && starpodError.details !== undefined
    ? sanitizeDetails(starpodError.details)
    : options.development && error instanceof Error && !starpodError
      ? { name: error.name, message: error.message }
      : undefined;
  const payload: ErrorPayload = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(options.requestId ? { requestId: options.requestId } : {}),
    },
  };

  return { status, payload };
}

/**
 * Keep explicitly exposed details useful without allowing common secret-shaped
 * fields, cyclic objects, or non-JSON values to cross the HTTP boundary.
 */
function sanitizeDetails(value: ErrorDetails): ErrorDetails {
  const state = { entries: 0 };
  return sanitizeValue(value, 0, new WeakSet<object>(), state) as ErrorDetails;
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  state: { entries: number },
): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return UNAVAILABLE;
  }
  if (depth >= MAX_DETAIL_DEPTH) return TRUNCATED;
  if (seen.has(value)) return CIRCULAR;

    seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      for (const item of value) {
        if (state.entries++ >= MAX_DETAIL_ENTRIES) {
          output.push(TRUNCATED);
          break;
        }
        output.push(sanitizeValue(item, depth + 1, seen, state));
      }
      return output;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? UNAVAILABLE : value.toISOString();
    }

    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (state.entries++ >= MAX_DETAIL_ENTRIES) {
        output[TRUNCATED] = "additional detail entries omitted";
        break;
      }
      output[key] = SENSITIVE_DETAIL_KEY.test(key)
        ? REDACTED
        : sanitizeValue((value as Record<string, unknown>)[key], depth + 1, seen, state);
    }
    return output;
  } catch {
    return UNAVAILABLE;
  } finally {
    seen.delete(value);
  }
}

function isNativeHttpError(error: unknown): error is NativeHttpError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Partial<NativeHttpError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.status === "number" &&
    candidate.status >= 400 &&
    candidate.status < 600 &&
    candidate.code in NATIVE_ERROR_CODES
  );
}

function validateStatus(status: number) {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new Error("StarpodError status must be an HTTP error status from 400 through 599");
  }
}

function validateCode(code: string) {
  if (!code || code.length > 128 || /[\r\n]/.test(code)) {
    throw new Error("StarpodError code must be a non-empty single-line string of at most 128 characters");
  }
}

function validateMessage(message: string) {
  if (!message || message.length > MAX_ERROR_MESSAGE_LENGTH) {
    throw new Error("StarpodError message must be non-empty and at most 2048 characters");
  }
}
