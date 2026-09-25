import {
  GraphError,
  type AsyncFactoryProvider,
  type InjectionToken,
  type Initializable,
  type Disposable,
  type Provider,
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
  return typeof provider === "function"
    ? provider.inject ?? []
    : "useValue" in provider
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
      `${tokenName(token)}: inject.length (${dependencies.length}) must match constructor parameters (${parameterCount})`,
    );
  }
}
