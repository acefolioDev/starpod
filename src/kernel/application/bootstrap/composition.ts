import type { AnyElysia } from "elysia";
import { Container, GraphError, providerLifetime, providerToken, type Provider } from "../../di/di";
import type { Application, Feature } from "../feature";
import { featureImports, orderFeatureImports } from "../imports";

export async function composeApplication(
  elysia: AnyElysia,
  app: Application,
  applicationRoot: Container,
  compositionRoot: Container,
  featureScopesByPrefix: Array<{ readonly prefix: string; readonly container: Container }>,
  overrides: readonly Provider[],
  featureScopes: Container[],
) {
  const overrideTokens = new Set(overrides.map(providerToken));
  for (const provider of app.providers) {
    if (providerLifetime(provider) === "singleton") {
      await compositionRoot.resolveAsync(providerToken(provider));
    }
  }
  const orderedFeatures = orderFeatureImports(app.features);
  const containers = new Map<Feature, Container>();
  for (const feature of orderedFeatures) {
    const imports = featureImports(feature, containers);
    const container = compositionRoot.scope([
      ...feature.providers,
      feature.controller,
    ].filter((provider) => !overrideTokens.has(providerToken(provider))), imports);
    containers.set(feature, container);
    featureScopes.push(container);
  }
  for (const feature of app.features) {
    const container = containers.get(feature);
    if (!container) throw new GraphError(`${feature.name}: feature container was not created`);
    const controller = await container.resolveAsync(feature.controller);
    featureScopesByPrefix.push({ prefix: feature.prefix, container });
    elysia.group(feature.prefix === "/" ? "" : feature.prefix, (group) => {
      const routes = controller.routes as unknown as (app: AnyElysia) => AnyElysia;
      const registered = routes.call(controller, group);
      if (!registered || typeof registered !== "object") {
        throw new Error(`${feature.name}: controller routes(app) must return the Elysia instance`);
      }
      return registered;
    });
  }
  if (compositionRoot !== applicationRoot) await applicationRoot.initialize();
  await compositionRoot.initialize();
  for (const scope of featureScopes) await scope.initialize();
}
