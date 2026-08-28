import { Elysia } from "elysia";
import { sealArchitecture } from "./architecture";
import { construct, type Constructor } from "./di";
import type { Application } from "./feature";
import { printAtlas, type AtlasPrintRow } from "./print";

type HttpVerb = "get" | "post" | "put" | "patch" | "delete";

export async function bootstrap(app: Application) {
  await sealArchitecture(app);

  const elysia = new Elysia({ name: "atlas" });
  const cache = new Map<Constructor, unknown>();
  const infraSet = new Set<Constructor>(app.infra);
  for (const ctor of app.infra) {
    construct(ctor, cache, infraSet);
  }

  const rows: AtlasPrintRow[] = [];

  for (const feat of app.features) {
    const allowed = new Set<Constructor>([
      feat.controller,
      ...feat.register,
      ...feat.uses,
      ...app.infra,
    ]);
    const instance = construct(feat.controller, cache, allowed) as Record<string, unknown>;

    elysia.group(feat.atlas.prefix, (group) => {
      for (const [key, s] of Object.entries(feat.atlas.stars)) {
        const handler = (instance[key] as Function).bind(instance);
        const verb = s.method as HttpVerb;
        const options = s.body ? { body: s.body } : {};
        (group[verb] as Function)(s.path, handler, options);
      }
      return group;
    });

    rows.push({
      name: feat.atlas.name,
      prefix: feat.atlas.prefix,
      stars: Object.entries(feat.atlas.stars).map(([key, s]) => ({
        key,
        method: s.method,
        path: s.path,
      })),
    });
  }

  printAtlas(rows);
  return elysia;
}
