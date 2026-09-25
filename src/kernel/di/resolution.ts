import {
  GraphError,
  providerLifetime,
  providerToken,
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

export type ResolverContainer = {
  readonly providers: Map<InjectionToken, Provider>;
  readonly instances: Map<InjectionToken, unknown>;
  readonly pending: Map<InjectionToken, Promise<unknown>>;
  readonly creationOrder: InjectionToken[];
  readonly parent?: ResolverContainer;
  readonly isRequestScope: boolean;
  readonly imports: readonly ContainerImport[];
  readonly disposed: boolean;
};

export function buildSync<T>(container: ResolverContainer, token: InjectionToken<T>, stack: InjectionToken[], transientScope = container): T {
  const owner = ownerOf(container, token);
  if (!owner) {
    const imported = importedOwnerOf(container, token);
    if (imported) return buildSync(imported, token, stack, transientScope);
    throw missing(token);
  }
  const provider = requireProvider(owner, token, stack);
  const lifetime = providerLifetime(provider);
  assertRequestScope(lifetime, transientScope.isRequestScope, token);
  const cache = cacheFor(lifetime, owner, transientScope);
  const cached = readCache(cache, token);
  if (cached.found) return cached.value as T;
  if (isAsyncFactory(provider)) throw new GraphError(`${tokenName(token)} is asynchronous and must be resolved with resolveAsync()`);
  const dependencies = dependenciesOf(provider);
  assertDependencies(container, token, lifetime, dependencies);
  assertConstructorArity(provider, token, dependencies);
  const next = [...stack, token];
  const dependencyScope = lifetime === "singleton" ? owner : transientScope;
  const args = dependencies.map((dependency) => buildSync(container, dependency, next, dependencyScope));
  const instance = constructSync(provider, args) as T;
  if (cache) {
    cache.instances.set(token, instance);
    cache.creationOrder.push(token);
  } else rememberTransient(transientScope.instances, transientScope.creationOrder, instance);
  return instance;
}

export async function buildAsync<T>(container: ResolverContainer, token: InjectionToken<T>, stack: InjectionToken[], transientScope = container): Promise<T> {
  const owner = ownerOf(container, token);
  if (!owner) {
    const imported = importedOwnerOf(container, token);
    if (imported) return buildAsync(imported, token, stack, transientScope);
    throw missing(token);
  }
  const provider = requireProvider(owner, token, stack);
  const lifetime = providerLifetime(provider);
  assertRequestScope(lifetime, transientScope.isRequestScope, token);
  const cache = cacheFor(lifetime, owner, transientScope);
  const cached = readCache(cache, token);
  if (cached.found) return cached.value as T;
  const pending = cache?.pending.get(token);
  if (pending) return pending as Promise<T>;
  const dependencies = dependenciesOf(provider);
  assertDependencies(container, token, lifetime, dependencies);
  const dependencyScope = lifetime === "singleton" ? owner : transientScope;
  const work = constructAsync(container, provider, token, stack, dependencyScope);
  if (!cache) {
    const instance = await work;
    rememberTransient(transientScope.instances, transientScope.creationOrder, instance);
    return instance as T;
  }
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

export function validateToken(container: ResolverContainer, token: InjectionToken, stack: InjectionToken[], requestScope: boolean) {
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
  assertDependencies(container, token, lifetime, dependencies);
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

async function constructAsync<T>(container: ResolverContainer, provider: Provider, token: InjectionToken, stack: InjectionToken[], transientScope: ResolverContainer): Promise<T> {
  assertConstructorArity(provider, token, dependenciesOf(provider));
  const next = [...stack, token];
  const args = await Promise.all(dependenciesOf(provider).map((dependency) => buildAsync(container, dependency, next, transientScope)));
  if (typeof provider === "function") return new (provider as unknown as new (...args: unknown[]) => T)(...args);
  if ("useValue" in provider) return provider.useValue as T;
  return (provider.useFactory as (...args: unknown[]) => Promise<T>)(...args);
}

function requireProvider(owner: ResolverContainer, token: InjectionToken, stack: InjectionToken[]) {
  if (owner.disposed) throw new GraphError(`${tokenName(token)} provider belongs to a disposed container`);
  if (stack.includes(token)) throw new GraphError(`circular dependency: ${[...stack, token].map(tokenName).join(" -> ")}`);
  const provider = owner.providers.get(token);
  if (!provider) throw new GraphError(`${tokenName(token)} provider disappeared`);
  return provider;
}

function assertDependencies(container: ResolverContainer, token: InjectionToken, lifetime: ReturnType<typeof providerLifetime>, dependencies: readonly InjectionToken[]) {
  assertNoRequestDependency(token, lifetime, dependencies, (dependency) => providerOf(container, dependency));
}

function assertRequestScope(lifetime: ReturnType<typeof providerLifetime>, requestScope: boolean, token: InjectionToken) {
  if (lifetime === "request" && !requestScope) throw new GraphError(`${tokenName(token)} is request-scoped and can only be resolved inside a request scope`);
}

function cacheFor(lifetime: ReturnType<typeof providerLifetime>, owner: ResolverContainer, scope: ResolverContainer) {
  return lifetime === "singleton" ? owner : lifetime === "request" ? scope : undefined;
}

function readCache(cache: ResolverContainer | undefined, token: InjectionToken) {
  if (!cache) return { found: false } as const;
  const value = cache.instances.get(token);
  return value !== undefined || cache.instances.has(token)
    ? { found: true, value } as const
    : { found: false } as const;
}

function ownerOf(container: ResolverContainer, token: InjectionToken): ResolverContainer | undefined {
  if (container.providers.has(token)) return container;
  return container.parent ? ownerOf(container.parent, token) : undefined;
}

function providerOf(container: ResolverContainer, token: InjectionToken) {
  const owner = ownerOf(container, token) ?? importedOwnerOf(container, token);
  return owner?.providers.get(token);
}

function importedOwnerOf(container: ResolverContainer, token: InjectionToken): ResolverContainer | undefined {
  for (const scope of scopeChain(container)) {
    const link = scope.imports.find((candidate) => candidate.tokens.has(token));
    if (link) return link.container as unknown as ResolverContainer;
  }
  return undefined;
}

function* scopeChain(container: ResolverContainer): Iterable<ResolverContainer> {
  for (let scope: ResolverContainer | undefined = container; scope; scope = scope.parent) yield scope;
}

function missing(token: InjectionToken) {
  return new GraphError(`${tokenName(token)} is not registered. Add it to feature.providers or application.providers.`);
}
