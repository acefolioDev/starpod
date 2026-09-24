import type { AnyElysia } from "elysia";
import type { Injectable } from "./di";

export type ControllerInstance = {
  routes(app: AnyElysia): AnyElysia;
};

export type Controller = Injectable<ControllerInstance> & {
  prototype: ControllerInstance;
};

export type Feature = {
  readonly kind: "feature";
  readonly name: string;
  readonly prefix: `/${string}`;
  readonly controller: Controller;
  readonly providers: readonly Injectable[];
  readonly uses: readonly Injectable[];
};

export type Application = {
  readonly kind: "application";
  readonly features: readonly Feature[];
  readonly providers: readonly Injectable[];
};

export type Pod = Feature;

export function pod(input: {
  name: string;
  prefix: `/${string}`;
  controller: Controller;
  providers?: readonly Injectable[];
  uses?: readonly Injectable[];
}): Feature {
  if (!input.name || input.name.includes("/") || input.name.includes(".")) {
    throw new Error(`Feature name must be a simple name (got "${input.name}")`);
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
  providers?: readonly Injectable[];
  /** @deprecated Use providers. Kept for a gentle migration from 0.1.x. */
  infra?: readonly Injectable[];
}): Application {
  return Object.freeze({
    kind: "application",
    features: Object.freeze([...input.features]),
    providers: Object.freeze([...(input.providers ?? input.infra ?? [])]),
  });
}

export function featureNames(app: Application): string[] {
  return app.features.map((feature) => feature.name);
}
