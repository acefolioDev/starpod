import type { AnyElysia } from "elysia";
import { bootstrap, disposeBootstrap, type BootstrapOptions } from "./bootstrap";
import type { Application } from "./feature";
import {
  installGracefulShutdown,
  type GracefulShutdownOptions,
} from "./lifecycle";

export type ListenOptions = Parameters<AnyElysia["listen"]>[0];

export type StartOptions = BootstrapOptions & {
  /** Native Elysia listen options. A port is usually the simplest choice. */
  readonly listen: ListenOptions;
  /** Set false when the host process owns signal handling. */
  readonly shutdown?: false | GracefulShutdownOptions;
};

export type StartedApplication = {
  readonly server: AnyElysia;
  /** Stop the native Elysia server and dispose the Starpod provider graph. */
  readonly stop: (closeActiveConnections?: boolean) => Promise<void>;
};

/**
 * Bootstrap, listen, and install optional graceful shutdown as one explicit
 * startup boundary. Native Elysia remains the actual HTTP server.
 */
export async function start(
  application: Application,
  options: StartOptions,
): Promise<StartedApplication> {
  const { listen, shutdown = {}, ...bootstrapOptions } = options;
  const server = await bootstrap(application, bootstrapOptions);
  let cleanup: (() => void) | undefined;

  try {
    server.listen(listen);
    if (shutdown !== false) cleanup = installGracefulShutdown(server, shutdown);
  } catch (error) {
    await disposeBootstrap(server).catch(() => undefined);
    throw error;
  }

  let stopped = false;
  return {
    server,
    async stop(closeActiveConnections) {
      if (stopped) return;
      stopped = true;
      cleanup?.();
      await server.stop(closeActiveConnections);
    },
  };
}
