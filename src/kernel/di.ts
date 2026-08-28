export type Constructor<T = unknown> = new (...args: never[]) => T;

export type Injectable<T = unknown> = Constructor<T> & {
  readonly needs?: readonly Constructor[];
};

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphError";
  }
}

export function construct(
  ctor: Injectable,
  cache: Map<Constructor, unknown>,
  allowed: Set<Constructor>,
  stack: Constructor[] = [],
): unknown {
  const cached = cache.get(ctor);
  if (cache.has(ctor)) return cached;

  if (stack.includes(ctor)) {
    const cycle = [...stack, ctor].map((c) => c.name).join(" -> ");
    throw new GraphError(`circular needs: ${cycle}`);
  }

  if (!allowed.has(ctor) && !cache.has(ctor)) {
    throw new GraphError(
      `${ctor.name} is not registered. Add it to feature.register, application.infra, or uses.`,
    );
  }

  const needs = ctor.needs ?? [];
  if (needs.length !== ctor.length) {
    throw new GraphError(
      `${ctor.name}: needs.length (${needs.length}) must match constructor parameters (${ctor.length})`,
    );
  }

  const next = [...stack, ctor];
  const deps = needs.map((need) => construct(need, cache, allowed, next));
  const Klass = ctor as unknown as new (...args: unknown[]) => unknown;
  const instance = new Klass(...deps);
  cache.set(ctor, instance);
  return instance;
}
