export type ConfigSource = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(["Invalid application configuration:", ...issues.map((issue) => `- ${issue}`)].join("\n"));
    this.name = "ConfigError";
    this.issues = Object.freeze([...issues]);
  }
}

export type ConfigValue<T> = {
  readonly name?: string;
  readonly secret?: boolean;
  readonly read: (source: ConfigSource) => T;
};

type DefaultOption<T> = {
  readonly default?: T;
  readonly required?: boolean;
  readonly secret?: boolean;
};

function value<T>(
  name: string,
  options: DefaultOption<T>,
  parse: (raw: string) => T,
  validateDefault: (value: T) => T = (value) => value,
): ConfigValue<T> {
  return {
    name,
    secret: options.secret ?? false,
    read(source) {
      const raw = source[name];
      if (raw === undefined || raw.trim() === "") {
        if (options.default !== undefined) return validateDefault(options.default);
        if (options.required) throw new Error(`${name} is required`);
        throw new Error(`${name} is not set and has no default`);
      }

      return parse(raw);
    },
  };
}

export const env = {
  string(name: string, options: DefaultOption<string> = {}): ConfigValue<string> {
    return value(name, options, (raw) => raw);
  },

  url(name: string, options: DefaultOption<string> = {}): ConfigValue<string> {
    const parse = (raw: string) => {
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        throw new Error(`${name} must be an absolute URL`);
      }
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error(`${name} must be an HTTP(S) URL without credentials`);
      }
      return parsed.toString();
    };
    return value(name, options, parse, parse);
  },

  duration(name: string, options: DefaultOption<number> = {}): ConfigValue<number> {
    return value(name, options, (raw) => parseDuration(name, raw), (defaultValue) => {
      if (!Number.isFinite(defaultValue) || defaultValue < 0) {
        throw new Error(`${name} duration default must be a finite non-negative number`);
      }
      return defaultValue;
    });
  },

  secret(name: string, options: Omit<DefaultOption<string>, "secret"> = {}): ConfigValue<string> {
    return value(name, { ...options, secret: true }, (raw) => raw);
  },

  number(
    name: string,
    options: DefaultOption<number> & { readonly min?: number; readonly max?: number } = {},
  ): ConfigValue<number> {
    const parse = (raw: string) => parseNumber(name, raw, options);
    return value(name, options, parse, (defaultValue) => parse(String(defaultValue)));
  },

  boolean(name: string, options: DefaultOption<boolean> = {}): ConfigValue<boolean> {
    const parse = (raw: string) => {
      if (raw === "true" || raw === "1") return true;
      if (raw === "false" || raw === "0") return false;
      throw new Error(`${name} must be true, false, 1, or 0`);
    };
    return value(name, options, parse, (defaultValue) => parse(String(defaultValue)));
  },

  enum<const TValues extends readonly string[]>(
    name: string,
    values: TValues,
    options: DefaultOption<TValues[number]> = {},
  ): ConfigValue<TValues[number]> {
    const parse = (raw: string) => {
      if ((values as readonly string[]).includes(raw)) return raw as TValues[number];
      throw new Error(`${name} must be one of: ${values.join(", ")}`);
    };
    return value(name, options, parse, (defaultValue) => parse(String(defaultValue)));
  },
};

export type ConfigDefinition = Record<string, ConfigValue<unknown>>;

export type ResolvedConfig<TDefinition extends ConfigDefinition> = {
  readonly [TKey in keyof TDefinition]: TDefinition[TKey] extends ConfigValue<infer TValue>
    ? TValue
    : never;
};

export function defineConfig<const TDefinition extends ConfigDefinition>(
  definition: TDefinition,
  source: ConfigSource = process.env,
): ResolvedConfig<TDefinition> {
  const resolved: Record<string, unknown> = {};
  const issues: string[] = [];

  for (const [key, configValue] of Object.entries(definition)) {
    try {
      resolved[key] = configValue.read(source);
    } catch (error) {
      issues.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (issues.length > 0) throw new ConfigError(issues);
  return Object.freeze(resolved) as ResolvedConfig<TDefinition>;
}

export function inspectConfig<const TDefinition extends ConfigDefinition>(
  definition: TDefinition,
  source: ConfigSource = process.env,
): Readonly<Record<string, unknown>> {
  const resolved = defineConfig(definition, source) as Record<string, unknown>;
  const inspected: Record<string, unknown> = {};

  for (const [key, configValue] of Object.entries(definition)) {
    inspected[key] = configValue.secret ? "[REDACTED]" : resolved[key];
  }

  return Object.freeze(inspected);
}

function parseDuration(name: string, raw: string) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(raw.trim());
  if (!match) throw new Error(`${name} must use a duration such as 250ms, 5s, or 2m`);
  const amount = Number(match[1]);
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2] as "ms" | "s" | "m" | "h" | "d"
  ];
  const milliseconds = amount * multiplier;
  if (!Number.isFinite(milliseconds)) throw new Error(`${name} duration is too large`);
  return milliseconds;
}

function parseNumber(
  name: string,
  raw: string,
  options: { readonly min?: number; readonly max?: number },
) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`);
  if (options.min !== undefined && parsed < options.min) throw new Error(`${name} must be at least ${options.min}`);
  if (options.max !== undefined && parsed > options.max) throw new Error(`${name} must be at most ${options.max}`);
  return parsed;
}
