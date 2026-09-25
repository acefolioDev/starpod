export type Constructor<T = unknown> = new (...args: never[]) => T;

export type ProviderLifetime = "singleton" | "request" | "transient";

export type ProviderToken<T = unknown> = symbol & {
  readonly __starpodType?: T;
};

export type InjectionToken<T = unknown> = Constructor<T> | ProviderToken<T>;

export type Injectable<T = unknown> = Constructor<T> & {
  readonly inject?: readonly InjectionToken[];
  /** Readable alias for inject. If both are defined, they must match. */
  readonly needs?: readonly InjectionToken[];
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

