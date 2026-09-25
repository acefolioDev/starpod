import { describe, expect, test } from "bun:test";
import { createGracefulShutdown, installGracefulShutdown } from "../src/kernel/lifecycle";

describe("graceful shutdown", () => {
  test("stops only once when multiple signals arrive", async () => {
    let calls = 0;
    const server = {
      async stop() {
        calls += 1;
      },
    };
    const shutdown = createGracefulShutdown(server);

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGTERM")]);

    expect(calls).toBe(1);
  });

  test("reports shutdown errors without mutating process-global state", async () => {
    const failure = new Error("stop failed");
    let observed: unknown;
    const server = {
      async stop() {
        throw failure;
      },
    };
    const shutdown = createGracefulShutdown(server, {
      onError: (error) => {
        observed = error;
      },
    });

    await shutdown("SIGINT");

    expect(observed).toBe(failure);
  });

  test("removes installed signal handlers", () => {
    const before = process.listenerCount("SIGTERM");
    const cleanup = installGracefulShutdown(
      { stop: async () => undefined },
      { signals: ["SIGTERM", "SIGTERM"] },
    );

    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    cleanup();
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  test("removes signal handlers after a signal-triggered stop", async () => {
    const before = process.listenerCount("SIGTERM");
    let stopped = 0;
    installGracefulShutdown(
      { stop: async () => { stopped += 1; } },
      { signals: ["SIGTERM"] },
    );

    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    process.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stopped).toBe(1);
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});
