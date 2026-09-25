export type IdempotencyStore = {
  /** Run only once for an ID; failed work remains eligible for retry. */
  runOnce(id: string, work: () => Promise<void>): void | Promise<void>;
};

export type MemoryIdempotencyOptions = {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
  readonly now?: () => number;
};

/** Bounded process-local duplicate protection for tests and single instances. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly completed = new Map<string, number>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: MemoryIdempotencyOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.ttlMs = options.ttlMs ?? 86_400_000;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error("MemoryIdempotencyStore maxEntries must be a positive integer");
    }
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error("MemoryIdempotencyStore ttlMs must be positive");
    }
  }

  async runOnce(id: string, work: () => Promise<void>): Promise<void> {
    validateId(id);
    this.purge(this.now());
    if (this.completed.has(id)) return;
    const active = this.pending.get(id);
    if (active) return active;

    const pending = (async () => {
      await work();
      this.completed.delete(id);
      this.completed.set(id, this.now() + this.ttlMs);
      this.trim();
    })();
    this.pending.set(id, pending);
    try {
      await pending;
    } finally {
      this.pending.delete(id);
    }
  }

  clear() {
    this.completed.clear();
  }

  private purge(now: number) {
    for (const [id, expiresAt] of this.completed) {
      if (expiresAt <= now) this.completed.delete(id);
    }
  }

  private trim() {
    while (this.completed.size > this.maxEntries) {
      const oldest = this.completed.keys().next().value;
      if (oldest === undefined) return;
      this.completed.delete(oldest);
    }
  }
}

function validateId(id: string) {
  if (!id || id.length > 1_024 || /[\r\n]/.test(id)) {
    throw new Error("idempotency key must be a non-empty single-line string of at most 1024 characters");
  }
}
