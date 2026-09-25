import {
  GraphError,
  providerLifetime,
  type InjectionToken,
  type Provider,
} from "./providers";
import {
  assertConstructorArity,
  assertNoRequestDependency,
  dependenciesOf,
  isAsyncFactory,
  rememberTransient,
  tokenName,
} from "./helpers";
import type { ContainerImport } from "./container";

type ResolverContainer = {
  readonly providers: Map<InjectionToken, Provider>;
  readonly instances: Map<InjectionToken, unknown>;
  readonly pending: Map<InjectionToken, Promise<unknown>>;
  readonly creationOrder: InjectionToken[];
  readonly parent?: object;
  readonly isRequestScope: boolean;
  readonly imports: readonly ContainerImport[];
  readonly isDisposed: () => boolean;
  readonly initialize: () => Promise<void>;
};

const states = new WeakMap<object, ResolverContainer>();

export function registerContainer(owner: object, state: ResolverContainer) {
  states.set(owner, state);
}

export function buildSync<T>(container: object, token: InjectionToken<T>, stack: InjectionToken[], transientScope = container): T {
  const owner = ownerOf(container, token);
  if (!owner) {
    const imported = importedOwnerOf(container, token);
    if (imported) return buildSync(imported, token, stack, transientScope);
    throw missing(token);
  }
  const provider = requireProvider(owner, token, stack);
  const lifetime = providerLifetime(provider);
  assertRequestScope(lifetime, stateOf(transientScope).isRequestScope, token);
  const cache = cacheFor(lifetime, owner, transientScope);
  const cached = readCache(cache, token);
  if (cached.found) return cached.value as T;
  if (isAsyncFactory(provider)) throw new GraphError(`${tokenName(token)} is asynchronous and must be resolved with resolveAsync()`);
  const dependencies = dependenciesOf(provider);
  assertDependencies(owner, transientScope, token, lifetime, dependencies);
  assertConstructorArity(provider, token, dependencies);
  const next = [...stack, token];
  const dependencyScope = lifetime === "singleton" ? owner : transientScope;
  const args = dependencies.map((dependency) => buildSync(
    dependencyContainer(owner, dependencyScope, dependency),
    dependency,
    next,
    dependencyScope,
  ));
  const instance = constructSync(provider, args) as T;
  if (cache) {
    const state = stateOf(cache);
    state.instances.set(token, instance);
    state.creationOrder.push(token);
  } else {
    const state = stateOf(transientScope);
    rememberTransient(state.instances, state.creationOrder, instance);
  }
  return instance;
}

export async function buildAsync<T>(container: object, token: InjectionToken<T>, stack: InjectionToken[], transientScope = container): Promise<T> {
  const owner = ownerOf(container, token);
  if (!owner) {
    const imported = importedOwnerOf(container, token);
    if (imported) {
      const value = await buildAsync(imported, token, stack, transientScope);
      await stateOf(imported).initialize();
      return value;
    }
    throw missing(token);
  }
  const provider = requireProvider(owner, token, stack);
  const lifetime = providerLifetime(provider);
  assertRequestScope(lifetime, stateOf(transientScope).isRequestScope, token);
  const cache = cacheFor(lifetime, owner, transientScope);
  const cached = readCache(cache, token);
  if (cached.found) return cached.value as T;
  const pending = cache ? stateOf(cache).pending.get(token) : undefined;
  if (pending) return pending as Promise<T>;
  const dependencies = dependenciesOf(provider);
  assertDependencies(owner, transientScope, token, lifetime, dependencies);
  const dependencyScope = lifetime === "singleton" ? owner : transientScope;
  const work = constructAsync(owner, provider, token, stack, dependencyScope);
  if (!cache) {
    const instance = await work;
    const state = stateOf(transientScope);
    rememberTransient(state.instances, state.creationOrder, instance);
    return instance as T;
  }
  const state = stateOf(cache);
  state.pending.set(token, work);
  try {
    const instance = await work;
    state.instances.set(token, instance);
    state.creationOrder.push(token);
    return instance as T;
  } finally {
    state.pending.delete(token);
  }
}

