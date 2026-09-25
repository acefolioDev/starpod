import { describe, expect, test } from "bun:test";
import { ConfigError, defineConfig, env, inspectConfig } from "../src/kernel/config/config";

describe("configuration", () => {
  test("loads typed values from an explicit source", () => {
    const config = defineConfig(
      {
        port: env.number("PORT", { min: 1, max: 65535 }),
        debug: env.boolean("DEBUG", { default: false }),
        environment: env.enum("NODE_ENV", ["development", "test", "production"] as const, {
          default: "development",
        }),
      },
      { PORT: "4000", NODE_ENV: "test" },
    );

    expect(config).toEqual({ port: 4000, debug: false, environment: "test" });
  });

  test("parses safe HTTP URLs and explicit duration units", () => {
    const config = defineConfig({
      serviceUrl: env.url("SERVICE_URL", { required: true }),
      timeoutMs: env.duration("TIMEOUT", { required: true }),
    }, { SERVICE_URL: "https://api.example.test/v1", TIMEOUT: "1.5s" });

    expect(config).toEqual({ serviceUrl: "https://api.example.test/v1", timeoutMs: 1_500 });
    expect(() => defineConfig({ url: env.url("URL") }, { URL: "postgres://db" }))
      .toThrow("HTTP(S) URL");
    expect(() => defineConfig({ timeout: env.duration("TIMEOUT") }, { TIMEOUT: "5" }))
      .toThrow("duration such as");
  });

  test("validates typed defaults with the same parser rules", () => {
    expect(() => defineConfig({ port: env.number("PORT", { default: 0, min: 1 }) }))
      .toThrow("at least 1");
    expect(() => defineConfig({ url: env.url("URL", { default: "postgres://db" }) }))
      .toThrow("HTTP(S) URL");
    expect(() => defineConfig({ mode: env.enum("MODE", ["safe"] as const, { default: "fast" as "safe" }) }))
      .toThrow("one of: safe");
  });

  test("reports all invalid values together", () => {
    expect(() =>
      defineConfig(
        {
          port: env.number("PORT", { required: true }),
          mode: env.enum("MODE", ["safe", "fast"] as const, { required: true }),
        },
        { PORT: "not-a-number", MODE: "unknown" },
      ),
    ).toThrow(ConfigError);

    try {
      defineConfig(
        {
          port: env.number("PORT", { required: true }),
          mode: env.enum("MODE", ["safe", "fast"] as const, { required: true }),
        },
        { PORT: "not-a-number", MODE: "unknown" },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toEqual([
        "port: PORT must be a finite number",
        "mode: MODE must be one of: safe, fast",
      ]);
    }
  });

  test("does not silently accept missing values", () => {
    expect(() => defineConfig({ url: env.string("DATABASE_URL") }, {})).toThrow(
      "url: DATABASE_URL is not set and has no default",
    );
  });

  test("redacts secrets during configuration inspection", () => {
    const definition = {
      databaseUrl: env.secret("DATABASE_URL", { required: true }),
      port: env.number("PORT", { default: 3000 }),
    };

    expect(defineConfig(definition, { DATABASE_URL: "postgres://user:secret@db/app" })).toEqual({
      databaseUrl: "postgres://user:secret@db/app",
      port: 3000,
    });
    expect(inspectConfig(definition, { DATABASE_URL: "postgres://user:secret@db/app" })).toEqual({
      databaseUrl: "[REDACTED]",
      port: 3000,
    });
  });
});
