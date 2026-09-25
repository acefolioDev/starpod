import type { AnyElysia } from "elysia";

export type EtagOptions = {
  /** Methods eligible for conditional responses. Defaults to GET and HEAD. */
  readonly methods?: readonly string[];
  /** Optional cache policy applied when the route did not set one. */
  readonly cacheControl?: string;
  /** Maximum UTF-8 response size to hash. Defaults to 1 MiB. */
  readonly maxBodyBytes?: number;
  /** Emit weak validators instead of strong validators. */
  readonly weak?: boolean;
};

const DEFAULT_METHODS = ["GET", "HEAD"] as const;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * Add HTTP entity tags to finite JSON and text responses through native Elysia
 * response mapping. Streaming responses and explicit Response objects are
 * intentionally left untouched so the plugin cannot consume their bodies.
 */
export function etag(options: EtagOptions = {}) {
  const methods = Object.freeze(
    [...(options.methods ?? DEFAULT_METHODS)].map((method) => method.toUpperCase()),
  );
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  validateOptions(methods, maxBodyBytes, options.cacheControl);

  return (app: AnyElysia) => app.mapResponse(async ({ request, responseValue, set }) => {
    if (!methods.includes(request.method.toUpperCase())) return;

    const status = typeof set.status === "number" ? set.status : 200;
    if (status < 200 || status >= 300 || status === 204) return;

    const bytes = encodeFiniteBody(responseValue, maxBodyBytes);
    if (!bytes) return;

    const digest = await sha256(bytes);
    const validator = `${options.weak ? "W/" : ""}"${digest}"`;
    set.headers.etag = validator;
    if (options.cacheControl && !hasHeader(set.headers, "cache-control")) {
      set.headers["cache-control"] = options.cacheControl;
    }

    if (!matchesIfNoneMatch(request.headers.get("if-none-match"), validator)) return;

    set.status = 304;
    return new Response(null, { status: 304 });
  }) as AnyElysia;
}

function encodeFiniteBody(value: unknown, maxBytes: number): Uint8Array | undefined {
  if (value instanceof Response) return undefined;
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) return undefined;

  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "object") {
    try {
      text = JSON.stringify(value) ?? "null";
    } catch {
      return undefined;
    }
  } else {
    return undefined;
  }

  const bytes = new TextEncoder().encode(text);
  return bytes.byteLength <= maxBytes ? bytes : undefined;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function matchesIfNoneMatch(header: string | null, validator: string) {
  if (!header) return false;
  const normalized = normalizeValidator(validator);
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || normalizeValidator(value) === normalized;
  });
}

function normalizeValidator(value: string) {
  return value.replace(/^W\//i, "").trim();
}

function hasHeader(headers: Record<string, string | number>, name: string) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function validateOptions(methods: readonly string[], maxBodyBytes: number, cacheControl: string | undefined) {
  if (methods.length === 0 || methods.some((method) => !/^[A-Z]+$/.test(method))) {
    throw new Error("etag methods must contain at least one valid HTTP method");
  }
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new Error("etag maxBodyBytes must be a positive integer");
  }
  if (cacheControl !== undefined && /[\r\n]/.test(cacheControl)) {
    throw new Error("etag cacheControl must not contain header injection characters");
  }
}
