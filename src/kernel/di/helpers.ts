import {
  GraphError,
  type AsyncFactoryProvider,
  type InjectionToken,
  type Initializable,
  type Disposable,
  type ProviderLifetime,
  type Provider,
  providerLifetime,
} from "./providers";

export function tokenName(token: InjectionToken): string {
  return typeof token === "function" ? token.name : token.description ?? "anonymous token";
}

export function isDisposable(value: unknown): value is Disposable {
  return typeof value === "object" && value !== null && "dispose" in value && typeof value.dispose === "function";
}

export function isInitializable(value: unknown): value is Initializable {
  return typeof value === "object" && value !== null && "initialize" in value && typeof value.initialize === "function";
}

export function isAsyncFactory(provider: Provider): provider is AsyncFactoryProvider<unknown> {
  return typeof provider !== "function" && "async" in provider && provider.async === true;
}

export function dependenciesOf(provider: Provider): readonly InjectionToken[] {
  if (typeof provider === "function") {
    const inject = provider.inject;
    const needs = provider.needs;
    if (inject !== undefined && needs !== undefined) {
      if (inject.length !== needs.length || inject.some((token, index) => token !== needs[index])) {
        throw new GraphError(`${tokenName(provider)}: inject and needs dependency tuples must match`);
      }
      return inject;
    }
    return inject ?? needs ?? [];
  }

  return "useValue" in provider
    ? []
    : provider.inject;
}

export function assertConstructorArity(
  provider: Provider,
  token: InjectionToken,
  dependencies: readonly InjectionToken[],
) {
  const parameterCount = typeof provider === "function" ? provider.length : undefined;
  if (parameterCount !== undefined && dependencies.length !== parameterCount) {
    throw new GraphError(
      `${tokenName(token)}: dependency tuple length (${dependencies.length}) must match constructor parameters (${parameterCount})`,
    );
  }
}

export function assertNoRequestDependency(
  token: InjectionToken,
  lifetime: ProviderLifetime,
  dependencies: readonly InjectionToken[],
  providerFor: (dependency: InjectionToken) => Provider | undefined,
) {
  if (lifetime !== "singleton") return;
  for (const dependency of dependencies) {
    const provider = providerFor(dependency);
    if (provider && providerLifetime(provider) === "request") {
      throw new GraphError(`${tokenName(token)} singleton cannot depend on request-scoped ${tokenName(dependency)}`);
    }
  }
}

export function rememberTransient(
  instances: Map<InjectionToken, unknown>,
  creationOrder: InjectionToken[],
  instance: unknown,
) {
  if (!isDisposable(instance) && !isInitializable(instance)) return;
  const token = Symbol("transient");
  instances.set(token, instance);
  creationOrder.push(token);
}
