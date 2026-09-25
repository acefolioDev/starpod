import type { Context, MaybePromise, RouteSchema } from "elysia";
import type { InjectionToken, ResolvedToken } from "../di/di";
import { resolveRequestDependencies } from "./request-dependencies";
import type { StarpodSingleton } from "./http";

/** Elysia's native route context without the framework's internal resolver. */
export type StarpodRouteContext<Route extends RouteSchema = {}> = Omit<
  Context<Route, StarpodSingleton>,
  "resolve" | "resolveAsync"
>;

type InjectedDependencies<Tokens extends readonly InjectionToken[]> = {
  [K in keyof Tokens]: ResolvedToken<Tokens[K]>;
};

export type InjectedRouteHandler<
  Tokens extends readonly InjectionToken[],
  Result,
  Route extends RouteSchema = {},
> = (
  context: StarpodRouteContext<Route>,
  ...dependencies: InjectedDependencies<Tokens>
) => MaybePromise<Result>;

/** Resolve request-scoped dependencies, then invoke a normal native Elysia handler. */
export function injectHandler<
  const Tokens extends readonly InjectionToken[],
  Result,
  Route extends RouteSchema = {},
>(
  tokens: Tokens,
  handler: InjectedRouteHandler<Tokens, Result, Route>,
): (context: StarpodRouteContext<Route>) => Promise<Result> {
  return async (context) => {
    const dependencies = await resolveRequestDependencies(context.request, tokens);
    return handler(context, ...dependencies);
  };
}
