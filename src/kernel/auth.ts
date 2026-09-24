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
