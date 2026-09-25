import { observeOperation, observeSyncOperation, type OperationTelemetry } from "../observability/operation";

export type CacheSetOptions = {
  readonly ttlMs?: number;
  readonly tags?: readonly string[];
};

export type CacheEvent =
  | { readonly operation: "get"; readonly key: string; readonly hit: boolean }
  | { readonly operation: "set"; readonly key: string }
  | { readonly operation: "delete"; readonly key: string; readonly removed: boolean }
  | { readonly operation: "invalidateTag"; readonly tag: string; readonly removed: number }
  | { readonly operation: "getOrSet"; readonly key: string; readonly hit: boolean; readonly coalesced: boolean }
  | { readonly operation: "clear" };

export type CacheObserver = (event: CacheEvent) => void;

export type CacheStore = {
  get<T>(key: string): T | undefined | Promise<T | undefined>;
  set<T>(key: string, value: T, options?: CacheSetOptions): void | Promise<void>;
  getOrSet<T>(key: string, loader: () => T | Promise<T>, options?: CacheSetOptions): Promise<T>;
  delete(key: string): boolean | Promise<boolean>;
  invalidateTag(tag: string): number | Promise<number>;
};

export type MemoryCacheOptions = OperationTelemetry & {
  readonly maxEntries?: number;
  readonly now?: () => number;
  readonly onEvent?: CacheObserver;
};

type Entry = {
  readonly value: unknown;
  readonly expiresAt: number | undefined;
  readonly tags: readonly string[];
};

type CacheRead<T> =
  | { readonly hit: true; readonly value: T }
  | { readonly hit: false };

export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, Entry>();
  private readonly tagKeys = new Map<string, Set<string>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly onEvent: CacheObserver | undefined;
  private readonly telemetry: OperationTelemetry;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? (() => Date.now());
    this.onEvent = options.onEvent;
    this.telemetry = options;
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error("MemoryCache maxEntries must be a positive integer");
    }
  }

  get<T>(key: string): T | undefined {
    return observeSyncOperation(this.telemetry, "cache.get", () => {
      const result = this.read<T>(key);
      this.observe({ operation: "get", key, hit: result.hit });
      return result.hit ? result.value : undefined;
    }, { "cache.operation": "get" });
  }

  set<T>(key: string, value: T, options: CacheSetOptions = {}) {
    return observeSyncOperation(this.telemetry, "cache.set", () => {
      validateKey(key);
      const tags = validateSetOptions(options);
      this.removeEntry(key);
      while (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.delete(oldest);
      }
      this.entries.set(key, {
        value,
        expiresAt: options.ttlMs === undefined ? undefined : this.now() + options.ttlMs,
        tags,
      });
      for (const tag of tags) {
        const keys = this.tagKeys.get(tag) ?? new Set<string>();
        keys.add(key);
        this.tagKeys.set(tag, keys);
      }
      this.observe({ operation: "set", key });
    }, { "cache.operation": "set" });
  }

  delete(key: string) {
    return observeSyncOperation(this.telemetry, "cache.delete", () => {
      validateKey(key);
      const removed = this.removeEntry(key);
      this.observe({ operation: "delete", key, removed });
      return removed;
    }, { "cache.operation": "delete" });
  }

  invalidateTag(tag: string) {
    return observeSyncOperation(this.telemetry, "cache.invalidate_tag", () => {
      validateKey(tag, "cache tag");
      const keys = [...(this.tagKeys.get(tag) ?? [])];
      for (const key of keys) this.delete(key);
      this.observe({ operation: "invalidateTag", tag, removed: keys.length });
      return keys.length;
    }, { "cache.operation": "invalidate_tag" });
  }

  async getOrSet<T>(key: string, loader: () => T | Promise<T>, options: CacheSetOptions = {}) {
    return observeOperation(this.telemetry, "cache.get_or_set", () => this.getOrSetValue(key, loader, options), {
      "cache.operation": "get_or_set",
    });
  }

  private async getOrSetValue<T>(key: string, loader: () => T | Promise<T>, options: CacheSetOptions) {
    validateKey(key);
    validateSetOptions(options);
    const cached = this.read<T>(key);
    if (cached.hit) {
      this.observe({ operation: "getOrSet", key, hit: true, coalesced: false });
      return cached.value;
    }

    const active = this.inFlight.get(key);
    if (active) {
      this.observe({ operation: "getOrSet", key, hit: false, coalesced: true });
      return active as Promise<T>;
    }
    if (this.inFlight.size >= this.maxEntries) {
      throw new Error("MemoryCache capacity is exhausted");
    }

    this.observe({ operation: "getOrSet", key, hit: false, coalesced: false });

    const pending = (async () => {
      const value = await loader();
      this.set(key, value, options);
      return value;
    })();
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      this.inFlight.delete(key);
    }
  }

  namespace(prefix: string): CacheStore {
    validateKey(prefix, "cache namespace");
    return new NamespacedCache(this, prefix);
  }

  clear() {
    return observeSyncOperation(this.telemetry, "cache.clear", () => {
      this.entries.clear();
      this.tagKeys.clear();
      // Active loaders cannot be cancelled by CacheStore. Keep their promises
      // coalesced; once they finish, their value may repopulate the cache.
      this.observe({ operation: "clear" });
    }, { "cache.operation": "clear" });
  }

  private read<T>(key: string): CacheRead<T> {
    validateKey(key);
    const entry = this.entries.get(key);
    if (!entry) return { hit: false };
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.delete(key);
      return { hit: false };
    }
    // Keep the bounded in-memory cache LRU: the least recently read entry is
    // the first candidate for eviction when the limit is reached.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { hit: true, value: entry.value as T };
  }

  private observe(event: CacheEvent) {
    try {
      this.onEvent?.(event);
    } catch {
      // Observability must not change cache correctness.
    }
  }

  private removeEntry(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    for (const tag of entry.tags) {
      const keys = this.tagKeys.get(tag);
      if (!keys) continue;
      keys.delete(key);
      if (keys.size === 0) this.tagKeys.delete(tag);
    }
    return true;
  }
}

