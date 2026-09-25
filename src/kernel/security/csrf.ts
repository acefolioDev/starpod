import type { AnyElysia } from "elysia";
import { cookieValue } from "./auth";
import { Forbidden } from "./errors";

export type CsrfOptions = {
  /** Defaults to `csrf-token`. */
  readonly cookieName?: string;
  /** Defaults to `x-csrf-token`. */
  readonly headerName?: string;
  /** Methods that do not mutate state. Defaults to GET, HEAD, and OPTIONS. */
  readonly safeMethods?: readonly string[];
  readonly skip?: (request: Request) => boolean | Promise<boolean>;
};

const DEFAULT_SAFE_METHODS = ["GET", "HEAD", "OPTIONS"] as const;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

/** Create a URL-safe random token suitable for a CSRF cookie. */
export function csrfToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 64) {
    throw new Error("csrfToken bytes must be an integer from 16 through 64");
  }
  const random = crypto.getRandomValues(new Uint8Array(bytes));
  return base64Url(random);
}

/**
 * Apply double-submit-cookie CSRF protection through native Elysia hooks.
 * Bearer-only APIs should not install this plugin; cookie-authenticated writes should.
 */
export function csrfProtection(options: CsrfOptions = {}) {
  const cookieName = options.cookieName ?? "csrf-token";
  const headerName = options.headerName ?? "x-csrf-token";
  const safeMethods = new Set((options.safeMethods ?? DEFAULT_SAFE_METHODS).map((method) => method.toUpperCase()));
  validateName(cookieName, "cookieName");
  validateHeaderName(headerName);

  return (app: AnyElysia) => app.onBeforeHandle({ as: "global" }, async ({ request }) => {
    if (safeMethods.has(request.method.toUpperCase()) || await options.skip?.(request)) return;

    const cookie = cookieValue(request, cookieName);
    const header = request.headers.get(headerName)?.trim();
    if (!cookie || !header || !TOKEN_PATTERN.test(cookie) || !TOKEN_PATTERN.test(header) || !constantTimeEqual(cookie, header)) {
      throw Forbidden("CSRF token is invalid");
    }
  }) as AnyElysia;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function validateName(value: string, label: string) {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) {
    throw new Error(`CSRF ${label} must be a valid token name`);
  }
}

function validateHeaderName(value: string) {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) {
    throw new Error("CSRF headerName must be a valid HTTP header name");
  }
}
