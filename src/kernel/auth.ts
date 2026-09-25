import type { AnyElysia } from "elysia";
import type Elysia from "elysia";
import { Forbidden, Unauthorized } from "./errors";
import type { StarpodSingleton } from "./http";

export type Principal = {
  readonly id: string;
  readonly roles?: readonly string[];
  readonly permissions?: readonly string[];
};

export type Authenticator<TPrincipal> = (request: Request) => TPrincipal | null | Promise<TPrincipal | null>;

export type AuthenticationOptions = {
  readonly required?: boolean;
};

export type ApiKeyOptions = {
  /** Defaults to `x-api-key`. */
  readonly header?: string;
  /** Optional exact prefix such as `Api-Key `. */
  readonly prefix?: string;
};

export type AuthenticatedSingleton<TPrincipal> = Omit<StarpodSingleton, "resolve"> & {
  readonly resolve: {
    readonly user: TPrincipal | null;
  };
};

/** Native Elysia with a typed authenticated context. */
export type AuthenticatedElysia<TPrincipal> = Elysia<string, AuthenticatedSingleton<TPrincipal>>;

export function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization) return undefined;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  return match?.[1];
}

/** Read an API key from an explicit header without accepting query parameters. */
export function apiKeyFrom(request: Request, options: ApiKeyOptions = {}): string | undefined {
  const value = request.headers.get(options.header ?? "x-api-key")?.trim();
  if (!value || value.length > 4_096) return undefined;
  if (options.prefix === undefined) return value;
  if (!value.startsWith(options.prefix)) return undefined;
  const key = value.slice(options.prefix.length).trim();
  return key && key.length <= 4_096 ? key : undefined;
}

/** Read one exact cookie value. Invalid percent-encoding is rejected. */
export function cookieValue(request: Request, name: string): string | undefined {
  if (!COOKIE_NAME_PATTERN.test(name)) return undefined;
  const header = request.headers.get("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function authentication<TPrincipal>(
  authenticate: Authenticator<TPrincipal>,
  options: AuthenticationOptions = {},
): (app: AnyElysia) => AnyElysia {
  return (app) => app.resolve({ as: "global" }, async ({ request }) => {
    const user = await authenticate(request);
    if (options.required && (user === null || user === undefined)) throw Unauthorized();
    return { user };
  }) as AnyElysia;
}

export function requireUser<TPrincipal>(user: TPrincipal | null | undefined): TPrincipal {
  if (user === null || user === undefined) throw Unauthorized();
  return user;
}

export function requireRole(user: Principal | null | undefined, role: string): Principal {
  const principal = requireUser(user);
  if (!principal.roles?.includes(role)) throw Forbidden();
  return principal;
}

export function requirePermission(user: Principal | null | undefined, permission: string): Principal {
  const principal = requireUser(user);
  if (!principal.permissions?.includes(permission)) throw Forbidden();
  return principal;
}

const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
