import type { AnyElysia } from "elysia";
import { bootstrap, disposeBootstrap, type BootstrapOptions } from "./bootstrap";
import type { Application } from "./feature";

export type TestApplicationOptions = Omit<BootstrapOptions, "printFeatures"> & {
  readonly baseUrl?: string;
};

export type TestApplication = {
  readonly server: AnyElysia;
  readonly request: (path: string | URL, init?: RequestInit) => Promise<Response>;
  readonly dispose: () => Promise<void>;
};

/** Boot an application in memory with native Request/Response integration. */
export async function createTestApplication(
  app: Application,
  options: TestApplicationOptions = {},
): Promise<TestApplication> {
  const { baseUrl = "http://starpod.test", ...bootstrapOptions } = options;
  const server = await bootstrap(app, { ...bootstrapOptions, printFeatures: false });

  return {
    server,
    request(path, init) {
      const url = typeof path === "string" ? new URL(path, baseUrl) : path;
      return server.handle(new Request(url.toString(), init));
    },
    dispose: () => disposeBootstrap(server),
  };
}
