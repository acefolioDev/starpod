export type Constructor<T = unknown> = new (...args: never[]) => T;

/**
 * A class that can be created by the container.
 *
 * TypeScript does not emit constructor parameter types at runtime. Keeping the
 * dependency list beside the class is therefore the honest, decorator-free
 * way to describe constructor injection.
 */
export type Injectable<T = unknown> = Constructor<T> & {
  readonly inject?: readonly Constructor[];
};

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphError";
  }
}

export class Container {
  private readonly providers = new Set<Constructor>();
  private readonly instances = new Map<Constructor, unknown>();

  constructor(
    providers: readonly Injectable[] = [],
    private readonly parent?: Container,
  ) {
    for (const provider of providers) this.register(provider);
  }

  register(...providers: readonly Injectable[]) {
    for (const provider of providers) this.providers.add(provider);
    return this;
  }

  scope(providers: readonly Injectable[] = []) {
    return new Container(providers, this);
  }

  resolve<T>(ctor: Injectable<T>): T {
    return this.build(ctor, []);
  }

  private build<T>(ctor: Injectable<T>, stack: Constructor[]): T {
    const owner = this.ownerOf(ctor);
    if (!owner) {
      throw new GraphError(
        `${ctor.name} is not registered. Add it to feature.providers or application.providers.`,
      );
    }

    const cached = owner.instances.get(ctor);
    if (cached !== undefined || owner.instances.has(ctor)) return cached as T;

    if (stack.includes(ctor)) {
      const cycle = [...stack, ctor].map((item) => item.name).join(" -> ");
      throw new GraphError(`circular dependency: ${cycle}`);
    }

    const dependencies = ctor.inject ?? [];
    if (dependencies.length !== ctor.length) {
      throw new GraphError(
        `${ctor.name}: inject.length (${dependencies.length}) must match constructor parameters (${ctor.length})`,
      );
    }

    const next = [...stack, ctor];
    const args = dependencies.map((dependency) => this.build(dependency, next));
    const instance = new (ctor as unknown as new (...args: unknown[]) => T)(...args);
    owner.instances.set(ctor, instance);
    return instance;
  }

  private ownerOf(ctor: Constructor): Container | undefined {
    if (this.providers.has(ctor)) return this;
    return this.parent?.ownerOf(ctor);
  }
}