class NamespacedCache implements CacheStore {
  constructor(private readonly cache: MemoryCache, private readonly prefix: string) {}

  get<T>(key: string) {
    return this.cache.get<T>(this.key(key));
  }

  set<T>(key: string, value: T, options?: CacheSetOptions) {
    return this.cache.set(this.key(key), value, this.tags(options));
  }

  getOrSet<T>(key: string, loader: () => T | Promise<T>, options?: CacheSetOptions) {
    return this.cache.getOrSet(this.key(key), loader, this.tags(options));
  }

  delete(key: string) {
    return this.cache.delete(this.key(key));
  }

  invalidateTag(tag: string) {
    return this.cache.invalidateTag(this.key(tag));
  }

  private key(key: string) {
    validateKey(key);
    return `${encodeURIComponent(this.prefix)}:${encodeURIComponent(key)}`;
  }

  private tags(options: CacheSetOptions | undefined): CacheSetOptions | undefined {
    if (!options?.tags) return options;
    return { ...options, tags: options.tags.map((tag) => this.key(tag)) };
  }
}

function validateKey(value: string, label = "cache key") {
  if (!value || value.includes("\n") || value.includes("\r")) {
    throw new Error(`${label} must be a non-empty single-line string`);
  }
}

function validateSetOptions(options: CacheSetOptions) {
  if (options.ttlMs !== undefined && (!Number.isFinite(options.ttlMs) || options.ttlMs < 0)) {
    throw new Error("cache ttlMs must be a finite non-negative number");
  }
  const tags = Object.freeze([...(options.tags ?? [])]);
  for (const tag of tags) validateKey(tag, "cache tag");
  return tags;
}
