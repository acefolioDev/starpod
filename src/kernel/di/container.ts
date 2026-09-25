import {
  GraphError,
  providerToken,
  type InjectionToken,
  type Provider,
} from "./providers";
import {
  isInitializable,
  tokenName,
} from "./helpers";
import { disposeContainer } from "./dispose";
import { buildAsync, buildSync, registerContainer, validateToken } from "./resolution";

export type ContainerImport = {
  readonly container: Container;
  readonly tokens: ReadonlySet<InjectionToken>;
};

export class Container {
  private readonly providers = new Map<InjectionToken, Provider>();
  private readonly instances = new Map<InjectionToken, unknown>();
  private readonly pending = new Map<InjectionToken, Promise<unknown>>();
  private readonly creationOrder: InjectionToken[] = [];
  private readonly initializedTokens = new Set<InjectionToken>();
  private disposed = false;
  private disposing: Promise<void> | undefined;
  private initializing: Promise<void> | undefined;
  constructor(
    providers: readonly Provider[] = [],
    readonly parent?: Container,
    readonly isRequestScope = false,
    readonly imports: readonly ContainerImport[] = [],
  ) {
    for (const provider of providers) this.register(provider);
    registerContainer(this, {
      providers: this.providers,
      instances: this.instances,
      pending: this.pending,
      creationOrder: this.creationOrder,
      parent,
      isRequestScope,
      imports,
      isDisposed: () => this.disposed,
    });
  }
  register(...providers: readonly Provider[]) {
    for (const provider of providers) {
      const token = providerToken(provider);
      if (this.providers.has(token)) {
        throw new GraphError(`duplicate provider: ${tokenName(token)}`);
      }
      this.providers.set(token, provider);
    }
    return this;
  }
  scope(providers: readonly Provider[] = [], imports: readonly ContainerImport[] = []) {
    return new Container(providers, this, false, imports);
  }
  /** Create a per-request child scope. Request providers are cached here. */
  requestScope(providers: readonly Provider[] = []) {
    return new Container(providers, this, true);
  }
  resolve<T>(token: InjectionToken<T>): T {
    if (this.disposed) throw new GraphError("container has already been disposed");
    return buildSync(this, token, []);
  }
  /** Validate a dependency graph without constructing classes or running factories. */
  validate<T>(token: InjectionToken<T>) {
    if (this.disposed) throw new GraphError("container has already been disposed");
    validateToken(this, token, [], this.isRequestScope);
    return this;
  }
  async resolveAsync<T>(token: InjectionToken<T>): Promise<T> {
    if (this.disposed) throw new GraphError("container has already been disposed");
    const value = await buildAsync(this, token, []);
    await this.parent?.initialize();
    await this.initialize();
    return value;
  }
  async initialize() {
    if (this.disposed) throw new GraphError("container has already been disposed");
    if (this.initializing) return this.initializing;
    this.initializing = this.initializeInstances();
    try {
      await this.initializing;
    } finally {
      this.initializing = undefined;
    }
  }
  dispose() {
    if (this.disposing) return this.disposing;
    if (this.disposed) return;
    this.disposed = true;
    this.disposing = disposeContainer({
      pending: this.pending,
      initializing: this.initializing,
      instances: this.instances,
      creationOrder: this.creationOrder,
      initializedTokens: this.initializedTokens,
    });
    return this.disposing;
  }
  private async initializeInstances() {
    const failures: unknown[] = [];
    for (const token of this.creationOrder) {
      if (this.initializedTokens.has(token)) continue;
      const instance = this.instances.get(token);
      if (!isInitializable(instance)) {
        this.initializedTokens.add(token);
        continue;
      }
      try {
        await instance.initialize();
        this.initializedTokens.add(token);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "container initialization failed");
  }
}
