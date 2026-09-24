export type GracefulServer = {
  stop(closeActiveConnections?: boolean): Promise<unknown>;
};

export type ShutdownSignal = "SIGINT" | "SIGTERM";

export type GracefulShutdownOptions = {
  readonly signals?: readonly ShutdownSignal[];
  readonly closeActiveConnections?: boolean;
  readonly onError?: (error: unknown, signal: ShutdownSignal) => void;
};

export type GracefulShutdownHandler = (signal: ShutdownSignal) => Promise<void>;

export function createGracefulShutdown(
  server: GracefulServer,
  options: GracefulShutdownOptions = {},
): GracefulShutdownHandler {
  let stopping: Promise<void> | undefined;

  return (signal) => {
    if (stopping) return stopping;

    stopping = (async () => {
      try {
        await server.stop(options.closeActiveConnections);
      } catch (error) {
        options.onError?.(error, signal);
      }
    })();

    return stopping;
  };
}

/**
 * Install explicit signal handlers for a running Elysia server.
 * Returns a cleanup function so tests and embedded runtimes can remove them.
 */
export function installGracefulShutdown(
  server: GracefulServer,
  options: GracefulShutdownOptions = {},
): () => void {
  const signals = [...new Set(options.signals ?? ["SIGINT", "SIGTERM"])] as ShutdownSignal[];
  const shutdown = createGracefulShutdown(server, options);

  const handlers = new Map<ShutdownSignal, () => void>();
  for (const signal of signals) {
    const handler = () => void shutdown(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}
