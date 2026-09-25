import { describe, expect, test } from "bun:test";
import { application, pod } from "../src/kernel/application/feature";
import { plugin } from "../src/kernel/application/plugins";
import { injectHandler } from "../src/kernel/http/handler";
import type { StarpodElysia } from "../src/kernel/http/http";
import { bootstrap, disposeBootstrap } from "../src/kernel/application/bootstrap";

class Controller {
  routes(app: StarpodElysia) {
    return app;
  }
}

const feature = (name: string, prefix: `/${string}` = `/${name}`) =>
  pod({ name, prefix, controller: Controller });

describe("application composition", () => {
  test("requires a feature", () => {
    expect(() => application({ features: [] })).toThrow("Application requires at least one feature");
  });

  test("rejects duplicate feature names and prefixes", () => {
    expect(() => application({ features: [feature("users"), feature("users")] })).toThrow(
      "Duplicate feature name: users",
    );
    expect(() => application({ features: [feature("users", "/api"), feature("orders", "/api")] })).toThrow(
      "Duplicate feature prefix: /api",
    );
  });

  test("rejects duplicate application providers", () => {
    class Database {}

    expect(() => application({ features: [feature("users")], providers: [Database, Database] })).toThrow(
      "Duplicate application provider: Database",
    );
  });

  test("rejects a plugin provider that conflicts with an application provider", () => {
    class Database {}
    const extension = plugin({ name: "database", providers: [Database], configure: (app) => app });

    expect(() => application({ features: [feature("users")], providers: [Database], plugins: [extension] }))
      .toThrow("Duplicate application provider: Database");
  });

  test("rejects ambiguous legacy and current provider options", () => {
    class Database {}

    expect(() => application({
      features: [feature("users")],
      providers: [Database],
      infra: [Database],
    })).toThrow("application.providers or deprecated application.infra, not both");
  });

  test("rejects duplicate feature providers before bootstrap", () => {
    class Database {}

    expect(() => pod({
      name: "users",
      prefix: "/users",
      controller: Controller,
      uses: [Database],
      providers: [Database],
    })).toThrow("Duplicate feature provider: Database");
  });

  test("uses application providers without creating a feature-owned duplicate", async () => {
    let constructed = 0;
    let disposed = 0;
    class Database {
      constructor() {
        constructed += 1;
      }

      dispose() {
        disposed += 1;
      }
    }
    class UsesController {
      static readonly inject = [Database] as const;

      constructor(private readonly database: Database) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => this.database instanceof Database ? "shared" : "invalid");
      }
    }
    const server = await bootstrap(application({
      providers: [Database],
      features: [pod({
        name: "uses",
        prefix: "/uses",
        controller: UsesController,
        uses: [Database],
      })],
    }), { printFeatures: false, seal: false });

    expect(await (await server.handle(new Request("http://localhost/uses/"))).text()).toBe("shared");
    expect(constructed).toBe(1);
    await disposeBootstrap(server);
    expect(disposed).toBe(1);
  });

  test("shares an exported provider across imported feature scopes", async () => {
    let constructed = 0;
    let disposed = 0;
    class SharedService {
      readonly id = crypto.randomUUID();

      constructor() {
        constructed += 1;
      }

      dispose() {
        disposed += 1;
      }
    }
    class AController {
      static readonly inject = [SharedService] as const;

      constructor(private readonly service: SharedService) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => this.service.id);
      }
    }
    class BController {
      static readonly inject = [SharedService] as const;

      constructor(private readonly service: SharedService) {}

      routes(app: StarpodElysia) {
        return app.get("/", () => this.service.id);
      }
    }
    const a = pod({
      name: "a",
      prefix: "/a",
      controller: AController,
      providers: [SharedService],
      exports: [SharedService],
    });
    const b = pod({ name: "b", prefix: "/b", controller: BController, imports: [a] });
    const server = await bootstrap(application({ features: [b, a] }), { printFeatures: false, seal: false });

    const aId = await (await server.handle(new Request("http://localhost/a/"))).text();
    const bId = await (await server.handle(new Request("http://localhost/b/"))).text();
    expect(bId).toBe(aId);
    expect(constructed).toBe(1);
    await disposeBootstrap(server);
    expect(disposed).toBe(1);
  });

  test("shares an exported request provider through the importing request scope", async () => {
    let constructed = 0;
    let disposed = 0;
    class RequestService {
      static readonly lifetime = "request" as const;
      readonly id = ++constructed;

      dispose() {
        disposed += 1;
      }
    }
    class AController {
      routes(app: StarpodElysia) {
        return app;
      }
    }
    class BController {
      routes(app: StarpodElysia) {
        return app.get("/", injectHandler([RequestService], (_, service) => ({ id: service.id, same: true })));
      }
    }
    const a = pod({
      name: "requesta",
      prefix: "/requesta",
      controller: AController,
      providers: [RequestService],
      exports: [RequestService],
    });
    const b = pod({ name: "requestb", prefix: "/requestb", controller: BController, imports: [a] });
    const server = await bootstrap(application({ features: [b, a] }), { printFeatures: false, seal: false });

    expect(await (await server.handle(new Request("http://localhost/requestb/"))).json()).toEqual({ id: 1, same: true });
    expect(await (await server.handle(new Request("http://localhost/requestb/"))).json()).toEqual({ id: 2, same: true });
    expect(constructed).toBe(2);
    expect(disposed).toBe(2);
    await disposeBootstrap(server);
  });

  test("does not expose a feature provider that was not exported", async () => {
    class PrivateService {}
    class AController {
      routes(app: StarpodElysia) {
        return app;
      }
    }
    class BController {
      static readonly inject = [PrivateService] as const;

      constructor(_privateService: PrivateService) {}

      routes(app: StarpodElysia) {
        return app;
      }
    }
    const a = pod({
      name: "privatea",
      prefix: "/privatea",
      controller: AController,
      providers: [PrivateService],
    });
    const b = pod({ name: "privateb", prefix: "/privateb", controller: BController, imports: [a] });

    await expect(bootstrap(application({ features: [b, a] }), { printFeatures: false, seal: false })).rejects.toThrow(
      "PrivateService is not registered",
    );
  });

  test("rejects unsafe feature prefixes", () => {
    expect(() => pod({ name: "unsafe", prefix: "//users", controller: Controller })).toThrow("Feature prefix");
    expect(() => pod({ name: "unsafe", prefix: "/users?all=true", controller: Controller })).toThrow("Feature prefix");
  });

  test("rejects feature names that the architecture seal cannot represent", () => {
    expect(() => feature("user-profile")).toThrow(
      'Feature name must be a single lowercase word (got "user-profile")',
    );
  });
});
