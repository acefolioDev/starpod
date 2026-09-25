import { describe, expect, test } from "bun:test";
import {
  Container,
  provideAsyncFactory,
  provideFactory,
  provideValue,
  token,
} from "../src/kernel/di/di";

type DatabaseConfig = {
  readonly url: string;
};

const DATABASE_URL = token<string>("DATABASE_URL");
const DATABASE_CONFIG = token<DatabaseConfig>("DATABASE_CONFIG");

describe("DI provider definitions", () => {
  test("resolves typed values and factories", () => {
    const databaseConfig = provideFactory(
      DATABASE_CONFIG,
      [DATABASE_URL] as const,
      (url) => ({ url }),
    );
    const container = new Container([
      provideValue(DATABASE_URL, "postgres://localhost/app"),
      databaseConfig,
    ]);

    expect(container.resolve(DATABASE_CONFIG)).toEqual({
      url: "postgres://localhost/app",
    });
  });

  test("reports missing token dependencies clearly", () => {
    const container = new Container([
      provideFactory(DATABASE_CONFIG, [DATABASE_URL] as const, (url) => ({ url })),
    ]);

    expect(() => container.resolve(DATABASE_CONFIG)).toThrow(
      "DATABASE_URL is not registered",
    );
  });

  test("resolves async factories once and rejects synchronous resolution", async () => {
    const DATABASE = token<{ readonly url: string }>("DATABASE");
    let calls = 0;
    const database = provideAsyncFactory(
      DATABASE,
      [DATABASE_URL] as const,
      async (url) => {
        calls += 1;
        await Promise.resolve();
        return { url };
      },
    );
    const container = new Container([
      provideValue(DATABASE_URL, "postgres://localhost/app"),
      database,
    ]);

    expect(() => container.resolve(DATABASE)).toThrow(
      "DATABASE is asynchronous and must be resolved with resolveAsync()",
    );
    const values = await Promise.all([
      container.resolveAsync(DATABASE),
      container.resolveAsync(DATABASE),
    ]);

    expect(values[0]).toBe(values[1]);
    expect(values[0]).toEqual({ url: "postgres://localhost/app" });
    expect(calls).toBe(1);
  });

  test("waits for an in-flight async provider before disposing it", async () => {
    const RESOURCE = token<{ dispose(): void }>("RESOURCE");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let disposed = 0;
    const resource = provideAsyncFactory(RESOURCE, [], async () => {
      await gate;
      return { dispose: () => { disposed += 1; } };
    });
    const container = new Container([resource]);
    const resolving = container.resolveAsync(RESOURCE).catch(() => undefined);

    await Promise.resolve();
    const disposing = container.dispose();
    release();
    await disposing;
    await resolving;

    expect(disposed).toBe(1);
  });
});
