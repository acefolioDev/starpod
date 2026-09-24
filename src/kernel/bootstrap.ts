import { Elysia } from "elysia";
import { sealArchitecture } from "./architecture";
import { Container } from "./di";
import type { Application } from "./feature";
import { printFeatures } from "./print";

export async function bootstrap(app: Application) {
  await sealArchitecture(app);

  const elysia = new Elysia({ name: "starpod" });
  const root = new Container(app.providers);

  for (const feature of app.features) {
    const container = root.scope([
      ...feature.uses,
      ...feature.providers,
      feature.controller,
    ]);
    const controller = container.resolve(feature.controller);

    elysia.group(feature.prefix, (group) => controller.routes(group));
  }

  printFeatures(app.features);
  return elysia;
}
