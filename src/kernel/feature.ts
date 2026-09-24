import { providerToken, type Injectable, type Provider } from "./di";

/**
 * A route registrar keeps its concrete Elysia type in the controller source.
 * The framework only invokes it with the native grouped Elysia instance.
 */
export type NativeRouteRegistrar = (...args: never[]) => unknown;

export type ControllerInstance = {
  routes: NativeRouteRegistrar;
};

export type Controller = Injectable<ControllerInstance> & {
  prototype: ControllerInstance;
};

export type Feature = {
  readonly kind: "feature";
  readonly name: string;
  readonly prefix: `/${string}`;
  readonly controller: Controller;
  readonly providers: readonly Provider[];
  readonly uses: readonly Provider[];
};

export type Application = {
  readonly kind: "application";
  readonly features: readonly Feature[];
  readonly providers: readonly Provider[];
};

export type Pod = Feature;

export function pod(input: {
  name: string;
  prefix: `/${string}`;
  controller: Controller;
  providers?: readonly Provider[];
  uses?: readonly Provider[];
}): Feature {
  if (!/^[a-z][a-z0-9]*$/.test(input.name)) {
    throw new Error(`Feature name must be a single lowercase word (got "${input.name}")`);
  }
  if (!input.prefix.startsWith("/")) {
    throw new Error(`Feature prefix must start with "/"`);
  }

  return Object.freeze({
    kind: "feature",
    name: input.name,
    prefix: input.prefix,
    controller: input.controller,
    providers: Object.freeze([...(input.providers ?? [])]),
    uses: Object.freeze([...(input.uses ?? [])]),
  });
}

export function application(input: {
  features: readonly Feature[];
  providers?: readonly Provider[];
  /** @deprecated Use providers. Kept for a gentle migration from 0.1.x. */
  infra?: readonly Injectable[];
}): Application {
  if (input.features.length === 0) {
    throw new Error("Application requires at least one feature");
  }

  assertUnique(input.features.map((feature) => feature.name), "feature name");
  assertUnique(input.features.map((feature) => feature.prefix), "feature prefix");
  assertUnique(input.providers ?? input.infra ?? [], "application provider");

  return Object.freeze({
    kind: "application",
    features: Object.freeze([...input.features]),
    providers: Object.freeze([...(input.providers ?? input.infra ?? [])]),
  });
}

export function featureNames(app: Application): string[] {
  return app.features.map((feature) => feature.name);
}

function assertUnique(values: readonly (string | Provider)[], label: string) {
  const seen = new Set<string | ReturnType<typeof providerToken>>();
  for (const value of values) {
    const key = typeof value === "string" ? value : providerToken(value);
    if (seen.has(key)) {
      const display = typeof value === "string" ? value : providerName(value);
      throw new Error(`Duplicate ${label}: ${display}`);
    }
    seen.add(key);
  }
}

function providerName(provider: Provider) {
  const token = providerToken(provider);
  return typeof token === "function" ? token.name : token.description ?? "anonymous token";
}
