export type DatabaseAdapter<TClient, TTransaction = TClient> = {
  readonly connect: () => TClient | Promise<TClient>;
  readonly close: (client: TClient) => void | Promise<void>;
  readonly transaction: <TResult>(
    client: TClient,
    work: (transaction: TTransaction) => TResult | Promise<TResult>,
  ) => TResult | Promise<TResult>;
  readonly ping?: (client: TClient, signal?: AbortSignal) => void | Promise<void>;
};

export type DatabaseState = "disconnected" | "connecting" | "connected" | "closed";

export type DatabaseEvent = {
  readonly operation: "connect" | "transaction" | "close";
  readonly status: "start" | "success" | "failure";
  readonly durationMs?: number;
};

export type DatabaseConnectionOptions = {
  readonly onEvent?: (event: DatabaseEvent) => void;
  readonly now?: () => number;
};

/**
 * Lifecycle and transaction boundary for an application-owned database driver.
 * Query builders, models, and migration semantics remain the driver's concern.
 */
export class DatabaseConnection<TClient, TTransaction = TClient> {
  private client: TClient | undefined;
  private hasClient = false;
  private state: DatabaseState = "disconnected";
  private initializing: Promise<void> | undefined;
  private disposing: Promise<void> | undefined;
  private activeOperations = 0;
  private readonly idleWaiters: Array<() => void> = [];
  private readonly onEvent: ((event: DatabaseEvent) => void) | undefined;
  private readonly now: () => number;

  constructor(
    private readonly adapter: DatabaseAdapter<TClient, TTransaction>,
    options: DatabaseConnectionOptions = {},
  ) {
    this.onEvent = options.onEvent;
    this.now = options.now ?? (() => performance.now());
  }

  get status(): DatabaseState {
    return this.state;
  }

  async initialize() {
    if (this.state === "connected") return;
    if (this.state === "closed") throw new Error("database connection has been closed");
    if (this.initializing) return this.initializing;

    this.state = "connecting";
    this.initializing = (async () => {
      const startedAt = this.now();
      this.observe({ operation: "connect", status: "start" });
      try {
        const client = await this.adapter.connect();
        if (this.state === "closed") {
          await this.adapter.close(client);
          throw new Error("database connection was closed while connecting");
        }
        this.client = client;
        this.hasClient = true;
        this.state = "connected";
        this.observe({ operation: "connect", status: "success", durationMs: this.duration(startedAt) });
      } catch (error) {
        if (this.state !== "closed") this.state = "disconnected";
        this.observe({ operation: "connect", status: "failure", durationMs: this.duration(startedAt) });
        throw error;
      }
    })();

    try {
      await this.initializing;
    } finally {
      this.initializing = undefined;
    }
  }

  async use<TResult>(work: (client: TClient) => TResult | Promise<TResult>): Promise<TResult> {
    await this.initialize();
    const release = this.beginOperation();
    try {
      return await work(this.requireClient());
    } finally {
      release();
    }
  }

  async transaction<TResult>(
    work: (transaction: TTransaction) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    await this.initialize();
    const release = this.beginOperation();
    const startedAt = this.now();
    this.observe({ operation: "transaction", status: "start" });
    try {
      const result = await this.adapter.transaction(this.requireClient(), work);
      this.observe({ operation: "transaction", status: "success", durationMs: this.duration(startedAt) });
      return result;
    } catch (error) {
      this.observe({ operation: "transaction", status: "failure", durationMs: this.duration(startedAt) });
      throw error;
    } finally {
      release();
    }
  }

  async ping(signal?: AbortSignal) {
    await this.initialize();
    if (!this.adapter.ping) return;
    const release = this.beginOperation();
    try {
      await this.adapter.ping(this.requireClient(), signal);
    } finally {
      release();
    }
  }

  async dispose() {
    if (this.disposing) return this.disposing;
    if (this.state === "closed") return;
    this.state = "closed";
    this.disposing = this.finishDispose();
    return this.disposing;
  }

  private async finishDispose() {
    await this.initializing?.catch(() => undefined);
    await this.waitForIdle();

    if (!this.hasClient) return;
    const client = this.client as TClient;
    this.client = undefined;
    this.hasClient = false;
    const startedAt = this.now();
    this.observe({ operation: "close", status: "start" });
    try {
      await this.adapter.close(client);
      this.observe({ operation: "close", status: "success", durationMs: this.duration(startedAt) });
    } catch (error) {
      this.observe({ operation: "close", status: "failure", durationMs: this.duration(startedAt) });
      throw error;
    }
  }

  private requireClient() {
    if (this.state !== "connected" || !this.hasClient) {
      throw new Error("database connection is not ready");
    }
    return this.client as TClient;
  }

  private beginOperation() {
    this.requireClient();
    this.activeOperations += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        for (const resolve of this.idleWaiters.splice(0)) resolve();
      }
    };
  }

  private waitForIdle() {
    if (this.activeOperations === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private duration(startedAt: number) {
    return Math.max(0, Math.round((this.now() - startedAt) * 100) / 100);
  }

  private observe(event: DatabaseEvent) {
    try {
      this.onEvent?.(event);
    } catch {
      // Database telemetry must never change database correctness.
    }
  }
}
