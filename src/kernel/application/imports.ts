import { GraphError, type Container, type ContainerImport } from "../di/di";
import type { Feature } from "./feature";

/** Return features in dependency order while preserving a stable input order. */
export function orderFeatureImports(features: readonly Feature[]) {
  const known = new Set(features);
  const visiting = new Set<Feature>();
  const visited = new Set<Feature>();
  const ordered: Feature[] = [];

  const visit = (feature: Feature) => {
    if (visited.has(feature)) return;
    if (visiting.has(feature)) throw new GraphError(`feature import cycle includes ${feature.name}`);
    visiting.add(feature);
    for (const imported of feature.imports) {
      if (!known.has(imported)) {
        throw new GraphError(`${feature.name}: imported feature ${imported.name} is not in application.features`);
      }
      visit(imported);
    }
    visiting.delete(feature);
    visited.add(feature);
    ordered.push(feature);
  };

  for (const feature of features) visit(feature);
  return ordered;
}

export function featureImports(
  feature: Feature,
  containers: ReadonlyMap<Feature, Container>,
): readonly ContainerImport[] {
  return feature.imports.map((imported) => {
    const container = containers.get(imported);
    if (!container) throw new GraphError(`${feature.name}: imported feature ${imported.name} is not available`);
    return { container, tokens: new Set(imported.exports) };
  });
}
