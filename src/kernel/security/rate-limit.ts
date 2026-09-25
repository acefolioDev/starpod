import type { AnyElysia } from "elysia";
import { TooManyRequests } from "../errors/errors";

export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Absolute epoch time in milliseconds when the current window resets. */
  readonly resetAt: number;
};

/**
 * A store must make consume atomic for its deployment model. The in-memory
 * implementation below is safe within one process; distributed applications
 * should provide a Redis or other shared-store implementation.
 */
export type RateLimitStore = {
  consume(key: string, limit: number, windowMs: number): RateLimitDecision | Promise<RateLimitDecision>;
};

export type RateLimitOptions = {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
  readonly key?: (request: Request) => string | Promise<string>;
  readonly name?: string;
  readonly store?: RateLimitStore;
  readonly skip?: (request: Request) => boolean | Promise<boolean>;
};

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: { readonly maxKeys?: number; readonly now?: () => number } = {}) {
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maxKeys) || this.maxKeys < 1) {
      throw new Error("MemoryRateLimitStore maxKeys must be a positive integer");
    }
  }

  consume(key: string, limit: number, windowMs: number): RateLimitDecision {
    const now = this.now();
    this.purge(now);

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  clear() {
    this.buckets.clear();
  }

  private purge(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export function rateLimit(options: RateLimitOptions) {
  validateOptions(options);
  const store = options.store ?? new MemoryRateLimitStore();
  const name = options.name ?? "default";
  const key = options.key ?? (() => "anonymous");
  const now = options.now ?? Date.now;

  return (app: AnyElysia) => app.onBeforeHandle({ as: "global" }, async ({ request, set }) => {
    if (await options.skip?.(request)) return;

    const identity = await key(request);
    if (!identity || identity.trim() === "") throw new Error("rateLimit key must return a non-empty string");
    if (identity.length > 512) throw new Error("rateLimit key must be at most 512 characters");

    const decision = await store.consume(rateLimitKey(name, identity), options.limit, options.windowMs);
    const resetInSeconds = Math.max(0, Math.ceil((decision.resetAt - now()) / 1000));
    set.headers["ratelimit-limit"] = String(decision.limit);
    set.headers["ratelimit-remaining"] = String(decision.remaining);
    set.headers["ratelimit-reset"] = String(resetInSeconds);
    // Keep the widely used legacy names during the alpha period.
    set.headers["x-ratelimit-limit"] = String(decision.limit);
    set.headers["x-ratelimit-remaining"] = String(decision.remaining);
    set.headers["x-ratelimit-reset"] = String(Math.ceil(decision.resetAt / 1000));

    if (!decision.allowed) {
      const retryAfter = Math.max(1, Math.ceil((decision.resetAt - now()) / 1000));
      set.headers["retry-after"] = String(retryAfter);
      throw TooManyRequests();
    }
  }) as AnyElysia;
}

function validateOptions(options: RateLimitOptions) {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error("rateLimit limit must be a positive integer");
  }
  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
    throw new Error("rateLimit windowMs must be a positive number");
  }
  if (options.name !== undefined && (!options.name || options.name.length > 128 || /[\r\n]/.test(options.name))) {
    throw new Error("rateLimit name must be a non-empty single-line string of at most 128 characters");
  }
}

function rateLimitKey(name: string, identity: string) {
  return `${encodeURIComponent(name)}:${encodeURIComponent(identity)}`;
}
