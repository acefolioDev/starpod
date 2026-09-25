import { TooManyRequests } from "../errors/errors";
import { observeOperation, type OperationTelemetry } from "../observability/operation";

export type BruteForceState = {
  readonly failures: number;
  readonly expiresAt: number;
  readonly blockedUntil: number;
};

export type BruteForceStore = {
  get(key: string): BruteForceState | undefined | Promise<BruteForceState | undefined>;
  /** Atomically increment a failure and return the resulting state. */
  recordFailure(
    key: string,
    now: number,
    options: { readonly maxFailures: number; readonly windowMs: number; readonly lockoutMs: number },
  ): BruteForceState | Promise<BruteForceState>;
  delete(key: string): void | Promise<void>;
};

export type BruteForceDecision = {
  readonly allowed: boolean;
  readonly failures: number;
  readonly retryAfterMs: number;
};

export type BruteForceOptions = OperationTelemetry & {
  readonly maxFailures: number;
  readonly windowMs: number;
  readonly lockoutMs: number;
  readonly store?: BruteForceStore;
  readonly now?: () => number;
};

/** A bounded, process-local store for development and single-instance deployments. */
export class MemoryBruteForceStore implements BruteForceStore {
  private readonly states = new Map<string, BruteForceState>();
  private readonly maxKeys: number;
  private readonly now: () => number;
  private saturated: BruteForceState | undefined;

  constructor(options: { readonly maxKeys?: number; readonly now?: () => number } = {}) {
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maxKeys) || this.maxKeys < 1) {
      throw new Error("MemoryBruteForceStore maxKeys must be a positive integer");
    }
  }

  get(key: string) {
    const now = this.now();
    this.purge(now);
    return this.states.get(key) ?? this.saturated;
  }

  recordFailure(key: string, now: number, options: {
    readonly maxFailures: number;
    readonly windowMs: number;
    readonly lockoutMs: number;
  }) {
    validateKey(key);
    this.purge(now);
    const active = this.states.get(key);
    if (active?.blockedUntil && active.blockedUntil > now) return active;
    if (!active && this.saturated) return this.saturated;

    const failures = (active?.failures ?? 0) + 1;
    const state = Object.freeze({
      failures,
      expiresAt: active?.expiresAt ?? now + options.windowMs,
      blockedUntil: failures >= options.maxFailures ? now + options.lockoutMs : 0,
    });
    if (!active && this.states.size >= this.maxKeys) {
      this.saturated = Object.freeze({
        failures: options.maxFailures,
        expiresAt: this.nextCapacityAt(now, options.windowMs),
        blockedUntil: this.nextCapacityAt(now, options.lockoutMs),
      });
      return this.saturated;
    }
    this.states.set(key, state);
    return state;
  }

  set(key: string, state: BruteForceState) {
    if (!this.states.has(key) && this.states.size >= this.maxKeys) return;
    this.states.set(key, state);
  }

  delete(key: string) {
    this.states.delete(key);
  }

  private purge(now: number) {
    for (const [key, state] of this.states) {
      if (Math.max(state.expiresAt, state.blockedUntil) <= now) this.states.delete(key);
    }
    if (this.saturated && this.saturated.blockedUntil <= now) this.saturated = undefined;
  }

  private nextCapacityAt(now: number, fallbackMs: number) {
    let next = now + fallbackMs;
    for (const state of this.states.values()) {
      next = Math.min(next, Math.max(state.expiresAt, state.blockedUntil));
    }
    return next;
  }
}

/** Explicit login-attempt tracking; provide a shared atomic store when scaling out. */
export class BruteForceGuard {
  private readonly store: BruteForceStore;
  private readonly now: () => number;

  constructor(private readonly options: BruteForceOptions) {
    validateOptions(options);
    this.store = options.store ?? new MemoryBruteForceStore({ now: options.now });
    this.now = options.now ?? Date.now;
  }

  async check(key: string): Promise<BruteForceDecision> {
    validateKey(key);
    const state = await this.activeState(key);
    if (!state) return decision(true, 0, 0);
    const retryAfterMs = Math.max(0, state.blockedUntil - this.now());
    return decision(retryAfterMs === 0, state.failures, retryAfterMs);
  }

  async assertAllowed(key: string) {
    const result = await this.check(key);
    if (!result.allowed) throw TooManyRequests("Too many authentication attempts");
    return result;
  }

  async recordFailure(key: string): Promise<BruteForceDecision> {
    validateKey(key);
    const now = this.now();
    const state = await this.store.recordFailure(key, now, this.options);
    return decision(state.blockedUntil <= now, state.failures, Math.max(0, state.blockedUntil - now));
  }

  async recordSuccess(key: string) {
    validateKey(key);
    await this.store.delete(key);
  }

  async run<TResult>(key: string, authenticate: () => TResult | Promise<TResult>): Promise<TResult> {
    return observeOperation(this.options, "security.brute_force", async () => {
      await this.assertAllowed(key);
      let result: TResult;
      try {
        result = await authenticate();
      } catch (error) {
        await this.recordFailure(key);
        throw error;
      }
      await this.recordSuccess(key);
      return result;
    });
  }

  private async activeState(key: string) {
    const state = await this.store.get(key);
    const now = this.now();
    const expired = state && state.blockedUntil > 0
      ? state.blockedUntil <= now
      : state?.expiresAt !== undefined && state.expiresAt <= now;
    if (!state || expired) {
      if (state) await this.store.delete(key);
      return undefined;
    }
    return state;
  }
}

function decision(allowed: boolean, failures: number, retryAfterMs: number): BruteForceDecision {
  return Object.freeze({ allowed, failures, retryAfterMs });
}

function validateOptions(options: BruteForceOptions) {
  if (!Number.isInteger(options.maxFailures) || options.maxFailures < 1) {
    throw new Error("brute-force maxFailures must be a positive integer");
  }
  for (const [name, value] of [["windowMs", options.windowMs], ["lockoutMs", options.lockoutMs]] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`brute-force ${name} must be positive`);
  }
}

function validateKey(key: string) {
  if (!key || key.length > 512 || /[\r\n]/.test(key)) {
    throw new Error("brute-force key must be a non-empty single-line string of at most 512 characters");
  }
}