export function validateToken(container: object, token: InjectionToken, stack: InjectionToken[], requestScope: boolean) {
  const owner = ownerOf(container, token);
  if (!owner) {
    const imported = importedOwnerOf(container, token);
    if (imported) return validateToken(imported, token, stack, requestScope);
    throw missing(token);
  }
  const provider = requireProvider(owner, token, stack);
  const lifetime = providerLifetime(provider);
  assertRequestScope(lifetime, requestScope, token);
  const dependencies = dependenciesOf(provider);
  assertDependencies(owner, owner, token, lifetime, dependencies);
  assertConstructorArity(provider, token, dependencies);
  const next = [...stack, token];
  for (const dependency of dependencies) validateToken(container, dependency, next, requestScope);
}

function constructSync<T>(provider: Provider, args: unknown[]) {
  return typeof provider === "function"
    ? new (provider as unknown as new (...args: unknown[]) => T)(...args)
    : "useValue" in provider
      ? provider.useValue as T
      : (provider.useFactory as (...args: unknown[]) => T)(...args);
}

async function constructAsync<T>(container: object, provider: Provider, token: InjectionToken, stack: InjectionToken[], transientScope: object): Promise<T> {
  const dependencies = dependenciesOf(provider);
  assertConstructorArity(provider, token, dependencies);
  const next = [...stack, token];
  const args = await Promise.all(dependencies.map((dependency) => buildAsync(
    dependencyContainer(container, transientScope, dependency),
    dependency,
    next,
    transientScope,
  )));
  if (typeof provider === "function") return new (provider as unknown as new (...args: unknown[]) => T)(...args);
  if ("useValue" in provider) return provider.useValue as T;
  return (provider.useFactory as (...args: unknown[]) => Promise<T>)(...args);
}

function requireProvider(owner: object, token: InjectionToken, stack: InjectionToken[]) {
  const state = stateOf(owner);
  if (state.isDisposed()) throw new GraphError(`${tokenName(token)} provider belongs to a disposed container`);
  if (stack.includes(token)) throw new GraphError(`circular dependency: ${[...stack, token].map(tokenName).join(" -> ")}`);
  const provider = state.providers.get(token);
  if (!provider) throw new GraphError(`${tokenName(token)} provider disappeared`);
  return provider;
}

function assertDependencies(
  owner: object,
  transientScope: object,
  token: InjectionToken,
  lifetime: ReturnType<typeof providerLifetime>,
  dependencies: readonly InjectionToken[],
) {
  assertNoRequestDependency(token, lifetime, dependencies, (dependency) => providerOf(owner, transientScope, dependency));
}

function assertRequestScope(lifetime: ReturnType<typeof providerLifetime>, requestScope: boolean, token: InjectionToken) {
  if (lifetime === "request" && !requestScope) throw new GraphError(`${tokenName(token)} is request-scoped and can only be resolved inside a request scope`);
}

function cacheFor(lifetime: ReturnType<typeof providerLifetime>, owner: object, scope: object) {
  return lifetime === "singleton" ? owner : lifetime === "request" ? scope : undefined;
}

function readCache(cache: object | undefined, token: InjectionToken) {
  if (!cache) return { found: false } as const;
  const state = stateOf(cache);
  const value = state.instances.get(token);
  return value !== undefined || state.instances.has(token)
    ? { found: true, value } as const
    : { found: false } as const;
}

function ownerOf(container: object, token: InjectionToken): object | undefined {
  const state = stateOf(container);
  if (state.providers.has(token)) return container;
  return state.parent ? ownerOf(state.parent, token) : undefined;
}

function providerOf(owner: object, transientScope: object, token: InjectionToken) {
  const local = stateOf(transientScope).providers.get(token);
  if (local) return local;
  const resolvedOwner = ownerOf(owner, token) ?? importedOwnerOf(owner, token);
  return resolvedOwner ? stateOf(resolvedOwner).providers.get(token) : undefined;
}

function dependencyContainer(owner: object, transientScope: object, token: InjectionToken) {
  if (stateOf(transientScope).providers.has(token)) return transientScope;
  return owner;
}

function importedOwnerOf(container: object, token: InjectionToken): object | undefined {
  for (const scope of scopeChain(container)) {
    const link = stateOf(scope).imports.find((candidate) => candidate.tokens.has(token));
    if (link) return link.container;
  }
  return undefined;
}

function* scopeChain(container: object): Iterable<object> {
  for (let scope: object | undefined = container; scope;) {
    yield scope;
    scope = stateOf(scope).parent;
  }
}

function stateOf(container: object) {
  const state = states.get(container);
  if (!state) throw new GraphError("container is not registered");
  return state;
}

function missing(token: InjectionToken) {
  return new GraphError(`${tokenName(token)} is not registered. Add it to feature.providers or application.providers.`);
}
