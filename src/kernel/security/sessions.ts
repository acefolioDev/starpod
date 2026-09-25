import type { AnyElysia } from "elysia";
import type Elysia from "elysia";
import { Unauthorized } from "../errors/errors";
import { cookieValue } from "./auth";
import type { StarpodSingleton } from "../http/http";

export type Session = {
  readonly id: string;
  /** Absolute epoch time in milliseconds. */
  readonly expiresAt: number;
};

export type SessionStore<TSession extends Session = Session> = {
  get(id: string): TSession | null | Promise<TSession | null>;
  delete?(id: string): void | Promise<void>;
};

export type SessionCookieOptions = {
  readonly name?: string;
  readonly path?: string;
  readonly domain?: string;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly sameSite?: "lax" | "strict" | "none";
  readonly maxAgeSeconds?: number;
};

export type SessionsOptions<TSession extends Session> = {
  readonly store: SessionStore<TSession>;
  readonly cookie?: SessionCookieOptions;
  readonly required?: boolean;
  readonly now?: () => number;
};

export type SessionSingleton<TSession extends Session> = Omit<StarpodSingleton, "resolve"> & {
  readonly resolve: {
    readonly session: TSession | null;
  };
};

/** Native Elysia with a typed session in the request context. */
export type SessionElysia<TSession extends Session = Session> = Elysia<string, SessionSingleton<TSession>>;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Create a cryptographically random opaque session identifier. */
export function createSessionId(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 64) {
    throw new Error("createSessionId bytes must be an integer from 16 through 64");
  }
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Serialize a secure session cookie without exposing session data to the browser. */
export function sessionCookie(sessionId: string, options: SessionCookieOptions = {}): string {
  validateSessionId(sessionId);
  const normalized = normalizeCookieOptions(options);
  const parts = [`${normalized.name}=${encodeURIComponent(sessionId)}`, `Path=${normalized.path}`];
  if (normalized.domain) parts.push(`Domain=${normalized.domain}`);
  if (normalized.maxAgeSeconds !== undefined) parts.push(`Max-Age=${normalized.maxAgeSeconds}`);
  if (normalized.httpOnly) parts.push("HttpOnly");
  if (normalized.secure) parts.push("Secure");
  parts.push(`SameSite=${capitalize(normalized.sameSite)}`);
  return parts.join("; ");
}

export function setSessionCookie(
  headers: Record<string, string>,
  sessionId: string,
  options: SessionCookieOptions = {},
) {
  headers["set-cookie"] = sessionCookie(sessionId, options);
}

export function clearSessionCookie(headers: Record<string, string>, options: SessionCookieOptions = {}) {
  const normalized = normalizeCookieOptions(options);
  const parts = [`${normalized.name}=`, `Path=${normalized.path}`, "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"];
  if (normalized.domain) parts.push(`Domain=${normalized.domain}`);
  if (normalized.httpOnly) parts.push("HttpOnly");
  if (normalized.secure) parts.push("Secure");
  parts.push(`SameSite=${capitalize(normalized.sameSite)}`);
  headers["set-cookie"] = parts.join("; ");
}

/** Resolve an application-owned session through Elysia's native request context. */
export function sessions<TSession extends Session>(
  options: SessionsOptions<TSession>,
): (app: AnyElysia) => AnyElysia {
  const cookie = normalizeCookieOptions(options.cookie);
  const now = options.now ?? Date.now;
  return (app) => app.resolve({ as: "global" }, async ({ request, set }) => {
    const id = cookieValue(request, cookie.name);
    const validId = id !== undefined && SESSION_ID_PATTERN.test(id);
    const session = validId ? await options.store.get(id) : null;
    if (session && SESSION_ID_PATTERN.test(session.id) && Number.isFinite(session.expiresAt) && session.expiresAt > now()) {
      return { session };
    }

    if (validId && options.store.delete) await options.store.delete(id);
    if (id) clearSessionCookie(set.headers, cookie);
    if (options.required) throw Unauthorized("A valid session is required");
    return { session: null };
  }) as AnyElysia;
}

export function requireSession<TSession extends Session>(session: TSession | null | undefined): TSession {
  if (!session || session.expiresAt <= Date.now()) throw Unauthorized("A valid session is required");
  return session;
}

function normalizeCookieOptions(options: SessionCookieOptions = {}) {
  const name = options.name ?? "session";
  const path = options.path ?? "/";
  const sameSite = options.sameSite ?? "lax";
  if (!COOKIE_NAME_PATTERN.test(name)) throw new Error("session cookie name is invalid");
  if (!path.startsWith("/") || /[\r\n;]/.test(path)) throw new Error("session cookie path is invalid");
  if (options.domain !== undefined && !/^[A-Za-z0-9.-]+$/.test(options.domain)) {
    throw new Error("session cookie domain is invalid");
  }
  if (sameSite === "none" && options.secure === false) {
    throw new Error("SameSite=None session cookies require Secure");
  }
  if (options.maxAgeSeconds !== undefined &&
    (!Number.isInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 0)) {
    throw new Error("session cookie maxAgeSeconds must be a non-negative integer");
  }
  return {
    name,
    path,
    domain: options.domain,
    secure: options.secure ?? true,
    httpOnly: options.httpOnly ?? true,
    sameSite,
    maxAgeSeconds: options.maxAgeSeconds,
  };
}

function validateSessionId(id: string) {
  if (!SESSION_ID_PATTERN.test(id)) throw new Error("session id must be a URL-safe value from 16 to 256 characters");
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function capitalize(value: string) {
  return value[0]!.toUpperCase() + value.slice(1);
}
