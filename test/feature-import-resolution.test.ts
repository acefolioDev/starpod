import { describe, expect, test } from "bun:test";
import { application, pod } from "../src/kernel/application/feature";
import { bootstrap, disposeBootstrap } from "../src/kernel/application/bootstrap";
import { injectHandler } from "../src/kernel/http/handler";
import { REQUEST_CONTEXT, type StarpodElysia } from "../src/kernel/http/http";

describe("feature import resolution", () => {
  test("rejects duplicate feature imports", () => {
    const owner = pod({
      name: "duplicateowner",
      prefix: "/duplicateowner",
      controller: class OwnerController {
        routes(app: StarpodElysia) {
          return app;
        }
      },
    });
    const consumer = pod({
      name: "duplicateconsumer",
      prefix: "/duplicateconsumer",
      controller: class ConsumerController {
        routes(app: StarpodElysia) {
          return app;
        }
      },
      imports: [owner, owner],
    });

    expect(() => application({ features: [consumer, owner] })).toThrow("Duplicate feature import: duplicateowner");
  });

  test("does not expose an export unless the consumer imports its feature", async () => {
    class SharedService {}
    class OwnerController {
      routes(app: StarpodElysia) {
        return app;
      }
    }
    class ConsumerController {
      static readonly inject = [SharedService] as const;

      constructor(_service: SharedService) {}

      routes(app: StarpodElysia) {
        return app;
      }
    }
    const owner = pod({
      name: "boundaryowner",
      prefix: "/boundaryowner",
      controller: OwnerController,
      providers: [SharedService],
      exports: [SharedService],
    });
    const consumer = pod({
      name: "boundaryconsumer",
      prefix: "/boundaryconsumer",
      controller: ConsumerController,
    });

    await expect(bootstrap(application({ features: [consumer, owner] }), { printFeatures: false, seal: false }))
      .rejects.toThrow("SharedService is not registered");
  });

  test("rejects a local provider that shadows an imported export", () => {
    class SharedService {}
    const owner = pod({
      name: "owner",
      prefix: "/owner",
      controller: class OwnerController {
        routes(app: StarpodElysia) {
          return app;
        }
      },
      providers: [SharedService],
      exports: [SharedService],
    });

    expect(() => application({
      features: [
        pod({
          name: "importer",
          prefix: "/importer",
          controller: class ImporterController {
            routes(app: StarpodElysia) {
              return app;
            }
          },
          imports: [owner],
          providers: [SharedService],
        }),
        owner,
      ],
    })).toThrow("importer: provider SharedService shadows exported provider from owner");
  });

  test("resolves an imported provider's private dependencies in its owning feature", async () => {
    class PrivateDependency {
      readonly value = "owner-private";
    }
    class ExportedService {
      static readonly inject = [PrivateDependency] as const;

      constructor(private readonly dependency: PrivateDependency) {}

      read() {
        return this.dependency.value;
      }
    }
    class OwnerController {
      static readonly inject = [ExportedService] as const;

      constructor(private readonly service: ExportedService) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => this.service.read());
      }
    }
    class ImporterController {
      static readonly inject = [ExportedService] as const;

      constructor(private readonly service: ExportedService) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => this.service.read());
      }
    }
    const owner = pod({
      name: "owner",
      prefix: "/owner",
      controller: OwnerController,
      providers: [PrivateDependency, ExportedService],
      exports: [ExportedService],
    });
    const importer = pod({
      name: "importer",
      prefix: "/importer",
      controller: ImporterController,
      imports: [owner],
    });
    const server = await bootstrap(application({ features: [importer, owner] }), { printFeatures: false, seal: false });

    expect(await (await server.handle(new Request("http://localhost/importer/"))).text()).toBe("owner-private");
    await disposeBootstrap(server);
  });

  test("keeps request context available to an imported request provider", async () => {
    class RequestService {
      static readonly lifetime = "request" as const;
      static readonly inject = [REQUEST_CONTEXT] as const;

      constructor(private readonly context: { readonly route: string }) {}

      route() {
        return this.context.route;
      }
    }
    class OwnerController {
      routes(app: StarpodElysia) {
        return app;
      }
    }
    class ImporterController {
      routes(app: StarpodElysia) {
        return app.get("/", injectHandler([RequestService], (_, service) => service.route()));
      }
    }
    const owner = pod({
      name: "requestowner",
      prefix: "/requestowner",
      controller: OwnerController,
      providers: [RequestService],
      exports: [RequestService],
    });
    const importer = pod({
      name: "requestimporter",
      prefix: "/requestimporter",
      controller: ImporterController,
      imports: [owner],
    });
    const server = await bootstrap(application({ features: [importer, owner] }), { printFeatures: false, seal: false });

    expect(await (await server.handle(new Request("http://localhost/requestimporter/"))).text()).toBe("/requestimporter/");
    await disposeBootstrap(server);
  });

  test("initializes imported providers through their owning feature scope", async () => {
    let initialized = 0;
    let disposed = 0;
    class SharedService {
      ready = false;

      initialize() {
        this.ready = true;
        initialized += 1;
      }

      dispose() {
        disposed += 1;
      }
    }
    class OwnerController {
      routes(app: StarpodElysia) {
        return app;
      }
    }
    class ImporterController {
      static readonly inject = [SharedService] as const;

      constructor(private readonly service: SharedService) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => this.service.ready ? "ready" : "cold");
      }
    }
    const owner = pod({
      name: "lifecycleowner",
      prefix: "/lifecycleowner",
      controller: OwnerController,
      providers: [SharedService],
      exports: [SharedService],
    });
    const importer = pod({
      name: "lifecycleimporter",
      prefix: "/lifecycleimporter",
      controller: ImporterController,
      imports: [owner],
    });
    const server = await bootstrap(application({ features: [importer, owner] }), { printFeatures: false, seal: false });

    expect(await (await server.handle(new Request("http://localhost/lifecycleimporter/"))).text()).toBe("ready");
    expect(initialized).toBe(1);
    await disposeBootstrap(server);
    expect(disposed).toBe(1);
  });
});
