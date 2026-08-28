export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export type AtlasStar = {
  readonly method: HttpMethod;
  readonly path: string;
  readonly body?: unknown;
};

export type AtlasDefinition<TStars extends Record<string, AtlasStar>> = {
  readonly prefix: `/${string}`;
  readonly stars: TStars;
};

export type Atlas<TStars extends Record<string, AtlasStar> = Record<string, AtlasStar>> =
  AtlasDefinition<TStars> & {
    readonly kind: "atlas";
    readonly name: string;
  };

export function star(method: HttpMethod, path: string, body?: unknown): AtlasStar {
  if (!path.startsWith("/")) {
    throw new Error(`Atlas star path must start with "/": received "${path}"`);
  }
  return Object.freeze({ method, path, body });
}

star.get = (path: string, body?: unknown) => star("get", path, body);
star.post = (path: string, body?: unknown) => star("post", path, body);
star.put = (path: string, body?: unknown) => star("put", path, body);
star.patch = (path: string, body?: unknown) => star("patch", path, body);
star.delete = (path: string, body?: unknown) => star("delete", path, body);

/** Opt-in conventional REST stars. Not the default vocabulary — spread only when you mean it. */
export function canon(body?: { create?: unknown; update?: unknown }): {
  list: AtlasStar;
  show: AtlasStar;
  create: AtlasStar;
  update: AtlasStar;
  remove: AtlasStar;
} {
  return Object.freeze({
    list: star.get("/"),
    show: star.get("/:id"),
    create: star.post("/", body?.create),
    update: star.put("/:id", body?.update),
    remove: star.delete("/:id"),
  });
}

export function atlas<const TStars extends Record<string, AtlasStar>>(
  name: string,
  definition: AtlasDefinition<TStars>,
): Atlas<TStars> {
  if (!name || name.includes("/") || name.includes(".")) {
    throw new Error(`Atlas name must be a simple feature name (got "${name}")`);
  }
  if (!definition.prefix.startsWith("/")) {
    throw new Error(`Atlas prefix must start with "/"`);
  }

  return Object.freeze({
    kind: "atlas",
    name,
    prefix: definition.prefix,
    stars: Object.freeze({ ...definition.stars }),
  });
}
