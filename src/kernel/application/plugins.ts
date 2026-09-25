import type { AnyElysia } from "elysia";
import { providerToken, type Provider } from "../di/di";

export type NativePlugin = (app: AnyElysia) => AnyElysia;

export type StarpodPlugin = {
  readonly kind: "plugin";
  readonly name: string;
  readonly providers: readonly Provider[];
  readonly configure: NativePlugin;
};

/** Define a named extension without hiding the native Elysia application. */
export function plugin(input: {
  readonly name: string;
  readonly providers?: readonly Provider[];
  readonly configure: NativePlugin;
}): StarpodPlugin {
  validatePluginName(input.name);
  const providers = input.providers ?? [];
  const tokens = new Set<ReturnType<typeof providerToken>>();
  for (const provider of providers) {
    const token = providerToken(provider);
    if (tokens.has(token)) throw new Error(`Duplicate plugin provider in ${input.name}`);
    tokens.add(token);
  }

  return Object.freeze({
    kind: "plugin" as const,
    name: input.name,
    providers: Object.freeze([...providers]),
    configure: input.configure,
  });
}

/** Apply named native plugins in declaration order. */
export function applyPlugins(app: AnyElysia, plugins: readonly StarpodPlugin[]): AnyElysia {
  return plugins.reduce((current, extension) => {
    const configured = extension.configure(current);
    if (!configured || typeof configured !== "object") {
      throw new Error(`Plugin "${extension.name}" must return the Elysia instance`);
    }
    return configured;
  }, app);
}

function validatePluginName(name: string) {
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(name)) {
    throw new Error(`Plugin name must start with a lowercase letter: ${name}`);
  }
}
