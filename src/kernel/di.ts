export type Constructor<T = unknown> = new (...args: never[]) => T;

export type ProviderLifetime = "singleton" | "request" | "transient";

export type ProviderToken<T = unknown> = symbol & {
  readonly __starpodType?: T;
};

export type InjectionToken<T = unknown> = Constructor<T> | ProviderToken<T>;

export type Injectable<T = unknown> = Constructor<T> & {
  readonly inject?: readonly InjectionToken[];
  readonly lifetime?: ProviderLifetime;
};

export type ValueProvider<T> = {
  readonly token: InjectionToken<T>;
  readonly useValue: T;
};

export type FactoryProvider<T> = {
  readonly token: InjectionToken<T>;
  readonly inject: readonly InjectionToken[];
  readonly useFactory: (...args: never[]) => T;
  readonly lifetime: ProviderLifetime;
};

export type AsyncFactoryProvider<T> = {
  readonly token: InjectionToken<T>;
  readonly inject: readonly InjectionToken[];
  readonly useFactory: (...args: never[]) => Promise<T>;
  readonly lifetime: ProviderLifetime;
  readonly async: true;
};

export type Provider =
  | Injectable
  | ValueProvider<unknown>
  | FactoryProvider<unknown>
  | AsyncFactoryProvider<unknown>;

export type Disposable = {
  dispose(): void | Promise<void>;
};

export type Initializable = {
  initialize(): void | Promise<void>;
};

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphError";
  }
}

export function token<T>(description: string): ProviderToken<T> {
  return Symbol(description) as ProviderToken<T>;
}

export function provideValue<T>(token: InjectionToken<T>, useValue: T): ValueProvider<T> {
  return Object.freeze({ token, useValue });
}

export function provideFactory<
  const TDependencies extends readonly InjectionToken[],
  TValue,
>(
  token: InjectionToken<TValue>,
  inject: TDependencies,
  useFactory: (...args: { [K in keyof TDependencies]: ResolvedToken<TDependencies[K]> }) => TValue,
  options: { readonly lifetime?: ProviderLifetime } = {},
): FactoryProvider<TValue> {
  return Object.freeze({
    token,
    inject: Object.freeze([...inject]),
    useFactory: useFactory as (...args: never[]) => TValue,
    lifetime: options.lifetime ?? "singleton",
  });
}

export function provideAsyncFactory<
  const TDependencies extends readonly InjectionToken[],
  TValue,
>(
  token: InjectionToken<TValue>,
  inject: TDependencies,
  useFactory: (...args: { [K in keyof TDependencies]: ResolvedToken<TDependencies[K]> }) => Promise<TValue>,
  options: { readonly lifetime?: ProviderLifetime } = {},
): AsyncFactoryProvider<TValue> {
  return Object.freeze({
    token,
    inject: Object.freeze([...inject]),
    useFactory: useFactory as (...args: never[]) => Promise<TValue>,
    lifetime: options.lifetime ?? "singleton",
    async: true as const,
  });
}

export type ResolvedToken<TToken extends InjectionToken> = TToken extends Constructor<infer TValue>
  ? TValue
  : TToken extends ProviderToken<infer TValue>
    ? TValue
    : never;

export function providerToken(provider: Provider): InjectionToken {
  return typeof provider === "function" ? provider : provider.token;
}

export function providerLifetime(provider: Provider): ProviderLifetime {
  if (typeof provider === "function") return provider.lifetime ?? "singleton";
  if ("useValue" in provider) return "singleton";
  return provider.lifetime;
}

export class Container {
  private readonly providers = new Map<InjectionToken, Provider>();
  private readonly instances = new Map<InjectionToken, unknown>();
  private readonly pending = new Map<InjectionToken, Promise<unknown>>();
  private readonly creationOrder: InjectionToken[] = [];
  private readonly initializedTokens = new Set<InjectionToken>();
  private disposed = false;
  private initializing: Promise<void> | undefined;

