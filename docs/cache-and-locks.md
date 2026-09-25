# Cache and locks: shortcuts and one-at-a-time signs

## The idea

A cache is a shortcut, not the source of truth. A lock is a “one person at a time” sign, not a magic force field. Both are useful precisely because their limits are visible.

## How Starpod provides it

Caching is explicit; Starpod never silently caches route results. `MemoryCache` is useful for development and one-process workloads. It supports TTLs, bounded LRU storage, namespaces, tags, and concurrent-loader coalescing.

```ts
import { MemoryCache } from "starpod";

const cache = new MemoryCache({ maxEntries: 10_000 });
const user = await cache.getOrSet(`user:${userId}`, () => users.find(userId), {
  ttlMs: 60_000,
  tags: [`user:${userId}`],
});
cache.invalidateTag(`user:${userId}`);
```

Use a cache when stale data is acceptable or recomputation is expensive. Use tags to invalidate related entries. The bound covers completed entries and unique in-flight loaders; a full store fails closed instead of evicting active work.

## Locks

`LockStore` and `withLock` express a critical section. `MemoryLockStore` is process-local.

```ts
import { withLock } from "starpod";

await withLock(lockStore, `user:${userId}`, () => rebuildUser(userId), {
  ttlMs: 10_000,
});
```

Use locks for stampede protection or a short-lived local critical section. A distributed implementation must make acquisition atomic and protect lease ownership.

## Common mistakes

- Treating a process-local cache or lock as coordination across replicas.
- Caching authorization decisions or tenant data without including the tenant and policy inputs in the key.
- Setting a TTL longer than the data’s acceptable staleness.
- Holding a lock across slow network calls or user interaction.

## Production notes

Implement `CacheStore` and `LockStore` with a shared system when replicas need coordination. Preserve `getOrSet` stampede protection atomically. Plan invalidation, outages, eviction, and observability; Starpod does not provide distributed consistency.
