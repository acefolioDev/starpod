import type { Atlas } from "./atlas";
import type { Injectable } from "./di";

export type Feature = {
  readonly kind: "feature";
  readonly atlas: Atlas;
  readonly controller: Injectable;
  readonly register: readonly Injectable[];
  readonly uses: readonly Injectable[];
};

export type Application = {
  readonly kind: "application";
  readonly features: readonly Feature[];
  readonly infra: readonly Injectable[];
};

export type Pod = Feature;

export function pod(input: {
  atlas: Atlas;
  controller: Injectable;
  register?: readonly Injectable[];
  uses?: readonly Injectable[];
}): Feature {
  return Object.freeze({
    kind: "feature",
    atlas: input.atlas,
    controller: input.controller,
    register: Object.freeze([...(input.register ?? [])]),
    uses: Object.freeze([...(input.uses ?? [])]),
  });
}

export function application(input: {
  features: readonly Feature[];
  infra?: readonly Injectable[];
}): Application {
  return Object.freeze({
    kind: "application",
    features: Object.freeze([...input.features]),
    infra: Object.freeze([...(input.infra ?? [])]),
  });
}

export function featureNames(app: Application): string[] {
  return app.features.map((f) => f.atlas.name);
}
