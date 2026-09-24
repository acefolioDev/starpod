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

/**
 * Lifecycle and transaction boundary for an application-owned database driver.
 * Query builders, models, and migration semantics remain the driver's concern.
 */
export class DatabaseConnection<TClient, TTransaction = TClient> {
  private client: TClient | undefined;
  private hasClient = false;
  private state: DatabaseState = "disconnected";
  private initializing: Promise<void> | undefined;

  constructor(private readonly adapter: DatabaseAdapter<TClient, TTransaction>) {}

  get status(): DatabaseState {
    return this.state;
  }

  async initialize() {
    if (this.state === "connected") return;
    if (this.state === "closed") throw new Error("database connection has been closed");
    if (this.initializing) return this.initializing;

    this.state = "connecting";
    this.initializing = (async () => {
      try {
        const client = await this.adapter.connect();
        if (this.state === "closed") {
          await this.adapter.close(client);
          throw new Error("database connection was closed while connecting");
        }
        this.client = client;
        this.hasClient = true;
        this.state = "connected";
      } catch (error) {
        if (this.state !== "closed") this.state = "disconnected";
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
    return work(this.requireClient());
  }

  async transaction<TResult>(
    work: (transaction: TTransaction) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    await this.initialize();
    return this.adapter.transaction(this.requireClient(), work);
  }

  async ping(signal?: AbortSignal) {
    await this.initialize();
    if (this.adapter.ping) await this.adapter.ping(this.requireClient(), signal);
  }

  async dispose() {
    if (this.state === "closed") return;
    this.state = "closed";
    await this.initializing?.catch(() => undefined);

    if (!this.hasClient) return;
    const client = this.client as TClient;
    this.client = undefined;
    this.hasClient = false;
    await this.adapter.close(client);
  }

  private requireClient() {
    if (this.state !== "connected" || !this.hasClient) {
      throw new Error("database connection is not ready");
    }
    return this.client as TClient;
  }
}
