import type { AnyElysia } from "elysia";
import type Elysia from "elysia";
import { BadRequest, Forbidden } from "../errors/errors";
import type { StarpodSingleton } from "../http/http";
import type { CacheSetOptions, CacheStore } from "../data/cache";
import { validateTenantId } from "./tenant-id";
export { validateTenantId } from "./tenant-id";

export type Tenant = {
  readonly id: string;
};

export type TenantResolver<TTenant extends Tenant> = (
  request: Request,
) => TTenant | null | Promise<TTenant | null>;

export type TenancyOptions = {
  readonly required?: boolean;
};

export type TenantSingleton<TTenant extends Tenant> = Omit<StarpodSingleton, "resolve"> & {
  readonly resolve: {
    readonly tenant: TTenant | null;
  };
};

/** Native Elysia with an explicit tenant in the request context. */
export type TenantElysia<TTenant extends Tenant = Tenant> = Elysia<string, TenantSingleton<TTenant>>;

/** Resolve tenant identity once per request through Elysia's native resolve hook. */
export function tenancy<TTenant extends Tenant>(
  resolveTenant: TenantResolver<TTenant>,
  options: TenancyOptions = {},
): (app: AnyElysia) => AnyElysia {
  return (app) => app.resolve({ as: "global" }, async ({ request }) => {
    const tenant = await resolveTenant(request);
    if (!tenant) {
      if (options.required) throw Forbidden("A tenant is required for this request");
      return { tenant: null };
    }
    assertTenant(tenant);
    return { tenant };
  }) as AnyElysia;
}

export function requireTenant<TTenant extends Tenant>(tenant: TTenant | null | undefined): TTenant {
  if (!tenant) throw Forbidden("A tenant is required for this request");
  assertTenant(tenant);
  return tenant;
}

/** Build an explicit tenant-prefixed key for caches, locks, and other stores. */
export function tenantKey(tenantId: string, key: string): string {
  validateTenantId(tenantId);
  validatePart(key, "tenant key");
  return `${encodeURIComponent(tenantId)}:${encodeURIComponent(key)}`;
}

/** Return a cache view that scopes every key and tag to one tenant. */
export function tenantCache(cache: CacheStore, tenant: Tenant): CacheStore {
  assertTenant(tenant);
  const key = (value: string) => tenantKey(tenant.id, value);
  return {
    get: <T>(cacheKey: string) => cache.get<T>(key(cacheKey)),
    set: <T>(cacheKey: string, value: T, options?: CacheSetOptions) =>
      cache.set(key(cacheKey), value, scopeCacheOptions(options, key)),
    getOrSet: <T>(cacheKey: string, loader: () => T | Promise<T>, options?: CacheSetOptions) =>
      cache.getOrSet(key(cacheKey), loader, scopeCacheOptions(options, key)),
    delete: (cacheKey: string) => cache.delete(key(cacheKey)),
    invalidateTag: (tag: string) => cache.invalidateTag(key(tag)),
  };
}

function assertTenant<TTenant extends Tenant>(tenant: TTenant) {
  validateTenantId(tenant.id);
}

function validatePart(value: string, label: string) {
  if (!value || value.includes("\n") || value.includes("\r")) {
    throw BadRequest(`Invalid ${label}`);
  }
}

function scopeCacheOptions(options: CacheSetOptions | undefined, key: (value: string) => string) {
  if (!options?.tags) return options;
  return { ...options, tags: options.tags.map(key) };
}
