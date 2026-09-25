export type LockLease = {
  readonly release: () => void | Promise<void>;
};

/** A store must acquire keys atomically for its deployment model. */
export type LockStore = {
  acquire(key: string, ttlMs: number): LockLease | null | Promise<LockLease | null>;
};

export type MemoryLockStoreOptions = {
  readonly maxKeys?: number;
  readonly now?: () => number;
};

/** Process-local lock store for tests and single-instance applications. */
export class MemoryLockStore implements LockStore {
  private readonly locks = new Map<string, { readonly token: string; readonly expiresAt: number }>();
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: MemoryLockStoreOptions = {}) {
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maxKeys) || this.maxKeys < 1) {
      throw new Error("MemoryLockStore maxKeys must be a positive integer");
    }
  }

  acquire(key: string, ttlMs: number): LockLease | null {
    validateKey(key);
    validateTtl(ttlMs);
    const now = this.now();
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > now) return null;
    if (existing) this.locks.delete(key);
    if (this.locks.size >= this.maxKeys) this.locks.delete(this.locks.keys().next().value!);

    const token = crypto.randomUUID();
    this.locks.set(key, { token, expiresAt: now + ttlMs });
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        if (this.locks.get(key)?.token === token) this.locks.delete(key);
      },
    };
  }
}

/** Execute work under an explicit lock and always release the lease. */
export async function withLock<TResult>(
  store: LockStore,
  key: string,
  work: () => TResult | Promise<TResult>,
  options: { readonly ttlMs?: number } = {},
): Promise<TResult> {
  const lease = await store.acquire(key, options.ttlMs ?? 10_000);
  if (!lease) throw new Error(`lock is already held: ${key}`);
  try {
    return await work();
  } finally {
    await lease.release();
  }
}

function validateKey(key: string) {
  if (!key || key.length > 512 || /[\r\n]/.test(key)) {
    throw new Error("lock key must be a non-empty single-line string of at most 512 characters");
  }
}

function validateTtl(ttlMs: number) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("lock ttlMs must be positive");
}