  constructor(
    providers: readonly Provider[] = [],
    private readonly parent?: Container,
    private readonly isRequestScope = false,
  ) {
    for (const provider of providers) this.register(provider);
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

  scope(providers: readonly Provider[] = []) {
    return new Container(providers, this);
  }

  /** Create a per-request child scope. Request providers are cached here. */
  requestScope(providers: readonly Provider[] = []) {
    return new Container(providers, this, true);
  }

  resolve<T>(token: InjectionToken<T>): T {
    if (this.disposed) throw new GraphError("container has already been disposed");
    return this.build(token, []);
  }

  /** Validate a dependency graph without constructing classes or running factories. */
  validate<T>(token: InjectionToken<T>) {
    if (this.disposed) throw new GraphError("container has already been disposed");
    this.validateToken(token, []);
    return this;
  }

  async resolveAsync<T>(token: InjectionToken<T>): Promise<T> {
    if (this.disposed) throw new GraphError("container has already been disposed");
    const value = await this.buildAsync(token, []);
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

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;

    await Promise.allSettled([...this.pending.values()]);

    const failures: unknown[] = [];
    for (const token of [...this.creationOrder].reverse()) {
      const instance = this.instances.get(token);
      if (!isDisposable(instance)) continue;

      try {
        await instance.dispose();
      } catch (error) {
        failures.push(error);
      }
    }

    this.instances.clear();
    this.pending.clear();
    this.creationOrder.length = 0;
    this.initializedTokens.clear();
    if (failures.length > 0) throw new AggregateError(failures, "container disposal failed");
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

  private build<T>(token: InjectionToken<T>, stack: InjectionToken[]): T {
    const owner = this.ownerOf(token);
    if (!owner) {
      throw new GraphError(
        `${tokenName(token)} is not registered. Add it to feature.providers or application.providers.`,
      );
    }

    if (stack.includes(token)) {
      const cycle = [...stack, token].map(tokenName).join(" -> ");
      throw new GraphError(`circular dependency: ${cycle}`);
    }

    const provider = owner.providers.get(token);
    if (!provider) throw new GraphError(`${tokenName(token)} provider disappeared`);
    if (owner.disposed) throw new GraphError(`${tokenName(token)} provider belongs to a disposed container`);

    const lifetime = providerLifetime(provider);
    if (lifetime === "request" && !this.isRequestScope) {
      throw new GraphError(
        `${tokenName(token)} is request-scoped and can only be resolved inside a request scope`,
      );
    }

    const cache = lifetime === "singleton" ? owner : lifetime === "request" ? this : undefined;
    if (cache) {
      const cached = cache.instances.get(token);
      if (cached !== undefined || cache.instances.has(token)) return cached as T;
    }

    if (isAsyncFactory(provider)) {
      throw new GraphError(
        `${tokenName(token)} is asynchronous and must be resolved with resolveAsync()`,
      );
    }

    const dependencies = dependenciesOf(provider);
    assertConstructorArity(provider, token, dependencies);

    const next = [...stack, token];
    const args = dependencies.map((dependency) => this.build(dependency, next));
    const instance = typeof provider === "function"
      ? new (provider as unknown as new (...args: unknown[]) => T)(...args)
      : "useValue" in provider
        ? provider.useValue as T
        : (provider.useFactory as (...args: unknown[]) => T)(...args);

    if (cache) {
      cache.instances.set(token, instance);
      cache.creationOrder.push(token);
    }
    return instance;
  }

  private async buildAsync<T>(token: InjectionToken<T>, stack: InjectionToken[]): Promise<T> {
    const owner = this.ownerOf(token);
    if (!owner) {
      throw new GraphError(
        `${tokenName(token)} is not registered. Add it to feature.providers or application.providers.`,
      );
    }

    if (stack.includes(token)) {
      const cycle = [...stack, token].map(tokenName).join(" -> ");
      throw new GraphError(`circular dependency: ${cycle}`);
    }

    const provider = owner.providers.get(token);
    if (!provider) throw new GraphError(`${tokenName(token)} provider disappeared`);
    if (owner.disposed) throw new GraphError(`${tokenName(token)} provider belongs to a disposed container`);

    const lifetime = providerLifetime(provider);
    if (lifetime === "request" && !this.isRequestScope) {
      throw new GraphError(
        `${tokenName(token)} is request-scoped and can only be resolved inside a request scope`,
      );
    }

    const cache = lifetime === "singleton" ? owner : lifetime === "request" ? this : undefined;
    if (cache) {
      const cached = cache.instances.get(token);
      if (cached !== undefined || cache.instances.has(token)) return cached as T;
      const pending = cache.pending.get(token);
      if (pending) return pending as Promise<T>;
    }

    const work = this.constructAsync(provider, token, stack);
    if (!cache) return work;

    cache.pending.set(token, work);
    try {
      const instance = await work;
      cache.instances.set(token, instance);
      cache.creationOrder.push(token);
      return instance as T;
    } finally {
      cache.pending.delete(token);
    }
  }

  private async constructAsync<T>(
    provider: Provider,
    token: InjectionToken<T>,
    stack: InjectionToken[],
  ): Promise<T> {
    const dependencies = dependenciesOf(provider);
    assertConstructorArity(provider, token, dependencies);
    const next = [...stack, token];
    const args = await Promise.all(dependencies.map((dependency) => this.buildAsync(dependency, next)));

    if (typeof provider === "function") {
      return new (provider as unknown as new (...args: unknown[]) => T)(...args);
    }
    if ("useValue" in provider) return provider.useValue as T;
    if (isAsyncFactory(provider)) {
      return (provider.useFactory as (...args: unknown[]) => Promise<T>)(...args);
    }
    return (provider.useFactory as (...args: unknown[]) => T)(...args);
  }

  private validateToken(token: InjectionToken, stack: InjectionToken[]) {
    const owner = this.ownerOf(token);
    if (!owner) {
      throw new GraphError(
        `${tokenName(token)} is not registered. Add it to feature.providers or application.providers.`,
      );
    }
    if (owner.disposed) throw new GraphError(`${tokenName(token)} provider belongs to a disposed container`);
    if (stack.includes(token)) {
      const cycle = [...stack, token].map(tokenName).join(" -> ");
      throw new GraphError(`circular dependency: ${cycle}`);
    }

    const provider = owner.providers.get(token);
    if (!provider) throw new GraphError(`${tokenName(token)} provider disappeared`);
    const lifetime = providerLifetime(provider);
    if (lifetime === "request" && !this.isRequestScope) {
      throw new GraphError(
        `${tokenName(token)} is request-scoped and can only be resolved inside a request scope`,
      );
    }
    const dependencies = dependenciesOf(provider);
    assertConstructorArity(provider, token, dependencies);

    const next = [...stack, token];
    for (const dependency of dependencies) this.validateToken(dependency, next);
  }

  private ownerOf(token: InjectionToken): Container | undefined {
    if (this.providers.has(token)) return this;
    return this.parent?.ownerOf(token);
  }
}

function tokenName(token: InjectionToken): string {
  return typeof token === "function" ? token.name : token.description ?? "anonymous token";
}

function isDisposable(value: unknown): value is Disposable {
  return typeof value === "object" && value !== null && "dispose" in value && typeof value.dispose === "function";
}

function isInitializable(value: unknown): value is Initializable {
  return typeof value === "object" && value !== null && "initialize" in value && typeof value.initialize === "function";
}

function isAsyncFactory(provider: Provider): provider is AsyncFactoryProvider<unknown> {
  return typeof provider !== "function" && "async" in provider && provider.async === true;
}

function dependenciesOf(provider: Provider): readonly InjectionToken[] {
  return typeof provider === "function"
    ? provider.inject ?? []
    : "useValue" in provider
      ? []
      : provider.inject;
}

function assertConstructorArity(
  provider: Provider,
  token: InjectionToken,
  dependencies: readonly InjectionToken[],
) {
  const parameterCount = typeof provider === "function" ? provider.length : undefined;
  if (parameterCount !== undefined && dependencies.length !== parameterCount) {
    throw new GraphError(
      `${tokenName(token)}: inject.length (${dependencies.length}) must match constructor parameters (${parameterCount})`,
    );
  }
}
