import type { AnyElysia } from "elysia";
import { Container, providerLifetime, providerToken, type Provider } from "../../di/di";
import type { Application } from "../feature";

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
  for (const feature of app.features) {
    const container = compositionRoot.scope([
      ...feature.uses,
      ...feature.providers,
      feature.controller,
    ].filter((provider) => !overrideTokens.has(providerToken(provider))));
    featureScopes.push(container);
    const controller = await container.resolveAsync(feature.controller);
    featureScopesByPrefix.push({ prefix: feature.prefix, container });
    elysia.group(feature.prefix, (group) => {
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
