import type { InjectionToken, ResolvedToken } from "../di/di";

type RequestResolver = <T>(token: InjectionToken<T>) => Promise<T>;

const resolvers = new WeakMap<Request, RequestResolver>();

export function registerRequestResolver(request: Request, resolver: RequestResolver) {
  resolvers.set(request, resolver);
}

export async function resolveRequestDependencies<const Tokens extends readonly InjectionToken[]>(
  request: Request,
  tokens: Tokens,
): Promise<{ [K in keyof Tokens]: ResolvedToken<Tokens[K]> }> {
  const resolver = resolvers.get(request);
  if (!resolver) {
    throw new Error("injectHandler requires a request handled by a bootstrapped Starpod application");
  }
  return Promise.all(tokens.map((token) => resolver(token))) as Promise<{
    [K in keyof Tokens]: ResolvedToken<Tokens[K]>;
  }>;
}
